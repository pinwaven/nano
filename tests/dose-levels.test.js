'use strict';
// Dose is stated as a LEVEL, not a pill count. Asking for a raw number inside each dot's own
// range made the model do 17 lookups across ranges spanning two orders of magnitude, and measured
// 2026-09-07 it did not do them: every variable-range dose landed on the floor or the ceiling and
// never between (qwen-plus 11/4/0, qwen-max 15/0/0). What is asserted here is why a level is
// better than a number — it lands inside the range by construction, and it means the same thing
// in a 2-value range as in a 60-value one, which a count never did.
const test = require('node:test');
const assert = require('node:assert');

const D = require('../src/functions/worker/handlers/dots.js');
const { N7_KEY } = require('../src/functions/worker/lib/dotsProductModel.js');

const NARROW = { key_name: 'DOT-N1',  name_zh: '甲基平衡', timing: 'Morning', timing_flexible: true, target_dots_min: 1,  target_dots_max: 2 };
const WIDE   = { key_name: 'DOT-N9',  name_zh: 'NAD焕新',  timing: 'Morning', timing_flexible: true, target_dots_min: 9,  target_dots_max: 37 };
const FIXED  = { key_name: 'DOT-N8',  name_zh: '明眸',     timing: 'Morning', timing_flexible: true, target_dots_min: 1,  target_dots_max: 1 };

test('every level lands inside the dot\'s own range, on any range', () => {
    for (const dot of [NARROW, WIDE, FIXED]) {
        for (const level of ['low', 'moderate', 'high']) {
            const n = D._countForLevel(dot, level);
            assert.ok(n >= dot.target_dots_min && n <= dot.target_dots_max,
                `${dot.key_name} ${level} -> ${n} escaped ${dot.target_dots_min}-${dot.target_dots_max}`);
        }
    }
    assert.strictEqual(D._countForLevel(WIDE, 'none'), 0, '"none" is the explicit exclusion');
    assert.strictEqual(D._countForLevel(WIDE, 'nonsense'), null, 'an unknown level defers to the caller\'s count');
});

test('levels are ordered, and a wide range actually uses its width', () => {
    assert.ok(D._countForLevel(WIDE, 'low') < D._countForLevel(WIDE, 'moderate'));
    assert.ok(D._countForLevel(WIDE, 'moderate') < D._countForLevel(WIDE, 'high'));
    assert.strictEqual(D._countForLevel(WIDE, 'low'), 9, 'low is the floor — kept, but not a focus');
});

test('a level means the same thing regardless of how wide the range is', () => {
    // The whole point. As raw counts these two are 2 and 34; as emphasis they must be equal,
    // because the formulator said the same thing about both.
    const cap = (dots, levels) => D._capDistinctDots({ dots, levels }, { dots: {} },
        [NARROW, WIDE, FIXED], 1);
    // DOT-N1 at its ceiling (2 of 1-2) used to read as MAXIMUM emphasis for one extra pill, and
    // outranked DOT-N9 deliberately dosed near the top of 9-37. With levels declared, it doesn't.
    const kept = cap({ 'DOT-N1': 2, 'DOT-N9': 34 }, { 'DOT-N1': 'low', 'DOT-N9': 'high' });
    assert.deepStrictEqual(Object.keys(kept.morning.dots), ['DOT-N9'],
        'the dot the formulator called high must survive the one it called low');
});

test('levels ride along with the recipe through a trim', () => {
    const levels = { 'DOT-N1': 'low', 'DOT-N9': 'high' };
    const out = D._capDistinctDots({ dots: { 'DOT-N1': 2, 'DOT-N9': 34 }, levels }, { dots: {} },
        [NARROW, WIDE], 1);
    assert.deepStrictEqual(out.morning.levels, levels, 'the emphasis signal must survive the trim that consumes it');
});

test('with no levels declared, ranking is exactly what it was', () => {
    // A completion from a prompt cached before levels existed, and the deterministic formulator,
    // both still produce plain counts — they must behave unchanged.
    const out = D._capDistinctDots({ dots: { 'DOT-N1': 1, 'DOT-N9': 37 } }, { dots: {} }, [NARROW, WIDE], 1);
    assert.deepStrictEqual(Object.keys(out.morning.dots), ['DOT-N9']);
    assert.strictEqual(out.morning.levels, undefined, 'nothing is invented onto a recipe that declared none');
});

test('the daily budget drops the dot the formulator called least important', () => {
    // Three dots whose floors cannot share one capsule, so something must go.
    const big = k => ({ key_name: k, name_zh: k, timing: 'Morning', timing_flexible: false, target_dots_min: 40, target_dots_max: 60 });
    const F = [big('DOT-A'), big('DOT-B')];
    const out = D._fitRecipeToDailyBudget(
        { dots: { 'DOT-A': 45, 'DOT-B': 45 }, levels: { 'DOT-A': 'high', 'DOT-B': 'low' } },
        { dots: {} }, F);
    assert.ok(!('DOT-B' in out.morning.dots), 'the "low" dot is the one that goes');
    assert.ok('DOT-A' in out.morning.dots);
});
