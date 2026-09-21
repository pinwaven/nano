'use strict';

// Dots, the formula, and the plan it becomes.
//
// This file owns the I/O side of 营养定制: fetching a user's twin and the formulary, running the
// formulation model (agentic via chat.generate, deterministic as the fallback), writing
// nutrition_plans rows ('proposed' at generation, 'active' at box scan), and the three plan-shaped
// reads GCN and the box QR resolve through. The arithmetic itself — ranking → doses → budget →
// capsule levelling → expansion — is lib/formulation.js, pure and DB-free; the chat cards are
// lib/chatCards.js; the package/order/redeem-code side is handlers/formulation_orders.js; the
// in-app store and cartridges are handlers/store.js. All four were carved out of this file on
// 2026-09-16 — the rules in CLAUDE.md §28 still describe one system, they just now name four files.

const { pool } = require('../lib/db');
const { resolveGcnSector } = require('../lib/channels');
const { humanizeDotCodes } = require('../lib/dotNames');
const { humanizeSubAgeKeys } = require('../lib/subAgeLabels');
const { scrubToolNames, dropForeignLines, localizeStatusWords } = require('../lib/toolNameScrub');
// Physical product-model constants (cycle length, capsule fill limit, DOT-N7 isolation) —
// shared with lib/formulation.js and lib/agFormulation.js so nano's own formulator and the
// validator for an externally-authored Viva AG formula can never disagree about what is
// manufacturable.
const { PLAN_DAYS, MAX_DOTS_PER_CAPSULE } = require('../lib/dotsProductModel');
const { getNowShanghai, calculateAge, formatToShanghai } = require('../lib/time-utils');
const { getCurrentSolarTerm } = require('../lib/solarTerms');
const OpenAI = require('openai');
const systemNutritionTemplate = require('../prompts/nano/systemNutrition');
const vivaSystemNutritionTemplate = require('../prompts/viva/systemNutrition');
const systemFormulaGenerateTemplate = require('../prompts/nano/systemFormulaGenerate');
const vivaSystemFormulaGenerateTemplate = require('../prompts/viva/systemFormulaGenerate');
const { v4: uuidv4 } = require('uuid');
const { publishChatGenerateEvent } = require('../lib/chatEventBridge');
const { getEssentialBlock } = require('../lib/knowledgeBase');
const { resolveGutAxisDotKeys } = require('../lib/foodSensitivity');
const { formatQuestionnaireContext } = require('./questionnaires');
const { fetchFormulationTiers } = require('../lib/gcnClient');
const { generateLabelCode } = require('../lib/labelCode');
const { buildHealthTags } = require('../lib/healthTags');
const { resolveEffectivePersona } = require('../lib/persona');
const {
    _fallbackCountForDot, _resolveCandidateDotKeys, _splitDotTiming, _balanceCapsules,
    _capRecipeTotal, _tierWeeks, _padCandidatesFor, _applyTierLadder,
    _planExpansionContext, _expandPlanDay,
} = require('../lib/formulation');
const { _buildFormulaChartBlock } = require('../lib/chatCards');
const { _fetchFormulationPackages, _fetchFormulationCodes, _resolveOrderContext } = require('./formulation_orders');

// Where the aeviva sector's public pages live. The formulation label QR is a GCN aeviva link
// rather than a nano one because that is the sector the product is sold in — the page that
// renders it already exists there (formulation-label.html), already prints, and already draws the
// QR. Falls back to prod so a missing env var degrades to a real page rather than a broken link.
const AEVIVA_SITE_BASE_URL = (process.env.AEVIVA_SITE_BASE_URL || 'https://aeviva.gcn.net').replace(/\/+$/, '');

// The QR payload. Contains the code, so handlePostBoxClaim's /WVB[0-9A-Fa-f]{12}/ still reads it
// straight out of whatever the scanner returns — one QR that both shows the formulation and
// activates it. Not written into the chat card any more (§28, "The card"); kept because the
// miniapp's card parser is tested against the URL shape it still has to recognise from history.
function _formulationLabelUrl(code) {
    return `${AEVIVA_SITE_BASE_URL}/formulation-label.html?c=${encodeURIComponent(code)}`;
}

const getLlmClient = () => new OpenAI({
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseURL: `${process.env.DASHSCOPE_HOST || 'https://dashscope.aliyuncs.com'}/compatible-mode/v1`,
});

// Inline helper — mirrors index.js saveChatMessage
async function _saveChatMessage(user_id, role, content, image_url = null, persona_type = 'nano') {
    try {
        await pool.query(
            'INSERT INTO chat_messages (user_id, role, content, image_url, persona_type) VALUES ($1, $2, $3, $4, $5)',
            [user_id, role, content, image_url, persona_type]
        );
    } catch (err) {
        console.error('Failed to save chat message:', err);
    }
}

