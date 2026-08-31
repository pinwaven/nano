'use strict';
// A dots package is one journey assembled from two systems that each know only half of it: GCN
// owns the order (paid, compounding, shipped) and nano owns the formula (proposed, approved,
// active). What is asserted here is the merge — that the two halves find each other, that a half
// on its own still produces a usable row, and that the stage a USER sees is derived from both
// rather than from whichever system happened to be asked.
//
// Deliberately DB-free and network-free: _mergeFormulationPackages is pure so every stage mapping
// can be pinned without standing up Postgres or GCN.
const test = require('node:test');
const assert = require('node:assert');
const { DateTime } = require('luxon');

const D = require('../src/functions/worker/handlers/dots.js');
const { PLAN_DAYS } = require('../src/functions/worker/lib/dotsProductModel.js');

const today = () => DateTime.now().setZone('Asia/Shanghai').toISODate();
const daysAgo = (n) => DateTime.now().setZone('Asia/Shanghai').minus({ days: n }).toISODate();

// Shapes exactly as the two sources deliver them: GCN's handleNanoFormulationOrders row, and a
// nutrition_plans row with start_date cast ::text (node-postgres parses a bare DATE at local
// midnight, which serialises to the wrong day in UTC — the cast is why this is a string).
const order = (over = {}) => ({
    order_id: 'ord-1', status: 'awaiting_formulation', created_at: '2026-08-20T02:00:00.000Z',
    paid_at: null, shipped_at: null, fulfillment: 'fast_track', is_bundle: true,
    package_name: '原粒 · 定制营养素 · 28天', tier_label: '8种原粒', max_distinct_dots: 8,
    nano_nutrition_plan_id: null, intended_nano_plan_id: null, nano_ag_formulation_id: null,
    tracking_number: null, shipping_carrier: null, tracking_status_desc: null, ...over,
});
const plan = (over = {}) => ({
    id: 100, status: 'proposed', start_date: today(), created_at: '2026-08-21T02:00:00.000Z',
    label_code: 'WVB0123456789ab', gcn_order_id: null, ag_formulation_id: null, ...over,
});

const only = (orders, plans) => {
    const out = D._mergeFormulationPackages(orders, plans);
    assert.strictEqual(out.length, 1, `expected exactly one package, got ${out.length}`);
    return out[0];
};

test('nothing in, nothing out — and neither half being absent is an error', () => {
    for (const args of [[[], []], [null, null], [undefined, undefined], [[], null]]) {
        assert.deepStrictEqual(D._mergeFormulationPackages(...args), []);
    }
});

test('a proposal nobody has ordered is still a package', () => {
    // The case the Dots subtab was blindest to: handleGetNutritionPlan filters status='active',
    // so before this a formula from the chat tool existed and was invisible everywhere but chat.
    const p = only([], [plan()]);
    assert.strictEqual(p.stage, 'proposed');
    assert.strictEqual(p.plan_id, 100);
    assert.strictEqual(p.plan_status, 'proposed');
    assert.strictEqual(p.label_code, 'WVB0123456789ab');
    assert.strictEqual(p.order_id, null);
    assert.strictEqual(p.can_submit, false, 'nothing has been bought, so there is nothing to fill');
    // A proposal's start_date is a placeholder until the box is scanned. Reporting a day number
    // would claim the user is taking capsules that have not been compounded.
    assert.strictEqual(p.day_index, null);
    assert.strictEqual(p.total_days, null);
});

test('an order with no formula yet is a package too, and asks the user to act', () => {
    const p = only([order()], []);
    assert.strictEqual(p.stage, 'awaiting_formulation');
    assert.strictEqual(p.can_submit, true);
    assert.strictEqual(p.plan_id, null);
    assert.strictEqual(p.max_distinct_dots, 8);
    assert.strictEqual(p.tier_label, '8种原粒');
});

