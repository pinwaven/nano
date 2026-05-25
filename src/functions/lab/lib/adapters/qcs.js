/**
 * QCS (量康) lab adapter — integrates with the QCS open API for lab test
 * ordering, result retrieval, and webhook validation.
 *
 * QCS API flow:
 *   1. OAuth2 client_credentials → access_token (cached in memory + global_cache)
 *   2. POST orders/_id_check     → create primary order (returns order.id)
 *   3. POST orders/:id/samples   → attach sample to order (barcode + sample form)
 *   4. GET  orders/:id           → poll for results
 *   5. DELETE orders/:id         → cancel failed partial orders
 *
 * Webhook: QCS signs callbacks with HMAC-SHA1 over "path\\nbody".
 *
 * @module adapters/qcs
 */
'use strict';

const crypto = require('crypto');
const axios = require('axios');

/**
 * Maps QCS bodyindex English names (lowercased) to LOINC codes recognized by
 * the Nano biomarker catalog. Maintained manually — update when QCS adds new
 * bodyindex types that map to Nano-tracked biomarkers.
 */
const BODYINDEX_LOINC_MAP = {
    hba1c: '4548-4',
    'glycated hemoglobin': '4548-4',
    'hs-crp': '30522-7',
    hscrp: '30522-7',
    'c-reactive protein': '30522-7',
    'il-6': '26881-3',
    'gdf-15': '99960-8',
    cd38: '94718-3',
    ga: '1751-7',
    'glycated albumin': '1751-7',
    'cystatin c': '33863-2',
};

const DEFAULT_SAMPLE_FORM_ID = 'dry_peripheral_plasma';
const TOKEN_SAFETY_WINDOW_MS = 5 * 60 * 1000;
const tokenCache = new Map();

const BARCODE_SUFFIX_SAMPLE_FORM_ID = {
    '01': 'venous_blood',
    '02': 'venous_plasma',
    '03': 'venous_plasma',
    '04': 'peripheral_blood',
    '05': 'peripheral_plasma',
    '06': 'peripheral_plasma',
    '07': 'dry_peripheral_plasma',
    '09': 'saliva',
    '10': 'urine',
    '11': 'urine',
    '12': 'faeces',
    '13': 'cervicovaginal_secretions',
    '14': 'sputum',
    '15': 'hair',
    '16': 'throat swab',
    '17': 'venous_blood',
    '18': 'venous_plasma',
    '19': 'venous_plasma',
    '20': 'oral_mucosa_cells',
};

