// _balanceCapsules — timing-locked dots into their own capsule first, then the flexible ones even
// the two out.
//
// Pure: no DB, no stubs. The formulary below mirrors the real one's shape — three timing-locked
// dots (DOT-N3 evening, DOT-N4 and DOT-N12 morning) and flexible dots whose `timing` is only a
// default.
//
// A flexible dot may be split across the two capsules any way at all — that is what the column
// means (早晚皆可，可自由拆分) — so the only thing that stops a day coming out exactly level is
// the timing-locked dots, which never move. The validator is asserted at the bottom, since it is
// the only check on a fast-track formula.
const { test } = require('node:test');
const assert = require('node:assert');
const D = require('../src/functions/worker/handlers/dots');
const { validateAgFormulation } = require('../src/functions/worker/lib/agFormulation');
const { MAX_DOTS_PER_CAPSULE } = require('../src/functions/worker/lib/dotsProductModel');

const dot = (key, timing, flexible, min = 1, max = 40) => ({
    key_name: key, timing, timing_flexible: flexible,
    target_dots_min: min, target_dots_max: max,
});

const F = [
    dot('DOT-N3', 'Evening', false, 2, 3),
    dot('DOT-N4', 'Morning', false, 9, 28),
    dot('DOT-N12', 'Morning', false, 8, 17),
    dot('DOT-N5', 'Morning', true, 5, 13),
    dot('DOT-N6', 'Morning', true, 17, 33),
    dot('DOT-N9', 'Morning', true, 9, 37),
    dot('DOT-N14', 'Evening', true, 7, 17),
    dot('DOT-N2', 'Evening', true, 3, 7),
];

const sum = o => Object.values(o).reduce((a, b) => a + b, 0);
const gap = r => Math.abs(sum(r.morning.dots) - sum(r.evening.dots));
const totals = (m, e) => {
    const out = {};
    for (const [k, n] of [...Object.entries(m.dots), ...Object.entries(e.dots)]) out[k] = (out[k] || 0) + n;
    return out;
};
// The real dev proposal that motivated this: 71 in the morning against 31 in the evening.
const PIN_AM = { dots: { 'DOT-N4': 17, 'DOT-N5': 8, 'DOT-N6': 22, 'DOT-N9': 24 } };
const PIN_PM = { dots: { 'DOT-N3': 2, 'DOT-N6': 9, 'DOT-N9': 10, 'DOT-N14': 10 } };

test('evens the two capsules', () => {
    assert.strictEqual(sum(PIN_AM.dots) - sum(PIN_PM.dots), 40);
    const out = D._balanceCapsules(PIN_AM, PIN_PM, F);
    // 102 capsule-dots across the day, and enough of it is flexible to split evenly.
    assert.strictEqual(sum(out.morning.dots), 51);
    assert.strictEqual(sum(out.evening.dots), 51);
});

test('a flexible dot may end up wholly in its non-default capsule', () => {
    // The freedom the timing_flexible column already grants, and the thing that makes an exactly
    // level day reachable. Only the locked dots are pinned.
    const out = D._balanceCapsules({ dots: { 'DOT-N6': 30, 'DOT-N9': 30 } }, { dots: {} }, F);
    assert.strictEqual(sum(out.morning.dots), 30);
    assert.strictEqual(sum(out.evening.dots), 30);
    assert.strictEqual(out.evening.dots['DOT-N6'], 30, 'the whole dot moved');
    assert.ok(!out.morning.dots['DOT-N6']);
    assert.strictEqual(out.morning.dots['DOT-N9'], 30, 'the second dot was never touched');
});

test('never changes a daily total, or which dots are in the formula', () => {
    const out = D._balanceCapsules(PIN_AM, PIN_PM, F);
    assert.deepStrictEqual(totals(out.morning, out.evening), totals(PIN_AM, PIN_PM));
});

test('a timing-locked dot never leaves its own capsule', () => {
    // Every flexible dot here defaults to the evening, so levelling has to pull dose into the
    // morning — and the locked evening dot still must not be part of it.
    const m = { dots: { 'DOT-N4': 20, 'DOT-N12': 10 } };
    const e = { dots: { 'DOT-N3': 3, 'DOT-N14': 17, 'DOT-N2': 7 } };
    const out = D._balanceCapsules(m, e, F);
    assert.strictEqual(out.evening.dots['DOT-N3'], 3);
    assert.ok(!out.morning.dots['DOT-N3']);
    assert.strictEqual(out.morning.dots['DOT-N4'], 20);
    assert.strictEqual(out.morning.dots['DOT-N12'], 10);
    assert.ok(!out.evening.dots['DOT-N4'] && !out.evening.dots['DOT-N12']);
});

test('locked dots alone can leave the day lopsided, and that is allowed', () => {
    // 30 locked into the morning against 3 locked into the evening, nothing flexible to deal out.
    // The rule is "locked first", not "even at any cost".
    const out = D._balanceCapsules({ dots: { 'DOT-N4': 20, 'DOT-N12': 10 } }, { dots: { 'DOT-N3': 3 } }, F);
    assert.strictEqual(sum(out.morning.dots), 30);
    assert.strictEqual(sum(out.evening.dots), 3);
});

