// The sub-age inputs block is rendered from the calculator's own table, so a prompt can never
// tell the model a sub-age is computed from something it is not (dev 2026-09-15: 微血管年龄
// 「由血流介导的血管舒张能力、毛细血管密度推算」).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { getSubAgeInputsBlock } = require('../src/functions/worker/prompts/chat/subAgeInputsBlock');
const { DIMENSION_BIOMARKERS } = require('../src/functions/worker/lib/biomarkerStatus');

const WORKER = path.join(__dirname, '..', 'src', 'functions', 'worker');

test('every dimension and every input marker appears, labelled, in both languages', () => {
  const zh = getSubAgeInputsBlock(true);
  const en = getSubAgeInputsBlock(false);
  for (const [dim, keys] of Object.entries(DIMENSION_BIOMARKERS)) {
    assert.ok(!zh.includes(dim) && !en.includes(dim), `raw key ${dim} leaked into the block`);
    for (const k of keys) {
      const shown = { GDF15: 'GDF-15', IL6: 'IL-6', CystatinC: 'Cystatin C' }[k] || k;
      assert.ok(zh.includes(shown) && en.includes(shown), `${shown} missing`);
    }
  }
  assert.match(zh, /微血管年龄 ← Cystatin C/);
  assert.match(zh, /抗压年龄 ← hsCRP、IL-6/);
  assert.match(zh, /HRV/); // the non-inputs are named so the model knows what NOT to attribute
});

test('channel display-name overrides are honoured', () => {
  const zh = getSubAgeInputsBlock(true, { MetabolicAge: { zh: '能量年龄' } });
  assert.match(zh, /能量年龄 ← GA/);
});

test('both personas inject it into the biomarker and nutrition templates', () => {
  for (const p of ['prompts/viva/chat/biomarker.js', 'prompts/nano/chat/biomarker.js', 'prompts/viva/chat/nutrition.js', 'prompts/nano/chat/nutrition.js']) {
    const src = fs.readFileSync(path.join(WORKER, p), 'utf8');
    assert.match(src, /getSubAgeInputsBlock\(/, `${p} does not render the block`);
  }
});
