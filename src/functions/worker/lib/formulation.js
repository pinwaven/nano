'use strict';

// The formulation engine: every rule that turns a ranked list of dots into the capsules a user
// physically takes. Pure by construction — no DB, no LLM, no network, no clock except the fixed
// pulse epoch — so every invariant CLAUDE.md §28 lists is testable over plain objects
// (tests/capsule-balance, dose-levels, formula-tier-*, ranking-formulation, formulation-package-tier).
//
// Carved out of handlers/dots.js on 2026-09-16. The handler keeps the I/O — fetching the formulary,
// running the model, committing plans, delivering cards — and calls in here for the arithmetic. The
// one rule that made this split worth doing: _expandPlanDay is the SINGLE expansion rule set for
// four consumers that must never disagree (the :::formula card, the checkout snapshot, the
// fast-track submission, and the 56 schedules written on box scan). Keeping it in a module with no
// I/O is what makes "never a second copy" checkable rather than hoped for.
//
// Product constants live in ./dotsProductModel and bind this file, ../handlers/dots.js and
// lib/agFormulation.js together — change all three at once.

const { DateTime } = require('luxon');
const { PLAN_DAYS, DAYS_PER_WEEK, PLAN_WEEKS, MAX_DOTS_PER_CAPSULE, N7_KEY, N7_ISOLATION_DAY_INDEXES } = require('./dotsProductModel');
const { canonicalizeCapsules } = require('./agFormulation');

// ── Candidate dots and per-dot fallback ────────────────────────────────────────────────────

// Per-dot fallback when the LLM's FORMULATION output omits a key entirely — midpoint of that
// dot's own target_dots_min/max (added by migration_dots_new_lineup.sql; ranges vary wildly,
// e.g. 1-2 for DOT-N1 vs 56-100 for DOT-N15, so a flat constant made no sense). Falls back to
// 4 only if a dot has no min/max configured.
// `isRecommended` biases the fallback toward the high end of the dot's own range when it's one
// of the user's active focus's recommended dots. A focus is PURELY ADDITIVE: it only ever
// promotes. Anything not on the list sits at the same midpoint it gets when no focus is active
// at all, so `false` and `undefined` are deliberately the same answer.
//
// It used to demote instead — off-list dots dropped to 25% of their range, i.e. BELOW the
// no-focus baseline, so joining a plan actively suppressed every dot the plan didn't name. On
// DOT-N15 (range 37-67) that was 45 against a 52 baseline. Two problems with it: it made list
// accuracy load-bearing (an omission is a demotion, and the seeded lists had been silently
// repointed by the lineup change — migration_health_plan_recommended_dot_keys.sql), and it
// contradicted the promise docs/architecture/health-plan-system.md already made, that every dot
// "remains primarily governed by biomarker severity". Restore the 25% branch and you restore
// both. Never zeroes a dot out either way: a real biomarker need outside the chosen focus must
// still be able to surface.
function _fallbackCountForDot(dot, isRecommended) {
    if (dot.target_dots_min != null && dot.target_dots_max != null) {
        const { target_dots_min: min, target_dots_max: max } = dot;
        if (isRecommended === true) return Math.round(min + (max - min) * 0.75);
        return Math.round((min + max) / 2);
    }
    return 4;
}

// Resolves the union of recommended_dot_ids across a user's active health_plans (primary +
// secondary, if both joined) into a Set of dot key_names — the shared candidate/weighting input
// both the deterministic and agentic formulation paths use. Returns null when no active focus
// has any recommended dots, meaning "no narrowing" (today's default full-18-dot behavior) rather
// than an empty set (which would read as "recommend nothing").
//
// TWO SHAPES, and both must keep working. The column now stores key_names ("DOT-N11") — see
// migration_health_plan_recommended_dot_keys.sql for why a dots.id was the wrong identity to
// persist — but the worker, the miniapp and the admin panel deploy separately, so a template
// written by an older admin build can still hold integers. A string is taken as a key_name and
// validated against the formulary; a number falls back to the legacy id lookup.
//
// An entry matching neither is DROPPED, not guessed. That is the loud failure the key format
// buys: an id silently resolved to whatever dot now occupies that row, which is exactly how six
// seeded lists came to recommend macular and skin dots for a weight-loss plan.
function _resolveCandidateDotKeys(activeHealthPlans, dotsFormulary) {
    const entries = new Set();
    for (const p of activeHealthPlans || []) {
        for (const e of (p.recommended_dot_ids || [])) entries.add(e);
    }
    if (entries.size === 0) return null;
    const byId = new Map((dotsFormulary || []).map(d => [d.id, d]));
    const byKey = new Set((dotsFormulary || []).map(d => d.key_name));
    const keys = new Set([...entries]
        .map(e => (typeof e === 'string' ? (byKey.has(e) ? e : null) : byId.get(e)?.key_name))
        .filter(Boolean));
    return keys.size > 0 ? keys : null;
}

// ── Laying a day into two capsules ─────────────────────────────────────────────────────────

// Splits a dot's total count across morning/evening for the deterministic (non-agentic) path.
// timing_flexible (migration_dots_timing_flexible.sql) marks dots with no real diurnal
// pharmacological constraint — those get ~30% of a total > 10 moved to their non-default slot
// so the day's AM/PM pill counts land closer together. Non-flexible dots (e.g. DOT-N4/DOT-N12's
// stimulating ingredients, DOT-N3's sleep support) always stay entirely in their default slot —
// timing_flexible=false is a real reason, not a guess, so it's never overridden here.
function _splitDotTiming(dot, count) {
    const isEveningDefault = dot.timing === 'Evening';
    if (!dot.timing_flexible || count <= 10) {
        return isEveningDefault ? { morning: 0, evening: count } : { morning: count, evening: 0 };
    }
    const secondary = Math.max(1, Math.round(count * 0.3));
    const primary = count - secondary;
    return isEveningDefault ? { morning: secondary, evening: primary } : { morning: primary, evening: secondary };
}

// Lays a day's dots into the two capsules so both hold as close to the same number as the
// timing-locked dots allow.
//
// _splitDotTiming decides one dot at a time and cannot see the day, so it produced whatever total
// fell out: a real dev proposal (2026-09-07) came back 71 in the morning against 31 in the
// evening, purely because four of its six dots happen to default to Morning. Both capsules fit
// under MAX_DOTS_PER_CAPSULE, so _fitRecipeToDailyBudget — which only ever acts under capsule
// pressure — correctly left it alone. Nothing was wrong with it except that one capsule was more
// than twice the other, which is the half the user actually has to swallow.
//
// Two stages, in this order, and only the first is a constraint:
//
//   1. TIMING-LOCKED DOTS FIRST, whole, into their own capsule. A dot with timing_flexible=false
//      (today DOT-N3 静心夜 evening, DOT-N4 持续精力 and DOT-N12 敏锐心智 morning) has a real
//      diurnal reason to be where it is, lib/agFormulation.js's `slot_violation` rule rejects any
//      formula that moves one, and nothing below may touch them. They set the two capsules'
//      starting weights — so a day whose morning is mostly locked stays a heavier morning, and
//      that is the one thing this function will not correct.
//   2. FLEXIBLE DOTS EVEN OUT WHAT IS LEFT. `timing` on a flexible dot is a default, not a
//      requirement — the column means 早晚皆可，可自由拆分, and it is rendered to the model in
//      exactly those words — so the heavier capsule hands dose across, largest dot first, until
//      the two meet. A dot may end up wholly in its non-default capsule; that is what being
//      flexible means, and a dot for which it is not true is a dot that should be marked
//      timing_flexible = false instead.
//
// The move is bounded by half the gap, so the two capsules can meet but never cross: a capsule
// only ever gets closer to the other, and the worst capsule is never made worse than it came in.
// Largest dot first, so the fewest dots are disturbed and at most one is split.
//
// It never changes a daily total, only where in the day it is taken. So it cannot underdose a dot
// (lib/agFormulation.js checks the daily total), cannot change which dots are in the formula, and
// cannot change what a tier counts. An over-budget day is _fitRecipeToDailyBudget's to settle,
// and it runs first.
function _balanceCapsules(morningRecipe, eveningRecipe, dotsFormulary) {
    const byKey = new Map((dotsFormulary || []).map(d => [d.key_name, d]));
    const inMorning = { ...(morningRecipe?.dots || {}) };
    const inEvening = { ...(eveningRecipe?.dots || {}) };
    // weeks/levels/order ride through untouched: this decides slots, nothing else, and the tier
    // trim and the daily budget both still need the formulator's ranking afterwards.
    const carry = {};
    const weeks = morningRecipe?.weeks || eveningRecipe?.weeks;
    const levels = _levelsOf(morningRecipe, eveningRecipe);
    const order = _orderOf(morningRecipe, eveningRecipe);
    if (weeks) carry.weeks = weeks;
    if (levels) carry.levels = levels;
    if (order) carry.order = order;
    const asResult = (m, e) => ({ morning: { dots: m, ...carry }, evening: { dots: e, ...carry } });

    const totals = new Map();
    for (const [key, count] of [...Object.entries(inMorning), ...Object.entries(inEvening)]) {
        if (count > 0) totals.set(key, (totals.get(key) || 0) + count);
    }
    const dotOf = key => byKey.get(key) || {};
    // Same fallback as _fitRecipeToDailyBudget's, and for the same reason: a dot the formulary
    // does not describe stays where the CALLER put it. Defaulting to the morning would collapse a
    // whole recipe into one capsule the moment a SELECT omits `timing`.
    const slotOf = (key) => {
        const timing = dotOf(key).timing;
        if (timing === 'Evening') return 'evening';
        if (timing === 'Morning') return 'morning';
        return (inEvening[key] || 0) > (inMorning[key] || 0) ? 'evening' : 'morning';
    };

    // Stage 1, plus each flexible dot's own default slot, which is where it starts.
    const morning = {}, evening = {};
    const flexible = [];
    for (const [key, total] of totals) {
        const own = slotOf(key) === 'evening' ? evening : morning;
        own[key] = total;
        if (dotOf(key).timing_flexible) flexible.push(key);
    }
    const sum = obj => Object.values(obj).reduce((a, b) => a + b, 0);
    if (flexible.length === 0) return asResult(morning, evening);

    // Stage 2. Only a dot sitting in the HEAVIER capsule can help; moving one narrows the gap by
    // two, so half the gap is the whole budget.
    const heavyIsMorning = sum(morning) > sum(evening);
    const from = heavyIsMorning ? morning : evening;
    const to = heavyIsMorning ? evening : morning;
    const heavySlot = heavyIsMorning ? 'morning' : 'evening';
    let budget = Math.floor((sum(from) - sum(to)) / 2);
    const movable = flexible
        .filter(key => slotOf(key) === heavySlot)
        .sort((a, b) => (totals.get(b) - totals.get(a)) || (a < b ? -1 : 1));
    for (const key of movable) {
        if (budget <= 0) break;
        const move = Math.min(from[key], budget);
        if (move <= 0) continue;
        from[key] -= move;
        to[key] = (to[key] || 0) + move;
        if (from[key] === 0) delete from[key];
        budget -= move;
    }
    return asResult(morning, evening);
}

