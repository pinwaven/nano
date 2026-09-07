'use strict';
// The 28-day packages are sold in three widths (6 / 8 / 10 种原粒) that differ in nothing but how
// many distinct dots may run in one week. Before the ladder, a user who had bought nothing was
// never shown that choice: the tool formulated against no ceiling and routinely produced a
// proposal wider than any package sold — unpurchasable the moment a code was spent on it.
//
// What is asserted here is what makes the three formulas safe to offer as one:
//   * they are strictly NESTED, so an "upgrade" can only ever add;
//   * the narrowest is what gets stored, so every pre-existing reader of proposed_recipe sees a
//     recipe that fits any tier;
//   * the widest that fits the redeemed code is what gets submitted;
//   * DOT-N7 is in all of them and counted in none, so a 6种 buyer gets six of their own choosing;
//   * with no ladder from GCN, everything behaves exactly as it did before this existed.
const test = require('node:test');
const assert = require('node:assert');

const D = require('../src/functions/worker/handlers/dots.js');
const { N7_KEY, PLAN_WEEKS } = require('../src/functions/worker/lib/dotsProductModel.js');
const { mdToSegments } = require('../src/mini/nano-miniapp/utils/markdown.js');

// Twelve dots plus N7 — more than the widest tier, which is the ordinary case and the only one
// where a ladder means anything. Ranges are deliberately dissimilar so emphasis (position within
// a dot's OWN range) ranks differently than raw counts would.
const FORMULARY = [];
for (let i = 1; i <= 12; i++) {
    FORMULARY.push({
        key_name: `DOT-N${i}`, name: `Dot ${i}`, name_zh: `原粒${i}号`, key_name_zh: `${i}号原粒`,
        color_hex: '#4A5D7B', timing: i % 2 ? 'Morning' : 'Evening',
        timing_flexible: true, target_dots_min: 1, target_dots_max: 11,
    });
}
FORMULARY.push({
    key_name: N7_KEY, name: 'Senescence Clear', name_zh: '衰老清除', color_hex: '#C9A66B',
    timing: 'Morning', timing_flexible: true, target_dots_min: 0, target_dots_max: 20,
    dosing_protocol: 'pulse', pulse_days_per_cycle: 2, pulse_cycle_days: 28,
});

const TIERS = [
    { tier_label: '6种原粒', max_distinct_dots: 6 },
    { tier_label: '8种原粒', max_distinct_dots: 8 },
    { tier_label: '10种原粒', max_distinct_dots: 10 },
];

// Descending emphasis: DOT-N1 is the most emphasised, DOT-N12 the least. N7 is present so the
// "never ranked, never counted, always kept" property has something to bite on.
function allocation() {
    const morning = { dots: {} };
    const evening = { dots: {} };
    for (let i = 1; i <= 12; i++) {
        const count = 12 - i + 1; // 12 down to 1
        const dot = FORMULARY[i - 1];
        if (dot.timing === 'Morning') morning.dots[dot.key_name] = count;
        else evening.dots[dot.key_name] = count;
    }
    morning.dots[N7_KEY] = 5;
    return { morning, evening };
}

const keysOf = (m, e) => new Set([...Object.keys(m.dots || {}), ...Object.keys(e.dots || {})]);

test('_buildTierLadder produces one variant per purchasable width, narrowest first', () => {
    const { morning, evening } = allocation();
    const ladder = D._buildTierLadder({
        morningRecipe: morning, eveningRecipe: evening, dotsFormulary: FORMULARY, tiers: TIERS,
    });
    assert.ok(ladder, 'a full allocation and three tiers must produce a ladder');
    assert.deepStrictEqual(ladder.variants.map(v => v.max_distinct_dots), [6, 8, 10]);
    assert.deepStrictEqual(ladder.variants.map(v => v.tier_label), ['6种原粒', '8种原粒', '10种原粒']);
    assert.strictEqual(ladder.base, ladder.variants[0], 'the base is the NARROWEST variant');
});

