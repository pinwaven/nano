'use strict';

/**
 * Alipay adapter.
 *
 * Alipay uses the OpenAPI gateway style instead of the WeChat Pay v3 REST
 * shape: request parameters are signed with RSA2, `biz_content` carries the
 * business payload, synchronous API responses are nested by method name, and
 * async callbacks are form-encoded. This adapter translates those details into
 * the normalized payment adapter contract used by the payment core.
 */

const crypto = require('crypto');

const DEFAULT_GATEWAY_URL = 'https://openapi.alipay.com/gateway.do';
const DEFAULT_CHARSET = 'utf-8';
const DEFAULT_VERSION = '1.0';

/**
 * Resolve merchant config from `payment_providers`.
 *
 * Payment credentials are stored per provider row so an institution can use its
 * own Alipay app. Avoid logging the returned object because it may include
 * private keys.
 */
function resolveConfig(row = {}) {
    const cfg = row.config || {};
    return {
        provider_account_id: row.id,
        institution_id: row.institution_id || null,
        scope: row.scope || 'admin',
        app_id: cfg.app_id,
        gateway_url: String(cfg.gateway_url || DEFAULT_GATEWAY_URL).replace(/\?+$/, ''),
        private_key: normalizePrivateKeySecret(cfg.private_key),
        alipay_public_key: normalizePemSecret(cfg.alipay_public_key, 'PUBLIC KEY'),
        notify_url: cfg.notify_url,
        refund_notify_url: cfg.refund_notify_url,
        return_url: cfg.return_url,
        sign_type: cfg.sign_type || 'RSA2',
        charset: cfg.charset || DEFAULT_CHARSET,
        version: cfg.version || DEFAULT_VERSION,
    };
}

function normalizeMultilineSecret(value) {
    if (!value) return value;
    return String(value).replace(/\\n/g, '\n');
}

function normalizePemSecret(value, label) {
    const normalized = normalizeMultilineSecret(value);
    if (!normalized || /-----BEGIN [^-]+-----/.test(normalized)) return normalized;

    const body = normalized.replace(/\s+/g, '');
    return wrapPemBody(body, label);
}