// Fixed reference point for pulse-cycle math (migration_dots_dosing_protocol.sql) — arbitrary,
// just needs to never change once dots start relying on it, so a pulse dot's active window is a
// pure function of the calendar date, never of when a plan happens to be (re)generated. Without
// this, reformulating mid-cycle could shift or duplicate a dot's "2 consecutive days" window.
const PULSE_CYCLE_EPOCH = DateTime.fromISO('2026-01-01');

// True if `dateISO` falls inside a pulse-protocol dot's active window. Non-pulse dots ('daily',
// the default) are always active — this is the single gate _expandPlanDay uses to decide
// whether a pulse dot appears in a given day's recipe at all, so "not a daily dose" is enforced
// in code rather than left to the model to remember. DOT-N7 is the only pulse dot configured
// today, but as of 2026-08-08 it's routed through the dedicated week-2 isolation-day mechanism
// instead (see N7_KEY/N7_ISOLATION_DAY_INDEXES in lib/dotsProductModel.js) — this function/gate remains generic
// infrastructure for any *other* future pulse dot.
function _isPulseActiveDate(dot, dateISO) {
    if (dot.dosing_protocol !== 'pulse') return true;
    if (!dot.pulse_days_per_cycle || !dot.pulse_cycle_days) return true; // misconfigured — fail open to daily rather than silently dropping the dot entirely
    const daysSinceEpoch = Math.floor(DateTime.fromISO(dateISO).diff(PULSE_CYCLE_EPOCH, 'days').days);
    const dayInCycle = ((daysSinceEpoch % dot.pulse_cycle_days) + dot.pulse_cycle_days) % dot.pulse_cycle_days;
    return dayInCycle < dot.pulse_days_per_cycle;
}

// Drops any pulse-protocol dot from a day's recipe on a day outside its active window — the
// model/deterministic formulator still decides one count per dot per cycle (the per-dose amount
// taken ON an active day), the expansion just no longer copies that count into every day
// of the plan verbatim for dots that were never meant to be dosed daily.
function _applyPulseSchedule(recipe, pulseDotsByKey, dateISO) {
    if (!pulseDotsByKey || pulseDotsByKey.size === 0) return recipe;
    const dots = {};
    for (const [key, count] of Object.entries(recipe.dots || {})) {
        const pulseDot = pulseDotsByKey.get(key);
        if (pulseDot && !_isPulseActiveDate(pulseDot, dateISO)) continue;
        dots[key] = count;
    }
    return { dots };
}


// Returns a copy of `recipe` with `key` removed from its dots map — used to strip DOT-N7 out of
// the everyday recipe before the isolation-day override takes over its dosing entirely.
function _omitDotKey(recipe, key) {
    const dots = { ...(recipe?.dots || {}) };
    delete dots[key];
    return { dots };
}

// Caps a single capsule's total dot count at maxTotal, scaling every dot down proportionally
// (largest-remainder method: floor each scaled count, then hand out the leftover budget to the
// entries with the largest fractional remainder) so the rounded counts still sum to exactly
// maxTotal rather than drifting under/over from naive per-dot rounding. A dot whose scaled share
// floors to 0 simply drops out of that capsule — an expected outcome of a ~5x reduction, not a
// bug — relative emphasis between the surviving dots is preserved.
function _capRecipeTotal(recipe, maxTotal) {
    const dots = recipe?.dots || {};
    const total = Object.values(dots).reduce((s, c) => s + c, 0);
    if (total <= maxTotal) return recipe;
    const scale = maxTotal / total;
    const floors = {};
    const remainders = [];
    let flooredSum = 0;
    for (const [key, count] of Object.entries(dots)) {
        const scaled = count * scale;
        const floor = Math.floor(scaled);
        floors[key] = floor;
        flooredSum += floor;
        remainders.push([key, scaled - floor]);
    }
    let remaining = maxTotal - flooredSum;
    remainders.sort((a, b) => b[1] - a[1]);
    for (let i = 0; i < remaining && i < remainders.length; i++) {
        floors[remainders[i][0]] += 1;
    }
    const result = {};
    for (const [key, count] of Object.entries(floors)) {
        if (count > 0) result[key] = count;
    }
    return { dots: result };
}

// Expands a steady-state proposal into the canonical 56-capsule array the rest of the product
// speaks: [{day:1..28, slot:'AM'|'PM', dots:{KEY:count}}]. Identical shape to what the external
// Viva AG agent submits, so GCN's processing centre, its printed label QR and nano's own
// validator all read one format regardless of which pipeline produced the formula.
//
// Days are 1-based here and 0-based in _expandPlanDay, matching each side's own convention.
function _expandProposalToCapsules(morningRecipe, eveningRecipe, dotsFormulary) {
    const ctx = _planExpansionContext(morningRecipe, eveningRecipe, dotsFormulary);
    const capsules = [];
    for (let i = 0; i < PLAN_DAYS; i++) {
        const day = _expandPlanDay(i, ctx, null);
        capsules.push({ day: i + 1, slot: 'AM', dots: { ...day.morning.dots } });
        capsules.push({ day: i + 1, slot: 'PM', dots: { ...day.evening.dots } });
    }
    return canonicalizeCapsules(capsules);
}

// ── The weekly dimension ───────────────────────────────────────────────────────────────────────
//
// A purchased package caps how many distinct dots may appear in ONE WEEK, not in the cycle — so
// weeks may legitimately differ, and a formula may rotate other dots in next week up to the same
// per-week limit. That is the whole reason a recipe has a week dimension at all.
//
// It rides on the recipe object as an OPTIONAL `weeks` map, `{ 'DOT-N1': [1, 2] }`, alongside the
// `dots` counts it already carried. A key that names no weeks is in EVERY week, which is what
// makes this backward compatible in both directions: a stored proposal written before this
// existed, a completion from a stale cached prompt, and the deterministic fallback formulator all
// produce four identical weeks — exactly today's behaviour — without a migration or a shape check.

// 1-based week for a 0-based day index. Clamped, so a cycle length that is not a whole number of
// weeks puts the ragged tail in the last week rather than inventing a fifth.
function _weekOfDayIndex(dayIndex) {
    return Math.min(PLAN_WEEKS, Math.floor(dayIndex / DAYS_PER_WEEK) + 1);
}

// Per-dot week membership for a recipe PAIR. Membership is a property of the formula, not of one
// capsule, so both slots are read and merged — callers set the same map on both.
//
// A malformed or empty list is treated as "no constraint", never as "no weeks". The safe direction
// is the one that cannot silently delete a dose the formulator asked for: an over-wide membership
// is then trimmed by _capDistinctDots against the real tier, whereas an empty one would drop the
// dot with nothing to notice it.
function _weekMembership(morningRecipe, eveningRecipe) {
    const out = new Map();
    for (const src of [morningRecipe?.weeks, eveningRecipe?.weeks]) {
        for (const [key, weeks] of Object.entries(src || {})) {
            const valid = [...new Set((Array.isArray(weeks) ? weeks : [])
                .map(w => Math.round(Number(w)))
                .filter(w => Number.isFinite(w) && w >= 1 && w <= PLAN_WEEKS))].sort((a, b) => a - b);
            if (valid.length) out.set(key, valid);
        }
    }
    return out;
}

// The slice of a recipe that is actually taken in `week`.
function _recipeForWeek(recipe, membership, week) {
    const dots = {};
    for (const [key, count] of Object.entries(recipe?.dots || {})) {
        const weeks = membership.get(key);
        if (weeks && !weeks.includes(week)) continue;
        dots[key] = count;
    }
    return { dots };
}

// The distinct non-N7 dots active in `week`.
function _keysInWeek(morningRecipe, eveningRecipe, membership, week) {
    const keys = new Set();
    for (const recipe of [morningRecipe, eveningRecipe]) {
        for (const [key, count] of Object.entries(recipe?.dots || {})) {
            if (key === N7_KEY || !(count > 0)) continue;
            const weeks = membership.get(key);
            if (weeks && !weeks.includes(week)) continue;
            keys.add(key);
        }
    }
    return keys;
}