test('variants are strictly nested — an upgrade can only ever add', () => {
    const { morning, evening } = allocation();
    const { variants } = D._buildTierLadder({
        morningRecipe: morning, eveningRecipe: evening, dotsFormulary: FORMULARY, tiers: TIERS,
    });
    for (let i = 1; i < variants.length; i++) {
        const prev = keysOf(variants[i - 1].morning, variants[i - 1].evening);
        const cur = keysOf(variants[i].morning, variants[i].evening);
        for (const key of prev) {
            assert.ok(cur.has(key), `${key} was in the ${variants[i - 1].max_distinct_dots}-dot variant but not the ${variants[i].max_distinct_dots}-dot one`);
        }
    }
});

test('each variant holds exactly its own width of dots, with DOT-N7 free on top', () => {
    const { morning, evening } = allocation();
    const { variants } = D._buildTierLadder({
        morningRecipe: morning, eveningRecipe: evening, dotsFormulary: FORMULARY, tiers: TIERS,
    });
    for (const v of variants) {
        assert.strictEqual(
            D._countDistinctDots(v.morning, v.evening), v.max_distinct_dots,
            `the ${v.max_distinct_dots}-dot variant should measure exactly ${v.max_distinct_dots}`);
        // Counted separately from the width it is not counted toward: N7 is the system reset dot,
        // and counting it would silently cost a 6种 buyer one of the six they paid for.
        assert.ok(keysOf(v.morning, v.evening).has(N7_KEY), 'DOT-N7 belongs to every tier');
    }
});

test('each rung names exactly the dots its width adds over the one below', () => {
    const { morning, evening } = allocation();
    const { variants } = D._buildTierLadder({
        morningRecipe: morning, eveningRecipe: evening, dotsFormulary: FORMULARY, tiers: TIERS,
    });
    assert.deepStrictEqual(variants[0].added, [], 'the base is the chart, not a rung');
    for (let i = 1; i < variants.length; i++) {
        const prev = keysOf(variants[i - 1].morning, variants[i - 1].evening);
        const cur = keysOf(variants[i].morning, variants[i].evening);
        const genuinelyNew = [...cur].filter(k => !prev.has(k));
        assert.deepStrictEqual(
            variants[i].added.map(a => a.key).sort(), genuinelyNew.sort(),
            'a rung must list the dots it actually adds, no more and no fewer');
        for (const a of variants[i].added) {
            assert.ok(a.am > 0 || a.pm > 0, `${a.key} is listed as added but takes no dose`);
        }
    }
});

test('the model chooses WHICH dots upgrade; the prefix enforces HOW MANY', () => {
    const { morning, evening } = allocation();
    // The two LEAST emphasised dots are tagged tier 1 — a judgement emphasis alone would never
    // make. They must survive into the six, and the six must still be six.
    const tierByKey = new Map([['DOT-N12', 1], ['DOT-N11', 1]]);
    const { variants } = D._buildTierLadder({
        morningRecipe: morning, eveningRecipe: evening, dotsFormulary: FORMULARY, tiers: TIERS, tierByKey,
    });
    const base = keysOf(variants[0].morning, variants[0].evening);
    assert.ok(base.has('DOT-N12') && base.has('DOT-N11'), 'a tier-1 tag must outrank emphasis');
    assert.strictEqual(D._countDistinctDots(variants[0].morning, variants[0].evening), 6);
});

test('a mis-tagged tier is corrected by construction, not trusted', () => {
    const { morning, evening } = allocation();
    // Nine dots claimed for a six-dot tier. Nothing checks this; the top-6 prefix simply takes
    // six of them, which is why no separate validation step can be forgotten.
    const tierByKey = new Map();
    for (let i = 1; i <= 9; i++) tierByKey.set(`DOT-N${i}`, 1);
    const { variants } = D._buildTierLadder({
        morningRecipe: morning, eveningRecipe: evening, dotsFormulary: FORMULARY, tiers: TIERS, tierByKey,
    });
    assert.strictEqual(D._countDistinctDots(variants[0].morning, variants[0].evening), 6);
    assert.strictEqual(D._countDistinctDots(variants[2].morning, variants[2].evening), 10);
});

