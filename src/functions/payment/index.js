'use strict';

/**
 * nano-payment FC 3.0 handler.
 *
 * Responsibilities:
 * - expose the provider-neutral HTTP API used by Nano clients/admin tools;
 * - keep payment/refund state in Postgres before and after provider calls;
 * - route provider callbacks through adapter verification before state changes;
 * - run timer-triggered refund reconciliation for providers that complete
 *   refunds asynchronously.
 *
 * Provider-specific request signing, callback formats, and native status names
 * belong in `lib/adapters/*`. This file should only deal with normalized
 * payment/refund states.
 */
const db = require('./lib/db');
const { getAdapter } = require('./lib/adapters');

let adapterFactory = getAdapter;

function json(statusCode, payload) {
    return {
        statusCode,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        isBase64Encoded: false,
    };
}

function callbackAck(payload) {
    if (typeof payload === 'string') {
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            body: payload,
            isBase64Encoded: false,
        };
    }
    return json(200, payload);
}

function ok(data) {
    return json(200, { success: true, data, error: null });
}

function error(statusCode, code, message) {
    return json(statusCode, { success: false, data: null, error: { code, message } });
}

function sanitizeLogValue(value) {
    if (Array.isArray(value)) return value.map(sanitizeLogValue);
    if (!value || typeof value !== 'object') return value;
    const redacted = {};
    for (const [key, item] of Object.entries(value)) {
        redacted[key] = /(secret|token|key|cert|password|signature|authorization|sign)/i.test(key)
            ? '[REDACTED]'
            : sanitizeLogValue(item);
    }
    return redacted;
}

function providerFailurePayload(err, operation) {
    return {
        operation,
        error: err.message,
        code: err.code || null,
        status_code: err.statusCode || null,
        provider_payload: sanitizeLogValue(err.provider_payload || {}),
    };
}

function logProviderFailure(context, err, payload) {
    console.error(JSON.stringify({
        level: 'ERROR',
        msg: 'Payment provider call failed',
        provider: context.provider,
        operation: context.operation,
        provider_account_id: context.provider_account_id || null,
        payment_order_id: context.payment_order_id || null,
        refund_id: context.refund_id || null,
        business_order_id: context.business_order_id || null,
        scene: context.scene || null,
        status_code: err.statusCode || null,
        code: err.code || null,
        error: err.message,
        provider_payload: payload.provider_payload,
    }));
}

function parseJson(rawBody) {
    if (!rawBody) return {};
    try {
        return JSON.parse(rawBody);
    } catch (err) {
        const e = new Error('Invalid JSON request body');
        e.statusCode = 400;
        e.code = 'PAYMENT_INVALID_REQUEST';
        throw e;
    }
}

/**
 * Normalize Aliyun FC 3.0 HTTP and timer invocations.
 *
 * HTTP triggers arrive as parsed event objects. Timer triggers commonly arrive
 * as empty Buffers, so empty/unparseable Buffers are tagged with `__timerEvent`
 * and routed to refund polling instead of HTTP routing.
 */
function decodeFcEvent(req) {
    if (!Buffer.isBuffer(req)) return req || {};
    const text = req.toString('utf8');
    if (!text.trim()) return { __timerEvent: true };
    try {
        return JSON.parse(text);
    } catch {
        return { __timerEvent: true, payload: text };
    }
}

function isTimerEvent(event) {
    return Boolean(event?.__timerEvent || (event && !event.rawPath && !event.requestContext?.http));
}

function rawBodyFromEvent(event) {
    let rawBody = event.body || '';
    if (event.isBase64Encoded && rawBody) rawBody = Buffer.from(rawBody, 'base64').toString('utf8');
    return rawBody;
}

/**
 * Public API amount guard.
 *
 * All provider calls use minor units, e.g. cents for CNY. Keeping this as an
 * integer avoids floating-point money bugs and matches WeChat Pay v3 payloads.
 */
function requirePositiveAmount(amount) {
    if (!Number.isInteger(amount) || amount <= 0) {
        const e = new Error('amount_minor must be a positive integer');
        e.statusCode = 400;
        e.code = 'PAYMENT_INVALID_REQUEST';
        throw e;
    }
}

