'use strict';

const db = require('./lib/db');
const { getAdapter } = require('./lib/adapters/index');
const { matchUser } = require('./lib/userMatcher');
const { normalizeObservations } = require('./lib/labNormalizer');
const crypto = require('crypto');
const EventBridge = require('@alicloud/eventbridge');
const OpenApi = require('@alicloud/openapi-client');
const { v4: uuidv4 } = require('uuid');

// ─── EventBridge publisher ────────────────────────────────────────────────────

async function publishLabComplete(reportId, userId, fcContext) {
    try {
        if (!fcContext?.credentials) return;

        const ebConfig = new OpenApi.Config({
            accessKeyId:     fcContext.credentials.accessKeyId,
            accessKeySecret: fcContext.credentials.accessKeySecret,
            securityToken:   fcContext.credentials.securityToken,
            endpoint:        `eventbridge.${fcContext.region}.aliyuncs.com`,
        });
        const ebClient = new EventBridge.default(ebConfig);

        const cloudEvent = new EventBridge.CloudEvent({
            id:              uuidv4(),
            source:          'acs.lab',
            specversion:     '1.0',
            type:            'biomarker.lab_complete',
            datacontenttype: 'application/json',
            time:            new Date().toISOString(),
            data:            Buffer.from(JSON.stringify({ report_id: reportId, user_id: userId })),
            extensions:      { aliyuneventbusname: 'default' },
        });
        await ebClient.putEvents([cloudEvent]);
    } catch (err) {
        console.warn(JSON.stringify({ level: 'WARN', msg: 'EventBridge publish failed', error: err.message }));
    }
}

// ─── Core ingestion pipeline ──────────────────────────────────────────────────

/**
 * Persist normalized observations and create a health_report record.
 * Returns the created report_id.
 */
async function ingestObservations(userId, labName, observations, reportDate) {
    if (observations.length === 0) return null;

    const date = reportDate || observations[0].data_date?.split('T')[0] || new Date().toISOString().split('T')[0];

    // Create health_report
    const reportRes = await db.query(
        `INSERT INTO health_reports (user_id, report_date, source, institution, report_type, status, raw_data)
         VALUES ($1, $2, 'lab_api', $3, 'lab_panel', 'parsed', $4)
         RETURNING id`,
        [
            userId,
            date,
            labName,
            JSON.stringify({ observations }),
        ]
    );
    const reportId = reportRes.rows[0].id;

    // Insert health_event rows (dedup via external_id = loinc_code + date)
    for (const obs of observations) {
        const externalId = `${obs.loinc_code}::${obs.data_date}`;
        const dataDate = obs.data_date ? obs.data_date.split('T')[0] : new Date().toISOString().split('T')[0];
        await db.query(
            `INSERT INTO health_events
               (user_id, source, category, data_date, recorded_at, data, report_id, external_id)
             VALUES ($1, 'lab_api', 'lab_result', $2, NOW(), $3, $4, $5)
             ON CONFLICT (user_id, source, external_id) DO NOTHING`,
            [
                userId,
                dataDate,
                JSON.stringify({
                    key_name:       obs.key_name,
                    loinc_code:     obs.loinc_code,
                    value:          obs.value,
                    unit:           obs.unit,
                    nano_dimension: obs.nano_dimension,
                    is_kino_core:   obs.is_kino_core,
                }),
                reportId,
                externalId,
            ]
        );
    }

    return reportId;
}

/**
 * Run the full ingestion pipeline for a single patient's results.
 * Returns true if Kino core biomarkers were found (triggers BioAge recalc downstream).
 */
async function processBatch(labName, labPatientId, rawObservations, fcContext) {
    const userId = await matchUser(labName, labPatientId);
    if (!userId) {
        console.log(JSON.stringify({ level: 'WARN', msg: 'No Nano user for lab patient', labName, labPatientId }));
        return false;
    }

    const normalized = await normalizeObservations(rawObservations);
    if (normalized.length === 0) {
        console.log(JSON.stringify({ level: 'INFO', msg: 'No recognized LOINC codes in batch', labName, labPatientId }));
        return false;
    }

    const reportId = await ingestObservations(userId, labName, normalized);
    const hasKinoCore = normalized.some(o => o.is_kino_core);

    if (reportId && hasKinoCore) {
        await publishLabComplete(reportId, userId, fcContext);
    }

    console.log(JSON.stringify({
        level: 'INFO',
        msg: 'Lab batch ingested',
        userId,
        labName,
        observationCount: normalized.length,
        hasKinoCore,
        reportId,
    }));

    return hasKinoCore;
}

// ─── Webhook handler (push flow) ─────────────────────────────────────────────

