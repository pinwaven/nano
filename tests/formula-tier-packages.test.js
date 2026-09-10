'use strict';
// Three packages, three formulas — not one formula seen through three apertures.
//
// Until 2026-09-10 every variant was _capDistinctDots applied to the SAME allocation, so the doses
// were byte-identical and the narrow tier was simply the wide one with dots deleted. Measured on
// dev proposal 38864: 79 dots a day at the 6-wide tier against 109 at the 10-wide, out of a 144
// capacity. That is not a lighter formula, it is a partial one — and it is what GCN's renamed tiers
// (轻享套装 —— 基础均衡 / 臻选套装 —— 精准强化 / 尊享套装 —— 全维覆盖) stopped being able to describe.
//
// _equalizeToTarget levels them. What is asserted here is everything that makes that safe:
//   * the widest package is untouched — it IS the formulator's allocation, and therefore the
//     ceiling. Nothing is ever dosed above what was prescribed for the whole formulary;
//   * no dot passes its own target_dots_max, and no locked slot passes one capsule;
//   * equalisation ADDS ONLY: never a dropped dot, never a lowered dose;
//   * the recommended package is measured against what the MODEL asked for, not against what the
//     server padded in to complete the ladder.
const test = require('node:test');
const assert = require('node:assert');

const D = require('../src/functions/worker/handlers/dots.js');
const { N7_KEY, MAX_DOTS_PER_CAPSULE } = require('../src/functions/worker/lib/dotsProductModel.js');

const TIERS = [
    { tier_label: '轻享套装', max_distinct_dots: 6 },
    { tier_label: '臻选套装', max_distinct_dots: 8 },
    { tier_label: '尊享套装', max_distinct_dots: 10 },
];

// Twelve dots plus N7. Ranges are wide enough that a narrow package has real room to be levelled
// up into, which is the whole situation under test.
function formulary(overrides = {}) {
    const out = [];
    for (let i = 1; i <= 12; i++) {
        out.push(Object.assign({
            key_name: `DOT-N${i}`, name: `Dot ${i}`, name_zh: `原粒${i}号`, key_name_zh: `${i}号原粒`,
            color_hex: '#4A5D7B', timing: i % 2 ? 'Morning' : 'Evening',
            timing_flexible: true, target_dots_min: 1, target_dots_max: 30,
        }, overrides[`DOT-N${i}`] || {}));
    }
    out.push({
        key_name: N7_KEY, name: 'Reset', name_zh: '衰老清除', color_hex: '#C9A66B',
        timing: 'Morning', timing_flexible: true, target_dots_min: 0, target_dots_max: 20,
        dosing_protocol: 'pulse', pulse_days_per_cycle: 2, pulse_cycle_days: 28,
    });
    return out;
}

// Descending emphasis: DOT-N1 most emphasised, DOT-N12 least.
function allocation(form) {
    const morning = { dots: {} };
    const evening = { dots: {} };
    for (let i = 1; i <= 12; i++) {
        const dot = form[i - 1];
        const count = 12 - i + 1;
        if (dot.timing === 'Morning') morning.dots[dot.key_name] = count;
        else evening.dots[dot.key_name] = count;
    }
    morning.dots[N7_KEY] = 5;
    return { morning, evening };
}

const dailyTotal = (v) => {
    let n = 0;
    for (const half of [v.morning, v.evening]) {
        for (const [k, c] of Object.entries(half.dots || {})) if (k !== N7_KEY) n += c;
    }
    return n;
};
const keysOf = (v) => new Set([...Object.keys(v.morning.dots || {}), ...Object.keys(v.evening.dots || {})]
    .filter(k => k !== N7_KEY));

function ladder(form, opts = {}) {
    const { morning, evening } = opts.allocation || allocation(form);
    return D._buildTierLadder({
        morningRecipe: morning, eveningRecipe: evening, dotsFormulary: form,
        tiers: opts.tiers || TIERS, padCandidates: opts.padCandidates,
    });
}

// ── Equalisation ────────────────────────────────────────────────────────────────────────────────

