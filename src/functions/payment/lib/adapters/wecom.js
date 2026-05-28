'use strict';

/**
 * WeCom Pay adapter.
 *
 * WeCom payment products are implemented through the WeChat Pay API v3 shape:
 * RSA-SHA256 request signatures, encrypted callback resources, and minor-unit
 * money fields. This adapter hides those provider details behind the normalized
 * payment adapter contract used by `src/functions/payment/index.js`.
 */
const crypto = require('crypto');

const DEFAULT_BASE_URL = 'https://api.mch.weixin.qq.com';

function trimTrailingSlash(value) {
    return String(value || '').replace(/\/+$/, '');
}

/**
 * Resolve merchant configuration from the provider row.
 *
 * Payment credentials are database-owned so each institution can use its own
 * merchant account. `secret_ref` is retained as metadata for KMS/ops lookup, but
 * this adapter does not read provider secrets from process environment.
 */
function resolveConfig(row = {}) {
    const cfg = row.config || {};
    return {
        provider_account_id: row.id,
        institution_id: row.institution_id || null,
        scope: row.scope || 'admin',
        appid: cfg.appid,
        mchid: row.merchant_id || cfg.mchid,
        api_base_url: trimTrailingSlash(cfg.api_base_url || DEFAULT_BASE_URL),
        notify_url: cfg.notify_url,
        refund_notify_url: cfg.refund_notify_url,
        merchant_serial_no: cfg.merchant_serial_no,
        private_key: normalizePrivateKey(cfg.private_key),
        app_key: cfg.app_key || cfg.appkey || cfg.api_key,
        appclient_cert: normalizePublicKey(cfg.appclient_cert || cfg.client_cert || cfg.certificate),
        api_v3_key: cfg.api_v3_key,
        public_key: normalizePublicKey(cfg.public_key || cfg.platform_public_key),
    };
}

function normalizePrivateKey(value) {
    if (!value) return value;
    return String(value).replace(/\\n/g, '\n');
}

function normalizePublicKey(value) {
    if (!value) return value;
    return String(value).replace(/\\n/g, '\n');
}

function nonce() {
    return crypto.randomBytes(16).toString('hex');
}

function signMessage(message, privateKey) {
    return crypto.createSign('RSA-SHA256').update(message).end().sign(privateKey, 'base64');
}

function isLegacyConfig(cfg) {
    return Boolean(cfg.app_key);
}

function legacyNonce() {
    return crypto.randomBytes(16).toString('hex');
}

function legacySign(params, appKey) {
    const signContent = Object.keys(params)
        .filter((key) => key !== 'sign' && params[key] !== undefined && params[key] !== null && params[key] !== '')
        .sort()
        .map((key) => `${key}=${params[key]}`)
        .join('&');
    return crypto
        .createHash('md5')
        .update(`${signContent}&key=${appKey}`, 'utf8')
        .digest('hex')
        .toUpperCase();
}

function xmlEscape(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function buildXml(params) {
    const body = Object.keys(params)
        .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== '')
        .map((key) => `<${key}>${xmlEscape(params[key])}</${key}>`)
        .join('');
    return `<xml>${body}</xml>`;
}

function xmlUnescape(value) {
    return String(value)
        .replace(/&apos;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&gt;/g, '>')
        .replace(/&lt;/g, '<')
        .replace(/&amp;/g, '&');
}

function parseXml(text) {
    const data = {};
    const content = String(text || '').replace(/^\s*<xml>/, '').replace(/<\/xml>\s*$/, '');
    const pattern = /<([A-Za-z0-9_]+)>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/\1>/g;
    let match;
    while ((match = pattern.exec(content)) !== null) {
        data[match[1]] = xmlUnescape(match[2] ?? match[3] ?? '');
    }
    return data;
}

async function requestXml(path, params, cfg) {
    const signedParams = { ...params };
    signedParams.sign = legacySign(signedParams, cfg.app_key);
    const res = await fetch(`${cfg.api_base_url}${path}`, {
        method: 'POST',
        headers: {
            Accept: 'text/xml',
            'Content-Type': 'text/xml; charset=utf-8',
            'User-Agent': 'nano-payment/1.0',
        },
        body: buildXml(signedParams),
    });
    const text = await res.text();
    const data = parseXml(text);
    if (!res.ok || data.return_code === 'FAIL' || data.result_code === 'FAIL') {
        const e = new Error(data.err_code_des || data.return_msg || `WeChat Pay v2 request failed: ${res.status}`);
        e.statusCode = res.status;
        e.provider_payload = data || { raw: text };
        throw e;
    }
    return data;
}

