'use strict';

// The 兑换码 section of Plans ▸ Dots: the codes a user owns, and spending one.
//
// Split the way the feature is: the two server-side facts (a proposal's weekly width, and the
// codes list being a sibling that degrades on its own) are exercised against the real handler with
// db/GCN stubbed through require.cache; the miniapp half is asserted on source text, because
// main.js is a WeChat Page and its WXML has no compile-time checking at all — a mistyped `t.` key
// renders as empty text and a lost gate silently brings a dead card back. Both ship looking fine.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WORKER = path.join(__dirname, '..', 'src', 'functions', 'worker');
const MINI = path.join(__dirname, '..', 'src', 'mini', 'nano-miniapp');

const stub = (rel, exports) => {
    const full = require.resolve(path.join(WORKER, rel));
    require.cache[full] = { id: full, filename: full, loaded: true, exports };
};

// What the GCN half is told to do on the next call. Reassigned per test rather than rebuilt,
// because handlers/dots.js captures these at require time.
let gcnCodes = async () => [];
let gcnOrders = async () => [];
let redeemImpl = async () => ({ order_id: 'ord-1' });
let dbRows = {};

stub('lib/db.js', {
    pool: {
        query: async (sql) => {
            for (const [frag, rows] of Object.entries(dbRows)) {
                if (sql.includes(frag)) return { rows };
            }
            return { rows: [] };
        },
        connect: async () => { throw new Error('not used'); },
    },
});
stub('lib/gcnClient.js', {
    fetchFormulationOrders: (...a) => gcnOrders(...a),
    fetchFormulationCodes: (...a) => gcnCodes(...a),
    redeemFormulationCode: (...a) => redeemImpl(...a),
    submitFastTrackFormulation: async () => ({ order_id: 'ord-1' }),
});

const D = require(path.join(WORKER, 'handlers', 'dots.js'));

const proposal = (recipe) => ({
    id: 38860, status: 'proposed', created_at: '2026-09-07T04:17:38.414Z',
    start_date: '2026-09-06', label_code: 'WVB2AE4EA79768C',
    gcn_order_id: null, ag_formulation_id: null, proposed_recipe: recipe,
});

// ── A proposal carries its own weekly width ─────────────────────────────────────────────

test('a proposal row reports the width a code is measured against', () => {
    const [row] = D._mergeFormulationPackages([], [proposal({
        morning: { 'DOT-N1': 2, 'DOT-N5': 3 }, evening: { 'DOT-N2': 4 },
    })]);
    assert.strictEqual(row.stage, 'proposed');
    assert.strictEqual(row.distinct_dots, 3);
});

test('DOT-N7 is not counted — it is dosed alone on 2 of 28 days in every plan, so counting it '
    + 'would cost a 6种 buyer one of the six they paid for', () => {
    const [row] = D._mergeFormulationPackages([], [proposal({
        morning: { 'DOT-N1': 2, 'DOT-N7': 50 }, evening: { 'DOT-N2': 4 },
    })]);
    assert.strictEqual(row.distinct_dots, 2);
});

test('the width is the WIDEST WEEK, never the cycle total — a rotation of six dots through '
    + 'four weeks fits a 6种 package', () => {
    const [row] = D._mergeFormulationPackages([], [proposal({
        morning: { 'DOT-N1': 2, 'DOT-N2': 2, 'DOT-N3': 2 },
        evening: { 'DOT-N4': 2, 'DOT-N5': 2, 'DOT-N6': 2 },
        weeks: { 'DOT-N1': [1, 2], 'DOT-N2': [1, 2], 'DOT-N3': [3, 4],
                 'DOT-N4': [3, 4], 'DOT-N5': [1, 2], 'DOT-N6': [3, 4] },
    })]);
    assert.strictEqual(row.distinct_dots, 3, 'three run in any one week, though six are used');
});

test('a package that is not a live proposal has no width to report', () => {
    const rows = D._mergeFormulationPackages([], [
        { ...proposal({ morning: { 'DOT-N1': 2 } }), status: 'active', start_date: '2026-09-01' },
    ]);
    assert.strictEqual(rows[0].distinct_dots, null);
});

