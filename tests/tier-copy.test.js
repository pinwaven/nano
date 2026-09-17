'use strict';
// The line beside each purchasable package used to be written by the same completion that produced
// the formula, keyed to a "tier" tag the model also had to assign. That could not hold: the copy is
// keyed on a package's POSITION while its MEMBERSHIP comes from the server's emphasis ranking, so
// they agreed only if the model happened to reproduce a ranking it never saw. Nine measured
// qwen-plus runs, three revisions of the instruction, never once.
//
// What is asserted here is the property that replaced it: the copy call is HANDED each package's
// real contents, so it cannot describe anything else — and it can never cost the user their card.
//
// Since 2026-09-10 the card draws three COMPLETE formulas rather than a base plus upgrade rungs, so
// the narrowest package gets a line of its own and every line answers the same question.
const test = require('node:test');
const assert = require('node:assert');

const { attachTierCopy, buildTierCopyPrompt, _parsePitches, MAX_PITCH_CHARS } =
    require('../src/functions/worker/lib/tierCopy.js');

const FORMULARY = [
    { key_name: 'DOT-N9', name: 'NAD Renew', name_zh: 'NAD焕新', sub_age_target: 'Cellular Age',
      ingredients_zh: { 'β-烟酰胺单核苷酸': '27mg' } },
    { key_name: 'DOT-N14', name: 'Flow', name_zh: '脉络畅流', sub_age_target: 'Micro-Vascular Age' },
    { key_name: 'DOT-N13', name: 'Gut Renew', name_zh: '肠道焕新', sub_age_target: 'Resilience Age' },
];
const TIERS = [
    { tier_label: '轻享套装', tier_description: '轻享套装 —— 基础均衡，科学入门', max_distinct_dots: 6, pitch: '',
      morning: { dots: { 'DOT-N9': 9 } }, evening: { dots: {} } },
    { tier_label: '臻选套装', tier_description: '臻选套装 —— 精准强化，靶向升级', max_distinct_dots: 8, pitch: '',
      morning: { dots: { 'DOT-N9': 9 } }, evening: { dots: { 'DOT-N14': 7 } } },
    { tier_label: '尊享套装', tier_description: '尊享套装 —— 全维覆盖，专属顶配', max_distinct_dots: 10, pitch: '',
      morning: { dots: { 'DOT-N9': 9 } }, evening: { dots: { 'DOT-N14': 7, 'DOT-N13': 2 } } },
];

const stubClient = (content) => ({
    chat: { completions: { create: async () => ({ choices: [{ message: { content } }] }) } },
});

test('the prompt names each package\'s real dots, and never their doses', () => {
    const p = buildTierCopyPrompt(TIERS, FORMULARY, 'zh', null);
    assert.ok(p.includes('NAD焕新') && p.includes('脉络畅流') && p.includes('肠道焕新'));
    // A dose in the prompt is a number the copy could then cite, and citing one is banned.
    for (const n of ['9', '7', '2']) {
        assert.ok(!new RegExp(`${n}\\s*粒`).test(p), `dose "${n}" must not reach the copy prompt`);
    }
    assert.ok(p.includes('一个原粒的名称都不要出现'), 'the no-naming rule must survive');
    // The narrowest package is described too — it is a product, not a starting point.
    assert.ok(p.includes('轻享套装'), 'the narrowest package must get a line of its own');
    // The store's own positioning travels into the prompt, so the three lines are written against
    // the same distinctions the shelf already makes.
    assert.ok(p.includes('基础均衡，科学入门') && p.includes('全维覆盖，专属顶配'));
});

test('the guardrail block is injected, so the package-copy exception stays live', () => {
    const withDb = buildTierCopyPrompt(TIERS, FORMULARY, 'zh', '【事实约束】DB-SOURCED');
    assert.ok(withDb.startsWith('【事实约束】DB-SOURCED'), 'a preloaded essential block must be used verbatim');
    // With no DB block the code fallback still carries the bans — never an unguarded prompt.
    const noDb = buildTierCopyPrompt(TIERS, FORMULARY, 'zh', null);
    assert.ok(noDb.includes('事实约束'), 'the fallback guardrail must be present');
});

