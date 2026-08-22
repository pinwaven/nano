// Pins the deterministic half of the JUDGE pipeline.
//
// Context: JUDGE was rejecting drafts whose every checkable value was correct. Live sampling
// 2026-08-22 on two real health-advice drafts — all six biomarker values matching ground truth,
// zero deterministic detector hits — produced 10 violations and REJECT on both. Every REJECT
// costs a ~70s REVISE round and rewrites a correct reply into a worse one.
//
// The fix moved the categories a machine can decide OUT of the model's hands:
// detectDimensionMisattribution + detectDotNameMismatch are authoritative, and their findings are
// injected as violations regardless of what the model said. What the model reports for those
// categories is discarded. These tests cover that deterministic layer; the prompt-side changes
// are measured separately by the offline eval, not here.
const assert = require('node:assert');
const test = require('node:test');
const path = require('node:path');

const WORKER = path.join(__dirname, '..', 'src', 'functions', 'worker');
const { detectDimensionMisattribution } = require(path.join(WORKER, 'lib', 'factCheck.js'));
const { DIMENSION_BIOMARKERS } = require(path.join(WORKER, 'lib', 'biomarkerStatus.js'));
const { sanitizeJudgeVerdict } = require(path.join(WORKER, 'lib', 'agenticChat.js'));

const D = DIMENSION_BIOMARKERS;
const dims = (t) => detectDimensionMisattribution(t, D).map(m => `${m.dimension}<-${m.biomarker}`);

// ── detectDimensionMisattribution ───────────────────────────────────────────

test('flags a biomarker attributed to a dimension it does not feed', () => {
  assert.deepStrictEqual(dims('微血管年龄偏高，核心驱动是CD38（1.5x）。'), ['MicroVascularAge<-CD38']);
  assert.deepStrictEqual(dims('你的抗压年龄升高主要由 GA（糖化白蛋白）导致。'), ['ResilienceAge<-GA']);
  assert.deepStrictEqual(dims('Your Metabolic Age is driven by elevated hsCRP.'), ['MetabolicAge<-hsCRP']);
});

test('does NOT flag a correct attribution', () => {
  assert.deepStrictEqual(dims('抗压年龄的核心驱动是 hsCRP（1.8 mg/L，偏高）。'), []);
  assert.deepStrictEqual(dims('代谢年龄由糖化白蛋白 GA 计算得出。'), []);
  assert.deepStrictEqual(dims('Cellular Age is driven by CD38 and GDF-15.'), []);
});

test('does NOT flag naming a dimension\'s own normal biomarker', () => {
  // The sub-age is a continuous score, so "elevated dimension, normal marker" is expected —
  // this exact sentence shape was one of the most-repeated false positives.
  assert.deepStrictEqual(dims('尽管胱抑素C（0.85 mg/L）在正常范围，微血管年龄仍偏高，主导因素仍是该指标。'), []);
});

test('stays silent without a strong causal claim', () => {
  // "影响"/"关联" are everywhere and mean little; co-mention is not attribution.
  assert.deepStrictEqual(dims('你的微血管年龄偏高。另外 CD38 为 1.5x。'), []);
  assert.deepStrictEqual(dims('微血管年龄与 CD38 可能存在关联。'), []);
});

test('skips ambiguous prose naming two dimensions at once', () => {
  assert.deepStrictEqual(dims('细胞年龄与微血管年龄的核心驱动是 CD38。'), []);
});

test('GA matching does not fire on unrelated tokens', () => {
  assert.deepStrictEqual(dims('抗压年龄的核心驱动是 GABA 水平。'), []);
});

// ── sanitizeJudgeVerdict ────────────────────────────────────────────────────

const GT = (over = {}) => ({ dimension_misattribution_found: [], dot_mismatch_found: [], ...over });
const run = (v, gt = GT(), hits = []) => sanitizeJudgeVerdict(v, gt, hits).result;

test('a real biomarker mismatch still rejects', () => {
  const r = run({ verdict: 'REJECT', violations: [
    { category: 'biomarker_mismatch', severity: 'material', detail: 'states 6.4, ground truth shows 1.8', correction_hint: 'use 1.8' }] });
  assert.strictEqual(r.verdict, 'REJECT');
});

test('the model\'s own dimension_misattribution is always discarded', () => {
  const r = run({ verdict: 'REJECT', violations: [
    { category: 'dimension_misattribution', severity: 'material', detail: 'CD38 drives MicroVascularAge', correction_hint: 'remove' }] });
  assert.strictEqual(r.verdict, 'PASS', 'the deterministic scan owns this category');
});

