// The chat surface for a food-sensitivity panel (§40): the deterministic trigger, the tool's
// result shape, and the prompt block's gating. Mirrors chat-formulation-package-tool.test.js,
// because §28g's tool and this one solve the same problem — a question the model has a plausible
// but wrong place to answer from — and share the same three traps.
//
// Pure: a stub pool, no network, no LLM.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
    messageAsksAboutFoodSensitivity, getFoodSensitivityBlock,
} = require('../src/functions/worker/prompts/chat/foodSensitivityBlock');
const { AGENTIC_TOOL_DEFS, createAgenticToolHandlers } = require('../src/functions/worker/lib/agenticTools');
const { extractToolGroundTruth, buildForcedToolQueue } = require('../src/functions/worker/lib/agenticChat');

const WORKER = path.join(__dirname, '..', 'src', 'functions', 'worker');
const read = (p) => fs.readFileSync(path.join(WORKER, p), 'utf8');

// ── the deterministic trigger ────────────────────────────────────────────────────────────────
test('the trigger matches how people actually ask, in both languages', () => {
    for (const m of [
        '我对什么食物过敏？', '我能喝牛奶吗', '我能吃鸡蛋吗', '我要忌口什么',
        '我有什么食物不耐受', '有哪些饮食禁忌', '这个 IgG 报告什么意思',
        'what foods should I avoid', 'can I eat eggs', 'am I allergic to milk',
        'do I have any food intolerances', 'is my igg panel back',
    ]) {
        assert.ok(messageAsksAboutFoodSensitivity(m), `did not match: ${m}`);
    }
});

