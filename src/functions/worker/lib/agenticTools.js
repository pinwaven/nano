/**
 * Dedicated per-domain read tools for the Viva agentic chat loop (lib/agenticChat.js).
 *
 * Unlike the generic `query_database` SQL tool in handlers/chat.js (which lets the model
 * write its own SELECT and is deliberately blocked from the biomarkers table as an
 * anti-hallucination guard), each tool here is a fixed, typed wrapper around a known query.
 * Validation therefore lives once in the tool implementation instead of being trusted to
 * model-authored SQL text, and biomarker-shaped data always comes from `data.validated`
 * (never `data.actual`), per CLAUDE.md #17.
 *
 * Handlers never throw — every call resolves to { ok: true, data } or { ok: false, reason },
 * so the tool loop can always JSON.stringify the result as a tool message.
 */
'use strict';

const { formatQuestionnaireContext } = require('../handlers/questionnaires');
const { formatToShanghai } = require('./time-utils');
// Safe: handlers/dots.js requires nothing from lib/agentic*, so this closes no cycle in either
// load order, and it adds no module to the cold path — handlers/chat.js already requires both.
const {
    _fetchFormulationPackages,
    _fetchFormulationCodes,
    PACKAGE_STAGE_NARRATION,
} = require('../handlers/dots');
const { fetchFormulationTiers } = require('./gcnClient');

