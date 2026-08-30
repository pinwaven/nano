'use strict';
// The purchased 28-day package caps how many distinct dots may run in ONE WEEK — 6 / 8 / 10 种原粒
// (GCN's migration_0085). It is a weekly limit, not a cycle limit: a formula may rotate other dots
// in next week up to the same width. What is asserted here is what makes that safe — the cap is
// applied to the STORED recipe (so the card, the box scan and the fast-track submission cannot
// disagree), a rotating recipe is still a valid formula, and a formula that never existed before
// weeks did behaves exactly as it always has.
const test = require('node:test');
const assert = require('node:assert');

const D = require('../src/functions/worker/handlers/dots.js');
const { N7_KEY, PLAN_DAYS, PLAN_WEEKS, DAYS_PER_WEEK } = require('../src/functions/worker/lib/dotsProductModel.js');
const { validateAgFormulation } = require('../src/functions/worker/lib/agFormulation.js');

// Emphasis is read as position within a dot's OWN min..max, so the ranges here are deliberately
// dissimilar — a rule that ranked on raw counts would pick differently and the test would catch it.
const FORMULARY = [
    { key_name: 'DOT-N1',  name: 'Methyl Balance',   name_zh: '甲基平衡', color_hex: '#4A5D7B', timing: 'Morning', timing_flexible: true,  target_dots_min: 1, target_dots_max: 11 },
    { key_name: 'DOT-N3',  name: 'Quiet Mind',       name_zh: '静心夜',   color_hex: '#5B7B8C', timing: 'Evening', timing_flexible: false, target_dots_min: 2, target_dots_max: 12 },
    { key_name: 'DOT-N5',  name: 'Mito Fuel',        name_zh: '线粒体',   color_hex: '#7B8C5B', timing: 'Morning', timing_flexible: true,  target_dots_min: 4, target_dots_max: 14 },
    { key_name: 'DOT-N9',  name: 'Calm Signal',      name_zh: '舒缓',     color_hex: '#8C5B7B', timing: 'Evening', timing_flexible: true,  target_dots_min: 3, target_dots_max: 13 },
    { key_name: 'DOT-N17', name: 'Lipid Balance',    name_zh: '血脂平衡', color_hex: '#C2C5BB', timing: 'Morning', timing_flexible: true,  target_dots_min: 5, target_dots_max: 15 },
    { key_name: N7_KEY,    name: 'Senescence Clear', name_zh: '衰老清除', color_hex: '#C9A66B', timing: 'Morning', timing_flexible: true, target_dots_min: 0, target_dots_max: 33, dosing_protocol: 'pulse', pulse_days_per_cycle: 2, pulse_cycle_days: 28 },
];

// Daily totals placed at deliberately different points in each dot's range:
//   N1 at 1/10 of its range (least emphasised), N9 at 2/10, N3 at 5/10, N5 at 8/10, N17 at 10/10.
// N7 is present so the "never counted, never dropped" property has something to bite on.
const DAILY = { 'DOT-N1': 2, 'DOT-N9': 5, 'DOT-N3': 7, 'DOT-N5': 12, 'DOT-N17': 15, [N7_KEY]: 9 };
const EMPHASIS_ORDER = ['DOT-N1', 'DOT-N9', 'DOT-N3', 'DOT-N5', 'DOT-N17']; // least → most

// Built the way production builds it — a daily total per dot, split by _splitDotTiming — never by
// hand, so the shape under test is the shape that actually ships.
function build(totals, weeks) {
    const morning = { dots: {} };
    const evening = { dots: {} };
    for (const dot of FORMULARY) {
        const n = totals[dot.key_name];
        if (!n) continue;
        const split = D._splitDotTiming(dot, n);
        if (split.morning > 0) morning.dots[dot.key_name] = split.morning;
        if (split.evening > 0) evening.dots[dot.key_name] = split.evening;
    }
    if (weeks) { morning.weeks = weeks; evening.weeks = weeks; }
    return { morning, evening };
}

const keysOf = (m, e) => [...new Set([...Object.keys(m.dots || {}), ...Object.keys(e.dots || {})])];

test('no package, or a width the formula already fits, leaves the recipe untouched', () => {
    const { morning, evening } = build(DAILY);
    for (const cap of [null, undefined, 0, -1, 5, 6, 99]) {
        const out = D._capDistinctDots(morning, evening, FORMULARY, cap);
        assert.deepStrictEqual(out.morning.dots, morning.dots, `cap=${cap}`);
        assert.deepStrictEqual(out.evening.dots, evening.dots, `cap=${cap}`);
        assert.ok(!out.morning.weeks, `cap=${cap} should not invent a rotation`);
    }
});

