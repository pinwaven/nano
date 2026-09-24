'use strict';

// The commerce half of 营养定制: what a user's dots packages are, where each one is, and the two
// actions that spend money-shaped things on a formula — redeeming a code and submitting a proposal
// against a paid package. Everything here reads GCN live (CLAUDE.md §28, "Packages, orders, redeem
// codes"): NOTHING IS MIRRORED into a nano table, and every "is a package waiting?" answer comes from
// the one source, fetchFormulationOrders.
//
// Carved out of handlers/dots.js on 2026-09-16. handlers/dots.js still owns the formula itself
// (generation, plan rows, the box scan); lib/agenticTools.js reads the package list and the stage
// narration from here for the get_formulation_packages chat tool.

const { DateTime } = require('luxon');
const { pool } = require('../lib/db');
const { getNowShanghai } = require('../lib/time-utils');
const { PLAN_DAYS } = require('../lib/dotsProductModel');
// The same validator an externally-authored Viva AG formula must pass. A fast-track formula gets
// no expert review at all, which makes this the ONLY thing standing between a generated table and
// physical capsules — so it runs here too, and a violation refuses the submission outright.
const { validateAgFormulation } = require('../lib/agFormulation');
const { fetchFormulationOrders, submitFastTrackFormulation,
        fetchFormulationCodes, redeemFormulationCode } = require('../lib/gcnClient');
const { _countDistinctDots, _selectTierVariant, _expandProposalToCapsules } = require('../lib/formulation');

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Formulation packages — one journey per row, assembled from two systems
//
// A user's custom-dots journey lives half in GCN (the order: paid, compounding, shipped) and half
// in nano (the formula: proposed, approved, active). Neither half alone answers "where are my
// capsules", which is why the Dots subtab could not answer it at all before this — nano's only
// record that an order existed was users.custom_formulation_purchased_at, a bare timestamp.
//
// NOTHING IS MIRRORED. The order half is read from GCN at request time, never copied into a nano
// table. A cached status has nothing to reconcile itself against — an order can be refunded,
// cancelled, or fulfilled by an AG run between two reads — which is the same reasoning
// fetchFormulationOrders already records for pulling rather than stamping a flag.
// ─────────────────────────────────────────────────────────────────────────────────────────────

// The stage a USER is at, which is not the same thing as either system's own status column.
// Two of these ('proposed', 'active') have no GCN order behind them at all, and two more
// ('awaiting_formulation' vs 'awaiting_ag') are one GCN status split by which package was bought,
// because they ask opposite things of the user: one needs them to act, the other explicitly does
// not. The miniapp keys its labels off these strings (t['pkgStage_' + stage]).
const PACKAGE_STAGES = new Set([
    'proposed',              // a formula from the chat tool that nobody has ordered yet
    'pending_payment', 'paid',
    'awaiting_formulation',  // fast-track package waiting on THIS user to confirm a formula
    'awaiting_ag',           // premium package — Viva AG formulates it, the user does nothing
    'expert_review', 'compounding',
    'shipped', 'delivered',  // both mean "scan the box"
    'active',                // the box was scanned; capsules are being taken
    'cancelled', 'refunded',
]);