// Maintained from temp/2026_量康检测项目_BARCODE后两位项目列表.md.
// The source document maps projects to sample types, so multi-sample projects
// intentionally appear under multiple barcode suffixes.
const BARCODE_SUFFIX_PROJECTS = {
    '01': [
        { id: '2017', name: '个人全基因组测序' },
        { id: '2032', name: '个人健康体检基因检测（女75项）' },
        { id: '2033', name: '个人健康体检基因检测（男73项）' },
        { id: '2034', name: '女性高发肿瘤风险评估（7项）' },
        { id: '2035', name: '男性高发肿瘤风险评估（7项）' },
        { id: '2001', name: 'MTHFR基因（叶酸代谢）' },
        { id: '2003', name: '酒精代谢基因（乙醇、乙醛脱氢酶突变基因）' },
        { id: '2040', name: '血脂代谢基因（APOE）' },
        { id: '2045', name: '精准基因-阖家欢' },
        { id: '2036', name: '精准基因-抗衰形美' },
        { id: '2037', name: '精准基因-天赋潜力' },
        { id: '2038', name: '精准基因-营养吸收' },
        { id: '2039', name: '精准基因-肿瘤风险' },
        { id: '2041', name: '精准基因-慢病风险' },
        { id: '2042', name: '精准基因-脏器功能' },
        { id: '2043', name: '精准基因-心脑血管及意外风险' },
        { id: '2044', name: '精准基因-药物敏感性基因检测' },
        { id: '3041', name: '抗氧化维生素（7项）（空腹8小时以上采血）' },
        { id: '3051', name: '氧化压力分析（空腹8小时以上采血）' },
    ],
    '02': [
        { id: '3041', name: '抗氧化维生素（7项）（空腹8小时以上采血）' },
    ],
    '03': [
        { id: '3011', name: '女性荷尔蒙（21项）（需填写月经周期）' },
        { id: '3012', name: '男性荷尔蒙（10项）' },
        { id: '3041', name: '抗氧化维生素（7项）（空腹8小时以上采血）' },
        { id: '3049', name: '生长因子分析' },
        { id: '3120', name: '慢性食物敏感（20种IgG）' },
        { id: '3160', name: '慢性食物敏感（50种IgG）' },
        { id: '3100', name: '慢性食物敏感（100种IgG）' },
        { id: '3130', name: '慢性食物敏感（120种IgG）' },
        { id: '3111', name: '急性过敏原检测（100种IgE）' },
    ],
    '04': [],
    '05': [],
    '06': [],
    '07': [
        { id: '1001', name: '糖化血红蛋白' },
        { id: '1002', name: '同型半胱氨酸' },
        { id: '1003', name: '25羟基维生素D三项' },
        { id: '1005', name: '慢病风险二项（同型半胱氨酸+尿酸）' },
        { id: '1006', name: '慢病风险三项（同型半胱氨酸+尿酸+糖化血红蛋白）' },
        { id: '1008', name: '慢病风险四项（同型半胱氨酸+尿酸+糖化血红蛋白+维生素D）' },
        { id: '1009', name: '卵巢功能评估（AMH）' },
        { id: '1010', name: '肝脏健康评估' },
        { id: '1011', name: '免疫年龄评估' },
        { id: '1012', name: 'NAD+ 检测' },
        { id: '2053', name: 'DNA甲基化年龄检测' },
        { id: '2001', name: 'MTHFR基因（叶酸代谢）' },
        { id: '2003', name: '酒精代谢基因（乙醇、乙醛脱氢酶突变基因）' },
        { id: '2040', name: '血脂代谢基因（APOE）' },
        { id: '3120', name: '慢性食物敏感（20种IgG）' },
        { id: '3160', name: '慢性食物敏感（50种IgG）' },
        { id: '3100', name: '慢性食物敏感（100种IgG）' },
        { id: '3130', name: '慢性食物敏感（120种IgG）' },
        { id: '3113', name: '急性过敏原检测（39种IgE+总IgE）' },
    ],
    '09': [
        { id: '3040', name: '抗压力荷尔蒙评估' },
        { id: '2047', name: '端粒长度检测' },
        { id: '2018', name: '个人基因组全外显子测序' },
        { id: '2032', name: '个人健康体检基因检测（女75项）' },
        { id: '2033', name: '个人健康体检基因检测（男73项）' },
        { id: '2034', name: '女性高发肿瘤风险评估（7项）' },
        { id: '2035', name: '男性高发肿瘤风险评估（7项）' },
        { id: '2045', name: '精准基因-阖家欢' },
        { id: '2036', name: '精准基因-抗衰形美' },
        { id: '2037', name: '精准基因-天赋潜力' },
        { id: '2038', name: '精准基因-营养吸收' },
        { id: '2039', name: '精准基因-肿瘤风险' },
        { id: '2041', name: '精准基因-慢病风险' },
        { id: '2042', name: '精准基因-脏器功能' },
        { id: '2043', name: '精准基因-心脑血管及意外风险' },
        { id: '2044', name: '精准基因-药物敏感性基因检测' },
    ],
    '10': [
        { id: '3014', name: '全套新陈代谢分析（尿液有机酸75项）' },
        { id: '3017', name: '人体新陈代谢分析（尿液有机酸59项）' },
        { id: '3050', name: '雌激素代谢分析' },
        { id: '3555', name: '尿碘检测' },
    ],
    '11': [
        { id: '3013', name: '环境荷尔蒙（防腐剂、清洁剂、增塑剂，13项）' },
    ],
    '12': [
        { id: '6001', name: '肠道菌群基因测序' },
        { id: '2051', name: '幽门螺杆菌检测（鉴定）' },
        { id: '2052', name: '幽门螺杆菌检测（鉴定+5耐药）' },
    ],
    '13': [],
    '14': [],
    '15': [
        { id: '3038', name: '营养与重金属元素（39项）' },
    ],
    '16': [
        { id: '6006', name: '口腔菌群基因测序' },
        { id: '2020', name: '肺癌端粒酶基因检测' },
    ],
    '17': [],
    '18': [],
    '19': [],
    '20': [
        { id: '2032', name: '个人健康体检基因检测（女75项）' },
        { id: '2033', name: '个人健康体检基因检测（男73项）' },
        { id: '2034', name: '女性高发肿瘤风险评估（7项）' },
        { id: '2035', name: '男性高发肿瘤风险评估（7项）' },
        { id: '2001', name: 'MTHFR基因（叶酸代谢）' },
        { id: '2003', name: '酒精代谢基因（乙醇、乙醛脱氢酶突变基因）' },
        { id: '2040', name: '血脂代谢基因（APOE）' },
        { id: '2045', name: '精准基因-阖家欢' },
        { id: '2036', name: '精准基因-抗衰形美' },
        { id: '2037', name: '精准基因-天赋潜力' },
        { id: '2038', name: '精准基因-营养吸收' },
        { id: '2039', name: '精准基因-肿瘤风险' },
        { id: '2041', name: '精准基因-慢病风险' },
        { id: '2042', name: '精准基因-脏器功能' },
        { id: '2043', name: '精准基因-心脑血管及意外风险' },
        { id: '2044', name: '精准基因-药物敏感性基因检测' },
    ],
};