// ── codes is a sibling of packages, on the same terms ───────────────────────────────────

test('the codes list reaches the subtab', async () => {
    gcnCodes = async () => [{
        code: '0475-4162-9772-1554', sku_id: 's1', max_distinct_dots: 6,
        package_name: '原粒 · 定制营养素 · 28天', tier_label: '6种原粒',
        fulfillment: 'fast_track', sold_at: '2026-09-07T02:35:28.570Z',
    }];
    const res = await D.handleGetNutritionPlan('c40d46a4');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.codes.length, 1);
    assert.strictEqual(res.codes[0].max_distinct_dots, 6);
});

test('a dead GCN costs the user their code list and nothing else — the plan fields are what the '
    + 'tab actually depends on', async () => {
    gcnCodes = async () => { throw new Error('gcn down'); };
    dbRows = { 'SELECT * FROM dots': [{ id: 1, key_name: 'DOT-N1' }] };
    const res = await D.handleGetNutritionPlan('c40d46a4');
    assert.strictEqual(res.success, true);
    assert.deepStrictEqual(res.codes, []);
    assert.strictEqual(res.dots.length, 1);
    dbRows = {};
    gcnCodes = async () => [];
});

test('codes never feed structured_plan — a code is something you can start, not a plan you are '
    + 'on (§28b records the live bug where a proposal leaked into this tab)', async () => {
    gcnCodes = async () => [{ code: 'X', max_distinct_dots: 6, fulfillment: 'fast_track' }];
    const res = await D.handleGetNutritionPlan('c40d46a4');
    assert.strictEqual(res.structured_plan, null);
    assert.deepStrictEqual(res.schedules, []);
    gcnCodes = async () => [];
});

// ── Redemption ─────────────────────────────────────────────────────────────────────────

test('shipping is refused before a code is spent, not after', async () => {
    const res = await D.handlePostFormulationRedeem({ openid: 'c40d46a4', code: 'X' });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.reason, 'shipping_required');
});

test('an empty code never reaches GCN', async () => {
    let called = false;
    redeemImpl = async () => { called = true; return {}; };
    const res = await D.handlePostFormulationRedeem({
        openid: 'c40d46a4', code: '  ',
        shipping_name: 'a', shipping_phone: 'b', shipping_address: 'c',
    });
    assert.strictEqual(res.reason, 'code_required');
    assert.strictEqual(called, false);
});

test("GCN's own refusal reaches the user verbatim — a code already spent reads completely "
    + 'differently from one that was never bought', async () => {
    dbRows = { 'FROM users WHERE user_id': [{ user_id: 'c40d46a4' }] };
    redeemImpl = async () => {
        const e = new Error('nope'); e.status = 409;
        e.body = { error: 'code_already_redeemed' };
        throw e;
    };
    const res = await D.handlePostFormulationRedeem({
        openid: 'c40d46a4', code: '0475-4162-9772-1554',
        shipping_name: 'a', shipping_phone: '1', shipping_address: 'addr',
    });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.reason, 'code_already_redeemed');
});

test('a transport failure degrades to a generic reason rather than a misleading one', async () => {
    dbRows = { 'FROM users WHERE user_id': [{ user_id: 'c40d46a4' }] };
    redeemImpl = async () => { throw new Error('socket hang up'); };
    const res = await D.handlePostFormulationRedeem({
        openid: 'c40d46a4', code: 'X',
        shipping_name: 'a', shipping_phone: '1', shipping_address: 'addr',
    });
    assert.strictEqual(res.reason, 'gcn_unreachable');
});