test('a day that is already level is left exactly as it came in', () => {
    const m = { dots: { 'DOT-N6': 20 } };
    const e = { dots: { 'DOT-N14': 20 } };
    const out = D._balanceCapsules(m, e, F);
    assert.deepStrictEqual(out.morning.dots, { 'DOT-N6': 20 });
    assert.deepStrictEqual(out.evening.dots, { 'DOT-N14': 20 });
});

test('spends the largest dot first, so the fewest are disturbed', () => {
    const out = D._balanceCapsules({ dots: { 'DOT-N6': 30, 'DOT-N9': 20, 'DOT-N5': 10 } }, { dots: {} }, F);
    // Half the 60-capsule gap is 30, and DOT-N6 alone covers it. The other two never move.
    assert.deepStrictEqual(out.morning.dots, { 'DOT-N9': 20, 'DOT-N5': 10 });
    assert.deepStrictEqual(out.evening.dots, { 'DOT-N6': 30 });
    assert.strictEqual(gap(out), 0);
});

test('never makes the heavier capsule heavier, or the gap wider', () => {
    const cases = [
        [{ 'DOT-N6': 33 }, { 'DOT-N14': 3 }],
        [{ 'DOT-N5': 5 }, { 'DOT-N14': 17, 'DOT-N2': 7 }],
        [{ 'DOT-N4': 28, 'DOT-N9': 9 }, { 'DOT-N3': 2 }],
        [{ 'DOT-N9': 1 }, { 'DOT-N14': 7 }],
    ];
    for (const [am, pm] of cases) {
        const before = Math.max(sum(am), sum(pm));
        const out = D._balanceCapsules({ dots: am }, { dots: pm }, F);
        assert.ok(Math.max(sum(out.morning.dots), sum(out.evening.dots)) <= before);
        assert.ok(gap(out) <= Math.abs(sum(am) - sum(pm)));
    }
});

test('keeps both capsules inside the physical cap', () => {
    // Two flexible dots both defaulting to the morning: unbalanced this is 100 in one capsule.
    const flexOnly = [dot('DOT-A', 'Morning', true, 1, 60), dot('DOT-B', 'Morning', true, 1, 60)];
    const out = D._balanceCapsules({ dots: { 'DOT-A': 50, 'DOT-B': 50 } }, { dots: {} }, flexOnly);
    assert.ok(sum(out.morning.dots) <= MAX_DOTS_PER_CAPSULE);
    assert.ok(sum(out.evening.dots) <= MAX_DOTS_PER_CAPSULE);
});

test('weeks, levels and order ride through untouched', () => {
    const carry = {
        weeks: { 'DOT-N14': [1, 2] },
        levels: { 'DOT-N6': 'high' },
        order: ['DOT-N6', 'DOT-N9', 'DOT-N14'],
    };
    const m = { dots: { 'DOT-N6': 22, 'DOT-N9': 24 }, ...carry };
    const e = { dots: { 'DOT-N14': 10 }, ...carry };
    const out = D._balanceCapsules(m, e, F);
    for (const side of [out.morning, out.evening]) {
        assert.deepStrictEqual(side.weeks, carry.weeks);
        assert.deepStrictEqual(side.levels, carry.levels);
        assert.deepStrictEqual(side.order, carry.order);
    }
});

test('a dot the formulary does not describe stays where the caller put it', () => {
    // The failure this guards against is a SELECT that omits `timing`: read as "morning by
    // default" it would collapse a two-capsule recipe into one.
    const out = D._balanceCapsules({ dots: {} }, { dots: { 'DOT-UNKNOWN': 12 } }, F);
    assert.strictEqual(out.evening.dots['DOT-UNKNOWN'], 12);
    assert.ok(!out.morning.dots['DOT-UNKNOWN']);
});

test('the 28-day expansion is levelled, and still passes the fast-track validator', () => {
    // The end-to-end property. The card, the box scan's schedules and the formula sent to be
    // compounded all come out of _expandPlanDay, so it has to be both levelled AND legal.
    const withN7 = F.concat([dot('DOT-N7', 'Morning', true, 0, 33)]);
    const m = { dots: { 'DOT-N4': 17, 'DOT-N6': 22, 'DOT-N9': 24 }, weeks: { 'DOT-N9': [1, 2] } };
    const e = { dots: { 'DOT-N3': 2, 'DOT-N14': 10 }, weeks: { 'DOT-N9': [1, 2] } };

    const ctx = D._planExpansionContext(m, e, withN7);
    // Unbalanced, week 1 of this formula is 63 against 12. Every day now comes out level within
    // one capsule-dot — the N7 isolation days are identical by construction, and 17 of the
    // morning being timing-locked still leaves enough flexible dose to split evenly.
    for (let i = 0; i < 28; i++) {
        const day = D._expandPlanDay(i, ctx, null);
        const am = sum(day.morning.dots), pm = sum(day.evening.dots);
        assert.ok(Math.abs(am - pm) <= 1, `day ${i + 1} is ${am}/${pm}`);
    }

    const check = validateAgFormulation(
        { capsules: D._expandProposalToCapsules(m, e, withN7) }, withN7);
    assert.strictEqual(check.valid, true, 'violations: ' + JSON.stringify(check.violations));
});