/**
 * Shape database rows into the stable client response contract.
 *
 * The database stores provider payloads and operational fields that should not
 * leak into client responses by default.
 */
function paymentOrderPayload(row) {
    if (!row) return null;
    return {
        id: row.id,
        business_order_id: row.business_order_id,
        provider: row.provider,
        scene: row.scene,
        currency: row.currency,
        amount_minor: Number(row.amount_minor),
        status: row.status,
        provider_trade_no: row.provider_trade_no || undefined,
        paid_at: row.paid_at || undefined,
        refunded_amount_minor: row.refunded_amount_minor === undefined ? undefined : Number(row.refunded_amount_minor),
    };
}

function refundPayload(row) {
    if (!row) return null;
    return {
        id: row.id,
        payment_order_id: row.payment_order_id,
        amount_minor: Number(row.amount_minor),
        status: row.status,
        provider_refund_no: row.provider_refund_no || undefined,
        last_polled_at: row.last_polled_at || undefined,
        succeeded_at: row.succeeded_at || undefined,
    };
}

async function loadProvider(provider, providerAccountId = null, institutionId = null) {
    const result = providerAccountId
        ? await db.query(
            `SELECT id, provider, merchant_id, institution_id, scope, config, secret_ref
             FROM payment_providers
             WHERE id = $1 AND is_active = TRUE
             LIMIT 1`,
            [providerAccountId]
        )
        : institutionId
            ? await db.query(
                `SELECT id, provider, merchant_id, institution_id, scope, config, secret_ref
                 FROM payment_providers
                 WHERE provider = $1
                   AND is_active = TRUE
                   AND (institution_id = $2 OR institution_id IS NULL)
                 ORDER BY CASE WHEN institution_id = $2 THEN 0 ELSE 1 END, created_at ASC
                 LIMIT 1`,
                [provider, institutionId]
            )
        : await db.query(
            `SELECT id, provider, merchant_id, institution_id, scope, config, secret_ref
             FROM payment_providers
             WHERE provider = $1 AND is_active = TRUE AND institution_id IS NULL
             ORDER BY created_at ASC
             LIMIT 1`,
            [provider]
        );
    if (!result.rows.length) {
        const e = new Error(`No active payment provider: ${providerAccountId || provider}`);
        e.statusCode = 404;
        e.code = 'PAYMENT_NOT_FOUND';
        throw e;
    }
    return result.rows[0];
}

/**
 * Create one payment attempt for a business order.
 *
 * Idempotency is enforced before the provider request. A retry with the same
 * business order and idempotency key returns the already-created local record
 * instead of creating a second provider order.
 */
