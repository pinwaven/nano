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

// How long to wait on GCN before giving up on a product catalog. This call sits inline in a chat
// turn's pre-fetch bundle, so a slow neighbour must not hold the whole turn hostage — a missing
// catalog costs the user a product suggestion, a stalled turn costs them their answer.
const AI_CATALOG_TIMEOUT_MS = 4000;

// The AI-recommendable slice of a nano user's own bound GCN storefront (GCN's
// handleNanoAiCatalog). Store-scoped, because recommending an item the user's bound store does
// not list would dead-end them on an empty product grid.
//
// NEVER THROWS. Any failure — unconfigured credentials, GCN down, a timeout, a malformed
// response — degrades to []. Following lib/twinBundle.js's convention: a dead source degrades
// its own section rather than failing the thing it is part of. Commerce is the most droppable
// content in a health conversation.
async function fetchAiCatalog(nanoUserId, sectorId = 'aeviva') {
    if (!nanoUserId || !BASE_URL || !TOKEN) return [];
    const timer = AbortSignal.timeout ? AbortSignal.timeout(AI_CATALOG_TIMEOUT_MS) : undefined;
    try {
        const res = await fetch(
            `${BASE_URL}/api/mall/nano/ai-catalog?sector_id=${encodeURIComponent(sectorId)}&nano_user_id=${encodeURIComponent(nanoUserId)}`,
            { headers: { authorization: `Bearer ${TOKEN}` }, signal: timer }
        );
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data?.items) ? data.items : [];
    } catch (err) {
        console.log(JSON.stringify({ level: 'WARN', msg: 'gcn_ai_catalog_fetch_failed', error: err.message }));
        return [];
    }
}

module.exports = { gcnFetch, fetchAiCatalog };
