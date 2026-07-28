const certRenderer = require('./lib/certRenderer');

function jsonResponse(statusCode, body, headers = {}) {
  return {
    isBase64Encoded: false,
    statusCode,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Content-Type': 'application/json',
      ...headers,
    },
    body: statusCode === 204 ? '' : JSON.stringify(body),
  };
}

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

function requireBearer(event) {
  const expected = process.env.API_BEARER_TOKEN;
  if (!expected) {
    return { ok: false, response: jsonResponse(500, { success: false, error: 'API_BEARER_TOKEN not configured' }) };
  }
  const authHeader = getHeader(event.headers || {}, 'authorization');
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (token !== expected) {
    return { ok: false, response: jsonResponse(401, { success: false, error: 'Unauthorized' }) };
  }
  return { ok: true };
}

exports.handler = async (req, resp) => {
  const isStandardHttp = resp && typeof resp.send === 'function';
  let event = req;

  if (Buffer.isBuffer(req)) {
    event = JSON.parse(req.toString('utf8'));
  }

  const rawPath = event.rawPath || event.path || event.requestContext?.http?.path || req.path || '/';
  const method = event.requestContext?.http?.method || event.httpMethod || event.method || req.method || 'POST';

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

  const auth = requireBearer(event);
  if (!auth.ok) return finish(auth.response);

  try {
    if (method === 'POST' && rawPath.endsWith('/generate-certificate')) {
      let body = event.body || '';
      if (event.isBase64Encoded && body) body = Buffer.from(body, 'base64').toString('utf8');
      const { certification, issuedCert, nickname } = parseBody(body);
      if (!certification || !issuedCert) {
        return finish(jsonResponse(400, { success: false, error: 'certification and issuedCert are required' }));
      }
      const key = await certRenderer.generateAndUploadCertificateImage({ certification, issuedCert, nickname });
      return finish(jsonResponse(200, { success: true, key }));
    }

    return finish(jsonResponse(404, { success: false, error: `Unknown route: ${method} ${rawPath}` }));
  } catch (err) {
    return finish(jsonResponse(500, { success: false, error: err.message }));
  }
};
