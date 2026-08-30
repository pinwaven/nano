'use strict';
// The Formulate-Dots 28-day proposal: day grouping, the card contract, and the miniapp renderer
// that has to read it back. These are the pieces where server and client can silently disagree —
// the card is plain text in a chat message, so nothing else checks that the two agree.
const test = require('node:test');
const assert = require('node:assert');

const D = require('../src/functions/worker/handlers/dots.js');
const md = require('../src/mini/nano-miniapp/utils/markdown.js');
const { PLAN_DAYS, MAX_DOTS_PER_CAPSULE, N7_KEY, N7_ISOLATION_DAY_INDEXES } =
    require('../src/functions/worker/lib/dotsProductModel.js');
const { validateAgFormulation, EXPECTED_CAPSULES } =
    require('../src/functions/worker/lib/agFormulation.js');

// A miniature formulary with the shapes that matter: a morning dot, a NON-flexible evening dot
// (DOT-N3, N4 and N12 are the real ones), one big enough to force the capsule cap on its own, and
// DOT-N7 (isolation-dosed).
const FORMULARY = [
    { key_name: 'DOT-N1', name: 'Methyl Balance', name_zh: '甲基平衡', color_hex: '#4A5D7B', timing: 'Morning', timing_flexible: true, target_dots_min: 1, target_dots_max: 2 },
    { key_name: 'DOT-N3', name: 'Quiet Mind', name_zh: '静心夜', color_hex: '#5B7B8C', timing: 'Evening', timing_flexible: false, target_dots_min: 2, target_dots_max: 3 },
    { key_name: 'DOT-N17', name: 'Cholesterol Balance', name_zh: '血脂平衡', color_hex: '#C2C5BB', timing: 'Morning', timing_flexible: true, target_dots_min: 28, target_dots_max: 87 },
    { key_name: N7_KEY, name: 'Senescence Clear', name_zh: '衰老清除', color_hex: '#C9A66B', timing: 'Morning', timing_flexible: true, target_dots_min: 0, target_dots_max: 33, dosing_protocol: 'pulse', pulse_days_per_cycle: 2, pulse_cycle_days: 28 },
];

// Built the way BOTH real paths build it — a daily total per dot, split by _splitDotTiming — and
// not by hand. The split is deliberately never model-driven or caller-driven (see the comment in
// finalizeFormulaDotsGenerate), and _splitDotTiming is what keeps a non-flexible dot wholly in its
// own slot. A hand-rolled recipe would test a shape production never produces.
const DAILY_TOTALS = { 'DOT-N1': 2, 'DOT-N3': 3, 'DOT-N17': 60, [N7_KEY]: 9 };
const MORNING = { dots: {} };
const EVENING = { dots: {} };
for (const dot of FORMULARY) {
    const split = D._splitDotTiming(dot, DAILY_TOTALS[dot.key_name]);
    if (split.morning > 0) MORNING.dots[dot.key_name] = split.morning;
    if (split.evening > 0) EVENING.dots[dot.key_name] = split.evening;
}

test('_formatDayRanges collapses runs and leaves singletons alone', () => {
    assert.strictEqual(D._formatDayRanges([1, 2, 3, 5, 9, 10]), '1-3,5,9-10');
    assert.strictEqual(D._formatDayRanges([7]), '7');
    // Grouping walks the cycle in order, but the formatter must not depend on that.
    assert.strictEqual(D._formatDayRanges([12, 3, 2, 1]), '1-3,12');
});

