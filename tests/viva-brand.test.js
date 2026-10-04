const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const worker = path.join(__dirname, '../src/functions/worker');
const root = path.join(worker, 'prompts/viva');
const { vivaBrand } = require(path.join(root, 'brand'));
const { normalizeBrandName } = require(path.join(worker, 'lib/channels'));

// Every live Viva template. Viva is brand-neutral (2026-10-04): no identity line names a
// company; the channel's brand (Aeviva by default) appears only in the appended rule that says
// to name it when the user asks who is behind Viva.
const templates = ['chat/casual', 'chat/emotional', 'chat/biomarker', 'chat/nutrition', 'chat/lifestyle', 'chat/science', 'chat/record', 'chat/reminder', 'systemHealthAdvice', 'systemHealthReport', 'systemReport', 'systemDailyCheckin', 'systemProgramDayComment', 'systemFormulaGenerate'];
const base = { user_profile: { nickname: 'Alex', language: 'zh' }, language: 'zh',
  biomarkers: {}, bioage: {}, subAges: {}, dots: [], dotsByDimension: {}, healthConditions: [], period: 'morning' };
const RULE = /关于公司：[^\n]*/;
const RULE_EN = /COMPANY:[^\n]*/;

for (const name of templates) {
  test(`${name}: brand-neutral identity, the channel's brand only in the company rule`, () => {
    const build = require(path.join(root, name));
    const branded = build({ ...base, brand_name: { zh: 'SuperiorMed', en: 'SuperiorMed' } });
    assert.match(branded, /Viva/);
    assert.match(branded.match(RULE)[0], /SuperiorMed/);
    assert.doesNotMatch(branded.replace(RULE, ''), /SuperiorMed|Aeviva/);
    const plain = build({ ...base, brand_name: null });
    assert.match(plain.match(RULE)[0], /Aeviva/);
    assert.doesNotMatch(plain.replace(RULE, ''), /Aeviva/);
    const en = build({ ...base, user_profile: { ...base.user_profile, language: 'en' }, language: 'en', isZh: false, brand_name: { zh: '超越', en: 'SuperiorMed' } });
    assert.match(en.match(RULE_EN)[0], /SuperiorMed/);
    assert.doesNotMatch(en.replace(RULE_EN, ''), /SuperiorMed|超越|Aeviva/);
  });
}

test('no customer-service line names a company', () => {
  const report = require(path.join(root, 'systemReport'))({ ...base });
  assert.doesNotMatch(report, /Aeviva 客服/);
  const { getFormulationPackageBlock } = require(path.join(worker, 'prompts/chat/formulationPackageBlock'));
  assert.doesNotMatch(getFormulationPackageBlock(true, true) + getFormulationPackageBlock(true, false), /Aeviva/);
});

test('brand values: {zh,en}, a plain string, or unset', () => {
  assert.deepEqual(normalizeBrandName('SuperiorMed'), { zh: 'SuperiorMed', en: 'SuperiorMed' });
  assert.deepEqual(normalizeBrandName({ en: 'X' }), { zh: 'X', en: 'X' });
  assert.equal(normalizeBrandName({}), null);
  assert.equal(normalizeBrandName('  '), null);
  assert.equal(normalizeBrandName(null), null);
  assert.equal(vivaBrand(null), 'Aeviva');
  assert.equal(vivaBrand({ zh: '超越', en: 'SuperiorMed' }), '超越');
  assert.equal(vivaBrand({ zh: '超越', en: 'SuperiorMed' }, 'en'), 'SuperiorMed');
});

// _neutralizeHistoryBrand: Viva's earlier replies naming a company outweighed the brand-neutral
// prompt (4 of 10 English "Who are you" replies, prod history, 2026-10-04), so the name is taken
// out of her own replies before the model sees them.
{
  const { _neutralizeHistoryBrand } = require(path.join(__dirname, '..', 'src', 'functions', 'worker', 'handlers', 'chat.js'));
  const hist = () => [
    { role: 'user', content: 'Who are you? Aeviva?' },
    { role: 'assistant', content: 'I’m Viva — Aeviva’s precision longevity advisor.' },
    { role: 'assistant', content: '我是Viva，Aeviva的精准长寿顾问' },
    { role: 'assistant', content: 'I’m Viva — your longevity advisor at SuperiorMed, built for you.' },
    { role: 'assistant', content: '我是SuperiorMed开发的精准长寿顾问Viva。' },
    { role: 'user', content: 'Who are you' },
  ];

  test('history brand: company names leave Viva\'s turns, user turns untouched', () => {
    const h = _neutralizeHistoryBrand(hist(), { zh: 'SuperiorMed', en: 'SuperiorMed' });
    assert.strictEqual(h[1].content, 'I’m Viva — precision longevity advisor.');
    assert.strictEqual(h[2].content, '我是Viva，精准长寿顾问');
    assert.strictEqual(h[3].content, 'I’m Viva — your longevity advisor, built for you.');
    assert.strictEqual(h[4].content, '我是精准长寿顾问Viva。');
    assert.strictEqual(h[0].content, 'Who are you? Aeviva?');
  });

  test('history brand: with no channel brand the default name is still removed', () => {
    assert.strictEqual(_neutralizeHistoryBrand(hist(), null)[1].content, 'I’m Viva — precision longevity advisor.');
  });
}