function validateWebhook(headers, rawBody, secret, options = {}) {
    const authorization = headers.authorization || headers.Authorization || '';
    if (!authorization.startsWith('QCS ') || !secret || !options.accessKey) return false;

    const auth = authorization.slice(4);
    const separator = auth.indexOf(':');
    if (separator <= 0) return false;

    const clientId = auth.slice(0, separator);
    const encodedData = auth.slice(separator + 1);
    if (clientId !== options.accessKey || !encodedData) return false;

    // QCS signs: callback path + literal "\n" + request body string.
    // Keep the original body text; do not JSON.parse/stringify before signing.
    const bodyText = normalizeWebhookBody(rawBody);
    const dataToSign = `${options.url || ''}\\n${bodyText}`;
    const expected = crypto
        .createHmac('sha1', secret)
        .update(dataToSign, 'utf8')
        .digest('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');

    console.log(JSON.stringify({
        level: 'DEBUG',
        msg: 'QCS webhook signature debug',
        url: options.url || '',
        body: bodyText,
        body_type: bodyType(rawBody),
        headers,
        data_to_sign: dataToSign,
        expected,
    }));

    return timingSafeEqual(encodedData, expected);
}

function normalizeWebhookBody(rawBody) {
    if (rawBody === null || rawBody === undefined) return '';
    if (Buffer.isBuffer(rawBody)) return rawBody.toString('utf8');
    return String(rawBody);
}

function bodyType(rawBody) {
    return Buffer.isBuffer(rawBody) ? 'Buffer' : typeof rawBody;
}

async function fetchOrder(orderId, config) {
    const res = await axios.get(`${trimTrailingSlash(config.api_base_url)}/services/labtest/orders/${encodeURIComponent(orderId)}`, {
        headers: { Authorization: `Bearer ${config.api_key}` },
        timeout: 15000,
    });
    return res.data?.data || res.data;
}