// What each stage MEANS, and what the user does next — written here, in code, and handed to the
// chat model on the row itself (get_formulation_packages, §28g). The model narrates these; it
// never derives them from the stage string.
//
// This is the same division §28f draws for the package card ("the model ranks; the server
// partitions") and §37 for product copy ("the model picks, the server writes"). A prompt that
// enumerated the stages would be a THIRD definition of this vocabulary, in the one medium where
// drift is invisible: rename a stage in code and the prompt would keep narrating the old meaning,
// confidently, forever. Keep this table and the miniapp's t['pkgStage_' + stage] labels in step
// with PACKAGE_STAGES above; a test asserts all three cover exactly the same values.
//
// `next_step` is what the USER can do, so it is empty wherever the answer is "nothing, wait" —
// 'awaiting_ag' most of all, where the whole point of the premium package is that it asks nothing
// of them. Never invent a delivery date or a price here; nano does not price this product.
const PACKAGE_STAGE_NARRATION = {
    proposed: {
        zh: { meaning: '这是对话里生成的配方，还没有下单，也没有人在配制它。', next_step: '如果想要这份配方，可以用兑换码开始配制。' },
        en: { meaning: 'A formula generated in chat. Nothing has been ordered and nobody is compounding it.', next_step: 'Redeem a code to have this formula made.' },
    },
    pending_payment: {
        zh: { meaning: '订单已创建但尚未付款，付款前不会开始配制。', next_step: '在「方案 · 原粒」里完成付款。' },
        en: { meaning: 'The order exists but has not been paid. Nothing is compounded until it is.', next_step: 'Complete payment under Plans · Dots.' },
    },
    paid: {
        zh: { meaning: '已付款，系统正在安排后续流程。', next_step: '' },
        en: { meaning: 'Paid. The order is being routed onward.', next_step: '' },
    },
    awaiting_formulation: {
        zh: { meaning: '这一份套餐已经付款，正在等你确认要配制哪一份配方。', next_step: '运行「营养定制」生成配方，然后确认提交。' },
        en: { meaning: 'This package is paid and is waiting for you to confirm which formula to compound.', next_step: 'Run the 营养定制 tool, then confirm the formula.' },
    },
    awaiting_ag: {
        zh: { meaning: '这一份套餐由 Viva AG 出配方，不需要你做任何事。', next_step: '' },
        en: { meaning: 'Viva AG formulates this package. Nothing is required from you.', next_step: '' },
    },
    expert_review: {
        zh: { meaning: '配方已提交，营养专家正在审核。', next_step: '' },
        en: { meaning: 'The formula has been submitted and a nutrition expert is reviewing it.', next_step: '' },
    },
    compounding: {
        zh: { meaning: '配方已通过，正在配制胶囊。', next_step: '' },
        en: { meaning: 'The formula is approved and the capsules are being compounded.', next_step: '' },
    },
    shipped: {
        zh: { meaning: '已发货。', next_step: '收到盒子后扫描盒上的二维码，方案才会开始。' },
        en: { meaning: 'Shipped.', next_step: 'Scan the QR code on the box when it arrives — that is what starts the cycle.' },
    },
    delivered: {
        zh: { meaning: '已送达，但盒子还没有被扫描，方案尚未开始。', next_step: '扫描盒上的二维码开始这一个周期。' },
        en: { meaning: 'Delivered, but the box has not been scanned yet, so the cycle has not started.', next_step: 'Scan the QR code on the box to begin the cycle.' },
    },
    active: {
        zh: { meaning: '盒子已扫描，这是你目前正在服用的方案。', next_step: '' },
        en: { meaning: 'The box was scanned. This is the plan you are currently taking.', next_step: '' },
    },
    cancelled: {
        zh: { meaning: '订单已取消。', next_step: '' },
        en: { meaning: 'The order was cancelled.', next_step: '' },
    },
    refunded: {
        zh: { meaning: '订单已退款。', next_step: '' },
        en: { meaning: 'The order was refunded.', next_step: '' },
    },
};

// Ranked so the row a user can act on is never buried under one they cannot. Within a rank,
// newest first. Deliberately not pure recency: the whole point of the list is to surface the
// package that is waiting on them.
const _STAGE_RANK = {
    awaiting_formulation: 0, shipped: 1, delivered: 1,
    proposed: 2,
    pending_payment: 3, paid: 3, awaiting_ag: 3, expert_review: 3, compounding: 3,
    active: 4,
    completed: 5, cancelled: 6, refunded: 6,
};

// An order that exists but has no formula on it yet — the slot a proposal is going to fill.
// Deliberately NOT every in-flight stage: once a package reaches expert_review or compounding its
// recipe is already attached, so a proposal made after that is a genuine next-cycle formula and
// must stay orderable. 'awaiting_ag' is here because Viva AG will supply that formula, so a
// chat-tool proposal is not what fills it and offering to buy a second package is wrong.
const AWAITING_FORMULA_STAGES = new Set([
    'pending_payment', 'paid', 'awaiting_formulation', 'awaiting_ag',
]);

// GCN's order status → the user-facing stage, for an order that has no nano plan overriding it.
// 'processing' collapses into 'compounding' because to a buyer they are the same sentence ("it is
// being made"); 'completed' becomes 'delivered' because for a physical box the journey is not over
// until they scan it, and that scan is a nano-side event GCN never learns about.
function _stageFromOrderStatus(order) {
    switch (order.status) {
        case 'pending_payment': return 'pending_payment';
        case 'paid': return 'paid';
        case 'awaiting_formulation':
            return order.fulfillment === 'fast_track' ? 'awaiting_formulation' : 'awaiting_ag';
        case 'expert_review': return 'expert_review';
        case 'compounding':
        case 'processing': return 'compounding';
        case 'shipped': return 'shipped';
        case 'completed': return 'delivered';
        case 'cancelled': return 'cancelled';
        case 'refunded': return 'refunded';
        default: return 'compounding';
    }
}