test('only the user\'s own live proposal is carried as the intent; a foreign or stale id is '
    + 'dropped rather than refused, because losing the auto-submit beats refusing to spend a code '
    + 'the user is entitled to spend', async () => {
    dbRows = { 'FROM users WHERE user_id': [{ user_id: 'c40d46a4' }] };  // plan lookup returns []
    let sent = null;
    redeemImpl = async (p) => { sent = p; return { order_id: 'ord-9', package_name: 'pkg' }; };
    const res = await D.handlePostFormulationRedeem({
        openid: 'c40d46a4', code: 'X', plan_id: 999,
        shipping_name: 'a', shipping_phone: '1', shipping_address: 'addr',
    });
    assert.strictEqual(res.success, true);
    assert.strictEqual(sent.intended_nano_plan_id, null);
    assert.strictEqual(res.order_id, 'ord-9');
});

test("GCN's 202 (code burnt, order not confirmed) is surfaced, not toasted as a clean success",
    async () => {
        dbRows = { 'FROM users WHERE user_id': [{ user_id: 'c40d46a4' }] };
        redeemImpl = async () => ({ order_id: 'ord-2', warning: 'redeemed_but_not_confirmed' });
        const res = await D.handlePostFormulationRedeem({
            openid: 'c40d46a4', code: 'X',
            shipping_name: 'a', shipping_phone: '1', shipping_address: 'addr',
        });
        assert.strictEqual(res.success, true);
        assert.strictEqual(res.pending_confirmation, true);
    });

test('nano does not submit the formula itself — _settleFastTrackPackage owns that, and racing it '
    + 'would make it nudge someone to formulate what they just did', () => {
    const srcText = fs.readFileSync(path.join(WORKER, 'handlers', 'dots.js'), 'utf8');
    const fn = srcText.slice(
        srcText.indexOf('async function handlePostFormulationRedeem'),
        srcText.indexOf('async function _resolveOrderContext'));
    assert.ok(!/submitFastTrackFormulation|handlePostFormulationSubmit\s*\(/.test(fn),
        'redeem must not submit');
});

// ── Miniapp ────────────────────────────────────────────────────────────────────────────

const mainJs = fs.readFileSync(path.join(MINI, 'pages', 'main', 'main.js'), 'utf8');
const mainWxml = fs.readFileSync(path.join(MINI, 'pages', 'main', 'main.wxml'), 'utf8');

const T = (() => {
    const start = mainJs.indexOf('\nconst T = {') + 1;
    const ctx = vm.createContext({});
    vm.runInContext(mainJs.slice(start, mainJs.indexOf('\n}\n', start) + 3) + '\nglobalThis.T = T;', ctx);
    return ctx.T;
})();

test('every code string resolves in both languages — WXML has no compile-time key checking, so a '
    + 'missing key renders as empty text', () => {
    const zh = Object.keys(T.zh).filter(k => k.startsWith('code'));
    assert.ok(zh.length > 20, 'expected the full code* string set');
    for (const k of zh) {
        assert.ok(k in T.en, `${k} missing from T.en`);
        assert.ok(T.zh[k] && T.en[k], `${k} is empty`);
    }
});

test('every t. key the codes section and sheet reference exists in both blocks', () => {
    const referenced = new Set();
    for (const m of mainWxml.matchAll(/t\.(code[A-Za-z_]+)/g)) referenced.add(m[1]);
    assert.ok(referenced.size >= 8, 'expected the section and sheet to reference several');
    for (const k of referenced) {
        assert.ok(k in T.zh && k in T.en, `${k} referenced in WXML but not defined`);
    }
});

test('every reason code the server can return has its own copy — a bare generic error would tell '
    + 'someone whose code was already spent to "try again"', () => {
    for (const reason of ['code_not_found', 'code_ambiguous', 'code_not_purchased',
        'code_already_redeemed', 'code_target_unavailable', 'shipping_required',
        'formulation_already_in_progress']) {
        assert.ok(`codeErr_${reason}` in T.zh, `zh missing codeErr_${reason}`);
        assert.ok(`codeErr_${reason}` in T.en, `en missing codeErr_${reason}`);
    }
});

test('the section is gated on the channel, not on codes.length — manual entry is the path for '
    + 'every code a store handed over in person, and those are never listed', () => {
    // The gate itself, not the prose around it — the comment above it mentions codes.length.
    const head = mainWxml.lastIndexOf('<view', mainWxml.indexOf('{{t.codeSectionTitle}}'));
    const gate = /wx:if="{{([^"]*)}}"/.exec(mainWxml.slice(head, head + 200));
    assert.ok(gate, 'the section should carry a wx:if');
    assert.strictEqual(gate[1].trim(), 'isAeviva && !isGuest');
});