test('a steady-state formula over the width loses its least-emphasised dots, from both slots', () => {
    const { morning, evening } = build(DAILY);
    for (let cap = 1; cap <= 4; cap++) {
        const out = D._capDistinctDots(morning, evening, FORMULARY, cap);
        const kept = EMPHASIS_ORDER.filter(k => out.morning.dots[k] || out.evening.dots[k]);
        assert.deepStrictEqual(kept, EMPHASIS_ORDER.slice(EMPHASIS_ORDER.length - cap),
            `cap=${cap} should keep exactly the most-emphasised ${cap}`);
        // A dropped dot leaves BOTH capsules — half a daily dose is the underdose the whole
        // budget/trim machinery exists to prevent.
        for (const dropped of EMPHASIS_ORDER.slice(0, EMPHASIS_ORDER.length - cap)) {
            assert.ok(!(dropped in out.morning.dots), `${dropped} still in morning at cap=${cap}`);
            assert.ok(!(dropped in out.evening.dots), `${dropped} still in evening at cap=${cap}`);
        }
        // Survivors keep the exact count allocated — this trims the SET, never re-doses.
        for (const k of kept) {
            assert.strictEqual((out.morning.dots[k] || 0) + (out.evening.dots[k] || 0), DAILY[k]);
        }
    }
});

test('the width is per WEEK: a rotation wider than the tier over the cycle still fits it', () => {
    // Five dots, but never more than three in any one week — inside a 3-wide package even though
    // the cycle as a whole uses five. This is the whole point of the weekly reading.
    const weeks = {
        'DOT-N17': [1, 2, 3, 4],
        'DOT-N5': [1, 2, 3, 4],
        'DOT-N3': [1, 2],
        'DOT-N9': [3, 4],
        'DOT-N1': [],           // malformed — read as "every week", then trimmed against the tier
    };
    const { morning, evening } = build(DAILY, weeks);
    assert.strictEqual(D._countDistinctDots(morning, evening), 4,
        'N1 with an empty week list counts as present in every week');

    const out = D._capDistinctDots(morning, evening, FORMULARY, 3);
    assert.strictEqual(D._countDistinctDots(out.morning, out.evening), 3, 'no week may exceed the tier');
    // N1 is the least emphasised, so it is what gives way — but only where a week was over.
    assert.ok(!keysOf(out.morning, out.evening).includes('DOT-N1'), 'N1 lost every week, so it is gone');
    // Everything else survives (N7 included — it is outside the tier), and the rotation is
    // preserved rather than flattened into a single steady-state week.
    assert.deepStrictEqual(keysOf(out.morning, out.evening).sort(),
        ['DOT-N17', 'DOT-N3', 'DOT-N5', N7_KEY, 'DOT-N9'].sort());
    assert.deepStrictEqual(out.morning.weeks['DOT-N3'], [1, 2]);
    assert.deepStrictEqual(out.morning.weeks['DOT-N9'], [3, 4]);
});

test('a dot trimmed from one week keeps its other weeks', () => {
    // Weeks 1-2 hold four dots, weeks 3-4 hold two. A tier of 3 may only touch weeks 1-2.
    const weeks = {
        'DOT-N17': [1, 2, 3, 4],
        'DOT-N5': [1, 2, 3, 4],
        'DOT-N3': [1, 2],
        'DOT-N9': [1, 2],
    };
    const { morning, evening } = build({ ...DAILY, 'DOT-N1': 0 }, weeks);
    const out = D._capDistinctDots(morning, evening, FORMULARY, 3);
    assert.strictEqual(D._countDistinctDots(out.morning, out.evening), 3);
    // N9 is the least emphasised of the four, so it loses weeks 1-2 — which were its only weeks.
    assert.ok(!keysOf(out.morning, out.evening).includes('DOT-N9'));
    // The two continuous dots are untouched, and N3 keeps the weeks it was already in.
    assert.deepStrictEqual(out.morning.weeks['DOT-N3'], [1, 2]);
    assert.deepStrictEqual(out.morning.weeks['DOT-N17'], [1, 2, 3, 4]);
});

test('DOT-N7 is outside the tier: never counted, never dropped', () => {
    const { morning, evening } = build(DAILY);
    // 5 real dots + N7. A cap of 5 must therefore be a no-op, not a one-dot trim.
    const five = D._capDistinctDots(morning, evening, FORMULARY, 5);
    assert.deepStrictEqual(five.morning.dots, morning.dots);
    assert.strictEqual(D._countDistinctDots(morning, evening), 5);

    // And it survives the harshest cap there is.
    const one = D._capDistinctDots(morning, evening, FORMULARY, 1);
    assert.ok((one.morning.dots[N7_KEY] || 0) + (one.evening.dots[N7_KEY] || 0) > 0,
        'the system reset dot must not be a drop candidate');
    assert.strictEqual(D._countDistinctDots(one.morning, one.evening), 1);
});

