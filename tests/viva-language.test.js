const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.join(__dirname, '../src/functions/worker/prompts/viva');
const templates = ['chat/casual', 'chat/emotional', 'chat/biomarker', 'chat/nutrition', 'chat/lifestyle', 'chat/science', 'chat/record', 'chat/reminder', 'systemHealthAdvice', 'systemHealthReport', 'systemReport', 'systemNutrition', 'systemDailyCheckin', 'systemProgramDayComment', 'systemFormulaGenerate'];
for (const name of templates) {
  test(`${name} selects English and Chinese without changing output contracts`, () => {
    const build = require(path.join(root, name));
    for (const language of ['en', 'zh', undefined]) {
      const prompt = build({ user_profile: { nickname: 'Alex', language }, language,
        biomarkers: {}, bioage: {}, subAges: {}, dots: [], dotsByDimension: {}, healthConditions: [], period: 'morning' });
      assert.match(prompt, language === 'en' ? /RESPONSE LANGUAGE: English/ : /回复语言：简体中文/);
      assert.match(prompt, /Preserve required JSON keys/);
      assert.doesNotMatch(prompt, /全程(?:用|使用)简体中文|必须使用中文（简体）回复/);
    }
  });
}
test('flat report language, health advice isZh, and English channel labels are respected', () => {
  const advice = require(path.join(root, 'systemHealthAdvice'));
  assert.match(advice({ isZh: false, biomarkers: {}, dotsByDimension: {}, healthConditions: [] }), /RESPONSE LANGUAGE: English/);
  const report = require(path.join(root, 'systemReport'));
  assert.match(report({ language: 'en', sub_age_display_names: { CellularAge: { en: 'Vitality Age', zh: '活力年龄' } } }), /dimension names: .*Vitality Age/);
});
