// The three guards added after 「根据我的情况定制运动方案」 came back as a 盒马 grocery-substitution
// list on prod (2026-09-22): a missing lifestyle intent, a PLAN-forced grocery tool on a non-food
// message, and a JUDGE that graded facts but never relevance. Offline — no DB, no LLM.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { messageAsksForLifestylePlan } = require('../src/functions/worker/prompts/chat/lifestyleRequest');
const { messageAsksForMealPlan, messageMentionsFood } = require('../src/functions/worker/prompts/chat/mealPlanRequest');
const { messageAsksAboutFormulationPackage } = require('../src/functions/worker/prompts/chat/formulationPackageBlock');
const { buildForcedToolQueue } = require('../src/functions/worker/lib/agenticChat');
const planTemplate = require('../src/functions/worker/prompts/chat/planTemplate');
const judgeTemplate = require('../src/functions/worker/prompts/viva/judgeTemplate');
const intentClassifier = require('../src/functions/worker/prompts/chat/intentClassifier');

const WORKER = path.join(__dirname, '..', 'src', 'functions', 'worker');
const read = (p) => fs.readFileSync(path.join(WORKER, p), 'utf8');

// ── 1. the intent ───────────────────────────────────────────────────────────────────────────
test('lifestyle-plan requests trigger the guard, in both languages', () => {
    for (const m of [
        '根据我的情况定制运动方案', '根据我的情况 提供运动方案', '给我一个运动计划', '帮我安排锻炼计划',
        '有什么健身建议', '给我制定跑步计划', '我的作息时间怎么调整', '帮我设计睡眠计划', '来个减压方案',
        'make me a workout plan', 'what is a good exercise routine for me', 'give me a running program',
        'help me with a sleep routine', 'design a strength training schedule',
    ]) assert.ok(messageAsksForLifestylePlan(m), `should trigger on: ${m}`);
});

test('the guard does NOT match food, dots, wearable or package questions', () => {
    for (const m of [
        '也给我订制一周的营养餐', '早餐吃什么好', '运动前要吃什么', '运动后HRV怎么样', '我昨晚睡得怎么样',
        '我要定制营养素', '帮我配制我的方案', '我已经买了什么原粒套餐', '我的订单到哪了',
        '请根据我的完整健康数据，为我配置一个 28 天周期的 Dots 方案。',
        'what should I eat before a run', 'how did I sleep', 'make me a custom formula',
    ]) assert.ok(!messageAsksForLifestylePlan(m), `should NOT trigger on: ${m}`);
});

test('lifestyle, meal-plan and package guards are disjoint on their own examples', () => {
    for (const m of ['根据我的情况定制运动方案', 'make me a workout plan']) {
        assert.ok(!messageAsksForMealPlan(m));
        assert.ok(!messageAsksAboutFormulationPackage(m));
    }
    for (const m of ['也给我订制一周的营养餐', '我已经买了什么原粒套餐']) {
        assert.ok(!messageAsksForLifestylePlan(m));
    }
});