async function handleGetDotsInventory() {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const result = await pool.query('SELECT * FROM dots ORDER BY id ASC');
        return { success: true, dots: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetNutritionPlan(openid) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        if (!openid) return { success: true, plan: null, dots: [] };

        // 1. Get latest ACTIVE structured plan — while a new Viva formulation is still
        // 'pending' (async agentic decision in flight), this naturally keeps returning the
        // previous plan rather than an empty/half-formed one.
        const planResult = await pool.query(
            `SELECT id, start_date, end_date, goal, created_at
             FROM nutrition_plans
             WHERE user_id = $1 AND status = 'active'
             ORDER BY created_at DESC LIMIT 1`,
            [openid]
        );

        let planData = null;
        let schedules = [];

        if (planResult.rows.length > 0) {
            planData = planResult.rows[0];
            const scheduleResult = await pool.query(
                `SELECT scheduled_date, slot_name, recipe, is_taken, taken_at
                 FROM nutrition_schedules
                 WHERE plan_id = $1
                 ORDER BY scheduled_date ASC, slot_name DESC`,
                [planData.id]
            );
            schedules = scheduleResult.rows;
        }

        // 2. Fallback/Legacy notification content.
        //
        // Deliberately still 'nutrition_plan' and NOT 'formulation_proposal': this field is what
        // the Plans tab renders as "the plan you are on". A Formulate-Dots proposal is explicitly
        // not that until the box is scanned, so it delivers under its own type and never lands
        // here — otherwise every proposal would repopulate the tab it is designed to stay out of.
        // Nothing writes 'nutrition_plan' any more (the top-up job that did is gone); this reads
        // pre-existing rows only.
        // 3. The rest of the fan-out, in parallel — the package list reaches out to GCN, so it
        // must not be awaited in series behind the dots query. Costs max(db, gcn), not the sum.
        const [notifyResult, dotsResult, packages, codes] = await Promise.all([
            pool.query(
                `SELECT content, sent_at FROM notifications
                 WHERE user_id = $1 AND notification_type = 'nutrition_plan'
                 ORDER BY sent_at DESC LIMIT 1`,
                [openid]
            ),
            pool.query('SELECT * FROM dots ORDER BY id ASC'),
            _fetchFormulationPackages(openid),
            _fetchFormulationCodes(openid),
        ]);

        return {
            success: true,
            plan: notifyResult.rows[0]?.content || null,
            plan_date: notifyResult.rows[0]?.sent_at || null,
            structured_plan: planData,
            schedules: schedules,
            dots: dotsResult.rows,
            // Every dots package this user has, in every state — a SIBLING of the fields above,
            // never a source for them. `plan`/`structured_plan`/`schedules` still mean "the plan
            // you are physically on" and stay 'active'-only; §28b records the live bug where a
            // proposal leaked into this tab and made it report a plan the user did not have.
            packages,
            // Unredeemed codes this user owns — a sibling of `packages` on the same terms. A code
            // is something they can start, not something they have; it becomes a package the
            // moment it is spent, at which point it drops out of this list on its own.
            codes,
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// Server-to-server only (GCN_ALLOWED_PATHS-gated, see worker/index.js) — lets GCN validate a
// custom-formulation purchase against the buyer's real, currently-committed recipe before
// creating an order line, rather than trusting a client-supplied plan id blindly. GCN calls this
// with the openid it already resolved from its own SSO session (never a client-supplied value),
// so `openid` here is the authenticated buyer, not user input to trust independently.
//
// `valid:false` covers every reason a purchase shouldn't proceed: wrong owner, not the user's
// current active plan (stale — a newer formulation superseded it after the client cached an
// older plan id), or plan not found at all. Never throws a 404/500 for a routine "not ready yet"
// case — the caller (GCN's handleOrderCreate) is expected to branch on `valid`, not on HTTP status.
//
// The per-dot breakdown is read from day 0 of the plan (`start_date`) specifically — every day
// in the 28-day cycle recomputes the same steady-state recipe from morningRecipe/eveningRecipe
// EXCEPT the two DOT-N7 isolation days (day-offsets 9-10, see N7_ISOLATION_DAY_INDEXES), which
// are a system-controlled special case (single-ingredient capsules) and would misrepresent the
// real formulation if read instead. Day 0 is never an isolation day, so it's always safe.
// Shared plan-lookup + day-0-schedule + dot-breakdown logic, used by both the GCN checkout
// snapshot below and the box-QR feature (handlers/boxes.js). Reads day-0 of the plan's schedule
// specifically (not any arbitrary day) to avoid the two DOT-N7 "isolation days", which would
// misrepresent the steady-state recipe. `dotColumns` lets a caller ask for just names (checkout
// snapshot's need) or the full ingredient/timing/coating/color payload (box QR page's need).
//
// A 'proposed' plan has no schedules at all — they are generated at box-scan time — so its day 0
// is derived from proposed_recipe through the same _expandPlanDay the scan will later use. Day
// index 0 is never an N7 isolation day, so this yields exactly the steady-state capsules the rest
// of this function promises. That is what lets GCN price a formula the user has not received
// yet, which is the whole point of a proposal.
//
// KNOWN LIMIT, deliberately not changed here: since a purchased package caps distinct dots PER
// WEEK, a formula may legitimately rotate, and day 0 is then week 1 rather than the whole cycle.
// Two callers read this and neither should be silently redefined:
//
//   * GCN's per-dot checkout snapshot prices what it is given. Summing the cycle instead would
//     change what a customer is charged, which is a business decision, not a refactor — and that
//     product is now the FALLBACK path anyway (the tiered package is flat-priced, §28c).
//   * the printed box label would under-list a rotating formula, showing week 1's dots for a box
//     that physically holds all four weeks'.
//
// Both want the cycle-wide union, not a different day. Give them one when someone owns the
// pricing question; do not quietly switch day 0 to mean something else.
async function _getCommittedPlanDay0Breakdown(planId, { dotColumns = 'id, key_name, name, name_zh' } = {}) {
    const planResult = await pool.query(
        `SELECT np.id, np.user_id, np.status, np.start_date, np.start_date::text AS start_date_text,
                np.created_at, np.goal,
                np.proposed_recipe, np.label_code, np.gcn_order_id, np.submitted_to_gcn_at,
                np.primary_health_plan_id, np.secondary_health_plan_id,
                hpt.key_name AS focus_key_name, hpt.name_zh AS focus_label_zh, hpt.name_en AS focus_label_en
         FROM nutrition_plans np
         LEFT JOIN health_plans hp ON hp.id = np.primary_health_plan_id
         LEFT JOIN health_plan_templates hpt ON hpt.id = hp.template_id
         WHERE np.id = $1`,
        [planId]
    );
    if (planResult.rows.length === 0) return { reason: 'plan_not_found' };
    const plan = planResult.rows[0];

    let morningDots;
    let eveningDots;
    // Schedules first when the plan has any — they are what the user is actually taking. A plan
    // that never reached a box has none, so it falls back to the recipe still on the row.
    //
    // The fallback is NOT gated on status === 'proposed'. A proposal that was replaced by a newer
    // one becomes 'superseded' while still having no schedules, and gating on 'proposed' made its
    // printed label fail with plan_has_no_schedule — the label on a real box in someone's hands,
    // reading as an error the moment they formulate again. Its recipe is right there; show it, and
    // let the status field tell the reader it has been replaced.
    const scheduleResult = plan.status === 'proposed' ? { rows: [] } : await pool.query(
        `SELECT slot_name, recipe FROM nutrition_schedules
         WHERE plan_id = $1 AND scheduled_date = $2`,
        [plan.id, plan.start_date]
    );
    if (scheduleResult.rows.length > 0) {
        morningDots = scheduleResult.rows.find(r => r.slot_name === 'morning_cup')?.recipe?.dots || {};
        eveningDots = scheduleResult.rows.find(r => r.slot_name === 'evening_cup')?.recipe?.dots || {};
    } else if (plan.proposed_recipe) {
        // timing/timing_flexible/target_dots_min are NOT optional here. _fitRecipeToDailyBudget
        // reads all three — the slot a dot belongs to, whether it may be split, and the floor it
        // may never go under — so a formulary missing them yields a day 0 that disagrees with the
        // capsules the box scan will actually write. This is the printed label and the GCN
        // checkout snapshot: both must show the real formulation, not an approximation of it.
        const { rows: expansionFormulary } = await pool.query(
            `SELECT key_name, timing, timing_flexible, target_dots_min, target_dots_max,
                    dosing_protocol, pulse_days_per_cycle, pulse_cycle_days FROM dots`
        );
        const day0 = _expandPlanDay(0, _planExpansionContext(
            { dots: plan.proposed_recipe.morning || {}, weeks: plan.proposed_recipe.weeks || undefined },
            { dots: plan.proposed_recipe.evening || {}, weeks: plan.proposed_recipe.weeks || undefined },
            expansionFormulary,
        ), null);
        morningDots = day0.morning.dots;
        eveningDots = day0.evening.dots;
    } else {
        return { reason: 'plan_has_no_schedule', plan };
    }

    const dotsResult = await pool.query(`SELECT ${dotColumns} FROM dots ORDER BY id ASC`);
    const dotsByKey = new Map(dotsResult.rows.map(d => [d.key_name, d]));

    const allKeys = new Set([...Object.keys(morningDots), ...Object.keys(eveningDots)]);
    const dotBreakdown = [...allKeys].map(key => {
        const dot = dotsByKey.get(key) || {};
        const morning_count = morningDots[key] || 0;
        const evening_count = eveningDots[key] || 0;
        return {
            ...dot,
            key_name: key,
            name: dot.name || key,
            name_zh: dot.name_zh || key,
            morning_count,
            evening_count,
            total_count: morning_count + evening_count,
        };
    }).filter(d => d.total_count > 0);

    if (dotBreakdown.length === 0) return { reason: 'plan_has_no_dots', plan };
    return { plan, dotBreakdown };
}

async function handleGetFormulationCheckoutSnapshot(planId, openid) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        if (!planId || !openid) return { valid: false, reason: 'missing_params' };

        const planIdNum = parseInt(planId, 10);
        if (!Number.isFinite(planIdNum)) return { valid: false, reason: 'invalid_plan_id' };

        const { plan, dotBreakdown, reason } = await _getCommittedPlanDay0Breakdown(planIdNum);
        if (reason === 'plan_not_found') return { valid: false, reason };
        if (plan.user_id !== openid) return { valid: false, reason: 'plan_owner_mismatch' };
        // 'proposed' is what the Formulate-Dots chat tool writes: a real recipe the user has not
        // been shipped yet, and precisely the thing this endpoint exists to let GCN price. An
        // 'active' plan stays valid too — a user mid-cycle can still reorder what they are on.
        // Unchanged by the label's superseded fallback above: a replaced formulation must never be
        // purchasable, even though it can now still be READ.
        if (plan.status !== 'active' && plan.status !== 'proposed') return { valid: false, reason: 'plan_not_active' };
        if (reason) return { valid: false, reason };

        return {
            valid: true,
            plan: {
                id: plan.id,
                status: plan.status,
                committed_at: plan.created_at,
                primary_focus: plan.focus_key_name
                    ? { key_name: plan.focus_key_name, name_zh: plan.focus_label_zh, name_en: plan.focus_label_en }
                    : null,
            },
            recipe_summary: { dot_breakdown: dotBreakdown },
            verification_ref: uuidv4(),
        };
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handleGetFormulationCheckoutSnapshot failed', error: err.message }));
        return { valid: false, reason: 'internal_error' };
    }
}

// GET /formulation-label?c=WVB…   (PUBLIC — no auth)
//
// What the box QR resolves to. GCN's aeviva formulation-label.html calls this (server-side, via
// its own mall function — nano's custom domain emits a duplicate CORS header that browsers reject,
// so a direct browser fetch is not an option) and renders the page the user views on screen and
// the label printed on the box.
//
// PUBLIC on purpose, exactly like the older /api/box/{code} page it supersedes: this is a code
// printed on a physical object, so anyone holding the box can read it. That constrains what it may
// return — **no user identity of any kind**: no user_id, openid, nickname, phone, or biomarker
// value. What a stranger scanning a found box learns is what is in the box, which is what a
// nutrition label is for. The order reference is truncated the same way GCN's own label does it.
//
// Resolves a plan's own label_code first, then falls back to boxes.box_code so labels printed
// before the code moved to generation time keep working — physical objects already in the world
// cannot be re-printed.
async function handleGetFormulationLabelByCode(rawCode) {
    try {
        if (!pool) return { valid: false, reason: 'internal_error' };
        const match = /WVB[0-9A-Fa-f]{12}/.exec(String(rawCode || '').trim());
        const code = match ? match[0].toUpperCase() : null;
        if (!code) return { valid: false, reason: 'invalid_code' };

        const { rows: [plan] } = await pool.query(
            `SELECT np.id, np.status, np.created_at, np.start_date, np.end_date, np.label_code,
                    np.gcn_order_id, np.submitted_to_gcn_at,
                    b.claimed_at, b.box_code,
                    bb.status AS batch_status, bb.created_at AS batch_created_at
               FROM nutrition_plans np
               LEFT JOIN boxes b ON b.box_code = COALESCE(np.label_code, '')
               LEFT JOIN box_batches bb ON bb.id = b.batch_id
              WHERE np.label_code = $1
              LIMIT 1`,
            [code]
        );

        let planId = plan?.id;
        let boxRow = plan;
        if (!planId) {
            // A label printed from a box batch rather than from the formulation itself.
            const { rows: [box] } = await pool.query(
                `SELECT b.box_code, b.claimed_at, b.nutrition_plan_id, bb.plan_id,
                        bb.status AS batch_status, bb.created_at AS batch_created_at
                   FROM boxes b JOIN box_batches bb ON bb.id = b.batch_id
                  WHERE b.box_code = $1`,
                [code]
            );
            if (!box) return { valid: false, reason: 'not_found' };
            planId = box.nutrition_plan_id || box.plan_id;
            boxRow = box;
            if (!planId) return { valid: false, reason: 'not_found' };
        }

        const { plan: planRow, dotBreakdown, reason } = await _getCommittedPlanDay0Breakdown(planId, {
            dotColumns: 'id, key_name, key_name_zh, name, name_zh, color_hex, timing, '
                + 'sub_age_target, ingredients, ingredients_zh',
        });
        if (reason) return { valid: false, reason };

        return {
            valid: true,
            code,
            // 'proposed'  — formulated, not yet compounded. The QR exists from this moment.
            // 'approved'  — signed off by a nutrition expert, being compounded.
            // 'active'    — the box was scanned; the user is taking it.
            // 'superseded'— replaced by a newer formulation.
            status: planRow.status,
            formulated_at: planRow.created_at,
            cycle_days: PLAN_DAYS,
            cycle_capsules: PLAN_DAYS * 2,
            // Truncated, matching GCN's own label page: enough to quote to support, not the full
            // order id, on a page anyone holding the box can open.
            order_short_id: planRow.gcn_order_id ? String(planRow.gcn_order_id).slice(0, 8) : null,
            ordered_at: planRow.submitted_to_gcn_at || null,
            manufactured_at: boxRow?.batch_created_at || null,
            recalled: boxRow?.batch_status === 'recalled',
            claimed_at: boxRow?.claimed_at || null,
            // ::text, not the DATE column: node-postgres parses a DATE at local midnight, which
            // serializes to the PREVIOUS day in UTC (CLAUDE.md §35). This is a calendar day the
            // label states, so it must be the day it says.
            started_on: planRow.status === 'active' ? planRow.start_date_text : null,
            dot_breakdown: dotBreakdown,
        };
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handleGetFormulationLabelByCode failed', error: err.message }));
        return { valid: false, reason: 'internal_error' };
    }
}

// The health context a nutrition expert judges a formulation against — everything the model
// itself saw when it produced the recipe, so the reviewer is weighing the AI against the same
// evidence rather than a different slice of it.
//
// Shared by BOTH review snapshots: handleGetFormulationReviewSnapshot (a committed nutrition_plan,
// nano's own formulator) and handleGetAgFormulationReviewSnapshot (a Viva AG formula, in
// handlers/ag_formulation.js). They differ only in where the recipe comes from; keeping the twin
// half in one place is what stops the two drifting into showing reviewers different evidence.
async function _buildReviewTwinContext(userId) {
    const userResult = await pool.query(
        `SELECT user_id, nickname, gender, birth_date, language, bio_data FROM users WHERE user_id = $1 LIMIT 1`,
        [userId]
    );
    const user = userResult.rows[0] || {};
    const lang = user.language || 'zh';
    const heightCm = user.bio_data?.height;
    const weightKg = user.bio_data?.weight;
    const bmi = heightCm && weightKg ? Math.round((weightKg / ((heightCm / 100) ** 2)) * 10) / 10 : null;

    // Same four context queries _handleFormulaDotsAgentic runs to build llmContext.
    const [twinResult, bioResult, questionnaireResult, activePlansResult] = await Promise.all([
        pool.query(`SELECT * FROM health_twin WHERE user_id = $1`, [userId]),
        pool.query(
            `SELECT bio_age, data, tested_at FROM biomarkers
             WHERE user_id = $1 AND test_type = 'kino_chip' AND (data->'validated') IS NOT NULL
             ORDER BY tested_at DESC LIMIT 1`,
            [userId]
        ),
        pool.query(
            `SELECT q.name, q.name_zh, qq.prompt_en, qq.prompt_zh, qr.answer
             FROM questionnaire_responses qr
             JOIN questionnaire_questions qq ON qq.id = qr.question_id
             JOIN questionnaire_assignments qa ON qa.id = qr.assignment_id
             JOIN questionnaires q ON q.id = qa.questionnaire_id
             WHERE qa.user_id = $1 AND qa.status = 'completed'
               AND qq.save_field IS DISTINCT FROM 'birth_date'
               AND qq.save_biomarker_type IS DISTINCT FROM 'body_composition'
             ORDER BY qa.completed_at ASC, qq.sort_order ASC`,
            [userId]
        ),
        pool.query(
            `SELECT hp.id, hp.plan_type, hp.status, hp.start_date, hp.duration_weeks,
                    hpt.name_en, hpt.name_zh, hpt.goal_en, hpt.goal_zh, hpt.target_sub_ages,
                    hpt.recommended_dot_ids
             FROM health_plans hp
             LEFT JOIN health_plan_templates hpt ON hpt.id = hp.template_id
             WHERE hp.user_id = $1 AND hp.status = 'active'
             ORDER BY hp.start_date DESC LIMIT 5`,
            [userId]
        ),
    ]);

    const twin = twinResult.rows[0] || null;
    const latestBio = bioResult.rows[0] || {};
    const bioData = latestBio.data || {};
    const validated = bioData.validated || null;

    return {
        user_profile: {
            nickname: user.nickname || null,
            gender: user.gender || null,
            age: calculateAge(user.birth_date),
            bmi,
            language: lang,
            health_conditions: user.bio_data?.health_conditions || [],
        },
        health_twin: twin ? { ...twin, tags: buildHealthTags(twin, validated, user.bio_data?.health_conditions || []) } : null,
        biomarkers: {
            validated,
            bioage_profile: bioData.bioage_profile || null,
            bio_age: latestBio.bio_age ?? null,
            tested_at: latestBio.tested_at || null,
        },
        questionnaire_context: formatQuestionnaireContext(questionnaireResult.rows, lang),
        active_health_plans: activePlansResult.rows.map(p => ({
            id: p.id,
            plan_type: p.plan_type,
            name: lang === 'zh' ? p.name_zh : p.name_en,
            goal: lang === 'zh' ? p.goal_zh : p.goal_en,
            target_sub_ages: p.target_sub_ages || [],
            recommended_dot_ids: p.recommended_dot_ids || [],
            weeks_elapsed: Math.max(0, Math.floor((Date.now() - new Date(p.start_date).getTime()) / (7 * 86400000))),
            total_weeks: p.duration_weeks,
        })),
    };
}

// GET /formulation-review-snapshot?planId=&openid=  (GCN service token only — see
// GCN_ALLOWED_PATHS in ../index.js)
//
// The Pro-mode counterpart to handleGetFormulationCheckoutSnapshot above. GCN's aeviva sector
// sells an expert-reviewed ("Pro") variant of the Custom Capsule Formulation, where a nutrition
// expert reviews the AI-generated recipe against the buyer's digital twin before the processing
// center compounds it. This returns everything that reviewer needs in one call: the same committed
// day-0 dot breakdown the checkout snapshot returns, PLUS the health context the model itself saw
// when it produced that recipe (_handleFormulaDotsAgentic's llmContext) — so the expert is judging
// the AI against the same evidence, not a different slice of it.
//
// Deliberately a purpose-built endpoint rather than allowlisting the existing GET /health-twin:
// GCN_ALLOWED_PATHS is per-path, not per-user, and the GCN service token resolves to
// role='superadmin' — allowlisting /health-twin would hand GCN a blanket read over every nano
// user's twin. This one is anchored to a specific plan id AND its owner, and returns nothing for a
// plan the given openid doesn't own (plan_owner_mismatch), so GCN can only ever read the twin of a
// user whose own plan it was already authorized to price at checkout.
//
// Same {valid, reason} contract and always-HTTP-200 convention as the checkout snapshot — the
// caller branches on `valid`, never on status code.
async function handleGetFormulationReviewSnapshot(planId, openid) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        if (!planId || !openid) return { valid: false, reason: 'missing_params' };

        const planIdNum = parseInt(planId, 10);
        if (!Number.isFinite(planIdNum)) return { valid: false, reason: 'invalid_plan_id' };

        // Richer dot columns than the checkout snapshot's default — the reviewer needs to see what
        // is actually in each cartridge (ingredients, timing, target sub-age) to judge the mix,
        // not just its name.
        const { plan, dotBreakdown, reason } = await _getCommittedPlanDay0Breakdown(planIdNum, {
            dotColumns: 'id, key_name, key_name_zh, name, name_zh, ingredients, ingredients_zh, '
                + 'timing, timing_flexible, sub_age_target, target_dots_min, target_dots_max, '
                + 'dosing_protocol, coating',
        });
        if (reason === 'plan_not_found') return { valid: false, reason };
        if (plan.user_id !== openid) return { valid: false, reason: 'plan_owner_mismatch' };
        if (reason) return { valid: false, reason };
        // NOTE: unlike the checkout snapshot, a non-'active' plan is NOT rejected here. By the time
        // an expert reviews a paid order the buyer may already have re-formulated, superseding the
        // plan that was actually purchased — the review must still show the recipe that was bought.

        const twin = await _buildReviewTwinContext(plan.user_id);

        return {
            valid: true,
            plan: {
                id: plan.id,
                status: plan.status,
                committed_at: plan.created_at,
                // The AI's own written analysis of why it formulated this way — nutrition_plans.goal
                // is where finalizeFormulaDotsGenerate stores it. The single most useful thing for a
                // reviewer to read before judging the numbers.
                goal: plan.goal || null,
                primary_focus: plan.focus_key_name
                    ? { key_name: plan.focus_key_name, name_zh: plan.focus_label_zh, name_en: plan.focus_label_en }
                    : null,
            },
            recipe_summary: { dot_breakdown: dotBreakdown },
            ...twin,
        };
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handleGetFormulationReviewSnapshot failed', error: err.message }));
        return { valid: false, reason: 'internal_error' };
    }
}