/**
 * Create a QCS lab order via the two-phase API.
 *
 * Phase 1: POST orders/_id_check  — creates the primary vendor order.
 * Phase 2: POST orders/:id/samples — attaches the sample barcode and collection details.
 *
 * If Phase 1 succeeds but Phase 2 fails, the function returns a partial result
 * with needs_cancel=true instead of throwing. This allows the poll compensation
 * loop (cancelFailedLabOrders) to clean up the dangling vendor order on the
 * next cycle.
 *
 * @param {object} args.user    - User row from the users table
 * @param {object} args.payload - Order parameters: { goods, barcode, sample_center_id, ... }
 * @param {object} args.config  - Provider config: { api_base_url, api_key, api_secret, cache }
 */
async function createOrder({ user, payload, config }) {
    const transport = config.transport || axios;
    const baseUrl = trimTrailingSlash(config.api_base_url);
    const token = await getAccessToken(baseUrl, config, transport);

    const orderPayload = {
        member: qcsMemberFromUser(user),
        goods: payload.goods || [],
        ...(payload.notes ? { note: payload.notes } : {}),
    };
    const orderRes = await requestQcs(transport, 'POST', `${baseUrl}/services/labtest/orders/_id_check`, orderPayload, {
        headers: authHeaders(token),
        timeout: 15000,
        stage: 'orders/_id_check',
    });
    const order = orderRes.data?.data || orderRes.data || {};
    const externalOrderId = order.id;

    // Persistence boundary: after _id_check succeeds, QCS has a primary order.
    // From this point on, failures must return external_order_id so /lab/order
    // can insert lab_orders and poll can cancel the dangling vendor order.
    const samplePayload = {
        barcode: payload.barcode || externalOrderId,
        sample_form_id: sampleFormIdFromBarcode(payload.barcode),
        sample_center_id: Number(payload.sample_center_id || 0),
        sample_time: Number(payload.sample_time || Math.floor(Date.now() / 1000)),
        empty_stomach: Boolean(payload.empty_stomach),
    };
    let sampleRes;
    try {
        sampleRes = await requestQcs(transport, 'POST', `${baseUrl}/services/labtest/orders/${encodeURIComponent(externalOrderId)}/samples`, samplePayload, {
            headers: authHeaders(token),
            timeout: 15000,
            stage: 'orders/:id/samples',
        });
    } catch (err) {
        const sampleError = qcsErrorDetails(err);
        // Keep this partial-order shape aligned with generic.js. The poll flow
        // scans needs_cancel=true and calls cancelOrder to close failed orders.
        return {
            external_order_id: externalOrderId,
            status: '待处理',
            lab_response: { order, samples_error: sampleError },
            lab_last_result: {
                id: externalOrderId,
                progress: order.progress || 'tobeconfirmed',
                sample_created: false,
                needs_cancel: true,
                sample_error: sampleError,
            },
            lab_final_result: null,
        };
    }
    const sample = sampleRes.data?.data || sampleRes.data || {};

    return {
        external_order_id: externalOrderId,
        status: qcsProgressToLabStatus(sample.progress || order.progress),
        lab_response: { order, samples: sample },
        lab_last_result: sample,
        lab_final_result: qcsProgressToLabStatus(sample.progress || order.progress) === '已完成' ? sample : null,
    };
}

async function cancelOrder({ externalOrderId, config }) {
    const transport = config.transport || axios;
    const baseUrl = trimTrailingSlash(config.api_base_url);
    const token = await getAccessToken(baseUrl, config, transport);
    // Used by poll compensation for orders whose sample creation failed after
    // the QCS primary order was created.
    const res = await requestQcs(transport, 'DELETE', `${baseUrl}/services/labtest/orders/${encodeURIComponent(externalOrderId)}`, null, {
        headers: authHeaders(token),
        timeout: 15000,
        stage: 'orders/:id/cancel',
    });
    return res.data?.data || res.data || {};
}

