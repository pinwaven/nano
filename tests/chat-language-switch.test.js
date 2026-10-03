// _addLanguageSwitchNote: right after the menu's language switch the history is all in the old
// language, and the model copied it over the system prompt's language rule. The note goes on
// the current user turn only when the last reply is in the other language.
const assert = require('node:assert');
const test = require('node:test');
const path = require('node:path');

const WORKER = path.join(__dirname, '..', 'src', 'functions', 'worker');
const { _addLanguageSwitchNote } = require(path.join(WORKER, 'handlers', 'chat.js'));

const zhReply = { role: 'assistant', content: 'Hi Pin～秋分已过，昼夜渐均，你的身体也在悄然校准节奏。' };
const enReply = { role: 'assistant', content: 'Hi Pin — lovely to reconnect! Your sleep is improving.' };

test('switched to English after Chinese replies: the current turn carries an English note', () => {
  const h = [{ role: 'user', content: '你好' }, zhReply, { role: 'user', content: 'hi' }];
  _addLanguageSwitchNote(h, 'en');
  assert.match(h[2].content, /^\[The user has switched the app to English/);
  assert.match(h[2].content, /hi$/);
  assert.strictEqual(h[0].content, '你好', 'earlier turns are untouched');
});

test('switched to Chinese after English replies: a Chinese note', () => {
  const h = [{ role: 'user', content: 'hello' }, enReply, { role: 'user', content: '你好' }];
  _addLanguageSwitchNote(h, 'zh');
  assert.match(h[2].content, /^\[用户已把应用切换为中文/);
});

test('same language as the last reply: no note', () => {
  const h1 = [{ role: 'user', content: '你好' }, zhReply, { role: 'user', content: '再见' }];
  _addLanguageSwitchNote(h1, 'zh');
  assert.strictEqual(h1[2].content, '再见');
  const h2 = [{ role: 'user', content: 'hello' }, enReply, { role: 'user', content: 'bye' }];
  _addLanguageSwitchNote(h2, 'en');
  assert.strictEqual(h2[2].content, 'bye');
});

test('an English reply quoting a few Chinese dot names still counts as English', () => {
  const h = [{ role: 'user', content: 'dots?' },
    { role: 'assistant', content: 'Take 夜安宁 in the evening and keep the morning dose as it is for now.' },
    { role: 'user', content: 'ok' }];
  _addLanguageSwitchNote(h, 'en');
  assert.strictEqual(h[2].content, 'ok');
});

test('no previous reply, or the history ends on an assistant turn: no note', () => {
  const h1 = [{ role: 'user', content: 'hi' }];
  _addLanguageSwitchNote(h1, 'en');
  assert.strictEqual(h1[0].content, 'hi');
  const h2 = [{ role: 'user', content: 'hi' }, zhReply];
  _addLanguageSwitchNote(h2, 'en');
  assert.strictEqual(h2[1].content, zhReply.content);
});

test('a missing language means Chinese, as everywhere else', () => {
  const h = [{ role: 'user', content: 'hello' }, enReply, { role: 'user', content: 'hi' }];
  _addLanguageSwitchNote(h, null);
  assert.match(h[2].content, /^\[用户已把应用切换为中文/);
});