test('a scan-detected misattribution is injected even when the model reported nothing', () => {
  const gt = GT({ dimension_misattribution_found: [{ dimension: 'MicroVascularAge', biomarker: 'CD38', allowed: ['CystatinC'], quote: 'q' }] });
  const r = run({ verdict: 'PASS', violations: [] }, gt);
  assert.strictEqual(r.verdict, 'REJECT');
  assert.strictEqual(r.violations.length, 1);
  assert.match(r.violations[0].correction_hint, /CystatinC/);
});

test('a scan-detected dot mismatch is injected even when the model reported nothing', () => {
  const gt = GT({ dot_mismatch_found: [{ num: 3, claimedName: '极光胶囊', realName: '静心夜' }] });
  const r = run({ verdict: 'PASS', violations: [] }, gt);
  assert.strictEqual(r.verdict, 'REJECT');
  assert.match(r.violations[0].detail, /静心夜/);
});

test('a dot that does not exist at all is reported as such', () => {
  const gt = GT({ dot_mismatch_found: [{ num: 99, claimedName: '幻影', realName: null }] });
  assert.match(run({ verdict: 'PASS', violations: [] }, gt).violations[0].correction_hint, /no dot 99/i);
});

test('an LLM dot_mismatch is dropped unless a deterministic dot check agrees', () => {
  const v = { verdict: 'REJECT', violations: [
    { category: 'dot_mismatch', severity: 'material', detail: 'correctly mapped, WHILE the described mechanism...', correction_hint: 'reword' }] };
  assert.strictEqual(run(v).verdict, 'PASS', 'no dot detector hit -> wording objection, not a fact');
  assert.strictEqual(run(v, GT(), ['dotNameMismatch']).verdict, 'REJECT', 'corroborated -> kept');
});

test('minor severity never rejects on its own', () => {
  assert.strictEqual(run({ verdict: 'REJECT', violations: [
    { category: 'unsupported_science_claim', severity: 'minor', detail: 'could hedge more', correction_hint: 'hedge' }] }).verdict, 'PASS');
});

test('a violation whose own detail says the draft is correct is dropped', () => {
  for (const detail of [
    "Draft states 'hsCRP 1.8 mg/L' — matches ground truth. Correct.",
    'This was a false positive — disregard.',
    'So this is grounded. No violation.',
  ]) {
    assert.strictEqual(run({ verdict: 'REJECT', violations: [
      { category: 'biomarker_mismatch', severity: 'material', detail, correction_hint: '' }] }).verdict, 'PASS', detail);
  }
});

test('a self-negating detail with a REAL fix is kept', () => {
  // The phrase alone must not drop a row: a genuine violation can discuss a neighbouring clause
  // it decided was fine. A real fix in correction_hint is the discriminator.
  const r = run({ verdict: 'REJECT', violations: [{
    category: 'biomarker_mismatch', severity: 'material',
    detail: 'GA matches ground truth. Correct. However hsCRP is stated as 6.4.',
    correction_hint: 'hsCRP is 1.8 mg/L, not 6.4.' }] });
  assert.strictEqual(r.verdict, 'REJECT');
});

test('PASS stays PASS and carries no violations', () => {
  assert.deepStrictEqual(run({ verdict: 'PASS', violations: [] }), { verdict: 'PASS', violations: [] });
});

// ── extractDateMentions ─────────────────────────────────────────────────────
// The prompts hand the model the current date and have it open with "今天是<date>", so an
// unfiltered date scan reported a tested_at mismatch on essentially every reply — costing an
// unconditional ~40s grounding-retry LLM call per turn.
const { extractDateMentions } = require(path.join(WORKER, 'handlers', 'chat.js'));

test('a date introduced as TODAY is not read as the test date', () => {
  assert.deepStrictEqual(extractDateMentions('今天是2026年8月22日，正值立秋节气。'), []);
  assert.deepStrictEqual(extractDateMentions('Today is 2026-08-22.'), []);
});

test('a real test date is still extracted', () => {
  assert.deepStrictEqual(extractDateMentions('你的检测日期为2026年8月18日。'), ['2026-08-18']);
  assert.deepStrictEqual(extractDateMentions('上次检测 2026-08-01 的结果显示…'), ['2026-08-01']);
});

test('today and the test date in one reply yields only the test date', () => {
  assert.deepStrictEqual(
    extractDateMentions('今天是2026年8月22日。你的检测日期为2026年8月18日。'),
    ['2026-08-18']);
});
