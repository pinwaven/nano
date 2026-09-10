// Server-to-server client for calling GCN's auth API (currently: explicit partner store
// provisioning). Mirrors GCN's own nanoClient.js shape. Uses a scoped nano→GCN service
// token — distinct from API_BEARER_TOKEN, which is the credential GCN uses to call nano and
// must not be reused in this direction.

const BASE_URL = process.env.GCN_API_BASE_URL || '';
const TOKEN = process.env.GCN_SERVICE_TOKEN || '';

async function gcnFetch(path, { method = 'GET', body, signal } = {}) {
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
        signal,
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

// Every formulation order this user has, in every state (GCN's handleNanoFormulationOrders) —
// both the commerce half of what the Dots subtab shows and, filtered to 'awaiting_formulation',
// the answer to "is a package waiting for a recipe" that _resolveOrderContext needs.
//
// Replaced the narrower fetchFormulationOrderStatus, which asked only the second question. GCN
// still serves that older endpoint so a nano deploy landing before a GCN one cannot break the
// chat card; retire it there once nano prod is confirmed on this one.
//
// NEVER THROWS, same contract and same 4s budget as its two neighbours: a dead or slow GCN costs
// the user their order status, never their nutrition plan — this is fetched alongside the plan
// query that the Dots subtab actually depends on.
async function fetchFormulationOrders(nanoUserId) {
    if (!nanoUserId || !BASE_URL || !TOKEN) return [];
    const timer = AbortSignal.timeout ? AbortSignal.timeout(ORDER_STATUS_TIMEOUT_MS) : undefined;
    try {
        const res = await fetch(
            `${BASE_URL}/api/mall/nano/formulation-orders?nano_user_id=${encodeURIComponent(nanoUserId)}`,
            { headers: { authorization: `Bearer ${TOKEN}` }, signal: timer }
        );
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data?.orders) ? data.orders : [];
    } catch (err) {
        console.log(JSON.stringify({ level: 'WARN', msg: 'gcn_formulation_orders_failed', error: err.message }));
        return [];
    }
}

// The unredeemed 28-day dots codes this user personally owns (GCN's handleNanoFormulationCodes).
// Only codes bought in-app carry a buyer, so this is what the user can be SHOWN — a code their
// store handed them in person is still redeemable, by typing it.
//
// NEVER THROWS, same 4s budget and same reason as its two neighbours: this sits in the Dots
// subtab's fan-out beside the plan query the tab actually depends on, so a dead or slow GCN must
// cost the user their code list, never their nutrition plan.
async function fetchFormulationCodes(nanoUserId) {
    if (!nanoUserId || !BASE_URL || !TOKEN) return [];
    const timer = AbortSignal.timeout ? AbortSignal.timeout(ORDER_STATUS_TIMEOUT_MS) : undefined;
    try {
        const res = await fetch(
            `${BASE_URL}/api/mall/nano/formulation-codes?nano_user_id=${encodeURIComponent(nanoUserId)}`,
            { headers: { authorization: `Bearer ${TOKEN}` }, signal: timer }
        );
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data?.codes) ? data.codes : [];
    } catch (err) {
        console.log(JSON.stringify({ level: 'WARN', msg: 'gcn_formulation_codes_failed', error: err.message }));
        return [];
    }
}

// The purchasable tier ladder — one rung per 28-day package width (6 / 8 / 10 种原粒), narrowest
// first. Read only when the user has NOTHING waiting: with a package already paid for the tier is
// settled and comes off the order itself, and a ladder would be an upsell for something they
// cannot upgrade.
//
// NEVER THROWS, same 4s budget and same reason as its neighbours above: no ladder means the tool
// formulates exactly as it did before this existed, which is a worse card but a complete one.
async function fetchFormulationTiers() {
    if (!BASE_URL || !TOKEN) return [];
    const timer = AbortSignal.timeout ? AbortSignal.timeout(ORDER_STATUS_TIMEOUT_MS) : undefined;
    try {
        const res = await fetch(
            `${BASE_URL}/api/mall/nano/formulation-packages`,
            { headers: { authorization: `Bearer ${TOKEN}` }, signal: timer }
        );
        if (!res.ok) return [];
        const data = await res.json();
        if (!Array.isArray(data?.packages)) return [];
        // Narrowest first, and only rungs carrying a real width — the ladder's whole meaning is
        // that number, and GCN sorts on it too, but a client that depends on an ordering should
        // establish it rather than inherit it.
        return data.packages
            .filter(p => p && Number.isFinite(Number(p.max_distinct_dots)) && Number(p.max_distinct_dots) > 0)
            .map(p => ({
                tier_label: p.tier_label || null,
                package_name: p.package_name || null,
                // The store's own one-line positioning for this tier (GCN skus.description). The
                // card renders it verbatim, so a package reads the same in chat as on the shelf.
                // Absent until GCN's catalog carries one; the card simply omits the line.
                tier_description: p.tier_description || null,
                max_distinct_dots: Number(p.max_distinct_dots),
            }))
            .sort((a, b) => a.max_distinct_dots - b.max_distinct_dots);
    } catch (err) {
        console.log(JSON.stringify({ level: 'WARN', msg: 'gcn_formulation_tiers_failed', error: err.message }));
        return [];
    }
}

// Spends one of those codes on the package it stands for. MAY THROW, like the fast-track submit
// below and for the same reason: the entire point of the tap was the call, and a silent no-op
// would leave the user believing a code they still hold has been spent — or that one already
// spent has not.
//
// A longer budget than the reads above, deliberately. This is one user action, not a section of a
// page: GCN writes an order, burns the code and runs a full payment confirmation (which itself
// notifies us back), and giving up at 4s would abandon work that is already committed on their
// side. gcnFetch has no timeout of its own, so the ceiling has to be imposed here.
const REDEEM_TIMEOUT_MS = 25000;

async function redeemFormulationCode(payload) {
    const timer = AbortSignal.timeout ? AbortSignal.timeout(REDEEM_TIMEOUT_MS) : undefined;
    return gcnFetch('/api/mall/nano/formulation-redeem', { method: 'POST', body: payload, signal: timer });
}

// Hands a fast-track formula to GCN so the paid order can go to compounding. Unlike the two
// fetches above this one MAY throw: it is called from an explicit user action ("confirm this
// formula") whose entire purpose is the call, so a failure has to reach the user rather than be
// swallowed into a silent no-op.
async function submitFastTrackFormulation(payload) {
    return gcnFetch('/api/mall/nano/formulation-fasttrack', { method: 'POST', body: payload });
}

module.exports = {
    gcnFetch, fetchAiCatalog, fetchFormulationOrders, submitFastTrackFormulation,
    fetchFormulationCodes, redeemFormulationCode, fetchFormulationTiers,
};