async function listSampleCenters({ config }) {
    const transport = config.transport || axios;
    const baseUrl = trimTrailingSlash(config.api_base_url);
    const token = await getAccessToken(baseUrl, config, transport);
    const res = await requestQcs(transport, 'GET', `${baseUrl}/services/labtest/sample-centers`, null, {
        headers: authHeaders(token),
        timeout: 15000,
        stage: 'sample-centers',
    });
    return res.data?.data || res.data || [];
}

async function fetchNewResults() {
    return [];
}

function parseResponse(raw) {
    const order = raw?.data || raw || {};
    const patientId = String(order.member?.id || order.member?.contact || order.member?.mobile || '');
    const dataDate = toIsoDate(order.updated_at || order.update_at || order.created_at);
    const bodyindexes = [];

    for (const good of normalizeArray(order.goods)) {
        for (const panel of normalizeArray(good.bodyindex_panels)) {
            bodyindexes.push(...normalizeArray(panel.bodyindexes));
        }
    }

    return bodyindexes
        .map((item) => {
            const name = String(item.english_name || item.name || item.key_name || '').trim();
            const loinc = BODYINDEX_LOINC_MAP[name.toLowerCase()];
            if (!loinc || item.value === null || item.value === undefined || item.value === '') return null;
            const value = Number.parseFloat(item.value);
            if (!Number.isFinite(value)) return null;
            return {
                loinc_code: loinc,
                value,
                unit: item.unit || '',
                data_date: dataDate,
                lab_patient_id: patientId,
            };
        })
        .filter(Boolean);
}

function timingSafeEqual(left, right) {
    const leftBuffer = Buffer.from(String(left));
    const rightBuffer = Buffer.from(String(right));
    if (leftBuffer.length !== rightBuffer.length) return false;
    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeArray(value) {
    return Array.isArray(value) ? value : [];
}

function toIsoDate(value) {
    if (!value) return new Date().toISOString();
    if (typeof value === 'number') return new Date(value * 1000).toISOString();
    const parsed = Number(value);
    if (Number.isFinite(parsed) && String(value).match(/^\d+$/)) return new Date(parsed * 1000).toISOString();
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function trimTrailingSlash(value) {
    return String(value || '').replace(/\/+$/, '');
}

/**
 * Obtain a QCS OAuth2 access token with three-tier caching:
 *
 *   1. In-memory Map (tokenCache) — survives within a warm FC container
 *   2. DB global_cache table      — survives cold starts and redeploys
 *   3. Remote OAuth2 endpoint     — fallback when both caches miss or expire
 *
 * A 5-minute safety window is applied before expiry to avoid race conditions
 * where a token expires mid-request. QCS rate-limits token requests, so
 * aggressive caching is essential.
 */
async function getAccessToken(baseUrl, config, transport) {
    const now = config.now ? config.now() : Date.now();
    const cacheKey = `${baseUrl}:${config.api_key || ''}`;
    const cached = tokenCache.get(cacheKey);
    if (cached?.accessToken && now < cached.expiresAtMs - TOKEN_SAFETY_WINDOW_MS) {
        return cached.accessToken;
    }

    // QCS blocks frequent token requests. Cache in memory for warm FC containers
    // and in global_cache so deploys/cold starts can reuse a valid token.
    const dbCacheKey = qcsTokenCacheKey(baseUrl, config.api_key);
    const cachedGlobal = config.cache ? await config.cache.get(dbCacheKey) : null;
    if (cachedGlobal?.access_token && now < Number(cachedGlobal.expires_at_ms || 0) - TOKEN_SAFETY_WINDOW_MS) {
        tokenCache.set(cacheKey, {
            accessToken: cachedGlobal.access_token,
            expiresAtMs: Number(cachedGlobal.expires_at_ms),
        });
        return cachedGlobal.access_token;
    }

    const res = await requestQcs(transport, 'POST', `${baseUrl}/oauth/access_token`, {
        grant_type: 'client_credentials',
        scope: config.scope || 'laborder_base',
        client_id: config.api_key,
        client_secret: config.api_secret,
    }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000,
        stage: 'oauth/access_token',
    });
    const accessToken = res.data?.access_token;
    const expiresIn = Number(res.data?.expires_in || 7200);
    if (accessToken) {
        const expiresAtMs = now + expiresIn * 1000;
        tokenCache.set(cacheKey, {
            accessToken,
            expiresAtMs,
        });
        if (config.cache) {
            await config.cache.set(dbCacheKey, {
                access_token: accessToken,
                expires_at_ms: expiresAtMs,
            }, new Date(expiresAtMs));
        }
    }
    return accessToken;
}

async function requestQcs(transport, method, url, data, options = {}) {
    try {
        if (method === 'GET' && typeof transport.get === 'function') return await transport.get(url, options);
        if (method === 'POST') return await transport.post(url, data, options);
        if (method === 'DELETE' && typeof transport.delete === 'function') return await transport.delete(url, options);
        return await transport.request({ method, url, data, ...options });
    } catch (err) {
        console.log(JSON.stringify({
            level: 'ERROR',
            msg: 'QCS request failed',
            stage: options.stage,
            method,
            url,
            status: err.response?.status || null,
            response_body: err.response?.data || null,
        }));
        throw err;
    }
}

function qcsErrorDetails(err) {
    return {
        status: err.response?.status || null,
        body: err.response?.data || null,
        message: err.message,
    };
}

function authHeaders(token) {
    return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
    };
}