test('the premium package never asks the user to do anything — Viva AG owns it', () => {
    // Same GCN status as the row above. The split is by which package was bought, because the two
    // ask opposite things of the user, and offering a submit CTA here routes them somewhere that
    // cannot fulfil their order (GCN refuses with order_requires_expert_review).
    const p = only([order({ fulfillment: 'expert_review' })], []);
    assert.strictEqual(p.stage, 'awaiting_ag');
    assert.strictEqual(p.can_submit, false);
});

test('all three links join a plan to its order', () => {
    const cases = [
        ['gcn_order_id',          [order({ order_id: 'ord-9' })], [plan({ gcn_order_id: 'ord-9' })]],
        ['nano_nutrition_plan_id',[order({ nano_nutrition_plan_id: 100 })], [plan()]],
        // TEXT on GCN's side, BIGINT here — the comparison has to survive that.
        ['ag_formulation_id',     [order({ nano_ag_formulation_id: '77' })], [plan({ ag_formulation_id: 77, status: 'approved' })]],
    ];
    for (const [label, orders, plans] of cases) {
        const p = only(orders, plans);
        assert.strictEqual(p.plan_id, 100, `${label} should have joined`);
        assert.strictEqual(p.order_id, orders[0].order_id, label);
    }
});

test('intended_nano_plan_id does not bind a plan to an order', () => {
    // It records what the buyer was looking at when they paid — advisory, and possibly a formula
    // that was superseded and will never be compounded (GCN's migration_0086). Treating it as a
    // link would report a package as already carrying a recipe that nothing is going to make.
    //
    // The row is still OFFERED the proposal (submit_plan_id), which is the honest description:
    // this formula could fill this package, and will once the user says so.
    const p = only([order({ intended_nano_plan_id: 100 })], [plan()]);
    assert.strictEqual(p.plan_id, null, 'nothing is attached yet');
    assert.strictEqual(p.stage, 'awaiting_formulation', 'it is still waiting on the user');
    assert.strictEqual(p.submit_plan_id, 100);

    // Where it really matters: a package past the point of submission must not adopt an unrelated
    // proposal just because the buyer once looked at it. Two genuinely separate journeys here —
    // capsules already being made, and a newer formula with nowhere to go yet.
    const out = D._mergeFormulationPackages(
        [order({ status: 'compounding', intended_nano_plan_id: 100 })], [plan({ id: 101 })]);
    assert.strictEqual(out.length, 2);
    const ord = out.find(x => x.order_id);
    assert.strictEqual(ord.plan_id, null);
    assert.strictEqual(ord.can_submit, false);
    assert.strictEqual(out.find(x => !x.order_id).stage, 'proposed');
});

test('one plan is claimed by one order only', () => {
    const orders = [order({ order_id: 'a', nano_nutrition_plan_id: 100 }),
                    order({ order_id: 'b', nano_nutrition_plan_id: 100 })];
    const out = D._mergeFormulationPackages(orders, [plan()]);
    assert.strictEqual(out.length, 2);
    assert.strictEqual(out.filter(p => p.plan_id === 100).length, 1,
        'the same formula must not appear to be filling two packages');
});

test('an active plan outranks whatever the order still says', () => {
    // The user scanned the box. That they are taking the capsules is a more useful truth than the
    // order sitting at 'shipped' because nobody closed it out on the commerce side.
    const p = only([order({ order_id: 'ord-5', status: 'shipped', tracking_number: 'SF123' })],
                   [plan({ status: 'active', gcn_order_id: 'ord-5', start_date: daysAgo(4) })]);
    assert.strictEqual(p.stage, 'active');
    assert.strictEqual(p.day_index, 5, 'day 1 is the scan day, so four days ago is day 5');
    assert.strictEqual(p.total_days, PLAN_DAYS);
    assert.strictEqual(p.can_scan, false, 'already scanned');
    assert.strictEqual(p.can_submit, false);
});