test('a narrower package is levelled up to the widest\'s daily load', () => {
    // With room to give — every dot here ranges to 30 — the loads meet exactly.
    const form = formulary();
    const out = ladder(form);
    const totals = out.variants.map(dailyTotal);
    const widest = totals[totals.length - 1];
    for (let i = 0; i < totals.length; i++) {
        assert.strictEqual(totals[i], widest,
            `${out.variants[i].tier_label} delivers ${totals[i]} where the widest delivers ${widest}`);
    }
});

test('...but never past what its own dots can carry', () => {
    // The real formulary is nothing like the fixture above: several dots top out at 1-3 (DOT-N3,
    // DOT-N10, DOT-N13, DOT-N18), so a narrow package built from them CANNOT reach the widest's
    // load however much room the capsule has. Measured on a live dev run (plan 38865): the 6-wide
    // package went 61 → 91 and stopped, because 91 is the sum of its own six ceilings.
    //
    // Parity is the goal, not a guarantee. What is guaranteed is that it only ever rises, and
    // never past an authored ceiling.
    const tight = {};
    for (let i = 1; i <= 6; i++) tight[`DOT-N${i}`] = { target_dots_min: 1, target_dots_max: 3 };
    const form = formulary(tight);
    const order = form.filter(d => d.key_name !== N7_KEY).map(d => d.key_name);
    const morning = { dots: { [N7_KEY]: 5 }, order };
    const evening = { dots: {}, order };
    for (let i = 1; i <= 12; i++) {
        const dot = form[i - 1];
        (dot.timing === 'Morning' ? morning : evening).dots[dot.key_name] = i <= 6 ? 1 : 13 - i;
    }
    const out = ladder(form, { allocation: { morning, evening } });
    const narrow = out.variants[0];
    const ceilingSum = [...keysOf(narrow)]
        .reduce((n, k) => n + Number(form.find(d => d.key_name === k).target_dots_max), 0);
    assert.strictEqual(dailyTotal(narrow), ceilingSum,
        'the narrow package should sit exactly at the sum of its own ceilings');
    assert.ok(dailyTotal(narrow) < dailyTotal(out.variants[out.variants.length - 1]),
        'and that is short of the widest — which is the honest outcome, not a bug');
});

test('the widest package is the formulator\'s own allocation, untouched', () => {
    // It is the ceiling, not a target: nothing here may dose a package above what the model
    // prescribed for the whole formulary, which is what would make this padding rather than
    // levelling.
    const form = formulary();
    const { morning, evening } = allocation(form);
    const out = ladder(form, { allocation: { morning, evening } });
    const widest = out.variants[out.variants.length - 1];
    // Its membership is the widest cap, and its doses are whatever the model asked for — the
    // levelling has nothing to give it, so it comes back byte-identical to the plain trim.
    const trimmed = D._capDistinctDots(morning, evening, form, widest.max_distinct_dots);
    assert.deepStrictEqual(widest.morning.dots, trimmed.morning.dots);
    assert.deepStrictEqual(widest.evening.dots, trimmed.evening.dots);
    for (const [key, count] of Object.entries(widest.morning.dots)) {
        assert.strictEqual(count, morning.dots[key], `${key} was raised in the widest package`);
    }
    for (const [key, count] of Object.entries(widest.evening.dots)) {
        assert.strictEqual(count, evening.dots[key], `${key} was raised in the widest package`);
    }
});

test('no dot passes its own ceiling, and a dot with no range is never raised', () => {
    // A range is authored per dot; a guessed ceiling is a guess about a capsule someone swallows,
    // and the AG validator refuses dose_above_max outright rather than clamping it.
    const form = formulary({
        'DOT-N1': { target_dots_min: 1, target_dots_max: 3 },
        'DOT-N2': { target_dots_min: undefined, target_dots_max: undefined },
    });
    // Both sit well below what the day can hold, and `order` keeps them in every package so the
    // levelling has both the room and the opportunity to raise them.
    const order = form.filter(d => d.key_name !== N7_KEY).map(d => d.key_name);
    const morning = { dots: { 'DOT-N1': 2, [N7_KEY]: 5 }, order };
    const evening = { dots: { 'DOT-N2': 2 }, order };
    for (let i = 3; i <= 12; i++) {
        const dot = form[i - 1];
        (dot.timing === 'Morning' ? morning : evening).dots[dot.key_name] = 13 - i;
    }
    const out = ladder(form, { allocation: { morning, evening } });
    for (const v of out.variants) {
        const total = k => (v.morning.dots[k] || 0) + (v.evening.dots[k] || 0);
        assert.ok(total('DOT-N1') > 0 && total('DOT-N2') > 0, `${v.tier_label} dropped the fixture's dots`);
        assert.ok(total('DOT-N1') <= 3, `${v.tier_label} raised DOT-N1 to ${total('DOT-N1')}, past its ceiling of 3`);
        assert.strictEqual(total('DOT-N2'), 2, 'a dot with no authored range must not be raised at all');
    }
    // And the levelling did happen — otherwise the ceilings above would be satisfied by a no-op.
    const trimmed = D._capDistinctDots(morning, evening, form, 6);
    assert.ok(dailyTotal(out.variants[0]) > dailyTotal(trimmed),
        'the narrowest package was never levelled up, so this proves nothing about ceilings');
});