async function handleCreatePayment(body, headers = {}) {
    const provider = body.provider || 'wecom';
    const scene = body.scene;
    const currency = body.currency || 'CNY';
    const idempotencyKey = headers['idempotency-key'] || headers['Idempotency-Key'] || body.idempotency_key;

    if (!body.business_order_id || !body.user_id || !scene || !body.subject) {
        return error(400, 'PAYMENT_INVALID_REQUEST', 'business_order_id, user_id, scene and subject are required');
    }
    if (!idempotencyKey) return error(400, 'PAYMENT_INVALID_REQUEST', 'Idempotency-Key is required');
    requirePositiveAmount(body.amount_minor);

    const providerRow = await loadProvider(provider, null, body.institution_id || null);
    // The idempotency key is scoped to the business order, not just the HTTP
    // request, so clients can safely retry after network timeouts.
    const existing = await db.query(
        `SELECT *
         FROM payment_orders
         WHERE business_order_id = $1 AND idempotency_key = $2
         LIMIT 1`,
        [body.business_order_id, idempotencyKey]
    );
    if (existing.rows.length) {
        return ok({ payment_order: paymentOrderPayload(existing.rows[0]), payment_payload: existing.rows[0].payment_payload || null });
    }

    const inserted = await db.query(
        `INSERT INTO payment_orders
           (business_order_id, user_id, provider, provider_account_id, scene, currency,
            amount_minor, subject, description, status, client_ip, idempotency_key,
            expires_at, provider_payload, payment_payload, institution_id)
         VALUES
           ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'created', $10, $11,
            NOW() + (($12 || ' seconds')::interval), '{}'::jsonb, '{}'::jsonb, $13)
         RETURNING *`,
        [
            body.business_order_id,
            body.user_id,
            provider,
            providerRow.id,
            scene,
            currency,
            body.amount_minor,
            body.subject,
            body.description || null,
            body.client_ip || null,
            idempotencyKey,
            body.expires_in_seconds || 1800,
            body.institution_id || null,
        ]
    );
    const paymentOrder = inserted.rows[0];
    const adapter = adapterFactory(provider);
    // From this point on, provider-specific fields are delegated to the adapter.
    // The core only stores normalized status and opaque provider/client payloads.
    let adapterResult;
    try {
        adapterResult = await adapter.createPayment({
            payment_order_id: paymentOrder.id,
            business_order_id: body.business_order_id,
            user_id: body.user_id,
            provider,
            scene,
            currency,
            amount_minor: body.amount_minor,
            subject: body.subject,
            description: body.description || '',
            openid: body.openid,
            client_ip: body.client_ip,
            institution_id: body.institution_id || null,
            expires_at: paymentOrder.expires_at,
            metadata: body.metadata || {},
        }, providerRow);
    } catch (err) {
        const payload = providerFailurePayload(err, 'create_payment');
        logProviderFailure({
            provider,
            operation: 'create_payment',
            provider_account_id: providerRow.id,
            payment_order_id: paymentOrder.id,
            business_order_id: body.business_order_id,
            scene,
        }, err, payload);
        await db.query(
            `UPDATE payment_orders
             SET status = 'failed',
                 provider_payload = $2::jsonb,
                 updated_at = NOW()
             WHERE id = $1`,
            [paymentOrder.id, JSON.stringify(payload)]
        );
        err.statusCode = err.statusCode || 502;
        err.code = err.code || 'PAYMENT_PROVIDER_ERROR';
        throw err;
    }

    const updated = await db.query(
        `UPDATE payment_orders
         SET status = $2,
             provider_trade_no = $3,
             provider_payload = $4::jsonb,
             payment_payload = $5::jsonb,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [
            paymentOrder.id,
            adapterResult.status,
            adapterResult.provider_trade_no || null,
            JSON.stringify(adapterResult.provider_payload || {}),
            JSON.stringify(adapterResult.payment_payload || {}),
        ]
    );

    return ok({
        payment_order: paymentOrderPayload(updated.rows[0]),
        payment_payload: adapterResult.payment_payload || null,
    });
}

/**
 * Validate a submitted provider config before saving it.
 *
 * Default behavior is local-only validation. Admin tools can opt in to provider
 * calls with `test_payment=true` or `test_refund=true` when they need to prove
 * credentials can actually create a provider order or refund a known paid test
 * transaction. Refund testing is intentionally guarded by `allow_real_refund`
 * because it can move real money at the provider.
 */
async function handleTestProviderConfig(body) {
    const provider = body.provider;
    if (!provider || !body.merchant_id || !body.config) {
        return error(400, 'PAYMENT_INVALID_REQUEST', 'provider, merchant_id and config are required');
    }

    const adapter = adapterFactory(provider);
    const providerRow = {
        id: body.id || 'config-test',
        provider,
        merchant_id: body.merchant_id,
        institution_id: body.institution_id || null,
        scope: body.institution_id ? 'institution' : 'admin',
        label: body.label || null,
        config: body.config,
        secret_ref: body.secret_ref || null,
        is_active: true,
    };

    const result = adapter.validateConfig
        ? adapter.validateConfig(providerRow)
        : {
            valid: false,
            refund_supported: false,
            checks: [{ key: 'adapter.validateConfig', ok: false, message: 'Adapter does not implement config validation' }],
        };

    const response = {
        provider,
        valid: Boolean(result.valid),
        refund_supported: Boolean(result.refund_supported),
        checks: result.checks || [],
    };

    if (body.test_payment === true) {
        response.payment_test = await runProviderPaymentTest(body, provider, providerRow, adapter);
    }

    if (body.test_refund === true) {
        const refundValidationError = validateRefundTestRequest(body);
        if (refundValidationError) return refundValidationError;
        response.refund_test = await runProviderRefundTest(body, providerRow, adapter);
    }

    return ok(response);
}

async function runProviderPaymentTest(body, provider, providerRow, adapter) {
    if (!adapter.createPayment) {
        return { attempted: true, ok: false, error: 'Adapter does not implement createPayment' };
    }

    try {
        // This creates a provider-side unpaid test order only. The local
        // database is not written, and no customer is charged without the
        // returned payload being actively paid by a client.
        const result = await adapter.createPayment({
            payment_order_id: body.test_payment_order_id || `cfgpay_${Date.now()}`,
            business_order_id: body.business_order_id || 'config-test',
            user_id: body.user_id || 'config-test',
            provider,
            scene: body.scene || 'mini_program',
            currency: body.currency || 'CNY',
            amount_minor: body.amount_minor || 1,
            subject: body.subject || 'Nano payment config test',
            description: body.description || 'Payment provider config test',
            openid: body.openid,
            client_ip: body.client_ip,
            institution_id: body.institution_id || null,
            metadata: { ...(body.metadata || {}), config_test: true },
        }, providerRow);

        return {
            attempted: true,
            ok: true,
            status: result.status || null,
            provider_trade_no: result.provider_trade_no || null,
            payment_payload_type: result.payment_payload?.type || null,
            payment_payload: result.payment_payload || null,
        };
    } catch (err) {
        const payload = providerFailurePayload(err, 'test_payment');
        logProviderFailure({
            provider,
            operation: 'test_payment',
            provider_account_id: providerRow.id,
            scene: body.scene || 'mini_program',
        }, err, payload);
        return { attempted: true, ok: false, error: err.message };
    }
}

function validateRefundTestRequest(body) {
    if (body.allow_real_refund !== true) {
        return error(400, 'PAYMENT_INVALID_REQUEST', 'test_refund requires allow_real_refund=true because it may issue a real refund');
    }

    const refundTest = body.refund_test || {};
    if (!refundTest.provider_trade_no) {
        return error(400, 'PAYMENT_INVALID_REQUEST', 'refund_test.provider_trade_no is required');
    }
    if (!Number.isInteger(refundTest.amount_minor) || refundTest.amount_minor <= 0) {
        return error(400, 'PAYMENT_INVALID_REQUEST', 'refund_test.amount_minor must be a positive integer');
    }
    if (refundTest.total_amount_minor !== undefined && (!Number.isInteger(refundTest.total_amount_minor) || refundTest.total_amount_minor <= 0)) {
        return error(400, 'PAYMENT_INVALID_REQUEST', 'refund_test.total_amount_minor must be a positive integer');
    }
    return null;
}

async function runProviderRefundTest(body, providerRow, adapter) {
    if (!adapter.createRefund) {
        return { attempted: true, ok: false, error: 'Adapter does not implement createRefund' };
    }

    const refundTest = body.refund_test;
    try {
        // This can issue a real refund at the provider, so all transaction
        // identifiers and amount are supplied explicitly by the admin caller.
        const result = await adapter.createRefund({
            refund_id: refundTest.refund_id || `cfgrefund_${Date.now()}`,
            payment_order_id: refundTest.payment_order_id || 'config-test',
            business_order_id: refundTest.business_order_id || 'config-test',
            provider_trade_no: refundTest.provider_trade_no,
            refund_no: refundTest.refund_no || `cfg_rf_${Date.now()}`,
            amount_minor: refundTest.amount_minor,
            total_amount_minor: refundTest.total_amount_minor || refundTest.amount_minor,
            currency: refundTest.currency || body.currency || 'CNY',
            reason: refundTest.reason || 'payment_config_refund_test',
        }, providerRow);

        return {
            attempted: true,
            ok: true,
            status: result.status || null,
            provider_refund_no: result.provider_refund_no || null,
        };
    } catch (err) {
        const payload = providerFailurePayload(err, 'test_refund');
        logProviderFailure({
            provider: providerRow.provider,
            operation: 'test_refund',
            provider_account_id: providerRow.id,
        }, err, payload);
        return { attempted: true, ok: false, error: err.message };
    }
}

/**
 * Return payment status, optionally reconciling with the provider first.
 *
 * Provider sync is opt-in because it adds latency and external dependency risk.
 * Callback processing remains the normal asynchronous source of truth.
 */
async function handleGetPayment(id, query = {}) {
    const result = await db.query('SELECT * FROM payment_orders WHERE id = $1 LIMIT 1', [id]);
    if (!result.rows.length) return error(404, 'PAYMENT_NOT_FOUND', 'Payment order not found');

    let row = result.rows[0];
    if (query.sync_provider === 'true' && !['paid', 'expired', 'closed', 'failed', 'refunded'].includes(row.status)) {
        const providerRow = await loadProvider(row.provider, row.provider_account_id);
        const adapter = adapterFactory(row.provider);
        const providerResult = await adapter.queryPayment({
            payment_order_id: row.id,
            provider_trade_no: row.provider_trade_no,
            business_order_id: row.business_order_id,
        }, providerRow);
        const updated = await db.query(
            `UPDATE payment_orders
             SET status = $2, provider_payload = $3::jsonb, paid_at = COALESCE($4::timestamptz, paid_at), updated_at = NOW()
             WHERE id = $1
             RETURNING *`,
            [row.id, providerResult.status, JSON.stringify(providerResult.provider_payload || {}), providerResult.paid_at || null]
        );
        row = updated.rows[0];
    }

    return ok({ payment_order: paymentOrderPayload(row) });
}

async function handleGetPaymentByBusiness(businessOrderId) {
    const result = await db.query(
        `SELECT *
         FROM payment_orders
         WHERE business_order_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [businessOrderId]
    );
    if (!result.rows.length) return error(404, 'PAYMENT_NOT_FOUND', 'Payment order not found');
    return ok({ payment_order: paymentOrderPayload(result.rows[0]) });
}