// Which nano plan belongs to which GCN order. Three links, in confidence order:
//   1. nutrition_plans.gcn_order_id  — written by handlePostFormulationSubmit when nano itself
//      submitted the formula. The strongest signal, because nano wrote both sides of it.
//   2. order.nano_nutrition_plan_id  — written by GCN's attach path. Covers the AG flow, where
//      the plan row is created by handlePostAgFormulationApproved and never carries gcn_order_id.
//   3. the AG formulation id         — the last resort for an AG plan whose order-side id was
//      recorded before the plan existed. TEXT on GCN's side, BIGINT here, so compared as strings.
// intended_nano_plan_id is deliberately NOT used: it is what the buyer was looking at, advisory
// only, and may name a formula that was superseded and never compounded (GCN's migration_0086).
function _planMatchesOrder(plan, order) {
    if (plan.gcn_order_id && String(plan.gcn_order_id) === String(order.order_id)) return true;
    if (order.nano_nutrition_plan_id != null && Number(plan.id) === Number(order.nano_nutrition_plan_id)) return true;
    if (order.nano_ag_formulation_id && plan.ag_formulation_id != null
        && String(plan.ag_formulation_id) === String(order.nano_ag_formulation_id)) return true;
    return false;
}

// Day N of 28, for a plan the user is actually taking. Null for every other status: a proposal's
// start_date is a placeholder (CURRENT_DATE at commit time) and an approved plan's is provisional
// until the box is scanned, so counting from either would show a day number for capsules the user
// does not have. Clamped, because a plan that ran past its end date still reads as "day 28",
// never "day 31".
function _planDayIndex(plan) {
    if (!plan || plan.status !== 'active' || !plan.start_date) return null;
    const start = DateTime.fromISO(String(plan.start_date), { zone: 'Asia/Shanghai' });
    if (!start.isValid) return null;
    const elapsed = Math.floor(getNowShanghai().startOf('day').diff(start.startOf('day'), 'days').days);
    return Math.min(PLAN_DAYS, Math.max(1, elapsed + 1));
}

// PURE — no DB, no network. Takes GCN's orders and nano's own non-superseded plans and returns one
// row per journey. Kept pure so every stage mapping is testable without either system.
// A cancelled order is not a journey the user is on, and listing it under 我的原粒套餐 asks them
// to read a dead row every time they open the tab. Dropped here rather than at the end of the
// merge, which matters: an order can hold a plan (gcn_order_id), so removing the finished row
// would take the formula with it. Filtered before the loop, that plan is simply never claimed and
// re-emerges on its own row at its real status — a proposal whose order was cancelled becomes
// orderable again, which is the same release §28d already gives it by keeping 'cancelled' out of
// AWAITING_FORMULA_STAGES.
//
// 'refunded' is deliberately still shown: money moved, and a user looking for where their refund
// came from should find the order it belongs to.
const _HIDDEN_ORDER_STATUSES = new Set(['cancelled']);

function _mergeFormulationPackages(orders, plans) {
    const orderList = (Array.isArray(orders) ? orders : [])
        .filter(o => !_HIDDEN_ORDER_STATUSES.has(_stageFromOrderStatus(o)));
    const planList = Array.isArray(plans) ? plans : [];
    const claimed = new Set();
    const packages = [];

    for (const order of orderList) {
        const plan = planList.find(pl => !claimed.has(pl.id) && _planMatchesOrder(pl, order)) || null;
        if (plan) claimed.add(plan.id);
        // An active plan outranks whatever the order says. The user scanned the box; that they are
        // taking the capsules is a more useful truth than the order still sitting at 'shipped'
        // because nobody closed it out on the commerce side.
        const stage = plan && plan.status === 'active' ? 'active' : _stageFromOrderStatus(order);
        packages.push(_packageRow({ order, plan, stage }));
    }

    // The formula a waiting package could be filled with. There is at most one un-submitted
    // proposal per user (uniq_nutrition_plans_proposed), and it lives on its OWN row rather than
    // on the order's — so without this, a package that says "needs your formula" would have no
    // way to reach the formula sitting directly above it. Submitting is what binds them; until
    // then the pairing is only an offer, which is why this is a separate field and not a match.
    const submittable = planList.find(pl => !claimed.has(pl.id) && pl.status === 'proposed') || null;
    let offered = false;
    for (const pkg of packages) {
        if (!pkg.can_submit) continue;
        pkg.submit_plan_id = submittable ? Number(submittable.id) : null;
        if (submittable) offered = true;
    }

    // An order that has been placed and is still waiting for a recipe. The plan is not attached
    // until payment is confirmed (_settleFastTrackPackage), so at 'pending_payment' the two halves
    // of one journey are genuinely two rows here — and the standalone one would still be offering
    // 按此配方下单 for a package the user has already ordered.
    const awaitingFormula = packages.some(pkg => pkg.plan_id === null && AWAITING_FORMULA_STAGES.has(pkg.stage));

    // A formula with no order behind it — the chat tool's proposal before anyone has bought it,
    // which is exactly the case the Dots subtab was blindest to. Suppressed once it is spoken for:
    // either offered to a waiting package above, or already ordered against. The same formula
    // listed twice — once as a thing to buy, once as the thing that purchase is for — reads as two
    // different formulas, and the second card's only CTA would place an order that already exists.
    //
    // Note this suppresses on the order's STAGE, not on intended_nano_plan_id. That column names
    // what the buyer was looking at and is advisory (§28d) — but there is at most one un-submitted
    // proposal per user (uniq_nutrition_plans_proposed), so "an order is waiting for a formula"
    // already identifies it without trusting a link that may name a superseded plan.
    for (const plan of planList) {
        if (claimed.has(plan.id)) continue;
        if (plan.status === 'proposed' && (awaitingFormula || (offered && plan.id === submittable.id))) continue;
        packages.push(_packageRow({ order: null, plan, stage: plan.status === 'active' ? 'active' : plan.status }));
    }

    packages.sort((a, b) => {
        const ra = _STAGE_RANK[a.stage] ?? 5;
        const rb = _STAGE_RANK[b.stage] ?? 5;
        if (ra !== rb) return ra - rb;
        return new Date(b.sort_at || 0) - new Date(a.sort_at || 0);
    });
    return packages;
}

