'use strict';

const db = require('./lib/db');
const { getAdapter } = require('./lib/adapters/index');
const { matchUser } = require('./lib/userMatcher');
const { normalizeObservations } = require('./lib/labNormalizer');
const globalCache = require('./lib/globalCache');
const crypto = require('crypto');
const EventBridge = require('@alicloud/eventbridge');
const OpenApi = require('@alicloud/openapi-client');
const { v4: uuidv4 } = require('uuid');

let adapterFactory = getAdapter;

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

    const adapter = adapterFactory(labName);

    // QCS uses lab_providers.api_key_enc as client_id and webhook_secret_enc as client_secret.
    const secret = provider.webhook_secret_enc; // decryption would happen here in production
    if (secret && !adapter.validateWebhook(headers, rawBody, secret, { url, accessKey: provider.api_key_enc })) {
        return { statusCode: 401, body: JSON.stringify({ error: 'Invalid signature' }) };
    }

    const payload = JSON.parse(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8'));
    const config  = { api_base_url: provider.api_base_url, api_key: provider.api_key_enc };

    // Notification payload may not include full results — fetch the order
    const orderId = payload.order_id;
    const raw = orderId ? await adapter.fetchOrder(orderId, config) : payload;
    await updateLabOrderFromWebhook(labName, raw);
    const observations = adapter.parseResponse(raw);

    // Group by patient ID and process
    const byPatient = {};
    for (const obs of observations) {
        const pid = obs.lab_patient_id;
        if (!byPatient[pid]) byPatient[pid] = [];
        byPatient[pid].push(obs);
    }
    await Promise.all(Object.entries(byPatient).map(([pid, obs]) => processBatch(labName, pid, obs, fcContext)));

    if (labName === 'qcs') {
        return { statusCode: 200, body: JSON.stringify({ status: 0 }) };
    }
    return { statusCode: 202, body: JSON.stringify({ accepted: true }) };
}

async function handleCreateOrder(rawBody) {
    const body = JSON.parse(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8'));
    const labName = body.lab_name || 'qcs';
    if (!body.user_id) return { statusCode: 400, body: JSON.stringify({ error: 'user_id is required' }) };
    if (!body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)) {
        return { statusCode: 400, body: JSON.stringify({ error: 'payload object is required' }) };
    }

    const provider = await loadProvider(labName);
    if (!provider) return { statusCode: 404, body: JSON.stringify({ error: `Unknown lab: ${labName}` }) };

    const user = await loadUser(body.user_id);
    if (!user) return { statusCode: 404, body: JSON.stringify({ error: `Unknown user: ${body.user_id}` }) };

    const adapter = adapterFactory(labName);
    const config = {
        api_base_url: provider.api_base_url,
        api_key: provider.api_key_enc,
        api_secret: provider.webhook_secret_enc,
        cache: globalCache,
    };
    const createOrder = adapter.create_order || adapter.createOrder;
    if (!createOrder) return { statusCode: 501, body: JSON.stringify({ error: `Lab order is not supported: ${labName}` }) };

    const result = await createOrder({ user, payload: body.payload, config });
    const order = await insertLabOrder({
        lab_name: labName,
        user_id: body.user_id,
        api_key: provider.api_key_enc,
        api_secret: provider.webhook_secret_enc,
        lab_request: { user_id: body.user_id, payload: body.payload },
        external_order_id: result.external_order_id,
        lab_response: result.lab_response,
        lab_last_result: result.lab_last_result,
        lab_final_result: result.lab_final_result,
        status: result.status || '处理中',
    });

    return { statusCode: 200, body: JSON.stringify({ success: true, order }) };
}

async function handleQcsSampleCenters() {
    const labName = 'qcs';
    const provider = await loadProvider(labName);
    if (!provider) return { statusCode: 404, body: JSON.stringify({ error: `Unknown lab: ${labName}` }) };

    const adapter = adapterFactory(labName);
    const listSampleCenters = adapter.list_sample_centers || adapter.listSampleCenters;
    if (!listSampleCenters) {
        return { statusCode: 501, body: JSON.stringify({ error: 'QCS sample centers are not supported' }) };
    }

    const sampleCenters = await listSampleCenters({
        config: {
            api_base_url: provider.api_base_url,
            api_key: provider.api_key_enc,
            api_secret: provider.webhook_secret_enc,
            cache: globalCache,
        },
    });

    return { statusCode: 200, body: JSON.stringify({ success: true, sample_centers: sampleCenters }) };
}