test('a cycle groups into exactly the everyday dose plus the two N7 reset days', () => {
    const groups = D._planDayGroups(MORNING, EVENING, FORMULARY);
    assert.strictEqual(groups.length, 2);

    const covered = groups.flatMap(g => g.days).sort((a, b) => a - b);
    assert.strictEqual(covered.length, PLAN_DAYS, 'every day of the cycle appears');
    assert.deepStrictEqual(covered, [...new Set(covered)], 'and appears exactly once');
    assert.strictEqual(covered[0], 1, 'days are 1-based — a proposal has no dates, only day numbers');
    assert.strictEqual(covered[covered.length - 1], PLAN_DAYS);

    const n7 = groups.find(g => g.kind === 'n7');
    // N7_ISOLATION_DAY_INDEXES is 0-based; the card is 1-based.
    assert.deepStrictEqual(n7.days, N7_ISOLATION_DAY_INDEXES.map(i => i + 1));
    assert.deepStrictEqual(Object.keys(n7.morning.dots), [N7_KEY], 'N7 is alone in its capsule');
    assert.deepStrictEqual(Object.keys(n7.evening.dots), [N7_KEY]);
    assert.strictEqual(n7.morning.dots[N7_KEY], 33, 'dosed at its own target_dots_max');

    const regular = groups.find(g => g.kind === 'regular');
    assert.ok(!(N7_KEY in regular.morning.dots), 'and never blended into an everyday capsule');
    assert.ok(!(N7_KEY in regular.evening.dots));
});

test('no proposed capsule exceeds the physical fill limit', () => {
    const sum = r => Object.values(r.dots).reduce((a, b) => a + b, 0);
    // The input deliberately overflows: 2 + 60 + 9 = 71 is under, but bump it past the cap.
    const heavy = { dots: { 'DOT-N1': 2, 'DOT-N17': 87 } };
    for (const g of D._planDayGroups(heavy, EVENING, FORMULARY)) {
        assert.ok(sum(g.morning) <= MAX_DOTS_PER_CAPSULE, `AM ${sum(g.morning)} <= ${MAX_DOTS_PER_CAPSULE}`);
        assert.ok(sum(g.evening) <= MAX_DOTS_PER_CAPSULE, `PM ${sum(g.evening)} <= ${MAX_DOTS_PER_CAPSULE}`);
    }
});

test('the dateless preview matches what the box scan will actually write', () => {
    // A proposal expands with dateISO=null; the scan expands the same recipe with real dates.
    // With no pulse dot other than N7 (which never goes through the pulse gate), the two must
    // agree day for day — otherwise the user is shown one plan and given another.
    const ctx = D._planExpansionContext(MORNING, EVENING, FORMULARY);
    for (let i = 0; i < PLAN_DAYS; i++) {
        const preview = D._expandPlanDay(i, ctx, null);
        const scanned = D._expandPlanDay(i, ctx, `2026-09-${String((i % 28) + 1).padStart(2, '0')}`);
        assert.deepStrictEqual(preview.morning.dots, scanned.morning.dots, `day ${i + 1} AM`);
        assert.deepStrictEqual(preview.evening.dots, scanned.evening.dots, `day ${i + 1} PM`);
    }
});

test('the card the server writes is the card the miniapp reads', () => {
    const block = D._buildFormulaChartBlock(MORNING, EVENING, FORMULARY, 'zh', { planId: 4242 });
    const seg = md.mdToSegments('前言\n' + block).find(s => s.t === 'formula');
    assert.ok(seg, 'the directive parses');
    assert.strictEqual(seg.cycleDays, PLAN_DAYS);
    assert.strictEqual(seg.cycleCapsules, PLAN_DAYS * 2);
    assert.strictEqual(seg.planId, '4242', 'the plan id survives — it is what the order CTA posts');
    assert.strictEqual(seg.groups.length, 2);

    const groups = D._planDayGroups(MORNING, EVENING, FORMULARY);
    for (let i = 0; i < groups.length; i++) {
        const expectAm = Object.values(groups[i].morning.dots).reduce((a, b) => a + b, 0);
        const expectPm = Object.values(groups[i].evening.dots).reduce((a, b) => a + b, 0);
        assert.strictEqual(seg.groups[i].am, expectAm, `group ${i} AM total survives the round trip`);
        assert.strictEqual(seg.groups[i].pm, expectPm, `group ${i} PM total survives the round trip`);
    }
    assert.strictEqual(seg.groups[0].days, '1–9 · 12–28');
    assert.strictEqual(seg.groups[1].days, '10–11');
    assert.strictEqual(seg.groups[1].kind, 'n7');
    // Bars are normalised across ALL groups against the single largest capsule, so a reset day
    // reads as the smaller capsule it genuinely is instead of self-normalising to look full.
    const fullest = Math.max(...seg.groups.flatMap(g => [g.am, g.pm]));
    for (const g of seg.groups) {
        const amWidth = g.items.reduce((s2, it) => s2 + it.amPct, 0);
        const pmWidth = g.items.reduce((s2, it) => s2 + it.pmPct, 0);
        assert.ok(amWidth <= 100.0001, `AM track ${amWidth} does not overflow`);
        assert.ok(pmWidth <= 100.0001, `PM track ${pmWidth} does not overflow`);
        // The widest capsule in the whole card fills its track; everything else is read against it.
        if (g.am === fullest) assert.ok(Math.abs(amWidth - 100) < 0.0001, 'the largest capsule fills the track');
    }
    const reset = seg.groups.find(g => g.kind === 'n7');
    const everyday = seg.groups.find(g => g.kind === 'regular');
    assert.ok(reset.am < everyday.am, 'a reset day is visibly a smaller capsule than an everyday one');
});

