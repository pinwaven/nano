'use strict';
/**
 * twin — every route between Curia and nano, and nothing else.
 *
 * Nano keeps every user's digital twin; Curia keeps a replica, runs the two external job queues
 * and contributes what its agents produce. All of that crosses here; the worker answers none of it
 * (decided 2026-09-23: "leave no other endpoints between Curia and nano"). Three scopes, each with
 * its own per-environment token, so one leaked credential opens one scope:
 *
 *   TWIN_API_TOKEN         /api/twin/{ping,docs,versions,bundle,feed/*,document-url,contributions*}
 *   VIVA_AG_API_TOKEN      /api/twin/viva-ag/*       the paid deep-analysis queue
 *   DOC_EXTRACT_API_TOKEN  /api/twin/doc-extract/*   the document-extraction queue
 *
 * The queue handlers are the worker's own (shared/worker/, copied at deploy by
 * scripts/sync-twin-shared.js), so a result becomes a chat message, a formulation is validated and
 * a lab value lands in the record exactly as nano's code says. The contracts are served from here:
 * /api/twin/docs, /api/twin/viva-ag/docs, /api/twin/doc-extract/docs.
 *
 * No response carries a user_id, openid, phone or nickname. docs/architecture/twin-function.md is
 * the design.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const read = require('./lib/read');
const contributions = require('./lib/contributions');
const { CONTRACT_VERSION, contractText } = require('./lib/contract');
const { fail, REASONS } = require('./lib/reasons');
const { pool } = require('./shared/worker/lib/db');
const {
    handleGetVivaAgPing, handlePostVivaAgClaim, handleGetVivaAgTwinBundle, handleGetVivaAgDocumentUrl,
    handleGetVivaAgHealthEvents, handleGetVivaAgLabResults, handleGetVivaAgBiomarkerHistory, handleGetVivaAgChatHistory,
    handlePostVivaAgHeartbeat, handlePostVivaAgResult, handlePostVivaAgFail, handlePostVivaAgQuestionnaire,
    handlePostVivaAgResultUploadUrl,
} = require('./shared/worker/handlers/viva_ag');
const {
    handleGetDocExtractPing, handleGetDocExtractCatalog, handlePostDocExtractValidate,
    handlePostDocExtractClaim, handlePostDocExtractHeartbeat, handlePostDocExtractResult, handlePostDocExtractFail,
} = require('./shared/worker/handlers/doc_extraction');
const { handleGetVivaAgDocs, handleGetVivaAgOpenApi } = require('./lib/viva_ag_docs');
const { handleGetDocExtractDocs, handleGetDocExtractOpenApi } = require('./lib/doc_extraction_docs');

// Which build of the shared worker code this is. Two functions deployed from different commits
// hash one twin two ways; /ping shows it before a replica pays for it in refetches.
const SHARED_CODE = (() => {
    const h = crypto.createHash('sha256');
    const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) walk(p); else if (e.name.endsWith('.js')) h.update(path.relative(__dirname, p)).update(fs.readFileSync(p));
        }
    };
    try { walk(path.join(__dirname, 'shared')); } catch (e) { return null; }
    return h.digest('hex').slice(0, 12);
})();

// Exact paths only. The contracts' OpenAPI files list the same sets; tests hold them together.
const VIVA_AG_ALLOWED_PATHS = new Set([
    '/viva-ag/ping', '/viva-ag/docs', '/viva-ag/openapi.json',
    '/viva-ag/jobs/claim', '/viva-ag/jobs/heartbeat',
    '/viva-ag/jobs/result', '/viva-ag/jobs/fail', '/viva-ag/result-upload-url',
    '/viva-ag/jobs/questionnaire',
    '/viva-ag/twin-bundle', '/viva-ag/document-url',
    '/viva-ag/health-events', '/viva-ag/lab-results',
    '/viva-ag/biomarker-history', '/viva-ag/chat-history',
]);
const DOC_EXTRACT_ALLOWED_PATHS = new Set([
    '/doc-extract/ping', '/doc-extract/docs', '/doc-extract/openapi.json',
    '/doc-extract/catalog', '/doc-extract/validate',
    '/doc-extract/jobs/claim', '/doc-extract/jobs/heartbeat',
    '/doc-extract/jobs/result', '/doc-extract/jobs/fail',
]);

function same(a, b) {
    if (!a || !b) return false;
    const x = Buffer.from(a), y = Buffer.from(b);
    return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** The scope a bearer opens, or null. Each token opens exactly one. */
function scopeOf(authHeader) {
    const m = /^Bearer\s+(.+)$/i.exec(String(authHeader || '').trim());
    if (!m) return null;
    const t = m[1].trim();
    if (same(t, process.env.TWIN_API_TOKEN)) return 'twin';
    if (same(t, process.env.VIVA_AG_API_TOKEN)) return 'viva-ag';
    if (same(t, process.env.DOC_EXTRACT_API_TOKEN)) return 'doc-extract';
    return null;
}