const AGENTIC_TOOL_DEFS = [
    {
        type: 'function',
        function: {
            name: 'get_biomarkers',
            description: "Fetch the user's latest validated Kino chip biomarker snapshot (values, bio-age profile, test date). Prefer the values already given in your system context; call this only to re-verify at judge time or if you suspect drift.",
            parameters: { type: 'object', properties: {} },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_biomarker_history',
            description: "Fetch the count and dates (with validated values) of the user's past Kino chip tests. Use this for questions about how many tests they've done or how a value has changed over time — get_biomarkers only returns the single latest test.",
            parameters: {
                type: 'object',
                properties: {
                    limit: { type: 'integer', description: 'Max rows to return, 1-30 (default 20). The response also includes the true total count even if truncated.' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_dots',
            description: 'Fetch the real dots (nutrition cartridge) formulary, optionally narrowed by target sub-age dimension or isolate/blend type.',
            parameters: {
                type: 'object',
                properties: {
                    sub_age_target: { type: 'string', description: 'Filter to dots targeting one dimension, e.g. "Metabolic Age"' },
                    is_isolate: { type: 'boolean', description: 'Filter to isolates (true) or blends (false)' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_health_plan',
            description: "Fetch the user's health plan(s) with progress (weeks elapsed, checkins, milestones). Active plans only by default.",
            parameters: {
                type: 'object',
                properties: {
                    include_inactive: { type: 'boolean', description: 'Also include abandoned (non-active) plans, e.g. for "what plans have I done before" questions' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_formulation_packages',
            // Replaced get_dot_inventory, which read user_cartridges — the Neo dispenser's
            // cartridge table for hardware that is not shipping (§28d gated it off), so it could
            // only ever narrate legacy rows. It was the closest-sounding tool to "what dots do I
            // have", which is exactly how a purchase question got answered out of it. §28g.
            description: "Fetch what the user has actually BOUGHT of 原粒 · 定制营养素 · 28天: their package orders and each one's current stage (paid, being compounded, shipped, in progress…), any unredeemed codes they hold, and the three packages the store sells. Use for every question about a purchase, an order, payment, shipping or which packages exist. This is the ONLY source for those — a nutrition plan or dosing schedule does not say what was bought.",
            parameters: { type: 'object', properties: {} },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_health_reports',
            description: "Fetch metadata (date, institution, report type) for external lab/health reports the user has uploaded — not their full content. Use for questions like how many reports they've submitted or when their last one was.",
            parameters: {
                type: 'object',
                properties: {
                    limit: { type: 'integer', description: 'Max rows to return, 1-20 (default 10)' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_questionnaire_responses',
            description: "Fetch the user's completed coach questionnaire responses (excludes raw birth-date/height/weight, which are already reflected in the precomputed age/BMI in your context).",
            parameters: { type: 'object', properties: {} },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_weight_history',
            description: 'Fetch recent body-composition scale readings (weight over time), most recent first.',
            parameters: {
                type: 'object',
                properties: {
                    limit: { type: 'integer', description: 'Max rows to return, 1-10 (default 10)' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_health_twin',
            description: "Fetch the user's wearable-derived health twin (HRV, resting HR, SpO2, sleep, steps, weight/BMI trend).",
            parameters: { type: 'object', properties: {} },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_nutrition_schedule',
            description: "Fetch the user's scheduled dot doses, optionally within a date range.",
            parameters: {
                type: 'object',
                properties: {
                    from_date: { type: 'string', description: 'YYYY-MM-DD, inclusive' },
                    to_date: { type: 'string', description: 'YYYY-MM-DD, inclusive' },
                    limit: { type: 'integer', description: 'Max rows to return, 1-50 (default 20)' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_reminders',
            description: "Fetch the user's reminders, optionally filtered by status.",
            parameters: {
                type: 'object',
                properties: {
                    status: { type: 'string', description: 'e.g. "pending", "sent", "cancelled"' },
                    limit: { type: 'integer', description: 'Max rows to return, 1-50 (default 20)' },
                },
            },
        },
    },
];

function clampInt(value, fallback, min, max) {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(n, max));
}

// Date-ONLY, and that is load-bearing twice over.
//
// 1. formatToShanghai returns 'yyyy-MM-dd HH:mm:ss' with no offset, and extractToolGroundTruth's
//    addDate re-parses whatever we emit with `new Date(value)` — which reads an offsetless string
//    in the PROCESS timezone (UTC on FC) and then applies +8 again. Every timestamp at or after
//    16:00 Shanghai would be harvested as the following day, so the date the model was shown and
//    the date allowlisted as grounded would differ and a correct answer could be rewritten away.
//    A bare YYYY-MM-DD is parsed as UTC midnight by spec, so the round trip is exact.
// 2. A raw UTC ISO string has been observed being echoed to the user verbatim, which is why no
//    tool in this file hands the model one.
function dateOnly(value) {
    if (!value) return null;
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return formatToShanghai(d).slice(0, 10);
}

// Binds handlers to one user/session. Schema (AGENTIC_TOOL_DEFS) is static and exported
// separately since it doesn't depend on user_id/language.
function createAgenticToolHandlers({ pool, user_id, language }) {
    // What a package stage means, and what the user does next, in their language — authored in
    // handlers/dots.js beside PACKAGE_STAGES itself. The model narrates these rather than
    // deriving them, so the chat prompt never has to learn a stage string (§28g).
    const zh = language === 'zh';
    const narrate = (stage, fulfillment) => {
        const entry = PACKAGE_STAGE_NARRATION[stage];
        if (!entry) return { stage_meaning: null, next_step: null };
        const copy = entry[zh ? 'zh' : 'en'];
        let next = copy.next_step || null;
        // Before payment, next_step stops at "pay" — and the model kept inventing what follows,
        // landing on "系统将自动进入营养定制环节" in roughly a third of live dev runs. Paying
        // starts nothing on its own (§28c), so the continuation is spelled out here rather than
        // banned in the prompt: given the true next sentence, the model has nothing to invent.
        //
        // It depends on the package, which is why it is not in the static table: a fast-track
        // buyer must run 营养定制 themselves, while a premium buyer is explicitly done (§28d).
        if (next && (stage === 'pending_payment' || stage === 'paid')) {
            next += fulfillment === 'expert_review'
                ? (zh ? '之后由 Viva AG 出配方，你不需要再做别的。' : ' After that Viva AG formulates it and nothing more is required from you.')
                : (zh ? '付款本身不会生成配方——付款之后你还要自己再运行一次「营养定制」并确认提交。' : ' Paying does not itself produce a formula — afterwards you must run the 营养定制 tool yourself and confirm.');
        }
        return { stage_meaning: copy.meaning, next_step: next };
    };

    // An order with no plan attached has no recipe — nobody has decided what goes in it. Said in
    // words rather than left as a null field, because a null is an invitation to fill it in.
    const formulaStatus = (planStatus) => {
        if (planStatus) {
            return language === 'zh'
                ? '这一份套餐已经绑定了配方。'
                : 'A formula is attached to this package.';
        }
        return language === 'zh'
            ? '这一份套餐还没有绑定配方——里面具体放哪些原粒尚未确定，不要描述它的配方内容。'
            : 'No formula is attached to this package yet — which dots go in it has not been decided, so do not describe its contents.';
    };

    return {
        async get_biomarkers() {
            const { rows } = await pool.query(
                `SELECT data, tested_at FROM biomarkers WHERE user_id = $1 AND test_type = 'kino_chip' AND (data->'validated') IS NOT NULL ORDER BY tested_at DESC LIMIT 1`,
                [user_id]
            );
            const row = rows[0];
            if (!row) return { ok: true, data: null };
            return {
                ok: true,
                data: {
                    validated: row.data?.validated || {},
                    bioage_profile: row.data?.bioage_profile || {},
                    // Shanghai-local, human-readable — raw pg timestamptz values serialize to
                    // UTC ISO strings ("...T07:51:49.631Z") when JSON.stringify'd for the tool
                    // result, and the model has been observed echoing that literally into a
                    // user-facing reply (wrong clock time AND unreadable). Every other date the
                    // model is given (biomarkers_tested_at in the main system prompt, etc.)
                    // already goes through this same formatter — these tool results were the
                    // one place that didn't. Found via live dev testing 2026-08-05.
                    tested_at: formatToShanghai(row.tested_at),
                },
            };
        },

        async get_biomarker_history(args = {}) {
            const limit = clampInt(args.limit, 20, 1, 30);
            const [countResult, rowsResult] = await Promise.all([
                pool.query(
                    `SELECT COUNT(*) FROM biomarkers WHERE user_id = $1 AND test_type = 'kino_chip' AND (data->'validated') IS NOT NULL`,
                    [user_id]
                ),
                pool.query(
                    `SELECT data, tested_at FROM biomarkers WHERE user_id = $1 AND test_type = 'kino_chip' AND (data->'validated') IS NOT NULL ORDER BY tested_at DESC LIMIT $2`,
                    [user_id, limit]
                ),
            ]);
            return {
                ok: true,
                data: {
                    total_count: parseInt(countResult.rows[0].count, 10),
                    tests: rowsResult.rows.map(r => ({ tested_at: formatToShanghai(r.tested_at), validated: r.data?.validated || {} })),
                },
            };
        },

        async get_dots(args = {}) {
            const clauses = [];
            const params = [];
            if (args.sub_age_target) {
                params.push(args.sub_age_target);
                clauses.push(`sub_age_target = $${params.length}`);
            }
            if (typeof args.is_isolate === 'boolean') {
                params.push(args.is_isolate);
                clauses.push(`is_isolate = $${params.length}`);
            }
            const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
            const { rows } = await pool.query(
                `SELECT id, key_name, key_name_zh, name, name_zh, description, is_isolate, timing, timing_flexible, sub_age_target, ingredients, ingredients_zh, target_dots_min, target_dots_max, dosing_protocol, pulse_days_per_cycle, pulse_cycle_days FROM dots ${where} ORDER BY id ASC`,
                params
            );
            return { ok: true, data: rows };
        },

        async get_health_plan(args = {}) {
            const statusClause = args.include_inactive ? '' : `AND hp.status = 'active'`;
            const { rows } = await pool.query(
                `SELECT hp.id, hp.plan_type, hp.status, hp.start_date, hp.ended_at, hp.duration_weeks, hp.baseline_data,
                        hpt.name_en, hpt.name_zh, hpt.goal_en, hpt.goal_zh, hpt.target_sub_ages,
                        (SELECT COUNT(*) FROM health_plan_checkins WHERE plan_id = hp.id) AS checkin_count,
                        (SELECT COUNT(*) FROM health_plan_milestones WHERE plan_id = hp.id) AS milestones_done
                 FROM health_plans hp
                 LEFT JOIN health_plan_templates hpt ON hpt.id = hp.template_id
                 WHERE hp.user_id = $1 ${statusClause}
                 ORDER BY hp.start_date DESC LIMIT 5`,
                [user_id]
            );
            return {
                ok: true,
                data: rows.map(p => ({
                    plan_type: p.plan_type,
                    status: p.status,
                    name: language === 'zh' ? p.name_zh : p.name_en,
                    goal: language === 'zh' ? p.goal_zh : p.goal_en,
                    target_sub_ages: p.target_sub_ages || [],
                    weeks_elapsed: Math.max(0, Math.floor((Date.now() - new Date(p.start_date).getTime()) / (7 * 86400000))),
                    total_weeks: p.duration_weeks,
                    ended_at: p.ended_at,
                    checkin_count: parseInt(p.checkin_count || 0, 10),
                    milestones_done: parseInt(p.milestones_done || 0, 10),
                })),
            };
        },

        // What the user has BOUGHT — read live from GCN every time, never cached on a nano row,
        // because an order can be refunded, cancelled or fulfilled between two reads (§28d).
        //
        // Returns a FLAT array with a `kind` discriminator, not a {packages, codes, tiers}
        // wrapper. extractToolGroundTruth (lib/agenticChat.js) normalises a tool result with
        // `Array.isArray(data) ? data : (Array.isArray(data.tests) ? data.tests : [data])`, so a
        // wrapper object is treated as one row and nothing is harvested from it — real order
        // dates would then never reach extraValidDates and verifyBiomarkerGrounding would flag a
        // correct answer as a fabrication and rewrite it away (the bug CLAUDE.md §21 step 6
        // records). The `data.tests` branch is already the fossil of one such wrapper; do not add
        // the second.
        async get_formulation_packages() {
            const [packages, codes, tiers] = await Promise.all([
                _fetchFormulationPackages(user_id),
                _fetchFormulationCodes(user_id),
                fetchFormulationTiers(),
            ]);

            // DEGRADED IS NOT EMPTY. All three fetchers swallow every failure and return [], so
            // "GCN is unreachable" and "you have bought nothing" are byte-identical here — and
            // the model will state the second one confidently, which is this tool's own origin
            // bug relocated. fetchFormulationTiers is user-independent and returns three rows in
            // a healthy system, so all three empty at once means the far side is down. The
            // conjunction matters: a nano-side 'proposed' plan still answers while GCN is dead,
            // which is the degradation §28d asks for.
            if (packages.length === 0 && codes.length === 0 && tiers.length === 0) {
                return {
                    ok: false,
                    reason: 'the order system could not be reached — tell the user their order status is temporarily unavailable, and do NOT tell them they have no packages',
                };
            }

            const rows = [
                // The raw `stage` enum is deliberately NOT sent. Given it, the model quoted it
                // verbatim into user prose — 状态均为"pending_payment" — which is precisely what
                // stage_meaning exists to prevent (observed live on dev, 2026-09-10). It has
                // nothing to add: stage_meaning is already distinct per stage.
                ...packages.map(p => ({
                    kind: 'package',
                    ...narrate(p.stage, p.fulfillment),
                    // Whether anyone has decided what goes IN this package yet. Server-written,
                    // for the same reason as stage_meaning: handed only a null plan_status, the
                    // model invented a dot roster for two unformulated orders and JUDGE passed it,
                    // because every dot it named was real (dev, 2026-09-10).
                    formula_status: formulaStatus(p.plan_status),
                    package_name: p.package_name,
                    tier_label: p.tier_label,
                    max_distinct_dots: p.max_distinct_dots,
                    day_index: p.day_index,
                    total_days: p.total_days,
                    ordered_at: dateOnly(p.ordered_at),
                    shipped_at: dateOnly(p.shipped_at),
                    tracking_number: p.tracking_number,
                    shipping_carrier: p.shipping_carrier,
                    tracking_status_desc: p.tracking_status_desc,
                })),
                // The code STRING is deliberately withheld: redeeming happens in the app, so the
                // model has no use for it, and a value it was never given is a value it cannot
                // leak — the same reasoning §37 applies to prices.
                ...codes.map(c => ({
                    kind: 'code',
                    package_name: c.package_name,
                    tier_label: c.tier_label,
                    max_distinct_dots: c.max_distinct_dots,
                    fulfillment: c.fulfillment,
                    sold_at: dateOnly(c.sold_at),
                    next_step: language === 'zh'
                        ? '在「方案 · 原粒」里用这个兑换码开始配制。'
                        : 'Use this code under Plans · Dots to start compounding.',
                })),
                // The catalog, for "what packages are there". No width here: §28f took that
                // number off the card because what separates the packages is a product decision
                // moving past "how many kinds of dot", and on the catalog it is a merchandising
                // claim rather than a fact about something the user owns. tier_description is the
                // store's own positioning line and is passed through verbatim, never rewritten.
                ...tiers.map(t => ({
                    kind: 'tier',
                    package_name: t.package_name,
                    tier_label: t.tier_label,
                    tier_description: t.tier_description,
                })),
            ];
            return { ok: true, data: rows };
        },

        async get_health_reports(args = {}) {
            const limit = clampInt(args.limit, 10, 1, 20);
            const { rows } = await pool.query(
                `SELECT report_date, source, institution, report_type, status FROM health_reports WHERE user_id = $1 ORDER BY report_date DESC LIMIT $2`,
                [user_id, limit]
            );
            return { ok: true, data: rows };
        },

        async get_questionnaire_responses() {
            const { rows } = await pool.query(
                `SELECT q.name, q.name_zh, qq.prompt_en, qq.prompt_zh, qr.answer
                 FROM questionnaire_responses qr
                 JOIN questionnaire_questions qq ON qq.id = qr.question_id
                 JOIN questionnaire_assignments qa ON qa.id = qr.assignment_id
                 JOIN questionnaires q ON q.id = qa.questionnaire_id
                 WHERE qa.user_id = $1 AND qa.status = 'completed'
                   AND qq.save_field IS DISTINCT FROM 'birth_date'
                   AND qq.save_biomarker_type IS DISTINCT FROM 'body_composition'
                 ORDER BY qa.completed_at ASC, qq.sort_order ASC`,
                [user_id]
            );
            return { ok: true, data: formatQuestionnaireContext(rows, language) };
        },

        async get_weight_history(args = {}) {
            const limit = clampInt(args.limit, 10, 1, 10);
            const { rows } = await pool.query(
                `SELECT data, tested_at FROM biomarkers WHERE user_id = $1 AND test_type = 'body_composition' ORDER BY tested_at DESC LIMIT $2`,
                [user_id, limit]
            );
            return {
                ok: true,
                data: rows.map(r => ({ weight_kg: r.data?.actual?.weight ?? null, tested_at: formatToShanghai(r.tested_at) })),
            };
        },

        async get_health_twin() {
            const { rows } = await pool.query(
                `SELECT avg_hrv_ms, avg_resting_hr, avg_spo2,
                        avg_sleep_hours, avg_sleep_score, avg_deep_sleep_pct,
                        avg_daily_steps, avg_active_minutes,
                        latest_weight_kg, latest_bmi, latest_body_fat_pct,
                        latest_lab_data, latest_lab_date,
                        trend_data, data_coverage
                 FROM health_twin WHERE user_id = $1`,
                [user_id]
            );
            return { ok: true, data: rows[0] || null };
        },

        async get_nutrition_schedule(args = {}) {
            // recipe is JSONB ({dots: {"DOT-N1": count, ...}}), not per-dot columns — flatten in
            // JS here rather than in SQL. np.status lets the model tell an active week's schedule
            // apart from a superseded/pending one instead of treating every past row as current.
            const limit = clampInt(args.limit, 20, 1, 50);
            const clauses = ['ns.user_id = $1'];
            const params = [user_id];
            if (args.from_date) {
                params.push(args.from_date);
                clauses.push(`ns.scheduled_date >= $${params.length}`);
            }
            if (args.to_date) {
                params.push(args.to_date);
                clauses.push(`ns.scheduled_date <= $${params.length}`);
            }
            params.push(limit);
            const { rows } = await pool.query(
                `SELECT ns.scheduled_date, ns.slot_name, ns.recipe, ns.is_taken, np.status AS plan_status
                 FROM nutrition_schedules ns JOIN nutrition_plans np ON np.id = ns.plan_id
                 WHERE ${clauses.join(' AND ')} ORDER BY ns.scheduled_date DESC LIMIT $${params.length}`,
                params
            );
            const flattened = [];
            for (const row of rows) {
                const dots = row.recipe?.dots || {};
                for (const [dotKey, count] of Object.entries(dots)) {
                    flattened.push({
                        scheduled_date: row.scheduled_date,
                        slot_name: row.slot_name,
                        dot_key: dotKey,
                        count,
                        is_taken: row.is_taken,
                        plan_status: row.plan_status,
                    });
                }
            }
            return { ok: true, data: flattened };
        },

        async get_reminders(args = {}) {
            const limit = clampInt(args.limit, 20, 1, 50);
            const clauses = ['user_id = $1'];
            const params = [user_id];
            if (args.status) {
                params.push(args.status);
                clauses.push(`status = $${params.length}`);
            }
            params.push(limit);
            const { rows } = await pool.query(
                `SELECT content, scheduled_for, recurrence, status FROM reminders WHERE ${clauses.join(' AND ')} ORDER BY scheduled_for DESC LIMIT $${params.length}`,
                params
            );
            return {
                ok: true,
                data: rows.map(r => ({ ...r, scheduled_for: formatToShanghai(r.scheduled_for) })),
            };
        },
    };
}

module.exports = { AGENTIC_TOOL_DEFS, createAgenticToolHandlers };