// The user's live food-sensitivity restrictions, and the dots a positive panel promotes (§40).
//
// TWO SEPARATE JOBS, and only the first is a formulation input in the ordinary sense:
//
//  - `restrictions` is context. A chronic food-IgG response is not an ingredient allergy, so it
//    does NOT remove a dot; that path stays with formulationQuality's allergy_conflict, which for
//    a food restriction is keyed on food_catalog.dot_conflict_keys and is empty by default.
//  - `promoted_dot_keys` unions into recommended_dot_keys, the SAME purely-additive channel a
//    health-plan focus uses (_fallbackCountForDot lifts a recommended dot to 75% of its own
//    range and never demotes anything else). Reusing it rather than inventing a second weighting
//    means a food panel cannot suppress a dot a biomarker genuinely calls for.
//
// Only an UNEXPIRED restriction counts. The report's windows are 1, 2 and 3-6 months, so a panel
// from last year describes a period that has already ended; continuing to weight a formula on it
// would silently make a temporary finding permanent.
async function _fetchFoodSensitivityContext(userId, dotsFormulary) {
    try {
        const { rows } = await pool.query(
            `SELECT f.food_key, f.severity, f.valid_until::text AS valid_until, c.name_zh, c.name_en,
                    c.category, c.common_sources_zh, c.substitutes_zh
               FROM user_memory_facts f
               JOIN food_catalog c ON c.food_key = f.food_key
              WHERE f.user_id = $1 AND f.status = 'active' AND f.food_key IS NOT NULL
              ORDER BY f.severity DESC NULLS LAST, f.food_key`,
            [userId]
        );
        const today = getNowShanghai().toISODate();
        const live = rows.filter(r => !r.valid_until || r.valid_until >= today);
        return {
            restrictions: live.map(r => ({
                food_key: r.food_key,
                name_zh: r.name_zh,
                name_en: r.name_en,
                category: r.category,
                class: r.severity,
                avoid_until: r.valid_until,
                substitutes_zh: r.substitutes_zh || [],
            })),
            promoted_dot_keys: live.length > 0 ? resolveGutAxisDotKeys(dotsFormulary) : [],
        };
    } catch (err) {
        // Never fail a formulation over this. A missing panel context costs some emphasis; a
        // thrown error costs the user their formula entirely.
        console.log(JSON.stringify({ level: 'WARN', msg: 'food_sensitivity_context_failed', error: err.message }));
        return { restrictions: [], promoted_dot_keys: [] };
    }
}

