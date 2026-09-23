'use strict';
/**
 * twin — the digital twin's other home.
 *
 * Nano keeps every user's twin; an external holder (Curia) keeps a replica, and both sides change
 * it. This function is the whole of that exchange and nothing else, so it deploys without
 * touching the worker and a worker deploy cannot break it:
 *
 *   read   GET  /api/twin/versions            which subjects changed since a time
 *          GET  /api/twin/bundle              one subject's twin, as a job would receive it
 *          GET  /api/twin/feed/<name>         incremental upserts + deletes of one bulk table
 *          GET  /api/twin/document-url        re-mint one document's download URL
 *   write  POST /api/twin/contributions/upload-url
 *          POST /api/twin/contributions       a report (and later: observations, findings)
 *          POST /api/twin/contributions/withdraw
 *          GET  /api/twin/contributions       what was contributed for one subject
 *   meta   GET  /api/twin/ping, /api/twin/docs
 *
 * Every subject is named by subject_ref and nothing else: no response carries a user_id, openid,
 * phone or nickname. Auth is one bearer, TWIN_API_TOKEN, distinct per environment and distinct
 * from the viva-ag and doc-extract tokens — this one reads every subject's twin and writes to it,
 * which is more than either of those can do, and a leak of either must not open this.
 * docs/architecture/twin-function.md is the design; GET /api/twin/docs is the contract.
 */
const crypto = require('crypto');
const zlib = require('zlib');
const read = require('./lib/read');
const contributions = require('./lib/contributions');
const { CONTRACT_VERSION, contractText } = require('./lib/contract');
const { fail, REASONS } = require('./lib/reasons');
const { pool } = require('./lib/db');

const SHARED_CODE = (() => {
    // Which build of the shared bundle code this is. Two deploy units running different builds hash
    // one twin two ways; exposing this makes that visible from /ping instead of from a replica
    // that suddenly refetches everything.
    const fs = require('fs');
    const path = require('path');
    const h = crypto.createHash('sha256');
    for (const f of fs.readdirSync(path.join(__dirname, 'shared')).sort()) {
        if (f.endsWith('.js')) h.update(f).update(fs.readFileSync(path.join(__dirname, 'shared', f)));
    }
    return h.digest('hex').slice(0, 12);
})();

function tokenOk(header) {
    const expected = process.env.TWIN_API_TOKEN || '';
    const m = /^Bearer\s+(.+)$/i.exec(String(header || '').trim());
    if (!expected || !m) return false;
    const a = Buffer.from(m[1].trim());
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

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

const header = (h, name) => h[name] ?? h[name.toLowerCase()] ?? h[name.replace(/(^|-)([a-z])/g, (_, d, c) => d + c.toUpperCase())];

async function route({ path, method, query, body }) {
    if (method === 'GET' && path === '/ping') {
        await pool.query('SELECT 1');
        return {
            success: true, service: 'twin', environment: process.env.TWIN_ENV || null,
            contract_version: CONTRACT_VERSION, bundle_version: read.BUNDLE_VERSION, shared_code: SHARED_CODE,
            feeds: Object.keys(read.FEEDS), contribution_kinds: [...contributions.KINDS_ACCEPTED],
            settle_seconds: read.SETTLE_SECONDS,
        };
    }
    if (method === 'GET' && path === '/docs') return { _text: contractText() };
    if (method === 'GET' && path === '/versions') return read.versions(query);
    if (method === 'GET' && path === '/bundle') return read.bundle(query);
    if (method === 'GET' && path === '/document-url') return read.documentUrl(query);
    const feed = /^\/feed\/([a-z-]+)$/.exec(path);
    if (method === 'GET' && feed) return read.feed(feed[1], query);
    if (body.__unparseable) return fail(REASONS.MISSING_PARAMS, 'request body is not JSON');
    if (method === 'POST' && path === '/contributions/upload-url') return contributions.uploadUrl(body);
    if (method === 'POST' && path === '/contributions') return contributions.contribute(body);
    if (method === 'POST' && path === '/contributions/withdraw') return contributions.withdraw(body);
    if (method === 'GET' && path === '/contributions') return contributions.list(query);
    return { _status: 404, success: false, reason: REASONS.NOT_FOUND, error: `no route ${method} ${path}` };
}

function respond(resp, isStandardHttp, statusCode, headers, bodyStr, acceptEnc) {
    let out = { statusCode, headers, body: bodyStr, isBase64Encoded: false };
    // Gzip whenever asked and worth it. The path from this gateway to the replica's host is shaped
    // to a few KB/s once a response runs long (measured 2026-09-20), and twin JSON compresses 6-10x.
    if (/gzip/i.test(acceptEnc || '') && Buffer.byteLength(bodyStr) >= 4096) {
        const gz = zlib.gzipSync(bodyStr);
        out = { statusCode, headers: { ...headers, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' }, body: gz.toString('base64'), isBase64Encoded: true };
        if (isStandardHttp) { resp.setStatusCode(statusCode); Object.entries(out.headers).forEach(([k, v]) => resp.setHeader(k, v)); resp.send(gz); return; }
        return out;
    }
    if (isStandardHttp) { resp.setStatusCode(statusCode); Object.entries(headers).forEach(([k, v]) => resp.setHeader(k, v)); resp.send(bodyStr); return; }
    return out;
}

exports.handler = async (req, resp) => {
    const isStandardHttp = !!(resp && typeof resp.send === 'function');
    const ev = parseEvent(req);
    const json = { 'Content-Type': 'application/json' };
    const acceptEnc = header(ev.headers, 'accept-encoding');

    if (!tokenOk(header(ev.headers, 'authorization'))) {
        return respond(resp, isStandardHttp, 401, json, JSON.stringify({ success: false, reason: 'unauthorized' }), '');
    }
    try {
        const result = await route(ev);
        if (result && typeof result._text === 'string') {
            return respond(resp, isStandardHttp, 200, { 'Content-Type': 'text/markdown; charset=utf-8' }, result._text, acceptEnc);
        }
        const { _status, ...payload } = result;
        return respond(resp, isStandardHttp, _status || 200, json, JSON.stringify(payload), acceptEnc);
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'twin request failed', path: ev.path, method: ev.method, error: err.message }));
        return respond(resp, isStandardHttp, 200, json, JSON.stringify(fail(REASONS.INTERNAL_ERROR, err.message)), '');
    }
};

exports._internals = { tokenOk, parseEvent, route };
