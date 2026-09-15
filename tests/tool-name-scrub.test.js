// A user never sees an internal tool name (lib/toolNameScrub.js) — dev 2026-09-15, three runs in
// a row narrated 「（`get_nutrition_schedule` 返回空数组）」 with a prompt rule against it.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { scrubToolNames } = require('../src/functions/worker/lib/toolNameScrub');
const { AGENTIC_TOOL_DEFS } = require('../src/functions/worker/lib/agenticTools');

const WORKER = path.join(__dirname, '..', 'src', 'functions', 'worker');

test('a parenthetical that only cites a tool is removed whole', () => {
  assert.strictEqual(
    scrubToolNames('已确认你当前**没有原粒方案**（`get_nutrition_schedule` 返回空数组），这非常好。'),
    '已确认你当前**没有原粒方案**，这非常好。');
  assert.strictEqual(scrubToolNames('You have no plan (get_nutrition_schedule returned []). Good.', 'en'),
    'You have no plan. Good.');
});

test('a bare mention becomes neutral wording, and every real tool name is covered', () => {
  for (const def of AGENTIC_TOOL_DEFS) {
    const name = def.function.name;
    const out = scrubToolNames(`根据 ${name} 的结果来看没问题。`);
    assert.ok(!out.includes(name), `${name} survived`);
    assert.match(out, /系统数据/);
  }
});

test('fences, ordinary parentheses and tool-free text are untouched', () => {
  const fence = ':::dots\n3号原粒 静心夜 | get_dots 不该被改\n:::';
  assert.strictEqual(scrubToolNames(fence), fence);
  const plain = '晚餐（半碗粥）请温热食用。';
  assert.strictEqual(scrubToolNames(plain), plain);
  assert.strictEqual(scrubToolNames(null), null);
});

test('every delivery site that humanizes sub-age keys also scrubs tool names', () => {
  for (const p of ['handlers/chat.js', 'handlers/dots.js']) {
    const src = fs.readFileSync(path.join(WORKER, p), 'utf8');
    const age = (src.match(/humanizeSubAgeKeys\(/g) || []).length - 1;
    const scrub = (src.match(/scrubToolNames\(/g) || []).length - 1;
    assert.equal(scrub, age, `${p}: ${age} sub-age sites but ${scrub} scrub sites`);
  }
});

test('action names and quoted field labels are internal identifiers too (dev 2026-09-15)', () => {
  assert.strictEqual(scrubToolNames('或将该安排同步至App日程（需调用 set_reminder）'), '或将该安排同步至App日程');
  assert.strictEqual(
    scrubToolNames('🔹 你有一份配方（`stage_meaning`: “还没有下单。”）；\n🔹 它已绑定配方（`formula_status`: “已经绑定了配方。”），但不对应订单。'),
    '🔹 你有一份配方；\n🔹 它已绑定配方，但不对应订单。');
  // A label outside parentheses drops with its colon, leaving the value the user should read.
  assert.strictEqual(scrubToolNames('`formula_status`: 这一份套餐已经绑定了配方。'), '这一份套餐已经绑定了配方。');
  // Single words, units and biomarker names are not identifiers.
  const plain = 'hsCRP 0.32 mg/L，GA 13.2%，白露节气，set reminder tomorrow';
  assert.strictEqual(scrubToolNames(plain), plain);
});

test('a backticked code span quoting machine state goes whole; a plain emphasised name stays', () => {
  assert.strictEqual(scrubToolNames('原粒4号 是唯一被标记为 `timing_flexible=false` 的晨间原粒'), '原粒4号 是唯一被标记为 系统数据 的晨间原粒');
  assert.strictEqual(scrubToolNames("在配方库中标注为 `timing='Evening'`，其芽孢杆菌…"), '在配方库中标注为 系统数据，其芽孢杆菌…');
  assert.strictEqual(scrubToolNames('推荐 `静心夜` 和 `豆腐`'), '推荐 `静心夜` 和 `豆腐`');
});

const { dropForeignLines } = require('../src/functions/worker/lib/toolNameScrub');
test('dropForeignLines removes an all-English line from a zh reply and nothing else', () => {
  const text = '### ✅ 一、原粒是否为素食？\n**No matched knowledge base entries exist for vegetarian or plant-based capsule formulation claims.**\n- 配方库中仅提供活性成分名称与剂量。\n\n| GA | 13.2% |\n|----|-------|\n:::takeaway\nKeep this fence line exactly as it is written here.\n:::\nhsCRP 0.32 mg/L 正常。';
  const out = dropForeignLines(text, 'zh');
  assert.ok(!out.includes('No matched knowledge base'));
  assert.ok(out.includes('| GA | 13.2% |') && out.includes('|----|-------|'), 'table rows stay');
  assert.ok(out.includes('Keep this fence line exactly as it is written here.'), 'fence content stays');
  assert.ok(out.includes('hsCRP 0.32 mg/L 正常。'));
  assert.strictEqual(dropForeignLines(text, 'en'), text, 'an English user keeps everything');
  assert.strictEqual(dropForeignLines('Vitamin D3, HPMC', 'zh'), 'Vitamin D3, HPMC', 'short Latin runs are not a foreign line');
});

const { localizeStatusWords } = require('../src/functions/worker/lib/toolNameScrub');
test('a bare English status label in a zh reply is localised, inside metric cards and prose; sentences are not', () => {
  const text = ':::metric\nhsCRP | 1.16 | mg/L | elevated\nCD38 | 2.0 | x baseline | high\n睡眠 | 5.4 | h | 偏低\n:::\n您的 CD38 high（2.0倍基线）与 hsCRP elevated（1.16 mg/L）。\nThe high road is normal here, and that is good.\n海拔 high 的地方';
  const out = localizeStatusWords(text, 'zh');
  assert.match(out, /hsCRP \| 1\.16 \| mg\/L \| 偏高/);
  assert.match(out, /CD38 \| 2\.0 \| 倍基线 \| 偏高/);
  assert.match(out, /CD38 偏高（2\.0倍基线）与 hsCRP 偏高（1\.16 mg\/L）/);
  assert.ok(out.includes('The high road is normal here, and that is good.'), 'an English sentence is left alone');
  assert.strictEqual(localizeStatusWords(text, 'en'), text);
});