function _packageRow({ order, plan, stage }) {
    return {
        stage: PACKAGE_STAGES.has(stage) ? stage : 'compounding',
        order_id: order ? order.order_id : null,
        // The formula behind this package, if one exists yet. plan_id is what the submit and
        // label actions are keyed on, so it stays null rather than guessing.
        plan_id: plan ? Number(plan.id) : null,
        plan_status: plan ? plan.status : null,
        label_code: plan ? (plan.label_code || null) : null,
        day_index: _planDayIndex(plan),
        total_days: plan && plan.status === 'active' ? PLAN_DAYS : null,
        package_name: order ? (order.package_name || null) : null,
        tier_label: order ? (order.tier_label || null) : null,
        max_distinct_dots: order ? (order.max_distinct_dots ?? null) : null,
        fulfillment: order ? order.fulfillment : null,
        ordered_at: order ? (order.created_at || null) : null,
        shipped_at: order ? (order.shipped_at || null) : null,
        // Shown only on a shipped row; the carrier is free text for display and the number is what
        // the user copies into a courier app.
        tracking_number: order ? (order.tracking_number || null) : null,
        shipping_carrier: order ? (order.shipping_carrier || null) : null,
        tracking_status_desc: order ? (order.tracking_status_desc || null) : null,
        // The three CTAs the client renders. Derived here rather than re-derived from `stage` in
        // WXML, so the rule for "can this be acted on" lives in one place.
        can_submit: stage === 'awaiting_formulation',
        can_scan: stage === 'shipped' || stage === 'delivered',
        can_order: stage === 'proposed',
        // An unpaid order blocks everything behind it, and until now the row said 待付款 and
        // offered nothing. Requires an order: a plan-only row has nothing to pay for.
        can_pay: stage === 'pending_payment' && !!order,
        // How wide this proposal actually is, so the client can warn before a code narrower than
        // it is spent. The WEEKLY width _countDistinctDots measures — the same number
        // handlePostFormulationSubmit compares against the purchased tier, so a warning shown
        // here and a refusal there can never disagree.
        distinct_dots: (plan && plan.status === 'proposed' && plan.proposed_recipe)
            ? _countDistinctDots(
                { dots: plan.proposed_recipe.morning || {}, weeks: plan.proposed_recipe.weeks || undefined },
                { dots: plan.proposed_recipe.evening || {}, weeks: plan.proposed_recipe.weeks || undefined })
            : null,
        // The widths this proposal was laddered for (_buildTierLadder), narrowest first — the
        // client uses it to tell the user WHICH of their formulas a code will compound instead of
        // warning them the code is too narrow. `distinct_dots` above is the base, so for a
        // laddered proposal the over-tier warning can no longer fire; it stays correct, and still
        // fires, for a proposal made before the ladder existed.
        tier_widths: (plan && plan.status === 'proposed' && Array.isArray(plan.proposed_recipe?.tiers))
            ? plan.proposed_recipe.tiers.map(t => Number(t.max_distinct_dots)).filter(w => Number.isFinite(w))
            : null,
        // Filled in by the caller for can_submit rows only: the proposal this package could be
        // filled with, which is a different plan from `plan_id` (nothing is bound until submit).
        submit_plan_id: null,
        sort_at: (order && order.created_at) || (plan && plan.created_at) || null,
    };
}

// The unredeemed codes this user owns, for the 原粒 subtab's 兑换码 section.
//
// A SIBLING of the package list, never a source for it: a code is a thing they can start, not a
// package they have. Never throws — fetchFormulationCodes already degrades to [], and the subtab
// must still render packages and the active plan when the code half is unavailable.
async function _fetchFormulationCodes(userId) {
    if (!userId) return [];
    try {
        return await fetchFormulationCodes(userId);
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: '_fetchFormulationCodes failed',
            user_id: userId, error: err.message }));
        return [];
    }
}

