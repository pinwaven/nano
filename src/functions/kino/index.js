const { pool } = require('./lib/db');
const crypto = require('crypto');
const { handleActivateMachine } = require('./lib/activation');
const { handleProtectedDeviceRequest } = require('./lib/deviceAuth');
const { handleDeviceBusinessRequest } = require('./lib/deviceHandlers');
const { handleListMachines, handleUpdateMachine } = require('./lib/machineManagement');
const { handleCreateMachineBatch } = require('./lib/machines');
const { handleExchangeToken } = require('./lib/tokenExchange');

function getHeader(headers = {}, name) {
  const target = name.toLowerCase();
  const key = Object.keys(headers).find((h) => h.toLowerCase() === target);
  return key ? headers[key] : '';
}

function parseBody(body) {
  if (!body) return {};
  try {
    if (Buffer.isBuffer(body)) return JSON.parse(body.toString('utf8'));
    if (typeof body === 'string') return JSON.parse(body);
  } catch {
    return {};
  }
  return body;
}

function jsonResponse(statusCode, body, headers = {}) {
  return {
    isBase64Encoded: false,
    statusCode,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Content-Type': 'application/json',
      ...headers,
    },
    body: statusCode === 204 ? '' : JSON.stringify(body),
  };
}

function normalizePath(rawPath = '') {
  return rawPath.replace(/^\/kino/, '') || '/';
}

// A superadmin web-panel session (`sa.`), minted by the worker's /admin/login and signed with
// TOKEN_SIGNING_SECRET — same format as worker/lib/auth.js's verifyToken, copied because each
// FC function ships its own code. The panel's Hardware tab calls this function with it.
function verifySuperadminSession(token) {
  const secret = process.env.TOKEN_SIGNING_SECRET;
  if (!secret || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'sa') return null;
  const expected = crypto.createHmac('sha256', secret).update(`sa.${parts[1]}`).digest('hex');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(parts[2], 'hex'), Buffer.from(expected, 'hex'))) return null;
    const data = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    return data.exp > Math.floor(Date.now() / 1000) ? data : null;
  } catch {
    return null;
  }
}

function requireAdminBearer(event) {
  const expected = process.env.API_BEARER_TOKEN;
  const authHeader = getHeader(event.headers || {}, 'authorization');
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (verifySuperadminSession(token)) return { ok: true };
  if (!expected) {
    return { ok: false, response: jsonResponse(500, { success: false, error: 'API_BEARER_TOKEN not configured' }) };
  }
  if (token !== expected) {
    return { ok: false, response: jsonResponse(401, { success: false, error: 'Unauthorized' }) };
  }

  return { ok: true };
}

function timingSafeStringEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function requireActivationBearer(event) {
  const expected = process.env.KINO_ACTIVATION_TOKEN;
  if (!expected) {
    return { ok: false, response: jsonResponse(500, { success: false, error: 'KINO_ACTIVATION_TOKEN not configured' }) };
  }

  const authHeader = getHeader(event.headers || {}, 'authorization');
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!timingSafeStringEqual(token, expected)) {
    return { ok: false, response: jsonResponse(401, { success: false, error: 'Unauthorized' }) };
  }

  return { ok: true };
}

function getBearerToken(event) {
  const authHeader = getHeader(event.headers || {}, 'authorization');
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
}

function getQuery(event = {}, req = {}) {
  return event.queryStringParameters || event.queryParameters || event.query || req.query || req.queries || {};
}

function isProtectedDeviceRoute(method, path) {
  return (
    (method === 'GET' && path === '/device/me') ||
    (method === 'POST' && path === '/kino-machines/info') ||
    (method === 'GET' && path === '/kino-chip') ||
    (method === 'GET' && path === '/biomarkers') ||
    (method === 'POST' && path === '/biomarkers') ||
    (method === 'POST' && path === '/kino-result') ||
    (method === 'POST' && path === '/kino-curve') ||
    (method === 'GET' && path === '/kino-upgrade')
  );
}

exports.handler = async (req, resp) => {
  const isStandardHttp = resp && typeof resp.send === 'function';
  let event = req;

  if (Buffer.isBuffer(req)) {
    event = JSON.parse(req.toString('utf8'));
  }

  const rawPath = event.rawPath || event.path || event.requestContext?.http?.path || req.path || '/';
  const path = normalizePath(rawPath);
  const method = event.httpMethod || event.method || event.requestContext?.http?.method || req.method || 'POST';

  const finish = (payload) => {
    if (!isStandardHttp) return payload;
    resp.setStatusCode(payload.statusCode);
    Object.entries(payload.headers || {}).forEach(([key, value]) => resp.setHeader(key, value));
    resp.send(payload.body);
    return undefined;
  };

  if (method === 'OPTIONS') {
    return finish(jsonResponse(204, {}));
  }

  try {
    let result;

    if (method === 'GET' && path === '/kino-machines') {
      const auth = requireAdminBearer(event);
      if (!auth.ok) return finish(auth.response);
      result = await handleListMachines({ pool, query: getQuery(event, req) });
    } else if (method === 'POST' && path === '/kino-machines/batch') {
      const auth = requireAdminBearer(event);
      if (!auth.ok) return finish(auth.response);
      result = await handleCreateMachineBatch({ pool, body: parseBody(event.body) });
    } else if (method === 'PUT' && path.match(/^\/kino-machines\/[^/]+$/)) {
      const auth = requireAdminBearer(event);
      if (!auth.ok) return finish(auth.response);
      const machineNo = decodeURIComponent(path.match(/^\/kino-machines\/([^/]+)$/)[1]);
      result = await handleUpdateMachine({ pool, machineNo, body: parseBody(event.body) });
    } else if (method === 'POST' && path === '/activate') {
      const auth = requireActivationBearer(event);
      if (!auth.ok) return finish(auth.response);
      result = await handleActivateMachine({ pool, body: parseBody(event.body) });
    } else if (method === 'POST' && path === '/token/exchange') {
      result = await handleExchangeToken({ pool, rootToken: getBearerToken(event) });
    } else if (isProtectedDeviceRoute(method, path)) {
      result = await handleProtectedDeviceRequest({
        pool,
        commToken: getBearerToken(event),
        event,
        handler: ({ machine }) => handleDeviceBusinessRequest({
          pool,
          method,
          path,
          event,
          machine,
          body: parseBody(event.body),
          query: getQuery(event, req),
        }),
      });
    } else {
      result = { statusCode: 404, success: false, error: `Unknown route: ${method} ${path}` };
    }

    return finish(jsonResponse(result.statusCode || 200, result));
  } catch (err) {
    return finish(jsonResponse(500, { success: false, error: err.message }));
  }
};

module.exports._private = {
  normalizePath,
  parseBody,
  getQuery,
  getBearerToken,
  isProtectedDeviceRoute,
  requireActivationBearer,
  requireAdminBearer,
};