test('handlers/chat.js demotes nutrition/casual/formulate_dots to lifestyle_question before the launch branch', () => {
    const src = read('handlers/chat.js');
    const guard = src.indexOf("messageAsksForLifestylePlan(message)");
    const launch = src.indexOf("launch_tool: 'formula_dots'");
    assert.ok(guard > 0, 'guard not wired');
    assert.ok(guard < launch, 'guard must run before the launch_tool return');
    assert.ok(src.includes("intent = 'lifestyle_question'"));
    assert.ok(/HIGH_RISK_INTENTS = new Set\(\[[^\]]*'lifestyle_question'/.test(src), 'lifestyle_question must take the agentic loop');
});

test('both personas have a lifestyle template registered in both prompt maps, and it carries no catalog', () => {
    for (const file of ['handlers/chat.js', 'index.js']) {
        const src = read(file);
        assert.ok(src.includes("lifestyle_question: require('") && src.match(/lifestyle_question: require\(/g).length === 2, `${file}: two maps`);
    }
    const ctx = {
        user_profile: { nickname: 'T', age: 51, bmi: 22, language: 'zh' },
        bioage: { BioAge: 39.2, ChronoAge: 51, AgeDifference: -11.8, SubAges: { CellularAge: 37.5, MetabolicAge: 41.5, MicroVascularAge: 38.3, ResilienceAge: 38.8 } },
        biomarkers: { hsCRP: 0.32 }, biomarkers_tested_at: '2026-05-20',
        health_twin: { avg_sleep_hours: 5.3, avg_daily_steps: 4347, avg_hrv_ms: 27.6 },
        grocery_suppliers: [{ supplier_key: 'hema', name_zh: '盒马' }],
        store_products: [{ sku_id: 'x', name: 'y' }],
        formulation_packages_available: true, food_sensitivity_available: true,
        now_iso: '2026-09-22T08:00:00Z',
    };
    for (const persona of ['viva', 'nano']) {
        const out = require(`../src/functions/worker/prompts/${persona}/chat/lifestyle`)(ctx);
        assert.ok(out.includes('4347') && out.includes('5.3'), `${persona}: wearable averages present`);
        for (const banned of ['get_grocery_products', 'recommend_grocery', 'recommend_product', 'formulate_dots', '盒马', 'get_formulation_packages']) {
            assert.ok(!out.includes(banned), `${persona}: lifestyle template must not mention ${banned}`);
        }
    }
});

test('the classifier prompt defines lifestyle_question and excludes it from nutrition_question', () => {
    const p = intentClassifier('x');
    assert.ok(p.includes('- lifestyle_question'));
    assert.ok(p.includes('根据我的情况定制运动方案'));
    assert.ok(/NOT nutrition_question: an exercise, sleep or daily-routine plan/.test(p));
});

// ── 2. PLAN and the forced-tool queue ──────────────────────────────────────────────────────
test('PLAN is told the grocery tool is for food questions only', () => {
    const p = planTemplate('根据我的情况定制运动方案', 'nutrition_question', { dots: [] }, [], []);
    assert.ok(p.includes('List get_grocery_products in tools_needed ONLY when the USER MESSAGE above itself asks what to eat'));
    assert.ok(p.includes('even when the conversation earlier contained a meal plan'));
});

test('messageMentionsFood is wide for food and silent for lifestyle/results', () => {
    for (const m of ['早餐吃什么好', '这个食材可以换成什么', '给我配餐', '盒马有卖吗', 'what should I eat', 'a recipe for dinner'])
        assert.ok(messageMentionsFood(m), `food: ${m}`);
    for (const m of ['根据我的情况定制运动方案', '我的检测结果怎么样', '运动效果如何', 'make me a workout plan', '我的订单到哪了'])
        assert.ok(!messageMentionsFood(m), `not food: ${m}`);
});

test('PLAN-requested get_grocery_products is forced only when the message mentions food', () => {
    const valid = new Set(['get_grocery_products', 'get_biomarker_history', 'get_health_twin']);
    // The exact prod shape: nutrition_question label, PLAN asked for the catalog, message is exercise.
    assert.deepStrictEqual(buildForcedToolQueue({ tools_needed: ['get_grocery_products'] }, '根据我的情况定制运动方案', valid, 2), []);
    // Food message: forced as before.
    assert.deepStrictEqual(buildForcedToolQueue({ tools_needed: ['get_grocery_products'] }, '给我配一周的营养餐', valid, 2), ['get_grocery_products']);
    // Other PLAN tools are unaffected by the gate.
    assert.deepStrictEqual(buildForcedToolQueue({ tools_needed: ['get_health_twin', 'get_grocery_products'] }, '根据我的情况定制运动方案', valid, 2), ['get_health_twin']);
    // Deterministic triggers still come first and still count against the cap.
    assert.deepStrictEqual(buildForcedToolQueue({ tools_needed: ['get_grocery_products'] }, '对比我最近两次检测，再给我配餐', valid, 2), ['get_biomarker_history', 'get_grocery_products']);
});

// ── 3. JUDGE relevance ─────────────────────────────────────────────────────────────────────
test('JUDGE carries the narrow off_topic category and it is material', () => {
    const p = judgeTemplate('draft', { intended_claims: [] }, {}, [], [], '根据我的情况定制运动方案');
    assert.ok(p.includes('- off_topic:'));
    assert.ok(p.includes('DELIBERATELY NARROW'));
    assert.ok(p.includes('An off_topic draft as narrowly defined above is also material'));
    assert.ok(p.includes('|off_topic"'), 'category must be in the JSON schema line');
});

test('REVISE reframes an off_topic verdict as a new answer to the user message, not a patch', () => {
    const src = read('lib/agenticChat.js');
    assert.ok(src.includes("v.category === 'off_topic'"));
    assert.ok(src.includes('Your previous reply answered the wrong question.'));
    // sanitizeJudgeVerdict must not filter the category: it only drops minor / llm_misattribution /
    // uncorroborated dot_mismatch / self-disregarded rows.
    const fn = src.slice(src.indexOf('function sanitizeJudgeVerdict'), src.indexOf('// Re-add the deterministic findings'));
    assert.ok(!fn.includes('off_topic'), 'sanitizer must leave off_topic alone');
});