test('with no tags at all — the deterministic fallback — it still ladders, on emphasis', () => {
    const { morning, evening } = allocation();
    const { variants } = D._buildTierLadder({
        morningRecipe: morning, eveningRecipe: evening, dotsFormulary: FORMULARY, tiers: TIERS,
    });
    // Emphasis descending: N1 (12/11 of its range) is the most emphasised, so the six are N1..N6.
    assert.deepStrictEqual(
        [...keysOf(variants[0].morning, variants[0].evening)].filter(k => k !== N7_KEY).sort(),
        ['DOT-N1', 'DOT-N2', 'DOT-N3', 'DOT-N4', 'DOT-N5', 'DOT-N6'].sort());
});

test('a width the allocation cannot fill is not a rung', () => {
    // Only four dots were prescribed; 8 and 10 would add nothing, and an upgrade that changes
    // nothing reads as a broken promise.
    const morning = { dots: { 'DOT-N1': 5, 'DOT-N3': 4, [N7_KEY]: 5 } };
    const evening = { dots: { 'DOT-N2': 3, 'DOT-N4': 2 } };
    const ladder = D._buildTierLadder({
        morningRecipe: morning, eveningRecipe: evening, dotsFormulary: FORMULARY, tiers: TIERS,
    });
    assert.strictEqual(ladder.variants.length, 1);
    assert.strictEqual(ladder.variants[0].max_distinct_dots, 6);
});

test('padding fills upgrade slots the formulation left empty — and never the core', () => {
    // The agentic loop curates: live dev runs came back with exactly six dots, so the wider
    // variants were identical to the base and collapsed, and no ladder appeared at all.
    const morning = { dots: { 'DOT-N1': 6, 'DOT-N3': 5, 'DOT-N5': 4, [N7_KEY]: 5 } };
    const evening = { dots: { 'DOT-N2': 6, 'DOT-N4': 5, 'DOT-N6': 4 } };
    // DOT-N7 is in the list and must be ignored: its dosing is system-controlled, so padding a
    // tier with it would spend an upgrade slot on something every tier already has.
    const pad = ['DOT-N7', 'DOT-N9', 'DOT-N10', 'DOT-N11', 'DOT-N12']
        .map(k => ({ key_name: k, count: 3 }));
    const { variants } = D._buildTierLadder({
        morningRecipe: morning, eveningRecipe: evening, dotsFormulary: FORMULARY,
        tiers: TIERS, padCandidates: pad,
    });
    assert.deepStrictEqual(variants.map(v => v.max_distinct_dots), [6, 8, 10]);
    const base = keysOf(variants[0].morning, variants[0].evening);
    // The core is the six the model actually chose; padding may only ever sit above it.
    for (const k of ['DOT-N1', 'DOT-N2', 'DOT-N3', 'DOT-N4', 'DOT-N5', 'DOT-N6']) {
        assert.ok(base.has(k), `${k} was the model's own choice and must stay in the core`);
    }
    assert.ok(!base.has('DOT-N9') && !base.has('DOT-N10') && !base.has('DOT-N11'));
    assert.ok(!keysOf(variants[2].morning, variants[2].evening).has(N7_KEY + 'x'));
    // A padded dot lands in a real slot with a real dose, not as a bare name.
    const added = variants[1].added.concat(variants[2].added);
    assert.strictEqual(added.length, 4);
    for (const a of added) assert.ok(a.am > 0 || a.pm > 0, `${a.key} was padded in with no dose`);
});

test('padding never rescues a formulation that did not fill the core itself', () => {
    // Below the narrowest tier there is no "optional addition" to make — the missing dots would be
    // core ones, and those are the model's to choose.
    const morning = { dots: { 'DOT-N1': 6, 'DOT-N3': 5, [N7_KEY]: 5 } };
    const evening = { dots: { 'DOT-N2': 6 } };
    const pad = ['DOT-N9', 'DOT-N10', 'DOT-N11'].map(k => ({ key_name: k, count: 3 }));
    const { variants } = D._buildTierLadder({
        morningRecipe: morning, eveningRecipe: evening, dotsFormulary: FORMULARY,
        tiers: TIERS, padCandidates: pad,
    });
    assert.strictEqual(variants.length, 1, 'three dots is not a core to build upgrades on');
    assert.strictEqual(D._countDistinctDots(variants[0].morning, variants[0].evening), 3);
});

