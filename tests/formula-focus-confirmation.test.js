// 营养定制 asks which direction it should formulate in, before it formulates.
//
// A focus is not a hint — _rankDotsBySeverity's +0.15 decides which dots survive the weekly tier
// cap and _fallbackCountForDot doses a listed dot toward the top of its range, so on a 6种 package
// it effectively chooses the six dots. The tool used to read the focus and never mention it: a
// user with a plan was silently steered and one without silently was not.
//
// It is deliberately NOT a gate like the BioAge one. Formulating from biomarkers alone is a
// correct result, and most users hold no focus, so a "proceed anyway" answer must always exist —
// that is the property most worth pinning here.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const mainJs = read('src', 'mini', 'nano-miniapp', 'pages', 'main', 'main.js');
const mainWxml = read('src', 'mini', 'nano-miniapp', 'pages', 'main', 'main.wxml');
const toolActions = read('src', 'mini', 'nano-miniapp', 'utils', 'tool-actions.js');
const dotsJs = read('src', 'functions', 'worker', 'handlers', 'dots.js');

const T = (() => {
    const start = mainJs.indexOf('\nconst T = {') + 1;
    const ctx = vm.createContext({});
    vm.runInContext(mainJs.slice(start, mainJs.indexOf('\n}\n', start) + 3) + '\nglobalThis.T = T;', ctx);
    return ctx.T;
})();

const sheet = (() => {
    const start = mainWxml.indexOf('营养定制 focus sheet');
    const end = mainWxml.indexOf('════ STORE ════');
    assert.ok(start !== -1 && end > start, 'the focus sheet markup is gone');
    return mainWxml.slice(start, end);
})();

test('every entry point asks before it formulates', () => {
    // Three call sites reach this tool: the toolbox button, the action chip, and the chat
    // classifier's launch_tool. All must route through _startFormulaDots, or the question can be
    // skipped by taking a different door.
    const direct = [...mainJs.matchAll(/toolActions\.runFormulaDs\(/g)];
    assert.strictEqual(direct.length, 1, 'runFormulaDs is called from somewhere other than _runFormulaDots');
    const helper = mainJs.slice(mainJs.indexOf('  _runFormulaDots(opts) {'));
    assert.ok(helper.indexOf('toolActions.runFormulaDs(') < helper.indexOf('\n  },'),
        'the one runFormulaDs call is not the one inside _runFormulaDots');
    assert.strictEqual([...mainJs.matchAll(/this\._startFormulaDots\(/g)].length, 3,
        'expected exactly three entry points to route through _startFormulaDots');
});

test('the classifier entry point still suppresses the duplicate user message', () => {
    // The user's own "我要定制营养素" already stands in the chat and was persisted server-side, so
    // the tool must not append its canned trigger line on top of it.
    assert.ok(/_startFormulaDots\(\{ skipUserMsg: true \}\)/.test(mainJs));
});

test('"proceed anyway" is reachable in both branches of the sheet', () => {
    // The property that keeps this a question rather than a gate. With a focus that is
    // handleFormulaFocusGo (use it) plus handleFormulaFocusSkip (ignore it); with none it is
    // handleFormulaFocusGo alone, which means the same thing.
    const withPlans = sheet.slice(sheet.indexOf('formulaFocusPlans.length > 0'), sheet.indexOf('<block wx:else>'));
    const without = sheet.slice(sheet.indexOf('<block wx:else>'));
    assert.ok(/handleFormulaFocusGo/.test(withPlans), 'no way to formulate with the focus');
    assert.ok(/handleFormulaFocusSkip/.test(withPlans), 'no way to formulate ignoring the focus');
    assert.ok(/handleFormulaFocusGo/.test(without), 'a user with no plan cannot formulate at all — this is a gate');
    assert.ok(/handleFormulaFocusChoose/.test(without), 'no link to the Plans tab for a user with no plan');
});

test('every string and handler the sheet reads actually exists', () => {
    // WXML has no compile-time checking: a mistyped t. key renders as empty text and a missing
    // handler is a dead button, both of which ship looking fine.
    const keys = [...new Set([...sheet.matchAll(/t\.([A-Za-z0-9_]+)/g)].map(m => m[1]))];
    assert.ok(keys.length > 0, 'the sheet reads no strings at all');
    for (const lang of ['zh', 'en']) {
        for (const k of keys) assert.ok(T[lang][k], `t.${k} is missing from T.${lang}`);
    }
    for (const h of new Set([...sheet.matchAll(/bindtap="([A-Za-z0-9_]+)"/g)].map(m => m[1]))) {
        assert.ok(new RegExp(`^\\s+${h}\\(`, 'm').test(mainJs), `${h} is bound in WXML but not defined in main.js`);
    }
});

test('the Plans-tab link goes through switchTab, not a hand-rolled setData', () => {
    // switchTab owns the staleness reloads for that tab; duplicating them here is how the two
    // drift and the user lands on a stale plan list.
    const fn = mainJs.slice(mainJs.indexOf('handleFormulaFocusChoose()'));
    const body = fn.slice(0, fn.indexOf('\n  },'));
    assert.ok(/this\.switchTab\(/.test(body), 'the link does not route through switchTab');
    assert.ok(/plansDotsSubTab: 'plans'/.test(body), 'the link lands on the Dots subtab, not Plans');
});

test('the client only sends ignore_focus when the user actually chose it', () => {
    // Omitting the flag must keep the behaviour that has always applied — use whatever focus the
    // user holds — so it can never default on.
    assert.ok(/if \(opts\.ignoreFocus\) body\.ignore_focus = true/.test(toolActions),
        'ignore_focus is not conditional on the user having chosen it');
    assert.ok(!/ignore_focus: (true|false)[,}]/.test(toolActions), 'ignore_focus is sent unconditionally');
});

test('the server honours the choice in exactly one place', () => {
    // Applied by dropping the plan rows, not by skipping only the dose bias — the plan's goal text
    // would otherwise keep steering the model, which is not what 不设方向 means. One place means
    // the prompt, the dose bias, the rung padding and the primary/secondary FK written at commit
    // cannot disagree about whether a focus applied.
    assert.ok(/ignore_focus: ignoreFocus = false/.test(dotsJs), 'handlePostFormulaDots does not accept the flag');
    assert.ok(/const activePlanRows = ignoreFocus \? \[\] : activePlansResult\.rows;/.test(dotsJs),
        'the flag is not applied by zeroing the plan rows');
    assert.strictEqual([...dotsJs.matchAll(/ignoreFocus \?/g)].length, 1,
        'the flag is consulted in more than one place — they will drift');
    // Everything downstream must read the filtered rows, never the raw query result again.
    const agentic = dotsJs.slice(dotsJs.indexOf('async function _handleFormulaDotsAgentic'));
    const body = agentic.slice(0, agentic.indexOf('\nasync function ', 1));
    const rawUses = [...body.matchAll(/activePlansResult\.rows/g)].length;
    assert.strictEqual(rawUses, 1, `activePlansResult.rows is read ${rawUses} times after filtering — should be once`);
});
