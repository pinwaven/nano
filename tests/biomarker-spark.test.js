// Unit tests for the chat tab's metric-tile sparklines (utils/biomarker-series.js).
//
// The series is built entirely client-side from the user's own biomarker history precisely so a
// trend cannot be fabricated by the model — verifyBiomarkerGrounding only ever compares a reply
// against the LATEST snapshot, so an invented history has nothing to fail against. These tests
// therefore care most about the two ways that guarantee could quietly rot: a label resolving to
// the wrong biomarker, and a series being assembled from the wrong source rows.
const assert = require('node:assert');
const test = require('node:test');
const path = require('node:path');

const {
  KEYS, BETTER_LOW, SPARK_BARS,
  resolveBiomarkerKey, buildSeriesIndex, buildSpark, sparkForLabel, appendReading,
} = require(path.join(__dirname, '..', 'src', 'mini', 'nano-miniapp', 'utils', 'biomarker-series.js'));

const rec = (testedAt, validated, testType) => ({
  test_type: testType || 'kino_chip',
  tested_at: testedAt,
  data: { validated, actual: { hsCRP: 999 } },
});

// ── label resolution ────────────────────────────────────────────────────────

test('resolves every label the app itself renders (t.bmLabels, both languages)', () => {
  const zh = { 'hs-CRP': 'hsCRP', 'GDF-15': 'GDF15', 'IL-6': 'IL6', '糖化白蛋白': 'GA', '胱抑素 C': 'CystatinC', 'CD38': 'CD38' };
  const en = { 'hs-CRP': 'hsCRP', 'GDF-15': 'GDF15', 'IL-6': 'IL6', 'Glycated Albumin': 'GA', 'Cystatin C': 'CystatinC', 'CD38': 'CD38' };
  for (const [label, key] of Object.entries({ ...zh, ...en })) {
    assert.strictEqual(resolveBiomarkerKey(label), key, `"${label}" should resolve to ${key}`);
  }
});

test('resolves the "<Chinese name> (<abbrev>)" shape the prompts actually emit', () => {
  assert.strictEqual(resolveBiomarkerKey('糖化白蛋白 (GA)'), 'GA');
  assert.strictEqual(resolveBiomarkerKey('胱抑素 C (Cystatin C)'), 'CystatinC');
  assert.strictEqual(resolveBiomarkerKey('超敏C反应蛋白 (hsCRP)'), 'hsCRP');
  assert.strictEqual(resolveBiomarkerKey('白介素-6'), 'IL6');
});

test('a short alias never matches as a substring', () => {
  // 'ga' is 2 chars: substring matching would pull it out of any of these.
  for (const label of ['Omega-3', 'Vegan protein', 'GABA']) {
    assert.strictEqual(resolveBiomarkerKey(label), null, `"${label}" must not resolve`);
  }
});

test('bare CRP does NOT resolve to hsCRP', () => {
  // systemHealthReport.js treats CRP and hsCRP as separate markers; attaching hsCRP history to a
  // tile labelled CRP would be showing the user a different assay's trend.
  assert.strictEqual(resolveBiomarkerKey('CRP'), null);
});

test('unknown / empty labels resolve to null rather than throwing', () => {
  for (const label of ['', null, undefined, '   ', 'Blood pressure', '体重']) {
    assert.strictEqual(resolveBiomarkerKey(label), null);
  }
});

// ── series index ────────────────────────────────────────────────────────────

test('reads data.validated and never data.actual', () => {
  // The fixture's actual.hsCRP is 999; validated is 1.2. Per CLAUDE.md §17 actual can sit outside
  // the plausible range the stored BioAge was computed against.
  const idx = buildSeriesIndex([rec('2026-01-01', { hsCRP: 1.2 })]);
  assert.deepStrictEqual(idx.hsCRP.map((p) => p.v), [1.2]);
});

test('only kino_chip rows enter the series', () => {
  const idx = buildSeriesIndex([
    rec('2026-01-01', { hsCRP: 1.0 }),
    rec('2026-02-01', { hsCRP: 9.9 }, 'lab_import'),
    rec('2026-03-01', { hsCRP: 1.4 }),
  ]);
  assert.deepStrictEqual(idx.hsCRP.map((p) => p.v), [1.0, 1.4], 'lab_import is a different assay');
});

