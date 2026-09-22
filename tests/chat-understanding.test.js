// The UNDERSTAND step (§47) that replaces the closed-enum intent classifier: its prompt, the
// needs → required_data mapping, the three-mode switch, and the wiring in handlers/chat.js that
// decides which router wins and which of the old regex backstops still apply. Offline — no DB,
// no LLM (the client is stubbed).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const understandingTemplate = require('../src/functions/worker/prompts/chat/understanding');
const {
    runUnderstanding, fetchUnderstandingInputs, understandingMode, resolvedRequestLine,
    requiredDataFrom, VALID_ROUTES,
} = require('../src/functions/worker/lib/understanding');

const WORKER = path.join(__dirname, '..', 'src', 'functions', 'worker');
const read = (p) => fs.readFileSync(path.join(WORKER, p), 'utf8');

const OK = {
    reasoning: 'r', request: '用户想要一份运动方案', family: 'advice_plan', topics: ['exercise'],
    continuation_of: null, needs: { required: ['get_health_twin'], helpful: [] }, actions: [],
    must_not: [], success_criteria: ['给出可执行的周计划'], confidence: 0.9, clarify: null,
    route: 'lifestyle_question',
};
const stubClient = (content, opts = {}) => ({
    chat: { completions: { create: async (params, reqOpts) => {
        if (opts.onCall) opts.onCall(params, reqOpts);
        if (opts.throws) throw new Error(opts.throws);
        return { choices: [{ message: { content } }], usage: { total_tokens: 3100 } };
    } } },
});

// ── 1. the prompt ───────────────────────────────────────────────────────────────────────────
test('the prompt carries the message, the prior turns and the user state', () => {
    const p = understandingTemplate({
        message: '那运动呢？',
        history: [{ role: 'user', content: '给我配餐' }, { role: 'ai', content: '一周营养餐……' }],
        state: { language: 'zh', has_kino: true, has_wearable: false, has_nutrition_plan: true, facts: ['不吃猪肉'], health_plans: ['代谢重启'] },
    });
    assert.ok(p.includes('那运动呢？'));
    assert.ok(p.includes('USER: 给我配餐') && p.includes('ASSISTANT: 一周营养餐……'));
    assert.ok(p.includes('has_kino_test=true') && p.includes('has_wearable=false'));
    assert.ok(p.includes('不吃猪肉') && p.includes('代谢重启'));
    // These three inputs are the whole point: the classifier had none of them.
    const bare = require('../src/functions/worker/prompts/chat/intentClassifier')('那运动呢？');
    assert.ok(!bare.includes('给我配餐'));
});

test('the prompt degrades cleanly with no history and no state', () => {
    const p = understandingTemplate({ message: '你好' });
    assert.ok(p.includes('(no earlier turns)') && p.includes('(unknown)'));
});

test('the route set is exactly the prompt maps, plus the launch-tool route', () => {
    const offered = [...understandingTemplate({ message: 'x' }).matchAll(/^- ([a-z_]+)\s+— /gm)].map(m => m[1]);
    assert.deepStrictEqual(offered.filter(r => VALID_ROUTES.has(r)).sort(), [...VALID_ROUTES].sort(),
        'the prompt must offer every valid route');
    const src = read('handlers/chat.js');
    const map = src.slice(src.indexOf('const vivaPrompts = {'), src.indexOf('};', src.indexOf('const vivaPrompts = {')));
    const keys = [...map.matchAll(/^\s{4}([a-z_]+):\s+require/gm)].map(m => m[1]);
    // formulate_dots has no template on purpose: it hands the turn to the miniapp's formulation
    // tool, and degrades to nutrition_question everywhere else.
    assert.deepStrictEqual([...VALID_ROUTES].sort(), [...keys, 'formulate_dots'].sort());
});

// ── 2. needs → required_data ────────────────────────────────────────────────────────────────
test('only the needs that gate an optional fetch are mapped', () => {
    assert.deepStrictEqual(requiredDataFrom({ required: ['get_weight_history', 'get_health_plan'], helpful: [] }).sort(), ['plan', 'weight_history']);
    // Unconditional fetches (biomarkers, dots, twin, facts) map to nothing — listing them is a no-op.
    assert.deepStrictEqual(requiredDataFrom({ required: ['get_biomarkers', 'get_dots', 'get_health_twin'], helpful: [] }), []);
    assert.deepStrictEqual(requiredDataFrom(undefined), []);
    assert.deepStrictEqual(requiredDataFrom({ required: 'not-an-array' }), []);
});