// The DB + GCN half. Never throws: fetchFormulationOrders degrades to [] on any failure, and a
// plan-query failure degrades the whole list to [] rather than failing the caller — the Dots
// subtab must still render the user's active plan when the order half is unavailable.
async function _fetchFormulationPackages(userId) {
    if (!userId) return [];
    try {
        const [orders, plansRes] = await Promise.all([
            fetchFormulationOrders(userId),
            pool.query(
                `SELECT id, status, start_date::text AS start_date, created_at,
                        label_code, gcn_order_id, ag_formulation_id, proposed_recipe
                   FROM nutrition_plans
                  WHERE user_id = $1 AND status IN ('proposed', 'approved', 'active')
                  ORDER BY created_at DESC
                  LIMIT 20`,
                [userId]
            ),
        ]);
        return _mergeFormulationPackages(orders, plansRes.rows);
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: '_fetchFormulationPackages failed',
            user_id: userId, error: err.message }));
        return [];
    }
}

// GET /formulation-orders?openid=   (app bearer, the user's own packages)
//
// The same list handleGetNutritionPlan embeds, on its own endpoint. It exists for the chat card:
// handleFormulaSubmit resolves the awaiting packages at TAP time rather than trusting what the
// card said when it was rendered, because the formulation turn is async and a card can be minutes
// old by the time someone acts on it — the same reason _resolveOrderContext does not cache a mode.
async function handleGetFormulationOrders(openid) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        if (!openid) return { success: true, packages: [] };
        const { rows: [user] } = await pool.query(
            'SELECT user_id FROM users WHERE user_id = $1 OR external_id = $1 LIMIT 1', [openid]);
        if (!user) return { success: true, packages: [] };
        return { success: true, packages: await _fetchFormulationPackages(user.user_id) };
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handleGetFormulationOrders failed', error: err.message }));
        return { success: false, error: err.message };
    }
}