// SubAges key (bioage_profile) -> the dots.sub_age_target string. CLAUDE.md §11 lists both halves
// as canonical and cross-cutting; this is the join between them.
const SUB_AGE_TARGET_BY_KEY = {
    CellularAge: 'Cellular Age',
    MetabolicAge: 'Metabolic Age',
    MicroVascularAge: 'Micro-Vascular Age',
    ResilienceAge: 'Resilience Age',
};

// ── Ranking-driven formulation ──────────────────────────────────────────────────────────────
//
// The model returns an ORDERED list of the dots most relevant to this user, and the server works
// out every number from there. This inverts what came before, where the model dosed all 18 and
// the server reverse-engineered an ordering out of those doses to decide which six made the core.
//
// Why the inversion. The ordering is the thing _capDistinctDots actually needs; the doses were
// only ever a proxy for it, and a distorted one (a dot with a 1-2 range reaches "maximum
// emphasis" by moving a single pill, outranking one deliberately dosed at 30 of 9-37). Asking for
// the ordering directly also makes errors in the tail free — ranks past the widest tier are
// discarded — where a bad dose anywhere in the 18 used to skew the core.
//
// Measured 2026-09-07: across ~20 runs no model ever produced a dose between a dot's floor and
// its ceiling until levels were introduced, and none ever used the `weeks` rotation the contract
// offered (428 of 428 entries came back "all four weeks").

// Rank carries most of the weight because it is the only channel that can express a reason the
// biomarkers do not contain. DOT-N3 (静心夜) targets Resilience Age, which for a user sleeping
// 5.3h a night can sit comfortably BELOW their chronological age — severity alone would floor it,
// discarding exactly the digital-twin signal the ranking exists to carry. Severity is the
// corrective that lifts biomarker-driven dots, not the primary term.
const RANK_WEIGHT = 0.6;
const SEVERITY_WEIGHT = 0.4;
// Nothing is dosed to its absolute ceiling by this path: the capsule budget is shared, and a
// formula that maxes its first pick starves everything after it. Same position 'high' maps to.
const MAX_AUTO_POSITION = 0.9;

// How far each sub-age dimension is above chronological age, normalised so the worst dimension
// scores 1 and anything at or below chronological age scores 0. Returns null when there is no
// usable bioage at all (a user with no Kino scan), which makes dosing fall back to rank alone.
function _severityShares(bioage) {
    const chrono = Number(bioage?.ChronoAge);
    const subAges = bioage?.SubAges || {};
    if (!Number.isFinite(chrono)) return null;
    const raw = {};
    let worst = 0;
    for (const [dimKey, target] of Object.entries(SUB_AGE_TARGET_BY_KEY)) {
        const v = Number(subAges[dimKey]);
        if (!Number.isFinite(v)) continue;
        const over = Math.max(0, v - chrono);
        raw[target] = over;
        if (over > worst) worst = over;
    }
    if (Object.keys(raw).length === 0) return null;
    const out = {};
    for (const [target, over] of Object.entries(raw)) out[target] = worst > 0 ? over / worst : 0;
    return out;
}

// The daily count for one dot, given where the formulator ranked it and how elevated the
// dimension it targets is. A dot with no sub_age_target (DOT-N8, DOT-N12) has no severity to
// read, so its rank decides alone.
function _doseFromRank(dot, rankIndex, rankCount, severityShares) {
    const min = dot?.target_dots_min ?? 1;
    const max = dot?.target_dots_max ?? 10;
    if (max === min) return min;
    const n = Math.max(1, rankCount);
    const rankShare = (n - rankIndex) / n;
    const sev = severityShares && dot?.sub_age_target ? severityShares[dot.sub_age_target] : undefined;
    const blended = sev === undefined
        ? rankShare
        : (RANK_WEIGHT * rankShare) + (SEVERITY_WEIGHT * sev);
    const pos = Math.min(MAX_AUTO_POSITION, Math.max(0, blended));
    return Math.min(max, Math.max(min, Math.round(min + (max - min) * pos)));
}

// The whole formulation, from an ordered list of keys. Unknown keys are dropped rather than
// guessed at, and DOT-N7 is removed wherever it appears — its dosing is system-controlled
// (isolation days), so a rank for it would be read and then ignored.
function _doseFromRanking(rankedKeys, dotsFormulary, bioage) {
    const byKey = new Map((dotsFormulary || []).map(d => [d.key_name, d]));
    const seen = new Set();
    const ordered = [];
    for (const raw of rankedKeys || []) {
        const key = String(raw || '').replace(/^D-/, 'DOT-');
        if (key === N7_KEY || seen.has(key) || !byKey.has(key)) continue;
        seen.add(key);
        ordered.push(key);
    }
    const shares = _severityShares(bioage);
    const out = new Map();
    ordered.forEach((key, i) => {
        out.set(key, _doseFromRank(byKey.get(key), i, ordered.length, shares));
    });
    return out;
}

// The same ordering computed with no model at all: most-elevated dimension first, then whichever
// dots an active health-plan focus recommends, then by key so it is deterministic. This is what
// makes a fully offline fallback possible, and it doubles as the baseline the model's own
// ranking is logged against — a disagreement nobody can defend is visible immediately.
function _rankDotsBySeverity(dotsFormulary, bioage, recommendedKeySet) {
    const shares = _severityShares(bioage) || {};
    const score = (dot) => {
        const sev = dot.sub_age_target ? (shares[dot.sub_age_target] ?? 0) : 0;
        const focus = recommendedKeySet && recommendedKeySet.has(dot.key_name) ? 0.15 : 0;
        return sev + focus;
    };
    return (dotsFormulary || [])
        .filter(d => d.key_name !== N7_KEY)
        .map(d => ({ d, s: score(d) }))
        .sort((a, b) => (b.s - a.s) || (a.d.key_name < b.d.key_name ? -1 : 1))
        .map(({ d }) => d.key_name);
}

// How the formulator states dose: a level, not a number.
//
// Asking for a raw count inside each dot's own range made the model do 17 range lookups across
// ranges spanning two orders of magnitude (1-2 for DOT-N1, 28-87 for DOT-N17), and measured
// 2026-09-07 it simply did not: every variable-range dose landed on the floor or the ceiling and
// never in between (qwen-plus 11/4/0, qwen-max 15/0/0 across two runs each). A level removes the
// arithmetic, cannot be out of range, and — because every level maps to the SAME position in
// every dot's range — makes emphasis comparable between a dot with a 2-value range and one with
// a 60-value range, which a raw count never was.
//
// 'low' is included-but-not-a-focus, NOT absent: the formulation rules have always kept dots
// unrelated to a user's abnormal markers at their floor, and the tier cap and daily budget are
// what remove them later. 'none' is the explicit exclusion.
const DOSE_LEVELS = ['none', 'low', 'moderate', 'high'];
const LEVEL_POSITION = { none: 0, low: 0, moderate: 0.5, high: 0.9 };

function _countForLevel(dot, level) {
    if (level === 'none') return 0;
    const min = dot?.target_dots_min ?? 1;
    const max = dot?.target_dots_max ?? 10;
    const pos = LEVEL_POSITION[level];
    if (pos === undefined) return null; // unknown level — caller falls back to a raw count
    return Math.min(max, Math.max(min, Math.round(min + (max - min) * pos)));
}

// The formulator's own ordering, best first, when the recipe was built from a ranking.
//
// This has to travel with the recipe rather than being re-derived from the counts, and that is
// not a refinement — it is the difference between the ranking deciding the core and it not.
// Measured 2026-09-07: DOT-N3 ranked THIRD came back as a count of 2 in a 2-3 range, whose
// derived position is 0.0 — dead last — while DOT-N14 ranked ninth landed at 8 in a 7-17 range,
// position 0.1. The core six that reached the card had dropped the third-ranked dot and kept the
// ninth. Rounding erases rank on any narrow range, so the rank is carried, not recomputed.
function _orderOf(morningRecipe, eveningRecipe) {
    const o = (morningRecipe && morningRecipe.order) || (eveningRecipe && eveningRecipe.order);
    return Array.isArray(o) && o.length ? o : null;
}

// Reads a recipe's declared levels, whichever half carries them. Levels ride on the recipe next
// to `weeks` so the signal survives every transform between the model's reply and the ranking
// that consumes it, without a parallel argument threaded through four call sites.
function _levelsOf(morningRecipe, eveningRecipe) {
    return (morningRecipe && morningRecipe.levels) || (eveningRecipe && eveningRecipe.levels) || null;
}

// Where in its own min..max range the formulator placed a dot — 0 at its floor, 1 at its ceiling.
//
// This is how emphasis is read back out of a finished allocation: the formulator expresses "this
// one matters" by where in the range it put the count (see _fallbackCountForDot's 25/50/75%), so
// a dot sitting at its floor is the one it cared least about. Both droppers below rank on it, and
// they must rank the same way — a dot dropped for the capsule budget and a dot dropped for the
// purchased tier are the same judgement about the same recipe.
//
// A fixed-range dot (min === max) has NO emphasis to read — its count was never a choice — so it
// scores neutral. It used to score 1 (fully emphasised, dropped last), which was wrong in the one
// place it matters: DOT-N8 (明眸) and DOT-N10 (肌光焕采) both have min = max = 1, so they
// outranked every genuinely prioritised dot and took slots in the essential six. Measured live
// 2026-09-07 against a real profile: 明眸 displaced a cellular dot from the base while the
// formulator had pushed DOT-N6/DOT-N9 to their ceilings. Neutral puts a fixed-dose dot below
// anything actually emphasised and above anything left at its floor, which is what "no signal"
// should mean.
const NEUTRAL_EMPHASIS = 0.5;
function _emphasisPosition(dot, requestedTotal, level) {
    // A declared level IS the emphasis, and is preferred over re-deriving one from the count:
    // the derivation is distorted by range width (DOT-N1 at 2 of 1-2 reads as maximum emphasis
    // for one extra pill, outranking DOT-N9 dosed at 30 of 9-37), which a level is immune to.
    if (level && LEVEL_POSITION[level] !== undefined) return LEVEL_POSITION[level];
    const min = dot?.target_dots_min ?? 1;
    const max = dot?.target_dots_max ?? 10;
    return max === min ? NEUTRAL_EMPHASIS : (requestedTotal - min) / (max - min);
}