test('the trigger does NOT match the Formulate-Dots trigger message', () => {
    // Both ride the same runAgenticTurn. Matching it would force an irrelevant tool call into a
    // formulation turn, and the classifier override in handlers/chat.js would stop the formula
    // tool from ever launching. Read from the source so a reworded trigger fails here.
    const dots = read('handlers/dots.js');
    const zh = dots.match(/\?\s*`(请根据我的完整健康数据[^`]*)`/);
    assert.ok(zh, 'could not find the zh formulation trigger message in handlers/dots.js');
    assert.ok(!messageAsksAboutFoodSensitivity(zh[1].replace('${PLAN_DAYS}', '28')), zh[1]);
    for (const m of [
        'Please use my full health data to build a 28-day Dots plan.',
        '帮我配制我的方案', '我要定制营养素', '重新配一次',
        '我的订单到哪了', '我已经买了什么原粒套餐', '你好',
    ]) {
        assert.ok(!messageAsksAboutFoodSensitivity(m), `wrongly matched: ${m}`);
    }
});

test('the forced queue pins the tool, respects the cap, and puts deterministic triggers first', () => {
    const valid = new Set(['get_biomarker_history', 'get_formulation_packages', 'get_food_sensitivity', 'get_dots']);
    assert.deepStrictEqual(buildForcedToolQueue({ tools_needed: [] }, '我能喝牛奶吗', valid, 2), ['get_food_sensitivity']);
    // Each forced tool burns a GENERATE iteration; the cap is what stops a turn from spending all
    // three on tool calls and shipping an empty reply (§28g).
    assert.strictEqual(buildForcedToolQueue({ tools_needed: ['get_dots'] }, '我买了什么？我对什么过敏？', valid, 1).length, 1);
    assert.deepStrictEqual(buildForcedToolQueue({ tools_needed: [] }, '你好', valid, 2), []);
});

// ── the tool ────────────────────────────────────────────────────────────────────────────────
test('every tool definition has a handler and vice versa, and this one is present', () => {
    const defs = AGENTIC_TOOL_DEFS.map(d => d.function.name).sort();
    const impls = Object.keys(createAgenticToolHandlers({ pool: null, user_id: 'u', language: 'zh' })).sort();
    assert.deepStrictEqual(defs, impls);
    assert.ok(defs.includes('get_food_sensitivity'));
});

test('no prompt names a tool that does not exist', () => {
    // §28g's rule: removing or adding a tool means auditing every prompt that names one, because
    // the formulation turn runs the SAME AGENTIC_TOOL_DEFS and an unknown tool burns a GENERATE
    // iteration. The \b is load-bearing — target_dots_min contains "get_dots_min".
    const real = new Set(AGENTIC_TOOL_DEFS.map(d => d.function.name));
    const files = [
        'prompts/chat/planTemplate.js', 'prompts/viva/judgeTemplate.js',
        'prompts/nano/systemFormulaGenerate.js', 'prompts/viva/systemFormulaGenerate.js',
        'prompts/chat/foodSensitivityBlock.js', 'prompts/chat/formulationPackageBlock.js',
        'prompts/nano/chat/nutrition.js', 'prompts/viva/chat/nutrition.js',
    ];
    for (const f of files) {
        for (const m of read(f).matchAll(/\bget_[a-z_]+/g)) {
            assert.ok(real.has(m[0]), `${f} names a nonexistent tool: ${m[0]}`);
        }
    }
});

const PANEL = {
    id: 7, panel_key: 'igg_120', unit: 'U/mL',
    sampled_at: '2026-04-15', report_date: '2026-04-23', institution: null,
};
const RESULTS = [
    { food_key: 'casein', value: '52.8', below_detection: false, class: 1, name_zh: '酪蛋白',
      name_en: 'Casein', category: 'dairy_egg', aliases: ['干酪素'],
      common_sources_zh: ['牛奶', '奶酪'], substitutes_zh: ['豆浆', '鸡蛋'] },
    { food_key: 'cow_milk', value: '50.9', below_detection: false, class: 1, name_zh: '牛奶',
      name_en: 'Cow milk', category: 'dairy_egg', aliases: ['牛乳'],
      common_sources_zh: [], substitutes_zh: [] },
    { food_key: 'watermelon', value: null, below_detection: true, class: 0, name_zh: '西瓜',
      name_en: 'Watermelon', category: 'fruit', aliases: [], common_sources_zh: [], substitutes_zh: [] },
];
const stubPool = ({ panels = [PANEL], results = RESULTS } = {}) => ({
    query: async (sql) => ({ rows: /food_sensitivity_panels/.test(sql) ? panels : results }),
});
const tool = (opts, args) => createAgenticToolHandlers({ pool: stubPool(opts), user_id: 'u', language: 'zh' })
    .get_food_sensitivity(args);

test('the result is a FLAT array and every row is tagged with a kind', async () => {
    // extractToolGroundTruth normalises with Array.isArray(data) ? data : ... — a {panel, items}
    // wrapper would be treated as ONE row and harvest nothing, so the real panel dates would never
    // reach extraValidDates and verifyBiomarkerGrounding would rewrite a correct answer away.
    const r = await tool();
    assert.ok(Array.isArray(r.data), 'the result must be a flat array');
    for (const row of r.data) assert.ok(row.kind, `row without kind: ${JSON.stringify(row)}`);
    assert.deepStrictEqual([...new Set(r.data.map(x => x.kind))], ['panel', 'restriction']);
});

test('only class >= 1 becomes a restriction, and the panel row reports the totals', async () => {
    const r = await tool();
    const panel = r.data.find(x => x.kind === 'panel');
    assert.strictEqual(panel.foods_tested, 3);
    assert.strictEqual(panel.foods_with_sensitivity, 2);
    assert.strictEqual(r.data.filter(x => x.kind === 'restriction').length, 2);
});

test('the panel row states that IgG is not an acute allergy', async () => {
    const panel = (await tool()).data.find(x => x.kind === 'panel');
    assert.match(panel.note, /IgE/);
    assert.match(panel.note, /不要/);
});

test('the avoidance window and its expiry are resolved server-side', async () => {
    const casein = (await tool()).data.find(x => x.food === '酪蛋白');
    assert.strictEqual(casein.avoid_until, '2026-05-23');
    assert.strictEqual(casein.window_has_passed, true, 'a 2026-04 report is long past its 1-month window');
    assert.match(casein.guidance, /1 个月/);
    assert.strictEqual(casein.severity_text, '轻度慢性过敏（1级）');
    assert.deepStrictEqual(casein.eat_instead, ['豆浆', '鸡蛋']);
});

test('a specific lookup answers from the panel, through declared aliases only', async () => {
    const r = await tool(undefined, { foods: ['牛乳', '西瓜'] });
    const milk = r.data.find(x => x.kind === 'result' && x.food === '牛奶');
    assert.strictEqual(milk.class, 1);
    const melon = r.data.find(x => x.kind === 'result' && x.food === '西瓜');
    assert.strictEqual(melon.class, 0);
    // The lab declined to measure below its detection limit, so there is no number to quote.
    assert.strictEqual(melon.below_detection, true);
    assert.strictEqual(melon.value, null);
});

test('a food the panel never covered is reported as untested, never as safe', async () => {
    const r = await tool(undefined, { foods: ['火龙果'] });
    const row = r.data.find(x => x.kind === 'not_tested');
    assert.strictEqual(row.food, '火龙果');
    assert.match(row.note, /不要据此说它安全/);
});

test('no panel yields one explicit no_panel row, never an empty array', async () => {
    // Handed `[]`, the model narrated a report that does not exist — 「根据你最新的慢性食物
    // 敏感性检测报告，鸡蛋未被纳入检测项目」 for a user with no panel (dev, 2026-09-15). A
    // sentence saying there is no record is not an invitation to fill it in; `[]` was.
    const r = await tool({ panels: [] });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.data) && r.data.length === 1, 'still a flat array, per §40');
    assert.equal(r.data[0].kind, 'no_panel');
    assert.match(r.data[0].note, /没有上传过/);
    assert.match(r.data[0].note, /未被纳入检测/); // the exact phrasing it must not use is named
});

test('panel dates survive the round trip through extractToolGroundTruth', async () => {
    // The 16:00-Shanghai trap: formatToShanghai returns an offsetless string that addDate
    // re-parses in the process timezone and re-applies +8 to, so any timestamp at or after 16:00
    // lands a day late. Date-only strings are parsed as UTC midnight, so the round trip is exact.
    const r = await tool();
    const { dates } = extractToolGroundTruth([
        { tool: 'get_food_sensitivity', args: {}, result: r },
    ]);
    for (const d of ['2026-04-15', '2026-04-23', '2026-05-23']) {
        assert.ok(dates.includes(d), `${d} did not survive; got ${dates.join(',')}`);
    }
});

test('a timestamp at the 16:00-Shanghai boundary is still allowlisted on its own day', async () => {
    const r = await tool({ panels: [{ ...PANEL, report_date: '2026-04-23', sampled_at: '2026-04-15' }] });
    const { dates } = extractToolGroundTruth([{ tool: 'get_food_sensitivity', args: {}, result: r }]);
    assert.ok(!dates.includes('2026-04-24'), 'a date drifted forward a day');
    assert.ok(!dates.includes('2026-04-16'), 'a date drifted forward a day');
});

// ── the prompt block ────────────────────────────────────────────────────────────────────────
test('the block is empty when the user has no panel, and present when they do', () => {
    assert.strictEqual(getFoodSensitivityBlock(false, true), '');
    assert.strictEqual(getFoodSensitivityBlock(false, false), '');
    assert.ok(getFoodSensitivityBlock(true, true).includes('get_food_sensitivity'));
    assert.ok(getFoodSensitivityBlock(true, false).includes('get_food_sensitivity'));
});

test('the RENDERED block states no avoidance window of its own', () => {
    // What a class means and how long a food is stopped live in lib/foodSensitivity.js's
    // CLASS_WINDOWS and reach the model already written on the tool row. A prompt restating them
    // would be a second definition of a clinical instruction, in the one medium where drift is
    // invisible. The file's own header comment may discuss them; the rendered block may not.
    for (const isZh of [true, false]) {
        const b = getFoodSensitivityBlock(true, isZh);
        assert.ok(!/\d\s*个月/.test(b), 'the zh block states a month window');
        assert.ok(!/\b\d+\s*months?\b/i.test(b), 'the en block states a month window');
        assert.ok(!/每\s*\d+\s*天/.test(b), 'the block states a rotation interval');
    }
});

test('the block forbids calling an IgG result an acute allergy', () => {
    assert.match(getFoodSensitivityBlock(true, true), /不是急性过敏/);
    assert.match(getFoodSensitivityBlock(true, false), /not an acute allergy/i);
});

test('handlers/chat.js promotes a food question out of casual_chat and formulate_dots', () => {
    // casual_chat is not in HIGH_RISK_INTENTS and has no tools at all, so the one question the
    // panel exists to answer would be answered from nothing. Asserted on the invariant rather
    // than an exact string, so a reworded condition that still covers both intents passes.
    const src = read('handlers/chat.js');
    const i = src.indexOf('messageAsksAboutFoodSensitivity(message)');
    assert.ok(i > 0, 'the override is missing entirely');
    const window = src.slice(i, i + 400);
    assert.ok(window.includes("'formulate_dots'"), 'formulate_dots is not promoted');
    assert.ok(window.includes("'casual_chat'"), 'casual_chat is not promoted');
    assert.ok(window.includes("intent = 'nutrition_question'"), 'it does not promote to nutrition_question');
});

test('the tool casts every DATE column to ::text in SQL', () => {
    // The TZ-independent form of the test above, and the actual invariant. node-postgres parses a
    // DATE at LOCAL midnight, which serialises to a UTC instant — CLAUDE.md §35 records
    // scheduled_date for 2026-08-16 shipping as "2026-08-15T16:00:00.000Z". Casting in SQL is the
    // documented fix; the assertion above only catches this on a UTC machine.
    const src = read('lib/agenticTools.js');
    const i = src.indexOf('async get_food_sensitivity');
    const body = src.slice(i, src.indexOf('\n        },\n', i));
    for (const col of ['sampled_at', 'report_date']) {
        assert.ok(body.includes(`${col}::text`), `${col} is not cast to ::text`);
    }
    // `today` legitimately goes through formatToShanghai — it converts a live Date, which is
    // exact. What must never happen is a DB-derived date being emitted that way: formatToShanghai
    // returns an offsetless string, and addDate re-parses it in the process timezone (UTC on FC)
    // before applying +8 again, so anything at or after 16:00 Shanghai lands a day late.
    assert.ok(!/report_date:\s*dateOnly|sampled_at:\s*dateOnly|avoid_until:\s*dateOnly/.test(body),
        'a panel date is being pushed through dateOnly instead of arriving as ::text');
});

test('every t.* key the twin WXML uses resolves in BOTH language blocks', () => {
    // WXML has no compile-time key checking: a key missing from one block renders as empty text
    // in that language only, which is invisible until a user switches. §34 makes this a coupling
    // rule; the food-sensitivity section adds ten keys to it.
    const vm = require('node:vm');
    const dir = path.join(__dirname, '..', 'src', 'mini', 'nano-miniapp', 'components', 'user-health');
    const js = fs.readFileSync(path.join(dir, 'user-health.js'), 'utf8');
    const wxml = fs.readFileSync(path.join(dir, 'user-health.wxml'), 'utf8');
    const open = js.indexOf('{', js.indexOf('const T = {'));
    let depth = 0, end = open;
    for (let i = open; i < js.length; i++) {
        if (js[i] === '{') depth++;
        else if (js[i] === '}' && --depth === 0) { end = i + 1; break; }
    }
    const T = vm.runInNewContext('(' + js.slice(open, end) + ')');
    const used = [...new Set([...wxml.matchAll(/\{\{t\.(\w+)/g)].map(m => m[1]))];
    assert.ok(used.length > 50, `only found ${used.length} keys — the WXML scan is broken`);
    for (const k of used) {
        assert.ok(k in T.zh, `t.${k} is missing from T.zh`);
        assert.ok(k in T.en, `t.${k} is missing from T.en`);
    }
    for (const k of ['foodPanelTitle', 'foodClass', 'foodSubstitutes', 'foodPanelNote',
                     'foodAvoidUntil', 'foodWindowPassed', 'foodBelowDetection']) {
        assert.ok(k in T.zh && k in T.en, `t.${k} is not in both blocks`);
    }
    assert.strictEqual(T.zh.foodClass.length, 4, 'foodClass must cover classes 0-3');
    assert.strictEqual(T.en.foodClass.length, 4);
});