test('_countDistinctDots measures the widest week, which is what a tier is compared against', () => {
    const { morning, evening } = build(DAILY);
    for (let cap = 1; cap <= 5; cap++) {
        const out = D._capDistinctDots(morning, evening, FORMULARY, cap);
        assert.strictEqual(D._countDistinctDots(out.morning, out.evening), Math.min(cap, 5),
            `a tier check elsewhere must not count differently than the trim did (cap=${cap})`);
    }
});

test('the expansion actually rotates: different weeks contain different dots', () => {
    const weeks = { 'DOT-N17': [1, 2, 3, 4], 'DOT-N3': [1, 2], 'DOT-N9': [3, 4] };
    const { morning, evening } = build({ 'DOT-N17': 15, 'DOT-N3': 7, 'DOT-N9': 5 }, weeks);
    const ctx = D._planExpansionContext(morning, evening, FORMULARY);
    const dotsOnDay = i => {
        const day = D._expandPlanDay(i, ctx, null);
        return [...new Set([...Object.keys(day.morning.dots), ...Object.keys(day.evening.dots)])].sort();
    };
    // Day 0 is week 1, day 21 is week 4. Day 9/10 are the N7 isolation days, avoided here.
    assert.deepStrictEqual(dotsOnDay(0), ['DOT-N17', 'DOT-N3']);
    assert.deepStrictEqual(dotsOnDay(DAYS_PER_WEEK * 2), ['DOT-N17', 'DOT-N9']);
    assert.deepStrictEqual(dotsOnDay(PLAN_DAYS - 1), ['DOT-N17', 'DOT-N9']);
    // Every day still belongs to some week — no day falls off the end of the rotation.
    for (let i = 0; i < PLAN_DAYS; i++) {
        const day = D._expandPlanDay(i, ctx, null);
        assert.ok(Object.keys(day.morning.dots).length + Object.keys(day.evening.dots).length > 0,
            `day ${i} is empty`);
    }
});

test('a recipe with no weeks expands to PLAN_WEEKS identical weeks, exactly as before', () => {
    const { morning, evening } = build(DAILY);
    const ctx = D._planExpansionContext(morning, evening, FORMULARY);
    assert.strictEqual(ctx.weekly.length, PLAN_WEEKS);
    for (const week of ctx.weekly) {
        assert.deepStrictEqual(week.morning.dots, ctx.weekly[0].morning.dots);
        assert.deepStrictEqual(week.evening.dots, ctx.weekly[0].evening.dots);
    }
});

test('a rotating formula still expands into one the fast-track validator accepts', () => {
    // The tier trim runs before the recipe is stored; handlePostFormulationSubmit then expands that
    // stored recipe and refuses anything the product rules reject. A rotation that produced an
    // invalid formula would quietly block every submission at the paid boundary.
    const weeks = { 'DOT-N17': [1, 2, 3, 4], 'DOT-N5': [1, 3], 'DOT-N3': [1, 2], 'DOT-N9': [3, 4], 'DOT-N1': [2, 4] };
    const { morning, evening } = build(DAILY, weeks);
    for (const cap of [2, 3, 5]) {
        const out = D._capDistinctDots(morning, evening, FORMULARY, cap);
        const capsules = D._expandProposalToCapsules(out.morning, out.evening, FORMULARY);
        const check = validateAgFormulation({ capsules }, FORMULARY);
        assert.ok(check.valid, `cap=${cap}: ${JSON.stringify(check.violations)}`);
    }
});

test('the card shows the rotation, and shows it as the days it really covers', () => {
    const weeks = { 'DOT-N17': [1, 2, 3, 4], 'DOT-N3': [1, 2], 'DOT-N9': [3, 4] };
    const { morning, evening } = build({ 'DOT-N17': 15, 'DOT-N3': 7, 'DOT-N9': 5 }, weeks);
    const block = D._buildFormulaChartBlock(morning, evening, FORMULARY, 'zh', { planId: 1, orderMode: 'submit' });
    // Weeks 1-2 (days 1-9 and 12-14, split by the N7 isolation days) vs weeks 3-4 (days 15-28).
    assert.ok(block.includes('#day|1-9,12-14|regular'), block);
    assert.ok(block.includes('#day|15-28|regular'), block);
    assert.ok(block.includes('#day|10-11|n7'), block);
    // And the two rotation groups genuinely differ.
    const groups = block.split('#day|').slice(1);
    const wk12 = groups.find(g => g.startsWith('1-9,12-14'));
    const wk34 = groups.find(g => g.startsWith('15-28'));
    assert.ok(wk12.includes('\nDOT-N3|') && !wk12.includes('\nDOT-N9|'));
    assert.ok(wk34.includes('\nDOT-N9|') && !wk34.includes('\nDOT-N3|'));
});
