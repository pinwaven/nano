// The formulary lists active ingredients only; a claim about capsule material, excipients,
// vegan status or ingredient sourcing has nothing to be grounded in (dev, 2026-09-15).
const test = require('node:test');
const assert = require('node:assert');
const { detectUnsupportedProductClaim, detectAllRisks } = require('../src/functions/worker/lib/factCheck');

test('asserted capsule / animal-free / sourcing claims are flagged', () => {
  for (const t of [
    '所有原粒均为植物基配方，不含动物成分。',
    '全部18款原粒均为素食配方，无一处含动物成分。',
    '维生素D3来自地衣提取，K2-MK7来自纳豆菌发酵。',
    '所有原粒均为植物胶囊壳，无明胶。',
    'All dots use vegetarian capsules and are gelatin-free.',
  ]) assert.ok(detectUnsupportedProductClaim(t).length > 0, `should flag: ${t}`);
  assert.ok(detectAllRisks('所有原粒均为植物基配方，不含动物成分。', [], []).includes('unsupportedProductClaim'));
});

test('an honest disclaimer in the same sentence is not flagged, and neither is unrelated prose', () => {
  for (const t of [
    '配方库未提供胶囊壳材质信息，因此我们无法确认胶囊是否为植物纤维素或是否含明胶。',
    '同样，也无法确认是否"纯素（Vegan）"——该信息未在配方库中定义。',
    '如你对胶囊壳有偏好，请查阅产品详情页或联系客服确认。',
    '豆腐是完全植物来源的蛋白质。',
    '13号原粒含凝结芽孢杆菌与枯草芽孢杆菌。',
  ]) assert.deepEqual(detectUnsupportedProductClaim(t), [], `should NOT flag: ${t}`);
});

test('a disclaimer elsewhere does not excuse an assertion in another sentence', () => {
  const t = '配方库未提供胶囊壳材质信息。\n全部18款原粒均为素食配方，不含任何动物源性成分。';
  assert.equal(detectUnsupportedProductClaim(t).length, 1);
});

test('the product-claim detector catches the wordings that slipped on dev', () => {
  for (const t of ['所有原粒活性成分均为植物提取或发酵来源，无动物辅料。', '含植物源活性成分且无动物衍生成分的原粒清单', '不含任何动物性原料。']) {
    assert.ok(detectUnsupportedProductClaim(t).length > 0, `should flag: ${t}`);
  }
});