test('every handler the codes markup binds to exists on the page', () => {
    const bound = new Set();
    const start = mainWxml.indexOf('{{t.codeSectionTitle}}');
    const end = mainWxml.indexOf('t.codeSubmitBtn');   // last string in the redeem sheet
    assert.ok(start > -1 && end > start, 'the codes section and sheet should both be present');
    const region = mainWxml.slice(start, end);
    for (const m of region.matchAll(/(?:catchtap|bindtap|bindinput)="([A-Za-z_]+)"/g)) bound.add(m[1]);
    for (const h of bound) {
        assert.ok(new RegExp(`\\n\\s*(?:async\\s+)?${h}\\s*\\(`).test(mainJs), `${h} not defined`);
    }
});

test('the sandbox short-circuit is handled — a mutating POST never reaches the handler in admin '
    + 'preview and comes back {success:true}, which would otherwise toast as a redemption', () => {
    const fn = mainJs.slice(mainJs.indexOf('async submitFormulationRedeem'),
                            mainJs.indexOf('async submitFormulationRedeem') + 4000);
    assert.ok(/res\.data\?\.sandbox/.test(fn), 'expected an explicit sandbox branch');
    assert.ok(fn.indexOf('res.data?.sandbox') < fn.indexOf('!res.data?.success'),
        'the sandbox check must precede the success check');
});

test('the over-tier warning compares the proposal against the code, and only when both are known '
    + '— a typed code carries no tier until GCN answers', () => {
    const fn = mainJs.slice(mainJs.indexOf('async submitFormulationRedeem'),
                            mainJs.indexOf('async submitFormulationRedeem') + 4000);
    assert.ok(/codeSheetMax && proposedDistinctDots && proposedDistinctDots > codeSheetMax/.test(fn));
    assert.ok(/t\.codeOverTier\(/.test(fn));
});

// ── The redundant CTA ──────────────────────────────────────────────────────────────────
//
// A 'proposed' package row used to carry 使用兑换码, three lines above a section offering the
// same action with the user's actual codes named. It was also the only path that left the app,
// and the webview it opened could neither see those codes nor sell one (the code skus are
// wholesale_only, so a consumer cannot buy them there).

test('a proposed package row carries no CTA — the 兑换码 section below owns redemption', () => {
    const a = mainWxml.indexOf('class="pkg-section"');
    const pkgBlock = mainWxml.slice(a, mainWxml.indexOf('class="code-section"', a));
    assert.ok(!/item\.can_order/.test(pkgBlock.replace(/<!--[\s\S]*?-->/g, '')),
        'the package block should no longer render a button from can_order');
    assert.ok(/item\.can_submit/.test(pkgBlock) && /item\.can_scan/.test(pkgBlock),
        'the submit and scan CTAs must survive');
});

test('the now-unrendered string is gone from both blocks rather than left dead', () => {
    assert.ok(!('pkgOrderBtn' in T.zh) && !('pkgOrderBtn' in T.en));
});

test('the chat card keeps its CTA and opens the in-app sheet, not the store webview — that '
    + 'surface has no codes section, so removing it there would leave no action at all', () => {
    const fn = mainJs.slice(mainJs.indexOf('async handleFormulaOrder'),
                            mainJs.indexOf('async handleFormulaOrder') + 1800);
    assert.ok(!/_openAevivaStoreGated/.test(fn), 'must no longer open the webview');
    assert.ok(/_openCodeSheet/.test(fn), 'must open the in-app sheet');
    assert.ok(/t\.formulaOrderCta/.test(mainWxml), 'the chat card CTA must still render');
});

test('it lands on the codes list when the user owns codes, rather than asking them to retype '
    + 'one — and uses plansDotsSubTab, since tab:"dots" matches no WXML block', () => {
    const fn = mainJs.slice(mainJs.indexOf('async handleFormulaOrder'),
                            mainJs.indexOf('async handleFormulaOrder') + 1800);
    assert.ok(/this\.data\.codes \|\| \[\]\)\.length > 0/.test(fn));
    assert.ok(/plansDotsSubTab: 'dots'/.test(fn));
    assert.ok(!/tab: 'dots'/.test(fn));
});