// POST /formulation-submit  { openid, plan_id }   (app bearer, the user's own action)
//
// The "buy first, formulate second" half of the custom-dots flow. The user already paid for a
// flat-priced 28-day package, GCN parked that order at 'awaiting_formulation' with no recipe, and
// this is the user confirming that the proposal the chat tool just showed them is the one to
// compound.
//
// FAST TRACK MEANS NO HUMAN EVER LOOKS AT THIS. The premium (Viva AG) package routes through a
// nutrition expert; this one goes straight to compounding, so `validateAgFormulation` below is the
// only check between a generated allocation and capsules a person swallows. A violation refuses
// the whole submission rather than repairing anything — the same reject-never-repair rule §36
// sets for an AG formula, and for the same reason: a repaired formula is one nobody authored.
//
// The expansion is rule-conformant by construction (it comes out of _expandPlanDay, which applies
// the isolation override and the fill cap), so a violation here means the expansion itself
// regressed. That is exactly the case worth catching.
async function handlePostFormulationSubmit(body) {
    const { openid } = body || {};
    const planId = parseInt(body?.plan_id, 10);
    // Which waiting package this formula is for. Optional: absent means "the one waiting", which
    // is what the auto-attach at payment time (_settleFastTrackPackage) and every single-package
    // user send. Present only when the user was shown a choice and made one.
    const targetOrderId = body?.order_id ? String(body.order_id) : null;
    if (!openid) return { success: false, reason: 'missing_params' };
    if (!Number.isFinite(planId)) return { success: false, reason: 'invalid_plan_id' };

    try {
        if (!pool) return { success: false, reason: 'internal_error' };

        const { rows: [user] } = await pool.query(
            'SELECT user_id FROM users WHERE user_id = $1 OR external_id = $1 LIMIT 1', [openid]);
        if (!user) return { success: false, reason: 'user_not_found' };

        const { rows: [plan] } = await pool.query(
            `SELECT id, user_id, status, goal, proposed_recipe, gcn_order_id, label_code
               FROM nutrition_plans WHERE id = $1`, [planId]);
        if (!plan) return { success: false, reason: 'plan_not_found' };
        if (plan.user_id !== user.user_id) return { success: false, reason: 'plan_owner_mismatch' };
        // Idempotent: a double tap returns the order the first tap attached to rather than
        // submitting a second formula for the same purchase.
        if (plan.gcn_order_id) return { success: true, already_submitted: true, order_id: plan.gcn_order_id };
        if (plan.status !== 'proposed') return { success: false, reason: 'plan_not_proposed' };
        if (!plan.proposed_recipe) return { success: false, reason: 'plan_has_no_recipe' };

        // Re-checked here rather than trusted from the card the user tapped: the card was rendered
        // when the formulation finished, and the order could have been refunded, cancelled or
        // already fulfilled by a Viva AG run in the meantime.
        const awaiting = _awaitingOrders(await fetchFormulationOrders(user.user_id));
        if (awaiting.length === 0) return { success: false, reason: 'no_awaiting_order' };
        // A named order must still be one of THIS user's waiting packages — the list was fetched
        // for user.user_id, so an id belonging to anyone else simply is not in it. GCN re-checks
        // ownership the same way rather than trusting the id we pass on.
        const order = targetOrderId
            ? awaiting.find(o => String(o.order_id) === targetOrderId)
            : awaiting[0];
        if (!order) return { success: false, reason: 'order_not_available' };
        if (order.fulfillment !== 'fast_track') return { success: false, reason: 'order_requires_expert_review' };

        // Which formula of the ladder this package bought. A single-recipe proposal returns its
        // own recipe here, so everything below is unchanged for one.
        const selected = _selectTierVariant(plan.proposed_recipe, order.max_distinct_dots);
        if (selected.variant) {
            console.log(JSON.stringify({ level: 'INFO', msg: 'formulation tier variant selected',
                user_id: user.user_id, plan_id: planId,
                variant_width: selected.variant.max_distinct_dots, order_max: order.max_distinct_dots }));
        }

        // The purchased tier binds here too, not only at proposal time. A plan proposed BEFORE the
        // package was bought was capped by nothing (there was no order to read a tier from), and
        // it is still a 'proposed' plan this endpoint would happily submit. Refused rather than
        // trimmed: the same reject-never-repair rule the validator below follows, and for the same
        // reason — a formula the user never saw is one nobody authored. Re-running 营养定制 now
        // produces one built for the tier, which is a better formula than this one minus a dot.
        if (order.max_distinct_dots) {
            const distinct = _countDistinctDots(selected.morning, selected.evening);
            if (distinct > order.max_distinct_dots) {
                return { success: false, reason: 'formulation_exceeds_package',
                    distinct_dots: distinct, max_distinct_dots: order.max_distinct_dots,
                    package_name: order.package_name || null };
            }
        }

        // timing/timing_flexible are read by validateAgFormulation's slot rules, not by the
        // expansion — omitting them makes the validator silently weaker, not louder.
        const { rows: formulary } = await pool.query(
            `SELECT key_name, timing, timing_flexible, target_dots_min, target_dots_max,
                    dosing_protocol, pulse_days_per_cycle, pulse_cycle_days FROM dots`);
        const capsules = _expandProposalToCapsules(selected.morning, selected.evening, formulary);
        const check = validateAgFormulation({ capsules }, formulary);
        if (!check.valid) {
            console.error(JSON.stringify({ level: 'ERROR', msg: 'fasttrack_formulation_invalid',
                user_id: user.user_id, plan_id: planId, violations: check.violations }));
            return { success: false, reason: 'formulation_invalid', violations: check.violations };
        }
        // The validator already computed these over the exact capsules it approved; recomputing
        // them separately would let the numbers GCN prints drift from the numbers nano checked.
        const { totals, totalDots } = check;

        let result;
        try {
            result = await submitFastTrackFormulation({
                nano_user_id: user.user_id,
                nano_nutrition_plan_id: plan.id,
                capsules,
                totals,
                total_dots: totalDots ?? null,
                rationale: plan.goal || null,
                // Always sent, even when the user made no choice: the order was resolved above and
                // naming it removes the window where GCN's own oldest-first tie-break picks a
                // different package than the tier check just ran against.
                order_id: order.order_id,
                // The label/QR the compounding centre prints and sticks on the box. It is minted
                // with the plan (see _commitProposedPlan) and this is the first moment anyone on
                // GCN's side could know it — before submission there is no formula to label.
                //
                // Sending the CODE, not a URL: the page that renders it is GCN's own
                // formulation-label.html, and nano must not be the thing that decides where GCN
                // hosts it. Null-safe — a plan minted before label codes existed simply sends
                // null, and the supplier's print button does not appear for it.
                label_code: plan.label_code || null,
            });
        } catch (err) {
            // Unlike the two read paths, this failure must reach the user: the entire point of the
            // tap was the call, and silently succeeding would leave them believing their paid
            // order is being compounded when GCN never heard about it.
            console.error(JSON.stringify({ level: 'ERROR', msg: 'fasttrack_submit_failed',
                user_id: user.user_id, plan_id: planId, error: err.message, status: err.status }));
            await pool.query('UPDATE nutrition_plans SET submitted_to_gcn_at = NOW() WHERE id = $1', [planId]);
            return { success: false, reason: err.body?.error || 'gcn_unreachable' };
        }
        if (!result || !result.order_id) return { success: false, reason: result?.reason || 'no_awaiting_order' };

        // Collapsed back to a single recipe in the same write that binds it to the order: from
        // here the plan means "these capsules are being compounded", and the box scan, the printed
        // label and the checkout snapshot must all read the variant that was actually submitted
        // rather than the base the ladder was stored around.
        const collapsed = selected.variant
            ? JSON.stringify({
                morning: selected.morning.dots || {},
                evening: selected.evening.dots || {},
                ...(selected.morning.weeks ? { weeks: selected.morning.weeks } : {}),
            })
            : null;
        await pool.query(
            `UPDATE nutrition_plans
                SET gcn_order_id = $2, submitted_to_gcn_at = NOW(),
                    proposed_recipe = COALESCE($3::jsonb, proposed_recipe)
              WHERE id = $1`,
            [planId, String(result.order_id), collapsed]);
        console.log(JSON.stringify({ level: 'INFO', msg: 'fasttrack formulation submitted',
            user_id: user.user_id, plan_id: planId, order_id: result.order_id }));
        return { success: true, order_id: result.order_id };
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handlePostFormulationSubmit failed', error: err.message }));
        return { success: false, reason: 'internal_error' };
    }
}