async function handleWebhook(labName, headers, rawBody, fcContext, url = '') {
    console.log(JSON.stringify({
        level: 'INFO',
        msg: 'Lab webhook received',
        labName,
        url,
        headers,
        body: Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || ''),
    }));

    const providerRes = await db.query(
        'SELECT api_base_url, api_key_enc, webhook_secret_enc FROM lab_providers WHERE lab_name = $1 AND is_active = TRUE LIMIT 1',
        [labName]
    );
    if (providerRes.rows.length === 0) {
        return { statusCode: 404, body: JSON.stringify({ error: `Unknown lab: ${labName}` }) };
    }
    const provider = providerRes.rows[0];

    const adapter = getAdapter(labName);

    const secret = provider.webhook_secret_enc; // decryption would happen here in production
    if (secret && !adapter.validateWebhook(headers, rawBody, secret)) {
        return { statusCode: 401, body: JSON.stringify({ error: 'Invalid signature' }) };
    }

    const payload = JSON.parse(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8'));
    const config  = { api_base_url: provider.api_base_url, api_key: provider.api_key_enc };

    // Notification payload may not include full results — fetch the order
    const orderId = payload.order_id;
    const raw = orderId ? await adapter.fetchOrder(orderId, config) : payload;
    const observations = adapter.parseResponse(raw);

    // Group by patient ID and process
    const byPatient = {};
    for (const obs of observations) {
        const pid = obs.lab_patient_id;
        if (!byPatient[pid]) byPatient[pid] = [];
        byPatient[pid].push(obs);
    }
    await Promise.all(Object.entries(byPatient).map(([pid, obs]) => processBatch(labName, pid, obs, fcContext)));

    return { statusCode: 202, body: JSON.stringify({ accepted: true }) };
}

// ─── Timer handler (pull flow) ───────────────────────────────────────────────

async function handlePoll(fcContext) {
    const providersRes = await db.query(
        'SELECT id, lab_name, api_base_url, api_key_enc, last_polled_at FROM lab_providers WHERE poll_enabled = TRUE AND is_active = TRUE'
    );

    for (const provider of providersRes.rows) {
        try {
            const adapter = getAdapter(provider.lab_name);
            const config  = { api_base_url: provider.api_base_url, api_key: provider.api_key_enc };
            const since   = provider.last_polled_at ? new Date(provider.last_polled_at) : null;

            const rawResults = await adapter.fetchNewResults(since, config);
            const observations = adapter.parseResponse(rawResults);

            const byPatient = {};
            for (const obs of observations) {
                const pid = obs.lab_patient_id;
                if (!byPatient[pid]) byPatient[pid] = [];
                byPatient[pid].push(obs);
            }
            await Promise.all(Object.entries(byPatient).map(([pid, obs]) => processBatch(provider.lab_name, pid, obs, fcContext)));

            await db.query('UPDATE lab_providers SET last_polled_at = NOW() WHERE id = $1', [provider.id]);

            console.log(JSON.stringify({
                level: 'INFO',
                msg: 'Lab poll completed',
                labName: provider.lab_name,
                resultCount: observations.length,
            }));
        } catch (err) {
            console.error(JSON.stringify({ level: 'ERROR', msg: 'Lab poll failed', labName: provider.lab_name, error: err.message }));
        }
    }
}

function buildRequestUrl(req) {
    const path = req.rawPath || '';
    const query = req.queryParameters || {};
    const search = new URLSearchParams(query).toString();
    return search ? `${path}?${search}` : path;
}

// ─── FC 3.0 Handler ───────────────────────────────────────────────────────────

exports.handler = async (req, resp, context) => {
    try {
        // Timer trigger: req is a Buffer containing the trigger payload
        if (Buffer.isBuffer(req)) {
            await handlePoll(context);
            return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }), isBase64Encoded: false };
        }

        // HTTP trigger
        const path   = req.rawPath || '';
        const method = req.requestContext?.http?.method || 'POST';

        let rawBody = req.body || '';
        if (req.isBase64Encoded && rawBody) rawBody = Buffer.from(rawBody, 'base64').toString('utf8');

        // POST /lab/webhook/:labName
        const webhookMatch = path.match(/^\/lab\/webhook\/([^/]+)$/);
        if (method === 'POST' && webhookMatch) {
            const labName = webhookMatch[1];
            const result  = await handleWebhook(labName, req.headers || {}, rawBody, context, buildRequestUrl(req));
            return {
                statusCode: result.statusCode,
                headers: { 'Content-Type': 'application/json' },
                body: result.body,
                isBase64Encoded: false,
            };
        }

        return {
            statusCode: 404,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Not found' }),
            isBase64Encoded: false,
        };
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'nano-lab handler error', error: err.message, stack: err.stack }));
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: err.message }),
            isBase64Encoded: false,
        };
    }
};
