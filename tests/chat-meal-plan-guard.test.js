// The deterministic guard that keeps a request for FOOD out of the Formulate-Dots tool.
// 「也给我订制一周的营养餐」 launched a 28-day dots formulation on prod (2026-09-14). Mirrors the
// trigger tests in chat-formulation-package-tool.test.js — same failure class (a misclassified
// intent is a wrong ACTION, not a degraded answer), same remedy.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { messageAsksForMealPlan } = require('../src/functions/worker/prompts/chat/mealPlanRequest');
const { messageAsksAboutFormulationPackage } = require('../src/functions/worker/prompts/chat/formulationPackageBlock');

const WORKER = path.join(__dirname, '..', 'src', 'functions', 'worker');

test('meal / diet requests trigger the guard', () => {
    const asks = [
        '也给我订制一周的营养餐', '给我定制一周营养餐', '帮我安排一下饮食计划', '有没有推荐的食谱',
        '这周的菜单怎么吃', '早餐吃什么好', '一日三餐怎么搭配', '给我一份减脂餐',
        'make me a meal plan for the week', 'can you give me some recipes', 'what should I eat this week',
        'what should I have for dinner',
    ];
    for (const m of asks) assert.ok(messageAsksForMealPlan(m), `should trigger on: ${m}`);
});

test('the guard does NOT match dots-formulation requests or the tool trigger message', () => {
    // Read the trigger out of handlers/dots.js so a reworded trigger is caught here.
    const src = fs.readFileSync(path.join(WORKER, 'handlers', 'dots.js'), 'utf8');
    assert.ok(src.includes('请根据我的完整健康数据，为我配置一个 ${PLAN_DAYS} 天周期的 Dots 方案。'),
        'the formulation trigger message moved — update this test with it');

    const requests = [
        '请根据我的完整健康数据，为我配置一个 28 天周期的 Dots 方案。',
        'Please formulate a 28-day Dots plan based on my complete health data.',
        '我要定制营养素', '帮我配制我的方案', '给我做一份定制配方', '重新配一次',
        'make me a custom formula', 'I want to order custom dots',
        // a purchased package is not a meal — 套餐 must not be caught by any 餐 term
        '我已经买了什么原粒套餐', '有哪些套餐', '轻享套装是什么',
        '我最近睡不好', 'What does DOT-N5 do?',
    ];
    for (const m of requests) assert.ok(!messageAsksForMealPlan(m), `should NOT trigger on: ${m}`);
});

test('the guard and the package guard are disjoint on their own examples', () => {
    // Both demote formulate_dots to nutrition_question, so overlap is harmless — but a package
    // question matching the meal regex would mean 餐 is leaking through 套餐.
    for (const m of ['我已经买了什么原粒套餐', '有哪些套餐', '我的订单到哪了']) {
        assert.ok(messageAsksAboutFormulationPackage(m));
        assert.ok(!messageAsksForMealPlan(m), `package question leaked into meal guard: ${m}`);
    }
});

test('handlers/chat.js wires the guard in front of the launch_tool branch', () => {
    const src = fs.readFileSync(path.join(WORKER, 'handlers', 'chat.js'), 'utf8');
    const guard = src.indexOf("messageAsksForMealPlan(message) && intent === 'formulate_dots'");
    const launch = src.indexOf("launch_tool: 'formula_dots'");
    assert.ok(guard > 0, 'guard not wired');
    assert.ok(guard < launch, 'guard must run before the launch_tool return');
});

test('the classifier prompt names meal plans as nutrition_question', () => {
    const prompt = require('../src/functions/worker/prompts/chat/intentClassifier')('x');
    assert.match(prompt, /meal plan/);
    assert.match(prompt, /营养餐/);
});
