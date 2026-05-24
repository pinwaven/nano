'use strict';

/**
 * Generic / reference lab adapter.
 *
 * This file is both a minimal implementation and the adapter contract for all
 * third-party labs. Add a real lab by creating a sibling file with the same
 * exported methods and registering it in adapters/index.js.
 *
 * Inbound result payloads are expected in a simple normalized format here:
 *   { patient_id, order_id, results: [{ loinc_code, value, unit, data_date }] }
 *
 * Required methods for every adapter:
 *   - validateWebhook(headers, rawBody, secret, options)
 *   - fetchOrder(orderId, config)
 *   - fetchNewResults(since, config)
 *   - parseResponse(raw)
 *
 * Required methods for labs that support Nano-created orders:
 *   - createOrder({ user, payload, config }) / create_order alias
 *   - cancelOrder({ externalOrderId, config }) / cancel_order alias
 *
 * Important order contract:
 *   createOrder must return enough data for lab_orders insertion whenever the
 *   external lab has created a primary order. If a later vendor step fails
 *   after that primary order exists, do not throw away external_order_id.
 *   Return status "待处理" with lab_last_result.needs_cancel = true so poll can
 *   call cancelOrder and close the loop.
 */

const crypto = require('crypto');
const axios = require('axios');

/**
 * Validate X-Lab-Signature HMAC-SHA256 webhook header.
 *
 * Keep rawBody byte-exact. Do not parse and stringify before validation:
 * many vendors sign the original body bytes plus path/query.
 *
 * @param {object} headers
 * @param {string|Buffer} rawBody
 * @param {string} secret
 * @param {object} options adapter-specific values such as url or accessKey
 * @returns {boolean}
 */
function validateWebhook(headers, rawBody, secret, options = {}) {
    void options;
    const sig = headers['x-lab-signature'] || headers['X-Lab-Signature'] || '';
    if (!sig || !secret) return false;
    const expected = 'sha256=' + crypto
        .createHmac('sha256', secret)
        .update(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8'))
        .digest('hex');
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

/**
 * Fetch a single order by ID from the lab's REST API.
 *
 * Webhook payloads often contain only an order id or status change. The lab
 * handler calls this when it needs the full result body before parseResponse.
 *
 * @param {string} orderId
 * @param {{ api_base_url: string, api_key: string, api_secret?: string }} config
 * @returns {Promise<object>} raw response body
 */
async function fetchOrder(orderId, config) {
    const { api_base_url, api_key } = config;
    const res = await axios.get(`${api_base_url}/orders/${orderId}`, {
        headers: { Authorization: `Bearer ${api_key}` },
        timeout: 15000,
    });
    return res.data;
}

/**
 * Fetch all new results since a given timestamp.
 *
 * Timer poll uses this for vendors without reliable webhook delivery, and also
 * after compensation work has run. Return raw vendor payloads; normalization
 * belongs in parseResponse.
 *
 * @param {Date|null} since
 * @param {{ api_base_url: string, api_key: string, api_secret?: string }} config
 * @returns {Promise<Array>} array of raw result objects
 */
async function fetchNewResults(since, config) {
    const { api_base_url, api_key } = config;
    const params = since ? { since: since.toISOString() } : {};
    const res = await axios.get(`${api_base_url}/results`, {
        headers: { Authorization: `Bearer ${api_key}` },
        params,
        timeout: 30000,
    });
    return Array.isArray(res.data) ? res.data : res.data.results || [];
}

/**
 * Normalize raw API response to the canonical observation array.
 *
 * The ingestion pipeline only accepts this shape. Keep vendor-specific fields
 * inside the adapter and map stable user matching data to lab_patient_id.
 *
 * @param {object} raw  — shape from fetchOrder / fetchNewResults
 * @returns {Array<{ loinc_code, value, unit, data_date, lab_patient_id }>}
 */
function parseResponse(raw) {
    const results = Array.isArray(raw) ? raw : (raw.results || []);
    return results
        .filter(r => r.loinc_code && r.value != null)
        .map(r => ({
            loinc_code:    String(r.loinc_code).trim(),
            value:         parseFloat(r.value),
            unit:          r.unit || '',
            data_date:     r.data_date || r.collected_at || r.reported_at || new Date().toISOString(),
            lab_patient_id: String(r.patient_id || r.lab_patient_id || ''),
        }));
}

/**
 * Create an outbound lab order.
 *
 * @param {object} args
 * @param {object} args.user row from users table
 * @param {object} args.payload caller-supplied lab-specific order parameters
 * @param {{ api_base_url: string, api_key: string, api_secret?: string, cache?: object }} args.config
 * @returns {Promise<{
 *   external_order_id: string,
 *   status: '待处理'|'处理中'|'已完成',
 *   lab_response: object,
 *   lab_last_result: object|null,
 *   lab_final_result: object|null
 * }>}
 *
 * Design notes for real adapters:
 * - Treat "primary external order created" as the persistence boundary.
 * - If any later step fails, return a partial result with needs_cancel=true.
 * - Throw only before the external lab has created a primary order, or when no
 *   durable external_order_id can be recovered.
 */
async function createOrder() {
    throw new Error('Generic lab adapter does not support outbound order creation');
}

/**
 * Cancel an external lab order during poll compensation.
 *
 * This is called for lab_orders rows marked by createOrder with
 * lab_last_result.needs_cancel = true. A real adapter should make the vendor's
 * cancel request idempotent where possible: if the vendor says the order is
 * already cancelled or not processable, return that response so the local row
 * can still record the terminal state.
 *
 * @param {object} args
 * @param {string} args.externalOrderId vendor order id stored in lab_orders
 * @param {{ api_base_url: string, api_key: string, api_secret?: string, cache?: object }} args.config
 * @returns {Promise<object>} raw or normalized cancel response
 */
async function cancelOrder() {
    throw new Error('Generic lab adapter does not support outbound order cancellation');
}

module.exports = {
    validateWebhook,
    fetchOrder,
    fetchNewResults,
    parseResponse,
    createOrder,
    create_order: createOrder,
    cancelOrder,
    cancel_order: cancelOrder,
};
