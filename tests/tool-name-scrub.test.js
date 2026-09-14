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
