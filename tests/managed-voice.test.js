// Managed customers (CLAUDE.md §49) are written ABOUT, to their coach — lib/managedVoice.js.
// The kino function carries a copy of scanResultMessage; the two must say the same thing.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');

const { scanResultMessage, managedVoiceBlock, isManaged } = require('../src/functions/worker/lib/managedVoice');

test('regular users are still addressed as 您 / you, unchanged', () => {
  assert.match(scanResultMessage(61.44, { language: 'zh' }), /^已完成生物标志物检测分析。您的生理年龄为 \*\*61\.4 岁\*\*/);
  assert.match(scanResultMessage(61.44, { language: 'en' }), /Your biological age is \*\*61\.4 years\*\*/);
  assert.equal(managedVoiceBlock({ account_type: 'regular' }), '');
  assert.equal(managedVoiceBlock(null), '');
});

test('a managed customer is written about, by name, never as 您', () => {
  const zh = scanResultMessage(61.44, { language: 'zh', account_type: 'managed', nickname: '王芳' });
  assert.match(zh, /王芳/);
  assert.match(zh, /其生理年龄为 \*\*61\.4 岁\*\*/);
  assert.doesNotMatch(zh, /您/);
  assert.match(scanResultMessage(60, { account_type: 'managed' }), /该客户/);
  assert.match(scanResultMessage(60, { language: 'en', account_type: 'managed', nickname: 'Ann' }), /for Ann: their biological age/);
});

test('the prompt block tells the model who reads it; the chat turn adds the coach-asked part', () => {
  const report = managedVoiceBlock({ account_type: 'managed', nickname: '王芳' });
  const asked = managedVoiceBlock({ account_type: 'managed', nickname: '王芳' }, { asked: true });
  assert.match(report, /由教练阅读/);
  assert.match(report, /不要用"您"称呼客户/);
  assert.match(asked, /你正在与该客户的健康教练对话/);
  assert.match(asked, /直接回答教练的问题/);
  assert.match(managedVoiceBlock({ account_type: 'managed', language: 'en' }), /never as "you"/);
  assert.equal(isManaged({ account_type: 'managed' }), true);
});

test('the kino function sends the same scan line as the worker', () => {
  for (const k of Object.keys(require.cache)) if (k.includes('/src/functions/kino/')) delete require.cache[k];
  const dbPath = path.resolve(__dirname, '../src/functions/kino/lib/db.js');
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { pool: { query: async () => ({ rows: [] }) } } };
  const src = require('fs').readFileSync(path.resolve(__dirname, '../src/functions/kino/lib/deviceHandlers.js'), 'utf8');
  const fnSrc = src.slice(src.indexOf('function scanResultMessage('), src.indexOf('async function resolveOrUpsertUser('));
  const kinoScan = new Function(`${fnSrc}; return scanResultMessage;`)();
  for (const user of [{ language: 'zh' }, { language: 'en' }, { language: 'zh', account_type: 'managed', nickname: '王芳' },
                      { language: 'en', account_type: 'managed' }, { account_type: 'managed' }]) {
    assert.equal(kinoScan(58.25, user), scanResultMessage(58.25, user), JSON.stringify(user));
  }
});