test('_padCandidatesFor offers the elevated dimensions first, deterministically', () => {
    const formulary = [
        { key_name: 'DOT-N1', sub_age_target: 'Cellular Age', target_dots_min: 2, target_dots_max: 10 },
        { key_name: 'DOT-N2', sub_age_target: 'Resilience Age', target_dots_min: 2, target_dots_max: 10 },
        { key_name: 'DOT-N3', sub_age_target: 'Cellular Age', target_dots_min: 2, target_dots_max: 10 },
        { key_name: N7_KEY, sub_age_target: 'Cellular Age', target_dots_min: 0, target_dots_max: 30 },
    ];
    const bioage = { ChronoAge: 40, SubAges: { CellularAge: 44, ResilienceAge: 38 } };
    const out = D._padCandidatesFor({ dotsFormulary: formulary, bioage, recommendedKeySet: null });
    assert.deepStrictEqual(out.map(c => c.key_name), ['DOT-N1', 'DOT-N3', 'DOT-N2'],
        'dots targeting an elevated dimension come first; DOT-N7 is never offered');
    for (const c of out) assert.ok(c.count > 0, 'a candidate with no dose is not an upgrade');
});

test('no ladder from GCN, and nothing allocated, both return null', () => {
    const { morning, evening } = allocation();
    assert.strictEqual(D._buildTierLadder({
        morningRecipe: morning, eveningRecipe: evening, dotsFormulary: FORMULARY, tiers: [] }), null);
    assert.strictEqual(D._buildTierLadder({
        morningRecipe: { dots: { [N7_KEY]: 5 } }, eveningRecipe: { dots: {} },
        dotsFormulary: FORMULARY, tiers: TIERS }), null, 'DOT-N7 alone is not a formula to ladder');
});

// ── _applyTierLadder: which of the two narrowings applies ───────────────────────────────────────

test('_applyTierLadder ladders in buy mode and caps to the purchased tier otherwise', () => {
    const { morning, evening } = allocation();
    const args = { morningRecipe: morning, eveningRecipe: evening, dotsFormulary: FORMULARY, tiers: TIERS };

    const buy = D._applyTierLadder({ ...args, orderContext: { mode: 'buy', maxDistinctDots: null } });
    assert.strictEqual(buy.tierVariants.length, 3);
    assert.strictEqual(buy.rungs.length, 2, 'the base is the chart; the rungs are what it could become');
    assert.strictEqual(D._countDistinctDots(buy.morningRecipe, buy.eveningRecipe), 6);

    // A package already waiting: one tier to hit, no choice to offer, and the existing trim.
    const submit = D._applyTierLadder({ ...args, orderContext: { mode: 'submit', maxDistinctDots: 8 } });
    assert.strictEqual(submit.tierVariants, null);
    assert.deepStrictEqual(submit.rungs, []);
    assert.strictEqual(D._countDistinctDots(submit.morningRecipe, submit.eveningRecipe), 8);
});

test('_applyTierLadder with no ladder and no package leaves the allocation untouched', () => {
    const { morning, evening } = allocation();
    const out = D._applyTierLadder({
        morningRecipe: morning, eveningRecipe: evening, dotsFormulary: FORMULARY,
        tiers: [], orderContext: { mode: 'buy', maxDistinctDots: null },
    });
    assert.strictEqual(out.tierVariants, null);
    assert.deepStrictEqual(out.rungs, []);
    assert.deepStrictEqual(out.morningRecipe.dots, morning.dots);
    assert.deepStrictEqual(out.eveningRecipe.dots, evening.dots);
});