test('a card saved before the 28-day rework still renders', () => {
    // Chat history is durable: cards written by the old single-day builder carry no '#' meta
    // lines at all, and must not fall back to rendering nothing.
    const legacy = ':::formula\nDOT-N1|甲基平衡|#4A5D7B|3|2\nDOT-N3|静心夜|#5B7B8C|0|4\n:::';
    const seg = md.mdToSegments(legacy).find(s => s.t === 'formula');
    assert.ok(seg);
    assert.strictEqual(seg.groups.length, 1);
    assert.strictEqual(seg.groups[0].days, '', 'no day label, so the WXML omits the header');
    assert.strictEqual(seg.planId, '', 'and no order CTA, since there is no plan to order');
    assert.strictEqual(seg.am, 3);
    assert.strictEqual(seg.pm, 6);
    assert.strictEqual(seg.items.length, 2, 'legacy top-level fields still populated');
});

test('untrusted fields in a card row are not taken at face value', () => {
    const seg = md.mdToSegments(
        ':::formula\n#plan|4242; DROP TABLE\n#day|1-28|regular\nDOT-N1|x|javascript:alert(1)|3|2\n:::'
    ).find(s => s.t === 'formula');
    assert.strictEqual(seg.planId, '', 'a non-numeric plan id is dropped, not interpolated');
    assert.strictEqual(seg.groups[0].items[0].color, '#6B7B8C', 'a non-hex colour falls back');
});

test('day ranges reaching the renderer are digits only', () => {
    const seg = md.mdToSegments(
        ':::formula\n#day|1-9,<script>,12-28|regular\nDOT-N1|x|#4A5D7B|1|0\n:::'
    ).find(s => s.t === 'formula');
    assert.strictEqual(seg.groups[0].days, '1–9 · 12–28');
});

// ── Fast-track submission ────────────────────────────────────────────────────────────────────
// A fast-track order is compounded with NO expert review, so validateAgFormulation is the only
// thing between this expansion and capsules a person swallows. These assert the expansion is
// provably acceptable to it rather than trusting that it is.

test('a proposal expands to exactly the 56 capsules the product model expects', () => {
    const capsules = D._expandProposalToCapsules(MORNING, EVENING, FORMULARY);
    assert.strictEqual(capsules.length, EXPECTED_CAPSULES);
    assert.strictEqual(capsules.length, PLAN_DAYS * 2);
    // canonicalizeCapsules orders day 1 AM … day 28 PM.
    assert.deepStrictEqual(
        capsules.slice(0, 4).map(c => `${c.day}${c.slot}`),
        ['1AM', '1PM', '2AM', '2PM']
    );
    const last = capsules[capsules.length - 1];
    assert.strictEqual(last.day, PLAN_DAYS);
    assert.strictEqual(last.slot, 'PM');
});

test('the expansion passes the validator that is the only check on a fast-track formula', () => {
    const capsules = D._expandProposalToCapsules(MORNING, EVENING, FORMULARY);
    const check = validateAgFormulation({ capsules }, FORMULARY);
    assert.strictEqual(check.valid, true,
        'violations: ' + JSON.stringify(check.violations));
    assert.ok(check.totalDots > 0, 'totals come from the validator, not a second computation');
});