// The original (2026-07 and earlier) formulation path: one non-agentic LLM completion over the
// latest biomarker snapshot, parsed into per-dot morning/evening counts. Used directly for Nano
// (unchanged), and as the deterministic fallback for Viva when the richer async agentic path
// (handleChatGenerateEvent's 'formula_dots_generate' kind) can't run — EventBridge publish
// failure, or the agentic turn itself throwing — so a formulation request never ends with the
// user getting nothing. Does NOT touch the DB; callers own the transaction.
async function _runDeterministicFormulation({ biomarkers, bioageProfile, dotsFormulary, personaType, lang, currentSolarTerm, essentialKnowledge, userFacts, activeHealthPlans }) {
    const recommendedKeySet = _resolveCandidateDotKeys(activeHealthPlans, dotsFormulary);
    const nutritionContext = {
        language: lang,
        biomarkers,
        bioage_profile: bioageProfile,
        dots_formulary: dotsFormulary,
        start_date: getNowShanghai().toISODate(),
        days_needed: PLAN_DAYS,
        current_solar_term: currentSolarTerm,
        essential_knowledge: essentialKnowledge,
        user_facts: userFacts,
        recommended_dot_keys: recommendedKeySet ? [...recommendedKeySet] : null,
    };
    const llmClient = getLlmClient();
    const model = process.env.MODEL || 'qwen-plus-latest';
    const nutritionTemplate = personaType === 'viva' ? vivaSystemNutritionTemplate : systemNutritionTemplate;
    const prompt = nutritionTemplate(nutritionContext);
    console.log(JSON.stringify({ level: 'INFO', msg: 'Formula DOTS Context', data: nutritionContext }));

    const completion = await llmClient.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
    });

    const llmText = completion.choices[0].message.content || '';
    console.log(JSON.stringify({ level: 'INFO', msg: 'LLM Response', text: llmText }));
    let analysis = '';
    const dotCounts = {};
    const dotsByKey = new Map(dotsFormulary.map(d => [d.key_name.replace(/^DOT/, 'D'), d]));

    // Improved parsing for ANALYSIS and FORMULATION sections
    const lines = llmText.split('\n');
    let currentSection = '';

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (trimmed.startsWith('ANALYSIS:')) {
            analysis = trimmed.replace('ANALYSIS:', '').trim();
            currentSection = 'analysis';
            continue;
        } else if (trimmed.startsWith('FORMULATION:')) {
            currentSection = 'formulation';
            continue;
        }

        if (currentSection === 'formulation') {
            const m = trimmed.match(/^(D-N\d+):\s*(\d+)$/);
            if (m) {
                const dot = dotsByKey.get(m[1]);
                const min = dot?.target_dots_min ?? 1;
                const max = dot?.target_dots_max ?? 10;
                dotCounts[m[1]] = Math.min(max, Math.max(min, parseInt(m[2], 10)));
            }
        } else if (currentSection === 'analysis' && !analysis) {
            // In case it's multi-line (though prompt says brief)
            analysis = trimmed;
        }
    }

    // Fill any missing keys with the deterministic per-dot fallback, biased by focus (see
    // _fallbackCountForDot) when the user has an active health plan with recommended dots.
    for (const dot of dotsFormulary) {
        const k = dot.key_name.replace(/^DOT/, 'D');
        if (!dotCounts[k]) {
            const isRecommended = recommendedKeySet ? recommendedKeySet.has(dot.key_name) : undefined;
            dotCounts[k] = _fallbackCountForDot(dot, isRecommended);
        }
    }

    // The chat message deliberately does NOT include a raw per-dot text dump (previously
    // _generatePlanText's D-N1x3 D-N2x3 ... breakdown, repeated once per identical day) —
    // found 2026-07-29 that this read as confusing technical noise. Exact per-dot numbers now
    // live in the :::formula chart the caller appends (_buildFormulaChartBlock), which is where
    // the old "查看方案" button used to send people.
    const finalContent = analysis || (lang === 'zh'
        ? '这是根据您当前数据评估出的原粒配比，仅供参考。'
        : 'Here is the dot allocation evaluated from your current data, for reference.');

    const morningRecipe = { dots: {} };
    const eveningRecipe = { dots: {} };
    for (const dot of dotsFormulary) {
        const k = dot.key_name.replace(/^DOT/, 'D');
        const count = dotCounts[k];
        if (!count || count <= 0) continue;
        const { morning, evening } = _splitDotTiming(dot, count);
        if (morning > 0) morningRecipe.dots[dot.key_name] = morning;
        if (evening > 0) eveningRecipe.dots[dot.key_name] = evening;
    }

    // Locked dots into their own capsule, flexible ones dealt out to level the two — the same
    // rule the agentic path applies to its own allocation, so the fallback formula is no harder
    // to take than the one it stands in for.
    const balanced = _balanceCapsules(morningRecipe, eveningRecipe, dotsFormulary);

    return { analysis, finalContent, morningRecipe: balanced.morning, eveningRecipe: balanced.evening, dotCounts };
}