// A dot whose range is a single value (DOT-N8 明眸 and DOT-N10 肌光焕采 are both min = max = 1)
// cannot express emphasis — its count was never a choice. It used to score 1, the maximum, so it
// outranked every dot the formulator had actually prioritised and took slots in the essential
// six. Seen live 2026-09-07: 明眸 displaced a cellular dot from a base built for a user whose
// worst dimension was Cellular Age, while DOT-N6/DOT-N9 sat at their ceilings.
test('a fixed-dose dot no longer outranks a dot the formulator emphasised', () => {
    const F = [
        { key_name: 'DOT-A', name_zh: 'A', timing: 'Morning', timing_flexible: true, target_dots_min: 1, target_dots_max: 11 },
        { key_name: 'DOT-B', name_zh: 'B', timing: 'Morning', timing_flexible: true, target_dots_min: 1, target_dots_max: 11 },
        { key_name: 'DOT-C', name_zh: 'C', timing: 'Morning', timing_flexible: true, target_dots_min: 1, target_dots_max: 11 },
        // The fixed-dose dot: one value, no emphasis to read.
        { key_name: 'DOT-F', name_zh: 'F', timing: 'Morning', timing_flexible: true, target_dots_min: 1, target_dots_max: 1 },
    ];
    //        ceiling      middle      floor       forced
    const m = { dots: { 'DOT-A': 11, 'DOT-B': 6, 'DOT-C': 1, 'DOT-F': 1 } };
    const capped = D._capDistinctDots(m, { dots: {} }, F, 2);
    const kept = Object.keys(capped.morning.dots).sort();
    assert.deepStrictEqual(kept, ['DOT-A', 'DOT-B'],
        'the emphasised dot must survive the fixed-dose one, which scores neutral and loses the tie on total');
});

// ── _selectTierVariant: what the redeemed code actually buys ────────────────────────────────────

function laddered() {
    const { morning, evening } = allocation();
    const { variants } = D._buildTierLadder({
        morningRecipe: morning, eveningRecipe: evening, dotsFormulary: FORMULARY, tiers: TIERS,
    });
    return {
        morning: variants[0].morning.dots,
        evening: variants[0].evening.dots,
        tiers: variants.map(v => ({
            max_distinct_dots: v.max_distinct_dots, tier_label: v.tier_label,
            morning: v.morning.dots, evening: v.evening.dots,
        })),
    };
}

test('_selectTierVariant takes the widest formula the redeemed code covers', () => {
    const recipe = laddered();
    for (const [ordered, expected] of [[6, 6], [8, 8], [10, 10], [9, 8], [20, 10]]) {
        const sel = D._selectTierVariant(recipe, ordered);
        assert.strictEqual(sel.variant.max_distinct_dots, expected,
            `a code covering ${ordered} should compound the ${expected}-dot formula`);
        assert.strictEqual(D._countDistinctDots(sel.morning, sel.evening), expected);
    }
});

test('_selectTierVariant falls back to the base — never to the widest', () => {
    const recipe = laddered();
    // A package with no stated tier is not a purchase of the widest thing on the menu.
    assert.strictEqual(D._selectTierVariant(recipe, null).variant, null);
    assert.strictEqual(D._countDistinctDots(
        D._selectTierVariant(recipe, null).morning, D._selectTierVariant(recipe, null).evening), 6);
    // A code narrower than anything proposed. The base comes back and the CALLER refuses it — the
    // reject-never-repair rule, unchanged.
    assert.strictEqual(D._selectTierVariant(recipe, 4).variant, null);
    // A proposal made before the ladder existed.
    const legacy = { morning: { 'DOT-N1': 3 }, evening: {} };
    const sel = D._selectTierVariant(legacy, 8);
    assert.strictEqual(sel.variant, null);
    assert.deepStrictEqual(sel.morning.dots, { 'DOT-N1': 3 });
});

// ── The card ────────────────────────────────────────────────────────────────────────────────────