test('the isolation days survive the round trip into capsule form', () => {
    const capsules = D._expandProposalToCapsules(MORNING, EVENING, FORMULARY);
    const isolationDays = N7_ISOLATION_DAY_INDEXES.map(i => i + 1);
    for (const c of capsules) {
        if (isolationDays.includes(c.day)) {
            assert.deepStrictEqual(Object.keys(c.dots), [N7_KEY], `day ${c.day} ${c.slot} is N7 alone`);
        } else {
            assert.ok(!(N7_KEY in c.dots), `day ${c.day} ${c.slot} has no N7`);
        }
    }
});

test('the card CTA mode round-trips, and anything unrecognised means "buy"', () => {
    for (const mode of ['buy', 'submit', 'ag']) {
        const block = D._buildFormulaChartBlock(MORNING, EVENING, FORMULARY, 'zh', { planId: 9, orderMode: mode });
        const seg = md.mdToSegments(block).find(s => s.t === 'formula');
        assert.strictEqual(seg.orderMode, mode);
    }
    // No mode written at all — every card in chat history from before the two-orderings work.
    const noMode = D._buildFormulaChartBlock(MORNING, EVENING, FORMULARY, 'zh', { planId: 9 });
    assert.ok(!noMode.includes('#order'), 'nothing is emitted when the mode is unknown');
    assert.strictEqual(md.mdToSegments(noMode).find(s => s.t === 'formula').orderMode, 'buy',
        'and the renderer defaults to the safe direction: a buy button, never a submit button');
    // An unrecognised mode must not reach the WXML, which switches on the exact strings.
    const bogus = md.mdToSegments(':::formula\n#order|../../admin\n#day|1-28|regular\nDOT-N1|x|#4A5D7B|1|0\n:::')
        .find(s => s.t === 'formula');
    assert.strictEqual(bogus.orderMode, 'buy');
});

test('the validator still rejects a slot-illegal recipe, if one ever reaches it', () => {
    // _splitDotTiming makes this unreachable from either real path, which is exactly why it is
    // worth pinning: the guarantee lives in that one function, and this fails loudly if a future
    // caller ever assembles a recipe without it.
    const illegal = D._expandProposalToCapsules(
        { dots: { 'DOT-N3': 1, 'DOT-N17': 60 } },   // N3 is not timing-flexible, and this is its
        { dots: { 'DOT-N3': 2 } },                   // dose split across both slots
        FORMULARY,
    );
    const check = validateAgFormulation({ capsules: illegal }, FORMULARY);
    assert.strictEqual(check.valid, false);
    assert.ok(check.violations.some(v => v.code === 'slot_violation' && v.detail?.key === 'DOT-N3'));
});

const sumDots = o => Object.values(o).reduce((a, b) => a + b, 0);

// ── Daily budget ─────────────────────────────────────────────────────────────────────────────
// Every dot has a minimum dose and the floors sum past what a day physically holds, so a full
// formulary cannot keep them all. These pin HOW that is resolved: by dropping whole dots, never by
// shrinking everyone below their own minimum.

// Floors deliberately sum to 156 — past the 144 a day holds — the same bind the real 18-dot
// formulary is in.
const CROWDED = [
    { key_name: 'DOT-A', timing: 'Morning', timing_flexible: false, target_dots_min: 40, target_dots_max: 60 },
    { key_name: 'DOT-B', timing: 'Morning', timing_flexible: false, target_dots_min: 38, target_dots_max: 50 },
    { key_name: 'DOT-C', timing: 'Evening', timing_flexible: false, target_dots_min: 40, target_dots_max: 60 },
    { key_name: 'DOT-D', timing: 'Evening', timing_flexible: false, target_dots_min: 38, target_dots_max: 50 },
];

test('a recipe that already fits is left completely alone', () => {
    const fitted = D._fitRecipeToDailyBudget(MORNING, EVENING, FORMULARY);
    assert.deepStrictEqual(fitted.morning.dots, MORNING.dots);
    assert.deepStrictEqual(fitted.evening.dots, EVENING.dots);
});

