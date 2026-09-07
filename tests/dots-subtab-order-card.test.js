// The Dots subtab's two entry points: the hidden Neo dispenser card, and the order card that
// leads to the formulate tool when the user has no formula yet.
//
// Everything here is a source-level assertion because main.js is a WeChat Page and its WXML has
// no compile-time checking at all — a mistyped `t.` key renders as empty text and a lost gate
// silently brings a dead card back. Both failures ship looking fine.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const MINI = path.join(__dirname, '..', 'src', 'mini', 'nano-miniapp', 'pages', 'main');
const mainJs = fs.readFileSync(path.join(MINI, 'main.js'), 'utf8');
const mainWxml = fs.readFileSync(path.join(MINI, 'main.wxml'), 'utf8');

// The T blocks, run as the shipping source rather than a copy of it.
const T = (() => {
    const start = mainJs.indexOf('\nconst T = {') + 1;
    const ctx = vm.createContext({});
    vm.runInContext(mainJs.slice(start, mainJs.indexOf('\n}\n', start) + 3) + '\nglobalThis.T = T;', ctx);
    return ctx.T;
})();

test('the Neo dispenser bind card cannot render', () => {
    // The hardware is not shipping, so the card would offer something nobody can act on. It is
    // gated rather than deleted, so the gate has to actually be false in data.
    const card = mainWxml.match(/<view (wx:if="\{\{[^"]*\}\}") class="guest-lock-card neo-bind-card"/);
    assert.ok(card, 'the Neo bind card markup is gone — delete this test if that was deliberate');
    assert.ok(/neoAvailable/.test(card[1]), `the Neo card is no longer gated on neoAvailable: ${card[1]}`);
    assert.match(mainJs, /\n\s*neoAvailable: false,/, 'neoAvailable is not false in the page data');
});

test('the order card only ever runs the formulate tool, and only when there is no formula', () => {
    // The whole point: buying without a formula parks the order at awaiting_formulation and hands
    // the user back the same job. And once a formula DOES exist the package row above already
    // carries 按此配方下单, which names the plan — so a second card opening the store with no plan
    // id is a strictly worse route to the same product. There must be exactly one card, and it
    // must never be the store one.
    const branches = [...mainWxml.matchAll(/<view (wx:if|wx:elif|wx:else)="?\{?\{?([^"]*?)\}?\}?"? class="order-dots-card" bindtap="(\w+)"/g)];
    assert.strictEqual(branches.length, 1, 'expected exactly one order-dots-card branch');

    const [only] = branches;
    assert.strictEqual(only[1], 'wx:if');
    assert.strictEqual(only[3], 'handleGoFormulate', 'the order card must run the tool, not open the store');
    assert.ok(/!hasProposedFormula/.test(only[2]), 'the card is not hidden once a formula exists');
    assert.ok(/!hasPackageInFlight/.test(only[2]), 'the card is not hidden while a package is in flight');

    // The store-opening handler and its strings went with the branch; a leftover would be dead
    // code that reads like a live second route.
    assert.ok(!/bindtap="handleOrderDots"/.test(mainWxml), 'handleOrderDots is still bound in the markup');
    assert.ok(!/^\s*handleOrderDots\(\) \{/m.test(mainJs), 'handleOrderDots is still defined');
    for (const key of ['orderDotsTitle', 'orderDotsDetail', 'orderDotsBtn']) {
        assert.ok(!new RegExp('^\\s*' + key + ':', 'm').test(mainJs), `${key} is still defined`);
    }
});

test('handleGoFormulate lands on the chat tab and starts the tool', () => {
    const fn = mainJs.slice(mainJs.indexOf('  handleGoFormulate() {'), mainJs.indexOf('\n  },', mainJs.indexOf('  handleGoFormulate() {')));
    assert.ok(fn, 'handleGoFormulate is missing');
    assert.ok(/tab: 'chat'/.test(fn), 'it does not switch to the chat tab');
    assert.ok(/toolActions\.runFormulaDs\(/.test(fn), 'it does not run the formulate tool');
    assert.ok(/isGuest/.test(fn), 'a guest has no user_id to formulate for');
    assert.ok(/typing \|\| obStep !== 'done'/.test(fn), 'it can start a second turn on top of a running one');
});

test('hasProposedFormula is set from the packages list and cleared on failure', () => {
    // It gates the card, so a load that fails has to clear it — a stale true would hide the
    // only route to the tool from a user whose formula is gone.
    assert.match(mainJs, /hasProposedFormula: packages\.some\(p => p\.stage === 'proposed'\)/);
    const failure = mainJs.match(/this\.setData\(\{ dotsLoading: false, hasPlan: false, packages: \[\][^}]*\}\)/);
    assert.ok(failure, 'the _loadDots failure reset is gone');
    assert.ok(/hasProposedFormula: false/.test(failure[0]), 'the failure path leaves hasProposedFormula stale');
});

test('the redeem confirmation names the tier a laddered proposal will compound', () => {
    // A code is single-use and its width is known before it is spent, so the sheet says WHICH of
    // the user's formulas it compounds rather than warning that it is too narrow — the warning is
    // unreachable for a laddered proposal, whose base fits every tier sold.
    for (const lang of ['zh', 'en']) {
        assert.strictEqual(typeof T[lang].codeTierMatch, 'function', `${lang}.codeTierMatch`);
        const text = T[lang].codeTierMatch(8, 8);
        assert.ok(text.includes('8'), `${lang}.codeTierMatch should name the width it compounds`);
        // The old warning stays, for a proposal written before the ladder existed.
        assert.strictEqual(typeof T[lang].codeOverTier, 'function', `${lang}.codeOverTier`);
    }
});

test('both languages resolve every string the card binds', () => {
    // A missing key renders empty, so the card would ship with a blank button.
    for (const lang of ['zh', 'en']) {
        for (const key of ['formulateFirstTitle', 'formulateFirstDetail', 'formulateFirstBtn',
                           'formulaUpgradeTitle', 'formulaUpgradeHint', 'formulaWeekPrefix']) {
            assert.strictEqual(typeof T[lang][key], 'string', `${lang}.${key}`);
            assert.ok(T[lang][key].length > 0, `${lang}.${key} is empty`);
        }
    }
});