// Trims a recipe to the number of distinct dots the user's purchased package allows — PER WEEK.
//
// The 28-day packages (GCN's migration_0085) differ only in this number — 6 / 8 / 10 种原粒 — so
// it is the entire thing the buyer is choosing between, and honouring it is not optional.
//
// IT IS A WEEKLY LIMIT, NOT A CYCLE LIMIT. A 6种 buyer may take six dots this week and a partly
// different six next week; what they bought is the width of any one week, not the size of the
// whole formulation. So this caps each week independently and, when a week is over its limit,
// removes dots FROM THAT WEEK rather than from the formula — a dot dropped from week 3 keeps its
// weeks 1 and 2. Only a dot left with no weeks at all disappears entirely.
//
// WHERE IT RUNS MATTERS. The cap is applied ONCE, to the recipe, before it is stored as
// nutrition_plans.proposed_recipe. Everything downstream — the chat card, the box scan writing
// schedules, the fast-track submission — expands that stored recipe through the one shared rule
// set (_expandPlanDay), so they cannot disagree about what the user is taking. Applying it inside
// the expansion instead would mean the box scan, which knows nothing about the order, would expand
// a different recipe than the card the user was shown.
//
// DOT-N7 IS NOT COUNTED. It is a system-controlled reset component, dosed alone on 2 of the 28
// days in every plan regardless of tier (see _planExpansionContext, which lifts it out of the
// everyday recipe entirely). Counting it would silently cost a 6种 buyer one of the six dots they
// chose to pay for. This is a product judgement, and it is the reason the tier is described to the
// user as the width of their weekly formula rather than as the number of labels on the box.
//
// Dropping is whole-dot-within-a-week and both-slots, for the same reason _fitRecipeToDailyBudget's
// stage 3 is: half a daily dose is an underdose, which is worse than an absent dot. Ranking is the
// shared _emphasisPosition — lowest emphasis goes first — with ties broken toward the smaller daily
// total and then the key name, so the outcome is deterministic. (_fitRecipeToDailyBudget breaks
// ties on the larger floor because there a drop has to free capsule capacity; here every drop
// relieves the constraint by exactly one dot, so floor size is irrelevant.)
function _capDistinctDots(morningRecipe, eveningRecipe, dotsFormulary, maxDistinctDots, tierByKey) {
    const morning = { ...(morningRecipe?.dots || {}) };
    const evening = { ...(eveningRecipe?.dots || {}) };
    const membership = _weekMembership(morningRecipe, eveningRecipe);
    const levels = _levelsOf(morningRecipe, eveningRecipe);
    const order = _orderOf(morningRecipe, eveningRecipe);
    const orderIndex = order ? new Map(order.map((k, i) => [k, i])) : null;
    const asRecipes = (weeks) => {
        // The map is only materialized onto the result when it says something: an untouched
        // formula keeps whatever `weeks` it arrived with (usually none), so a recipe that needed
        // no trimming is returned in exactly the shape it came in. `levels` rides along untouched
        // so the emphasis signal survives every trim between here and the daily budget.
        const out = weeks ? { weeks } : (membership.size ? { weeks: Object.fromEntries(membership) } : {});
        if (levels) out.levels = levels;
        if (order) out.order = order;
        return { morning: { dots: morning, ...out }, evening: { dots: evening, ...out } };
    };

    const max = Number(maxDistinctDots);
    if (!Number.isFinite(max) || max <= 0) return asRecipes(null);

    const byKey = new Map((dotsFormulary || []).map(d => [d.key_name, d]));
    const totals = new Map();
    for (const [key, count] of [...Object.entries(morning), ...Object.entries(evening)]) {
        if (key === N7_KEY || !(count > 0)) continue;
        totals.set(key, (totals.get(key) || 0) + count);
    }
    if (totals.size === 0) return asRecipes(null);

    // `tierByKey`, when present, is the formulator's own statement of which dots are core and
    // which are optional additions (the ladder — see _buildTierLadder). It outranks emphasis
    // because it is a clinical judgement about necessity, where emphasis is only a dose position;
    // an untagged dot sorts as the most optional thing there is. Absent, this is exactly the
    // emphasis-only ordering it always was.
    const tagOf = k => {
        const t = tierByKey ? Math.round(Number(tierByKey.get(k))) : NaN;
        return Number.isFinite(t) && t >= 1 ? t : 99;
    };
    // Lowest first — the front of this list is what gets dropped. A declared order wins outright
    // over emphasis: it IS the formulator's answer, where emphasis is only ever a proxy for it.
    const orderRank = k => (orderIndex && orderIndex.has(k) ? orderIndex.get(k) : Number.MAX_SAFE_INTEGER);
    const rank = (a, b) =>
        (tagOf(b) - tagOf(a))
        || (orderIndex ? (orderRank(b) - orderRank(a)) : 0)
        || (_emphasisPosition(byKey.get(a), totals.get(a), levels && levels[a]) - _emphasisPosition(byKey.get(b), totals.get(b), levels && levels[b]))
        || (totals.get(a) - totals.get(b))
        || (a < b ? -1 : 1);

    // Start from the effective membership (a dot naming no weeks is in all of them), then take
    // dots out of the weeks that are over the limit. Weeks are independent: a dot may survive one
    // and be cut from the next.
    const effective = new Map([...totals.keys()].map(k => [k, new Set(membership.get(k) || allWeeks())]));
    let trimmed = false;
    for (let week = 1; week <= PLAN_WEEKS; week++) {
        const active = [...totals.keys()].filter(k => effective.get(k).has(week));
        if (active.length <= max) continue;
        for (const key of active.sort(rank).slice(0, active.length - max)) {
            effective.get(key).delete(week);
            trimmed = true;
        }
    }
    if (!trimmed) return asRecipes(null);

    const weeks = {};
    for (const [key, set] of effective) {
        if (set.size === 0) {
            // Left in no week at all — gone from the formula, and from BOTH capsules.
            delete morning[key];
            delete evening[key];
            continue;
        }
        weeks[key] = [...set].sort((a, b) => a - b);
    }
    return asRecipes(weeks);
}

function allWeeks() {
    return Array.from({ length: PLAN_WEEKS }, (_, i) => i + 1);
}

// The widest week: the number a purchased tier is actually compared against. Counted by the same
// rule _capDistinctDots enforces, so a tier check anywhere else (handlePostFormulationSubmit) can
// never count differently than the place that did the trimming.
//
// Deliberately NOT the distinct dots in the whole cycle. A 6种 package permits six per week, so a
// formula rotating twelve dots through four weeks — never more than six at once — is inside it.
function _countDistinctDots(morningRecipe, eveningRecipe) {
    const membership = _weekMembership(morningRecipe, eveningRecipe);
    let widest = 0;
    for (let week = 1; week <= PLAN_WEEKS; week++) {
        widest = Math.max(widest, _keysInWeek(morningRecipe, eveningRecipe, membership, week).size);
    }
    return widest;
}

// The daily non-N7 dot total a recipe pair asks for. DOT-N7 is excluded here for the same reason
// it is excluded everywhere else in this file: it is dosed alone on 2 of the 28 days and belongs
// to every tier, so counting it would make the tiers look closer together than they are.
function _dailyDotTotal(morningRecipe, eveningRecipe) {
    let total = 0;
    for (const recipe of [morningRecipe, eveningRecipe]) {
        for (const [key, count] of Object.entries(recipe?.dots || {})) {
            if (key !== N7_KEY && count > 0) total += count;
        }
    }
    return total;
}

