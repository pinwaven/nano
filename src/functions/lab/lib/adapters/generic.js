'use strict';

/**
 * Generic / reference adapter.
 *
 * Expects JSON payloads in a simple normalized format:
 *   { patient_id, order_id, results: [{ loinc_code, value, unit, data_date }] }
 *
 * Replace or extend this for real lab APIs (KingMed, FROS, etc.) by creating
 * a new file that exports the same four methods and registering it in adapters/index.js.
 */

const crypto = require('crypto');
const axios = require('axios');

/**
 * Validate X-Lab-Signature HMAC-SHA256 webhook header.
 * @param {object} headers
 * @param {string|Buffer} rawBody
 * @param {string} secret
 * @returns {boolean}
 */
function validateWebhook(headers, rawBody, secret) {
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
 * @param {string} orderId
 * @param {{ api_base_url: string, api_key: string }} config
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
 * @param {Date|null} since
 * @param {{ api_base_url: string, api_key: string }} config
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

module.exports = { validateWebhook, fetchOrder, fetchNewResults, parseResponse };