async function handleCreateRefund(body, headers = {}) {
    const idempotencyKey = headers['idempotency-key'] || headers['Idempotency-Key'] || body.idempotency_key;
    if (!body.payment_order_id) return error(400, 'PAYMENT_INVALID_REQUEST', 'payment_order_id is required');
    if (!idempotencyKey) return error(400, 'PAYMENT_INVALID_REQUEST', 'Idempotency-Key is required');
    requirePositiveAmount(body.amount_minor);

    const paymentRes = await db.query(
        `SELECT *, COALESCE((
             SELECT SUM(amount_minor)
             FROM payment_refunds
             WHERE payment_order_id = payment_orders.id
               AND status IN ('created', 'pending', 'succeeded')
         ), 0) AS refunded_amount_minor
         FROM payment_orders
         WHERE id = $1
         FOR UPDATE`,
        [body.payment_order_id]
    );
    if (!paymentRes.rows.length) return error(404, 'PAYMENT_NOT_FOUND', 'Payment order not found');
    const paymentOrder = paymentRes.rows[0];
    if (!['paid', 'partially_refunded', 'refunding'].includes(paymentOrder.status)) {
        return error(409, 'PAYMENT_CONFLICT', `Payment order is not refundable from status ${paymentOrder.status}`);
    }
    const alreadyRefunding = Number(paymentOrder.refunded_amount_minor || 0);
    // Count pending refunds as already reserved money. This prevents duplicate
    // refund requests from exceeding the captured payment amount.
    if (alreadyRefunding + body.amount_minor > Number(paymentOrder.amount_minor)) {
        return error(409, 'PAYMENT_CONFLICT', 'Refund amount exceeds refundable balance');
    }

    const providerRow = await loadProvider(paymentOrder.provider, paymentOrder.provider_account_id);
    const refundNo = body.refund_no || `rf_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
    const inserted = await db.query(
        `INSERT INTO payment_refunds
           (payment_order_id, business_order_id, provider, provider_account_id, refund_no,
            amount_minor, reason, status, idempotency_key, provider_payload, next_poll_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'created', $8, '{}'::jsonb, NOW())
         RETURNING *`,
        [
            paymentOrder.id,
            paymentOrder.business_order_id,
            paymentOrder.provider,
            paymentOrder.provider_account_id,
            refundNo,
            body.amount_minor,
            body.reason || null,
            idempotencyKey,
        ]
    );
    const refund = inserted.rows[0];
    const adapter = adapterFactory(paymentOrder.provider);
    let adapterResult;
    try {
        adapterResult = await adapter.createRefund({
            refund_id: refund.id,
            payment_order_id: paymentOrder.id,
            business_order_id: paymentOrder.business_order_id,
            provider_trade_no: paymentOrder.provider_trade_no,
            refund_no: refundNo,
            amount_minor: body.amount_minor,
            total_amount_minor: Number(paymentOrder.amount_minor),
            currency: paymentOrder.currency || 'CNY',
            reason: body.reason || '',
        }, providerRow);
    } catch (err) {
        const payload = providerFailurePayload(err, 'create_refund');
        logProviderFailure({
            provider: paymentOrder.provider,
            operation: 'create_refund',
            provider_account_id: providerRow.id,
            payment_order_id: paymentOrder.id,
            refund_id: refund.id,
            business_order_id: paymentOrder.business_order_id,
        }, err, payload);
        await db.query(
            `UPDATE payment_refunds
             SET status = 'failed',
                 provider_payload = $2::jsonb,
                 next_poll_at = NULL,
                 updated_at = NOW()
             WHERE id = $1`,
            [refund.id, JSON.stringify(payload)]
        );
        err.statusCode = err.statusCode || 502;
        err.code = err.code || 'PAYMENT_PROVIDER_ERROR';
        throw err;
    }

    const updated = await db.query(
        `UPDATE payment_refunds
         SET status = $2,
             provider_refund_no = $3,
             provider_payload = $4::jsonb,
             next_poll_at = CASE WHEN $2 IN ('created', 'pending') THEN NOW() + INTERVAL '5 minutes' ELSE NULL END,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [refund.id, adapterResult.status, adapterResult.provider_refund_no || null, JSON.stringify(adapterResult.provider_payload || {})]
    );
    await updatePaymentRefundAggregate(paymentOrder.id);
    return ok({ refund: refundPayload(updated.rows[0]) });
}