test('the day counter is clamped at both ends', () => {
    const at = (d) => only([], [plan({ status: 'active', start_date: d })]).day_index;
    assert.strictEqual(at(today()), 1);
    assert.strictEqual(at(daysAgo(PLAN_DAYS + 40)), PLAN_DAYS, 'a plan run long still reads day 28');
    assert.strictEqual(at(DateTime.now().setZone('Asia/Shanghai').plus({ days: 3 }).toISODate()), 1,
        'a start date in the future is day 1, never day zero or negative');
    assert.strictEqual(only([], [plan({ status: 'active', start_date: null })]).day_index, null);
});

test('every GCN order status maps to a stage a user can read', () => {
    const expected = {
        pending_payment: 'pending_payment', paid: 'paid',
        expert_review: 'expert_review',
        // Two GCN statuses, one sentence to a buyer: "it is being made".
        compounding: 'compounding', processing: 'compounding',
        shipped: 'shipped',
        // For a physical box the journey is not over until the user scans it, and that scan is a
        // nano-side event GCN never hears about.
        completed: 'delivered',
        cancelled: 'cancelled', refunded: 'refunded',
    };
    for (const [status, stage] of Object.entries(expected)) {
        assert.strictEqual(only([order({ status })], []).stage, stage, status);
    }
    // An unknown status must not produce an unlabelled row — the client keys its copy off these.
    assert.strictEqual(only([order({ status: 'some_future_status' })], []).stage, 'compounding');
});

test('shipped and delivered are the two stages that ask for a scan', () => {
    for (const status of ['shipped', 'completed']) {
        const p = only([order({ status, tracking_number: 'SF9', shipping_carrier: '顺丰' })], []);
        assert.strictEqual(p.can_scan, true, status);
        assert.strictEqual(p.tracking_number, 'SF9');
        assert.strictEqual(p.shipping_carrier, '顺丰');
    }
    assert.strictEqual(only([order({ status: 'compounding' })], []).can_scan, false);
});

test('a package waiting on the user is never buried under one that is not', () => {
    const out = D._mergeFormulationPackages(
        [order({ order_id: 'old', status: 'awaiting_formulation', created_at: '2026-01-01T00:00:00.000Z' }),
         order({ order_id: 'new', status: 'compounding', created_at: '2026-08-29T00:00:00.000Z' })],
        [plan({ status: 'active', start_date: today(), created_at: '2026-08-30T00:00:00.000Z' })]);
    assert.deepStrictEqual(out.map(p => p.stage),
        ['awaiting_formulation', 'compounding', 'active']);
});

test('_awaitingOrders filters to what can actually be filled, oldest first', () => {
    // The order matters and is not cosmetic: GCN returns newest-first for display but its attach
    // path resolves ties OLDEST-first, so anything that has to agree with what GCN will really do
    // must re-sort. Not doing this is how a picker and a submission name two different packages.
    const got = D._awaitingOrders([
        order({ order_id: 'c', created_at: '2026-08-25T00:00:00.000Z' }),
        order({ order_id: 'shipped-one', status: 'shipped' }),
        order({ order_id: 'a', created_at: '2026-08-01T00:00:00.000Z' }),
        order({ order_id: 'b', created_at: '2026-08-10T00:00:00.000Z' }),
    ]);
    assert.deepStrictEqual(got.map(o => o.order_id), ['a', 'b', 'c']);
    for (const bad of [null, undefined, 'nonsense', {}]) {
        assert.deepStrictEqual(D._awaitingOrders(bad), [], String(bad));
    }
});

test('a waiting package is offered the formula sitting next to it', () => {
    // The two halves arrive independently and are NOT linked until submit: buying the package
    // writes no plan, and running the chat tool writes no order. Without this the subtab would
    // show "needs your formula" directly above "ready to order" and no way to connect them.
    const out = D._mergeFormulationPackages([order()], [plan({ id: 100 })]);
    assert.strictEqual(out.length, 1, 'the proposal is not listed twice');
    assert.strictEqual(out[0].stage, 'awaiting_formulation');
    assert.strictEqual(out[0].submit_plan_id, 100, 'the CTA has a formula to send');
    assert.strictEqual(out[0].plan_id, null, 'nothing is bound until the user submits');
});