test('an over-budget recipe drops whole dots, and every survivor keeps a real dose', () => {
    // AM 100 and PM 100, both over the 72 a capsule holds.
    const am = { dots: { 'DOT-A': 60, 'DOT-B': 40 } };
    const pm = { dots: { 'DOT-C': 60, 'DOT-D': 40 } };
    const fitted = D._fitRecipeToDailyBudget(am, pm, CROWDED);
    const sum = o => Object.values(o).reduce((a, b) => a + b, 0);
    assert.ok(sum(fitted.morning.dots) <= MAX_DOTS_PER_CAPSULE);
    assert.ok(sum(fitted.evening.dots) <= MAX_DOTS_PER_CAPSULE);

    const byKey = new Map(CROWDED.map(d => [d.key_name, d]));
    for (const key of new Set([...Object.keys(fitted.morning.dots), ...Object.keys(fitted.evening.dots)])) {
        const total = (fitted.morning.dots[key] || 0) + (fitted.evening.dots[key] || 0);
        assert.ok(total >= byKey.get(key).target_dots_min,
            `${key} survived at ${total}, below its minimum of ${byKey.get(key).target_dots_min}`);
    }
});

test('the dot the formulator emphasised least is the one dropped', () => {
    // DOT-A sits at its ceiling (60/60), DOT-B at its floor (38/50). B goes.
    const fitted = D._fitRecipeToDailyBudget(
        { dots: { 'DOT-A': 60, 'DOT-B': 38 } }, { dots: {} }, CROWDED);
    assert.deepStrictEqual(Object.keys(fitted.morning.dots), ['DOT-A']);

    // Reverse the emphasis and the other one goes, so this is reading the range position rather
    // than the raw count or the key order.
    const flipped = D._fitRecipeToDailyBudget(
        { dots: { 'DOT-A': 40, 'DOT-B': 50 } }, { dots: {} }, CROWDED);
    assert.deepStrictEqual(Object.keys(flipped.morning.dots), ['DOT-B']);
});

test('a dropped dot leaves BOTH slots — half a daily dose is the underdose this prevents', () => {
    const flexible = [
        { key_name: 'DOT-X', timing: 'Morning', timing_flexible: true, target_dots_min: 90, target_dots_max: 120 },
        { key_name: 'DOT-Y', timing: 'Morning', timing_flexible: true, target_dots_min: 60, target_dots_max: 90 },
    ];
    // Floors of 90 + 60 pass the 144 a day holds, so one of these genuinely has to go. DOT-Y is
    // split across both slots and sits at its floor, so it is the one — and it must vanish from
    // the evening capsule too, even though the evening capsule was never over budget.
    const fitted = D._fitRecipeToDailyBudget(
        { dots: { 'DOT-X': 100, 'DOT-Y': 40 } }, { dots: { 'DOT-Y': 20 } }, flexible);
    assert.ok(!('DOT-Y' in fitted.morning.dots));
    assert.ok(!('DOT-Y' in fitted.evening.dots), 'the untouched capsule is cleaned up as well');
});

test('an over-full capsule is rebalanced before anything is reduced or dropped', () => {
    // Both dots default to the morning, so _splitDotTiming's 70/30 leaves AM at 91 — over the 72 a
    // capsule holds — while PM sits at 39 with room to spare. The day itself fits, so nothing may
    // be reduced and nothing may be dropped: the same doses are simply taken at the other end of
    // the day. This is the stage the old rule had no notion of at all.
    const flexible = [
        { key_name: 'DOT-P', timing: 'Morning', timing_flexible: true, target_dots_min: 10, target_dots_max: 100 },
        { key_name: 'DOT-Q', timing: 'Morning', timing_flexible: true, target_dots_min: 10, target_dots_max: 100 },
    ];
    const am = { dots: {} }, pm = { dots: {} };
    for (const [dot, total] of [[flexible[0], 80], [flexible[1], 50]]) {
        const split = D._splitDotTiming(dot, total);
        if (split.morning > 0) am.dots[dot.key_name] = split.morning;
        if (split.evening > 0) pm.dots[dot.key_name] = split.evening;
    }
    const fitted = D._fitRecipeToDailyBudget(am, pm, flexible);
    const sum = o => Object.values(o).reduce((a, b) => a + b, 0);
    assert.ok(sum(fitted.morning.dots) <= MAX_DOTS_PER_CAPSULE, `AM ${sum(fitted.morning.dots)}`);
    assert.ok(sum(fitted.evening.dots) <= MAX_DOTS_PER_CAPSULE, `PM ${sum(fitted.evening.dots)}`);
    const daily = k => (fitted.morning.dots[k] || 0) + (fitted.evening.dots[k] || 0);
    assert.strictEqual(daily('DOT-P'), 80, 'a rebalance must not cost a single dot of dose');
    assert.strictEqual(daily('DOT-Q'), 50);
});