// Raises a narrower variant until it carries the same daily dot load as the widest one.
//
// The mirror of _fitRecipeToDailyBudget, which by contract only ever takes away. Without this, the
// three tiers are one allocation seen through three apertures: doses are byte-identical and the
// narrow tier is simply the wide one with dots deleted. Measured on dev proposal 38864 — 79 dots a
// day at the 6-wide tier against 109 at the 10-wide, out of a 144 capacity. That is not a lighter
// formula, it is a partial one, and it is what the merchandised names (轻享 / 臻选 / 尊享, GCN
// migration_0107/0108) stopped being able to describe.
//
// THE TARGET IS THE WIDEST VARIANT'S OWN TOTAL, never the raw 2 x MAX_DOTS_PER_CAPSULE. This
// equalises what the tiers deliver; it does not fill capsules. Dosing a tier above what the
// formulator prescribed for the whole formulary is padding, which every other dose path here
// refuses to do — so the widest variant IS the ceiling, and is itself returned untouched.
//
// Three constraints, and all three are load-bearing:
//
//   1. No dot passes its own target_dots_max. A dot with no range cannot be raised at all: the
//      validator's dose_above_max is a refusal, not a warning, and a guessed ceiling is a guess
//      about a capsule someone swallows.
//   2. Per slot, the locked dots (timing_flexible === false) stay within one capsule. They cannot
//      be moved between capsules by _balanceCapsules or by _fitRecipeToDailyBudget stage 1, so an
//      over-full locked slot is resolved downstream by DROPPING A WHOLE DOT — an equalisation that
//      removes an intervention is the worst outcome available here.
//   3. Never below what came in. This only ever adds.
//
// The give-back is proportional — one unit at a time to whichever dot has been raised least
// relative to what it asked for — so the formulator's emphasis ordering survives, the same
// property _fitRecipeToDailyBudget stage 2 preserves on the way down.
//
// weeks / levels / order ride through untouched. _fitRecipeToDailyBudget may drop them because it
// runs last inside the per-week loop; this runs long before that, and _capDistinctDots' ranking
// downstream reads all three.
function _equalizeToTarget(morningRecipe, eveningRecipe, dotsFormulary, target) {
    const CAP = MAX_DOTS_PER_CAPSULE;
    const morning = { ...(morningRecipe?.dots || {}) };
    const evening = { ...(eveningRecipe?.dots || {}) };
    const byKey = new Map((dotsFormulary || []).map(d => [d.key_name, d]));

    const current = new Map();
    for (const [key, count] of [...Object.entries(morning), ...Object.entries(evening)]) {
        if (key === N7_KEY || !(count > 0)) continue;
        current.set(key, (current.get(key) || 0) + count);
    }
    const unchanged = () => ({ morning: morningRecipe, evening: eveningRecipe });
    if (current.size === 0) return unchanged();
    const total = [...current.values()].reduce((a, b) => a + b, 0);
    const goal = Math.min(Number(target) || 0, 2 * CAP);
    if (!(goal > total)) return unchanged();

    // A dot the formulary does not describe keeps exactly what it has: no authored ceiling means
    // no licence to raise it.
    const ceiling = new Map();
    for (const key of current.keys()) {
        const max = Number(byKey.get(key)?.target_dots_max);
        ceiling.set(key, Number.isFinite(max) && max > 0 ? Math.max(max, current.get(key)) : current.get(key));
    }
    // A locked dot sits wholly in one capsule (_splitDotTiming guarantees it), so which one is
    // simply where it is now — read from the recipe rather than from `timing`, for the same reason
    // _fitRecipeToDailyBudget's slotOf does: a SELECT that omits `timing` must not silently move it.
    const lockedSlot = new Map();
    for (const key of current.keys()) {
        if (byKey.get(key)?.timing_flexible !== false) continue;
        lockedSlot.set(key, (evening[key] || 0) > (morning[key] || 0) ? 'evening' : 'morning');
    }
    const lockedLoad = { morning: 0, evening: 0 };
    for (const [key, slot] of lockedSlot) lockedLoad[slot] += current.get(key);

    const raised = new Map(current);
    let room = goal - total;
    while (room > 0) {
        let pick = null;
        let pickRatio = Infinity;
        for (const [key, count] of raised) {
            if (count >= ceiling.get(key)) continue;
            const slot = lockedSlot.get(key);
            if (slot && lockedLoad[slot] + 1 > CAP) continue;
            const ratio = count / current.get(key);
            if (ratio < pickRatio
                || (ratio === pickRatio && current.get(key) > current.get(pick))
                || (ratio === pickRatio && current.get(key) === current.get(pick) && key < pick)) {
                pick = key;
                pickRatio = ratio;
            }
        }
        if (pick === null) break;
        raised.set(pick, raised.get(pick) + 1);
        const slot = lockedSlot.get(pick);
        if (slot) lockedLoad[slot] += 1;
        room -= 1;
    }

    // Rebuild both capsules at the dot's ORIGINAL AM/PM ratio. The split is a real decision made
    // upstream by _splitDotTiming and _balanceCapsules; this changes how much, never where.
    const outMorning = { ...morning };
    const outEvening = { ...evening };
    for (const [key, next] of raised) {
        const was = current.get(key);
        if (next === was) continue;
        const am = morning[key] || 0;
        const pm = evening[key] || 0;
        // A dot that was in both capsules stays in both: the clamp keeps at least one in each.
        // Letting rounding empty a slot would silently move a split dose into one capsule, which
        // is a different instruction to the user than the one the AM/PM split already settled.
        const newAm = pm === 0 ? next
            : (am === 0 ? 0 : Math.min(next - 1, Math.max(1, Math.round(next * (am / was)))));
        const newPm = next - newAm;
        if (newAm > 0) outMorning[key] = newAm; else delete outMorning[key];
        if (newPm > 0) outEvening[key] = newPm; else delete outEvening[key];
    }
    const carry = (recipe) => {
        const out = {};
        if (recipe?.weeks) out.weeks = recipe.weeks;
        if (recipe?.levels) out.levels = recipe.levels;
        if (recipe?.order) out.order = recipe.order;
        return out;
    };
    return {
        morning: { dots: outMorning, ...carry(morningRecipe) },
        evening: { dots: outEvening, ...carry(eveningRecipe) },
    };
}

// ── The tier ladder ────────────────────────────────────────────────────────────────────────────
//
// A user with nothing waiting is choosing between three purchasable widths (6 / 8 / 10 种原粒),
// and before this they never met that choice: the tool formulated against no ceiling at all and
// offered one undifferentiated "order this", which routinely produced a proposal wider than any
// package sold — unpurchasable the moment a code was spent on it.
//
// So one allocation becomes three NESTED formulas: the essential core, then +2, then +2. The
// narrowest is what gets stored as the plan's base (see _commitProposedPlan), which is why a
// proposal can no longer be born unpurchasable — every existing reader of proposed_recipe
// (the box scan, the printed label, the checkout snapshot, the fast-track submit) sees a recipe
// that fits ANY tier. The wider ones ride alongside in `tiers` and are selected at submission,
// once the redeemed code says which one the user actually bought.
//
// A WIDTH IS PER WEEK, NOT PER CYCLE. A 6种 formula may run six dots this week and a partly
// different six next week, so its four weeks together can contain well more than six distinct
// dots — that is the product, and it is why every variant carries its own `weeks` rotation rather
// than being a flat set. Each variant is produced by _capDistinctDots, the same cap that already
// binds a purchased package, so a width means exactly the same thing here as it does at
// submission, and _countDistinctDots (the widest week) is what either is compared against.
//
// NESTING FOLLOWS FROM THAT, not from a separate mechanism: _capDistinctDots ranks the SAME full
// allocation on every call and keeps the top `width` of each week, and a week's top 6 are always
// inside its top 8. Do not "optimise" this into per-variant re-ranking — ranking each variant's
// own set independently can drop from the wide variant a dot the narrow one kept, i.e. an upgrade
// that silently takes something away.
//
// Ranking is the model's own `tier` tag first — which dot is the better next addition is a
// clinical judgement, and the model is the one holding the biomarkers — then emphasis. Untagged
// dots sort as the most optional, so a completion from a stale cached prompt (no tags at all)
// still ladders, purely on emphasis, and so does a server-padded dot.
//
// Returns null when there is no ladder to build — no tiers from GCN, or nothing allocated — and
// every caller then behaves exactly as it did before this existed.
function _buildTierLadder({ morningRecipe, eveningRecipe, dotsFormulary, tiers, tierByKey, padCandidates }) {
    const widths = [...new Set((tiers || [])
        .map(t => Math.round(Number(t?.max_distinct_dots)))
        .filter(w => Number.isFinite(w) && w > 0))].sort((a, b) => a - b);
    if (widths.length === 0) return null;
    const labelByWidth = new Map();
    // The store's own one-line positioning for this tier (GCN skus.description, migration_0108).
    // It is merchandising copy the shopper already sees on the storefront, so it travels rather
    // than being re-invented here — a package that reads one way in the store and another in chat
    // is the same defect migration_0107 fixed for the tier name itself.
    const descriptionByWidth = new Map();
    for (const t of tiers || []) {
        const w = Math.round(Number(t?.max_distinct_dots));
        if (!Number.isFinite(w)) continue;
        if (!labelByWidth.has(w)) labelByWidth.set(w, t.tier_label || t.package_name || null);
        if (!descriptionByWidth.has(w)) descriptionByWidth.set(w, t.tier_description || null);
    }

    const byKey = new Map((dotsFormulary || []).map(d => [d.key_name, d]));
    const morning = { ...(morningRecipe?.dots || {}) };
    const evening = { ...(eveningRecipe?.dots || {}) };
    const distinct = new Set([...Object.keys(morning), ...Object.keys(evening)]
        .filter(k => k !== N7_KEY && ((morning[k] || 0) + (evening[k] || 0)) > 0));
    if (distinct.size === 0) return null;
    // How many dots the FORMULATOR itself asked for, read before the padding below adds any. This
    // is what the recommended tier is measured against: a padded dot was chosen by this function to
    // complete the ladder, not by the model holding the biomarkers, so letting one widen the
    // recommendation would recommend the widest tier on every proposal and make the badge mean
    // nothing.
    const authoredDistinct = distinct.size;

    // Fill the upgrade slots the formulation itself did not.
    //
    // GENERATE reliably doses the whole formulary when asked in isolation, but inside the agentic
    // loop it curates — live dev runs (2026-09-07) came back with six dots where a single-shot
    // completion of the same prompt gave seventeen. Six is the narrowest tier, so without this the
    // wider variants are identical to the base, collapse as duplicates, and the ladder the user was
    // supposed to be choosing from never appears at all.
    //
    // Padding is legitimate here precisely because of what a rung IS: the prompt defines a tier-2/3
    // dot as one that makes the formula more complete rather than one it cannot do without. It is
    // never allowed to reach the CORE, though — padding runs only once the model has filled the
    // narrowest tier itself, and a padded dot is untagged, so the tier-aware ranking below sorts it
    // behind every dot the model actually chose.
    const widest = widths[widths.length - 1];
    if (distinct.size >= widths[0] && distinct.size < widest) {
        for (const cand of padCandidates || []) {
            if (distinct.size >= widest) break;
            const dot = byKey.get(cand?.key_name);
            const count = Math.round(Number(cand?.count));
            // N7 is never a candidate: it belongs to every tier already and is counted toward
            // none, so padding a slot with it would silently cost the buyer one of the dots they
            // are choosing between.
            if (!dot || dot.key_name === N7_KEY || distinct.has(dot.key_name) || !(count > 0)) continue;
            const split = _splitDotTiming(dot, count);
            if (split.morning > 0) morning[dot.key_name] = split.morning;
            if (split.evening > 0) evening[dot.key_name] = split.evening;
            distinct.add(dot.key_name);
        }
    }

    // One variant per purchasable width, each produced by the SAME cap that already binds a
    // purchased package — which is what makes the widths mean the same thing here as they do at
    // submission, and what gives the ladder rotation for free.
    // `levels` and `order` have to be carried onto the reconstructed recipe, not just `weeks`.
    // Dropping them silently returned _capDistinctDots to ranking on dose position, which is the
    // proxy the ranking exists to replace — and it showed: a dot ranked THIRD was cut from the
    // core while one ranked ninth survived, because rounding had flattened its narrow range to
    // position 0. Padded dots go on the END of the order: a slot the formulator did not fill is
    // by definition less important than every one it did.
    const paddedOrder = _orderOf(morningRecipe, eveningRecipe)
        ? [..._orderOf(morningRecipe, eveningRecipe),
           ...[...distinct].filter(k => !_orderOf(morningRecipe, eveningRecipe).includes(k))]
        : undefined;
    const carry = {
        weeks: morningRecipe?.weeks || eveningRecipe?.weeks || undefined,
        levels: _levelsOf(morningRecipe, eveningRecipe) || undefined,
        order: paddedOrder,
    };
    const full = {
        morning: { dots: morning, ...carry },
        evening: { dots: evening, ...carry },
    };
    // The load every tier is levelled up to: what the WIDEST variant asks for, which is the
    // formulator's own allocation and therefore the one number here nobody invented. Computed
    // before the loop so each variant is measured against the same ceiling.
    const widestVariant = _capDistinctDots(full.morning, full.evening, dotsFormulary, widest, tierByKey);
    const target = _dailyDotTotal(widestVariant.morning, widestVariant.evening);

    const variants = [];
    let previous = null;
    for (const width of widths) {
        const trimmed = _capDistinctDots(full.morning, full.evening, dotsFormulary, width, tierByKey);
        // NESTING comes from _capDistinctDots ranking the SAME full allocation every time and
        // keeping the top `width` of each week: the top 6 of a week are always inside its top 8.
        // Equalisation runs AFTER the cap and changes no membership at all, so it cannot disturb
        // that — it only decides how much of each surviving dot the buyer gets.
        //
        // A width the formula cannot fill adds nothing over the one below it, and an "upgrade"
        // that changes nothing reads as a broken promise — so it is not a tier of its own.
        const capped = _equalizeToTarget(trimmed.morning, trimmed.evening, dotsFormulary, target);
        const added = previous ? _ladderAdditions(previous, capped, dotsFormulary) : [];
        if (previous && added.length === 0) continue;
        variants.push({
            max_distinct_dots: width,
            tier_label: labelByWidth.get(width) || null,
            tier_description: descriptionByWidth.get(width) || null,
            morning: capped.morning,
            evening: capped.evening,
            added,
        });
        previous = capped;
    }
    if (variants.length === 0) return null;

    // The narrowest package that carries every dot the formulator asked for — "the tier your own
    // protocol needs", which is a fact about the allocation rather than a claim about the product.
    // Falls to the widest offered when the protocol outgrows every package, which is the honest
    // reading of that case too.
    const recommended = variants.find(v => v.max_distinct_dots >= authoredDistinct)
        || variants[variants.length - 1];
    for (const v of variants) v.recommended = v === recommended;

    return { base: variants[0], variants, recommendedWidth: recommended.max_distinct_dots };
}