test('the card carries a #rung block per upgrade, and the client reads back what the server wrote', () => {
    const { morning, evening } = allocation();
    const out = D._applyTierLadder({
        morningRecipe: morning, eveningRecipe: evening, dotsFormulary: FORMULARY, tiers: TIERS,
        orderContext: { mode: 'buy', maxDistinctDots: null },
    });
    // Copy is written afterwards, by a call that is shown these exact rungs (lib/rungCopy.js).
    out.rungs[0].pitch = '把抗炎这一环补全';
    out.rungs[1].pitch = '接上最后两条通路';
    const block = D._buildFormulaChartBlock(out.morningRecipe, out.eveningRecipe, FORMULARY, 'zh', {
        planId: 38860, orderMode: 'buy', rungs: out.rungs,
    });
    const seg = mdToSegments(block.trim()).find(s => s.t === 'formula');
    assert.strictEqual(seg.rungs.length, 2);
    assert.deepStrictEqual(seg.rungs.map(r => r.label), ['8种原粒', '10种原粒']);
    assert.deepStrictEqual(seg.rungs.map(r => r.width), [8, 10]);
    assert.deepStrictEqual(seg.rungs.map(r => r.pitch), ['把抗炎这一环补全', '接上最后两条通路']);
    assert.deepStrictEqual(seg.rungs.map(r => r.items.length), [2, 2]);
    // Rung rows must not be swept into the last day group — they are not a day of the cycle.
    const dayKeys = new Set(seg.groups.flatMap(g => g.items.map(i => i.key)));
    for (const r of seg.rungs) for (const it of r.items) {
        assert.ok(!dayKeys.has(it.key), `${it.key} leaked from a rung into the chart`);
    }
    // Names are the formulary's, verbatim — the rung is server-written, like every other row.
    assert.ok(seg.rungs[0].items.every(i => /^原粒\d+号$/.test(i.name)));
});

test('a rung row carries the weeks a rotated upgrade runs in, and only then', () => {
    // A tier caps dots per WEEK, so "+2" can mean two more dots every week or the same dot for two
    // more weeks. The row says which — and stays exactly as it was for a dot that runs all four,
    // so a card written before rotation reached the rungs still parses.
    const weeks = { 'DOT-N8': [3, 4] };
    const morning = { dots: { 'DOT-N1': 6, 'DOT-N3': 5, 'DOT-N5': 4, [N7_KEY]: 5 }, weeks };
    const evening = { dots: { 'DOT-N2': 6, 'DOT-N4': 5, 'DOT-N6': 4, 'DOT-N8': 5 }, weeks };
    const out = D._applyTierLadder({
        morningRecipe: morning, eveningRecipe: evening, dotsFormulary: FORMULARY, tiers: TIERS,
        orderContext: { mode: 'buy', maxDistinctDots: null },
    });
    const block = D._buildFormulaChartBlock(out.morningRecipe, out.eveningRecipe, FORMULARY, 'zh', {
        planId: 1, orderMode: 'buy', rungs: out.rungs,
    });
    const seg = mdToSegments(block.trim()).find(s => s.t === 'formula');
    const item = seg.rungs[0].items[0];
    assert.strictEqual(item.weeks, '3,4', 'bare week numbers — the word around them is the page\'s');

    // The all-four-weeks case writes no 6th field at all.
    const flat = D._applyTierLadder({
        morningRecipe: { dots: { 'DOT-N1': 6, 'DOT-N3': 5, 'DOT-N5': 4, [N7_KEY]: 5 } },
        eveningRecipe: { dots: { 'DOT-N2': 6, 'DOT-N4': 5, 'DOT-N6': 4, 'DOT-N8': 5, 'DOT-N9': 3 } },
        dotsFormulary: FORMULARY, tiers: TIERS, orderContext: { mode: 'buy', maxDistinctDots: null },
    });
    const flatBlock = D._buildFormulaChartBlock(flat.morningRecipe, flat.eveningRecipe, FORMULARY, 'zh', {
        planId: 1, orderMode: 'buy', rungs: flat.rungs,
    });
    const flatSeg = mdToSegments(flatBlock.trim()).find(s => s.t === 'formula');
    for (const r of flatSeg.rungs) for (const it of r.items) {
        assert.strictEqual(it.weeks, '', 'a dot running every week needs no week label');
    }
});