test('every waiting package is offered the same formula, so the user picks by tapping one', () => {
    // Two paid packages is reachable: GCN's formulation_already_in_progress guard runs at order
    // CREATION, so two checkouts started while both were pending_payment can both be confirmed.
    const out = D._mergeFormulationPackages(
        [order({ order_id: 'a', created_at: '2026-08-01T00:00:00.000Z' }),
         order({ order_id: 'b', created_at: '2026-08-10T00:00:00.000Z' })],
        [plan({ id: 100 })]);
    assert.strictEqual(out.length, 2);
    assert.deepStrictEqual(out.map(p => p.submit_plan_id), [100, 100]);
    assert.deepStrictEqual(out.map(p => p.order_id).sort(), ['a', 'b']);
});

test('with nothing waiting, the proposal keeps its own row and offers to be ordered', () => {
    const p = only([], [plan()]);
    assert.strictEqual(p.can_order, true);
    assert.strictEqual(p.can_submit, false);
});

test('a proposal already submitted is not offered again', () => {
    // After submit the plan carries gcn_order_id and the order has moved to compounding. It is
    // matched, so it is neither a standalone row nor a formula on offer.
    const p = only([order({ order_id: 'ord-7', status: 'compounding' })],
                   [plan({ gcn_order_id: 'ord-7' })]);
    assert.strictEqual(p.stage, 'compounding');
    assert.strictEqual(p.plan_id, 100);
    assert.strictEqual(p.can_submit, false);
    assert.strictEqual(p.can_order, false);
});

