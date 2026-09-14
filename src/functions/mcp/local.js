'use strict';

/**
 * Local dev server: `npm run mcp:local` (from the repo root) → http://localhost:3010/mcp
 *
 * Adapts a plain Node HTTP request into the FC 3.0 event shape and runs the exact same
 * handler the deployed function runs, so what you test with MCP Inspector / curl is what
 * ships. Reads DB credentials from the repo-root `.env` (DATABASE_URL for nano, plus
 * GCN_DB_PASS) and MCP_API_TOKEN — see docs/architecture/mcp-server.md.
 */

const http = require('http');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

// Derive the per-database env the FC config injects from the root .env's dev URL.
function applyEnvFromDatabaseUrl() {
    if (process.env.NANO_DB_NAME) return; // already configured explicitly
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL (nano dev) missing from .env');
    const u = new URL(url);
    process.env.DB_HOST = process.env.DB_HOST || u.hostname;
    process.env.DB_PORT = process.env.DB_PORT || u.port || '5432';
    process.env.DB_SSL = process.env.DB_SSL || 'false';
    process.env.NANO_DB_NAME = u.pathname.replace(/^\//, '');
    process.env.NANO_DB_USER = decodeURIComponent(u.username);
    process.env.NANO_DB_PASS = decodeURIComponent(u.password);
    process.env.GCN_DB_NAME = process.env.GCN_DB_NAME || 'gcn_db_dev';
    process.env.GCN_DB_USER = process.env.GCN_DB_USER || 'gcn_admin';
    if (!process.env.GCN_DB_PASS) throw new Error('GCN_DB_PASS missing from .env (copy DB_PASS from the gcn repo .env)');
}

applyEnvFromDatabaseUrl();
if (!process.env.MCP_API_TOKEN) throw new Error('MCP_API_TOKEN missing from .env');

const { handler } = require('./index');

const PORT = Number(process.env.MCP_LOCAL_PORT) || 3010;

http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
        const url = new URL(req.url, `http://localhost:${PORT}`);
        const event = {
            version: 'v1',
            rawPath: url.pathname,
            headers: req.headers,
            queryParameters: Object.fromEntries(url.searchParams),
            body: Buffer.concat(chunks).toString('base64'),
            isBase64Encoded: true,
            requestContext: { http: { method: req.method } },
        };
        const out = await handler(event, {}, {});
        res.writeHead(out.statusCode, out.headers);
        res.end(out.isBase64Encoded ? Buffer.from(out.body, 'base64') : out.body);
    });
}).listen(PORT, '127.0.0.1', () => {
    console.error(`nano-mcp local: http://127.0.0.1:${PORT}/mcp  (health: /mcp/health)`);
});
