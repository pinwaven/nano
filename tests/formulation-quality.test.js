'use strict';
// Nothing in the pipeline checked the NUMBERS. JUDGE grades the prose; validateAgFormulation
// checks manufacturability and only on the AG path. So a formula could be legal, accurately
// narrated, and still aimed at the wrong dimension — and one measurably was: on 2026-09-07
// qwen-max gave a user whose only elevated dimension was Cellular Age a core holding one of the
// three cellular dots and three resilience dots, every dose on its own floor. It shipped clean.
//
// These tests pin the rules that would have caught it, and the two properties that keep the
// check safe to run on every formulation: it is pure, and it never invents a defect on a formula
// that is actually fine.
const test = require('node:test');
const assert = require('node:assert');

const { checkFormulationQuality } = require('../src/functions/worker/lib/formulationQuality.js');

const F = [
    { key_name: 'DOT-N6',  name_zh: '线粒体焕新', sub_age_target: 'Cellular Age',      target_dots_min: 17, target_dots_max: 33 },
    { key_name: 'DOT-N9',  name_zh: 'NAD焕新',    sub_age_target: 'Cellular Age',      target_dots_min: 9,  target_dots_max: 37 },
    { key_name: 'DOT-N10', name_zh: '肌光焕采',   sub_age_target: 'Cellular Age',      target_dots_min: 1,  target_dots_max: 1 },
    { key_name: 'DOT-N3',  name_zh: '静心夜',     sub_age_target: 'Resilience Age',    target_dots_min: 2,  target_dots_max: 3 },
    { key_name: 'DOT-N4',  name_zh: '持续精力',   sub_age_target: 'Resilience Age',    target_dots_min: 9,  target_dots_max: 28 },
    { key_name: 'DOT-N1',  name_zh: '甲基平衡',   sub_age_target: 'Micro-Vascular Age', target_dots_min: 1, target_dots_max: 2 },
    { key_name: 'DOT-N11', name_zh: '代谢焕新',   sub_age_target: 'Metabolic Age',     target_dots_min: 17, target_dots_max: 47,
      ingredients_zh: { '小檗碱': '31.5mg' } },
];
// Cellular is the one elevated dimension — the real shape of the profile this was measured on.
const BIOAGE = { ChronoAge: 49, SubAges: { CellularAge: 50.9, MicroVascularAge: 45.3, ResilienceAge: 43.6, MetabolicAge: 41.0 } };

const recipe = (dots, levels) => ({ morningRecipe: { dots, ...(levels ? { levels } : {}) }, eveningRecipe: { dots: {} } });
const codes = r => r.findings.map(f => f.code);

test('a formula aimed at the elevated dimension passes clean', () => {
    const r = checkFormulationQuality({
        ...recipe({ 'DOT-N6': 30, 'DOT-N9': 34, 'DOT-N3': 2, 'DOT-N11': 17 },
                  { 'DOT-N6': 'high', 'DOT-N9': 'high', 'DOT-N3': 'low', 'DOT-N11': 'low' }),
        dotsFormulary: F, bioage: BIOAGE, userFacts: [],
    });
    assert.deepStrictEqual(r.findings, []);
    assert.strictEqual(r.ok, true);
});

test('every dose on its own floor is reported as stating no priority', () => {
    // The measured qwen-max output: 15 of 15 variable-range doses at their exact minimum.
    const r = checkFormulationQuality({
        ...recipe({ 'DOT-N6': 17, 'DOT-N9': 9, 'DOT-N3': 2, 'DOT-N4': 9, 'DOT-N1': 1, 'DOT-N11': 17 }),
        dotsFormulary: F, bioage: BIOAGE, userFacts: [],
    });
    assert.ok(codes(r).includes('no_emphasis_signal'));
    assert.strictEqual(r.ok, false);
});

