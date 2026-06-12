'use strict';

/**
 * Payment provider adapter template.
 *
 * Copy this file when adding a new provider, for example:
 *
 *   cp template.js alipay.js
 *
 * Then:
 *
 *   1. Replace every `template` provider name with the real provider key.
 *   2. Implement the provider's signing, request, callback verification, and
 *      status mapping rules.
 *   3. Register the adapter in `src/functions/payment/lib/adapters/index.js`.
 *   4. Insert a row in `payment_providers`.
 *   5. Add provider-specific tests that mock external HTTP calls and callbacks.
 *
 * Adapter boundary:
 *
 *   The payment core (`src/functions/payment/index.js`) owns database writes,
 *   idempotency checks, route handling, and normalized state transitions.
 *
 *   The adapter owns everything provider-specific:
 *   - API endpoint paths and payload shapes;
 *   - request signatures, access tokens, certificates, or auth headers;
 *   - callback signature verification and optional decryption;
 *   - mapping provider statuses into Nano's normalized statuses;
 *   - callback success response format.
 *
 * Important invariant:
 *
 *   Never return provider-native statuses such as `TRADE_SUCCESS`, `SUCCESS`,
 *   `PROCESSING`, or `WAIT_BUYER_PAY` to the core. Always map them to the
 *   normalized statuses documented below.
 */

// Payment statuses accepted by the core:
//   created, pending, paid, expired, closed, failed,
//   refunding, refunded, partially_refunded
//
// Refund statuses accepted by the core:
//   created, pending, succeeded, failed, closed

const DEFAULT_BASE_URL = 'https://provider.example.com';

/**
 * Resolve one provider account configuration from the database row.
 *
 * Input:
 * - `providerRow.id`: local `payment_providers.id`
 * - `providerRow.merchant_id`: merchant/account identifier used by provider
 * - `providerRow.institution_id`: NULL for admin default, value for institution override
 * - `providerRow.scope`: `admin` or `institution`
 * - `providerRow.config`: JSONB config, including provider credentials
 * - `providerRow.secret_ref`: optional KMS/ops reference, not an env fallback
 *
 * The payment core selects an institution-specific row first and falls back to
 * the admin default row. Adapters should use only this row and must not read
 * provider secrets from process.env.
 *
 * Do not log the returned object directly. It may contain private keys or API
 * secrets. Log only non-sensitive identifiers such as provider, merchant_id,
 * local payment_order_id, and provider transaction IDs.
 */
function resolveConfig(providerRow = {}) {
    const cfg = providerRow.config || {};
    return {
        provider_account_id: providerRow.id,
        institution_id: providerRow.institution_id || null,
        scope: providerRow.scope || 'admin',
        merchant_id: providerRow.merchant_id || cfg.merchant_id,
        app_id: cfg.app_id,
        api_base_url: String(cfg.api_base_url || DEFAULT_BASE_URL).replace(/\/+$/, ''),

        // Replace these with the provider's real config fields. These values
        // come from `payment_providers.config`.
        private_key: normalizeMultilineSecret(cfg.private_key),
        public_key: normalizeMultilineSecret(cfg.public_key),
        api_secret: cfg.api_secret,

        notify_url: cfg.notify_url,
        refund_notify_url: cfg.refund_notify_url,
    };
}

/**
 * Database JSON may store PEM values with escaped newlines.
 * Convert `\n` back to real newlines before passing keys to crypto libraries.
 */
function normalizeMultilineSecret(value) {
    if (!value) return value;
    return String(value).replace(/\\n/g, '\n');
}

/**
 * Create a provider-safe merchant payment number from the local payment ID.
 *
 * Providers usually limit allowed characters and length. Keep the local
 * `payment_orders.id` as Nano's canonical identifier, then derive a provider
 * order number that can be round-tripped through callbacks and queries.
 *
 * For providers with stricter requirements, change this function, but keep it
 * deterministic. A retry must produce the same provider order number for the
 * same local payment order.
 */