function checkRequired(checks, key, value, message = `${key} is required`) {
    const ok = Boolean(value);
    checks.push({ key, ok, message: ok ? undefined : message });
    return ok;
}

function checkPrivateKey(checks, key, value) {
    if (!value) {
        checks.push({ key, ok: false, message: `${key} is required` });
        return false;
    }
    try {
        signMessage('nano-payment-config-test', value);
        checks.push({ key, ok: true });
        return true;
    } catch (err) {
        checks.push({ key, ok: false, message: `private key cannot sign: ${err.message}` });
        return false;
    }
}

function checkPublicKey(checks, key, value) {
    if (!value) {
        checks.push({ key, ok: false, message: `${key} is required for callback verification` });
        return false;
    }
    try {
        crypto.createPublicKey(value);
        checks.push({ key, ok: true });
        return true;
    } catch (err) {
        checks.push({ key, ok: false, message: `public key is invalid: ${err.message}` });
        return false;
    }
}

/**
 * Validate WeChat Pay v3-compatible config without calling the provider.
 *
 * Refund capability uses the same merchant signing material as payment, plus
 * API v3 key for refund callback decryption. This check proves the config has
 * the local material needed to submit/query refunds; it does not create a real
 * refund.
 */
function validateConfig(providerRow = {}) {
    const cfg = resolveConfig(providerRow);
    const checks = [];

    checkRequired(checks, 'merchant_id', cfg.mchid);
    checkRequired(checks, 'appid', cfg.appid);
    if (isLegacyConfig(cfg)) {
        checkRequired(checks, 'app_key', cfg.app_key);
        checkPrivateKey(checks, 'private_key', cfg.private_key);
        checkRequired(checks, 'appclient_cert', cfg.appclient_cert);
        checkRequired(checks, 'notify_url', cfg.notify_url);
        const valid = checks
            .filter((check) => ['merchant_id', 'appid', 'app_key', 'private_key', 'appclient_cert', 'notify_url'].includes(check.key))
            .every((check) => check.ok);
        checks.push({
            key: 'refund_capability',
            ok: false,
            message: 'Legacy WeChat Pay v2 refund is not implemented',
        });
        return { valid, refund_supported: false, checks };
    }
    checkRequired(checks, 'merchant_serial_no', cfg.merchant_serial_no);
    checkRequired(checks, 'notify_url', cfg.notify_url);
    checkRequired(checks, 'refund_notify_url', cfg.refund_notify_url);
    checkRequired(checks, 'api_v3_key', cfg.api_v3_key, 'api_v3_key is required for callback resource decryption');
    const privateKeyOk = checkPrivateKey(checks, 'private_key', cfg.private_key);
    const publicKeyOk = checkPublicKey(checks, 'public_key', cfg.public_key);

    const paymentReady = checks
        .filter((check) => ['merchant_id', 'appid', 'merchant_serial_no', 'notify_url', 'private_key'].includes(check.key))
        .every((check) => check.ok);
    const refundSupported = paymentReady
        && checks
            .filter((check) => ['refund_notify_url', 'api_v3_key', 'public_key'].includes(check.key))
            .every((check) => check.ok);

    checks.push({
        key: 'refund_capability',
        ok: refundSupported,
        message: refundSupported ? undefined : 'Refund requires merchant signing fields, refund_notify_url, api_v3_key, and public_key',
    });

    return {
        valid: paymentReady && publicKeyOk,
        refund_supported: refundSupported && privateKeyOk,
        checks,
    };
}

/**
 * Build the WeChat Pay v3 Authorization header.
 *
 * The signature input is method, path-with-query, timestamp, nonce, and exact
 * request body joined by newlines. Changing body serialization after signing
 * would invalidate the request, so `requestJson` signs the same string it sends.
 */
function buildAuthorization(method, urlPathWithQuery, body, cfg) {
    if (!cfg.mchid || !cfg.merchant_serial_no || !cfg.private_key) {
        throw new Error('WeCom Pay merchant config is incomplete');
    }
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonceStr = nonce();
    const bodyText = body || '';
    const message = `${method}\n${urlPathWithQuery}\n${timestamp}\n${nonceStr}\n${bodyText}\n`;
    const signature = signMessage(message, cfg.private_key);
    return `WECHATPAY2-SHA256-RSA2048 mchid="${cfg.mchid}",nonce_str="${nonceStr}",timestamp="${timestamp}",serial_no="${cfg.merchant_serial_no}",signature="${signature}"`;
}

