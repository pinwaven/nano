// Guards for the ::: display-card markers (prompts/chat/outputFormat.js) against the reply
// post-processing that already existed. These markers are new text in the model's output, and
// several pre-existing checks parse that text with line-oriented regexes — this pins down that
// they still behave.
const assert = require('node:assert');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const WORKER = path.join(__dirname, '..', 'src', 'functions', 'worker');
const { stripTrailingQuestion } = require(path.join(WORKER, 'handlers', 'chat.js'));
const factCheck = require(path.join(WORKER, 'lib', 'factCheck.js'));
const { getOutputFormatBlock } = require(path.join(WORKER, 'prompts', 'chat', 'outputFormat.js'));

const METRIC = ':::metric\nGDF-15 | 1240 | pg/mL | 偏高\nhsCRP | 0.8 | mg/L | 正常\n:::';
const DOTS = ':::dots\n12号原粒 夜安宁 | 2粒/晚\n:::';

// ── stripTrailingQuestion ───────────────────────────────────────────────────

test('a reply ending in a closing fence is left alone', () => {
  const text = `你的炎症水平稳定。\n\n${METRIC}`;
  assert.strictEqual(stripTrailingQuestion(text), text);
});

test('an invitation INSIDE a takeaway block is still stripped', () => {
  // Before the fence-awareness fix the regex (which excludes \n) made `last` the literal ":::",
  // so this sailed straight through the backstop.
  const text = '你的炎症水平稳定。\n\n:::takeaway\n需要我帮你把复测安排进日程吗？\n:::';
  const out = stripTrailingQuestion(text);
  assert.doesNotMatch(out, /需要我帮你/, 'the invitation must be removed');
  assert.match(out, /炎症水平稳定/, 'the real content must survive');
});

test('a trailing question with no fence still strips (unchanged behaviour)', () => {
  const out = stripTrailingQuestion('你的炎症水平稳定。要我帮你安排复测吗？');
  assert.doesNotMatch(out, /要我帮你/);
});

test('a directive statement in a takeaway is NOT stripped', () => {
  const text = '你的炎症水平稳定。\n\n:::takeaway\n把晚间屏幕时间提前 30 分钟，8 周后复测。\n:::';
  assert.match(stripTrailingQuestion(text), /屏幕时间/);
});

test('a decimal inside a metric row does not fragment the sentence split', () => {
  const text = `代谢年龄 41.2 岁，略高于实际年龄。\n\n${METRIC}`;
  assert.strictEqual(stripTrailingQuestion(text), text);
});

// ── factCheck ───────────────────────────────────────────────────────────────

test('a dots card still yields the real dot name, not the pipe-delimited tail', () => {
  // _extractDotReferences' name capture excludes neither "|" nor the dosage note, so the greedy
  // 16-char window grabs "夜安宁 | 2粒/晚". detectDotNameMismatch compares with a BIDIRECTIONAL
  // includes, which absorbs that — the card is not a new false-positive source. Note the
  // formulary is keyed by the numeric dots.id, NOT key_name.
  const formulary = [{ id: 12, key_name: 'D-N12', name: 'Night Calm', name_zh: '夜安宁' }];
  assert.deepStrictEqual(factCheck.detectDotNameMismatch(DOTS, formulary), []);
});

test('a dots card with the name pipe-separated instead also survives validation', () => {
  const formulary = [{ id: 12, key_name: 'D-N12', name: 'Night Calm', name_zh: '夜安宁' }];
  assert.deepStrictEqual(factCheck.detectDotNameMismatch(':::dots\n12号原粒 | 夜安宁 | 2粒/晚\n:::', formulary), []);
});

test('a genuinely wrong dot name in a card is still caught', () => {
  const formulary = [{ id: 12, key_name: 'D-N12', name: 'Night Calm', name_zh: '夜安宁' }];
  const bad = factCheck.detectDotNameMismatch(':::dots\n12号原粒 完全错误的名字 | 2粒/晚\n:::', formulary);
  assert.strictEqual(bad.length, 1, 'the card must not become a blind spot for fabricated names');
});

test('biomarker concentration units in a metric card are not read as a dosage', () => {
  // hasStandaloneDosage exists to catch external-supplement recommendations; mg/L is excluded by
  // its own lookahead and every dots line carries 号原粒.
  const risks = factCheck.detectAllRisks
    ? factCheck.detectAllRisks(`${METRIC}\n\n${DOTS}`, { dotsFormulary: [{ id: 12, key_name: 'D-N12', name: 'Night Calm', name_zh: '夜安宁' }] })
    : null;
  if (risks) assert.ok(!risks.includes('standaloneDosage'), JSON.stringify(risks));
});

// ── prompt gating ───────────────────────────────────────────────────────────

test('the format block is empty unless explicitly enabled', () => {
  assert.strictEqual(getOutputFormatBlock({ rich: false, allow: ['metric'] }), '');
  assert.strictEqual(getOutputFormatBlock({ rich: true, allow: [] }), '');
  assert.strictEqual(getOutputFormatBlock({}), '');
});

test('a template is only told about the cards it is allowed to emit', () => {
  const b = getOutputFormatBlock({ rich: true, allow: ['takeaway'] });
  assert.match(b, /:::takeaway/);
  assert.doesNotMatch(b, /:::metric/);
  assert.doesNotMatch(b, /:::dots/);
});

test('the block reconciles itself with the templates\' existing "no headings" rules', () => {
  const zh = getOutputFormatBlock({ rich: true, allow: ['metric'], isZh: true });
  const en = getOutputFormatBlock({ rich: true, allow: ['metric'], isZh: false });
  assert.match(zh, /不是 Markdown 标题/);
  assert.match(en, /NOT a markdown heading/);
});

test('the block orders any action JSON after the fences', () => {
  const en = getOutputFormatBlock({ rich: true, allow: ['takeaway'], isZh: false });
  assert.match(en, /very last line, AFTER every ::: block/);
});

// ── template wiring ─────────────────────────────────────────────────────────

const WIRED = [
  ['viva/chat/biomarker.js', ['metric', 'takeaway']],
  ['viva/chat/nutrition.js', ['takeaway', 'dots']],
  ['viva/chat/science.js', ['takeaway']],
  ['nano/chat/biomarker.js', ['metric', 'takeaway']],
  ['nano/chat/nutrition.js', ['takeaway', 'dots']],
  ['nano/chat/science.js', ['takeaway']],
];
const NOT_WIRED = [
  'viva/chat/casual.js', 'viva/chat/emotional.js', 'viva/chat/record.js', 'viva/chat/reminder.js',
  'nano/chat/casual.js', 'nano/chat/emotional.js', 'nano/chat/record.js', 'nano/chat/reminder.js',
  'viva/systemDailyCheckin.js', 'nano/systemDailyCheckin.js',
];

for (const [rel, allow] of WIRED) {
  test(`${rel} is wired with allow=${JSON.stringify(allow)}`, () => {
    const src = fs.readFileSync(path.join(WORKER, 'prompts', rel), 'utf8');
    assert.match(src, /getOutputFormatBlock/);
    for (const a of allow) assert.match(src, new RegExp("'" + a + "'"), `missing ${a}`);
  });
}

test('markdown-banning conversational intents are deliberately left alone', () => {
  for (const rel of NOT_WIRED) {
    const src = fs.readFileSync(path.join(WORKER, 'prompts', rel), 'utf8');
    assert.doesNotMatch(src, /getOutputFormatBlock/,
      `${rel} bans headings/lists or is a one-line transactional turn — a card there is wrong`);
  }
});
