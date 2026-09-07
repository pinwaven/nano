'use strict';
/**
 * A deterministic read of whether a finished allocation actually answers the user's biology.
 *
 * WHY THIS EXISTS. Nothing in the pipeline checked the numbers. JUDGE (lib/agenticChat.js) grades
 * the PROSE against ground truth; validateAgFormulation (lib/agFormulation.js) checks hard
 * manufacturability rules and only on the AG / fast-track path. So a formula could be internally
 * legal, narrated accurately, and still be aimed at the wrong dimension — and one measurably was:
 * on 2026-09-07 qwen-max produced, for a user whose Cellular Age was his single elevated
 * dimension, a core six containing ONE of the three cellular dots and three resilience dots, with
 * every variable-range dose sitting on its own floor. It shipped clean.
 *
 * WHAT IT IS NOT. Not a gate. Reject-never-repair (CLAUDE.md §36) governs SUBMISSION, where a
 * refusal sends the user back to re-run; here the alternative to a flawed formula is no formula,
 * which is worse. Findings are observability plus one targeted safety action by the caller
 * (see allergy_conflict). Pure: no DB, no I/O, no clock, so the whole rule set is testable.
 */

const SUB_AGE_TARGET_BY_KEY = {
    CellularAge: 'Cellular Age',
    MetabolicAge: 'Metabolic Age',
    MicroVascularAge: 'Micro-Vascular Age',
    ResilienceAge: 'Resilience Age',
};

// A dot at or above this position in its own range counts as deliberately emphasised — it is the
// 'high' level (0.9) with room for a raw count that landed near the top of a wide range.
const EMPHASISED_AT = 0.7;

function _positionOf(dot, total, level) {
    if (level === 'moderate') return 0.5;
    if (level === 'high') return 0.9;
    if (level === 'low' || level === 'none') return 0;
    const min = dot?.target_dots_min ?? 1;
    const max = dot?.target_dots_max ?? 10;
    if (max === min) return 0.5;
    return (total - min) / (max - min);
}

function _ingredientNames(dot) {
    const out = [];
    for (const field of ['ingredients_zh', 'ingredients']) {
        const v = dot && dot[field];
        if (!v) continue;
        if (typeof v === 'string') out.push(v);
        else if (Array.isArray(v)) out.push(...v.map(String));
        else out.push(...Object.keys(v));
    }
    return out;
}

// Bidirectional substring containment, deliberately biased toward over-flagging: a false positive
// costs one dot, a false negative feeds someone an allergen. Same principle as
// _filterProductsByUserFacts (CLAUDE.md §37), applied to dots instead of store products.
function _collides(factText, dot) {
    const f = String(factText || '').trim();
    if (f.length < 2) return false;
    const haystack = [dot.name_zh, dot.name, ..._ingredientNames(dot)].filter(Boolean).map(String);
    for (const h of haystack) {
        if (h.length < 2) continue;
        if (h.includes(f) || f.includes(h)) return true;
    }
    return false;
}

/**
 * @returns {{ok: boolean, findings: Array<{code,severity,detail,keys?}>}}
 *   severity 'material' = the formula is wrong for this user or unsafe; 'advisory' = worth
 *   watching. `ok` is true only when nothing material was found.
 */