test('the store catalog needs a REQUIRED need — "helpful" is not the user asking (§37)', () => {
    assert.deepStrictEqual(requiredDataFrom({ required: ['store_products'], helpful: [] }), ['store_products']);
    assert.deepStrictEqual(requiredDataFrom({ required: [], helpful: ['store_products'] }), []);
    // …while an ordinary context fetch is happy with helpful.
    assert.deepStrictEqual(requiredDataFrom({ required: [], helpful: ['get_health_plan'] }), ['plan']);
});

// ── 3. running it ───────────────────────────────────────────────────────────────────────────
test('a well-formed understanding routes and carries its own bounded timeout', async () => {
    let seen = null;
    const r = await runUnderstanding({ client: stubClient(JSON.stringify(OK), { onCall: (p, o) => { seen = { p, o }; } }), message: '给我运动方案' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.route, 'lifestyle_question');
    assert.strictEqual(r.understanding.request, '用户想要一份运动方案');
    assert.strictEqual(seen.p.model, 'qwen3.8-flash');
    assert.strictEqual(seen.p.enable_thinking, false, 'with thinking on, qwen3.8-flash took 15–45s and blew the timeout on every call');
    assert.ok(seen.o.timeout > 0 && seen.o.timeout <= 60000, 'a stalled understanding must not eat the invocation');
});

test('UNDERSTANDING_THINKING=on is the only way to turn the model\'s reasoning back on', async () => {
    const prev = process.env.UNDERSTANDING_THINKING;
    try {
        for (const [set, want] of [['on', true], ['ON', true], ['off', false], ['yes', false]]) {
            process.env.UNDERSTANDING_THINKING = set;
            let seen = null;
            await runUnderstanding({ client: stubClient(JSON.stringify(OK), { onCall: (p) => { seen = p; } }), message: 'x' });
            assert.strictEqual(seen.enable_thinking, want, set);
        }
    } finally {
        if (prev === undefined) delete process.env.UNDERSTANDING_THINKING; else process.env.UNDERSTANDING_THINKING = prev;
    }
});

test('fenced JSON is accepted', async () => {
    const r = await runUnderstanding({ client: stubClient('```json\n' + JSON.stringify(OK) + '\n```'), message: 'x' });
    assert.strictEqual(r.ok, true);
});

test('every failure shape returns ok:false so the caller falls back to the classifier', async () => {
    for (const content of ['not json at all', JSON.stringify({ ...OK, route: 'exercise_plan' }), JSON.stringify({ ...OK, route: undefined })]) {
        const r = await runUnderstanding({ client: stubClient(content), message: 'x' });
        assert.strictEqual(r.ok, false, `should reject: ${content.slice(0, 40)}`);
    }
    const thrown = await runUnderstanding({ client: stubClient('', { throws: 'timeout of 25000ms exceeded' }), message: 'x' });
    assert.strictEqual(thrown.ok, false);
});

// ── 4. the mode switch ──────────────────────────────────────────────────────────────────────
test('the mode defaults to shadow, so deploying this code changes nothing on its own', () => {
    const prev = process.env.CHAT_UNDERSTANDING_MODE;
    try {
        delete process.env.CHAT_UNDERSTANDING_MODE;
        assert.strictEqual(understandingMode(), 'shadow');
        for (const [set, want] of [['on', 'on'], ['off', 'off'], ['ON', 'on'], ['nonsense', 'shadow'], ['', 'shadow']]) {
            process.env.CHAT_UNDERSTANDING_MODE = set;
            assert.strictEqual(understandingMode(), want);
        }
    } finally {
        if (prev === undefined) delete process.env.CHAT_UNDERSTANDING_MODE; else process.env.CHAT_UNDERSTANDING_MODE = prev;
    }
});

// ── 5. the one line that reaches GENERATE ───────────────────────────────────────────────────
test('only a continuation gets the resolved-request line', () => {
    assert.strictEqual(resolvedRequestLine({ ok: true, understanding: { ...OK } }), null);
    assert.strictEqual(resolvedRequestLine({ ok: false, understanding: { ...OK, continuation_of: '配餐' } }), null);
    const line = resolvedRequestLine({ ok: true, understanding: { ...OK, continuation_of: '上一轮的一周营养餐', request: '用户想要与餐单配套的运动安排' } });
    assert.ok(line.includes('用户想要与餐单配套的运动安排') && line.includes('上一轮的一周营养餐'));
    // Round 2 of the e2e comparison: the FULL understanding in the system prompt made same-route
    // replies worse. Nothing but the resolved request may go in.
    assert.ok(!line.includes(OK.family) && !line.includes(OK.success_criteria[0]));
});

// ── 6. the inputs query ─────────────────────────────────────────────────────────────────────
test('prior turns come back oldest-first, and a query failure degrades instead of throwing', async () => {
    const pool = { query: async (sql) => {
        if (/FROM chat_messages/.test(sql)) return { rows: [{ role: 'ai', content: 'b' }, { role: 'user', content: 'a' }] };
        return { rows: [{ language: 'zh', has_kino: true, has_wearable: false, has_nutrition_plan: false, facts: ['不吃猪肉'], health_plans: [null, '代谢重启'] }] };
    } };
    const got = await fetchUnderstandingInputs(pool, 'u1', 'viva');
    assert.deepStrictEqual(got.history.map(h => h.content), ['a', 'b']);
    assert.deepStrictEqual(got.state.health_plans, ['代谢重启']);

    const broken = { query: async () => { throw new Error('pool down'); } };
    const degraded = await fetchUnderstandingInputs(broken, 'u1', 'viva');
    assert.deepStrictEqual(degraded.history, []);
    // null — NOT a row of falses, which would tell the model this user has no ring and no test.
    assert.strictEqual(degraded.state, null);
    assert.ok(understandingTemplate({ message: 'x', state: degraded.state }).includes('(unknown)'));
});

// ── 7. the wiring in handlers/chat.js ───────────────────────────────────────────────────────
test('the handler runs the understanding, and lets it route only in mode "on"', () => {
    const src = read('handlers/chat.js');
    assert.ok(src.includes("require('../lib/understanding')"));
    assert.ok(/const understandingRoutes = uMode === 'on' && !!understanding\?\.ok;/.test(src));
    // The classifier still runs whenever the understanding is not routing — shadow mode and every
    // failure path — so there is always an intent.
    assert.ok(src.includes('if (!understandingRoutes) {'));
    assert.ok(src.includes('intentClassifierTemplate(message)'));
});

test('the classifier-era promotions are off when the understanding routed; the formulate_dots demotions are not', () => {
    const src = read('handlers/chat.js');
    const block = src.slice(src.indexOf('messageAsksAboutFormulationPackage(message)'), src.indexOf("if (intent === 'formulate_dots') {"));
    // promotions out of casual_chat / nutrition_question: classifier only
    assert.ok(block.includes("(!understandingRoutes && intent === 'casual_chat')"));
    assert.ok(block.includes("!understandingRoutes && messageAsksAboutWearable(message)"));
    assert.ok(block.includes("(!understandingRoutes && (intent === 'nutrition_question' || intent === 'casual_chat'))"));
    // demotions away from formulate_dots: always, in both modes — that route starts a real formulation
    for (const guard of ['messageAsksAboutFormulationPackage', 'messageAsksAboutFoodSensitivity', 'messageAsksForLifestylePlan']) {
        const at = block.indexOf(guard);
        assert.ok(block.slice(at, at + 260).includes("intent === 'formulate_dots'"), `${guard} must still demote formulate_dots`);
    }
    assert.ok(block.includes("if (messageAsksForMealPlan(message) && intent === 'formulate_dots')"));
});

test('disagreements are logged after the backstops, and the resolved request reaches the system prompt', () => {
    const src = read('handlers/chat.js');
    const iDisagree = src.indexOf("msg: 'route_disagreement'");
    assert.ok(iDisagree > src.indexOf('messageAsksForLifestylePlan(message)'), 'must compare what actually shipped');
    assert.ok(iDisagree < src.indexOf("if (intent === 'formulate_dots') {"));
    assert.ok(src.includes("understandingRoutes ? (resolvedRequestLine(understanding) || '') : ''"));
});

test('in shadow mode the two routers run concurrently — the extra call must not add to the wait', () => {
    const src = read('handlers/chat.js');
    assert.ok(src.includes("const classifierPromise = uMode === 'on' ? null : runClassifier();"));
    const iClassifier = src.indexOf('const classifierPromise =');
    const iAwait = src.indexOf('const understanding = understandingPromise ? await understandingPromise : null;');
    assert.ok(iClassifier < iAwait, 'the classifier must be in flight before the understanding is awaited');
});

test('the prompt reserves store_products for "what could I obtain", not for an order (§37)', () => {
    const p = understandingTemplate({ message: 'x' });
    assert.ok(p.includes('"store_products" is ONLY for a user asking what they could obtain'));
    assert.ok(p.includes('never for an order, a delivery, a package they already bought, or a price'));
});