test('a locked dot never overflows its own capsule', () => {
    // timing_flexible:false cannot be moved between capsules by _balanceCapsules or by
    // _fitRecipeToDailyBudget stage 1, so an over-full locked slot is resolved downstream by
    // DROPPING A WHOLE DOT. Equalisation causing a removal is the worst outcome available here.
    const form = formulary({
        'DOT-N1': { timing_flexible: false, timing: 'Morning', target_dots_max: 200 },
        'DOT-N3': { timing_flexible: false, timing: 'Morning', target_dots_max: 200 },
    });
    const out = ladder(form);
    for (const v of out.variants) {
        let locked = 0;
        for (const k of ['DOT-N1', 'DOT-N3']) locked += v.morning.dots[k] || 0;
        assert.ok(locked <= MAX_DOTS_PER_CAPSULE,
            `${v.tier_label} put ${locked} locked dots in one capsule`);
    }
});

test('equalisation only ever adds — no dot is dropped and no dose is lowered', () => {
    const form = formulary();
    const { morning, evening } = allocation(form);
    const out = ladder(form, { allocation: { morning, evening } });
    // Membership is decided by _capDistinctDots alone; equalisation must not disturb it, so each
    // package's roster is exactly what the cap left.
    for (const v of out.variants) {
        const trimmed = D._capDistinctDots(
            { dots: { ...morning.dots } }, { dots: { ...evening.dots } }, form, v.max_distinct_dots);
        assert.deepStrictEqual(keysOf(v), keysOf(trimmed),
            `${v.tier_label} changed membership`);
        for (const key of keysOf(v)) {
            const after = (v.morning.dots[key] || 0) + (v.evening.dots[key] || 0);
            const before = (trimmed.morning.dots[key] || 0) + (trimmed.evening.dots[key] || 0);
            assert.ok(after >= before, `${v.tier_label} lowered ${key} from ${before} to ${after}`);
        }
    }
});

test('a day that already fills the budget is left exactly as it is', () => {
    // The capsule pair is the hard ceiling regardless of what the widest package asks for; there is
    // nothing to level into, and re-deriving a recipe that already fits would discard the caller's
    // own AM/PM split for no gain.
    const form = formulary({});
    const morning = { dots: { 'DOT-N1': MAX_DOTS_PER_CAPSULE } };
    const evening = { dots: { 'DOT-N2': MAX_DOTS_PER_CAPSULE } };
    const eq = D._equalizeToTarget(morning, evening, form, 10_000);
    assert.deepStrictEqual(eq.morning.dots, morning.dots);
    assert.deepStrictEqual(eq.evening.dots, evening.dots);
});

test('weeks, levels and order survive equalisation', () => {
    // _capDistinctDots ranks on `order` and `levels`, and _weekMembership reads `weeks`. Dropping
    // any of them here silently returns the ranking to dose position — the proxy the ranking exists
    // to replace.
    const form = formulary();
    const carry = { weeks: { 'DOT-N1': [1, 2] }, levels: { 'DOT-N1': 'high' }, order: ['DOT-N1', 'DOT-N2'] };
    const eq = D._equalizeToTarget(
        { dots: { 'DOT-N1': 2 }, ...carry }, { dots: { 'DOT-N2': 2 }, ...carry }, form, 40);
    for (const half of [eq.morning, eq.evening]) {
        assert.deepStrictEqual(half.weeks, carry.weeks);
        assert.deepStrictEqual(half.levels, carry.levels);
        assert.deepStrictEqual(half.order, carry.order);
    }
});

