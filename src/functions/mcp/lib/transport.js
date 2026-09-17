'use strict';

/**
 * Stateless Streamable-HTTP-over-FC adapter.
 *
 * FC 3.0 HTTP triggers are EVENT functions (see the fc3-handler-reference skill): the handler
 * gets a plain event object and RETURNS the response. There is no Node IncomingMessage /
 * ServerResponse, so the SDK's `StreamableHTTPServerTransport` cannot be used. Stateless
 * Streamable HTTP is small enough to implement on the SDK's public `Transport` interface:
 * per HTTP request, connect a fresh McpServer to an in-memory transport, feed the JSON-RPC
 * message(s) in, collect what the server `send()`s, hand it back as the HTTP body.
 *
 * This is what the SDK's own stateless mode does internally (new server + transport per
 * request), which is also why `tools/call` works without a prior `initialize` on this
 * instance.
 */

class InMemoryTransport {
    constructor() {
        this.onmessage = undefined;
        this.onclose = undefined;
        this.onerror = undefined;
        this._waiters = new Map(); // id -> resolve
        this._closed = false;
    }

    async start() { /* nothing to open */ }

    async send(message) {
        if (message && Object.prototype.hasOwnProperty.call(message, 'id') && this._waiters.has(String(message.id))) {
            this._waiters.get(String(message.id))(message);
            this._waiters.delete(String(message.id));
        }
        // Server-initiated requests/notifications (logging, progress) have nowhere to go in a
        // stateless JSON response; dropping them is what the SDK does in JSON-response mode.
    }

    async close() {
        if (this._closed) return;
        this._closed = true;
        if (this.onclose) this.onclose();
    }

    /** Resolves with the response the server eventually `send()`s for `id`. */
    waitFor(id) {
        return new Promise((resolve) => this._waiters.set(String(id), resolve));
    }
}

function isRequest(msg) {
    return msg && typeof msg === 'object' && typeof msg.method === 'string' && Object.prototype.hasOwnProperty.call(msg, 'id');
}

function isNotification(msg) {
    return msg && typeof msg === 'object' && typeof msg.method === 'string' && !Object.prototype.hasOwnProperty.call(msg, 'id');
}

/**
 * Run one HTTP request's worth of JSON-RPC messages through a fresh server.
 *
 * @param {() => import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} createServer
 * @param {object|object[]} payload  parsed JSON body (single message or batch)
 * @param {{timeoutMs?: number, extra?: object}} [opts]
 * @returns {Promise<{status:number, body?: object|object[]}>}
 */
async function runJsonRpc(createServer, payload, opts = {}) {
    const timeoutMs = opts.timeoutMs || 80000;
    const messages = Array.isArray(payload) ? payload : [payload];
    if (messages.length === 0) return { status: 400, body: rpcError(null, -32600, 'Invalid Request: empty batch.') };

    for (const m of messages) {
        if (!m || typeof m !== 'object' || m.jsonrpc !== '2.0' || typeof m.method !== 'string') {
            return { status: 400, body: rpcError(m && m.id !== undefined ? m.id : null, -32600, 'Invalid Request: expected JSON-RPC 2.0 request or notification.') };
        }
    }

    const requests = messages.filter(isRequest);
    const notifications = messages.filter(isNotification);

    const transport = new InMemoryTransport();
    const server = createServer();
    await server.connect(transport);

    let timer;
    try {
        const pending = requests.map((r) => transport.waitFor(r.id));
        for (const m of notifications) transport.onmessage(m, opts.extra);
        for (const m of requests) transport.onmessage(m, opts.extra);

        if (requests.length === 0) return { status: 202 };

        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`MCP request timed out after ${timeoutMs}ms`)), timeoutMs);
        });
        const responses = await Promise.race([Promise.all(pending), timeout]);
        return { status: 200, body: Array.isArray(payload) ? responses : responses[0] };
    } catch (err) {
        return {
            status: 200,
            body: Array.isArray(payload)
                ? requests.map((r) => rpcError(r.id, -32000, err.message))
                : rpcError(requests[0].id, -32000, err.message),
        };
    } finally {
        clearTimeout(timer);
        try { await server.close(); } catch (_) { /* ignore */ }
    }
}

function rpcError(id, code, message) {
    return { jsonrpc: '2.0', id: id === undefined ? null : id, error: { code, message } };
}

module.exports = { InMemoryTransport, runJsonRpc, rpcError };
