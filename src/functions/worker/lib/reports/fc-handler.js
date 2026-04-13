'use strict';

/**
 * Aliyun Function Compute 3 — nodejs18 HTTP trigger adapter.
 *
 * IMPORTANT: FC3 always delivers the event as a Buffer containing the JSON string,
 * regardless of HTTP method. Must parse before accessing fields.
 *
 * Event JSON shape:
 *   { version, rawPath, headers, queryParameters, body, isBase64Encoded, requestContext }
 *
 * Response shape:
 *   { statusCode, headers, body }
 *
 * Strategy: parse Buffer → proxy to a local Express instance → return FC response.
 */

const http = require('http');
const app  = require('./server');  // Express app (no port bound — uses require.main guard)

let localPort = null;

function ensureServer() {
  if (localPort) return Promise.resolve(localPort);
  return new Promise((resolve, reject) => {
    const srv = http.createServer(app);
    srv.listen(0, '127.0.0.1', () => { localPort = srv.address().port; resolve(localPort); });
    srv.on('error', reject);
  });
}

module.exports.handler = async (eventBuf, context) => {
  // FC3 always sends the event as a Buffer containing a JSON string — parse it first
  const event = JSON.parse(Buffer.from(eventBuf).toString('utf8'));

  const port    = await ensureServer();
  const method  = event.requestContext?.http?.method || 'GET';
  const rawPath = event.rawPath || '/';
  const qs      = event.queryParameters && Object.keys(event.queryParameters).length
    ? '?' + new URLSearchParams(event.queryParameters).toString() : '';
  const url     = rawPath + qs;
  const headers = { ...(event.headers || {}) };

  // Decode body (FC may base64-encode it)
  let bodyBuf = null;
  if (event.body) {
    bodyBuf = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64')
      : Buffer.from(event.body, 'utf8');
    headers['content-length'] = String(bodyBuf.length);
  }

  return new Promise((resolve, reject) => {
    const proxyReq = http.request(
      { hostname: '127.0.0.1', port, path: url, method, headers },
      (proxyResp) => {
        const chunks = [];
        proxyResp.on('data', c => chunks.push(c));
        proxyResp.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          const respHeaders = { ...proxyResp.headers };
          delete respHeaders['transfer-encoding'];
          delete respHeaders['connection'];
          resolve({ statusCode: proxyResp.statusCode, headers: respHeaders, body });
        });
        proxyResp.on('error', reject);
      }
    );
    proxyReq.on('error', reject);
    if (bodyBuf) proxyReq.write(bodyBuf);
    proxyReq.end();
  });
};