function providerPaymentNo(localPaymentId) {
    return String(localPaymentId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
}

/**
 * Convert provider payment statuses into Nano's normalized payment statuses.
 *
 * This function is one of the most important parts of an adapter. The core
 * state machine is intentionally small; all provider-specific words should be
 * handled here.
 */
function mapPaymentStatus(providerStatus) {
    const status = String(providerStatus || '').toUpperCase();

    // Replace these examples with provider-specific values.
    if (status === 'SUCCESS' || status === 'TRADE_SUCCESS') return 'paid';
    if (status === 'WAIT_BUYER_PAY' || status === 'PROCESSING' || status === 'PENDING') return 'pending';
    if (status === 'CLOSED' || status === 'TRADE_CLOSED') return 'closed';
    if (status === 'EXPIRED') return 'expired';
    if (status === 'FAILED' || status === 'PAYERROR') return 'failed';
    if (status === 'REFUNDING') return 'refunding';

    // Unknown non-terminal states should usually be treated as pending, then
    // logged through provider_payload for diagnosis.
    return 'pending';
}

/**
 * Convert provider refund statuses into Nano's normalized refund statuses.
 */
function mapRefundStatus(providerStatus) {
    const status = String(providerStatus || '').toUpperCase();

    if (status === 'SUCCESS' || status === 'REFUND_SUCCESS') return 'succeeded';
    if (status === 'PROCESSING' || status === 'PENDING') return 'pending';
    if (status === 'FAILED' || status === 'REFUND_FAILED') return 'failed';
    if (status === 'CLOSED' || status === 'REFUND_CLOSED') return 'closed';

    return 'pending';
}

/**
 * Build provider request authentication.
 *
 * Common provider patterns:
 * - RSA signature over sorted request parameters;
 * - HMAC over method/path/body/timestamp;
 * - OAuth access token plus request body signature;
 * - mTLS certificate authentication.
 *
 * Critical rule:
 *   Sign exactly the bytes or key-value string the provider expects. Do not
 *   JSON.stringify twice, reorder fields after signing, or parse/stringify a
 *   callback body before verification.
 */
function buildAuthorizationHeader(method, path, bodyText, cfg) {
    // Replace this with the provider's real auth scheme.
    void method;
    void path;
    void bodyText;
    void cfg;
    return 'Bearer replace-with-provider-token-or-signature';
}

/**
 * Send one provider request and return parsed provider JSON.
 *
 * Keep external HTTP isolated in this helper so timeouts, headers, error
 * payload capture, and logging policy are consistent across adapter methods.
 */
async function requestJson(method, path, payload, cfg) {
    const bodyText = payload ? JSON.stringify(payload) : '';
    const res = await fetch(`${cfg.api_base_url}${path}`, {
        method,
        headers: {
            Authorization: buildAuthorizationHeader(method, path, bodyText, cfg),
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'nano-payment/1.0',
        },
        body: bodyText || undefined,
    });

    const text = await res.text();
    let data = {};
    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            data = { raw: text };
        }
    }

    if (!res.ok) {
        const err = new Error(data.message || data.error || `Provider request failed: ${res.status}`);
        err.statusCode = res.status;
        err.provider_payload = data;
        throw err;
    }

    return data;
}

/**
 * Create a payment order at the provider.
 *
 * Called by `POST /payment/orders` after the local `payment_orders` row has
 * already been inserted. Return enough information for the core to update that
 * row and for the client to continue checkout.
 *
 * Required normalized return fields:
 * - `status`: usually `pending`;
 * - `provider_trade_no`: provider or merchant order number used for callbacks;
 * - `provider_payload`: raw provider response for audit/debugging;
 * - `payment_payload`: scene-specific client data.
 */
async function createPayment(input, providerRow) {
    const cfg = resolveConfig(providerRow);
    const outTradeNo = providerPaymentNo(input.payment_order_id);

    const commonPayload = {
        merchant_id: cfg.merchant_id,
        out_trade_no: outTradeNo,
        subject: input.subject,
        description: input.description,
        notify_url: cfg.notify_url,
        amount: input.amount_minor,
        currency: input.currency || 'CNY',

        // Attach local IDs if the provider supports custom metadata. This is
        // the easiest way to match callbacks without extra DB lookups.
        metadata: {
            payment_order_id: input.payment_order_id,
            business_order_id: input.business_order_id,
        },
    };

    if (input.scene === 'mini_program') {
        const data = await requestJson('POST', '/payments/mini-program', {
            ...commonPayload,
            payer_id: input.openid,
        }, cfg);

        return {
            status: mapPaymentStatus(data.status || 'PENDING'),
            provider_trade_no: data.trade_no || outTradeNo,
            provider_payload: data,
            payment_payload: {
                type: 'mini_program',

                // Replace with provider-specific fields consumed by the
                // mini-program SDK, e.g. prepay_id/signature/nonce/timestamp.
                token: data.client_token,
            },
        };
    }

    if (input.scene === 'app') {
        const data = await requestJson('POST', '/payments/app', commonPayload, cfg);
        return {
            status: mapPaymentStatus(data.status || 'PENDING'),
            provider_trade_no: data.trade_no || outTradeNo,
            provider_payload: data,
            payment_payload: {
                type: 'app',

                // Replace with provider SDK payload for iOS/Android.
                sdk_payload: data.sdk_payload,
            },
        };
    }

    if (input.scene === 'web') {
        const data = await requestJson('POST', '/payments/web', {
            ...commonPayload,
            client_ip: input.client_ip,
        }, cfg);
        return {
            status: mapPaymentStatus(data.status || 'PENDING'),
            provider_trade_no: data.trade_no || outTradeNo,
            provider_payload: data,
            payment_payload: {
                type: 'web',

                // Typical web outputs are redirect URL, QR code URL, or
                // hosted-checkout token. Use whichever the provider returns.
                redirect_url: data.redirect_url,
                qr_code_url: data.qr_code_url,
            },
        };
    }

    throw new Error(`Unsupported payment scene for template adapter: ${input.scene}`);
}

