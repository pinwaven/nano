/**
 * get_formulation_packages — Viva can answer "what have I bought?" (CLAUDE.md §28g).
 *
 * The bug this defends against: a user asked 「我已经买了什么原粒套餐?」 and got a confident recap
 * of 17 dots "已激活并正在使用", read out of user_cartridges (the Neo dispenser's table, for
 * hardware §28d gated off) by a user with no active plan, nothing paid, and two orders sitting at
 * pending_payment. JUDGE passed it because the answer WAS grounded — in the wrong table.
 *
 * Every assertion here is a property that fails silently in production: a tool named by a prompt
 * but absent from the tool set, an order date rewritten as a fabrication, a turn that spends
 * every iteration on tool calls and replies with nothing, a stage vocabulary that drifted between
 * the two places allowed to define it.
 *
 * No DB, no network, no LLM.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const WORKER = path.join(ROOT, 'src', 'functions', 'worker');
const MINIAPP = path.join(ROOT, 'src', 'mini', 'nano-miniapp');

// Stub lib/db and lib/gcnClient BEFORE handlers/dots.js is required, so the real fetchers run
// against controllable data (tests/formulation-codes.test.js:20-48's idiom). Reassign the mutable
// bindings per test rather than re-stubbing — dots.js captures the exports object at require time.
const stub = (rel, exports) => {
    const full = require.resolve(path.join(WORKER, rel));
    require.cache[full] = { id: full, filename: full, loaded: true, exports };
};

let dbRows = {};
stub('lib/db.js', {
    pool: {
        query: async (sql) => {
            for (const [fragment, rows] of Object.entries(dbRows)) {
                if (sql.includes(fragment)) return { rows };
            }
            return { rows: [] };
        },
        connect: async () => { throw new Error('no transaction expected here'); },
    },
});

let gcnOrders = async () => [];
let gcnCodes = async () => [];
let gcnTiers = async () => [];
stub('lib/gcnClient.js', {
    fetchFormulationOrders: (...a) => gcnOrders(...a),
    fetchFormulationCodes: (...a) => gcnCodes(...a),
    fetchFormulationTiers: (...a) => gcnTiers(...a),
    fetchAiCatalog: async () => [],
    fetchFormulationOrderStatus: async () => ({}),
    submitFastTrackFormulation: async () => ({}),
    redeemFormulationCode: async () => ({}),
    gcnFetch: async () => ({}),
});

const D = require(path.join(WORKER, 'handlers', 'dots.js'));
const { AGENTIC_TOOL_DEFS, createAgenticToolHandlers } = require(path.join(WORKER, 'lib', 'agenticTools.js'));
const { extractToolGroundTruth, buildForcedToolQueue } = require(path.join(WORKER, 'lib', 'agenticChat.js'));
const pkgBlock = require(path.join(WORKER, 'prompts', 'chat', 'formulationPackageBlock.js'));
const vivaNutrition = require(path.join(WORKER, 'prompts', 'viva', 'chat', 'nutrition.js'));
const nanoNutrition = require(path.join(WORKER, 'prompts', 'nano', 'chat', 'nutrition.js'));

const TOOL_NAMES = new Set(AGENTIC_TOOL_DEFS.map(t => t.function.name));
const handlers = (language = 'zh') => createAgenticToolHandlers({ pool: null, user_id: 'u1', language });

function reset() {
    dbRows = {};
    gcnOrders = async () => [];
    gcnCodes = async () => [];
    gcnTiers = async () => [];
}

// ── The trigger regex ─────────────────────────────────────────────────────────────────────────

test('the trigger regex catches a purchase question in both languages', () => {
    const asking = [
        '我已经买了什么原粒套餐?', '我的订单到哪了', '发货了吗', '有哪些套餐',
        '我买了臻选套装吗', '我的兑换码还能用吗', '订单付款了吗', '物流到哪了',
        'what did I buy', 'where is my order', 'has it shipped',
        'which packages do you sell', 'I already bought a package', 'tracking number?',
    ];
    for (const m of asking) {
        assert.ok(pkgBlock.messageAsksAboutFormulationPackage(m), `should trigger on: ${m}`);
    }
});

test('the trigger regex does NOT match the Formulate-Dots trigger message', () => {
    // handlers/dots.js drives runAgenticTurn with these exact strings. Matching one would force an
    // irrelevant tool call into a formulation turn AND — via the override in handlers/chat.js —
    // stop the tool from ever launching. Read them out of the source so a reworded trigger is
    // caught here rather than in production.
    const src = fs.readFileSync(path.join(WORKER, 'handlers', 'dots.js'), 'utf8');
    const zh = src.match(/请根据我的完整健康数据，为我配置一个 \$\{PLAN_DAYS\} 天周期的 Dots 方案。/);
    const en = src.match(/Please formulate a \$\{PLAN_DAYS\}-day Dots plan based on my complete health data\./);
    assert.ok(zh && en, 'the formulation trigger messages moved — update this test with them');

    const requests = [
        '请根据我的完整健康数据，为我配置一个 28 天周期的 Dots 方案。',
        'Please formulate a 28-day Dots plan based on my complete health data.',
        '我要定制营养素', '帮我配制我的方案', '给我做一份定制配方', '重新配一次',
        'make me a custom formula', '我最近睡不好', 'What does DOT-N5 do?',
    ];
    for (const m of requests) {
        assert.ok(!pkgBlock.messageAsksAboutFormulationPackage(m), `should NOT trigger on: ${m}`);
    }
});

// ── The tool set ──────────────────────────────────────────────────────────────────────────────

test('every declared tool has a handler and every handler is declared', () => {
    const impl = new Set(Object.keys(handlers()));
    assert.deepEqual([...TOOL_NAMES].filter(n => !impl.has(n)), [], 'declared with no handler');
    assert.deepEqual([...impl].filter(n => !TOOL_NAMES.has(n)), [], 'handler never declared');
    assert.ok(TOOL_NAMES.has('get_formulation_packages'));
    assert.ok(!TOOL_NAMES.has('get_dot_inventory'),
        'get_dot_inventory reads the gated-off dispenser table and is what answered a purchase question wrongly');
});

test('no prompt instructs the model to call a tool that does not exist', () => {
    // This is the test that catches removing a tool without removing the prompts that name it —
    // three shipping prompts named get_dot_inventory, and the formulation turn runs the SAME
    // AGENTIC_TOOL_DEFS, so leaving one would burn a GENERATE iteration on `unknown tool`.
    // \b matters: target_dots_min contains "get_dots_min" without the boundary.
    const files = [
        'prompts/chat/planTemplate.js',
        'prompts/viva/judgeTemplate.js',
        'prompts/chat/formulationPackageBlock.js',
        'prompts/nano/systemFormulaGenerate.js',
        'prompts/viva/systemFormulaGenerate.js',
    ];
    for (const f of files) {
        const named = new Set(fs.readFileSync(path.join(WORKER, f), 'utf8').match(/\bget_[a-z_]+/g) || []);
        const dangling = [...named].filter(n => !TOOL_NAMES.has(n));
        assert.deepEqual(dangling, [], `${f} names tools that do not exist: ${dangling.join(', ')}`);
    }
});

// ── The tool result ───────────────────────────────────────────────────────────────────────────

const ORDER = {
    order_id: 'o-1', status: 'pending_payment', created_at: '2026-08-30T14:00:00.000Z',
    fulfillment: 'fast_track', package_name: '原粒 · 定制营养素 · 28天', tier_label: '臻选套装',
    max_distinct_dots: 8, nano_nutrition_plan_id: null, intended_nano_plan_id: null,
};

test('the result is a FLAT array of kinded rows, never a wrapper object', () => {
    // extractToolGroundTruth normalises with Array.isArray(data) ? data : … — a wrapper object is
    // treated as ONE row and nothing is harvested from it.
    reset();
    gcnOrders = async () => [ORDER];
    gcnCodes = async () => [{ code: 'X', sku_id: 's1', package_name: 'P', tier_label: '轻享套装', max_distinct_dots: 6, fulfillment: 'fast_track', sold_at: '2026-09-01T02:00:00.000Z' }];
    gcnTiers = async () => [{ tier_label: '轻享套装', package_name: 'P', tier_description: '基础均衡', max_distinct_dots: 6 }];

    return handlers().get_formulation_packages().then((res) => {
        assert.equal(res.ok, true);
        assert.ok(Array.isArray(res.data), 'data must be an array, not a {packages, codes, tiers} wrapper');
        for (const row of res.data) {
            assert.ok(['package', 'code', 'tier'].includes(row.kind), `every row needs a kind: ${JSON.stringify(row)}`);
        }
        assert.deepEqual(res.data.map(r => r.kind), ['package', 'code', 'tier']);
    });
});

test('order dates survive into extractToolGroundTruth, including across the 16:00 Shanghai boundary', () => {
    // formatToShanghai emits an OFFSETLESS string and addDate re-parses it with new Date(), so a
    // full timestamp gets +8 applied twice and every instant at or after 16:00 UTC lands on the
    // wrong day. Date-only is parsed as UTC midnight by spec, so the round trip is exact.
    reset();
    gcnOrders = async () => [
        { ...ORDER, order_id: 'o-a', created_at: '2026-08-30T15:59:00.000Z' }, // 2026-08-30 23:59 SH
        { ...ORDER, order_id: 'o-b', created_at: '2026-08-30T16:00:00.000Z' }, // 2026-08-31 00:00 SH
    ];

    return handlers().get_formulation_packages().then((res) => {
        const dates = res.data.filter(r => r.kind === 'package').map(r => r.ordered_at);
        assert.deepEqual(dates, ['2026-08-31', '2026-08-30'],
            'ordered_at must be the Shanghai calendar day, date-only');

        const { dates: harvested } = extractToolGroundTruth([
            { tool: 'get_formulation_packages', args: {}, result: res },
        ]);
        for (const d of dates) {
            assert.ok(harvested.includes(d),
                `${d} must reach extraValidDates, or verifyBiomarkerGrounding rewrites a correct answer away`);
        }
    });
});

test('no row carries an id, a code or a price the model could leak', () => {
    reset();
    gcnOrders = async () => [ORDER];
    gcnCodes = async () => [{ code: 'WVB-SECRET', sku_id: 's1', package_name: 'P', tier_label: 'T', max_distinct_dots: 6, fulfillment: 'fast_track', sold_at: '2026-09-01T02:00:00.000Z' }];
    gcnTiers = async () => [{ tier_label: 'T', package_name: 'P', tier_description: 'd', max_distinct_dots: 6 }];

    return handlers().get_formulation_packages().then((res) => {
        const banned = ['order_id', 'plan_id', 'submit_plan_id', 'sku_id', 'code', 'label_code', 'sort_at', 'tier_widths', 'stage', 'plan_status'];
        const blob = JSON.stringify(res.data);
        for (const row of res.data) {
            for (const key of banned) {
                assert.ok(!(key in row), `${row.kind} row must not carry ${key}`);
            }
            assert.deepEqual(Object.keys(row).filter(k => /price|amount|cny|fee/i.test(k)), [],
                'nano does not price this product — a number it was never given is one it cannot leak');
        }
        assert.ok(!blob.includes('WVB-SECRET'), 'the redeem code string never reaches the model');
        // The catalog carries no width: §28f took that number off the card, and on the catalog it
        // is a merchandising claim rather than a fact about something the user owns.
        assert.ok(!('max_distinct_dots' in res.data.find(r => r.kind === 'tier')));
    });
});

test('an unreachable GCN is reported as unreachable, never as "you have bought nothing"', () => {
    // All three fetchers swallow failures and return [], so "down" and "nothing bought" are
    // byte-identical — which is this tool's own origin bug relocated.
    reset();
    return handlers().get_formulation_packages().then((res) => {
        assert.equal(res.ok, false);
        assert.match(res.reason, /could not be reached/);
        assert.match(res.reason, /do NOT tell them they have no packages/);
    });
});

test('a nano-side proposal still answers while GCN is down', () => {
    // The all-three-empty conjunction is what preserves this: the plan half comes from nano's own
    // table, so a formula the user made is still describable when the order half is unavailable.
    reset();
    dbRows = {
        'FROM nutrition_plans': [{ id: 77, status: 'proposed', start_date: null, created_at: '2026-09-09T02:00:00.000Z', label_code: 'WVB1', gcn_order_id: null, ag_formulation_id: null, proposed_recipe: null }],
    };
    return handlers().get_formulation_packages().then((res) => {
        assert.equal(res.ok, true);
        const pkgs = res.data.filter(r => r.kind === 'package');
        assert.equal(pkgs.length, 1);
        assert.match(pkgs[0].stage_meaning, /还没有下单/);
        assert.ok(!('label_code' in pkgs[0]));
    });
});

test('the reported bug: two unpaid orders and a proposal read back as exactly that', () => {
    // The real dev fixture behind the report — user 37c8774e.
    reset();
    gcnOrders = async () => [
        { ...ORDER, order_id: 'o-8', max_distinct_dots: 8, created_at: '2026-08-30T02:00:00.000Z' },
        { ...ORDER, order_id: 'o-6', max_distinct_dots: 6, created_at: '2026-08-29T02:00:00.000Z' },
    ];
    dbRows = {
        'FROM nutrition_plans': [{ id: 38868, status: 'proposed', start_date: null, created_at: '2026-09-09T02:00:00.000Z', label_code: null, gcn_order_id: null, ag_formulation_id: null, proposed_recipe: null }],
    };
    return handlers().get_formulation_packages().then((res) => {
        const pkgs = res.data.filter(r => r.kind === 'package');
        assert.equal(pkgs.length, 2, 'the proposal is suppressed while an order waits for a recipe (§28d)');
        for (const p of pkgs) {
            assert.ok(!('stage' in p), 'the raw enum is withheld — given it, the model wrote "pending_payment" into user prose');
            assert.match(p.stage_meaning, /尚未付款/, 'the stage sentence is server-written and says nothing is paid');
            assert.ok(p.next_step, 'an unpaid order is something the user can act on');
            assert.match(p.formula_status, /还没有绑定配方/,
                'an order with no plan must SAY so — given a bare null, the model invented a dot roster and JUDGE passed it');
        }
        // The whole point: nothing here comes from user_cartridges.
        assert.ok(!JSON.stringify(res.data).includes('remaining_dots'));
    });
});

test('stage narration is rendered in the user language', () => {
    reset();
    gcnOrders = async () => [ORDER];
    return handlers('en').get_formulation_packages().then((res) => {
        const p = res.data.find(r => r.kind === 'package');
        assert.match(p.stage_meaning, /has not been paid/);
    });
});

// ── The stage vocabulary lives in exactly two places (§28g) ────────────────────────────────────

test('every stage has narration in both languages, and a miniapp label in both', () => {
    const T = (() => {
        const src = fs.readFileSync(path.join(MINIAPP, 'pages', 'main', 'main.js'), 'utf8');
        const i = src.indexOf('\nconst T = {');
        const j = src.indexOf('\n}\n', i) + 3;
        const ctx = vm.createContext({});
        vm.runInContext(src.slice(i, j) + '\nglobalThis.T = T;', ctx);
        return ctx.T;
    })();

    for (const stage of D.PACKAGE_STAGES) {
        const entry = D.PACKAGE_STAGE_NARRATION[stage];
        assert.ok(entry, `PACKAGE_STAGE_NARRATION is missing '${stage}'`);
        for (const lang of ['zh', 'en']) {
            assert.ok(entry[lang] && entry[lang].meaning, `${stage}.${lang}.meaning is empty`);
            assert.equal(typeof entry[lang].next_step, 'string', `${stage}.${lang}.next_step must exist (may be '')`);
            assert.ok(T[lang][`pkgStage_${stage}`], `t.pkgStage_${stage} missing from T.${lang} — WXML renders it empty`);
        }
    }
    assert.deepEqual(
        Object.keys(D.PACKAGE_STAGE_NARRATION).filter(s => !D.PACKAGE_STAGES.has(s)), [],
        'narration for a stage that is not in PACKAGE_STAGES');
});

test('the chat prompt never learns a stage string', () => {
    // Rule 3 of §28g. Checked against the RENDERED text, not the file — the module's header
    // comment legitimately names stages while explaining the bug, and a comment is not something
    // the model can read. The block is static, so both renderings cover every code path.
    //
    // Only the underscore-bearing values are checked: they can only ever be enum references,
    // whereas "shipped"/"paid"/"active" are ordinary words that appear in ordinary prose.
    const rendered = pkgBlock.getFormulationPackageBlock(true, true)
        + pkgBlock.getFormulationPackageBlock(true, false);
    const machineShaped = [...D.PACKAGE_STAGES].filter(s => s.includes('_')).concat('plan_status');
    for (const stage of machineShaped) {
        assert.ok(!rendered.includes(stage),
            `${stage} reaches the model in the prompt block — the stage vocabulary belongs in PACKAGE_STAGE_NARRATION, not a prompt`);
    }
});

// ── Prompt gating and the forced queue ────────────────────────────────────────────────────────

test('the block is empty off, present on, and both nutrition templates render it', () => {
    assert.equal(pkgBlock.getFormulationPackageBlock(false), '');
    assert.equal(pkgBlock.getFormulationPackageBlock(false, false), '');
    assert.ok(pkgBlock.getFormulationPackageBlock(true, true).includes('原粒套餐与订单'));

    const base = { user_profile: { language: 'zh' }, bioage: {}, dots: [] };
    assert.ok(vivaNutrition({ ...base, formulation_packages_available: true }).includes('原粒套餐与订单'));
    assert.ok(!vivaNutrition({ ...base, formulation_packages_available: false }).includes('原粒套餐与订单'));

    const en = { user_profile: { language: 'en' }, bioage: {}, dots: [] };
    assert.ok(nanoNutrition({ ...en, formulation_packages_available: true }).includes('DOTS PACKAGES AND ORDERS'));
    assert.ok(!nanoNutrition({ ...en, formulation_packages_available: false }).includes('DOTS PACKAGES AND ORDERS'));
});

test('the block states no price and promises no delivery date', () => {
    const both = pkgBlock.getFormulationPackageBlock(true, true) + pkgBlock.getFormulationPackageBlock(true, false);
    assert.doesNotMatch(both, /[¥$]\s?\d/, 'no figure belongs here — nano does not price this product');
    assert.match(both, /不写价格|no price/, 'the ban has to be stated, not merely implied');
});

test('handlers/chat.js reclassifies a purchase question away from formulate_dots', () => {
    // A misclassification here is not a degraded answer but a wrong ACTION: the branch below
    // returns launch_tool and the miniapp starts formulating.
    const src = fs.readFileSync(path.join(WORKER, 'handlers', 'chat.js'), 'utf8');
    const guard = src.indexOf('messageAsksAboutFormulationPackage(message)\n');
    const branch = src.indexOf("if (intent === 'formulate_dots') {");
    assert.ok(guard > -1, 'the deterministic override is gone');
    assert.ok(guard < branch, 'the override must run BEFORE the launch_tool branch');

    const block = src.slice(guard, src.indexOf('}', guard));
    // casual_chat is not in HIGH_RISK_INTENTS, so it has no tools and no package block —
    // 「我的订单到哪了」 landed there on dev and hit factConstraint's canned 联系客服 line.
    assert.match(block, /intent === 'formulate_dots'/, 'a purchase question must not launch the formulation tool');
    assert.match(block, /intent === 'casual_chat'/, 'a purchase question must not land on a toolless intent');
    assert.ok(!/'emotional_support'|'biomarker_question'/.test(block),
        'only the two intents that measurably fail are promoted — this is not a general reclassifier');
    assert.match(src, /formulation_packages_available: GCN_LINKED_CHANNEL_KEYS\.has\(channelKeyName\)/,
        'the block must stay channel-gated, and must NOT be gated on required_data');
});

test('the forced queue puts deterministic triggers first and always leaves room for prose', () => {
    const plan = { tools_needed: ['get_dots', 'get_health_twin', 'get_reminders'] };
    const q = buildForcedToolQueue(plan, '我的订单到哪了', TOOL_NAMES, 2);
    assert.equal(q[0], 'get_formulation_packages', 'a deterministic trigger outranks PLAN\'s advice');
    assert.ok(q.length <= 2, 'forcing every iteration leaves the loop with no iteration to reply in');

    const both = buildForcedToolQueue(plan, '我的订单到哪了，之前的检测对比一下', TOOL_NAMES, 2);
    assert.deepEqual(both, ['get_biomarker_history', 'get_formulation_packages']);

    assert.deepEqual(buildForcedToolQueue({ tools_needed: ['nope', 'get_dots'] }, 'hi', TOOL_NAMES, 2), ['get_dots'],
        'an invented tool name from PLAN is dropped, not forced');
    assert.deepEqual(buildForcedToolQueue(null, 'hi', TOOL_NAMES, 2), []);
});

test('the last GENERATE iteration cannot spend itself on another tool call', () => {
    const src = fs.readFileSync(path.join(WORKER, 'lib', 'agenticChat.js'), 'utf8');
    assert.match(src, /const lastIter = iter === GENERATE_MAX_ITERS - 1;/);
    assert.match(src, /\(lastIter \? 'none' : 'auto'\)/,
        'without this a loop of pure tool calls exits with rawReply === "" and ships a canned reply');
    assert.match(src, /buildForcedToolQueue\(plan, message, validToolNames, GENERATE_MAX_ITERS - 1\)/);
});
