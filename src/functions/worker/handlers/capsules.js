'use strict';

// Per-capsule QR scans (rules in lib/capsuleCodes.js).
//
//   POST /capsule-scan  { openid, code }       user session — scan a capsule before taking it
//   GET  /formulation-capsule-codes?c=WVB…     GCN service only — the 56 codes for the foil sheet
//
// The outside-of-box WVB code is untouched: it shows ingredients/ownership and claims the box,
// which is what starts the cycle. A capsule scan only ever records a dose on an already-active
// plan.

const { pool } = require('../lib/db');
const {
    extractCapsuleCode, decideCapsuleScan, ensurePlanCapsuleCodes,
} = require('../lib/capsuleCodes');

// A plan counts as recalled when every batch compounded from it is recalled. A plan with no batch
// row at all (a box claimed before batches carried plan ids) is not recalled.
const RECALL_SQL = `
    SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE bb.status = 'recalled')::int AS recalled
      FROM box_batches bb
     WHERE bb.plan_id = $1
        OR EXISTS (SELECT 1 FROM boxes b WHERE b.batch_id = bb.id AND b.nutrition_plan_id = $1)`;

async function _dotsForRecipe(recipe) {
    const counts = recipe?.dots || {};
    const keys = Object.keys(counts).filter(k => counts[k] > 0);
    if (!keys.length) return [];
    const { rows } = await pool.query(
        `SELECT key_name, name, name_zh, color_hex FROM dots WHERE key_name = ANY($1)`, [keys]
    );
    const byKey = new Map(rows.map(r => [r.key_name, r]));
    return keys.map(k => ({
        key_name: k,
        name: byKey.get(k)?.name || k,
        name_zh: byKey.get(k)?.name_zh || byKey.get(k)?.name || k,
        color_hex: byKey.get(k)?.color_hex || null,
        count: counts[k],
    }));
}

// callerId: the session user (the owner, or a coach scanning for a managed customer — already
// authorised for `openid` by lib/userAccess.js). Recorded as taken_by.
async function handlePostCapsuleScan(body, callerId) {
    const openid = body?.openid;
    if (!openid) return { success: false, reason: 'missing_params' };
    const code = extractCapsuleCode(body?.code);
    if (!code) {
        console.log(JSON.stringify({ level: 'INFO', msg: 'capsule_scan_blocked', data: { reason: 'invalid_code', user_id: openid } }));
        return { success: false, reason: 'invalid_code' };
    }

    let client;
    try {
        client = await pool.connect();
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handlePostCapsuleScan connect failed', error: err.message }));
        return { success: false, reason: 'internal_error' };
    }
    try {
        await client.query('BEGIN');
        const { rows: [capsule] } = await client.query(
            `SELECT id, code, plan_id, day_index, slot, taken_at
               FROM capsule_codes WHERE code = $1 FOR UPDATE`,
            [code]
        );
        let plan = null;
        let batchRecalled = false;
        if (capsule) {
            const { rows: [p] } = await client.query(
                `SELECT id, user_id, status, start_date::text AS start_date
                   FROM nutrition_plans WHERE id = $1`,
                [capsule.plan_id]
            );
            plan = p || null;
            const { rows: [rc] } = await client.query(RECALL_SQL, [capsule.plan_id]);
            batchRecalled = rc.n > 0 && rc.recalled === rc.n;
        }

        const decision = decideCapsuleScan({ capsule, plan, batchRecalled, userId: openid });
        if (!decision.ok) {
            await client.query('ROLLBACK');
            console.log(JSON.stringify({ level: 'INFO', msg: 'capsule_scan_blocked', data: { ...decision, code, user_id: openid, caller: callerId } }));
            // Another person's capsule: say nothing about it beyond "not yours".
            if (decision.reason === 'not_your_capsule' || decision.reason === 'capsule_not_found') {
                return { success: false, reason: decision.reason };
            }
            const { ok, ...rest } = decision;
            return { success: false, ...rest };
        }

        // Guarded on taken_at so two near-simultaneous scans cannot both record a dose.
        const { rows: marked } = await client.query(
            `UPDATE capsule_codes SET taken_at = NOW(), taken_by = $2
              WHERE id = $1 AND taken_at IS NULL RETURNING taken_at`,
            [capsule.id, callerId || openid]
        );
        if (!marked.length) {
            await client.query('ROLLBACK');
            return { success: false, reason: 'already_taken', capsule_day: capsule.day_index, capsule_slot: capsule.slot };
        }
        const { rows: [sched] } = await client.query(
            `UPDATE nutrition_schedules SET is_taken = TRUE, taken_at = NOW()
              WHERE plan_id = $1 AND scheduled_date = $2::date AND slot_name = $3
              RETURNING recipe`,
            [plan.id, decision.scheduled_date, decision.slot_name]
        );
        if (!sched) {
            // The capsule is real and today's, so the dose is still recorded on the code; the
            // missing schedule row is a data problem to look at, not a reason to stop the user.
            console.warn(JSON.stringify({ level: 'WARN', msg: 'capsule scan: no schedule row', data: { plan_id: plan.id, date: decision.scheduled_date, slot: decision.slot_name } }));
        }
        await client.query('COMMIT');

        let dots = [];
        try {
            dots = await _dotsForRecipe(sched?.recipe);
        } catch (err) {
            console.warn(JSON.stringify({ level: 'WARN', msg: 'capsule scan: dot lookup failed', error: err.message }));
        }
        console.log(JSON.stringify({ level: 'INFO', msg: 'capsule_scan_ok', data: { code, plan_id: plan.id, day: capsule.day_index, slot: capsule.slot, user_id: openid, caller: callerId } }));
        return {
            success: true,
            capsule_day: capsule.day_index,
            capsule_slot: capsule.slot,
            taken_at: marked[0].taken_at,
            dots,
        };
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) { /* connection already broken */ }
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handlePostCapsuleScan failed', error: err.message, code }));
        return { success: false, reason: 'internal_error' };
    } finally {
        client.release();
    }
}