// The distinct non-N7 dots a variant contains anywhere in the cycle — the union across weeks, not
// the widest week. A dot that runs only in weeks 3-4 is still part of the formula, and is still
// something a wider tier can be said to have added.
function _ladderKeys(morningRecipe, eveningRecipe) {
    const keys = new Set();
    for (const recipe of [morningRecipe, eveningRecipe]) {
        for (const [key, count] of Object.entries(recipe?.dots || {})) {
            if (key !== N7_KEY && count > 0) keys.add(key);
        }
    }
    return keys;
}

// What a wider tier adds over the one below it, WEEK BY WEEK.
//
// Under rotation this is not simply "dots the narrow formula does not contain": a dot can be in
// both formulas and still run in more weeks on the wider one, which is a real upgrade and the
// reason the comparison is per week rather than cycle-wide. The result is one entry per dot that
// gains any week, carrying the weeks it gains.
//
// The dose is read out of a real day's expansion rather than the requested totals — a wider week
// has less capsule room and _fitRecipeToDailyBudget may have trimmed it. The day chosen is the
// first day of the first week the dot actually gains, because day 0 is week 1 and a dot rotated
// into weeks 3-4 would read there as absent.
function _ladderAdditions(narrow, wide, dotsFormulary) {
    const activeIn = (recipes, week) => {
        const membership = _weekMembership(recipes.morning, recipes.evening);
        const out = new Set();
        for (const key of _ladderKeys(recipes.morning, recipes.evening)) {
            const weeks = membership.get(key);
            if (!weeks || weeks.includes(week)) out.add(key);
        }
        return out;
    };
    const gained = new Map();
    for (let week = 1; week <= PLAN_WEEKS; week++) {
        const before = activeIn(narrow, week);
        for (const key of activeIn(wide, week)) {
            if (before.has(key)) continue;
            if (!gained.has(key)) gained.set(key, []);
            gained.get(key).push(week);
        }
    }
    if (gained.size === 0) return [];
    const ctx = _planExpansionContext(wide.morning, wide.evening, dotsFormulary);
    const byWeek = new Map();
    const out = [];
    for (const [key, weeks] of gained) {
        const week = weeks[0];
        if (!byWeek.has(week)) byWeek.set(week, _expandPlanDay((week - 1) * DAYS_PER_WEEK, ctx, null));
        const day = byWeek.get(week);
        const am = day.morning.dots[key] || 0;
        const pm = day.evening.dots[key] || 0;
        if (am === 0 && pm === 0) continue; // squeezed out by the daily budget — not an upgrade
        out.push({ key, am, pm, weeks });
    }
    return out;
}

// The dots offered for the upgrade slots a formulation left unfilled, best first.
//
// Only ever consulted for slots ABOVE the narrowest tier (see _buildTierLadder), so this never
// decides what is in someone's core formula — it decides what a wider package would add on top of
// it, which is the question the rungs exist to answer.
//
// Ordered by how defensible the addition is: a dot targeting one of this user's own elevated
// dimensions first, then one their active health-plan focus recommends, then by key so the result
// is deterministic. The dose is the same per-dot fallback every other server-side allocation uses,
// with the same focus bias — never a flat number, since the ranges differ by two orders of
// magnitude across the formulary.
function _padCandidatesFor({ dotsFormulary, bioage, recommendedKeySet }) {
    const chrono = Number(bioage?.ChronoAge);
    const elevated = new Set(Object.entries(bioage?.SubAges || {})
        .filter(([, age]) => Number.isFinite(chrono) && Number(age) > chrono)
        .map(([key]) => SUB_AGE_TARGET_BY_KEY[key])
        .filter(Boolean));
    const score = (dot) => {
        const isRecommended = recommendedKeySet ? recommendedKeySet.has(dot.key_name) : false;
        return (elevated.has(dot.sub_age_target) ? 0 : 2) + (isRecommended ? 0 : 1);
    };
    return (dotsFormulary || [])
        .filter(d => d.key_name !== N7_KEY)
        .map(d => ({ dot: d, rank: score(d) }))
        .sort((a, b) => (a.rank - b.rank) || (a.dot.key_name < b.dot.key_name ? -1 : 1))
        .map(({ dot }) => ({
            key_name: dot.key_name,
            count: _fallbackCountForDot(dot, recommendedKeySet ? recommendedKeySet.has(dot.key_name) : undefined),
        }));
}

// The one place a finished allocation is narrowed before it is stored, for BOTH paths that store
// one (the agentic delivery and the deterministic fallback). Two mutually exclusive narrowings,
// and which applies is decided by whether the user has already bought a package:
//
//   ladder   nothing waiting — the allocation becomes the nested 6 / +2 / +2 formulas, and the
//            plan is stored around the narrowest so it fits whatever code eventually pays for it.
//   cap      a package waiting — there is one tier to hit and no choice to offer, so the existing
//            _capDistinctDots trim to that tier is exactly right, unchanged.
//
// With no ladder from GCN and no package waiting, both are no-ops and the result is byte-for-byte
// what this produced before tiers existed.
function _applyTierLadder({ morningRecipe, eveningRecipe, dotsFormulary, orderContext, tiers, tierByKey, padCandidates }) {
    const ladder = orderContext.mode === 'buy'
        ? _buildTierLadder({ morningRecipe, eveningRecipe, dotsFormulary, tiers, tierByKey, padCandidates })
        : null;
    if (!ladder) {
        const capped = _capDistinctDots(morningRecipe, eveningRecipe, dotsFormulary, orderContext.maxDistinctDots);
        return { morningRecipe: capped.morning, eveningRecipe: capped.evening, tierVariants: null, tierCards: [] };
    }
    return {
        morningRecipe: ladder.base.morning,
        eveningRecipe: ladder.base.evening,
        tierVariants: ladder.variants,
        // EVERY variant, including the narrowest — the card draws three complete formulas, not one
        // chart with upgrade rungs bolted under it. `added` rides along as the count the collapsed
        // header shows ("比上一档多 N 种"); it is the only thing left that _ladderAdditions feeds.
        //
        // They ship with no copy: which dots a tier holds is settled here, and the sentence
        // describing it is written afterwards by lib/tierCopy.js, which is handed these exact
        // contents. A tier left without a pitch renders as its own dots alone, a supported state.
        tierCards: ladder.variants.map(v => ({
            tier_label: v.tier_label,
            tier_description: v.tier_description || null,
            max_distinct_dots: v.max_distinct_dots,
            recommended: !!v.recommended,
            pitch: '',
            added: v.added,
            morning: v.morning,
            evening: v.evening,
        })),
    };
}

