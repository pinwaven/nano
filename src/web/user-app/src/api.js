// HTTP client mirroring the miniapp's utils/request.js (typed errors) and main.js:_req
// (sandbox injection, per-call timeout). Identity is the signed-in user's own session
// (session.js); the `openid`/`user_id` params still name whose data, and the server checks
// that the session may act for that user.
import axios from 'axios';
import { API } from './config.js';
import { getSessionToken, reportAuthFailure } from './session.js';

export class RequestError extends Error {
  constructor(kind, message, statusCode, data) {
    super(message);
    this.name = 'RequestError';
    this.kind = kind; // 'auth' | 'server' | 'network' | 'client'
    this.statusCode = statusCode;
    this.data = data;
  }
}

const state = { sandbox: false };
export function setSandboxMode(on) { state.sandbox = !!on; }

const http = axios.create({
  baseURL: API,
  headers: { 'Content-Type': 'application/json' },
  validateStatus: () => true,
});
http.interceptors.request.use(cfg => {
  const token = getSessionToken();
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});
http.interceptors.response.use(res => {
  if (res.status === 401) reportAuthFailure();
  return res;
});

/**
 * req('/chat', 'POST', body, { timeoutMs, raw })
 * Resolves the JSON body for 2xx; with `raw:true` resolves `{statusCode, data}` for any status
 * (the miniapp's _req shape — used where a handler encodes its answer in a non-2xx body).
 */
export async function req(path, method = 'GET', data = null, { timeoutMs = 60000, raw = false, headers } = {}) {
  const m = String(method).toUpperCase();
  if (state.sandbox && m !== 'GET') data = { ...(data || {}), sandbox: true };
  let res;
  try {
    res = await http.request({ url: path, method: m, data: m === 'GET' ? undefined : data, timeout: timeoutMs, headers });
  } catch (e) {
    throw new RequestError('network', e?.message || 'network error');
  }
  if (raw) return { statusCode: res.status, data: res.data };
  if (res.status >= 200 && res.status < 300) return res.data;
  const kind = res.status === 401 || res.status === 403 ? 'auth' : res.status >= 500 ? 'server' : 'client';
  throw new RequestError(kind, `HTTP ${res.status}`, res.status, res.data);
}

export const api = {
  get: (path, opts) => req(path, 'GET', null, opts),
  post: (path, data, opts) => req(path, 'POST', data, opts),
  put: (path, data, opts) => req(path, 'PUT', data, opts),
  patch: (path, data, opts) => req(path, 'PATCH', data, opts),
  del: (path, data, opts) => req(path, 'DELETE', data, opts),
};

export const q = v => encodeURIComponent(v == null ? '' : String(v));

// Raw PUT to a presigned OSS URL. The waven-nano bucket refuses content-type overrides, so the
// body goes up with EXACTLY the content type the presign returned (CLAUDE.md §35).
export async function putToOss(putUrl, body, contentType) {
  const res = await fetch(putUrl, { method: 'PUT', body, headers: { 'Content-Type': contentType } });
  if (!res.ok) throw new RequestError('server', `OSS PUT ${res.status}`, res.status);
  return true;
}

export const clipboard = {
  async write(text) {
    try { await navigator.clipboard.writeText(String(text ?? '')); return true; } catch { return false; }
  },
};
