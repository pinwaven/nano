// AI store-product recommendation (aeviva-china's GCN storefront).
//
// The whole design rests on one rule: the MODEL picks a sku id and writes a sentence of
// reasoning, and the SERVER writes every product name and price the user actually sees. These
// tests pin down the pieces that enforce that, plus the two gates that keep the feature
// reactive-only and allergen-safe.
const assert = require('node:assert');
const test = require('node:test');
const path = require('node:path');

const WORKER = path.join(__dirname, '..', 'src', 'functions', 'worker');
const MINIAPP = path.join(__dirname, '..', 'src', 'mini', 'nano-miniapp');

const { _stripActionTails, _filterProductsByUserFacts, _validateProductRecommendations } = require(path.join(WORKER, 'handlers', 'chat.js'));
const { _buildProductCardBlock } = require(path.join(WORKER, 'handlers', 'dots.js'));
const { getProductRecommendBlock } = require(path.join(WORKER, 'prompts', 'chat', 'productRecommendBlock.js'));
const { detectAllRisks, detectFakeStoreProduct } = require(path.join(WORKER, 'lib', 'factCheck.js'));
const { mdToSegments } = require(path.join(MINIAPP, 'utils', 'markdown.js'));
const vivaNutrition = require(path.join(WORKER, 'prompts', 'viva', 'chat', 'nutrition.js'));
const nanoNutrition = require(path.join(WORKER, 'prompts', 'nano', 'chat', 'nutrition.js'));

const CATALOG = [{
  sku_id: 'sku-aaa', sku_code: 'MAG-01', product_name_zh: '镁元素片', price_cny: 128,
  in_stock: true, summary_zh: '一种镁补充剂', indications_zh: ['睡眠', '压力'],
  sub_age_targets: ['Resilience Age'], key_actives_zh: ['甘氨酸镁 200mg'],
  cautions_zh: [], allergens_zh: [],
}];

// ── The prompt block: the reactive-only gate, and what the model is/isn't told ──────────────

test('no catalog means no block at all — the model never learns the vocabulary', () => {
  assert.strictEqual(getProductRecommendBlock([], true), '');
  assert.strictEqual(getProductRecommendBlock(undefined, true), '');
});

test('the block never shows the model a price', () => {
  const block = getProductRecommendBlock(CATALOG, true);
  assert.match(block, /sku-aaa/, 'the sku id must be present as the tap target');
  assert.match(block, /镁元素片/);
  assert.doesNotMatch(block, /128/, 'a price the model was never given is a price it cannot leak');
});

test('both personas gate the section on the catalog being present', () => {
  const base = {
    user_profile: { nickname: 'T', age: 40, language: 'zh' }, bioage: null, dots: [], plan: null,
    questionnaire_context: '', active_health_plans: [], health_twin: null,
    essential_knowledge: 'EK', user_facts: [], now_iso: new Date().toISOString(), rich_format: true,
  };
  for (const build of [vivaNutrition, nanoNutrition]) {
    const off = build({ ...base });
    const on = build({ ...base, store_products: CATALOG });
    assert.doesNotMatch(off, /可推荐商品|RECOMMENDABLE PRODUCTS/, 'absent without a catalog');
    assert.match(on, /sku-aaa/, 'present with one');
  }
});

// ── The allergy filter: deterministic, applied before the model sees anything ────────────────

test('a product whose allergen matches a recorded allergy never reaches the prompt', () => {
  const products = [{ sku_id: 'a', allergens_zh: ['海鲜'], cautions_zh: [] }, { sku_id: 'b', allergens_zh: [], cautions_zh: [] }];
  const kept = _filterProductsByUserFacts(products, [{ category: 'allergy', fact_zh: '对海鲜过敏' }]);
  assert.deepStrictEqual(kept.map(p => p.sku_id), ['b']);
});

test('matching is bidirectional — a broad fact still suppresses a narrower allergen', () => {
  const products = [{ sku_id: 'a', allergens_zh: ['乳制品蛋白'], cautions_zh: [] }];
  const kept = _filterProductsByUserFacts(products, [{ category: 'dietary_restriction', fact_zh: '乳制品' }]);
  assert.strictEqual(kept.length, 0);
});

test('an unrelated fact category never suppresses anything', () => {
  const products = [{ sku_id: 'a', allergens_zh: ['海鲜'], cautions_zh: [] }];
  assert.strictEqual(_filterProductsByUserFacts(products, [{ category: 'goal', fact_zh: '海鲜' }]).length, 1);
});

// ── The card: written by the server, from the server's own data ──────────────────────────────

test('the card renders the price from the snapshot, not from the model', () => {
  const block = _buildProductCardBlock([{ sku_id: 'sku-aaa', product_name_zh: '镁元素片', price_cny: '128.0000', reason_zh: '抗压年龄偏高' }], 'zh');
  assert.match(block, /^\n\n:::product\n/);
  assert.match(block, /sku-aaa\|镁元素片\|¥128\|抗压年龄偏高/);
});