test('a pitch is sanitised and length-capped before it reaches the card', () => {
    const { morning, evening } = allocation();
    const out = D._applyTierLadder({
        morningRecipe: morning, eveningRecipe: evening, dotsFormulary: FORMULARY, tiers: TIERS,
        orderContext: { mode: 'buy', maxDistinctDots: null },
        pitchByTier: new Map([[2, 'a|b\nc ' + 'x'.repeat(400)]]),
    });
    const block = D._buildFormulaChartBlock(out.morningRecipe, out.eveningRecipe, FORMULARY, 'zh', {
        planId: 1, orderMode: 'buy', rungs: out.rungs,
    });
    const line = block.split('\n').find(l => l.startsWith('#rung|8种原粒'));
    assert.ok(!/\r|\n/.test(line));
    const seg = mdToSegments(block.trim()).find(s => s.t === 'formula');
    assert.ok(seg.rungs[0].pitch.length <= 90, 'a pitch long enough to push the CTA off screen is cut');
    assert.ok(!seg.rungs[0].pitch.includes('|'), 'a pipe would break the row split');
});

test('a pitch naming a dot outside its own rung is dropped, not shipped', () => {
    // Found live on dev, first real run: the model narrated one split ("加配肠道焕新与脉络
    // 畅流") and tagged a different one, so the copy promised dots the rung did not hold and one
    // the formulation did not contain at all. The server owns membership; the model only owns the
    // reasoning, so a pitch that contradicts membership is dropped rather than repaired.
    const rung = { tier_label: '8种原粒', max_distinct_dots: 8, added: [{ key: 'DOT-N9', am: 2, pm: 0 }] };
    assert.strictEqual(D._rungPitch({ ...rung, pitch: '再添原粒12号，补上最后一环' }, FORMULARY), '',
        'a display name from another rung drops the pitch');
    assert.strictEqual(D._rungPitch({ ...rung, pitch: '加配12号原粒，从两路强化' }, FORMULARY), '',
        'so does the conversational key the prompt tells the model to use in prose');
    // Its own dot is fine, and so is copy that names nothing — which is what the prompt asks for.
    const own = '加配原粒9号，把这一环补全';
    assert.strictEqual(D._rungPitch({ ...rung, pitch: own }, FORMULARY), own);
    const generic = '把白天的清醒感和夜里的修复接成一条完整的线';
    assert.strictEqual(D._rungPitch({ ...rung, pitch: generic }, FORMULARY), generic);
});

test('a card with no rungs is exactly the card this produced before rungs existed', () => {
    const { morning, evening } = allocation();
    const withNone = D._buildFormulaChartBlock(morning, evening, FORMULARY, 'zh', { planId: 1, orderMode: 'buy' });
    const withEmpty = D._buildFormulaChartBlock(morning, evening, FORMULARY, 'zh', { planId: 1, orderMode: 'buy', rungs: [] });
    assert.strictEqual(withNone, withEmpty);
    assert.ok(!withNone.includes('#rung'));
    const seg = mdToSegments(withNone.trim()).find(s => s.t === 'formula');
    assert.deepStrictEqual(seg.rungs, [], 'a legacy card reads back as a card with no upgrades');
});