// Which of a laddered proposal's formulas the user actually bought.
//
// The stored `morning`/`evening` are the NARROWEST variant, so this is only ever an upgrade away
// from what every other reader sees — which is what makes `tiers` safe to ignore everywhere else.
// The widest variant that fits wins; a package with no tier at all takes the base, because an
// unstated limit is not a purchase of the widest thing on the menu.
//
// Falls back to the base for a plan with no `tiers` (proposed before the ladder existed, or with
// a package already waiting, where there was one tier to aim at and no choice to offer). Those
// still meet the over-tier refusal at the call site, which is the right answer for a formula the
// user was never shown at that width.
function _selectTierVariant(proposedRecipe, maxDistinctDots) {
    const recipe = proposedRecipe || {};
    const base = {
        morning: { dots: recipe.morning || {}, weeks: recipe.weeks || undefined },
        evening: { dots: recipe.evening || {}, weeks: recipe.weeks || undefined },
        variant: null,
    };
    const tiers = Array.isArray(recipe.tiers) ? recipe.tiers : null;
    if (!tiers || tiers.length === 0) return base;
    const max = Number(maxDistinctDots);
    if (!Number.isFinite(max) || max <= 0) return base;
    let chosen = null;
    for (const t of tiers) {
        const w = Number(t?.max_distinct_dots);
        if (!Number.isFinite(w) || w > max) continue;
        if (!chosen || w > Number(chosen.max_distinct_dots)) chosen = t;
    }
    if (!chosen) return base;
    // The chosen tier's OWN rotation, not the base's: each width caps a week independently, so the
    // 8-dot formula's weeks are not the 6-dot formula's. A variant stored before per-tier weeks
    // existed simply has none and falls back to the base's, which is what it was written with.
    const weeks = chosen.weeks || recipe.weeks || undefined;
    return {
        morning: { dots: chosen.morning || {}, weeks },
        evening: { dots: chosen.evening || {}, weeks },
        variant: chosen,
    };
}

// Fits a requested daily allocation into the two capsules a day physically holds.
//
// The two constraints genuinely cannot both hold for a full formulary: every dot has its own
// target_dots_min, those floors sum to more than the 2 x MAX_DOTS_PER_CAPSULE a day holds, so
// SOMETHING has to give. _capRecipeTotal's answer was to scale everything down proportionally,
// which silently lands most dots below their own minimum — a dose low enough that the product's
// own rules call it invalid (lib/agFormulation.js's `dose_below_min`, checked on the DAILY total).
// A sub-therapeutic dot is worse than an absent one: it occupies capsule space that a dot at a
// real dose could have used, and it tells the user they are taking something they are effectively
// not.
//
// So the budget is settled here, on daily totals, before anything is split into capsules.
// _capRecipeTotal still runs afterwards inside _expandPlanDay, but on a recipe that already fits
// it is a no-op safety net rather than the thing deciding the doses.
//
// It gives in three stages, in this order — cheapest sacrifice first:
//
//   1. REBALANCE. A flexible dot in an over-full capsule moves to the other one before anything
//      is reduced or removed. Costs nothing at all: the daily dose is unchanged, it is simply
//      taken at the other end of the day.
//   2. REDUCE toward each dot's own floor. A dot asked for at 58 with a minimum of 28 can give
//      back 30 and still be a real dose. This is the stage the original rule was missing: it
//      dropped whole dots while every survivor sat well above its floor, so it destroyed
//      interventions to buy room that was already lying unused inside the survivors.
//   3. DROP whole dots, and only once even the floors of everything don't fit. Never a partial
//      dot: half a daily dose is exactly the underdose this function exists to prevent, so a
//      dropped dot leaves BOTH slots.
//
// WHICH dot goes is a product judgement, and this is the rule: lowest relative position in its own
// range first. The formulator expresses emphasis by where in a dot's min..max it placed the count
// (see _fallbackCountForDot's 25/50/75%), so a dot sitting at its floor is the one it cared least
// about, and a dot near its ceiling is the one it cared most about. Ties break toward the larger
// FLOOR, because at the point a drop is being considered every survivor is at its floor and the
// floor is what actually relieves the constraint.
//
// Stage 2's give-back is proportional to how much each dot asked for above its floor, so a dot
// the formulator pushed to its ceiling keeps more of that emphasis than one left near its floor.
// It never raises a dot above what was asked for — this function only ever takes away.
function _fitRecipeToDailyBudget(morningRecipe, eveningRecipe, dotsFormulary) {
    const CAP = MAX_DOTS_PER_CAPSULE;
    const byKey = new Map((dotsFormulary || []).map(d => [d.key_name, d]));
    const inMorning = { ...(morningRecipe?.dots || {}) };
    const inEvening = { ...(eveningRecipe?.dots || {}) };
    const levels = _levelsOf(morningRecipe, eveningRecipe);
    const order = _orderOf(morningRecipe, eveningRecipe);
    const orderIndex = order ? new Map(order.map((k, i) => [k, i])) : null;
    const sum = obj => Object.values(obj).reduce((a, b) => a + b, 0);

    // A recipe that already fits is returned exactly as it came in, rather than re-derived. The
    // caller's own AM/PM split is a real decision (an AG formula's, or _splitDotTiming's) and
    // there is nothing to fix.
    if (sum(inMorning) <= CAP && sum(inEvening) <= CAP) {
        return { morning: { dots: inMorning }, evening: { dots: inEvening } };
    }

    const requested = new Map();
    for (const [key, count] of [...Object.entries(inMorning), ...Object.entries(inEvening)]) {
        if (count > 0) requested.set(key, (requested.get(key) || 0) + count);
    }

    const dotOf = key => byKey.get(key) || {};
    const isFlexible = key => !!dotOf(key).timing_flexible;
    // A dot the formulary doesn't describe falls back to where the CALLER put it, not to the
    // morning. Defaulting to morning would quietly collapse a whole two-capsule recipe into one
    // capsule the moment a caller's SELECT omits `timing` — a failure that reads as a plausible
    // formulation rather than as an error.
    const slotOf = key => {
        const timing = dotOf(key).timing;
        if (timing === 'Evening') return 'evening';
        if (timing === 'Morning') return 'morning';
        return (inEvening[key] || 0) > (inMorning[key] || 0) ? 'evening' : 'morning';
    };
    // A floor above what was asked for would be this function adding dose, which it must never do.
    const floorOf = key => Math.min(requested.get(key), dotOf(key).target_dots_min ?? 1);
    // A declared order is the formulator's ranking and outranks the dose-derived proxy, exactly
    // as in _capDistinctDots — the two droppers must agree about what matters least.
    const position = (key) => (orderIndex
        ? (orderIndex.has(key) ? 1 - (orderIndex.get(key) / Math.max(1, orderIndex.size)) : 0)
        : _emphasisPosition(dotOf(key), requested.get(key), levels && levels[key]));

    // Stage 3, hoisted: a non-flexible dot cannot leave its own capsule, so its slot's floors have
    // to fit that one capsule on their own. Everything else only has to fit the day.
    let keys = [...requested.keys()];
    const floorsIn = ks => ks.reduce((a, k) => a + floorOf(k), 0);
    const lockedIn = slot => keys.filter(k => !isFlexible(k) && slotOf(k) === slot);
    while (keys.length > 1) {
        let pool = null;
        if (floorsIn(lockedIn('morning')) > CAP) pool = lockedIn('morning');
        else if (floorsIn(lockedIn('evening')) > CAP) pool = lockedIn('evening');
        else if (floorsIn(keys) > 2 * CAP) pool = keys;
        if (!pool || pool.length <= 1) break; // nothing left to give; _capRecipeTotal takes it from here
        const drop = [...pool].sort((a, b) => (position(a) - position(b)) || (floorOf(b) - floorOf(a)))[0];
        keys = keys.filter(k => k !== drop);
    }

    // Stage 2: start every survivor at its floor, then hand the remaining daily capacity back out
    // one dot at a time, always to whichever dot is proportionally furthest from what was asked
    // for. Bounded by the budget, so at most 2 x CAP iterations.
    const counts = new Map(keys.map(k => [k, floorOf(k)]));
    const wanted = new Map(keys.map(k => [k, requested.get(k)]));
    let allocated = [...counts.values()].reduce((a, b) => a + b, 0);
    // A locked dot's growth is bounded by its own capsule as well as by the day.
    const lockedTotal = slot => lockedIn(slot).reduce((a, k) => a + counts.get(k), 0);
    while (allocated < 2 * CAP) {
        let best = null, bestRatio = -1;
        for (const key of keys) {
            const room = wanted.get(key) - counts.get(key);
            if (room <= 0) continue;
            if (!isFlexible(key) && lockedTotal(slotOf(key)) >= CAP) continue;
            const demand = wanted.get(key) - floorOf(key);
            const ratio = demand > 0 ? room / demand : 0;
            if (ratio > bestRatio || (ratio === bestRatio && best !== null && key < best)) {
                best = key; bestRatio = ratio;
            }
        }
        if (best === null) break; // everyone has what they asked for
        counts.set(best, counts.get(best) + 1);
        allocated += 1;
    }

    // Stage 1: lay the daily totals into the two capsules and even them out. _splitDotTiming is
    // the baseline (a locked dot wholly in its own slot, a flexible one 70/30), then flexible dots
    // move across until both capsules fit. Feasible by construction — each slot's locked floors
    // fit that capsule and the day's total fits both — so the moves below always converge.
    const morning = {}, evening = {};
    for (const key of keys) {
        // slotOf, not dot.timing directly, so the caller-derived fallback above is what
        // _splitDotTiming sees for a dot the formulary doesn't describe.
        const timing = slotOf(key) === 'evening' ? 'Evening' : 'Morning';
        const split = _splitDotTiming({ ...dotOf(key), timing, key_name: key }, counts.get(key));
        if (split.morning > 0) morning[key] = split.morning;
        if (split.evening > 0) evening[key] = split.evening;
    }
    // Two passes: the first keeps the majority of a dot's daily count in the slot it belongs to
    // (the rule systemFormulaGenerate.js and the AG contract both state), the second drops that
    // preference because a capsule that does not physically close is not a trade-off.
    for (const keepMajority of [true, false]) {
        for (const [from, to] of [[morning, evening], [evening, morning]]) {
            while (sum(from) > CAP && sum(to) < CAP) {
                const movable = keys
                    .filter(k => isFlexible(k) && (from[k] || 0) > 0)
                    .filter(k => !keepMajority || (from[k] - Math.ceil(counts.get(k) / 2)) > 0)
                    .sort((a, b) => (from[b] - from[a]) || (a < b ? -1 : 1));
                if (!movable.length) break;
                const key = movable[0];
                const ceiling = keepMajority ? from[key] - Math.ceil(counts.get(key) / 2) : from[key];
                const amount = Math.min(sum(from) - CAP, CAP - sum(to), ceiling);
                if (amount <= 0) break;
                from[key] -= amount;
                to[key] = (to[key] || 0) + amount;
                if (from[key] === 0) delete from[key];
            }
        }
    }
    return { morning: { dots: morning }, evening: { dots: evening } };
}