test('the chat card names its own plan, since Plans ▸ Dots may never have loaded there', () => {
    const submit = mainJs.slice(mainJs.indexOf('async submitFormulationRedeem'),
                                mainJs.indexOf('async submitFormulationRedeem') + 4000);
    assert.ok(/codeSheetPlanId/.test(submit), 'the sheet-carried plan id must win');
    const open = mainJs.slice(mainJs.indexOf('_openCodeSheet({'),
                              mainJs.indexOf('_openCodeSheet({') + 900);
    assert.ok(/codeSheetPlanId: planId/.test(open));
});

// ── Input rendering ────────────────────────────────────────────────────────────────────
//
// WeChat's <input> defaults to height:26px. With box-sizing:border-box (needed so width:100%
// survives the horizontal padding) the 24rpx of vertical padding on each side left a ~2px
// content box, which clipped the glyphs. Digits mostly survived it, CJK did not — which is how
// it went unnoticed in the viva subscription sheet this class came from.

// Comments stripped: the rule's own comment mentions WeChat's 26px default, which a naive
// /height:/ scan reads as the declaration.
const mainWxss = fs.readFileSync(path.join(MINI, 'pages', 'main', 'main.wxss'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');

test('the shared redeem input sets a height, or border-box padding clips the text', () => {
    const rule = mainWxss.slice(mainWxss.indexOf('.viva-redeem-input {'));
    const body = rule.slice(0, rule.indexOf('}'));
    assert.ok(/box-sizing:\s*border-box/.test(body), 'border-box is what makes a height necessary');
    assert.ok(/\bheight:/.test(body), 'no height set — the 26px default clips a 15px font');
});

test('the height tracks the font var rather than being fixed, so the in-app text-scale setting '
    + 'cannot re-clip it (--fs-30 runs 30rpx → 42rpx across the four levels)', () => {
    const rule = mainWxss.slice(mainWxss.indexOf('.viva-redeem-input {'));
    const body = rule.slice(0, rule.indexOf('}'));
    const height = /height:\s*([^;]+);/.exec(body);
    assert.ok(height, 'expected a height declaration');
    assert.ok(/var\(--fs-30/.test(height[1]),
        `height is fixed (${height[1].trim()}) — it must derive from --fs-30`);
});

// ── Address composition ────────────────────────────────────────────────────────────────

const joinAddress = (() => {
    const i = mainJs.indexOf('function _joinAddress');
    assert.ok(i > -1, '_joinAddress is gone');
    const ctx = vm.createContext({});
    vm.runInContext(mainJs.slice(i, mainJs.indexOf('\n}\n', i) + 3) + '\nglobalThis.j = _joinAddress;', ctx);
    return ctx.j;
})();

test('a 直辖市 does not repeat itself — WeChat returns province and city separately and they are '
    + 'the same string for 上海/北京/天津/重庆', () => {
    assert.strictEqual(
        joinAddress({ provinceName: '上海市', cityName: '上海市', countyName: '徐汇区', detailInfo: '宜山路425号' }),
        '上海市徐汇区宜山路425号');
});

test('an ordinary province/city pair is untouched', () => {
    assert.strictEqual(
        joinAddress({ provinceName: '广东省', cityName: '深圳市', countyName: '南山区', detailInfo: '科技园1号' }),
        '广东省深圳市南山区科技园1号');
});

test('missing parts are skipped rather than producing undefined or a gap', () => {
    assert.strictEqual(joinAddress({ cityName: '北京市', detailInfo: '某路2号' }), '北京市某路2号');
    assert.strictEqual(joinAddress({}), '');
});