async function handleQcsProjects(query = {}) {
    const adapter = adapterFactory('qcs');
    const barcode = query.barcode ? String(query.barcode) : '';
    if (barcode) {
        const projectsByBarcode = adapter.projects_by_barcode || adapter.projectsByBarcode;
        if (!projectsByBarcode) {
            return { statusCode: 501, body: JSON.stringify({ error: 'QCS barcode projects are not supported' }) };
        }
        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                barcode,
                suffix: barcode.slice(-2),
                projects: projectsByBarcode(barcode),
            }),
        };
    }

    const allProjectsByBarcodeSuffix = adapter.all_projects_by_barcode_suffix || adapter.allProjectsByBarcodeSuffix;
    if (!allProjectsByBarcodeSuffix) {
        return { statusCode: 501, body: JSON.stringify({ error: 'QCS project list is not supported' }) };
    }
    return {
        statusCode: 200,
        body: JSON.stringify({
            success: true,
            projects_by_barcode_suffix: allProjectsByBarcodeSuffix(),
        }),
    };
}

async function loadProvider(labName) {
    const providerRes = await db.query(
        'SELECT api_base_url, api_key_enc, webhook_secret_enc FROM lab_providers WHERE lab_name = $1 AND is_active = TRUE LIMIT 1',
        [labName]
    );
    return providerRes.rows[0] || null;
}

async function loadUser(userId) {
    const userRes = await db.query(
        'SELECT user_id, external_id, nickname, phone, email, gender, birth_date FROM users WHERE user_id = $1 LIMIT 1',
        [userId]
    );
    return userRes.rows[0] || null;
}

async function insertLabOrder(order) {
    const res = await db.query(`
        INSERT INTO lab_orders (
            lab_name, user_id, api_key, api_secret, lab_request, external_order_id,
            lab_response, lab_last_result, lab_final_result, status, last_polled_at
        )
        VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10, NOW())
        RETURNING *
    `, [
        order.lab_name,
        order.user_id,
        order.api_key,
        order.api_secret,
        order.lab_request,
        order.external_order_id,
        order.lab_response,
        order.lab_last_result,
        order.lab_final_result,
        order.status,
    ]);
    return res.rows[0];
}

async function updateLabOrderFromWebhook(labName, raw) {
    const externalOrderId = raw?.id || raw?.order_id || raw?.data?.id || raw?.data?.order_id;
    if (!externalOrderId) return null;
    const status = mapLabStatus(raw?.progress || raw?.data?.progress);
    const finalResult = status === '已完成' ? raw : null;
    const res = await db.query(`
        UPDATE lab_orders
        SET status = $3,
            lab_last_result = $4::jsonb,
            lab_final_result = COALESCE($5::jsonb, lab_final_result),
            updated_at = NOW(),
            last_polled_at = NOW()
        WHERE lab_name = $1 AND external_order_id = $2
        RETURNING *
    `, [labName, externalOrderId, status, raw, finalResult]);
    return res.rows[0] || null;
}

function mapLabStatus(progress) {
    return String(progress || '').toLowerCase() === 'complete' ? '已完成' : '处理中';
}

// ─── Timer handler (pull flow) ───────────────────────────────────────────────

async function handlePoll(fcContext) {
    const providersRes = await db.query(
        'SELECT id, lab_name, api_base_url, api_key_enc, webhook_secret_enc, last_polled_at FROM lab_providers WHERE poll_enabled = TRUE AND is_active = TRUE'
    );

    // Poll is provider-scoped first because credentials, base URL and adapter
    // behavior are all provider-specific. Within each provider we then operate
    // on individual lab_orders rows so one bad vendor order cannot block the
    // rest of the provider's queue.
    for (const provider of providersRes.rows) {
        try {
            const adapter = adapterFactory(provider.lab_name);
            const config  = {
                api_base_url: provider.api_base_url,
                api_key: provider.api_key_enc,
                api_secret: provider.webhook_secret_enc,
                cache: globalCache,
            };

            // Compensation must run before normal polling. Some vendors create
            // a primary order first and fail on later sample/detail calls; those
            // rows are persisted with needs_cancel=true and must be cancelled
            // through the adapter to avoid dangling external orders.
            await cancelFailedLabOrders(provider, adapter, config);

            const polledCount = await pollUnfinishedLabOrders(provider, adapter, config, fcContext);

            await db.query('UPDATE lab_providers SET last_polled_at = NOW() WHERE id = $1', [provider.id]);

            console.log(JSON.stringify({
                level: 'INFO',
                msg: 'Lab poll completed',
                labName: provider.lab_name,
                orderCount: polledCount,
            }));
        } catch (err) {
            console.error(JSON.stringify({ level: 'ERROR', msg: 'Lab poll failed', labName: provider.lab_name, error: err.message }));
        }
    }
}