test('a waiting package with no formula anywhere has nothing to offer', () => {
    const p = only([order()], []);
    assert.strictEqual(p.can_submit, true);
    assert.strictEqual(p.submit_plan_id, null, 'the client renders a hint, not a dead button');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The client half. main.js is a WeChat Page and cannot be require()d, so mapPackages is extracted
// from its source and run — the shipping code, not a copy of it.
//
// This exists because the first version of mapPackages silently dropped submit_plan_id and
// can_order while listing every other field, so both CTAs rendered as a hint or not at all. A
// missing field in an object literal is invisible; WXML has no compile-time checking to catch it.
// ─────────────────────────────────────────────────────────────────────────────────────────────
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const MINI = path.join(__dirname, '..', 'src', 'mini', 'nano-miniapp', 'pages', 'main');
const mainJs = fs.readFileSync(path.join(MINI, 'main.js'), 'utf8');
const mainWxml = fs.readFileSync(path.join(MINI, 'main.wxml'), 'utf8');

const client = (() => {
    const cut = (from, to) => { const a = mainJs.indexOf(from); return mainJs.slice(a, mainJs.indexOf(to, a)); };
    const tStart = mainJs.indexOf('\nconst T = {') + 1;
    const ctx = vm.createContext({});
    vm.runInContext(
        mainJs.slice(tStart, mainJs.indexOf('\n}\n', tStart) + 3) + '\n'
        + cut('function fmtDate(', '\nfunction localISODate') + '\n'
        + cut('function mapPackages(', '\n// Constrains <img>')
        // top-level `const` lives in the script's lexical scope, not on the context object
        + '\nglobalThis.T = T; globalThis.mapPackages = mapPackages;', ctx);
    return ctx;
})();

// The package block's markup, so the field scan cannot drift onto some other part of the page.
const pkgBlock = (() => {
    const a = mainWxml.indexOf('class="pkg-section"');
    assert.ok(a > -1, 'the package block is gone from main.wxml');
    return mainWxml.slice(a, mainWxml.indexOf('class="order-dots-card"', a));
})();

test('mapPackages carries every field the package markup binds', () => {
    const bound = new Set([...pkgBlock.matchAll(/\bitem\.([A-Za-z0-9_]+)/g)].map(m => m[1]));
    assert.ok(bound.size >= 8, `only ${bound.size} bindings found — the scan lost its block`);
    const mapped = client.mapPackages(
        D._mergeFormulationPackages([order({ status: 'shipped', tracking_number: 'SF1' })], [plan()]),
        client.T.zh, 'zh')[0];
    for (const field of bound) {
        assert.ok(field in mapped, `main.wxml binds item.${field}, which mapPackages never sets`);
    }
});

test('both languages resolve every stage label and every CTA', () => {
    // A missing key renders as empty text rather than failing, so an unlabelled pill would ship.
    const rows = D._mergeFormulationPackages([
        order({ order_id: 'a', status: 'awaiting_formulation' }),
        order({ order_id: 'b', status: 'shipped', tracking_number: 'SF1', shipping_carrier: '顺丰' }),
        order({ order_id: 'c', status: 'compounding' }),
    ], [plan()]);
    for (const lang of ['zh', 'en']) {
        const t = client.T[lang];
        for (const key of ['pkgSectionTitle', 'pkgUseFormulaBtn', 'pkgNeedsFormulaHint',
                           'pkgScanBtn', 'pkgOrderBtn', 'pkgUnnamed', 'pkgOrderGone', 'copy']) {
            assert.strictEqual(typeof t[key], 'string', `${lang}.${key}`);
        }
        for (const m of client.mapPackages(rows, t, lang)) {
            assert.ok(m.stageLabel && !/undefined/.test(m.stageLabel), `${lang} stage ${m.stage}`);
            assert.ok(!/undefined|NaN/.test(m.meta), `${lang} meta for ${m.stage}: ${m.meta}`);
            assert.ok(m.key, 'every row needs a wx:key');
        }
    }
    // Distinct wx:keys, or the list re-uses nodes and rows render each other's state.
    const keys = client.mapPackages(rows, client.T.zh, 'zh').map(m => m.key);
    assert.strictEqual(new Set(keys).size, keys.length);
});

test('a waiting package with a formula on offer renders the CTA, not the hint', () => {
    // The exact regression: the CTA is gated on `can_submit && submit_plan_id`, so losing the
    // second field silently degrades a working button into "go and formulate one first".
    assert.ok(/item\.can_submit && item\.submit_plan_id/.test(pkgBlock),
        'the submit CTA no longer gates on the offered formula');
    const [withFormula] = client.mapPackages(D._mergeFormulationPackages([order()], [plan()]), client.T.zh, 'zh');
    assert.strictEqual(withFormula.can_submit, true);
    assert.strictEqual(withFormula.submit_plan_id, 100);

    const [without] = client.mapPackages(D._mergeFormulationPackages([order()], []), client.T.zh, 'zh');
    assert.strictEqual(without.can_submit, true);
    assert.strictEqual(without.submit_plan_id, null, 'the hint renders instead of a dead button');
});

test('inFlight is what hides the buy-another card, and only for a package still in progress', () => {
    // GCN refuses a second purchase while one is awaiting_formulation or expert_review, so the
    // card would dead-end. A proposal is not in flight (nothing was paid) and neither is a package
    // already taken, cancelled or refunded.
    const inFlight = (stage, orders, plans) => {
        const m = client.mapPackages(D._mergeFormulationPackages(orders, plans), client.T.zh, 'zh');
        return m.find(x => x.stage === stage).inFlight;
    };
    assert.strictEqual(inFlight('proposed', [], [plan()]), false);
    assert.strictEqual(inFlight('active', [], [plan({ status: 'active' })]), false);
    for (const status of ['cancelled', 'refunded']) {
        assert.strictEqual(inFlight(status, [order({ status })], []), false, status);
    }
    for (const status of ['pending_payment', 'awaiting_formulation', 'expert_review', 'compounding', 'shipped']) {
        const stage = status === 'awaiting_formulation' ? 'awaiting_formulation' : status;
        assert.strictEqual(inFlight(stage, [order({ status })], []), true, status);
    }
});