test('a dot split across both capsules stays in both', () => {
    // Rounding must not empty a slot: that silently moves a split dose into one capsule, which is
    // a different instruction to the user than the AM/PM split already settled on.
    const form = formulary();
    const eq = D._equalizeToTarget(
        { dots: { 'DOT-N1': 9 } }, { dots: { 'DOT-N1': 1 } }, form, 60);
    assert.ok(eq.morning.dots['DOT-N1'] > 0 && eq.evening.dots['DOT-N1'] > 0);
    assert.strictEqual(eq.morning.dots['DOT-N1'] + eq.evening.dots['DOT-N1'], 30,
        'the daily total rises to the dot\'s own ceiling and no further');
});

// ── Which package is recommended ────────────────────────────────────────────────────────────────

test('the recommendation is measured against what the MODEL asked for, not the padding', () => {
    // GENERATE curates inside the agentic loop — live dev runs came back with six dots where a
    // single-shot completion of the same prompt gave seventeen — so the server pads the upper
    // packages to make a ladder exist at all. A padded dot must not widen the recommendation, or
    // every proposal recommends the top package and the badge means nothing.
    const form = formulary();
    const morning = { dots: { 'DOT-N1': 8, 'DOT-N3': 6, 'DOT-N5': 4, [N7_KEY]: 5 } };
    const evening = { dots: { 'DOT-N2': 7, 'DOT-N4': 5, 'DOT-N6': 3 } };
    const padCandidates = ['DOT-N7', 'DOT-N8', 'DOT-N9', 'DOT-N10', 'DOT-N11', 'DOT-N12']
        .filter(k => k !== N7_KEY)
        .map(key_name => ({ key_name, count: 4 }));
    const out = ladder(form, { allocation: { morning, evening }, padCandidates });
    assert.strictEqual(out.recommendedWidth, 6,
        'six dots were asked for, so the six-wide package carries the whole formulation');
    assert.strictEqual(out.variants.filter(v => v.recommended).length, 1);
    assert.strictEqual(out.variants.find(v => v.recommended).max_distinct_dots, 6);
    // The wider packages still exist and still add something — they are just not the recommendation.
    assert.ok(out.variants.length > 1, 'padding must still build a ladder');
});

test('a full protocol recommends the package that carries all of it', () => {
    const form = formulary();
    const out = ladder(form); // twelve dots asked for, ten is the widest package
    assert.strictEqual(out.recommendedWidth, 10,
        'a protocol wider than every package falls to the widest — the honest reading of that case');
    const rec = out.variants.find(v => v.recommended);
    assert.strictEqual(rec.max_distinct_dots, 10);
});

test('an eight-dot protocol recommends the middle package, not the top', () => {
    const form = formulary();
    const morning = { dots: { 'DOT-N1': 9, 'DOT-N3': 7, 'DOT-N5': 5, 'DOT-N7': 0, [N7_KEY]: 5 } };
    delete morning.dots['DOT-N7'];
    const evening = { dots: { 'DOT-N2': 8, 'DOT-N4': 6, 'DOT-N6': 4, 'DOT-N8': 3, 'DOT-N10': 2 } };
    const out = ladder(form, { allocation: { morning, evening } });
    assert.strictEqual(out.recommendedWidth, 8);
});

// ── The tier cards handed to the renderer ───────────────────────────────────────────────────────

test('the store\'s own positioning line rides through to the card', () => {
    // One source of truth with the shelf: a package that reads one way in the store and another in
    // chat is the defect GCN's migration_0107 fixed for the tier NAME, applied to the line under it.
    const form = formulary();
    const tiers = TIERS.map((t, i) => ({ ...t, tier_description: `${t.tier_label} —— 定位 ${i}` }));
    const out = D._applyTierLadder({
        morningRecipe: allocation(form).morning, eveningRecipe: allocation(form).evening,
        dotsFormulary: form, tiers, orderContext: { mode: 'buy', maxDistinctDots: null },
    });
    assert.deepStrictEqual(out.tierCards.map(c => c.tier_description),
        ['轻享套装 —— 定位 0', '臻选套装 —— 定位 1', '尊享套装 —— 定位 2']);
    // A catalog with no descriptions yet sends null, and the card simply omits the line.
    const bare = D._applyTierLadder({
        morningRecipe: allocation(form).morning, eveningRecipe: allocation(form).evening,
        dotsFormulary: form, tiers: TIERS, orderContext: { mode: 'buy', maxDistinctDots: null },
    });
    assert.deepStrictEqual(bare.tierCards.map(c => c.tier_description), [null, null, null]);
});