/**
 * Process provider payment callbacks.
 *
 * The adapter must verify signatures/decrypt payloads before this method trusts
 * any field. The raw callback is stored for audit and duplicate callbacks are
 * tolerated through `ON CONFLICT DO NOTHING`.
 */
async function handlePaymentCallback(provider, headers, rawBody) {
    const providerRow = await loadProvider(provider);
    const adapter = adapterFactory(provider);
    const verified = await adapter.verifyPaymentCallback({ headers, rawBody }, providerRow);

    await db.query(
        `INSERT INTO payment_callback_events
           (provider, event_type, event_id, provider_trade_no, headers, raw_body, verified, process_status)
         VALUES ($1, 'payment', $2, $3, $4::jsonb, $5, TRUE, 'received')
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [provider, verified.event_id || null, verified.provider_trade_no || null, JSON.stringify(headers || {}), rawBody]
    );

    if (verified.status === 'paid') {
        // Payment success is idempotent: a repeated callback writes the same
        // terminal state and then updates the business order once again safely.
        const updated = await db.query(
            `UPDATE payment_orders
             SET status = 'paid',
                 provider_trade_no = COALESCE(provider_trade_no, $2),
                 provider_payload = $3::jsonb,
                 paid_at = COALESCE($4::timestamptz, NOW()),
                 updated_at = NOW()
             WHERE id = $1 OR provider_trade_no = $2
             RETURNING *`,
            [verified.local_order_id || null, verified.provider_trade_no || null, JSON.stringify(verified.raw || {}), verified.paid_at || null]
        );
        if (updated.rows[0]?.business_order_id) {
            await db.query(
                `UPDATE orders
                 SET status = 'paid'
                 WHERE id = $1`,
                [updated.rows[0].business_order_id]
            );
        }
    }

    return callbackAck(adapter.paymentCallbackResponse ? adapter.paymentCallbackResponse() : { code: 'SUCCESS', message: 'OK' });
}

/**
 * Process provider refund callbacks.
 *
 * Refund callbacks can arrive before an operator refreshes the admin UI, so the
 * callback path and manual/timer polling both converge on `applyRefundStatus`.
 */
async function handleRefundCallback(provider, headers, rawBody) {
    const providerRow = await loadProvider(provider);
    const adapter = adapterFactory(provider);
    const verified = await adapter.verifyRefundCallback({ headers, rawBody }, providerRow);
    await db.query(
        `INSERT INTO payment_callback_events
           (provider, event_type, event_id, provider_refund_no, headers, raw_body, verified, process_status)
         VALUES ($1, 'refund', $2, $3, $4::jsonb, $5, TRUE, 'received')
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [provider, verified.event_id || null, verified.provider_refund_no || null, JSON.stringify(headers || {}), rawBody]
    );
    const updated = await applyRefundStatus({
        refundId: verified.local_refund_id || null,
        providerRefundNo: verified.provider_refund_no || null,
        refundNo: verified.local_refund_no || null,
        status: verified.status,
        providerPayload: verified.raw || {},
        succeededAt: verified.succeeded_at || null,
    });
    if (updated?.payment_order_id) await updatePaymentRefundAggregate(updated.payment_order_id);
    return callbackAck(adapter.refundCallbackResponse ? adapter.refundCallbackResponse() : { code: 'SUCCESS', message: 'OK' });
}

