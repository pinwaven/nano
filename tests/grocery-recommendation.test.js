// Grocery catalogs in chat (CLAUDE.md §46): supermarket products the AI can point a user at
// while giving diet advice. Same rule as the store-product recommendation (§37) — the MODEL picks
// ids and writes a sentence, the SERVER writes every name, price and picture — with one
// difference forced by scale: the catalog is thousands of rows, so it is searched by a tool and
// the tail is resolved by a fresh read, never against a prompt snapshot.
const assert = require('node:assert');
const test = require('node:test');
const path = require('node:path');
const fs = require('node:fs');

const WORKER = path.join(__dirname, '..', 'src', 'functions', 'worker');
const MINIAPP = path.join(__dirname, '..', 'src', 'mini', 'nano-miniapp');
const read = (f) => fs.readFileSync(path.join(WORKER, f), 'utf8');

const { _stripActionTails } = require(path.join(WORKER, 'handlers', 'chat.js'));
const { _buildGroceryCardBlock } = require(path.join(WORKER, 'lib', 'chatCards.js'));
const {
  filterGroceryByUserFacts, searchGroceryProducts, resolveGroceryProducts, _factTerm, MAX_RECOMMENDED,
} = require(path.join(WORKER, 'lib', 'groceryCatalog.js'));
const { getGroceryBlock } = require(path.join(WORKER, 'prompts', 'chat', 'groceryBlock.js'));
const { AGENTIC_TOOL_DEFS, createAgenticToolHandlers } = require(path.join(WORKER, 'lib', 'agenticTools.js'));
const { mdToSegments } = require(path.join(MINIAPP, 'utils', 'markdown.js'));
const vivaNutrition = require(path.join(WORKER, 'prompts', 'viva', 'chat', 'nutrition.js'));
const nanoNutrition = require(path.join(WORKER, 'prompts', 'nano', 'chat', 'nutrition.js'));