function scopeOfPath(p) {
    if (p.startsWith('/viva-ag/')) return VIVA_AG_ALLOWED_PATHS.has(p) ? 'viva-ag' : 'none';
    if (p.startsWith('/doc-extract/')) return DOC_EXTRACT_ALLOWED_PATHS.has(p) ? 'doc-extract' : 'none';
    return 'twin';
}

const header = (h, name) => {
    const k = Object.keys(h || {}).find(x => x.toLowerCase() === name);
    return k ? h[k] : undefined;
};

function parseEvent(req) {
    let event = req;
    if (Buffer.isBuffer(req)) { try { event = JSON.parse(req.toString()); } catch (e) { event = {}; } }
    const rawUrl = req.url || '';
    const rawPath = event.rawPath || event.path || req.path || rawUrl.split('?')[0] || '';
    const method = String(event.httpMethod || event.method || event.requestContext?.http?.method || req.method || 'GET').toUpperCase();
    const headers = event.headers || req.headers || {};
    const query = event.queryParameters || event.queryStringParameters || req.queries || req.query
        || (rawUrl.includes('?') ? Object.fromEntries(new URLSearchParams(rawUrl.split('?')[1])) : {});
    let body = event.body ?? req.body;
    if (typeof body === 'string' && event.isBase64Encoded) body = Buffer.from(body, 'base64');
    if (Buffer.isBuffer(body)) body = body.toString('utf8');
    if (typeof body === 'string' && body) { try { body = JSON.parse(body); } catch (e) { body = { __unparseable: true }; } }
    return { rawPath, path: rawPath.replace(/^\/api\/twin/, '') || '/', method, headers, query: query || {}, body: body || {} };
}

// The queues' per-job fencing tokens: a header on GET (query strings land in access logs, and
// this token opens a medical record), a body field on POST.
async function routeVivaAg({ path: p, method, query, body, headers }) {
    const jobToken = header(headers, 'x-viva-ag-job-token') || '';
    if (method === 'GET') {
        switch (p) {
            case '/viva-ag/ping': return handleGetVivaAgPing();
            case '/viva-ag/docs': return handleGetVivaAgDocs();
            case '/viva-ag/openapi.json': return handleGetVivaAgOpenApi();
            case '/viva-ag/twin-bundle': return handleGetVivaAgTwinBundle(query, jobToken);
            case '/viva-ag/document-url': return handleGetVivaAgDocumentUrl(query, jobToken);
            case '/viva-ag/health-events': return handleGetVivaAgHealthEvents(query, jobToken);
            case '/viva-ag/lab-results': return handleGetVivaAgLabResults(query, jobToken);
            case '/viva-ag/biomarker-history': return handleGetVivaAgBiomarkerHistory(query, jobToken);
            case '/viva-ag/chat-history': return handleGetVivaAgChatHistory(query, jobToken);
        }
    } else if (method === 'POST') {
        switch (p) {
            case '/viva-ag/jobs/claim': return handlePostVivaAgClaim(body);
            case '/viva-ag/jobs/heartbeat': return handlePostVivaAgHeartbeat(body);
            case '/viva-ag/jobs/result': return handlePostVivaAgResult(body);
            case '/viva-ag/jobs/fail': return handlePostVivaAgFail(body);
            case '/viva-ag/jobs/questionnaire': return handlePostVivaAgQuestionnaire(body);
            case '/viva-ag/result-upload-url': return handlePostVivaAgResultUploadUrl(body);
        }
    }
    return null;
}

async function routeDocExtract({ path: p, method, body, headers }) {
    const jobToken = header(headers, 'x-doc-extract-job-token') || '';
    const withToken = { ...body, result_token: body?.result_token || jobToken };
    if (method === 'GET') {
        switch (p) {
            case '/doc-extract/ping': return handleGetDocExtractPing();
            case '/doc-extract/docs': return handleGetDocExtractDocs();
            case '/doc-extract/openapi.json': return handleGetDocExtractOpenApi();
            case '/doc-extract/catalog': return handleGetDocExtractCatalog();
        }
    } else if (method === 'POST') {
        switch (p) {
            case '/doc-extract/jobs/claim': return handlePostDocExtractClaim(body);
            case '/doc-extract/jobs/heartbeat': return handlePostDocExtractHeartbeat(withToken);
            case '/doc-extract/jobs/result': return handlePostDocExtractResult(withToken);
            case '/doc-extract/jobs/fail': return handlePostDocExtractFail(withToken);
            case '/doc-extract/validate': return handlePostDocExtractValidate(body);
        }
    }
    return null;
}