/**
 * Query payment status from the provider.
 *
 * Called by `GET /payment/orders/:id?sync_provider=true`. Do not use this as
 * the only source of truth for normal checkout; provider callbacks remain the
 * primary asynchronous update path.
 */
async function queryPayment(input, providerRow) {
    const cfg = resolveConfig(providerRow);
    const tradeNo = encodeURIComponent(input.provider_trade_no || providerPaymentNo(input.payment_order_id));
    const data = await requestJson('GET', `/payments/${tradeNo}`, null, cfg);

    return {
        status: mapPaymentStatus(data.status),
        paid_at: data.paid_at || null,
        provider_payload: data,
    };
}

/**
 * Close/cancel a pending provider payment order.
 *
 * This is useful when a user abandons checkout and needs a fresh provider order
 * for the same business order.
 */
async function closePayment(input, providerRow) {
    const cfg = resolveConfig(providerRow);
    const tradeNo = encodeURIComponent(input.provider_trade_no || providerPaymentNo(input.payment_order_id));
    const data = await requestJson('POST', `/payments/${tradeNo}/close`, {}, cfg);

    return {
        status: 'closed',
        provider_payload: data,
    };
}

/**
 * Create a provider refund.
 *
 * Called after the core has locked the payment row and checked refundable
 * balance. The adapter should not create a second refund if the provider has an
 * idempotent refund number concept; use `input.refund_no` as that number.
 */
async function createRefund(input, providerRow) {
    const cfg = resolveConfig(providerRow);
    const data = await requestJson('POST', '/refunds', {
        merchant_id: cfg.merchant_id,
        out_trade_no: input.provider_trade_no,
        out_refund_no: input.refund_no,
        refund_amount: input.amount_minor,
        total_amount: input.total_amount_minor,
        currency: input.currency || 'CNY',
        reason: input.reason,
        notify_url: cfg.refund_notify_url,
    }, cfg);

    return {
        status: mapRefundStatus(data.status),
        provider_refund_no: data.refund_no || data.provider_refund_no || null,
        provider_payload: data,
        succeeded_at: data.succeeded_at || null,
    };
}

/**
 * Query refund status from the provider.
 *
 * This method powers both manual admin polling and timer-triggered refund cron.
 * It must be safe to call repeatedly for the same refund.
 */
async function queryRefund(input, providerRow) {
    const cfg = resolveConfig(providerRow);
    const refundNo = encodeURIComponent(input.provider_refund_no || input.refund_no);
    const data = await requestJson('GET', `/refunds/${refundNo}`, null, cfg);

    return {
        status: mapRefundStatus(data.status),
        provider_payload: data,
        succeeded_at: data.succeeded_at || null,
    };
}

/**
 * Verify provider callback signature.
 *
 * This is security-critical. Use the exact raw body passed by the FC handler.
 * Never verify a parsed and re-serialized JSON body unless the provider
 * explicitly defines that as the signature input.
 */
function verifyCallbackSignature(headers, rawBody, cfg) {
    void headers;
    void rawBody;
    void cfg;

    // Implement provider-specific HMAC/RSA/certificate verification here.
    // Return false on missing headers, stale timestamps, mismatched signatures,
    // unknown certificates, or malformed callback envelopes.
    return false;
}

/**
 * Parse and optionally decrypt a provider callback.
 *
 * Many providers wrap the business payload in an encrypted `resource` field.
 * Decrypt here, after signature verification, and return plain provider data
 * for status mapping.
 */
function parseCallbackBody(rawBody, cfg) {
    void cfg;
    return JSON.parse(rawBody || '{}');
}

/**
 * Verify and normalize a payment callback.
 *
 * Required normalized return fields:
 * - `event_id`: stable provider event ID if available, used for callback
 *   deduplication in `payment_callback_events`;
 * - `provider_trade_no`: provider/merchant payment number;
 * - `local_order_id`: Nano `payment_orders.id` if the provider callback
 *   includes metadata/attach;
 * - `status`: normalized payment status;
 * - `paid_at`: provider payment success time when available;
 * - `raw`: decrypted provider payload for audit.
 */