function checkFormulationQuality({ morningRecipe, eveningRecipe, dotsFormulary, bioage, userFacts }) {
    const findings = [];
    const add = (code, severity, detail, keys) => findings.push({ code, severity, detail, ...(keys ? { keys } : {}) });

    const byKey = new Map((dotsFormulary || []).map(d => [d.key_name, d]));
    const levels = (morningRecipe && morningRecipe.levels) || (eveningRecipe && eveningRecipe.levels) || null;
    const totals = new Map();
    for (const [k, c] of [...Object.entries(morningRecipe?.dots || {}), ...Object.entries(eveningRecipe?.dots || {})]) {
        if (!(c > 0)) continue;
        totals.set(k, (totals.get(k) || 0) + c);
    }
    if (totals.size === 0) {
        add('empty_formulation', 'material', 'no dot was given a dose');
        return { ok: false, findings };
    }

    // 1. Every dose inside its own dot's range. Clamping upstream should make this unreachable;
    //    it is here so a regression in the clamp shows up as a finding rather than as capsules.
    for (const [key, total] of totals) {
        const dot = byKey.get(key);
        if (!dot) { add('unknown_dot', 'material', `${key} is not in the formulary`, [key]); continue; }
        const min = dot.target_dots_min, max = dot.target_dots_max;
        if (min != null && total < min) add('dose_below_min', 'material', `${key} at ${total} is under its ${min} floor`, [key]);
        if (max != null && total > max) add('dose_above_max', 'material', `${key} at ${total} is over its ${max} ceiling`, [key]);
    }

    // 2. Anything the user cannot take. The only finding the caller acts on rather than logs.
    for (const fact of userFacts || []) {
        if (fact.status && fact.status !== 'active') continue;
        if (!['allergy', 'dietary_restriction'].includes(fact.category)) continue;
        const hits = [...totals.keys()].filter(k => byKey.get(k) && _collides(fact.fact_zh || fact.fact, byKey.get(k)));
        if (hits.length) {
            add('allergy_conflict', 'material', `dosed dots collide with "${fact.fact_zh || fact.fact}" (${fact.category})`, hits);
        }
    }

    // 3. Emphasis has to exist before it can point anywhere. A formula with everything on its
    //    floor expresses no priority at all — and the ladder's own ranking then falls through to
    //    tie-breakers, which is how "stable" output can be alphabetical rather than clinical.
    const emphasised = [...totals.keys()].filter(k => _positionOf(byKey.get(k), totals.get(k), levels && levels[k]) >= EMPHASISED_AT);
    if (emphasised.length === 0) {
        add('no_emphasis_signal', 'material', 'every dose sits at or near its floor — the formula states no priority');
    }

    // 4. Does the emphasis point at this user's biology?
    const chrono = Number(bioage?.ChronoAge);
    const subAges = bioage?.SubAges || {};
    const elevated = Object.entries(subAges)
        .filter(([k, v]) => SUB_AGE_TARGET_BY_KEY[k] && Number.isFinite(Number(v)) && Number.isFinite(chrono) && Number(v) > chrono)
        .sort((a, b) => Number(b[1]) - Number(a[1]));

    const dosedFor = target => [...totals.keys()].filter(k => byKey.get(k)?.sub_age_target === target);
    const emphasisFor = target => dosedFor(target)
        .reduce((a, k) => a + _positionOf(byKey.get(k), totals.get(k), levels && levels[k]), 0);

    for (const [dimKey] of elevated) {
        const target = SUB_AGE_TARGET_BY_KEY[dimKey];
        // Only a real omission if the formulary actually offers something for that dimension.
        const available = (dotsFormulary || []).filter(d => d.sub_age_target === target);
        if (available.length && dosedFor(target).length === 0) {
            add('elevated_dimension_uncovered', 'material', `${dimKey} is above chronological age but no dot targeting it was dosed`);
        }
    }

    if (elevated.length) {
        const [topKey] = elevated[0];
        const topTarget = SUB_AGE_TARGET_BY_KEY[topKey];
        const topEmphasised = dosedFor(topTarget)
            .some(k => _positionOf(byKey.get(k), totals.get(k), levels && levels[k]) >= EMPHASISED_AT);
        if (!topEmphasised && (dotsFormulary || []).some(d => d.sub_age_target === topTarget)) {
            add('top_dimension_unemphasised', 'material', `${topKey} is the most elevated dimension but no dot targeting it was dosed at high emphasis`);
        }
        // Emphasis pointing the wrong way: ANY dimension that is not above chronological age
        // carrying more weight than the most elevated one. Comparing against the single lowest
        // dimension was tried first and missed the real case — the weight had gone to the
        // SECOND-lowest, which is exactly the qwen-max shape (three resilience dots at full
        // emphasis while the cellular dots sat on their floors).
        //
        // Advisory, not material: a normal dimension can legitimately carry weight — an
        // ingredient that supports the elevated one, or a goal the user stated themselves. This
        // is a pattern to look at, not a defect to act on.
        const topEmphasis = emphasisFor(topTarget);
        const elevatedKeys = new Set(elevated.map(([k]) => k));
        const outweighing = Object.keys(subAges)
            .filter(k => SUB_AGE_TARGET_BY_KEY[k] && !elevatedKeys.has(k))
            .filter(k => emphasisFor(SUB_AGE_TARGET_BY_KEY[k]) > topEmphasis)
            .sort((a, b) => emphasisFor(SUB_AGE_TARGET_BY_KEY[b]) - emphasisFor(SUB_AGE_TARGET_BY_KEY[a]));
        if (outweighing.length) {
            add('emphasis_inverted', 'advisory', `${outweighing[0]} is not elevated yet carries more dose emphasis than ${topKey}, which is`);
        }
    }

    return { ok: !findings.some(f => f.severity === 'material'), findings };
}

module.exports = { checkFormulationQuality, SUB_AGE_TARGET_BY_KEY, EMPHASISED_AT };