test('pitches land on the packages in order, capped', async () => {
    const long = 'x'.repeat(MAX_PITCH_CHARS + 40);
    const out = await attachTierCopy({
        client: stubClient(JSON.stringify({ pitches: ['打底的一套', '补齐细胞能量这一环', long] })),
        model: 'stub', tiers: TIERS, dotsFormulary: FORMULARY, lang: 'zh',
    });
    assert.strictEqual(out[0].pitch, '打底的一套');
    assert.strictEqual(out[1].pitch, '补齐细胞能量这一环');
    assert.strictEqual(out[2].pitch.length, MAX_PITCH_CHARS);
    assert.deepStrictEqual(out.map(t => t.max_distinct_dots), [6, 8, 10], 'package order/identity is untouched');
});

test('a fenced or chatty reply is still parsed', () => {
    assert.deepStrictEqual(_parsePitches('```json\n{"pitches":["a","b"]}\n```', 2), ['a', 'b']);
    assert.deepStrictEqual(_parsePitches('Sure!\n{"pitches":["a","b"]}\nHope that helps', 2), ['a', 'b']);
});

test('a short array leaves later packages bare rather than shifting copy onto the wrong one', async () => {
    const out = await attachTierCopy({
        client: stubClient('{"pitches":["only one"]}'),
        model: 'stub', tiers: TIERS, dotsFormulary: FORMULARY, lang: 'zh',
    });
    assert.strictEqual(out[0].pitch, 'only one');
    assert.strictEqual(out[1].pitch, '', 'package 2 must stay empty, never inherit package 1\'s line');
    assert.strictEqual(out[2].pitch, '');
});

test('every failure path returns the packages unchanged — copy is never worth losing the card over', async () => {
    const throwing = { chat: { completions: { create: async () => { throw new Error('502'); } } } };
    for (const [label, client] of [
        ['call throws', throwing],
        ['unparseable', stubClient('I cannot help with that.')],
        ['wrong shape', stubClient('{"lines":["a","b"]}')],
        ['empty content', stubClient('')],
    ]) {
        const out = await attachTierCopy({
            client, model: 'stub', tiers: TIERS, dotsFormulary: FORMULARY, lang: 'zh',
        });
        assert.strictEqual(out.length, 3, label);
        assert.deepStrictEqual(out.map(t => t.pitch), ['', '', ''], label);
    }
});

test('nothing to choose between makes no call at all', async () => {
    let called = false;
    const spy = { chat: { completions: { create: async () => { called = true; return { choices: [{ message: { content: '{"pitches":["x"]}' } }] }; } } } };
    assert.deepStrictEqual(await attachTierCopy({ client: spy, model: 'stub', tiers: [], dotsFormulary: FORMULARY, lang: 'zh' }), []);
    // One package is the whole card — a user who already holds a tier, or a legacy proposal. There
    // is no comparison to write, so the call is skipped rather than spent.
    const single = [TIERS[0]];
    assert.deepStrictEqual(await attachTierCopy({ client: spy, model: 'stub', tiers: single, dotsFormulary: FORMULARY, lang: 'zh' }), single);
    // Packages with no dots at all describe nothing.
    const empty = [
        { tier_label: '轻享套装', max_distinct_dots: 6, pitch: '', morning: { dots: {} }, evening: { dots: {} } },
        { tier_label: '臻选套装', max_distinct_dots: 8, pitch: '', morning: { dots: {} }, evening: { dots: {} } },
    ];
    assert.deepStrictEqual(await attachTierCopy({ client: spy, model: 'stub', tiers: empty, dotsFormulary: FORMULARY, lang: 'zh' }), empty);
    assert.strictEqual(called, false, 'nothing to describe must not cost an LLM call');
});