test('the slack inside the survivors is given back before any dot is dropped', () => {
    // 220 dots requested against the 144 a day holds, but the floors only add up to 60 — so every
    // dot can stay, each giving back what it asked for above its own floor. The old rule dropped
    // whole dots here while every survivor still sat far above its minimum: it destroyed
    // interventions to buy room that was already lying unused inside the ones it kept.
    const roomy = [
        { key_name: 'DOT-A', timing: 'Morning', timing_flexible: true, target_dots_min: 20, target_dots_max: 80 },
        { key_name: 'DOT-B', timing: 'Morning', timing_flexible: true, target_dots_min: 20, target_dots_max: 80 },
        { key_name: 'DOT-C', timing: 'Evening', timing_flexible: true, target_dots_min: 20, target_dots_max: 60 },
    ];
    const fitted = D._fitRecipeToDailyBudget(
        { dots: { 'DOT-A': 80, 'DOT-B': 80 } }, { dots: { 'DOT-C': 60 } }, roomy);
    const sum = o => Object.values(o).reduce((a, b) => a + b, 0);
    const daily = k => (fitted.morning.dots[k] || 0) + (fitted.evening.dots[k] || 0);
    for (const dot of roomy) {
        assert.ok(daily(dot.key_name) >= dot.target_dots_min,
            `${dot.key_name} kept at ${daily(dot.key_name)}, below its floor of ${dot.target_dots_min}`);
        assert.ok(daily(dot.key_name) <= dot.target_dots_max, `${dot.key_name} must never be raised above its own ceiling`);
    }
    assert.strictEqual(sum(fitted.morning.dots) + sum(fitted.evening.dots), 2 * MAX_DOTS_PER_CAPSULE,
        'the day is filled, not left short');
    assert.ok(sum(fitted.morning.dots) <= MAX_DOTS_PER_CAPSULE);
    assert.ok(sum(fitted.evening.dots) <= MAX_DOTS_PER_CAPSULE);
});

test('a reduced dot is never raised above what the formulator asked for', () => {
    // The give-back only ever takes away. A dot asked for below its own floor (an upstream clamp
    // failure) must not be topped up to the floor by this function.
    const one = [{ key_name: 'DOT-Z', timing: 'Morning', timing_flexible: false, target_dots_min: 40, target_dots_max: 90 }];
    const fitted = D._fitRecipeToDailyBudget({ dots: { 'DOT-Z': 90 } }, { dots: {} }, one);
    assert.strictEqual(fitted.morning.dots['DOT-Z'], MAX_DOTS_PER_CAPSULE, 'a locked dot fills its own capsule and no more');
});

test('a formulary missing `timing` falls back to the caller\'s own split, not to the morning', () => {
    // Shipped exactly this: three call sites (the printed label, the GCN checkout snapshot, the
    // box scan that writes the real capsules) SELECTed only the pulse/isolation columns. With
    // `timing` undefined every dot read as Morning, so a two-capsule recipe collapsed into one —
    // a 72-dot morning and an empty evening, which reads as a plausible formulation rather than
    // as an error. The SELECTs are fixed; this pins the degradation so it can never be silent.
    const stripped = [
        { key_name: 'DOT-M', target_dots_max: 90 },
        { key_name: 'DOT-E', target_dots_max: 90 },
    ];
    const fitted = D._fitRecipeToDailyBudget(
        { dots: { 'DOT-M': 80 } }, { dots: { 'DOT-E': 80 } }, stripped);
    assert.ok(sumDots(fitted.evening.dots) > 0, 'the evening capsule must not be emptied');
    assert.ok('DOT-E' in fitted.evening.dots, 'a dot the caller put in the evening stays there');
    assert.ok(sumDots(fitted.morning.dots) <= MAX_DOTS_PER_CAPSULE);
    assert.ok(sumDots(fitted.evening.dots) <= MAX_DOTS_PER_CAPSULE);
});

