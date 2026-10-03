const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const worker = path.join(__dirname, '../src/functions/worker');
const root = path.join(worker, 'prompts/viva');
const { vivaBrand } = require(path.join(root, 'brand'));
const { normalizeBrandName } = require(path.join(worker, 'lib/channels'));

// Every live Viva template that names the company Viva works for (channels.config.brand_name).
const templates = ['chat/casual', 'chat/emotional', 'chat/biomarker', 'chat/nutrition', 'chat/lifestyle', 'chat/science', 'chat/record', 'chat/reminder', 'systemHealthAdvice', 'systemHealthReport', 'systemReport', 'systemDailyCheckin', 'systemProgramDayComment', 'systemFormulaGenerate'];
const base = { user_profile: { nickname: 'Alex', language: 'zh' }, language: 'zh',
  biomarkers: {}, bioage: {}, subAges: {}, dots: [], dotsByDimension: {}, healthConditions: [], period: 'morning' };

for (const name of templates) {
  test(`${name}: Viva belongs to the channel's brand, Aeviva by default`, () => {
    const build = require(path.join(root, name));
    const branded = build({ ...base, brand_name: { zh: 'SuperiorMed', en: 'SuperiorMed' } });
    assert.match(branded, /SuperiorMed/);
    assert.doesNotMatch(branded, /Aeviva/);
    assert.match(branded, /Viva/);
    assert.match(build({ ...base, brand_name: null }), /Aeviva/);
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

// _alignHistoryBrand: earlier "I'm Viva — Aeviva's…" replies in the history outweighed the
// prompt's SuperiorMed (prod, 2026-10-03), so Viva's own replies are shown under the current brand.
{
  const { _alignHistoryBrand } = require(path.join(__dirname, '..', 'src', 'functions', 'worker', 'handlers', 'chat.js'));
  const hist = () => [
    { role: 'user', content: 'Who are you? Aeviva?' },
    { role: 'assistant', content: 'I’m Viva — Aeviva’s precision longevity advisor.' },
    { role: 'assistant', content: '我是Viva，Aeviva的精准长寿顾问' },
    { role: 'user', content: 'Who are you' },
  ];

  test('history brand: assistant turns take the channel brand, user turns untouched', () => {
    const h = _alignHistoryBrand(hist(), { zh: 'SuperiorMed', en: 'SuperiorMed' }, 'en');
    assert.strictEqual(h[1].content, 'I’m Viva — SuperiorMed’s precision longevity advisor.');
    assert.strictEqual(h[2].content, '我是Viva，SuperiorMed的精准长寿顾问');
    assert.strictEqual(h[0].content, 'Who are you? Aeviva?');
  });

  test('history brand: no override leaves the history as it is', () => {
    assert.deepStrictEqual(_alignHistoryBrand(hist(), null, 'en'), hist());
  });
}