async function routeTwin({ path: p, method, query, body }) {
    if (method === 'GET') {
        if (p === '/ping') {
            await pool.query('SELECT 1');
            return {
                success: true, service: 'twin', environment: process.env.TWIN_ENV || null,
                contract_version: CONTRACT_VERSION, bundle_version: read.BUNDLE_VERSION, shared_code: SHARED_CODE,
                feeds: Object.keys(read.FEEDS), contribution_kinds: [...contributions.KINDS_ACCEPTED],
                settle_seconds: read.SETTLE_SECONDS,
            };
        }
        if (p === '/docs') return { _rawText: true, content: contractText() };
        if (p === '/versions') return read.versions(query);
        if (p === '/bundle') return read.bundle(query);
        if (p === '/document-url') return read.documentUrl(query);
        if (p === '/contributions') return contributions.list(query);
        const feed = /^\/feed\/([a-z-]+)$/.exec(p);
        if (feed) return read.feed(feed[1], query);
    } else if (method === 'POST') {
        if (p === '/contributions/upload-url') return contributions.uploadUrl(body);
        if (p === '/contributions') return contributions.contribute(body);
        if (p === '/contributions/withdraw') return contributions.withdraw(body);
    }
    return null;
}

function respond(resp, isStandardHttp, statusCode, headers, body, isBase64, acceptEnc) {
    let out = { statusCode, headers, body, isBase64Encoded: isBase64 };
    // Gzip whenever asked and worth it. The path from this gateway to Curia's host is shaped to a
    // few KB/s once a response runs long (measured 2026-09-20), and twin JSON compresses 6-10x.
    if (!isBase64 && /gzip/i.test(acceptEnc || '') && Buffer.byteLength(body) >= 4096) {
        const gz = zlib.gzipSync(body);
        out = { statusCode, headers: { ...headers, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' }, body: gz.toString('base64'), isBase64Encoded: true };
    }
    if (isStandardHttp) {
        resp.setStatusCode(out.statusCode);
        Object.entries(out.headers).forEach(([k, v]) => resp.setHeader(k, v));
        resp.send(out.isBase64Encoded ? Buffer.from(out.body, 'base64') : out.body);
        return;
    }
    return out;
}

exports.handler = async (req, resp) => {
    const isStandardHttp = !!(resp && typeof resp.send === 'function');
    const ev = parseEvent(req);
    const json = { 'Content-Type': 'application/json' };
    const acceptEnc = header(ev.headers, 'accept-encoding');

    const scope = scopeOf(header(ev.headers, 'authorization'));
    if (!scope) return respond(resp, isStandardHttp, 401, json, JSON.stringify({ success: false, reason: 'unauthorized' }), false, '');
    // A valid token outside its own scope is refused, not routed: the viva-ag bearer cannot read the
    // mirror feeds or the extraction queue, and the other two likewise.
    if (scopeOfPath(ev.path) !== scope) {
        return respond(resp, isStandardHttp, 403, json, JSON.stringify({ success: false, reason: 'forbidden' }), false, '');
    }
    try {
        if (ev.method !== 'GET' && ev.body.__unparseable) {
            return respond(resp, isStandardHttp, 200, json, JSON.stringify(fail(REASONS.MISSING_PARAMS, 'request body is not JSON')), false, '');
        }
        const route = scope === 'viva-ag' ? routeVivaAg : scope === 'doc-extract' ? routeDocExtract : routeTwin;
        const result = await route(ev);
        if (!result) {
            return respond(resp, isStandardHttp, 404, json, JSON.stringify({ success: false, reason: REASONS.NOT_FOUND, error: `no route ${ev.method} ${ev.path}` }), false, '');
        }
        const { statusCode, _rawText, _rawBinary, contentType, content, ...payload } = result;
        if (_rawText) return respond(resp, isStandardHttp, statusCode || 200, { 'Content-Type': 'text/markdown; charset=utf-8' }, content || '', false, acceptEnc);
        if (_rawBinary) return respond(resp, isStandardHttp, statusCode || 200, { 'Content-Type': contentType || 'application/octet-stream' }, content || '', true, '');
        return respond(resp, isStandardHttp, statusCode || 200, json, JSON.stringify(payload), false, acceptEnc);
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'twin request failed', scope, path: ev.path, method: ev.method, error: err.message }));
        return respond(resp, isStandardHttp, 200, json, JSON.stringify(fail(REASONS.INTERNAL_ERROR, err.message)), false, '');
    }
};

exports._internals = { scopeOf, scopeOfPath, parseEvent, VIVA_AG_ALLOWED_PATHS, DOC_EXTRACT_ALLOWED_PATHS };