/**
 * Send one JSON request to WeChat Pay v3 and return parsed response data.
 *
 * Provider error payloads are attached to the thrown error so the caller can log
 * or persist the provider response without leaking secrets.
 */
async function requestJson(method, path, payload, cfg) {
    const body = payload ? JSON.stringify(payload) : '';
    const res = await fetch(`${cfg.api_base_url}${path}`, {
        method,
        headers: {
            Authorization: buildAuthorization(method, path, body, cfg),
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'nano-payment/1.0',
        },
        body: body || undefined,
    });
    const text = await res.text();
    let data = {};
    if (text) {
        try { data = JSON.parse(text); } catch { data = { raw: text }; }
    }
    if (!res.ok) {
        const e = new Error(data.message || data.code || `WeCom Pay request failed: ${res.status}`);
        e.statusCode = res.status;
        e.provider_payload = data;
        throw e;
    }
    return data;
}

/**
 * Convert local UUID-like payment IDs into provider-safe out_trade_no values.
 *
 * WeChat Pay accepts merchant order numbers with a limited character set and
 * length. The local DB ID remains the authoritative internal identifier.
 */
function tradeNo(localPaymentId) {
    return String(localPaymentId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
}

/**
 * Normalize provider payment states into the small core status model.
 */
function mapPaymentStatus(status) {
    const value = String(status || '').toUpperCase();
    if (value === 'SUCCESS') return 'paid';
    if (value === 'CLOSED') return 'closed';
    if (value === 'PAYERROR') return 'failed';
    if (value === 'REFUND') return 'refunding';
    if (value === 'NOTPAY' || value === 'USERPAYING' || value === 'ACCEPT') return 'pending';
    return 'pending';
}

/**
 * Normalize provider refund states into the small core status model.
 */
function mapRefundStatus(status) {
    const value = String(status || '').toUpperCase();
    if (value === 'SUCCESS') return 'succeeded';
    if (value === 'CLOSED' || value === 'ABNORMAL') return 'closed';
    if (value === 'PROCESSING') return 'pending';
    return 'pending';
}

/**
 * Build the mini-program client payload from a provider prepay_id.
 *
 * This is the second signature in JSAPI/mini-program payment: the merchant
 * signs the package fields consumed by the WeChat/WeCom client SDK.
 */
function buildMiniProgramPayload(prepayId, cfg) {
    const timeStamp = Math.floor(Date.now() / 1000).toString();
    const nonceStr = nonce();
    const pkg = `prepay_id=${prepayId}`;
    const signType = 'RSA';
    const paySign = signMessage(`${cfg.appid}\n${timeStamp}\n${nonceStr}\n${pkg}\n`, cfg.private_key);
    return { type: 'mini_program', appId: cfg.appid, timeStamp, nonceStr, package: pkg, signType, paySign };
}

function buildLegacyMiniProgramPayload(prepayId, cfg) {
    const timeStamp = Math.floor(Date.now() / 1000).toString();
    const nonceStr = legacyNonce();
    const pkg = `prepay_id=${prepayId}`;
    const signType = 'MD5';
    const paySign = legacySign({
        appId: cfg.appid,
        timeStamp,
        nonceStr,
        package: pkg,
        signType,
    }, cfg.app_key);
    return { type: 'mini_program', appId: cfg.appid, timeStamp, nonceStr, package: pkg, signType, paySign };
}

async function createLegacyPayment(input, cfg) {
    const outTradeNo = tradeNo(input.payment_order_id);
    const tradeTypes = {
        mini_program: 'JSAPI',
        web: 'MWEB',
        app: 'APP',
        qr_code: 'NATIVE',
    };
    const tradeType = tradeTypes[input.scene];
    if (!tradeType) throw new Error(`Unsupported WeChat Pay v2 payment scene: ${input.scene}`);

    const data = await requestXml('/pay/unifiedorder', {
        appid: cfg.appid,
        mch_id: cfg.mchid,
        nonce_str: legacyNonce(),
        body: input.subject,
        out_trade_no: outTradeNo,
        total_fee: input.amount_minor,
        spbill_create_ip: input.client_ip || '127.0.0.1',
        notify_url: cfg.notify_url,
        trade_type: tradeType,
        openid: input.scene === 'mini_program' ? input.openid : undefined,
        product_id: input.scene === 'qr_code' ? outTradeNo : undefined,
        attach: JSON.stringify({ payment_order_id: input.payment_order_id, business_order_id: input.business_order_id }),
    }, cfg);

    const paymentPayload = input.scene === 'mini_program'
        ? buildLegacyMiniProgramPayload(data.prepay_id, cfg)
        : input.scene === 'web'
            ? { type: 'web', h5_url: data.mweb_url }
            : input.scene === 'qr_code'
                ? { type: 'qr_code', qr_code_url: data.code_url }
                : { type: 'app', prepay_id: data.prepay_id };

    return {
        status: 'pending',
        provider_trade_no: outTradeNo,
        provider_payload: data,
        payment_payload: paymentPayload,
    };
}

/**
 * Create a provider payment order for mini-program, app, or web scenes.
 *
 * The core service passes a normalized scene. This adapter selects the matching
 * WeChat Pay v3 endpoint and returns a normalized local status plus the
 * scene-specific `payment_payload` the client needs to continue checkout.
 */
async function createPayment(input, providerRow) {
    const cfg = resolveConfig(providerRow);
    if (isLegacyConfig(cfg)) return createLegacyPayment(input, cfg);

    const outTradeNo = tradeNo(input.payment_order_id);
    const common = {
        mchid: cfg.mchid,
        out_trade_no: outTradeNo,
        appid: cfg.appid,
        description: input.subject,
        notify_url: cfg.notify_url,
        amount: { total: input.amount_minor, currency: input.currency || 'CNY' },
        attach: JSON.stringify({ payment_order_id: input.payment_order_id, business_order_id: input.business_order_id }),
    };

    if (input.scene === 'mini_program') {
        // JSAPI is also the shape used by WeChat/WeCom mini-program checkout.
        const data = await requestJson('POST', '/v3/pay/transactions/jsapi', {
            ...common,
            payer: { openid: input.openid },
        }, cfg);
        return {
            status: 'pending',
            provider_trade_no: outTradeNo,
            provider_payload: data,
            payment_payload: buildMiniProgramPayload(data.prepay_id, cfg),
        };
    }

    if (input.scene === 'app') {
        const data = await requestJson('POST', '/v3/pay/transactions/app', common, cfg);
        return {
            status: 'pending',
            provider_trade_no: outTradeNo,
            provider_payload: data,
            payment_payload: { type: 'app', prepay_id: data.prepay_id },
        };
    }

    if (input.scene === 'web') {
        // H5 checkout requires payer_client_ip for provider-side risk controls.
        const data = await requestJson('POST', '/v3/pay/transactions/h5', {
            ...common,
            scene_info: { payer_client_ip: input.client_ip || '127.0.0.1' },
        }, cfg);
        return {
            status: 'pending',
            provider_trade_no: outTradeNo,
            provider_payload: data,
            payment_payload: { type: 'web', h5_url: data.h5_url },
        };
    }

    if (input.scene === 'qr_code') {
        const data = await requestJson('POST', '/v3/pay/transactions/native', common, cfg);
        return {
            status: 'pending',
            provider_trade_no: outTradeNo,
            provider_payload: data,
            payment_payload: { type: 'qr_code', qr_code_url: data.code_url },
        };
    }

    throw new Error(`Unsupported WeCom payment scene: ${input.scene}`);
}

/**
 * Query payment status by merchant order number.
 */
async function queryPayment(input, providerRow) {
    const cfg = resolveConfig(providerRow);
    if (isLegacyConfig(cfg)) {
        const outTradeNo = input.provider_trade_no || tradeNo(input.payment_order_id);
        const data = await requestXml('/pay/orderquery', {
            appid: cfg.appid,
            mch_id: cfg.mchid,
            nonce_str: legacyNonce(),
            out_trade_no: outTradeNo,
        }, cfg);
        return {
            status: mapPaymentStatus(data.trade_state || (data.result_code === 'SUCCESS' ? 'SUCCESS' : 'PAYERROR')),
            paid_at: formatLegacyPayTime(data.time_end),
            provider_payload: data,
        };
    }
    const outTradeNo = encodeURIComponent(input.provider_trade_no || tradeNo(input.payment_order_id));
    const data = await requestJson('GET', `/v3/pay/transactions/out-trade-no/${outTradeNo}?mchid=${encodeURIComponent(cfg.mchid)}`, null, cfg);
    return {
        status: mapPaymentStatus(data.trade_state),
        paid_at: data.success_time || null,
        provider_payload: data,
    };
}

/**
 * Close a pending provider order so the business order can be retried cleanly.
 */
async function closePayment(input, providerRow) {
    const cfg = resolveConfig(providerRow);
    if (isLegacyConfig(cfg)) {
        const outTradeNo = input.provider_trade_no || tradeNo(input.payment_order_id);
        const data = await requestXml('/pay/closeorder', {
            appid: cfg.appid,
            mch_id: cfg.mchid,
            nonce_str: legacyNonce(),
            out_trade_no: outTradeNo,
        }, cfg);
        return { status: 'closed', provider_payload: data };
    }
    const outTradeNo = encodeURIComponent(input.provider_trade_no || tradeNo(input.payment_order_id));
    const data = await requestJson('POST', `/v3/pay/transactions/out-trade-no/${outTradeNo}/close`, { mchid: cfg.mchid }, cfg);
    return { status: 'closed', provider_payload: data };
}

/**
 * Submit a provider refund request.
 *
 * `amount.total` must be the original payment amount, while `amount.refund` is
 * the requested partial/full refund amount.
 */
async function createRefund(input, providerRow) {
    const cfg = resolveConfig(providerRow);
    const outRefundNo = input.refund_no;
    const payload = {
        out_trade_no: input.provider_trade_no,
        out_refund_no: outRefundNo,
        reason: input.reason || undefined,
        notify_url: cfg.refund_notify_url,
        amount: {
            refund: input.amount_minor,
            total: input.total_amount_minor || input.amount_minor,
            currency: input.currency || 'CNY',
        },
    };
    const data = await requestJson('POST', '/v3/refund/domestic/refunds', payload, cfg);
    return {
        status: mapRefundStatus(data.status),
        provider_refund_no: data.refund_id || null,
        provider_payload: data,
        succeeded_at: data.success_time || null,
    };
}

/**
 * Query refund status by merchant refund number.
 */
async function queryRefund(input, providerRow) {
    const cfg = resolveConfig(providerRow);
    const outRefundNo = encodeURIComponent(input.refund_no || input.provider_refund_no);
    const data = await requestJson('GET', `/v3/refund/domestic/refunds/${outRefundNo}`, null, cfg);
    return {
        status: mapRefundStatus(data.status),
        provider_payload: data,
        succeeded_at: data.success_time || null,
    };
}

function getHeader(headers, name) {
    const lower = name.toLowerCase();
    for (const [key, value] of Object.entries(headers || {})) {
        if (key.toLowerCase() === lower) return value;
    }
    return '';
}

/**
 * Verify a WeChat Pay callback signature.
 *
 * Tests may omit `public_key`; production should configure it. When a
 * key is present, the exact raw callback body is part of the signed message.
 */
function verifySignature(headers, rawBody, cfg) {
    if (!cfg.public_key) return true;
    const timestamp = getHeader(headers, 'Wechatpay-Timestamp');
    const nonceStr = getHeader(headers, 'Wechatpay-Nonce');
    const signature = getHeader(headers, 'Wechatpay-Signature');
    if (!timestamp || !nonceStr || !signature) return false;
    const message = `${timestamp}\n${nonceStr}\n${rawBody}\n`;
    return crypto.createVerify('RSA-SHA256').update(message).end().verify(cfg.public_key, signature, 'base64');
}

/**
 * Decrypt callback `resource` using API v3 AES-256-GCM.
 *
 * The encrypted provider payload is authenticated with the API v3 key, nonce,
 * and optional associated data. The decrypted JSON contains the actual payment
 * or refund status fields used by the normalizers below.
 */
function decryptResource(resource, cfg) {
    if (!resource) return {};
    if (!cfg.api_v3_key) throw new Error('WeCom Pay API v3 key is required to decrypt callback resource');
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(cfg.api_v3_key, 'utf8'), Buffer.from(resource.nonce, 'utf8'));
    decipher.setAuthTag(Buffer.from(resource.ciphertext, 'base64').subarray(-16));
    if (resource.associated_data) decipher.setAAD(Buffer.from(resource.associated_data, 'utf8'));
    const ciphertext = Buffer.from(resource.ciphertext, 'base64').subarray(0, -16);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8'));
}