test('pipes and newlines in a name or reason cannot break the row format', () => {
  const block = _buildProductCardBlock([{ sku_id: 's', product_name_zh: 'A|B', price_cny: 1, reason_zh: 'x\ny' }], 'zh');
  const row = block.split('\n').find(l => l.startsWith('s|'));
  assert.strictEqual(row.split('|').length, 4, 'exactly four fields survive');
  assert.match(row, /A\/B/);
});

test('a missing price degrades to a label rather than an invented number', () => {
  const block = _buildProductCardBlock([{ sku_id: 's', product_name_zh: 'X', price_cny: null, reason_zh: 'r' }], 'zh');
  assert.match(block, /价格以商城为准/);
});

test('nothing valid means no card at all', () => {
  assert.strictEqual(_buildProductCardBlock([], 'zh'), '');
  assert.strictEqual(_buildProductCardBlock([{ product_name_zh: 'no sku' }], 'zh'), '');
});

// ── The renderer round-trip ──────────────────────────────────────────────────────────────────

test('the miniapp parses the card the server emits', () => {
  const md = '建议看看这个。' + _buildProductCardBlock([{ sku_id: 'sku-aaa', product_name_zh: '镁元素片', price_cny: 128, reason_zh: '抗压年龄偏高' }], 'zh');
  const segs = mdToSegments(md);
  const card = segs.find(s => s.t === 'product');
  assert.ok(card, 'a product segment must be produced');
  assert.deepStrictEqual(card.items, [{ sku: 'sku-aaa', name: '镁元素片', price: '¥128', reason: '抗压年龄偏高' }]);
});

test('a malformed product block degrades to prose rather than vanishing', () => {
  const segs = mdToSegments(':::product\ngarbage\n:::');
  assert.ok(!segs.some(s => s.t === 'product'));
  assert.ok(segs.some(s => s.t === 'html'), 'the content is still shown, just not as a card');
});

// ── The action tail never survives into a saved message ──────────────────────────────────────

test('the nesting recommend_product tail is fully stripped', () => {
  const raw = '这几款可以考虑。\n{"action":"recommend_product","skus":[{"sku_id":"sku-aaa","reason_zh":"抗压年龄偏高"}]}';
  assert.strictEqual(_stripActionTails(raw), '这几款可以考虑。');
});

test('a flat [^}]* pattern would have left a fragment — regression guard', () => {
  const out = _stripActionTails('X\n{"action":"recommend_product","skus":[{"sku_id":"a","reason_zh":"r"}]}');
  assert.doesNotMatch(out, /[{}]/, 'no JSON fragment may remain');
});

test('stripping still works alongside the other action tails', () => {
  const raw = '好的。\n{"action":"remember_fact","category":"allergy","fact":"对海鲜过敏"}\n{"action":"recommend_product","skus":[{"sku_id":"a","reason_zh":"r"}]}';
  assert.strictEqual(_stripActionTails(raw), '好的。');
});

// ── The prose detector: a product named but never picked ─────────────────────────────────────

test('a product invented in prose is flagged', () => {
  assert.deepStrictEqual(detectAllRisks('商城里可以看看「深海鱼油胶囊」', [], CATALOG), ['fakeStoreProduct']);
});

test('a real product named in prose is not flagged', () => {
  assert.deepStrictEqual(detectAllRisks('商城里可以看看「镁元素片」', [], CATALOG), []);
});

test('with no catalog the detector stays silent — that turn is factConstraint territory', () => {
  assert.deepStrictEqual(detectAllRisks('商城里可以看看「深海鱼油胶囊」', [], []), []);
});

test('bracketed text outside a shopping context is not a product claim', () => {
  assert.deepStrictEqual(detectFakeStoreProduct('他说「随便聊聊」而已', CATALOG), []);
});

// ── Validation: nothing the model says about a product is trusted ────────────────────────────

test('a fabricated sku_id is dropped silently, producing no card', () => {
  const out = _validateProductRecommendations({ skus: [{ sku_id: 'sku-does-not-exist', reason_zh: 'r' }] }, CATALOG);
  assert.deepStrictEqual(out, []);
  assert.strictEqual(_buildProductCardBlock(out, 'zh'), '');
});

test('name and price come from the catalog even when the model asserts otherwise', () => {
  const out = _validateProductRecommendations(
    { skus: [{ sku_id: 'sku-aaa', product_name_zh: '假名字', price_cny: 9.9, reason_zh: '真实理由' }] }, CATALOG);
  assert.strictEqual(out[0].product_name_zh, '镁元素片');
  assert.strictEqual(out[0].price_cny, 128);
  assert.strictEqual(out[0].reason_zh, '真实理由', 'only the reasoning prose survives from the model');
});