const SUPPLIERS = [{ supplier_key: 'hema', name_zh: '盒马', name_en: 'Hema', app_name_zh: '盒马 App' }];
const ROWS = [
  { supplier_key: 'hema', product_id: 'p1', name: '盒马 挪威三文鱼刺身 200g', price: '59.90', unit: '盒', category: '海鲜水产', tags: ['进口'], image_url: 'https://oss.example/p1.jpg', supplier_name: '盒马', app_name_zh: '盒马 App' },
  { supplier_key: 'hema', product_id: 'p2', name: '盒马 有机燕麦片 500g', price: '12.9', unit: '袋', category: '粮油调味', tags: ['有机'], image_url: 'https://oss.example/p2.jpg', supplier_name: '盒马', app_name_zh: '盒马 App' },
  { supplier_key: 'hema', product_id: 'p3', name: '盒马 鲜牛奶 1L', price: '9.9', unit: '瓶', category: '乳品烘焙', tags: [], image_url: null, supplier_name: '盒马', app_name_zh: '盒马 App' },
];
const stubPool = (rows = ROWS) => ({
  query: async (sql, params) => {
    if (/FROM user_memory_facts/.test(sql)) return { rows: [] };
    if (/FROM food_suppliers WHERE is_active/.test(sql)) return { rows: SUPPLIERS };
    if (/ILIKE/.test(sql)) {
      const kw = String(params[0]).replace(/%/g, '');
      return { rows: rows.filter(r => r.name.includes(kw)) };
    }
    if (/IN \(/.test(sql)) {
      const pairs = new Set();
      for (let i = 0; i < params.length; i += 2) pairs.add(`${params[i]}:${params[i + 1]}`);
      return { rows: rows.filter(r => pairs.has(`${r.supplier_key}:${r.product_id}`)) };
    }
    throw new Error('unexpected query: ' + sql.slice(0, 60));
  },
});

// ── The prompt block: gated on a supplier existing, never carries data ───────────────────────

test('no supplier means no block — the model never learns the vocabulary', () => {
  assert.strictEqual(getGroceryBlock([], true), '');
  assert.strictEqual(getGroceryBlock(undefined, true), '');
});

test('the block names the tool and the tail, and no product or price', () => {
  const block = getGroceryBlock(SUPPLIERS, true);
  assert.match(block, /get_grocery_products/);
  assert.match(block, /recommend_grocery/);
  assert.match(block, /盒马/);
  assert.doesNotMatch(block, /¥|\d+\.\d/);
});

test('both personas gate the section on a supplier being present', () => {
  const base = {
    user_profile: { nickname: 'T', age: 40, language: 'zh' }, bioage: null, dots: [], plan: null,
    questionnaire_context: '', active_health_plans: [], health_twin: null,
    essential_knowledge: 'EK', user_facts: [], now_iso: new Date().toISOString(), rich_format: true,
  };
  for (const build of [vivaNutrition, nanoNutrition]) {
    assert.doesNotMatch(build({ ...base }), /recommend_grocery/, 'absent without a supplier');
    assert.match(build({ ...base, grocery_suppliers: SUPPLIERS }), /recommend_grocery/, 'present with one');
  }
});

test('the tool is defined, has a handler, and PLAN/JUDGE were taught it', () => {
  const defs = AGENTIC_TOOL_DEFS.map(d => d.function.name);
  assert.ok(defs.includes('get_grocery_products'));
  const impls = createAgenticToolHandlers({ pool: null, user_id: 'u', language: 'zh' });
  assert.strictEqual(typeof impls.get_grocery_products, 'function');
  assert.match(read('prompts/chat/planTemplate.js'), /get_grocery_products/);
  assert.match(read('prompts/chat/planTemplate.js'), /recommend_grocery/);
  assert.match(read('prompts/viva/judgeTemplate.js'), /recommend_grocery/);
});

// ── The tool: flat rows, no price, keywords required ────────────────────────────────────────

test('the tool returns flat product rows without a price, and refuses without keywords', async () => {
  const h = createAgenticToolHandlers({ pool: stubPool(), user_id: 'u', language: 'zh' });
  const none = await h.get_grocery_products({});
  assert.strictEqual(none.ok, false);
  const res = await h.get_grocery_products({ keywords: ['三文鱼', '燕麦'] });
  assert.strictEqual(res.ok, true);
  assert.ok(Array.isArray(res.data));
  assert.deepStrictEqual(res.data.map(r => r.product_id), ['p1', 'p2']);
  for (const r of res.data) {
    assert.strictEqual(r.kind, 'product');
    assert.strictEqual(r.price, undefined, 'a price the model was never given is a price it cannot leak');
    assert.strictEqual(r.image_url, undefined);
  }
});

test('no match is a sentence, not an empty array', async () => {
  const h = createAgenticToolHandlers({ pool: stubPool(), user_id: 'u', language: 'zh' });
  const res = await h.get_grocery_products({ keywords: ['榴莲'] });
  assert.strictEqual(res.data[0].kind, 'no_match');
  assert.match(res.data[0].note, /不要编造/);
});

// ── The allergy / restriction filter: code, both paths ──────────────────────────────────────

test('fact terms are the food word, not the verb around it', () => {
  assert.strictEqual(_factTerm('避免牛奶'), '牛奶');
  assert.strictEqual(_factTerm('对海鲜过敏'), '海鲜');
  assert.strictEqual(_factTerm('不吃猪肉'), '猪肉');
  assert.strictEqual(_factTerm('牛奶'), '牛奶');
});

test('a product naming a restricted food is filtered; a vegetarian loses animal categories', () => {
  const milk = [{ category: 'dietary_restriction', fact_zh: '避免牛奶' }];
  assert.deepStrictEqual(filterGroceryByUserFacts(ROWS, milk).map(r => r.product_id), ['p1', 'p2']);
  const veg = [{ category: 'dietary_restriction', fact_zh: '素食' }];
  assert.deepStrictEqual(filterGroceryByUserFacts(ROWS, veg).map(r => r.product_id), ['p2', 'p3']);
  const pref = [{ category: 'preference', fact_zh: '不喜欢牛奶' }];
  assert.strictEqual(filterGroceryByUserFacts(ROWS, pref).length, 3, 'a preference is not a restriction');
});

test('search applies the filter before the model sees a row', async () => {
  const rows = await searchGroceryProducts(stubPool(), {
    keywords: ['牛奶'], userFacts: [{ category: 'allergy', fact_zh: '对牛奶过敏' }],
  });
  assert.deepStrictEqual(rows, []);
});

// ── The tail: resolved by a fresh read, unknown ids dropped, capped ─────────────────────────

test('resolveGroceryProducts keeps only ids that resolve, in the model\'s order, with its reason', async () => {
  const out = await resolveGroceryProducts(stubPool(), [
    { supplier: 'hema', product_id: 'p2', reason_zh: '早餐主食' },
    { supplier: 'hema', product_id: 'ghost', reason_zh: '不存在' },
    { supplier: 'other', product_id: 'p1', reason_zh: '错的超市' },
    { supplier: 'hema', product_id: 'p1', reason_zh: 'Omega-3 来源' },
    { supplier: 'hema', product_id: 'p1', reason_zh: '重复' },
  ]);
  assert.deepStrictEqual(out.map(o => [o.product_id, o.reason_zh]), [['p2', '早餐主食'], ['p1', 'Omega-3 来源']]);
  assert.strictEqual(out[0].price, '12.9', 'price is read from the table, never from the tail');
});

test('resolve re-applies the restriction filter and caps at MAX_RECOMMENDED', async () => {
  const filtered = await resolveGroceryProducts(stubPool(), [{ supplier: 'hema', product_id: 'p3', reason_zh: 'x' }],
    [{ category: 'dietary_restriction', fact_zh: '避免牛奶' }]);
  assert.deepStrictEqual(filtered, []);
  const many = Array.from({ length: 12 }, (_, i) => ({ supplier_key: 'hema', product_id: `m${i}`, name: `食品${i}`, price: '1', supplier_name: '盒马' }));
  const out = await resolveGroceryProducts(stubPool(many), many.map(m => ({ supplier: 'hema', product_id: m.product_id, reason_zh: 'r' })));
  assert.strictEqual(out.length, MAX_RECOMMENDED);
});

test('the nesting recommend_grocery tail is fully stripped, alone and after other tails', () => {
  const raw = '早餐燕麦配三文鱼。\n{"action":"recommend_grocery","items":[{"supplier":"hema","product_id":"p1","reason_zh":"Omega-3"}]}';
  assert.strictEqual(_stripActionTails(raw), '早餐燕麦配三文鱼。');
  const both = '好的。\n{"action":"remember_fact","category":"allergy","fact":"对海鲜过敏"}\n{"action":"recommend_grocery","items":[{"supplier":"hema","product_id":"p2","reason_zh":"r"}]}';
  assert.strictEqual(_stripActionTails(both), '好的。');
});

// ── The card: server-written, pipe-safe, parsed by the miniapp ──────────────────────────────

test('the card carries name, price, image and note, and the miniapp parses it back', () => {
  const items = [
    { ...ROWS[0], reason_zh: 'Omega-3 | 来源' },
    { ...ROWS[2], reason_zh: '钙' },
  ];
  const card = _buildGroceryCardBlock(items, 'zh');
  assert.match(card, /^\n\n:::grocery\n#note\|/);
  assert.match(card, /盒马 App/);
  assert.match(card, /hema\|盒马\|p1\|盒马 挪威三文鱼刺身 200g\|¥59.9\/盒\|https:\/\/oss.example\/p1.jpg\|Omega-3 \/ 来源/);
  const segs = mdToSegments('建议如下。' + card);
  const g = segs.find(s => s.t === 'grocery');
  assert.ok(g, 'the miniapp segmenter recognises :::grocery');
  assert.strictEqual(g.items.length, 2);
  assert.strictEqual(g.items[0].image, 'https://oss.example/p1.jpg');
  assert.strictEqual(g.items[1].image, '', 'a missing image renders as a placeholder, not a broken src');
  assert.strictEqual(g.items[1].price, '¥9.9/瓶');
  assert.match(g.note, /盒马 App/);
});

test('an empty item list renders no card', () => {
  assert.strictEqual(_buildGroceryCardBlock([], 'zh'), '');
});