// Writes the PLAN_DAYS x 2 schedule rows for a plan, expanding a steady-state recipe through
// _expandPlanDay so the day-by-day rules live in exactly one place. Shared by the two paths that
// turn a recipe into a running schedule. Only _activateProposedPlan (the box scan for a
// chat-tool proposal) uses it today; _commitAgFormulation writes its own pre-expanded capsules.
async function _writeExpandedSchedules(client, { planId, userId, startDateObj, morningRecipe, eveningRecipe, dotsFormulary }) {
    const ctx = _planExpansionContext(morningRecipe, eveningRecipe, dotsFormulary);
    for (let i = 0; i < PLAN_DAYS; i++) {
        const currentDate = startDateObj.plus({ days: i }).toISODate();
        const day = _expandPlanDay(i, ctx, currentDate);
        await client.query(
            'INSERT INTO nutrition_schedules (plan_id, user_id, scheduled_date, slot_name, recipe) VALUES ($1, $2, $3, $4, $5)',
            [planId, userId, currentDate, 'morning_cup', day.morning]
        );
        await client.query(
            'INSERT INTO nutrition_schedules (plan_id, user_id, scheduled_date, slot_name, recipe) VALUES ($1, $2, $3, $4, $5)',
            [planId, userId, currentDate, 'evening_cup', day.evening]
        );
    }
}

// _commitNutritionPlan lived here until 2026-08-28: it superseded whatever plan a user was on
// and inserted a fresh ACTIVE one with a full cycle of schedules, from a steady-state recipe. Its
// only caller was the nutrition top-up job (removed — see the note further down), so it went with
// it. The two functions that may still put a user on a plan both require a scanned box:
// _activateProposedPlan (a chat-tool proposal) and _commitAgFormulation (a Viva AG formula). Both
// write their schedules through _writeExpandedSchedules, which is what _commitNutritionPlan's day
// expansion was factored into.

// Records what the Formulate-Dots chat tool just worked out as a 'proposed' plan.
//
// A proposal is a real, purchasable 28-day recipe that the user does not yet physically have, so
// two things it does NOT do are as important as what it does:
//
//   * No schedules. The 56 capsules are generated at box-scan time (_activateProposedPlan), when
//     start_date becomes a real date. The dates written here are provisional placeholders for
//     NOT NULL columns, exactly as the AG approval path does for 'approved'.
//   * It never touches the user's 'active' plan. Someone mid-cycle on a box they already have
//     keeps taking it; asking the chat tool a question must not silently end that cycle. Only a
//     previous proposal is superseded, so there is at most one live proposal to price.
//
// Returns the new plan id.
async function _commitProposedPlan(client, { userId, analysis, morningRecipe, eveningRecipe, activeHealthPlans, tierVariants }) {
    const primaryHealthPlanId = (activeHealthPlans || []).find(p => p.plan_type === 'primary')?.id ?? null;
    const secondaryHealthPlanId = (activeHealthPlans || []).find(p => p.plan_type === 'secondary')?.id ?? null;

    await client.query(
        `UPDATE nutrition_plans SET status = 'superseded' WHERE user_id = $1 AND status = 'proposed'`,
        [userId]
    );
    // Minted here, at generation time, because the QR is part of the deliverable: the user can
    // view it as soon as the formula exists, it is what gets printed on the box compounded from
    // it, and it is what the Mini Program scans to activate the plan. See lib/labelCode.js.
    const labelCode = await generateLabelCode();
    const { rows: [plan] } = await client.query(
        `INSERT INTO nutrition_plans (user_id, start_date, end_date, goal, status, source,
                                      proposed_recipe, label_code, primary_health_plan_id, secondary_health_plan_id)
         VALUES ($1, CURRENT_DATE, CURRENT_DATE + $2::int, $3, 'proposed', 'nano', $4, $5, $6, $7)
         RETURNING id`,
        [userId, PLAN_DAYS - 1, (analysis || 'Proposed Formulation').slice(0, 2000),
         // `weeks` is written only when the formula actually varies across the cycle, so a
         // steady-state proposal is stored in exactly the shape it always was. Absent means every
         // dot is in every week — see _weekMembership.
         JSON.stringify({
             morning: morningRecipe?.dots || {},
             evening: eveningRecipe?.dots || {},
             ...(morningRecipe?.weeks || eveningRecipe?.weeks
                 ? { weeks: { ...(eveningRecipe?.weeks || {}), ...(morningRecipe?.weeks || {}) } }
                 : {}),
             // The wider tiers of the same formula, when the user was offered a ladder
             // (_buildTierLadder). `morning`/`evening` above are the NARROWEST of them, so every
             // reader that predates this key — the box scan, the printed label, the checkout
             // snapshot — keeps working untouched and sees a recipe that fits any package sold.
             // handlePostFormulationSubmit picks the widest that fits the code actually redeemed
             // and collapses the row back to a single recipe.
             ...(Array.isArray(tierVariants) && tierVariants.length > 1
                 ? { tiers: tierVariants.map(v => ({
                     max_distinct_dots: v.max_distinct_dots,
                     tier_label: v.tier_label || null,
                     morning: v.morning?.dots || {},
                     evening: v.evening?.dots || {},
                     // Each tier has its OWN rotation: a width caps a week, so a wider tier both
                     // runs more dots per week and generally rotates differently. Reusing the
                     // top-level `weeks` for all of them would describe a schedule none of them
                     // actually has.
                     //
                     // Entries naming all four weeks are dropped: _capDistinctDots materialises
                     // the full membership whenever it trims anything, and "every week" already
                     // means the same as absent — storing it makes a steady formula read as a
                     // rotating one to anything inspecting the row.
                     ..._tierWeeks(v),
                 })) }
                 : {}),
         }),
         labelCode, primaryHealthPlanId, secondaryHealthPlanId]
    );
    return plan.id;
}

// The box-scan half of a chat-tool proposal: the sibling of _commitAgFormulation, for a plan that
// came from nano's own formulator rather than the external agent.
//
// This is where "Day 1" stops being relative. The proposal was authored with no start date
// because the capsules had to be compounded and shipped first; scanning the delivered box is the
// first moment a real calendar day exists, so start_date is rewritten to today and the 56 capsules
// are generated from there.
//
// Returns the plan id, or null if the row was not a live proposal (already activated by an
// earlier scan of another box from the same batch, or superseded by a newer proposal before the
// box arrived) — callers treat null as "nothing to activate", not as an error.
async function _activateProposedPlan(client, { userId, planId }) {
    const { rows: [plan] } = await client.query(
        `SELECT id, status, goal, proposed_recipe FROM nutrition_plans
          WHERE id = $1 AND user_id = $2 FOR UPDATE`,
        [planId, userId]
    );
    if (!plan) return null;
    // A second box from the same batch: the first scan already started the cycle, so join it
    // rather than regenerating a schedule the user is part-way through.
    if (plan.status === 'active') return plan.id;
    if (plan.status !== 'proposed') {
        console.log(JSON.stringify({ level: 'WARN', msg: 'activate_proposed_plan_not_proposed', userId, planId, status: plan.status }));
        return null;
    }
    const recipe = plan.proposed_recipe || {};
    // `weeks` carries the rotation the proposal was authored with; a row written before weeks
    // existed simply has none, and expands to four identical weeks exactly as it used to.
    const morningRecipe = { dots: recipe.morning || {}, weeks: recipe.weeks || undefined };
    const eveningRecipe = { dots: recipe.evening || {}, weeks: recipe.weeks || undefined };

    const startDateObj = getNowShanghai();
    const endDateObj = startDateObj.plus({ days: PLAN_DAYS - 1 });
    await client.query(
        `UPDATE nutrition_plans SET status = 'active', start_date = $1, end_date = $2 WHERE id = $3`,
        [startDateObj.toISODate(), endDateObj.toISODate(), plan.id]
    );
    await client.query(
        `UPDATE nutrition_plans SET status = 'superseded' WHERE user_id = $1 AND status = 'active' AND id != $2`,
        [userId, plan.id]
    );

    // proposed_recipe fixes the counts, but not how they land in the two capsules: the expansion
    // still re-fits an over-budget recipe, which needs each dot's slot, whether it may be split,
    // and its floor. Selecting only the pulse/isolation columns silently expands every dot into
    // the morning capsule at doses under their own minimums — and these are the schedules the
    // user physically takes.
    const { rows: formulary } = await client.query(
        `SELECT key_name, timing, timing_flexible, target_dots_min, target_dots_max,
                dosing_protocol, pulse_days_per_cycle, pulse_cycle_days FROM dots`
    );
    await _writeExpandedSchedules(client, {
        planId: plan.id, userId, startDateObj, morningRecipe, eveningRecipe, dotsFormulary: formulary,
    });
    return plan.id;
}