/**
 * Apply the normalized refund state from either callback or polling.
 *
 * Matching accepts local refund ID, provider refund ID, or local refund number
 * because different providers include different identifiers in async events.
 */
async function applyRefundStatus({ refundId, providerRefundNo, refundNo, status, providerPayload, succeededAt }) {
    const result = await db.query(
        `UPDATE payment_refunds
         SET status = $4,
             provider_payload = $5::jsonb,
             last_polled_at = NOW(),
             next_poll_at = CASE WHEN $4 IN ('created', 'pending') THEN NOW() + INTERVAL '15 minutes' ELSE NULL END,
             succeeded_at = COALESCE($6::timestamptz, succeeded_at),
             updated_at = NOW()
         WHERE id = $1 OR provider_refund_no = $2 OR refund_no = $3
         RETURNING *`,
        [refundId, providerRefundNo, refundNo, status, JSON.stringify(providerPayload || {}), succeededAt]
    );
    return result.rows[0] || null;
}

/**
 * Query a provider for one refund and persist the normalized result.
 *
 * This is shared by manual admin polling and timer-triggered cron polling.
 */
async function syncRefund(refund) {
    const providerRow = await loadProvider(refund.provider, refund.provider_account_id);
    const adapter = adapterFactory(refund.provider);
    const providerResult = await adapter.queryRefund({
        refund_id: refund.id,
        payment_order_id: refund.payment_order_id,
        refund_no: refund.refund_no,
        provider_refund_no: refund.provider_refund_no,
    }, providerRow);
    const updated = await applyRefundStatus({
        refundId: refund.id,
        providerRefundNo: refund.provider_refund_no,
        refundNo: refund.refund_no,
        status: providerResult.status,
        providerPayload: providerResult.provider_payload || {},
        succeededAt: providerResult.succeeded_at || null,
    });
    if (updated?.payment_order_id) await updatePaymentRefundAggregate(updated.payment_order_id);
    return updated;
}

