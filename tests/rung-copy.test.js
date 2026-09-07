'use strict';
// The upgrade line beside each rung of the purchasable ladder used to be written by the same
// completion that produced the formula, keyed to a "tier" tag the model also had to assign. That
// could not hold: the copy is keyed on a rung's POSITION while its MEMBERSHIP comes from the
// server's emphasis ranking, so they agreed only if the model happened to reproduce a ranking it
// never saw. Nine measured qwen-plus runs, three revisions of the instruction, never once.
//
// What is asserted here is the property that replaced it: the copy call is HANDED the rung's real
// contents, so it cannot describe anything else — and it can never cost the user their card.
const test = require('node:test');
const assert = require('node:assert');

const { attachRungCopy, buildRungCopyPrompt, _parsePitches, MAX_PITCH_CHARS } =
    require('../src/functions/worker/lib/rungCopy.js');

const FORMULARY = [
    { key_name: 'DOT-N9', name: 'NAD Renew', name_zh: 'NAD焕新', sub_age_target: 'Cellular Age',
      ingredients_zh: { 'β-烟酰胺单核苷酸': '27mg' } },
    { key_name: 'DOT-N14', name: 'Flow', name_zh: '脉络畅流', sub_age_target: 'Micro-Vascular Age' },
    { key_name: 'DOT-N13', name: 'Gut Renew', name_zh: '肠道焕新', sub_age_target: 'Resilience Age' },
];
const RUNGS = [
    { tier_label: '8种原粒', max_distinct_dots: 8, pitch: '', added: [{ key: 'DOT-N9', am: 9, pm: 0 }] },
    { tier_label: '10种原粒', max_distinct_dots: 10, pitch: '', added: [{ key: 'DOT-N14', am: 0, pm: 7 }, { key: 'DOT-N13', am: 0, pm: 2 }] },
];

const stubClient = (content) => ({
    chat: { completions: { create: async () => ({ choices: [{ message: { content } }] }) } },
});

test('the prompt names the rung\'s real dots, and never their doses', () => {
    const p = buildRungCopyPrompt(RUNGS, FORMULARY, 'zh', null);
    assert.ok(p.includes('NAD焕新') && p.includes('脉络畅流') && p.includes('肠道焕新'));
    // A dose in the prompt is a number the copy could then cite, and citing one is banned.
    for (const n of ['9', '7', '2']) {
        assert.ok(!new RegExp(`${n}\\s*粒`).test(p), `dose "${n}" must not reach the copy prompt`);
    }
    assert.ok(p.includes('一个原粒的名称都不要出现'), 'the no-naming rule must survive');
});

test('the guardrail block is injected, so the upgrade-copy exception stays live', () => {
    const withDb = buildRungCopyPrompt(RUNGS, FORMULARY, 'zh', '【事实约束】DB-SOURCED');
    assert.ok(withDb.startsWith('【事实约束】DB-SOURCED'), 'a preloaded essential block must be used verbatim');
    // With no DB block the code fallback still carries the bans — never an unguarded prompt.
    const noDb = buildRungCopyPrompt(RUNGS, FORMULARY, 'zh', null);
    assert.ok(noDb.includes('事实约束'), 'the fallback guardrail must be present');
});

test('pitches land on the rungs in order, capped', async () => {
    const long = 'x'.repeat(MAX_PITCH_CHARS + 40);
    const out = await attachRungCopy({
        client: stubClient(JSON.stringify({ pitches: ['补齐细胞能量这一环', long] })),
        model: 'stub', rungs: RUNGS, dotsFormulary: FORMULARY, lang: 'zh',
    });
    assert.strictEqual(out[0].pitch, '补齐细胞能量这一环');
    assert.strictEqual(out[1].pitch.length, MAX_PITCH_CHARS);
    assert.deepStrictEqual(out.map(r => r.max_distinct_dots), [8, 10], 'rung order/identity is untouched');
});

test('a fenced or chatty reply is still parsed', () => {
    assert.deepStrictEqual(_parsePitches('```json\n{"pitches":["a","b"]}\n```', 2), ['a', 'b']);
    assert.deepStrictEqual(_parsePitches('Sure!\n{"pitches":["a","b"]}\nHope that helps', 2), ['a', 'b']);
});

test('a short array leaves later rungs bare rather than shifting copy onto the wrong rung', async () => {
    const out = await attachRungCopy({
        client: stubClient('{"pitches":["only one"]}'),
        model: 'stub', rungs: RUNGS, dotsFormulary: FORMULARY, lang: 'zh',
    });
    assert.strictEqual(out[0].pitch, 'only one');
    assert.strictEqual(out[1].pitch, '', 'rung 2 must stay empty, never inherit rung 1\'s line');
});

test('every failure path returns the rungs unchanged — copy is never worth losing the card over', async () => {
    const throwing = { chat: { completions: { create: async () => { throw new Error('502'); } } } };
    for (const [label, client] of [
        ['call throws', throwing],
        ['unparseable', stubClient('I cannot help with that.')],
        ['wrong shape', stubClient('{"lines":["a","b"]}')],
        ['empty content', stubClient('')],
    ]) {
        const out = await attachRungCopy({
            client, model: 'stub', rungs: RUNGS, dotsFormulary: FORMULARY, lang: 'zh',
        });
        assert.strictEqual(out.length, 2, label);
        assert.deepStrictEqual(out.map(r => r.pitch), ['', ''], label);
    }
});

test('no rungs, or rungs the daily budget emptied, make no call at all', async () => {
    let called = false;
    const spy = { chat: { completions: { create: async () => { called = true; return { choices: [{ message: { content: '{"pitches":["x"]}' } }] }; } } } };
    assert.deepStrictEqual(await attachRungCopy({ client: spy, model: 'stub', rungs: [], dotsFormulary: FORMULARY, lang: 'zh' }), []);
    const empty = [{ tier_label: '8种原粒', max_distinct_dots: 8, pitch: '', added: [] }];
    assert.deepStrictEqual(await attachRungCopy({ client: spy, model: 'stub', rungs: empty, dotsFormulary: FORMULARY, lang: 'zh' }), empty);
    assert.strictEqual(called, false, 'nothing to describe must not cost an LLM call');
});