// Commits a Viva AG formula — the box-scan half of the AG ordering flow.
//
// A DELIBERATE SIBLING of _activateProposedPlan, not a reuse of it. That function takes a
// steady-state morning/evening recipe and EXPANDS it across the cycle, applying
// _applyPulseSchedule, _capRecipeTotal and the DOT-N7 isolation override day by day as it goes.
// An AG formula already encodes all 56 capsules explicitly — pulse days, isolation days and all,
// validated against exactly those rules by lib/agFormulation.js — so running it through that
// expansion would apply every rule a second time and flatten the per-day variation the agent
// deliberately produced. The capsules are written verbatim instead.
//
// `planId` is the 'approved' row created at expert-approval time. Its start_date is rewritten to
// TODAY here: the 28-day cycle starts when the user physically has the capsules, not when the
// formula was authored or the box was compounded.
async function _commitAgFormulation(client, { userId, planId, capsules, analysis }) {
    const startDateObj = getNowShanghai();
    const endDateObj = startDateObj.plus({ days: PLAN_DAYS - 1 });

    const activated = await client.query(
        `UPDATE nutrition_plans SET status = 'active', start_date = $1, end_date = $2,
                goal = COALESCE($3, goal)
          WHERE id = $4 AND status = 'approved' RETURNING id`,
        [startDateObj.toISODate(), endDateObj.toISODate(), analysis || null, planId]
    );
    if (activated.rows.length === 0) {
        // Already active (a re-scan that raced this one) or never approved. Either way this is a
        // no-op, not an error — the caller reports the existing plan rather than making a second.
        console.log(JSON.stringify({ level: 'WARN', msg: 'commit_ag_formulation_not_approved', userId, planId }));
        return null;
    }
    await client.query(
        `UPDATE nutrition_plans SET status = 'superseded' WHERE user_id = $1 AND status = 'active' AND id != $2`,
        [userId, planId]
    );

    for (const capsule of capsules) {
        const slotName = capsule.slot === 'PM' ? 'evening_cup' : 'morning_cup';
        const date = startDateObj.plus({ days: capsule.day - 1 }).toISODate();
        // Defensive only — validateAgFormulation already rejects an over-full capsule, so this
        // never fires for a formula that got this far. A physical fill limit is worth enforcing on
        // both sides of the boundary rather than trusting that it was checked upstream.
        const recipe = _capRecipeTotal({ dots: { ...capsule.dots } }, MAX_DOTS_PER_CAPSULE);
        await client.query(
            'INSERT INTO nutrition_schedules (plan_id, user_id, scheduled_date, slot_name, recipe) VALUES ($1, $2, $3, $4, $5)',
            [planId, userId, date, slotName, recipe]
        );
    }
    return planId;
}

// The dispatcher's nutrition.topup handler lived here until 2026-08-28. It generated a
// formulation and committed it as the user's ACTIVE plan, on a timer, for anyone with fewer than
// 7 upcoming scheduled days — which included every user who had never ordered a box. Removed
// along with the scan that triggered it (dispatcher/index.js) and the route that delivered it
// (worker/index.js), so nothing creates a nutrition plan except a box scan.

async function handlePostFormulaDots(body) {
    // `ignore_focus` is the user answering "不设方向" in the client's focus sheet: formulate from
    // biomarkers alone even though an active health_plans focus exists. Not the same as having no
    // focus by accident — it is a deliberate choice, and it is honoured by zeroing the plans out
    // entirely rather than only skipping the dose bias, so this path is byte-identical to a user
    // who never joined a plan. That also means the resulting nutrition_plans row records no
    // primary/secondary link, which is correct: no focus shaped it.
    const { openid, ignore_focus: ignoreFocus = false } = body;
    if (!openid) return { success: false, error: 'openid is required' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };

        const [userResult, bioResult, dotsResult] = await Promise.all([
            pool.query('SELECT * FROM users WHERE user_id = $1 OR external_id = $1 LIMIT 1', [openid]),
            pool.query(
                `SELECT bio_age, data, tested_at FROM biomarkers WHERE user_id = (SELECT user_id FROM users WHERE user_id = $1 OR external_id = $1 LIMIT 1)
                 AND test_type = 'kino_chip' AND (data->'validated') IS NOT NULL ORDER BY tested_at DESC LIMIT 1`,
                [openid]
            ),
            pool.query(`SELECT id, key_name, key_name_zh, name, name_zh, color_hex, timing, timing_flexible, ingredients, ingredients_zh, sub_age_target, target_dots_min, target_dots_max, dosing_protocol, pulse_days_per_cycle, pulse_cycle_days FROM dots ORDER BY id ASC`),
        ]);

        if (userResult.rows.length === 0) return { success: false, error: 'User not found' };
        const user = userResult.rows[0];
        const latestBio = bioResult.rows[0] || {};
        const data = latestBio.data || {};
        const biomarkers = data.validated || {};
        const bioageProfile = data.bioage_profile || {};

        let channelPersonaType = 'nano';
        if (user.channel_id) {
            try {
                const chResult = await pool.query('SELECT effective_persona_type($1) AS persona_type', [user.channel_id]);
                channelPersonaType = chResult.rows[0]?.persona_type ?? 'nano';
            } catch (_) {}
        }
        const personaType = resolveEffectivePersona({
            channelPersonaType,
            personaOverrideType: user.persona_override_type,
            personaOverrideExpiresAt: user.persona_override_expires_at,
        });

        const lang = user.language || 'zh';

        // NO KINO SCAN, NO FORMULATION. Every dose this tool assigns is scaled by how far a
        // sub-age sits above the user's chronological age (_doseFromRanking, _fallbackCountForDot,
        // the severity ranking the prompt asks the model to produce) — with no BioAge there is
        // nothing to scale against, and what the user got instead was a formula built on age and
        // BMI alone, narrated by a model that had been handed no biology to explain it with.
        //
        // Found live on prod 2026-09-08: the guardrail block tells the model to say so plainly
        // when the data doesn't support a judgment, so the narrative above a real 28-day card
        // came back as nothing but "目前没有足够信息支持这个判断。" — a card the user is invited to
        // order, under a sentence saying it could not be reasoned about. Users whose only
        // biomarker rows are `lab_import` land here too: the query above is `kino_chip`-only,
        // which is the product's definition of a Kino test across all 13 of its call sites.
        //
        // Delivered as a normal AI chat message rather than an error, because the client shows a
        // canned "配方已生成" for any non-`processing` success and has no branch for a refusal —
        // and because this IS the answer to what the user asked, not a failure.
        if (bioageProfile?.BioAge == null) {
            const message = lang === 'en'
                ? 'To build your dots formulation I need your BioAge first. It comes from a Kino chip scan, and it is what decides how much of each dot you take — without it I would be guessing rather than formulating, so I am stopping here. Complete a Kino scan, then tap Formulate Dots again and I will build the plan around your four sub-ages.'
                : '要为你配这份原粒方案，我需要先拿到你的生理年龄（BioAge）——它由 Kino 芯片检测算出，也是决定每个原粒用量的依据。你目前还没有完成过 Kino 检测，缺了它我只能靠猜，所以这一步先停在这里。完成一次 Kino 芯片检测后，再回到这里点「原粒定制」，我就能按你的四项子年龄来配了。';
            await pool.query(
                'INSERT INTO notifications (user_id, notification_type, content, status) VALUES ($1, $2, $3, $4)',
                [user.user_id, 'formulation_proposal', message, 'pending']
            );
            await _saveChatMessage(user.user_id, 'ai', message, null, personaType);
            console.log(JSON.stringify({ level: 'INFO', msg: 'formula_dots_blocked_no_bioage', user_id: user.user_id }));
            // `processing: true` keeps the client's waiting UI alive for the one poll it takes to
            // deliver the message above; `{success:true}` alone would print "配方已生成" beside it.
            return { success: true, processing: true, reason: 'no_bioage', message };
        }

        const currentSolarTerm = getCurrentSolarTerm(getNowShanghai().toJSDate());
        const essentialKnowledge = await getEssentialBlock(personaType);
        const userFactsResult = await pool.query(
            `SELECT f.category, f.fact_zh, f.severity, f.valid_until::text AS valid_until, f.food_key,
                        COALESCE(fc.dot_conflict_keys, '{}') AS dot_conflict_keys
                   FROM user_memory_facts f
                   LEFT JOIN food_catalog fc ON fc.food_key = f.food_key
                  WHERE f.user_id = $1 AND f.status = 'active'
                  ORDER BY f.category, f.last_mentioned_at DESC`,
            [user.user_id]
        );
        const foodSensitivity = await _fetchFoodSensitivityContext(user.user_id, dotsResult.rows);

        // Both personas now run the actual dot-count decision through the agentic
        // PLAN→GENERATE→JUDGE→REVISE loop, delivered async (see _handleFormulaDotsAgentic) —
        // Nano and Viva share the engine, differing only in prompt wording/branding and
        // knowledge_entries rows. _runDeterministicFormulation below is no longer the primary
        // entry point for either persona, but stays as the deterministic fallback used on
        // agentic failure (handleChatGenerateEvent's catch block) and EventBridge publish
        // failure (this function's own fail-open path, below).
        return await _handleFormulaDotsAgentic({ user, biomarkers, bioageProfile, dotsFormulary: dotsResult.rows, latestBio, lang, currentSolarTerm, essentialKnowledge, userFacts: userFactsResult.rows, foodSensitivity, personaType, ignoreFocus });
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handlePostFormulaDots failed', error: err.message }));
        return { success: false, error: err.message };
    }
}