test('a package already bought gets no ladder and no cards', () => {
    // A user holding a code is not choosing between packages, and a card offering the choice would
    // compete with the order they already paid for.
    const form = formulary();
    const out = D._applyTierLadder({
        morningRecipe: allocation(form).morning, eveningRecipe: allocation(form).evening,
        dotsFormulary: form, tiers: TIERS, orderContext: { mode: 'submit', maxDistinctDots: 8 },
    });
    assert.strictEqual(out.tierVariants, null);
    assert.deepStrictEqual(out.tierCards, []);
    assert.strictEqual(D._countDistinctDots(out.morningRecipe, out.eveningRecipe), 8);
});

// ── The card's own strings ──────────────────────────────────────────────────────────────────────

test('every t.formulaTier* key the card binds exists in BOTH languages', () => {
    // WXML has no compile-time key checking: a key present in only one language block renders as
    // an empty string in the other, silently. Source-text assertion rather than a vm sandbox,
    // following tests/dot-code-humanization.test.js — the T blocks are plain object literals and
    // this needs no evaluation.
    const fs = require('node:fs');
    const wxml = fs.readFileSync('src/mini/nano-miniapp/pages/main/main.wxml', 'utf8');
    const js = fs.readFileSync('src/mini/nano-miniapp/pages/main/main.js', 'utf8');
    const used = [...new Set([...wxml.matchAll(/\{\{[^}]*?t\.(formulaTier[A-Za-z]+)/g)].map(m => m[1]))];
    assert.ok(used.length >= 2, `the card should bind the package strings, found ${used.join(', ')}`);
    // The count strings were retired with the count itself — a key left in T but bound nowhere is
    // the kind of thing that gets re-rendered by accident later.
    for (const gone of ['formulaTierDotsUnit', 'formulaTierMorePrefix', 'formulaTierMoreSuffix']) {
        assert.ok(!js.includes(`${gone}:`), `${gone} should be gone from T`);
        assert.ok(!wxml.includes(gone), `${gone} should be bound nowhere`);
    }
    for (const key of used) {
        const hits = js.split(`${key}:`).length - 1;
        assert.strictEqual(hits, 2, `${key} must be defined in both T.zh and T.en (found ${hits})`);
    }
    // The toggle is wired, and carries all three indexes — the flag lives inside a parsed segment,
    // so message + segment + tier is the only way to address it.
    assert.ok(wxml.includes('bindtap="handleFormulaTierToggle"'));
    // And it is wired to the WHOLE collapsed block, not just the title row. Reported from a real
    // device: with the handler on the header alone, a 17px strip was live and the other 81% — the
    // positioning line and the dot roster, i.e. everything a finger aims at — did nothing, so the
    // packages read as unclickable. An automator tap by selector hits the handler either way, which
    // is exactly why this needs asserting rather than trusting the earlier passing tap test.
    assert.strictEqual((wxml.match(/bindtap="handleFormulaTierToggle"/g) || []).length, 3,
        'the title row, the positioning line and the collapsed roster must each toggle');
    // The affordance: without it, collapsed packages read as static summaries.
    assert.ok(wxml.includes('fcard-tier-chev'), 'the expand/collapse chevron must be present');
    for (const attr of ['data-mi=', 'data-si=', 'data-ti=']) {
        assert.ok(wxml.includes(attr), `the toggle needs ${attr}`);
    }
    assert.ok(/wx:for="\{\{messages\}\}"[^>]*wx:for-index="mi"/.test(wxml),
        'the message loop must expose its index, or data-mi is undefined');
    assert.ok(js.includes('handleFormulaTierToggle('), 'the handler must exist');
});