async function handleManualRefundPoll(refundId) {
    const result = await db.query('SELECT * FROM payment_refunds WHERE id = $1 LIMIT 1', [refundId]);
    if (!result.rows.length) return error(404, 'PAYMENT_NOT_FOUND', 'Refund not found');
    const updated = await syncRefund(result.rows[0]);
    return ok({ refund: refundPayload(updated) });
}

async function handleGetRefund(refundId, query = {}) {
    const result = await db.query('SELECT * FROM payment_refunds WHERE id = $1 LIMIT 1', [refundId]);
    if (!result.rows.length) return error(404, 'PAYMENT_NOT_FOUND', 'Refund not found');
    if (query.sync_provider === 'true' && !['succeeded', 'failed', 'closed'].includes(result.rows[0].status)) {
        const updated = await syncRefund(result.rows[0]);
        return ok({ refund: refundPayload(updated) });
    }
    return ok({ refund: refundPayload(result.rows[0]) });
}

async function updatePaymentRefundAggregate(paymentOrderId) {
    await db.query(
        `UPDATE payment_orders
         SET status = CASE
             WHEN COALESCE(r.succeeded_amount, 0) >= payment_orders.amount_minor THEN 'refunded'
             WHEN COALESCE(r.pending_amount, 0) > 0 THEN 'refunding'
             WHEN COALESCE(r.succeeded_amount, 0) > 0 THEN 'partially_refunded'
             ELSE payment_orders.status
         END,
         updated_at = NOW()
         FROM (
             SELECT payment_order_id,
                    SUM(amount_minor) FILTER (WHERE status = 'succeeded') AS succeeded_amount,
                    SUM(amount_minor) FILTER (WHERE status IN ('created', 'pending')) AS pending_amount
             FROM payment_refunds
             WHERE payment_order_id = $1
             GROUP BY payment_order_id
         ) r
         WHERE payment_orders.id = r.payment_order_id`,
        [paymentOrderId]
    );
}

