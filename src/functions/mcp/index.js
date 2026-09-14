'use strict';

/**
 * nano-mcp-dev — read-only MCP server over the nano + GCN DEV databases.
 *
 * Aliyun FC 3.0 HTTP-trigger handler (event-function model, see the fc3-handler-reference
 * skill). Implements stateless MCP Streamable HTTP:
 *
 *   POST   /mcp          JSON-RPC in, JSON out (202 for notification-only bodies)
 *   GET    /mcp          405 — no SSE stream / sessions in stateless mode
 *   DELETE /mcp          405
 *   GET    /mcp/health   {ok:true}, unauthenticated, touches no database
 *
 * Auth: `Authorization: Bearer <MCP_API_TOKEN>` on everything except /mcp/health. Dev only —
 * lib/db.js refuses any database whose name does not end in `_dev`, and there is no `mcp`
 * block in s-prod.yaml.
 */

const crypto = require('crypto');
const { createServer } = require('./lib/tools');
const { runJsonRpc, rpcError } = require('./lib/transport');

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, Mcp-Session-Id, MCP-Protocol-Version',
    'Access-Control-Expose-Headers': 'Mcp-Session-Id, MCP-Protocol-Version',
};

function respond(statusCode, body, extraHeaders = {}) {
    return {
        statusCode,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, ...extraHeaders },
        body: body === undefined ? '' : JSON.stringify(body),
        isBase64Encoded: false,
    };
}

function headerValue(headers, name) {
    if (!headers) return '';
    const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
    return key ? String(headers[key]) : '';
}

function tokenMatches(presented, expected) {
    if (!presented || !expected) return false;
    const a = Buffer.from(presented);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function isAuthorized(event) {
    const expected = process.env.MCP_API_TOKEN || '';
    if (!expected) return false; // never run open
    const auth = headerValue(event.headers, 'authorization');
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    return tokenMatches(token, expected);
}

function decodeBody(event) {
    let body = event.body || '';
    if (event.isBase64Encoded && body) body = Buffer.from(body, 'base64').toString('utf8');
    return body;
}

async function handleEvent(event) {
    const path = (event.rawPath || '/').replace(/\/+$/, '') || '/';
    const method = (event.requestContext && event.requestContext.http && event.requestContext.http.method) || 'GET';

    if (method === 'OPTIONS') return { statusCode: 204, headers: CORS_HEADERS, body: '', isBase64Encoded: false };

    if (path === '/mcp/health') {
        return respond(200, { ok: true, service: 'nano-mcp-dev', time: new Date().toISOString() });
    }

    if (path !== '/mcp') return respond(404, { error: 'not_found' });

    if (!isAuthorized(event)) {
        return respond(401, rpcError(null, -32001, 'Unauthorized: send Authorization: Bearer <MCP_API_TOKEN>.'), {
            'WWW-Authenticate': 'Bearer realm="nano-mcp"',
        });
    }

    if (method === 'GET' || method === 'DELETE') {
        return respond(405, rpcError(null, -32000, 'Method not allowed: this server is stateless (no SSE stream, no sessions). Use POST.'), {
            Allow: 'POST, OPTIONS',
        });
    }
    if (method !== 'POST') return respond(405, rpcError(null, -32000, 'Method not allowed.'), { Allow: 'POST, OPTIONS' });

    let payload;
    try {
        payload = JSON.parse(decodeBody(event));
    } catch (err) {
        return respond(400, rpcError(null, -32700, `Parse error: ${err.message}`));
    }

    const timeoutMs = Number(process.env.MCP_REQUEST_TIMEOUT_MS) || 80000;
    const { status, body } = await runJsonRpc(createServer, payload, { timeoutMs });
    return respond(status, body);
}

exports.handler = async (req) => {
    // FC 3.0 hands the HTTP event over as a Buffer of JSON (the worker normalises it the same
    // way); local.js passes the parsed object directly. Accept both.
    let event = req;
    if (Buffer.isBuffer(req)) {
        try { event = JSON.parse(req.toString('utf8')); } catch (_) { event = {}; }
    } else if (typeof req === 'string') {
        try { event = JSON.parse(req); } catch (_) { event = {}; }
    }
    try {
        return await handleEvent(event);
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'mcp handler failed', error: err.message, stack: err.stack }));
        return respond(500, rpcError(null, -32603, 'Internal error.'));
    }
};

exports.handleEvent = handleEvent;