test('recommendations are capped, and duplicates collapse', () => {
  const big = Array.from({ length: 6 }, (_, i) => ({ sku_id: `s${i}`, product_name_zh: `P${i}`, price_cny: 1 }));
  const many = _validateProductRecommendations({ skus: big.map(p => ({ sku_id: p.sku_id, reason_zh: 'r' })) }, big);
  assert.strictEqual(many.length, 3, 'a chat reply is not a product grid');
  const dupes = _validateProductRecommendations(
    { skus: [{ sku_id: 'sku-aaa', reason_zh: 'a' }, { sku_id: 'sku-aaa', reason_zh: 'b' }] }, CATALOG);
  assert.strictEqual(dupes.length, 1);
});

test('an overlong reason is truncated rather than allowed to swamp the card', () => {
  const out = _validateProductRecommendations({ skus: [{ sku_id: 'sku-aaa', reason_zh: 'x'.repeat(500) }] }, CATALOG);
  assert.strictEqual(out[0].reason_zh.length, 60);
});

test('with no catalog nothing can ever be recommended', () => {
  assert.deepStrictEqual(_validateProductRecommendations({ skus: [{ sku_id: 'sku-aaa', reason_zh: 'r' }] }, []), []);
});

test('a malformed payload yields nothing rather than throwing', () => {
  for (const bad of [null, {}, { skus: null }, { skus: 'nope' }, { skus: [null, 42, {}] }]) {
    assert.deepStrictEqual(_validateProductRecommendations(bad, CATALOG), []);
  }
});

// ── End to end: what the model emits -> what the user's screen actually shows ────────────────

test('a full turn: model tail in, validated card out, no JSON leak', () => {
  // Exactly the shape prompts/chat/productRecommendBlock.js instructs the model to produce,
  // including a fabricated second sku to prove it never reaches the screen.
  const rawReply = [
    '你的抗压年龄偏高，除了原粒之外，商城里也有可以配合的选择。',
    '{"action":"recommend_product","skus":[',
    '{"sku_id":"sku-aaa","reason_zh":"抗压年龄偏高时常用"},',
    '{"sku_id":"sku-invented","reason_zh":"编造的商品"}]}',
  ].join('\n');

  const prose = _stripActionTails(rawReply);
  assert.doesNotMatch(prose, /action|sku_id|[{}]/, 'no fragment of the tail may survive');

  const validated = _validateProductRecommendations(
    JSON.parse(rawReply.slice(rawReply.indexOf('{"action"'))), CATALOG);
  assert.strictEqual(validated.length, 1, 'the invented sku is gone');

  const segs = mdToSegments(prose + _buildProductCardBlock(validated, 'zh'));
  const card = segs.find(s => s.t === 'product');
  assert.strictEqual(card.items.length, 1);
  assert.strictEqual(card.items[0].name, '镁元素片');
  assert.strictEqual(card.items[0].price, '¥128');
  assert.strictEqual(card.items[0].sku, 'sku-aaa', 'the sku is carried as the tap target');
  assert.ok(segs.some(s => s.t === 'html' && /抗压年龄偏高/.test(s.h)), 'the prose survives alongside the card');
});

// ── The fetch gate and the render gate must stay coupled ─────────────────────────────────────
//
// Live classifier testing (2026-08-25) found `store_products` being emitted alongside
// record_action and casual_chat — intents whose templates render no product block, so the catalog
// would be fetched cross-repo and then silently dropped. The fetch is therefore gated on the same
// intent whose template actually renders it. If a future change adds the block to another
// template, this test is the reminder to widen the fetch condition in the same commit.
const fs = require('node:fs');

test('the catalog is only fetched for intents whose prompt renders it', () => {
  const chat = fs.readFileSync(path.join(WORKER, 'handlers', 'chat.js'), 'utf8');
  const gate = chat.slice(chat.indexOf("required_data.includes('store_products')"), chat.indexOf('fetches.store_products'));
  const gatedIntents = [...gate.matchAll(/intent === '([a-z_]+)'/g)].map(m => m[1]);
  assert.ok(gatedIntents.length > 0, 'the fetch must be gated on an explicit intent list');

  const renders = ['nano', 'viva'].map(persona =>
    fs.readFileSync(path.join(WORKER, 'prompts', persona, 'chat', 'nutrition.js'), 'utf8'));
  assert.ok(renders.every(src => src.includes('getProductRecommendBlock')),
    'both personas\' nutrition templates must render the block');

  // Every gated intent must map to a template that actually renders the block.
  for (const intent of gatedIntents) {
    const file = { nutrition_question: 'nutrition' }[intent];
    assert.ok(file, `intent "${intent}" is gated for the fetch but this test does not know which template renders it — add the mapping, and make sure that template calls getProductRecommendBlock`);
  }
});

test('casual chat renders no product block — its scope guard is load-bearing', () => {
  for (const persona of ['nano', 'viva']) {
    const src = fs.readFileSync(path.join(WORKER, 'prompts', persona, 'chat', 'casual.js'), 'utf8');
    assert.ok(!src.includes('getProductRecommendBlock'),
      `${persona}/chat/casual.js must not sell — it has a 1-2 sentence limit and a scope guard whose position is documented as load-bearing`);
  }
});