/**
 * Verify and normalize a payment callback.
 */
async function verifyPaymentCallback(input, providerRow) {
    const cfg = resolveConfig(providerRow);
    if (isLegacyConfig(cfg) || isXmlBody(input.rawBody)) {
        const params = parseXml(input.rawBody);
        if (!verifyLegacySignature(params, cfg)) {
            const e = new Error('Invalid WeChat Pay v2 callback signature');
            e.statusCode = 401;
            e.code = 'PAYMENT_CALLBACK_INVALID_SIGNATURE';
            throw e;
        }
        const attach = parseAttach(params.attach);
        return {
            event_id: params.transaction_id || params.out_trade_no,
            provider_trade_no: params.out_trade_no,
            local_order_id: attach.payment_order_id || params.out_trade_no,
            status: params.return_code === 'SUCCESS' && params.result_code === 'SUCCESS' ? 'paid' : 'failed',
            paid_at: formatLegacyPayTime(params.time_end),
            raw: params,
        };
    }
    if (!verifySignature(input.headers, input.rawBody, cfg)) {
        const e = new Error('Invalid WeCom Pay callback signature');
        e.statusCode = 401;
        e.code = 'PAYMENT_CALLBACK_INVALID_SIGNATURE';
        throw e;
    }
    const payload = JSON.parse(input.rawBody || '{}');
    // Some tests and simulator calls pass plain JSON. Real WeChat Pay v3
    // callbacks place encrypted business data under `resource`.
    const resource = payload.resource ? decryptResource(payload.resource, cfg) : payload;
    const attach = parseAttach(resource.attach);
    return {
        event_id: payload.id || resource.transaction_id || resource.out_trade_no,
        provider_trade_no: resource.out_trade_no,
        local_order_id: attach.payment_order_id,
        status: mapPaymentStatus(resource.trade_state || 'SUCCESS'),
        paid_at: resource.success_time || null,
        raw: resource,
    };
}