test('a width caps a WEEK, so a tier may run more distinct dots than its own number', () => {
    // The product rule (CLAUDE.md §28c): a 6种 buyer may take six dots this week and a partly
    // different six next week. The ladder has to preserve that, not flatten it — an earlier
    // version suppressed rotation to make nesting easy and silently narrowed what the tier means.
    const { morning, evening } = allocation();
    const weeks = { 'DOT-N1': [1, 2], 'DOT-N2': [3, 4], 'DOT-N3': [1, 3], 'DOT-N4': [2, 4] };
    const { variants } = D._buildTierLadder({
        morningRecipe: { ...morning, weeks }, eveningRecipe: { ...evening, weeks },
        dotsFormulary: FORMULARY, tiers: TIERS,
    });
    for (const v of variants) {
        assert.ok(D._countDistinctDots(v.morning, v.evening) <= v.max_distinct_dots,
            `the ${v.max_distinct_dots}-dot variant runs too many dots in some week`);
        const cycleWide = new Set([...Object.keys(v.morning.dots), ...Object.keys(v.evening.dots)]);
        cycleWide.delete(N7_KEY);
        assert.ok(cycleWide.size >= D._countDistinctDots(v.morning, v.evening),
            'the cycle-wide count is never smaller than the widest week');
    }
    // And the rotation genuinely survives into the stored variant, per tier.
    assert.ok(variants.some(v => v.morning.weeks && Object.keys(v.morning.weeks).length > 0),
        'a rotating formula must still be rotating after the ladder is built');
    // A variant that runs everything every week stores no rotation at all — _capDistinctDots
    // materialises the full membership whenever it trims, and an all-four map would make a steady
    // formula read as a rotating one.
    const steady = D._buildTierLadder({
        morningRecipe: morning, eveningRecipe: evening, dotsFormulary: FORMULARY, tiers: TIERS,
    });
    for (const v of steady.variants) {
        assert.deepStrictEqual(D._tierWeeks(v), {}, `the ${v.max_distinct_dots}-dot variant does not rotate`);
    }
});

test('nesting holds WEEK BY WEEK under rotation', () => {
    // Nesting is what makes an upgrade an upgrade. Under rotation the claim is per week: whatever
    // week 3 runs on the 6种 formula, the 8种 formula runs it in week 3 too, plus more.
    const { morning, evening } = allocation();
    const weeks = { 'DOT-N1': [1, 2], 'DOT-N2': [3, 4], 'DOT-N5': [2, 3], 'DOT-N8': [1, 4] };
    const { variants } = D._buildTierLadder({
        morningRecipe: { ...morning, weeks }, eveningRecipe: { ...evening, weeks },
        dotsFormulary: FORMULARY, tiers: TIERS,
    });
    const activeIn = (v, week) => {
        const map = D._weekMembership(v.morning, v.evening);
        const out = new Set();
        for (const k of [...Object.keys(v.morning.dots), ...Object.keys(v.evening.dots)]) {
            if (k === N7_KEY) continue;
            const w = map.get(k);
            if (!w || w.includes(week)) out.add(k);
        }
        return out;
    };
    for (let i = 1; i < variants.length; i++) {
        for (let week = 1; week <= PLAN_WEEKS; week++) {
            const narrow = activeIn(variants[i - 1], week);
            const wide = activeIn(variants[i], week);
            for (const k of narrow) {
                assert.ok(wide.has(k),
                    `week ${week}: ${k} runs on the ${variants[i - 1].max_distinct_dots}-dot formula but not the ${variants[i].max_distinct_dots}-dot one`);
            }
        }
    }
});

test('an upgrade can be a dot gaining WEEKS, not only a dot appearing', () => {
    // Seven dots against a 6-per-week cap: weeks 1-2 fit, but weeks 3-4 also carry the rotated-in
    // dot and so must drop one. The wider tier gives that dot its weeks back — which is a real
    // upgrade even though the dot is present in both formulas, and is invisible to a cycle-wide
    // set comparison.
    const weeks = { 'DOT-N8': [3, 4] };
    const morning = { dots: { 'DOT-N1': 6, 'DOT-N3': 5, 'DOT-N5': 4, [N7_KEY]: 5 }, weeks };
    const evening = { dots: { 'DOT-N2': 6, 'DOT-N4': 5, 'DOT-N6': 4, 'DOT-N8': 5 }, weeks };
    const { variants } = D._buildTierLadder({
        morningRecipe: morning, eveningRecipe: evening, dotsFormulary: FORMULARY, tiers: TIERS,
    });
    assert.strictEqual(D._countDistinctDots(variants[0].morning, variants[0].evening), 6,
        'the narrow tier must still respect six per week');
    const added = variants.slice(1).flatMap(v => v.added);
    assert.strictEqual(added.length, 1);
    assert.deepStrictEqual(added[0].weeks, [3, 4], 'the rung names the weeks it actually adds');
    assert.ok(added[0].am > 0 || added[0].pm > 0,
        'and quotes the dose from a week the dot really runs in — day 0 is week 1, where it does not');
});
