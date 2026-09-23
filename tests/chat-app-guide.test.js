// The app-guide block (prompts/chat/appGuideBlock.js): an app-usage question must get the
// miniapp's real path, not an invented screen. Found live on dev 2026-09-23 — 「我的体检报告要传到哪里」
// was answered with a 「健康档案」 section and a 「联系护理师」 button that do not exist, and an
// exercise plan promised the app would draw 「HRV趋势图与呼吸同步率」.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { getAppGuideBlock } = require('../src/functions/worker/prompts/chat/appGuideBlock');

const WORKER = path.join(__dirname, '..', 'src', 'functions', 'worker');
const MINI = path.join(__dirname, '..', 'src', 'mini', 'nano-miniapp');

test('the miniapp gets the real map; every other surface gets only the rule', () => {
  const zh = getAppGuideBlock({ client: 'miniapp', isZh: true });
  assert.match(zh, /健康 → 数字孪生，页面最下方「健康文档」→「＋ 上传文档」/);
  assert.match(zh, /不要描述、不要猜测位置/);
  assert.match(getAppGuideBlock({ client: 'miniapp', isZh: false }), /"Health Records" → "＋ Upload record"/);
  for (const client of [null, undefined, 'web', 'coach']) {
    const b = getAppGuideBlock({ client, isZh: true });
    assert.doesNotMatch(b, /数字孪生/, `no miniapp map for client=${client}`);
    assert.match(b, /不要描述任何未在本提示词中给出的页面/);
  }
});

test('the labels in the map are the miniapp\'s own', () => {
  const main = fs.readFileSync(path.join(MINI, 'pages', 'main', 'main.js'), 'utf8');
  const health = fs.readFileSync(path.join(MINI, 'components', 'user-health', 'user-health.js'), 'utf8');
  const docs = fs.readFileSync(path.join(MINI, 'components', 'health-documents', 'health-documents.js'), 'utf8');
  for (const s of ["tabChat: '对话', tabHealth: '健康', tabPlans: '方案', tabStore: '补给', tabLearn: '学习'",
    "toolFormulaDots: '营养定制'", "toolTestChip: '检测服务'", "toolHealthAdvice: '健康管理'", "toolUploadImage: '上传图片'",
    "referralMenu: '邀请好友'", "phonesMenu: '手机号管理'", "vivaRedeemMenu: '兑换订阅码'", "textSizeMenu: '字体大小'"]) {
    assert.ok(main.includes(s), `main.js lost ${s}`);
  }
  for (const s of ["agTabTwin: '数字孪生'", "layerDaily: '日常监测'", "layerPrecision: 'KINO 精准检测'", "bindSmartRing: '绑定智能戒指'"]) {
    assert.ok(health.includes(s), `user-health.js lost ${s}`);
  }
  assert.ok(docs.includes("documents: '健康文档'") && docs.includes("uploadBtn: '＋ 上传文档'"));
});

test('the casual and lifestyle templates render it, and the handler tells them which client asked', () => {
  const ctx = { user_profile: { nickname: 'A', language: 'zh' }, active_health_plans: [], user_facts: [], client: 'miniapp' };
  for (const p of ['viva', 'nano']) {
    for (const t of ['casual', 'lifestyle']) {
      const out = require(path.join(WORKER, 'prompts', p, 'chat', `${t}.js`))(ctx);
      assert.match(out, /App 使用指引/, `${p} ${t}`);
    }
  }
  const chat = fs.readFileSync(path.join(WORKER, 'handlers', 'chat.js'), 'utf8');
  assert.match(chat, /client: body\.client \|\| null,/);
});
