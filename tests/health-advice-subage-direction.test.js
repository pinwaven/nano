// The health-advice report once summarized a sub-age 7.1 years YOUNGER than chronological age as
// "明显偏高", because a marker feeding it was tagged 偏高 and the model worked out the direction
// itself. The direction is now computed in code (lib/subAgeLabels.js relationToChrono) and stated
// in both templates; these pin that the prompt says it, for both personas and both languages.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');

const W = path.resolve(__dirname, '../src/functions/worker');
const { relationToChrono } = require(path.join(W, 'lib/subAgeLabels.js'));

const ctx = {
  isZh: true, nickname: '李测试', age: 51, gender: 'female', bioAge: 50.5, chronoAge: 51,
  subAges: { ResilienceAge: 43.9, CellularAge: 56.7, MetabolicAge: 41.6, MicroVascularAge: 51.2 },
  biomarkers: { hsCRP: 1.04, IL6: 1.54, GDF15: 600, CD38: 2.3, GA: 14, CystatinC: 0.8 },
  dotsByDimension: {}, healthConditions: [], healthConditionsOther: '', plan_templates: [],
  active_health_plans: [], user_facts: [], now_iso: '2026-09-23T10:00:00+08:00',
};

test('relationToChrono: older / younger / about the same (±0.5)', () => {
  assert.deepEqual(relationToChrono(56.7, 51, 'zh'), { diff: 5.7, direction: 'older', text: '比实际年龄老 5.7 岁' });
  assert.equal(relationToChrono(43.9, 51, 'zh').direction, 'younger');
  assert.equal(relationToChrono(43.9, 51, 'zh').text, '比实际年龄年轻 7.1 岁');
  assert.equal(relationToChrono(51.2, 51, 'en').direction, 'equal');
  assert.equal(relationToChrono(null, 51, 'zh').direction, null);
});

for (const persona of ['viva', 'nano']) {
  test(`${persona}: the verdict line lists each dimension on the right side`, () => {
    const tpl = require(path.join(W, `prompts/${persona}/systemHealthAdvice.js`));
    const p = tpl(ctx);
    const line = p.split('\n').find(l => l.startsWith('各维度与实际年龄对比'));
    assert.ok(line, 'verdict line present');
    const [older, rest] = line.split('年轻于实际年龄、表现良好');
    assert.match(older, /细胞年龄/);
    assert.doesNotMatch(older, /抗压年龄/, 'a younger dimension is never on the elevated side');
    assert.match(rest, /抗压年龄.*代谢年龄/);
    assert.match(rest, /基本持平 — 微血管年龄/);
    assert.match(p, /抗压年龄：43\.9 岁（比实际年龄年轻 7\.1 岁，该维度表现良好）/);
    assert.match(p, /不得称该维度偏高/);
  });
}

test('nano English: the same verdict, and no ambiguous "ahead / lagging"', () => {
  const p = require(path.join(W, 'prompts/nano/systemHealthAdvice.js'))({ ...ctx, isZh: false });
  assert.match(p, /OLDER, needs attention — Cellular Age \(\+5\.7\); YOUNGER, doing well — Resilience Age \(-7\.1\), Metabolic Age \(-9\.4\)/);
  assert.match(p, /never as an elevated dimension/);
  assert.doesNotMatch(p, /ahead, on-track, or lagging/);
});

// A report blamed hsCRP (a Resilience input) for an elevated Micro-Vascular Age whose own input
// was normal. Both templates now state each dimension's inputs — from DIMENSION_BIOMARKERS, the map
// the misattribution check (lib/factCheck.js) also uses — and forbid cross-dimension links.
const { DIMENSION_BIOMARKERS } = require(path.join(W, 'lib/biomarkerStatus.js'));

for (const persona of ['viva', 'nano']) {
  test(`${persona}: each dimension's inputs are stated from DIMENSION_BIOMARKERS, with the cross-link ban`, () => {
    const p = require(path.join(W, `prompts/${persona}/systemHealthAdvice.js`))(ctx);
    assert.match(p, /每个子年龄只由以下标志物计算——抗压年龄：hsCRP、IL-6；细胞年龄：GDF-15、CD38；代谢年龄：糖化白蛋白 \(GA\)；微血管年龄：胱抑素 C。/);
    assert.match(p, /包括"可能与……有关\/相关"这类推测性表述/);
    assert.match(p, /不要借用其他维度的标志物/);
  });
}

test('the stated inputs are exactly the scoring map (a change there must reach the prompt)', () => {
  assert.deepEqual(DIMENSION_BIOMARKERS, {
    CellularAge: ['GDF15', 'CD38'], MetabolicAge: ['GA'], MicroVascularAge: ['CystatinC'], ResilienceAge: ['hsCRP', 'IL6'],
  });
  const en = require(path.join(W, 'prompts/nano/systemHealthAdvice.js'))({ ...ctx, isZh: false });
  assert.match(en, /Micro-Vascular Age: Cystatin C\./);
  assert.match(en, /never be presented as a cause of, contributor to, or something "possibly related to"/);
});