// Shared by both personas — the actual dot-count decision is made by the full agentic
// PLAN→GENERATE→JUDGE→REVISE loop, using the user's full digital twin (health_twin,
// questionnaire history, active health-plan goals) plus tool access to biomarker history /
// dot inventory / prior schedules, not just the latest biomarker snapshot. Because that loop
// can take 10s-180s+, and Aliyun FC cancels an invocation the instant the HTTP client
// disconnects (CLAUDE.md §22), the decision itself runs asynchronously via the same
// chat.generate event → notifications-poll pipeline already shipped for chat/health-advice —
// this handler only publishes the event and returns immediately.
//
// PROPOSES a plan; it does not put the user on one. The result is committed as a 'proposed'
// nutrition_plans row (no schedules, never supersedes the active plan) plus a chat message
// carrying a :::formula chart of the whole 28-day cycle. That row is what GCN's checkout prices,
// and it becomes the user's live plan only when the delivered box is scanned. No 'pending' row is
// inserted here — the write happens in the finalizer, once there is a validated recipe to write.
async function _handleFormulaDotsAgentic({ user, biomarkers, bioageProfile, dotsFormulary, latestBio, lang, currentSolarTerm, essentialKnowledge, userFacts, foodSensitivity = { restrictions: [], promoted_dot_keys: [] }, personaType, ignoreFocus = false }) {
    const age = calculateAge(user.birth_date);
    const heightCm = user.bio_data?.height;
    const weightKg = user.bio_data?.weight;
    const bmi = heightCm && weightKg ? Math.round((weightKg / ((heightCm / 100) ** 2)) * 10) / 10 : null;

    const [healthTwinResult, questionnaireResult, activePlansResult] = await Promise.all([
        pool.query(
            `SELECT avg_hrv_ms, avg_resting_hr, avg_spo2, avg_sleep_hours, avg_sleep_score, avg_deep_sleep_pct,
                    avg_daily_steps, avg_active_minutes, latest_weight_kg, latest_bmi, latest_body_fat_pct,
                    latest_lab_data, latest_lab_date, trend_data, data_coverage
             FROM health_twin WHERE user_id = $1`,
            [user.user_id]
        ),
        pool.query(
            `SELECT q.name, q.name_zh, qq.prompt_en, qq.prompt_zh, qr.answer
             FROM questionnaire_responses qr
             JOIN questionnaire_questions qq ON qq.id = qr.question_id
             JOIN questionnaire_assignments qa ON qa.id = qr.assignment_id
             JOIN questionnaires q ON q.id = qa.questionnaire_id
             WHERE qa.user_id = $1 AND qa.status = 'completed'
               AND qq.save_field IS DISTINCT FROM 'birth_date'
               AND qq.save_biomarker_type IS DISTINCT FROM 'body_composition'
             ORDER BY qa.completed_at ASC, qq.sort_order ASC`,
            [user.user_id]
        ),
        pool.query(
            `SELECT hp.id, hp.plan_type, hp.status, hp.start_date, hp.duration_weeks,
                    hpt.name_en, hpt.name_zh, hpt.goal_en, hpt.goal_zh, hpt.target_sub_ages,
                    hpt.recommended_dot_ids
             FROM health_plans hp
             LEFT JOIN health_plan_templates hpt ON hpt.id = hp.template_id
             WHERE hp.user_id = $1 AND hp.status = 'active'
             ORDER BY hp.start_date DESC LIMIT 5`,
            [user.user_id]
        ),
    ]);

    // Never throws (see fetchFormulationOrders): not knowing whether a package is waiting, or
    // what the ladder looks like, costs the prompt a hint — never the user their formulation.
    // Fetched together because the ladder is only used when nothing is waiting, and which of the
    // two applies is not known until the order lookup answers.
    const [orderContext, formulationTiers] = await Promise.all([
        _resolveOrderContext(user.user_id),
        resolveGcnSector(user.channel_id).then(sector => fetchFormulationTiers(sector)).catch(() => fetchFormulationTiers()),
    ]);
    // Mutually exclusive by design: formulation_package is the tier already bought,
    // formulation_tiers the menu of tiers on offer. A user holding a package is not shopping.
    const tierLadder = orderContext.mode === 'buy' ? formulationTiers : [];

    // The user's answer to the focus sheet is applied HERE, once, by dropping the rows — so
    // every consumer below (the prompt's focus section, the dose bias, the rung padding, and the
    // primary/secondary link written at commit) sees the same thing, and "I chose not to use my
    // focus" is indistinguishable from "I have no focus". Skipping only the bias would leave the
    // plan's goal text steering the model anyway, which is not what 不设方向 means.
    const activePlanRows = ignoreFocus ? [] : activePlansResult.rows;

    // Resolved once, here, and then carried on llmContext — the prompts and the pad-candidate
    // ranking below all read this one Set rather than each deriving their own from
    // recommended_dot_ids. See the field's comment on llmContext.
    const planKeySet = _resolveCandidateDotKeys(activePlanRows, dotsFormulary);
    // A live food-sensitivity panel promotes the gut-axis dots through the same additive channel
    // as a health-plan focus (§40). Union, never replace: a focus and a panel are two independent
    // reasons to emphasise a dot, and dropping either would make one of them silently lose.
    const recommendedKeySet = (planKeySet || foodSensitivity.promoted_dot_keys.length > 0)
        ? new Set([...(planKeySet || []), ...foodSensitivity.promoted_dot_keys])
        : null;

    const llmContext = {
        user_profile: { nickname: user.nickname, gender: user.gender, age, bmi, language: lang },
        biomarkers,
        biomarkers_tested_at: latestBio?.tested_at ? formatToShanghai(new Date(latestBio.tested_at)).slice(0, 10) : null,
        bioage: bioageProfile || {},
        dots: dotsFormulary,
        plan: null,
        health_twin: healthTwinResult.rows[0] || null,
        now_iso: getNowShanghai().toISO(),
        questionnaire_context: formatQuestionnaireContext(questionnaireResult.rows, lang),
        active_health_plans: activePlanRows.map(p => ({
            id: p.id,
            plan_type: p.plan_type,
            name: lang === 'zh' ? p.name_zh : p.name_en,
            goal: lang === 'zh' ? p.goal_zh : p.goal_en,
            target_sub_ages: p.target_sub_ages || [],
            recommended_dot_ids: p.recommended_dot_ids || [],
            weeks_elapsed: Math.max(0, Math.floor((Date.now() - new Date(p.start_date).getTime()) / (7 * 86400000))),
            total_weeks: p.duration_weeks,
        })),
        sub_age_display_names: null,
        // The focus's recommended dots, resolved ONCE here to key_names. Both
        // systemFormulaGenerate.js prompts read this rather than re-deriving it from
        // active_health_plans + dots — three copies of that resolution is how one of them gets
        // missed when the stored shape changes, which it just did
        // (migration_health_plan_recommended_dot_keys.sql). Mirrors the field
        // _runDeterministicFormulation already puts on its own context.
        recommended_dot_keys: recommendedKeySet ? [...recommendedKeySet] : null,
        // Context, not a constraint: these do not remove a dot (§40). They are here so the
        // narrative can say why the gut-axis dots are emphasised, and so a formula is not
        // explained in terms of a food the user has been told to stop eating.
        food_restrictions: foodSensitivity.restrictions,
        current_solar_term: currentSolarTerm,
        essential_knowledge: essentialKnowledge,
        user_facts: userFacts,
        // The package this user has already paid for, if any. Carried into the prompt so the model
        // AIMS at the tier rather than being trimmed down to it afterwards — a formula built for 6
        // dots is a better formula than the best 10-dot one with 4 dots deleted.
        //
        // Best-effort only, and deliberately not the enforcement point: this turn runs
        // asynchronously and may be delivered minutes later, by which time a checkout could have
        // completed. finalizeFormulaDotsGenerate re-resolves the order at delivery and narrows the
        // recipe there (_applyTierLadder), which is what actually binds.
        formulation_package: orderContext.maxDistinctDots
            ? { max_distinct_dots: orderContext.maxDistinctDots, name: orderContext.packageName }
            : null,
        // The purchasable widths, narrowest first, when the user has bought nothing yet. Carried
        // in llmContext rather than re-fetched at delivery — unlike the order lookup, which IS
        // re-resolved there for freshness — because the variants have to be built against the same
        // ladder the model was told to aim at. A catalog that changed mid-turn would otherwise
        // produce rungs the prose beside them never describes.
        formulation_tiers: tierLadder.length > 0 ? tierLadder : null,
    };
    const formulaGenerateTemplate = personaType === 'viva' ? vivaSystemFormulaGenerateTemplate : systemFormulaGenerateTemplate;
    const systemPrompt = formulaGenerateTemplate(llmContext);
    const triggerMsg = lang === 'zh'
        ? `请根据我的完整健康数据，为我配置一个 ${PLAN_DAYS} 天周期的 Dots 方案。`
        : `Please formulate a ${PLAN_DAYS}-day Dots plan based on my complete health data.`;

    try {
        await publishChatGenerateEvent({
            event_id: uuidv4(), user_id: user.user_id, kind: 'formula_dots_generate',
            message: triggerMsg, intent: 'nutrition_question', llmContext,
            systemPrompt, cleanHistory: [], language: lang, personaType,
        });
        return { success: true, processing: true };
    } catch (ebErr) {
        console.log(JSON.stringify({ level: 'WARN', msg: 'chat_generate_publish_failed_fallback_sync', user_id: user.user_id, handler: 'handlePostFormulaDots', error: ebErr.message }));
        // Fail open: publish itself failed, so run the deterministic formulator synchronously and
        // deliver the same proposal the async path would have.
        const deterministic = await _runDeterministicFormulation({
            biomarkers, bioageProfile, dotsFormulary, personaType, lang, currentSolarTerm, essentialKnowledge, userFacts,
            activeHealthPlans: llmContext.active_health_plans,
        });
        const { analysis, finalContent } = deterministic;
        // Narrowed before it is stored, so the card, the box scan and the fast-track submission
        // all expand the same recipe. The fallback has no model output to read a pitch from, so
        // its tiers are ranked on emphasis alone and carry no copy — but it must still ladder: a
        // proposal with no `tiers` and no cap is one a wider code cannot be spent on, which is the
        // exact failure this whole change exists to remove.
        const { morningRecipe, eveningRecipe, tierVariants, tierCards } = _applyTierLadder({
            morningRecipe: deterministic.morningRecipe,
            eveningRecipe: deterministic.eveningRecipe,
            dotsFormulary, orderContext, tiers: tierLadder,
            padCandidates: _padCandidatesFor({ dotsFormulary, bioage: bioageProfile, recommendedKeySet }),
        });
        const client = await pool.connect();
        let planId = null;
        try {
            await client.query('BEGIN');
            planId = await _commitProposedPlan(client, {
                userId: user.user_id, analysis, morningRecipe, eveningRecipe, tierVariants,
                activeHealthPlans: llmContext.active_health_plans,
            });
            await client.query('COMMIT');
        } catch (commitErr) {
            await client.query('ROLLBACK');
            // The proposal is a nice-to-have here; the user still gets the numbers in chat, just
            // without a store CTA to order them.
            console.error(JSON.stringify({ level: 'ERROR', msg: 'commit_proposed_plan_failed', user_id: user.user_id, error: commitErr.message }));
        } finally {
            client.release();
        }
        const message = localizeStatusWords(dropForeignLines(scrubToolNames(humanizeSubAgeKeys(humanizeDotCodes(
            finalContent + _buildFormulaChartBlock(morningRecipe, eveningRecipe, dotsFormulary, lang, { planId, orderMode: orderContext.mode, tiers: tierCards }),
            dotsFormulary, lang), lang), lang), lang), lang);
        await pool.query(
            'INSERT INTO notifications (user_id, notification_type, content, status) VALUES ($1, $2, $3, $4)',
            [user.user_id, 'formulation_proposal', message, 'pending']
        );
        await _saveChatMessage(user.user_id, 'ai', message, null, personaType);
        return { success: true };
    }
}