test('rows are sorted oldest-first regardless of input order', () => {
  const idx = buildSeriesIndex([
    rec('2026-03-01', { GA: 16 }),
    rec('2026-01-01', { GA: 13 }),
    rec('2026-02-01', { GA: 14 }),
  ]);
  assert.deepStrictEqual(idx.GA.map((p) => p.v), [13, 14, 16]);
});

test('null, empty and non-numeric readings are skipped, not coerced to 0', () => {
  const idx = buildSeriesIndex([
    rec('2026-01-01', { hsCRP: 1.0, IL6: null }),
    rec('2026-02-01', { hsCRP: '', IL6: 'n/a' }),
    rec('2026-03-01', { hsCRP: 1.4, IL6: 2 }),
  ]);
  assert.deepStrictEqual(idx.hsCRP.map((p) => p.v), [1.0, 1.4]);
  assert.deepStrictEqual(idx.IL6.map((p) => p.v), [2]);
});

test('malformed records are tolerated', () => {
  assert.deepStrictEqual(buildSeriesIndex(null), {});
  assert.deepStrictEqual(buildSeriesIndex([null, {}, { test_type: 'kino_chip' }, rec('x', null)]), {});
});

// ── spark shape ─────────────────────────────────────────────────────────────

const series = (...vals) => vals.map((v, i) => ({ v, t: i }));

test('a single reading produces no sparkline', () => {
  assert.strictEqual(buildSpark(series(1.2), true), null);
  assert.strictEqual(buildSpark([], true), null);
  assert.strictEqual(buildSpark(undefined, true), null);
});

test('the window is capped at SPARK_BARS and keeps the NEWEST readings', () => {
  const s = buildSpark(series(...Array.from({ length: 20 }, (_, i) => i + 1)), true);
  assert.strictEqual(s.bars.length, SPARK_BARS);
  assert.strictEqual(s.n, SPARK_BARS);
  // last window value is 20, first is 13 -> tallest bar is last
  assert.strictEqual(s.bars[s.bars.length - 1].h, 100);
  assert.strictEqual(s.bars[0].h, 16);
});

test('exactly one bar is flagged as the last', () => {
  const s = buildSpark(series(1, 2, 3), true);
  assert.strictEqual(s.bars.filter((b) => b.last).length, 1);
  assert.ok(s.bars[s.bars.length - 1].last);
});

test('bar heights stay within the renderable 16-100% band', () => {
  const s = buildSpark(series(0.1, 5, 0.2, 3, 0.9), true);
  for (const b of s.bars) {
    assert.ok(b.h >= 16 && b.h <= 100, `bar height ${b.h} out of band`);
  }
});

test('a near-constant series renders level bars instead of amplifying noise', () => {
  // 1.000 -> 1.005 is 0.5% of range; min-max normalising it would draw a full-height staircase.
  const s = buildSpark(series(1.0, 1.005, 1.002, 1.004), true);
  assert.strictEqual(new Set(s.bars.map((b) => b.h)).size, 1, 'all bars should be level');
  assert.strictEqual(s.dir, 'flat');
  assert.strictEqual(s.delta, '', 'a flat trend must not render a delta label');
});

test('an all-identical series does not divide by zero', () => {
  const s = buildSpark(series(2, 2, 2), true);
  assert.ok(s.bars.every((b) => Number.isFinite(b.h)));
  assert.strictEqual(s.dir, 'flat');
});

// ── direction and tone ──────────────────────────────────────────────────────

test('a rising lower-is-better marker reads as a BAD trend', () => {
  const s = buildSpark(series(1.0, 1.2, 1.8), true);
  assert.strictEqual(s.dir, 'up');
  assert.strictEqual(s.tone, 'bad');
  assert.strictEqual(s.arrow, '↑');
  assert.strictEqual(s.delta, '+80%');
});

test('a falling lower-is-better marker reads as a GOOD trend', () => {
  const s = buildSpark(series(2.0, 1.5, 1.0), true);
  assert.strictEqual(s.dir, 'down');
  assert.strictEqual(s.tone, 'good');
  assert.strictEqual(s.arrow, '↓');
  assert.strictEqual(s.delta, '-50%');
});