function wrapPemBody(body, label) {
    const lines = body.match(/.{1,64}/g) || [];
    return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----`;
}

function normalizePrivateKeySecret(value) {
    const normalized = normalizeMultilineSecret(value);
    if (!normalized || /-----BEGIN [^-]+-----/.test(normalized)) return normalized;

    const body = normalized.replace(/\s+/g, '');
    for (const label of ['PRIVATE KEY', 'RSA PRIVATE KEY']) {
        const pem = wrapPemBody(body, label);
        try {
            crypto.createPrivateKey(pem);
            return pem;
        } catch {}
    }
    return wrapPemBody(body, 'PRIVATE KEY');
}

function formatAlipayTime(value) {
    if (!value) return null;
    if (String(value).includes('T')) return value;
    return String(value).replace(' ', 'T') + '+08:00';
}

function amountYuan(amountMinor) {
    return (Number(amountMinor || 0) / 100).toFixed(2);
}

function paymentNo(localPaymentId) {
    return String(localPaymentId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
}

function refundNo(localRefundNo) {
    return String(localRefundNo).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
}

/**
 * Build the exact string Alipay signs/verifies.
 *
 * Alipay signs sorted key=value pairs, excluding `sign`, `sign_type`, and empty
 * values. Do not URL-encode this string before signing.
 */
function buildSignContent(params) {
    return Object.keys(params)
        .filter((key) => key !== 'sign' && key !== 'sign_type' && params[key] !== undefined && params[key] !== null && params[key] !== '')
        .sort()
        .map((key) => `${key}=${params[key]}`)
        .join('&');
}

function signParams(params, privateKey) {
    if (!privateKey) throw new Error('Alipay private key is required');
    return crypto.createSign('RSA-SHA256').update(buildSignContent(params), 'utf8').sign(privateKey, 'base64');
}

function verifyParams(params, publicKey) {
    if (!publicKey) return true;
    if (!params.sign) return false;
    return crypto
        .createVerify('RSA-SHA256')
        .update(buildSignContent(params), 'utf8')
        .verify(publicKey, params.sign, 'base64');
}

function pushCheck(checks, key, ok, message) {
    checks.push({ key, ok: Boolean(ok), message: ok ? undefined : message });
    return Boolean(ok);
}

function checkPrivateKey(checks, key, value) {
    if (!value) return pushCheck(checks, key, false, `${key} is required`);
    try {
        signParams({ app_id: 'app-config-test', method: 'alipay.trade.query' }, value);
        return pushCheck(checks, key, true);
    } catch (err) {
        return pushCheck(checks, key, false, `private key cannot sign: ${err.message}`);
    }
}

function checkPublicKey(checks, key, value) {
    if (!value) return pushCheck(checks, key, false, `${key} is required for callback verification`);
    try {
        crypto.createPublicKey(value);
        return pushCheck(checks, key, true);
    } catch (err) {
        return pushCheck(checks, key, false, `public key is invalid: ${err.message}`);
    }
}

/**
 * Validate Alipay config locally.
 *
 * Alipay refunds use the same RSA2 app credentials as payment. This check
 * confirms the app ID, gateway, private key signing, public key parsing, and
 * callback URLs are present before the config is saved.
 */
function validateConfig(providerRow = {}) {
    const cfg = resolveConfig(providerRow);
    const checks = [];

    pushCheck(checks, 'app_id', cfg.app_id, 'app_id is required');
    pushCheck(checks, 'gateway_url', cfg.gateway_url, 'gateway_url is required');
    pushCheck(checks, 'notify_url', cfg.notify_url, 'notify_url is required');
    pushCheck(checks, 'refund_notify_url', cfg.refund_notify_url, 'refund_notify_url is required for refund callbacks');
    const privateKeyOk = checkPrivateKey(checks, 'private_key', cfg.private_key);
    const publicKeyOk = checkPublicKey(checks, 'alipay_public_key', cfg.alipay_public_key);

    const paymentReady = checks
        .filter((check) => ['app_id', 'gateway_url', 'notify_url', 'private_key'].includes(check.key))
        .every((check) => check.ok);
    const refundSupported = paymentReady
        && checks
            .filter((check) => ['refund_notify_url', 'alipay_public_key'].includes(check.key))
            .every((check) => check.ok);

    checks.push({
        key: 'refund_capability',
        ok: refundSupported,
        message: refundSupported ? undefined : 'Refund requires app_id, gateway_url, private_key, refund_notify_url, and alipay_public_key',
    });

    return {
        valid: paymentReady && publicKeyOk,
        refund_supported: refundSupported && privateKeyOk,
        checks,
    };
}

function gatewayParams(method, bizContent, cfg, extra = {}) {
    const params = {
        app_id: cfg.app_id,
        method,
        charset: cfg.charset,
        sign_type: cfg.sign_type,
        timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
        version: cfg.version,
        biz_content: JSON.stringify(bizContent),
        ...extra,
    };
    if (cfg.notify_url) params.notify_url = cfg.notify_url;
    if (extra.return_url || cfg.return_url) params.return_url = extra.return_url || cfg.return_url;
    params.sign = signParams(params, cfg.private_key);
    return params;
}

function gatewayUrl(params, cfg) {
    return `${cfg.gateway_url}?${new URLSearchParams(params).toString()}`;
}

async function postGateway(method, bizContent, cfg, extra = {}) {
    const params = gatewayParams(method, bizContent, cfg, extra);
    const res = await fetch(cfg.gateway_url, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
            'User-Agent': 'nano-payment/1.0',
        },
        body: new URLSearchParams(params).toString(),
    });
    const text = await res.text();
    let data = {};
    if (text) {
        try { data = JSON.parse(text); } catch { data = { raw: text }; }
    }
    if (!res.ok) {
        const e = new Error(data.message || data.sub_msg || `Alipay request failed: ${res.status}`);
        e.statusCode = res.status;
        e.provider_payload = data;
        throw e;
    }
    return data;
}

function responseKey(method) {
    return `${method.replace(/\./g, '_')}_response`;
}

function extractMethodResponse(method, data) {
    return data[responseKey(method)] || data.response || data;
}

function mapPaymentStatus(status) {
    const value = String(status || '').toUpperCase();
    if (value === 'TRADE_SUCCESS' || value === 'TRADE_FINISHED') return 'paid';
    if (value === 'WAIT_BUYER_PAY') return 'pending';
    if (value === 'TRADE_CLOSED') return 'closed';
    if (value === 'FAILED') return 'failed';
    return 'pending';
}

function mapRefundStatus(response) {
    const status = String(response?.refund_status || response?.status || '').toUpperCase();
    if (status === 'REFUND_SUCCESS' || status === 'SUCCESS') return 'succeeded';
    if (status === 'REFUND_CLOSED' || status === 'CLOSED') return 'closed';
    if (status === 'FAILED') return 'failed';
    if (response?.fund_change === 'Y' || response?.refund_fee) return 'succeeded';
    return 'pending';
}

function passbackParams(input) {
    return JSON.stringify({
        payment_order_id: input.payment_order_id,
        business_order_id: input.business_order_id,
    });
}

/**
 * Create Alipay web/app/mini-program payment.
 *
 * Web and app payments return a signed order string/URL for the client, so no
 * remote request is needed. Mini-program payment uses `alipay.trade.create`
 * because the client needs an Alipay trade number to invoke tradePay.
 */
async function createPayment(input, providerRow) {
    const cfg = resolveConfig(providerRow);
    const outTradeNo = paymentNo(input.payment_order_id);
    const bizContent = {
        out_trade_no: outTradeNo,
        total_amount: amountYuan(input.amount_minor),
        subject: input.subject,
        body: input.description || undefined,
        product_code: input.scene === 'web' ? 'FAST_INSTANT_TRADE_PAY' : undefined,
        passback_params: passbackParams(input),
    };

    if (input.scene === 'web') {
        const params = gatewayParams('alipay.trade.page.pay', bizContent, cfg);
        return {
            status: 'pending',
            provider_trade_no: outTradeNo,
            provider_payload: { method: 'alipay.trade.page.pay' },
            payment_payload: { type: 'web', redirect_url: gatewayUrl(params, cfg) },
        };
    }

    if (input.scene === 'app') {
        const params = gatewayParams('alipay.trade.app.pay', {
            ...bizContent,
            product_code: 'QUICK_MSECURITY_PAY',
        }, cfg);
        return {
            status: 'pending',
            provider_trade_no: outTradeNo,
            provider_payload: { method: 'alipay.trade.app.pay' },
            payment_payload: { type: 'app', order_string: new URLSearchParams(params).toString() },
        };
    }

    if (input.scene === 'mini_program') {
        const data = await postGateway('alipay.trade.create', {
            ...bizContent,
            buyer_id: input.openid,
        }, cfg);
        const response = extractMethodResponse('alipay.trade.create', data);
        console.debug(JSON.stringify({msg: "alipay create order", data, response}))
        return {
            status: 'pending',
            provider_trade_no: response.out_trade_no || outTradeNo,
            provider_payload: response,
            payment_payload: { type: 'mini_program', trade_no: response.trade_no },
        };
    }

    if (input.scene === 'qr_code') {
        const data = await postGateway('alipay.trade.precreate', bizContent, cfg);
        const response = extractMethodResponse('alipay.trade.precreate', data);
        return {
            status: 'pending',
            provider_trade_no: response.out_trade_no || outTradeNo,
            provider_payload: response,
            payment_payload: { type: 'qr_code', qr_code_url: response.qr_code },
        };
    }

    throw new Error(`Unsupported Alipay payment scene: ${input.scene}`);
}

async function queryPayment(input, providerRow) {
    const cfg = resolveConfig(providerRow);
    const data = await postGateway('alipay.trade.query', {
        out_trade_no: input.provider_trade_no || paymentNo(input.payment_order_id),
    }, cfg);
    const response = extractMethodResponse('alipay.trade.query', data);
    return {
        status: mapPaymentStatus(response.trade_status),
        paid_at: formatAlipayTime(response.send_pay_date || response.gmt_payment),
        provider_payload: response,
    };
}

async function closePayment(input, providerRow) {
    const cfg = resolveConfig(providerRow);
    const data = await postGateway('alipay.trade.close', {
        out_trade_no: input.provider_trade_no || paymentNo(input.payment_order_id),
    }, cfg);
    return { status: 'closed', provider_payload: extractMethodResponse('alipay.trade.close', data) };
}

async function createRefund(input, providerRow) {
    const cfg = resolveConfig(providerRow);
    const data = await postGateway('alipay.trade.refund', {
        out_trade_no: input.provider_trade_no,
        out_request_no: refundNo(input.refund_no),
        refund_amount: amountYuan(input.amount_minor),
        refund_reason: input.reason || undefined,
    }, cfg);
    const response = extractMethodResponse('alipay.trade.refund', data);
    return {
        status: mapRefundStatus(response),
        provider_refund_no: response.trade_no || response.out_request_no || null,
        provider_payload: response,
        succeeded_at: formatAlipayTime(response.gmt_refund_pay),
    };
}

async function queryRefund(input, providerRow) {
    const cfg = resolveConfig(providerRow);
    const data = await postGateway('alipay.trade.fastpay.refund.query', {
        out_trade_no: input.provider_trade_no,
        out_request_no: input.refund_no || input.provider_refund_no,
    }, cfg);
    const response = extractMethodResponse('alipay.trade.fastpay.refund.query', data);
    return {
        status: mapRefundStatus(response),
        provider_payload: response,
        succeeded_at: formatAlipayTime(response.gmt_refund_pay),
    };
}

function parseFormBody(rawBody) {
    const params = {};
    for (const [key, value] of new URLSearchParams(rawBody || '').entries()) {
        params[key] = value;
    }
    return params;
}

async function verifyPaymentCallback(input, providerRow) {
    const cfg = resolveConfig(providerRow);
    const params = parseFormBody(input.rawBody);
    if (!verifyParams(params, cfg.alipay_public_key)) {
        const e = new Error('Invalid Alipay payment callback signature');
        e.statusCode = 401;
        e.code = 'PAYMENT_CALLBACK_INVALID_SIGNATURE';
        throw e;
    }
    let attach = {};
    try { attach = JSON.parse(params.passback_params || '{}'); } catch {}
    return {
        event_id: params.notify_id || params.trade_no || params.out_trade_no,
        provider_trade_no: params.out_trade_no,
        local_order_id: attach.payment_order_id || params.out_trade_no,
        status: mapPaymentStatus(params.trade_status),
        paid_at: formatAlipayTime(params.gmt_payment),
        raw: params,
    };
}

async function verifyRefundCallback(input, providerRow) {
    const cfg = resolveConfig(providerRow);
    const params = parseFormBody(input.rawBody);
    if (!verifyParams(params, cfg.alipay_public_key)) {
        const e = new Error('Invalid Alipay refund callback signature');
        e.statusCode = 401;
        e.code = 'PAYMENT_CALLBACK_INVALID_SIGNATURE';
        throw e;
    }
    return {
        event_id: params.notify_id || params.trade_no || params.out_request_no,
        provider_refund_no: params.trade_no || null,
        local_refund_no: params.out_request_no || null,
        status: mapRefundStatus(params),
        succeeded_at: formatAlipayTime(params.gmt_refund),
        raw: params,
    };
}

function paymentCallbackResponse() {
    return 'success';
}

function refundCallbackResponse() {
    return 'success';
}

module.exports = {
    provider: 'alipay',
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
        buildSignContent,
        signParams,
        verifyParams,
        validateConfig,
        gatewayParams,
        mapPaymentStatus,
        mapRefundStatus,
        parseFormBody,
    },
};
