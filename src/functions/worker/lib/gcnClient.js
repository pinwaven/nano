// Server-to-server client for calling GCN's auth API (currently: explicit partner store
// provisioning). Mirrors GCN's own nanoClient.js shape. Uses a scoped nano→GCN service
// token — distinct from API_BEARER_TOKEN, which is the credential GCN uses to call nano and
// must not be reused in this direction.

const BASE_URL = process.env.GCN_API_BASE_URL || '';
const TOKEN = process.env.GCN_SERVICE_TOKEN || '';

async function gcnFetch(path, { method = 'GET', body } = {}) {
    if (!BASE_URL || !TOKEN) {
        throw new Error('GCN_API_BASE_URL/GCN_SERVICE_TOKEN not configured');
    }
    const res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${TOKEN}`,
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch (e) { data = {}; }
    if (!res.ok) {
        const err = new Error(data.error || `GCN API ${method} ${path} failed: ${res.status}`);
        err.status = res.status;
        err.body = data;
        throw err;
    }
    return data;
}

module.exports = { gcnFetch };