// GCN's sku/product names are jsonb ({zh, en}) and are legitimately empty on some rows.
function _flattenSkuName(name) {
    if (!name) return null;
    if (typeof name === 'string') return name || null;
    return name.zh || name.en || null;
}

// POST /formulation-redeem  { openid, code, plan_id?, shipping_name, shipping_phone,
//                              shipping_address }   (app bearer, the user's own action)
//
// Spending a prepaid 28-day code from inside the Mini Program, instead of bouncing the user out to
// GCN's storefront to do it. The codes themselves live entirely on GCN's side (§28e) — nano keeps
// no code table and must not grow one, because every "is a package waiting for me" answer in this
// flow already comes from one source, fetchFormulationOrders, and a second source would have to be
// merged into all three of its call sites.
//
// IT DOES NOT SUBMIT THE FORMULA, deliberately, even though a proposal is usually on screen when
// this is tapped. GCN's own payment confirmation notifies /formulation-purchase-confirmed, which
// runs _settleFastTrackPackage — the code that already attempts the submit, already falls back to
// the over-tier message, and already owns the chat message either way. Submitting here as well
// would race it, and would leave that function (told nothing about a plan) nudging the user to go
// formulate something they just did. `plan_id` is passed to GCN as the intent instead, and comes
// back to us through that notify.
async function handlePostFormulationRedeem(body) {
    const { openid } = body || {};
    if (!openid) return { success: false, reason: 'missing_params' };

    const code = String(body?.code || '').trim();
    if (!code) return { success: false, reason: 'code_required' };

    // Mandatory on GCN's side and worth refusing here too: the box physically ships and there is
    // no payment step afterwards to come back and collect an address on.
    const shipping = {
        recipient_name: String(body?.shipping_name || '').trim(),
        recipient_phone: String(body?.shipping_phone || '').trim(),
        shipping_address: String(body?.shipping_address || '').trim(),
    };
    if (!shipping.recipient_name || !shipping.recipient_phone || !shipping.shipping_address) {
        return { success: false, reason: 'shipping_required' };
    }

    try {
        if (!pool) return { success: false, reason: 'internal_error' };

        const { rows: [user] } = await pool.query(
            'SELECT user_id, account_type FROM users WHERE user_id = $1 OR external_id = $1 LIMIT 1', [openid]);
        if (!user) return { success: false, reason: 'user_not_found' };

        // Someone else's session redeeming for this user (index.js sets _redeemer_user_id from
        // the session, after lib/userAccess.js confirmed they coach this user). Only for a managed
        // customer (CLAUDE.md §49): they have no GCN account, so GCN makes the coach the buyer.
        // A regular client redeems their own codes.
        const redeemer = body?._redeemer_user_id || null;
        if (redeemer && user.account_type !== 'managed') return { success: false, reason: 'redeem_for_managed_only' };

        // Only ever this user's own proposal, and only a live one. A bad or foreign id is dropped
        // rather than refused: it is advisory downstream, and losing the auto-submit is a far
        // smaller harm than refusing to spend a code the user is entitled to spend.
        let intendedPlanId = null;
        let planId = parseInt(body?.plan_id, 10);
        // The coach panel shows no formula card to take an id from; a managed customer has at
        // most one live proposal (uniq_nutrition_plans_proposed), and that is the one meant.
        if (!Number.isFinite(planId) && redeemer) {
            const { rows: [p] } = await pool.query(
                `SELECT id FROM nutrition_plans WHERE user_id = $1 AND status = 'proposed' ORDER BY id DESC LIMIT 1`,
                [user.user_id]);
            if (p) planId = Number(p.id);
        }
        if (Number.isFinite(planId)) {
            const { rows: [plan] } = await pool.query(
                `SELECT id FROM nutrition_plans
                  WHERE id = $1 AND user_id = $2 AND status = 'proposed'`,
                [planId, user.user_id]);
            if (plan) intendedPlanId = plan.id;
        }

        let result;
        try {
            result = await redeemFormulationCode({
                nano_user_id: user.user_id,
                code,
                intended_nano_plan_id: intendedPlanId,
                ...(redeemer && { redeemer_nano_user_id: redeemer }),
                ...shipping,
            });
        } catch (err) {
            // Every refusal GCN makes is a real answer the user needs to see verbatim — a code
            // already spent reads completely differently from one that was never bought. Only a
            // transport failure degrades to a generic reason.
            console.error(JSON.stringify({ level: 'ERROR', msg: 'formulation_redeem_failed',
                user_id: user.user_id, error: err.message, status: err.status,
                gcn_error: err.body?.error }));
            // The one refusal that is about the caller, not the code: a coach redeeming for a
            // managed customer must have opened the store once, which links their GCN account.
            if (/^redeemer nano identity not linked/.test(String(err.body?.error || ''))) {
                return { success: false, reason: 'redeemer_not_linked' };
            }
            return { success: false, reason: err.body?.error || 'gcn_unreachable' };
        }

        console.log(JSON.stringify({ level: 'INFO', msg: 'formulation code redeemed',
            user_id: user.user_id, order_id: result?.order_id, plan_id: intendedPlanId,
            warning: result?.warning || null }));
        return {
            success: true,
            order_id: result?.order_id || null,
            // GCN returns skus.name, which is a jsonb object and is routinely {} on these rows.
            // Flattened here so nothing downstream can render it as [object Object].
            package_name: _flattenSkuName(result?.package_name),
            max_distinct_dots: result?.max_distinct_dots ?? null,
            // GCN burned the code but could not confirm the order (its own 202). The package is
            // recoverable by an admin, and saying so is better than a success the user cannot see
            // the result of.
            pending_confirmation: result?.warning === 'redeemed_but_not_confirmed',
        };
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handlePostFormulationRedeem failed',
            error: err.message }));
        return { success: false, reason: 'internal_error' };
    }
}