// GCN supplier sheet. Resolves the WVB code the same way the box label does (the plan's own
// label_code, else a box's code), then mints the plan's codes if they do not exist yet. Codes
// alone grant nothing — a scan only works for the plan's owner, signed in — but the route is still
// service-only (GCN_ALLOWED_PATHS) so nobody can mint them for someone else's plan.
async function handleGetFormulationCapsuleCodes(rawCode) {
    try {
        const match = /WVB[0-9A-Fa-f]{12}/.exec(String(rawCode || '').trim());
        const code = match ? match[0].toUpperCase() : null;
        if (!code) return { success: false, reason: 'invalid_code' };

        const { rows: [byLabel] } = await pool.query(
            `SELECT id, status, gcn_order_id FROM nutrition_plans WHERE label_code = $1 LIMIT 1`, [code]
        );
        let plan = byLabel;
        if (!plan) {
            const { rows: [box] } = await pool.query(
                `SELECT COALESCE(b.nutrition_plan_id, bb.plan_id) AS plan_id
                   FROM boxes b JOIN box_batches bb ON bb.id = b.batch_id
                  WHERE b.box_code = $1`,
                [code]
            );
            if (box?.plan_id) {
                const { rows: [p] } = await pool.query(
                    `SELECT id, status, gcn_order_id FROM nutrition_plans WHERE id = $1`, [box.plan_id]
                );
                plan = p;
            }
        }
        if (!plan) return { success: false, reason: 'not_found' };
        if (plan.status === 'pending') return { success: false, reason: 'plan_not_ready' };

        const rows = await ensurePlanCapsuleCodes(pool, plan.id);
        return {
            success: true,
            label_code: code,
            // Truncated exactly like the box label's (handleGetFormulationLabelByCode) — no user
            // identity of any kind.
            order_short_id: plan.gcn_order_id ? String(plan.gcn_order_id).slice(0, 8) : null,
            plan_status: plan.status,
            capsules: rows.map(r => ({ code: r.code, day_index: r.day_index, slot: r.slot })),
        };
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handleGetFormulationCapsuleCodes failed', error: err.message }));
        return { success: false, reason: 'internal_error' };
    }
}

module.exports = { handlePostCapsuleScan, handleGetFormulationCapsuleCodes };