async function verifyPaymentCallback(input, providerRow) {
    const cfg = resolveConfig(providerRow);
    if (!verifyCallbackSignature(input.headers, input.rawBody, cfg)) {
        const err = new Error('Invalid provider payment callback signature');
        err.statusCode = 401;
        err.code = 'PAYMENT_CALLBACK_INVALID_SIGNATURE';
        throw err;
    }

    const payload = parseCallbackBody(input.rawBody, cfg);

    return {
        event_id: payload.event_id || payload.id || payload.transaction_id,
        provider_trade_no: payload.out_trade_no || payload.trade_no,
        local_order_id: payload.metadata?.payment_order_id || null,
        status: mapPaymentStatus(payload.status),
        paid_at: payload.paid_at || payload.success_time || null,
        raw: payload,
    };
}

/**
 * Verify and normalize a refund callback.
 *
 * Required normalized return fields:
 * - `event_id`: stable provider event ID if available;
 * - `provider_refund_no`: provider refund ID if available;
 * - `local_refund_id`: Nano `payment_refunds.id` if the provider returns it;
 * - `local_refund_no`: Nano merchant refund number if the provider returns it;
 * - `status`: normalized refund status;
 * - `succeeded_at`: provider refund success time when available;
 * - `raw`: decrypted provider payload for audit.
 */
async function verifyRefundCallback(input, providerRow) {
    const cfg = resolveConfig(providerRow);
    if (!verifyCallbackSignature(input.headers, input.rawBody, cfg)) {
        const err = new Error('Invalid provider refund callback signature');
        err.statusCode = 401;
        err.code = 'PAYMENT_CALLBACK_INVALID_SIGNATURE';
        throw err;
    }

    const payload = parseCallbackBody(input.rawBody, cfg);

    return {
        event_id: payload.event_id || payload.id || payload.refund_event_id,
        provider_refund_no: payload.provider_refund_no || payload.refund_no || null,
        local_refund_id: payload.metadata?.refund_id || null,
        local_refund_no: payload.out_refund_no || null,
        status: mapRefundStatus(payload.status),
        succeeded_at: payload.succeeded_at || payload.success_time || null,
        raw: payload,
    };
}

/**
 * Validate a submitted provider config before saving it.
 *
 * This method powers `POST /payment/providers/test`. It must not create a real
 * payment or refund. Use it for local-only checks:
 * - required provider fields are present;
 * - private keys can sign a test string;
 * - public keys/certificates can be parsed;
 * - callback verification material exists;
 * - refund APIs have the signing/config fields they need.
 */
function validateConfig(providerRow = {}) {
    const cfg = resolveConfig(providerRow);
    const checks = [
        { key: 'merchant_id', ok: Boolean(cfg.merchant_id), message: cfg.merchant_id ? undefined : 'merchant_id is required' },
        { key: 'app_id', ok: Boolean(cfg.app_id), message: cfg.app_id ? undefined : 'app_id is required' },
        { key: 'private_key', ok: Boolean(cfg.private_key), message: cfg.private_key ? undefined : 'private_key is required' },
        { key: 'public_key', ok: Boolean(cfg.public_key), message: cfg.public_key ? undefined : 'public_key is required for callback verification' },
        { key: 'refund_notify_url', ok: Boolean(cfg.refund_notify_url), message: cfg.refund_notify_url ? undefined : 'refund_notify_url is required for refund callbacks' },
    ];
    const valid = checks.filter((check) => ['merchant_id', 'app_id', 'private_key', 'public_key'].includes(check.key)).every((check) => check.ok);
    const refundSupported = valid && checks.find((check) => check.key === 'refund_notify_url')?.ok;
    checks.push({ key: 'refund_capability', ok: refundSupported, message: refundSupported ? undefined : 'Refund config is incomplete' });
    return { valid, refund_supported: refundSupported, checks };
}

/**
 * Provider-specific success response for payment callbacks.
 *
 * Some providers expect XML, plaintext, or a very specific JSON body. Return
 * the exact acknowledgement body here. The core wraps it in HTTP 200.
 */
function paymentCallbackResponse() {
    return { code: 'SUCCESS', message: 'OK' };
}

/**
 * Provider-specific success response for refund callbacks.
 */
function refundCallbackResponse() {
    return { code: 'SUCCESS', message: 'OK' };
}

module.exports = {
    // Change this to the provider key used in API requests and DB rows.
    provider: 'template',

    createPayment,
    queryPayment,
    closePayment,
    createRefund,
    queryRefund,
    verifyPaymentCallback,
    verifyRefundCallback,
    validateConfig,
    paymentCallbackResponse,
    refundCallbackResponse,

    // Export helpers only for unit tests. Production code should go through the
    // adapter methods above.
    __private: {
        resolveConfig,
        providerPaymentNo,
        mapPaymentStatus,
        mapRefundStatus,
        buildAuthorizationHeader,
        verifyCallbackSignature,
        parseCallbackBody,
        validateConfig,
    },
};