async function handlePostDots(body) {
    const { key_name, key_name_zh, name, name_zh, color, color_zh, color_hex, group_name, group_name_zh, sub_age_target, sub_age_target_zh, timing, timing_flexible, ingredients_summary, description, is_isolate, ingredients, ingredients_zh } = body;
    if (!key_name || !name) return { success: false, error: 'key_name and name are required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const maxIdResult = await pool.query('SELECT MAX(id) as max_id FROM dots');
        const nextId = (maxIdResult.rows[0].max_id || 0) + 1;

        const result = await pool.query(
            `INSERT INTO dots (id, key_name, key_name_zh, name, name_zh, color, color_zh, color_hex, group_name, group_name_zh, sub_age_target, sub_age_target_zh, timing, timing_flexible, ingredients_summary, description, is_isolate, ingredients, ingredients_zh)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
            [nextId, key_name, key_name_zh || null, name, name_zh || null, color || null, color_zh || null, color_hex || null,
             group_name || null, group_name_zh || null, sub_age_target || null, sub_age_target_zh || null,
             timing || null, !!timing_flexible, ingredients_summary || null, description || null, !!is_isolate,
             ingredients ? JSON.stringify(ingredients) : null,
             ingredients_zh ? JSON.stringify(ingredients_zh) : null]
        );
        return { success: true, id: result.rows[0].id };
    } catch (err) {
        return { success: false, error: err.detail || err.message };
    }
}

async function handlePutDot(dotId, body) {
    const { name, name_zh, key_name_zh, color, color_zh, color_hex, group_name, group_name_zh, sub_age_target, sub_age_target_zh, timing, timing_flexible, ingredients_summary, description, is_isolate, ingredients, ingredients_zh } = body;
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        await pool.query(
            `UPDATE dots SET name=$1, name_zh=$2, key_name_zh=$3, color=$4, color_zh=$5, color_hex=$6, group_name=$7,
             group_name_zh=$8, sub_age_target=$9, sub_age_target_zh=$10, timing=$11, timing_flexible=$12, ingredients_summary=$13,
             description=$14, is_isolate=$15, ingredients=$16, ingredients_zh=$17 WHERE id=$18`,
            [name, name_zh || null, key_name_zh || null, color || null, color_zh || null, color_hex || null,
             group_name || null, group_name_zh || null, sub_age_target || null, sub_age_target_zh || null,
             timing || null, !!timing_flexible, ingredients_summary || null, description || null, !!is_isolate,
             ingredients ? JSON.stringify(ingredients) : null,
             ingredients_zh ? JSON.stringify(ingredients_zh) : null,
             dotId]
        );
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleDeleteDot(dotId) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        await pool.query('DELETE FROM dots WHERE id = $1', [dotId]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = {
    handleGetDotsInventory,
    handleGetNutritionPlan,
    handleGetFormulationCheckoutSnapshot,
    handleGetFormulationLabelByCode,
    handleGetFormulationReviewSnapshot,
    _buildReviewTwinContext,
    _getCommittedPlanDay0Breakdown,
    handlePostFormulaDots,
    handlePostDots,
    handlePutDot,
    handleDeleteDot,
    _runDeterministicFormulation,
    _commitProposedPlan,
    _activateProposedPlan,
    _commitAgFormulation,
    _formulationLabelUrl,
};