async function pollUnfinishedLabOrders(provider, adapter, config, fcContext) {
    const fetchOrder = adapter.fetchOrder;
    if (!fetchOrder) {
        console.warn(JSON.stringify({
            level: 'WARN',
            msg: 'Lab adapter does not support per-order polling',
            labName: provider.lab_name,
        }));
        return 0;
    }

    // Only normal unfinished orders are selected here. Orders that need vendor
    // cancellation are handled by cancelFailedLabOrders before this query, and
    // already-cancelled rows are excluded so polling never reopens a closed loop.
    const ordersRes = await db.query(`
        SELECT id, lab_name, user_id, external_order_id, lab_last_result
        FROM lab_orders
        WHERE lab_name = $1
          AND status <> '已完成'
          AND external_order_id IS NOT NULL
          AND COALESCE(lab_last_result->>'needs_cancel', 'false') <> 'true'
          AND COALESCE(lab_last_result->>'cancel_completed', 'false') <> 'true'
        ORDER BY COALESCE(last_polled_at, created_at) ASC
        LIMIT 100
    `, [provider.lab_name]);

    let polledCount = 0;
    for (const order of ordersRes.rows) {
        try {
            // Fetch and update one order at a time. This keeps failures scoped
            // to a single vendor order and gives every row its own last_polled_at.
            const raw = await fetchOrder(order.external_order_id, config);
            await updateLabOrderFromPoll(order, raw);

            // Result ingestion still flows through the adapter normalizer so
            // vendor payload details remain isolated inside the adapter.
            const observations = adapter.parseResponse ? adapter.parseResponse(raw) : [];
            const byPatient = {};
            for (const obs of observations) {
                const pid = obs.lab_patient_id;
                if (!byPatient[pid]) byPatient[pid] = [];
                byPatient[pid].push(obs);
            }
            await Promise.all(Object.entries(byPatient).map(([pid, obs]) => processBatch(provider.lab_name, pid, obs, fcContext)));
            polledCount += 1;
        } catch (err) {
            console.error(JSON.stringify({
                level: 'ERROR',
                msg: 'Lab order poll failed',
                labName: provider.lab_name,
                orderId: order.id,
                externalOrderId: order.external_order_id,
                error: err.message,
            }));
            await db.query(`
                UPDATE lab_orders
                SET lab_last_result = COALESCE(lab_last_result, '{}'::jsonb) || $2::jsonb,
                    updated_at = NOW(),
                    last_polled_at = NOW()
                WHERE id = $1
            `, [
                order.id,
                {
                    poll_error: {
                        message: err.message,
                        status: err.response?.status || null,
                        body: err.response?.data || null,
                    },
                },
            ]);
        }
    }
    return polledCount;
}

async function updateLabOrderFromPoll(order, raw) {
    const status = mapLabStatus(raw?.progress || raw?.data?.progress);
    const finalResult = status === '已完成' ? raw : null;
    const res = await db.query(`
        UPDATE lab_orders
        SET status = $3,
            lab_last_result = $4::jsonb,
            lab_final_result = COALESCE($5::jsonb, lab_final_result),
            updated_at = NOW(),
            last_polled_at = NOW()
        WHERE id = $1 AND external_order_id = $2
        RETURNING *
    `, [order.id, order.external_order_id, status, raw, finalResult]);
    return res.rows[0] || null;
}