test('betterLow=false inverts the tone, not the direction', () => {
  const up = buildSpark(series(1.0, 2.0), false);
  assert.strictEqual(up.dir, 'up');
  assert.strictEqual(up.tone, 'good', 'rising is an improvement when higher is better');
  const down = buildSpark(series(2.0, 1.0), false);
  assert.strictEqual(down.dir, 'down');
  assert.strictEqual(down.tone, 'bad');
});

test('a sub-threshold move reports no direction', () => {
  const s = buildSpark(series(100, 101), true); // +1%, under FLAT_DELTA_PCT
  assert.strictEqual(s.dir, 'flat');
  assert.strictEqual(s.tone, 'flat');
  assert.strictEqual(s.delta, '');
});

test('delta is measured across the WINDOW, not the whole history', () => {
  // 20 points: the window is the last 8 (13..20), so the delta is 20/13, not 20/1.
  const s = buildSpark(series(...Array.from({ length: 20 }, (_, i) => i + 1)), true);
  assert.strictEqual(s.delta, '+54%'); // (20-13)/13
});

test('a zero first value yields no delta rather than Infinity', () => {
  const s = buildSpark(series(0, 5), true);
  assert.strictEqual(s.delta, '');
  assert.strictEqual(s.dir, 'flat');
});

// ── every canonical key is covered ──────────────────────────────────────────

test('every key in KEYS has aliases and a BETTER_LOW entry', () => {
  for (const k of KEYS) {
    assert.strictEqual(resolveBiomarkerKey(k), k, `canonical key "${k}" must resolve to itself`);
    assert.strictEqual(typeof BETTER_LOW[k], 'boolean', `${k} missing from BETTER_LOW`);
  }
});

test('all six Kino markers are lower-is-better, per CLAUDE.md §11', () => {
  // Every §11 reference range is an upper bound. If a marker where higher is better is ever
  // added, this test should be updated deliberately rather than the map silently inheriting true.
  assert.deepStrictEqual(KEYS.filter((k) => !BETTER_LOW[k]), []);
});

// ── end-to-end ──────────────────────────────────────────────────────────────

test('sparkForLabel joins a model-written label to real history', () => {
  const idx = buildSeriesIndex([
    rec('2026-01-01', { GA: 13.2 }),
    rec('2026-02-01', { GA: 14.2 }),
    rec('2026-03-01', { GA: 16.5 }),
  ]);
  const s = sparkForLabel(idx, '糖化白蛋白');
  assert.strictEqual(s.n, 3);
  assert.strictEqual(s.tone, 'bad');
  assert.strictEqual(s.delta, '+25%');
});

test('an unresolvable label yields no sparkline instead of a wrong one', () => {
  const idx = buildSeriesIndex([rec('2026-01-01', { GA: 13 }), rec('2026-02-01', { GA: 16 })]);
  assert.strictEqual(sparkForLabel(idx, 'Omega-3'), null);
  assert.strictEqual(sparkForLabel(idx, 'CRP'), null);
  assert.strictEqual(sparkForLabel(null, '糖化白蛋白'), null);
});

test('a resolvable label with no history yields no sparkline', () => {
  const idx = buildSeriesIndex([rec('2026-01-01', { GA: 13 }), rec('2026-02-01', { GA: 16 })]);
  assert.strictEqual(sparkForLabel(idx, 'hs-CRP'), null, 'GA-only history must not colour an hsCRP tile');
});

test('appendReading folds a fresh scan in without a refetch', () => {
  const idx = buildSeriesIndex([rec('2026-01-01', { hsCRP: 1.0 }), rec('2026-02-01', { hsCRP: 1.1 })]);
  appendReading(idx, { hsCRP: 2.0, IL6: 3.0 }, '2026-03-01');
  assert.deepStrictEqual(idx.hsCRP.map((p) => p.v), [1.0, 1.1, 2.0]);
  assert.deepStrictEqual(idx.IL6.map((p) => p.v), [3.0], 'a key with no prior history is created');
  assert.strictEqual(sparkForLabel(idx, 'hs-CRP').delta, '+100%');
});

test('appendReading is a no-op on a missing index or payload', () => {
  assert.doesNotThrow(() => appendReading(null, { hsCRP: 1 }));
  assert.doesNotThrow(() => appendReading({}, null));
});
