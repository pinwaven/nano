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

// Same budget and the same never-throws contract as the catalog fetch above, for the same
// reason: this sits inline in the Formulate-Dots turn, and not knowing whether an order is
// waiting must cost the user a CTA, never their formulation.
const ORDER_STATUS_TIMEOUT_MS = 4000;

// Does this user have a paid 28-day package sitting at 'awaiting_formulation'?
//
// Deliberately PULLED at the moment it matters rather than pushed and cached on the user row: an
// order can be refunded or cancelled, and a stamped flag has nothing to reconcile it against. The
// cost of asking is one 4s-capped call; the cost of being wrong is offering to sell someone
// something they already bought, or offering to fulfil an order that no longer exists.
//
// NEVER THROWS. Returns null on any failure, which every caller treats as "no order waiting" —
// i.e. it degrades to the buy CTA, the safe direction: a user who really has a paid order sees a
// buy button they can ignore, rather than a submit button that would fail against GCN.
async function fetchFormulationOrderStatus(nanoUserId) {
    if (!nanoUserId || !BASE_URL || !TOKEN) return null;
    const timer = AbortSignal.timeout ? AbortSignal.timeout(ORDER_STATUS_TIMEOUT_MS) : undefined;
    try {
        const res = await fetch(
            `${BASE_URL}/api/mall/nano/formulation-order-status?nano_user_id=${encodeURIComponent(nanoUserId)}`,
            { headers: { authorization: `Bearer ${TOKEN}` }, signal: timer }
        );
        if (!res.ok) return null;
        const data = await res.json();
        if (!data || !data.awaiting_formulation) return null;
        return {
            order_id: data.order_id || null,
            // 'fast_track' — no expert review; the chat tool's own formula is compounded as-is.
            // 'expert_review' — the premium AG package; Viva AG formulates it and an expert signs
            //                   it off, so the chat tool must not try to fulfil it.
            fulfillment: data.fulfillment === 'fast_track' ? 'fast_track' : 'expert_review',
            ordered_at: data.ordered_at || null,
            // The purchased tier: how many distinct dots this package's formula may contain
            // (GCN's migration_0085). null for the two older formulation products, which have no
            // tier — read as "unlimited", which is what they were.
            //
            // GCN reports it; nano enforces it. The rule needs the dots formulary and the product
            // model's own judgement about which components a tier counts (DOT-N7 is excluded, see
            // _capDistinctDots), and neither of those belongs on the other side of the wire.
            max_distinct_dots: Number.isFinite(Number(data.max_distinct_dots)) && Number(data.max_distinct_dots) > 0
                ? Number(data.max_distinct_dots)
                : null,
            package_name: data.package_name || null,
        };
    } catch (err) {
        console.log(JSON.stringify({ level: 'WARN', msg: 'gcn_formulation_order_status_failed', error: err.message }));
        return null;
    }
}

// Hands a fast-track formula to GCN so the paid order can go to compounding. Unlike the two
// fetches above this one MAY throw: it is called from an explicit user action ("confirm this
// formula") whose entire purpose is the call, so a failure has to reach the user rather than be
// swallowed into a silent no-op.
async function submitFastTrackFormulation(payload) {
    return gcnFetch('/api/mall/nano/formulation-fasttrack', { method: 'POST', body: payload });
}

module.exports = { gcnFetch, fetchAiCatalog, fetchFormulationOrderStatus, submitFastTrackFormulation };