test('a crowded formulary still expands to a formula the validator accepts', () => {
    // The end-to-end property that matters: with floors summing past the daily budget, the
    // expansion a fast-track submission sends GCN must still be valid — no expert sees it.
    const capsules = D._expandProposalToCapsules(
        { dots: { 'DOT-A': 60, 'DOT-B': 40 } }, { dots: { 'DOT-C': 60, 'DOT-D': 40 } }, CROWDED);
    const check = validateAgFormulation({ capsules }, CROWDED);
    const belowMin = (check.violations || []).filter(v => v.code === 'dose_below_min');
    assert.deepStrictEqual(belowMin, [], 'no surviving dot is under its own minimum');
});

// ── The label QR ─────────────────────────────────────────────────────────────────────────────
// One code identifies a formulation from generation, through the printed box, to the scan that
// activates it. The claim regex reading it back out of the QR's URL is the load-bearing part.

test('the QR URL is a GCN aeviva sector link carrying the code', () => {
    const url = D._formulationLabelUrl('WVB1A2B3C4D5E6F');
    assert.ok(url.startsWith('https://aeviva'), url);
    assert.ok(url.includes('/formulation-label.html?c=WVB1A2B3C4D5E6F'), url);
});

test('handlePostBoxClaim can read the code back out of the QR URL', () => {
    // The exact regex handlers/boxes.js uses. This is what lets ONE QR both open a human-readable
    // page in a phone camera and activate the plan when scanned in the Mini Program.
    const CLAIM_RE = /WVB[0-9A-Fa-f]{12}/;
    const code = 'WVB1A2B3C4D5E6F';
    for (const scanned of [
        code,                                                   // a code-only QR
        `https://nano.gcn.net/api/box/${code}`,                 // labels printed before this change
        D._formulationLabelUrl(code),                           // the GCN aeviva label QR
        `${D._formulationLabelUrl(code)}&lang=en`,              // …with anything appended
    ]) {
        const m = CLAIM_RE.exec(scanned);
        assert.ok(m, `no code found in: ${scanned}`);
        assert.strictEqual(m[0].toUpperCase(), code);
    }
});

test('the card carries the label URL, and the renderer refuses a non-https one', () => {
    const block = D._buildFormulaChartBlock(MORNING, EVENING, FORMULARY, 'zh',
        { planId: 9, orderMode: 'buy', labelCode: 'WVB1A2B3C4D5E6F' });
    const seg = md.mdToSegments(block).find(s => s.t === 'formula');
    assert.strictEqual(seg.labelUrl, D._formulationLabelUrl('WVB1A2B3C4D5E6F'));

    // No code minted (a legacy card, or a proposal whose write failed) — no button, not a broken one.
    const none = D._buildFormulaChartBlock(MORNING, EVENING, FORMULARY, 'zh', { planId: 9 });
    assert.ok(!none.includes('#label'));
    assert.strictEqual(md.mdToSegments(none).find(s => s.t === 'formula').labelUrl, '');

    // It reaches wx.navigateTo, so anything that is not an https URL is dropped.
    for (const bad of ['javascript:alert(1)', 'http://evil.example/x', '/pages/admin/admin']) {
        const seg2 = md.mdToSegments(`:::formula\n#label|${bad}\n#day|1-28|regular\nDOT-N1|x|#4A5D7B|1|0\n:::`)
            .find(s => s.t === 'formula');
        assert.strictEqual(seg2.labelUrl, '', `should have rejected: ${bad}`);
    }
});