async function cancelFailedLabOrders(provider, adapter, config) {
    const cancelOrder = adapter.cancel_order || adapter.cancelOrder;
    if (!cancelOrder) return;

    // These rows are partial external orders: Nano has a vendor order id, but a
    // later required vendor step failed. They should not be polled as normal lab
    // work; the only valid next step is adapter.cancelOrder.
    const pendingRes = await db.query(`
        SELECT id, lab_name, external_order_id, lab_last_result
        FROM lab_orders
        WHERE lab_name = $1
          AND status = '待处理'
          AND external_order_id IS NOT NULL
          AND lab_last_result->>'needs_cancel' = 'true'
        ORDER BY updated_at ASC
        LIMIT 50
    `, [provider.lab_name]);

    for (const order of pendingRes.rows) {
        try {
            const cancelResult = await cancelOrder({ externalOrderId: order.external_order_id, config });
            await db.query(`
                UPDATE lab_orders
                SET status = '已完成',
                    lab_final_result = $2::jsonb,
                    lab_last_result = COALESCE(lab_last_result, '{}'::jsonb) || $3::jsonb,
                    updated_at = NOW(),
                    last_polled_at = NOW()
                WHERE id = $1
                RETURNING *
            `, [
                order.id,
                { cancelled: true, response: cancelResult },
                {
                    needs_cancel: false,
                    cancel_attempted: true,
                    cancel_completed: true,
                    cancel_error: null,
                },
            ]);
        } catch (err) {
            console.error(JSON.stringify({
                level: 'ERROR',
                msg: 'QCS partial order cancellation failed',
                labName: provider.lab_name,
                orderId: order.id,
                externalOrderId: order.external_order_id,
                error: err.message,
            }));
            await db.query(`
                UPDATE lab_orders
                SET lab_last_result = COALESCE(lab_last_result, '{}'::jsonb) || $2::jsonb,
                    updated_at = NOW(),
                    last_polled_at = NOW()
                WHERE id = $1
            `, [
                order.id,
                {
                    cancel_attempted: true,
                    cancel_completed: false,
                    cancel_error: {
                        message: err.message,
                        status: err.response?.status || null,
                        body: err.response?.data || null,
                    },
                },
            ]);
        }
    }
}

function buildRequestUrl(req) {
    const path = req.rawPath || '';
    if (req.rawQueryString) return `${path}?${req.rawQueryString}`;
    const query = req.queryParameters || {};
    const search = new URLSearchParams(query).toString();
    return search ? `${path}?${search}` : path;
}

function decodeFcEvent(req) {
    if (!Buffer.isBuffer(req)) return req || {};

    const text = req.toString('utf8');
    if (!text.trim()) return { __timerEvent: true };

    try {
        return JSON.parse(text);
    } catch (err) {
        return { __timerEvent: true, payload: text };
    }
}

function isTimerEvent(event) {
    return Boolean(
        event?.__timerEvent
        || (event && !event.rawPath && !event.requestContext?.http)
    );
}

// ─── FC 3.0 Handler ───────────────────────────────────────────────────────────

exports.handler = async (req, resp, context) => {
    try {
        const event = decodeFcEvent(req);

        // Timer trigger payloads do not include the HTTP rawPath/requestContext.http shape.
        if (isTimerEvent(event)) {
            await handlePoll(context);
            return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }), isBase64Encoded: false };
        }

        // HTTP trigger
        const path   = event.rawPath || '';
        const method = event.requestContext?.http?.method || 'POST';

        let rawBody = event.body || '';
        if (event.isBase64Encoded && rawBody) rawBody = Buffer.from(rawBody, 'base64').toString('utf8');

        // POST /lab/webhook/:labName
        const webhookMatch = path.match(/^\/lab\/webhook\/([^/]+)$/);
        console.log(JSON.stringify({ level: 'INFO', msg: 'new lab req', method, path, webhookMatch, event }));
        if (method === 'GET' && path === '/lab/qcs/sample-centers') {
            const result = await handleQcsSampleCenters();
            return {
                statusCode: result.statusCode,
                headers: { 'Content-Type': 'application/json' },
                body: result.body,
                isBase64Encoded: false,
            };
        }
        if (method === 'GET' && path === '/lab/qcs/projects') {
            const result = await handleQcsProjects(event.queryParameters || {});
            return {
                statusCode: result.statusCode,
                headers: { 'Content-Type': 'application/json' },
                body: result.body,
                isBase64Encoded: false,
            };
        }
        if (method === 'POST' && path === '/lab/order') {
            const result = await handleCreateOrder(rawBody);
            return {
                statusCode: result.statusCode,
                headers: { 'Content-Type': 'application/json' },
                body: result.body,
                isBase64Encoded: false,
            };
        }
        if (method === 'POST' && webhookMatch) {
            const labName = webhookMatch[1];
            const result  = await handleWebhook(labName, event.headers || {}, rawBody, context, buildRequestUrl(event));
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

module.exports.__private = {
    decodeFcEvent,
    isTimerEvent,
    buildRequestUrl,
    setAdapterFactory(factory) {
        adapterFactory = factory || getAdapter;
    },
    handleCreateOrder,
    handleQcsSampleCenters,
    handleQcsProjects,
    handlePoll,
    updateLabOrderFromWebhook,
};