/**
 * Timer-triggered refund reconciliation.
 *
 * Providers may accept a refund request before the refund actually settles.
 * This loop polls due refunds with bounded batch size, updates local status, and
 * keeps failures isolated so one provider error does not stop the whole batch.
 */
async function pollPendingRefunds() {
    const pending = await db.query(
        `SELECT *
         FROM payment_refunds
         WHERE status IN ('created', 'pending')
           AND next_poll_at <= NOW()
         ORDER BY next_poll_at ASC
         LIMIT 100`
    );

    let polled = 0;
    for (const refund of pending.rows) {
        try {
            await syncRefund(refund);
            polled += 1;
        } catch (err) {
            console.error(JSON.stringify({ level: 'ERROR', msg: 'Refund poll failed', refund_id: refund.id, error: err.message }));
        }
    }
    return json(200, { success: true, polled });
}

exports.handler = async (req, resp, context) => {
    try {
        const event = decodeFcEvent(req);
        if (isTimerEvent(event)) return await pollPendingRefunds();

        // FC 3.0 HTTP trigger shape follows `rawPath` and
        // `requestContext.http.method`; this handler intentionally avoids
        // Express-style `req.path`/`req.method`.
        const path = event.rawPath || '';
        const method = event.requestContext?.http?.method || 'GET';
        const rawBody = rawBodyFromEvent(event);
        const headers = event.headers || {};

        if (method === 'OPTIONS') return json(204, '');
        if (method === 'POST' && path === '/payment/providers/test') return await handleTestProviderConfig(parseJson(rawBody));
        if (method === 'POST' && path === '/payment/orders') return await handleCreatePayment(parseJson(rawBody), headers);

        const byBusinessMatch = path.match(/^\/payment\/orders\/by-business\/([^/]+)$/);
        if (method === 'GET' && byBusinessMatch) return await handleGetPaymentByBusiness(byBusinessMatch[1]);

        const paymentMatch = path.match(/^\/payment\/orders\/([^/]+)$/);
        if (method === 'GET' && paymentMatch) return await handleGetPayment(paymentMatch[1], event.queryParameters || {});

        if (method === 'POST' && path === '/payment/refunds') return await handleCreateRefund(parseJson(rawBody), headers);

        const refundPollMatch = path.match(/^\/payment\/refunds\/([^/]+)\/poll$/);
        if (method === 'POST' && refundPollMatch) return await handleManualRefundPoll(refundPollMatch[1]);

        const refundMatch = path.match(/^\/payment\/refunds\/([^/]+)$/);
        if (method === 'GET' && refundMatch) return await handleGetRefund(refundMatch[1], event.queryParameters || {});

        const paymentCallbackMatch = path.match(/^\/payment\/callbacks\/([^/]+)\/payment$/);
        if (method === 'POST' && paymentCallbackMatch) {
            return await handlePaymentCallback(paymentCallbackMatch[1], headers, rawBody);
        }

        const refundCallbackMatch = path.match(/^\/payment\/callbacks\/([^/]+)\/refund$/);
        if (method === 'POST' && refundCallbackMatch) {
            return await handleRefundCallback(refundCallbackMatch[1], headers, rawBody);
        }

        return error(404, 'PAYMENT_NOT_FOUND', 'Route not found');
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'Payment handler failed', error: err.message, stack: err.stack }));
        return error(err.statusCode || 500, err.code || 'PAYMENT_INTERNAL_ERROR', err.message);
    }
};

exports.__private = {
    setAdapterFactory(factory) {
        adapterFactory = factory;
    },
    _resetAdapterFactory() {
        adapterFactory = getAdapter;
    },
    decodeFcEvent,
    isTimerEvent,
};