test('the most elevated dimension carrying no emphasis is material', () => {
    // Cellular dots present, but the weight is all on resilience — the qwen-max shape.
    const r = checkFormulationQuality({
        ...recipe({ 'DOT-N6': 17, 'DOT-N4': 26, 'DOT-N3': 3 },
                  { 'DOT-N6': 'low', 'DOT-N4': 'high', 'DOT-N3': 'high' }),
        dotsFormulary: F, bioage: BIOAGE, userFacts: [],
    });
    assert.ok(codes(r).includes('top_dimension_unemphasised'));
    assert.ok(codes(r).includes('emphasis_inverted'), 'the least elevated dimension outweighing the most is worth flagging');
    assert.strictEqual(r.findings.find(f => f.code === 'emphasis_inverted').severity, 'advisory');
});

test('an elevated dimension with nothing dosed for it at all is material', () => {
    const r = checkFormulationQuality({
        ...recipe({ 'DOT-N4': 26, 'DOT-N3': 3 }, { 'DOT-N4': 'high', 'DOT-N3': 'high' }),
        dotsFormulary: F, bioage: BIOAGE, userFacts: [],
    });
    assert.ok(codes(r).includes('elevated_dimension_uncovered'));
});

test('a dimension the formulary cannot serve is not reported as an omission', () => {
    const noCellular = F.filter(d => d.sub_age_target !== 'Cellular Age');
    const r = checkFormulationQuality({
        ...recipe({ 'DOT-N4': 26 }, { 'DOT-N4': 'high' }),
        dotsFormulary: noCellular, bioage: BIOAGE, userFacts: [],
    });
    assert.ok(!codes(r).includes('elevated_dimension_uncovered'),
        'nothing to prescribe is not the formulator\'s failure');
});

test('a dosed dot colliding with an active allergy is material, and names the dot', () => {
    const r = checkFormulationQuality({
        ...recipe({ 'DOT-N6': 30, 'DOT-N9': 34, 'DOT-N11': 40 },
                  { 'DOT-N6': 'high', 'DOT-N9': 'high', 'DOT-N11': 'moderate' }),
        dotsFormulary: F, bioage: BIOAGE,
        userFacts: [{ category: 'allergy', fact_zh: '小檗碱', status: 'active' }],
    });
    const hit = r.findings.find(f => f.code === 'allergy_conflict');
    assert.ok(hit, 'an ingredient match must be caught');
    assert.deepStrictEqual(hit.keys, ['DOT-N11']);
    assert.strictEqual(hit.severity, 'material');
});

test('an inactive fact, and a category that is not a restriction, are both ignored', () => {
    const base = { ...recipe({ 'DOT-N6': 30, 'DOT-N9': 34 }, { 'DOT-N6': 'high', 'DOT-N9': 'high' }), dotsFormulary: F, bioage: BIOAGE };
    for (const facts of [
        [{ category: 'allergy', fact_zh: 'NAD焕新', status: 'inactive' }],
        [{ category: 'goal', fact_zh: 'NAD焕新', status: 'active' }],
    ]) {
        assert.ok(!codes(checkFormulationQuality({ ...base, userFacts: facts })).includes('allergy_conflict'));
    }
});

test('a dose outside its own range is caught even though the clamp should prevent it', () => {
    const r = checkFormulationQuality({
        ...recipe({ 'DOT-N6': 5, 'DOT-N9': 99 }, { 'DOT-N6': 'high', 'DOT-N9': 'high' }),
        dotsFormulary: F, bioage: BIOAGE, userFacts: [],
    });
    assert.ok(codes(r).includes('dose_below_min'));
    assert.ok(codes(r).includes('dose_above_max'));
});

test('an empty formulation reports exactly that, and nothing else', () => {
    const r = checkFormulationQuality({ ...recipe({}), dotsFormulary: F, bioage: BIOAGE, userFacts: [] });
    assert.deepStrictEqual(codes(r), ['empty_formulation']);
});

test('no bioage at all degrades to the checks that do not need one', () => {
    const r = checkFormulationQuality({
        ...recipe({ 'DOT-N6': 30 }, { 'DOT-N6': 'high' }),
        dotsFormulary: F, bioage: null, userFacts: null,
    });
    assert.strictEqual(r.ok, true, 'a user with no Kino scan must not fail every dimension rule');
});
