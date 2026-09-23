// The chat templates state each Kino marker's status (lib/biomarkerStatus.js) instead of leaving
// the threshold comparison to the model. Live on dev 2026-09-23: one reply called hsCRP 1.16
// normal in prose, 偏高 in its own metric card and 升高 two paragraphs later.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { getBiomarkerStatusLine } = require('../src/functions/worker/prompts/chat/biomarkerStatusLine');

const PROMPTS = path.join(__dirname, '..', 'src', 'functions', 'worker', 'prompts');
const BM = { hsCRP: 1.16, IL6: 1.38, CD38: 2, GDF15: 536, GA: 13.5, CystatinC: 0.75 };

test('the line classifies every present marker and says to use it as given', () => {
  const zh = getBiomarkerStatusLine(BM, true);
  assert.match(zh, /hsCRP 偏高/);
  assert.match(zh, /GDF15 正常/);
  assert.match(zh, /CD38 高（正常 <1.3 倍基线）/);
  assert.match(zh, /GA 正常（正常 <15 %）/);
  assert.match(zh, /不要自行与阈值比较/);
  assert.match(getBiomarkerStatusLine(BM, false), /hsCRP elevated/);
  assert.equal(getBiomarkerStatusLine({}, true), '');
  assert.equal(getBiomarkerStatusLine(null, true), '');
});

test('every chat template that shows raw biomarker values also shows their status', () => {
  const ctx = { user_profile: { nickname: 'A', language: 'zh', age: 49 }, biomarkers: BM,
    bioage: { BioAge: 47, ChronoAge: 49, AgeDifference: -2, SubAges: {} }, active_health_plans: [], user_facts: [], dots: [] };
  for (const p of ['viva/chat/biomarker', 'viva/chat/lifestyle', 'nano/chat/biomarker', 'nano/chat/lifestyle']) {
    const out = require(path.join(PROMPTS, p))(ctx);
    assert.match(out, /hsCRP 偏高/, p);
  }
});

test('the biomarker templates handle a symptom with red flags and no invented mechanism', () => {
  // 「小腿浮肿是什么原因」 on dev 2026-09-23 got an HRV→capillary-pressure→edema chain, a kidney cause
  // "ruled out" from Cystatin C, and no warning signs — driven by a rule that asked for exactly
  // that kind of cross-source chain (睡眠不足→IL-6升高→…).
  const ctx = { user_profile: { nickname: 'A', language: 'zh', age: 49 }, biomarkers: BM,
    bioage: { BioAge: 47, ChronoAge: 49, AgeDifference: -2, SubAges: {} }, active_health_plans: [], user_facts: [], dots: [] };
  const viva = require(path.join(PROMPTS, 'viva/chat/biomarker'))(ctx);
  assert.match(viva, /用户描述症状或身体不适时/);
  assert.match(viva, /单侧腿肿伴疼痛或发红/);
  assert.match(viva, /不能诊断、也不能"排除"任何疾病/);
  assert.doesNotMatch(viva, /进行交叉分析（如睡眠不足→IL-6升高/);
  const nano = require(path.join(PROMPTS, 'nano/chat/biomarker'))({ ...ctx, user_profile: { ...ctx.user_profile, language: 'en' } });
  assert.match(nano, /When the user describes a symptom/);
  assert.match(nano, /never build a causal chain between them/);
});

test('a JUDGE hint only removes or corrects — it cannot carry new conclusions into the reply', () => {
  // Dev 2026-09-23: hints dictated a "functional driver" and a "no organ disease" sentence, and
  // REVISE pasted both (plus 「经批准的知识库条目」) into a symptom reply.
  const fs = require('node:fs');
  const judge = fs.readFileSync(path.join(PROMPTS, 'viva', 'judgeTemplate.js'), 'utf8');
  assert.match(judge, /A correction_hint names the fix, not new content/);
  const agentic = fs.readFileSync(path.join(PROMPTS, '..', 'lib', 'agenticChat.js'), 'utf8');
  assert.match(agentic, /\$\{hintBoundary\}/);
  assert.match(agentic, /never mention the fact-checker, a knowledge base/);
  const { getOutputFormatBlock } = require(path.join(PROMPTS, 'chat', 'outputFormat'));
  assert.match(getOutputFormatBlock({ isZh: true, rich: true, allow: ['takeaway'] }), /不要照抄对话历史里已经给过的要点/);
});