// Everything a 28-day expansion needs, derived once from an AM/PM recipe.
//
// ONE FITTED RECIPE PER WEEK, not one for the cycle. A recipe may carry per-dot week membership
// (see _weekMembership), so weeks can differ — and the daily budget therefore has to be settled
// per week: a week where only five of a formula's twelve dots are active has room the others do
// not. A recipe with no membership yields PLAN_WEEKS identical weeks, which is exactly the
// steady-state behaviour this function had before weeks existed.
//
// DOT-N7 is lifted out of the everyday recipe entirely here rather than day by day: its dosing is
// fully system-controlled (both capsules, alone, at its own target_dots_max, on exactly the two
// isolation days), so leaving it in the base recipe would dose it twice by two different
// mechanisms. Any *other* pulse-protocol dot — none exist today — still follows the generic
// epoch-based window and is gated per day instead.
function _planExpansionContext(morningRecipe, eveningRecipe, dotsFormulary) {
    const dotsByKey = new Map((dotsFormulary || []).map(d => [d.key_name, d]));
    const n7MaxCount = dotsByKey.get(N7_KEY)?.target_dots_max ?? 50;
    const membership = _weekMembership(morningRecipe, eveningRecipe);
    // N7 is stripped first so it is never a drop candidate in the budget fit below: its dosing is
    // system-controlled and it does not occupy an everyday capsule at all.
    const bareMorning = _omitDotKey(morningRecipe, N7_KEY);
    const bareEvening = _omitDotKey(eveningRecipe, N7_KEY);
    const weekly = [];
    for (let week = 1; week <= PLAN_WEEKS; week++) {
        // Settle the budget by dropping whole dots BEFORE anything is split into capsules, so no
        // dot survives below its own minimum.
        const fitted = _fitRecipeToDailyBudget(
            _recipeForWeek(bareMorning, membership, week),
            _recipeForWeek(bareEvening, membership, week),
            dotsFormulary);
        // Then even the two capsules out, per week rather than once for the cycle: a week that
        // rotates an evening dot out is lopsided in a way the stored recipe cannot anticipate,
        // and _fitRecipeToDailyBudget will not touch it because it fits. Balancing here is what
        // makes the card, the checkout snapshot, the fast-track submission and the schedules the
        // box scan writes all agree about which capsule a dot is taken in.
        weekly.push(_balanceCapsules(fitted.morning, fitted.evening, dotsFormulary));
    }
    return {
        weekly,
        n7IsolationRecipe: { dots: { [N7_KEY]: n7MaxCount } },
        pulseDotsByKey: new Map((dotsFormulary || [])
            .filter(d => d.dosing_protocol === 'pulse' && d.key_name !== N7_KEY)
            .map(d => [d.key_name, d])),
    };
}

// The two capsules for day `dayIndex` (0-based) of a cycle. The single expansion rule set, shared
// by everything that turns a steady-state recipe into real days: _activateProposedPlan (the box
// scan, writing schedules) and _planDayGroups (the chat card). Two consumers that must never
// disagree about what a user is actually taking.
//
// `dateISO` may be null, which is what a dateless proposal passes. The generic pulse window
// (_isPulseActiveDate) is anchored to a fixed calendar epoch, so it cannot be evaluated without a
// real date — with no date, pulse dots are simply left in every day. That is exact today (N7 is
// the only pulse dot and it is routed through isolation instead, never through that gate), but if
// a second pulse dot is ever configured, a proposal will over-state the days it appears on until
// the box scan anchors the cycle. Fix that by resolving the window at scan time, not by inventing
// a start date here: a proposal genuinely does not have one.
function _expandPlanDay(dayIndex, ctx, dateISO) {
    if (N7_ISOLATION_DAY_INDEXES.includes(dayIndex)) {
        return { morning: ctx.n7IsolationRecipe, evening: ctx.n7IsolationRecipe, isN7: true };
    }
    // Which week this day belongs to is the only thing that varies between ordinary days. Every
    // week's recipe was already budget-fitted in _planExpansionContext, so this stays a lookup.
    const base = ctx.weekly[_weekOfDayIndex(dayIndex) - 1] || ctx.weekly[0];
    const gate = recipe => (dateISO ? _applyPulseSchedule(recipe, ctx.pulseDotsByKey, dateISO) : recipe);
    return {
        morning: _capRecipeTotal(gate(base.morning), MAX_DOTS_PER_CAPSULE),
        evening: _capRecipeTotal(gate(base.evening), MAX_DOTS_PER_CAPSULE),
        isN7: false,
    };
}

// Groups the 28 days of a cycle by what a day's capsules actually contain.
//
// Almost every day of a plan is identical — the only per-day variation is the DOT-N7 isolation
// override (both capsules are N7 alone on N7_ISOLATION_DAY_INDEXES) and, in principle, any other
// pulse-protocol dot's active window. Enumerating 28 near-identical rows in a chat bubble is
// noise, so days that expand to the same two capsules are collapsed into one group carrying the
// day numbers it covers.
//
// `dateISO` is deliberately absent: a proposal has no start date yet (the cycle is anchored when
// the box is scanned), so day numbers here are relative — "Day 1" is the first day the user takes
// a capsule, whenever that turns out to be. See _expandPlanDay for what that costs.
function _planDayGroups(morningRecipe, eveningRecipe, dotsFormulary) {
    const ctx = _planExpansionContext(morningRecipe, eveningRecipe, dotsFormulary);
    const groups = [];
    const bySignature = new Map();
    for (let i = 0; i < PLAN_DAYS; i++) {
        const day = _expandPlanDay(i, ctx, null);
        // Key on the capsule contents themselves, so two days group together exactly when they
        // are genuinely the same dose — never on which rule happened to produce them.
        const signature = JSON.stringify([day.morning.dots, day.evening.dots]);
        const existing = bySignature.get(signature);
        if (existing) { existing.days.push(i + 1); continue; }
        const group = { days: [i + 1], morning: day.morning, evening: day.evening, kind: day.isN7 ? 'n7' : 'regular' };
        bySignature.set(signature, group);
        groups.push(group);
    }
    return groups;
}

// The rotation a tier variant actually has, or nothing at all when it runs every dot every week.
function _tierWeeks(variant) {
    const merged = { ...(variant?.evening?.weeks || {}), ...(variant?.morning?.weeks || {}) };
    const weeks = {};
    for (const [key, list] of Object.entries(merged)) {
        if (Array.isArray(list) && list.length > 0 && list.length < PLAN_WEEKS) weeks[key] = list;
    }
    return Object.keys(weeks).length ? { weeks } : {};
}

module.exports = {
    // candidates / fallback dose
    _fallbackCountForDot,
    _resolveCandidateDotKeys,
    // capsules
    _splitDotTiming,
    _balanceCapsules,
    _isPulseActiveDate,
    _applyPulseSchedule,
    _capRecipeTotal,
    _expandProposalToCapsules,
    // weeks
    _weekMembership,
    _countDistinctDots,
    _dailyDotTotal,
    _tierWeeks,
    // ranking / dosing
    SUB_AGE_TARGET_BY_KEY,
    _severityShares,
    _doseFromRank,
    _doseFromRanking,
    _rankDotsBySeverity,
    DOSE_LEVELS,
    _countForLevel,
    // tier width / ladder
    _capDistinctDots,
    _equalizeToTarget,
    _buildTierLadder,
    _ladderKeys,
    _padCandidatesFor,
    _applyTierLadder,
    _selectTierVariant,
    // expansion — the single rule set
    _fitRecipeToDailyBudget,
    _planExpansionContext,
    _expandPlanDay,
    _planDayGroups,
};
