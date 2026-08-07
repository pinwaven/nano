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
            name: 'get_dot_inventory',
            description: "Fetch the user's physical dot cartridge inventory (which dots are loaded, remaining/total dose counts, status) — use for questions like how many doses of a dot are left.",
            parameters: {
                type: 'object',
                properties: {
                    include_removed: { type: 'boolean', description: 'Also include removed/finished cartridges, not just active ones' },
                },
            },
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

// Binds handlers to one user/session. Schema (AGENTIC_TOOL_DEFS) is static and exported
// separately since it doesn't depend on user_id/language.
function createAgenticToolHandlers({ pool, user_id, language }) {
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
                `SELECT id, key_name, key_name_zh, name, name_zh, description, is_isolate, timing, timing_flexible, sub_age_target, ingredients, ingredients_zh, target_dots_min, target_dots_max FROM dots ${where} ORDER BY id ASC`,
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

        async get_dot_inventory(args = {}) {
            const statusClause = args.include_removed ? '' : `AND uc.status = 'active'`;
            const { rows } = await pool.query(
                `SELECT uc.dot_id, d.name, d.name_zh, uc.total_dots, uc.remaining_dots, uc.status, uc.last_dispensed_at
                 FROM user_cartridges uc
                 JOIN dots d ON d.id = uc.dot_id
                 WHERE uc.user_id = $1 ${statusClause}
                 ORDER BY uc.last_dispensed_at DESC NULLS LAST LIMIT 20`,
                [user_id]
            );
            return {
                ok: true,
                data: rows.map(r => ({ ...r, last_dispensed_at: r.last_dispensed_at ? formatToShanghai(r.last_dispensed_at) : null })),
            };
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