// Everything the delivery step needs to know about a paid package this user is already holding,
// resolved by asking GCN. Two things come out of one call because they answer the same question
// and must agree with each other:
//
//   mode             which call to action the formula card carries. See _buildFormulaChartBlock's
//                    `#order` note for what each means and why an unknown answer degrades to
//                    'buy'.
//   maxDistinctDots  the tier the user actually bought — how many distinct dots their formula may
//                    contain (GCN's migration_0085). null when no package is waiting, or for a
//                    package with no tier, in which case the formulation is not capped.
async function _resolveOrderContext(userId) {
    const awaiting = _awaitingOrders(await fetchFormulationOrders(userId));
    if (awaiting.length === 0) return { mode: 'buy', maxDistinctDots: null, packageName: null, awaitingCount: 0 };
    // The OLDEST, deliberately — that is the one GCN's _attachRecipeToAwaitingOrder will pick when
    // no order_id is named, so the tier this preview is built against is the tier it would
    // actually be submitted against. Preferring a fast-track order over an older expert-review one
    // would make the card promise a submission GCN then refuses.
    const order = awaiting[0];
    return {
        mode: order.fulfillment === 'fast_track' ? 'submit' : 'ag',
        // Only a fast-track package's tier binds this user's own formulation. An expert-review
        // package is formulated by Viva AG against its own contract, and nothing the chat tool
        // proposes for it is ever submitted, so applying a cap there would only distort a preview.
        maxDistinctDots: order.fulfillment === 'fast_track' ? (order.max_distinct_dots ?? null) : null,
        packageName: order.package_name || null,
        awaitingCount: awaiting.length,
    };
}

// The packages waiting for a recipe, OLDEST FIRST. The order matters: GCN returns newest-first for
// display, but its attach path resolves ties oldest-first, so anything that has to agree with what
// GCN will actually do must re-sort. Not doing this is how a picker and a submission end up
// naming two different packages.
function _awaitingOrders(orders) {
    return (Array.isArray(orders) ? orders : [])
        .filter(o => o && o.status === 'awaiting_formulation')
        .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
}

module.exports = {
    PACKAGE_STAGES,
    PACKAGE_STAGE_NARRATION,
    AWAITING_FORMULA_STAGES,
    _mergeFormulationPackages,
    _fetchFormulationCodes,
    _fetchFormulationPackages,
    _resolveOrderContext,
    _awaitingOrders,
    handleGetFormulationOrders,
    handlePostFormulationSubmit,
    handlePostFormulationRedeem,
};