function qcsMemberFromUser(user) {
    return {
        id: user.user_id,
        name: user.nickname || user.name || user.user_id,
        gender: normalizeGender(user.gender),
        birthday: toUnixSeconds(user.birth_date),
        contact: user.phone || user.external_id || user.email || '',
    };
}

function normalizeGender(value) {
    const gender = String(value || '').toLowerCase();
    if (gender === '男') return 'male';
    if (gender === '女') return 'female';
    return gender || null;
}

function toUnixSeconds(value) {
    if (!value) return null;
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? Math.floor(time / 1000) : null;
}

function qcsProgressToLabStatus(progress) {
    return String(progress || '').toLowerCase() === 'complete' ? '已完成' : '处理中';
}

function sampleFormIdFromBarcode(barcode) {
    const suffix = String(barcode || '').slice(-2);
    return BARCODE_SUFFIX_SAMPLE_FORM_ID[suffix] || DEFAULT_SAMPLE_FORM_ID;
}

function projectsByBarcode(barcode) {
    const suffix = String(barcode || '').slice(-2);
    return cloneProjects(BARCODE_SUFFIX_PROJECTS[suffix] || []);
}

function allProjectsByBarcodeSuffix() {
    return Object.fromEntries(
        Object.entries(BARCODE_SUFFIX_PROJECTS).map(([suffix, projects]) => [suffix, cloneProjects(projects)])
    );
}

function cloneProjects(projects) {
    return projects.map(project => ({ ...project }));
}

function clearTokenCache() {
    tokenCache.clear();
}

function qcsTokenCacheKey(baseUrl, apiKey) {
    return `qcs:access_token:${baseUrl}:${apiKey || ''}`;
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
    listSampleCenters,
    list_sample_centers: listSampleCenters,
    projectsByBarcode,
    projects_by_barcode: projectsByBarcode,
    allProjectsByBarcodeSuffix,
    all_projects_by_barcode_suffix: allProjectsByBarcodeSuffix,
    qcsProgressToLabStatus,
    sampleFormIdFromBarcode,
    BARCODE_SUFFIX_SAMPLE_FORM_ID,
    BARCODE_SUFFIX_PROJECTS,
    clearTokenCache,
    qcsTokenCacheKey,
};