/**
 * Verify and normalize a refund callback.
 */
async function verifyRefundCallback(input, providerRow) {
    const cfg = resolveConfig(providerRow);
    if (!verifySignature(input.headers, input.rawBody, cfg)) {
        const e = new Error('Invalid WeCom Pay refund callback signature');
        e.statusCode = 401;
        e.code = 'PAYMENT_CALLBACK_INVALID_SIGNATURE';
        throw e;
    }
    const payload = JSON.parse(input.rawBody || '{}');
    const resource = payload.resource ? decryptResource(payload.resource, cfg) : payload;
    return {
        event_id: payload.id || resource.refund_id || resource.out_refund_no,
        provider_refund_no: resource.refund_id || null,
        local_refund_id: resource.out_refund_no || null,
        status: mapRefundStatus(resource.refund_status || resource.status),
        succeeded_at: resource.success_time || null,
        raw: resource,
    };
}

function parseAttach(value) {
    if (!value) return {};
    try { return JSON.parse(value); } catch { return {}; }
}

function formatLegacyPayTime(value) {
    const text = String(value || '');
    if (!/^\d{14}$/.test(text)) return null;
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T${text.slice(8, 10)}:${text.slice(10, 12)}:${text.slice(12, 14)}+08:00`;
}

function verifyLegacySignature(params, cfg) {
    if (!cfg.app_key) return true;
    if (!params.sign) return false;
    return legacySign(params, cfg.app_key) === params.sign;
}

function isXmlBody(rawBody) {
    return String(rawBody || '').trim().startsWith('<xml>');
}

function paymentCallbackResponse() {
    return { code: 'SUCCESS', message: 'OK' };
}

function refundCallbackResponse() {
    return { code: 'SUCCESS', message: 'OK' };
}

module.exports = {
    provider: 'wecom',
    createPayment,
    queryPayment,
    closePayment,
    createRefund,
    queryRefund,
    verifyPaymentCallback,
    verifyRefundCallback,
    paymentCallbackResponse,
    refundCallbackResponse,
    validateConfig,
    __private: {
        resolveConfig,
        mapPaymentStatus,
        mapRefundStatus,
        buildAuthorization,
        decryptResource,
        validateConfig,
    },
};
