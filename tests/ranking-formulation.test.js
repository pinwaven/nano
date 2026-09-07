'use strict';
// The model returns an ORDERED list of the dots that matter most, and every number is the
// server's. This replaced "dose all 18 and infer an order from the doses", which asked for the
// hard thing (18 independent numbers across ranges spanning two orders of magnitude) in order to
// derive the easy one — and measured 2026-09-07 the model never actually did it: every
// variable-range dose landed on a floor or a ceiling, never between.
const test = require('node:test');
const assert = require('node:assert');

const D = require('../src/functions/worker/handlers/dots.js');
const { N7_KEY } = require('../src/functions/worker/lib/dotsProductModel.js');

const F = [
    { key_name: 'DOT-N9',  name_zh: 'NAD焕新',    sub_age_target: 'Cellular Age',       target_dots_min: 9,  target_dots_max: 37 },
    { key_name: 'DOT-N6',  name_zh: '线粒体焕新', sub_age_target: 'Cellular Age',       target_dots_min: 17, target_dots_max: 33 },
    { key_name: 'DOT-N3',  name_zh: '静心夜',     sub_age_target: 'Resilience Age',     target_dots_min: 2,  target_dots_max: 3 },
    { key_name: 'DOT-N4',  name_zh: '持续精力',   sub_age_target: 'Resilience Age',     target_dots_min: 9,  target_dots_max: 28 },
    { key_name: 'DOT-N17', name_zh: '血脂平衡',   sub_age_target: 'Metabolic Age',      target_dots_min: 28, target_dots_max: 87 },
    { key_name: 'DOT-N1',  name_zh: '甲基平衡',   sub_age_target: 'Micro-Vascular Age', target_dots_min: 1,  target_dots_max: 2 },
    { key_name: 'DOT-N12', name_zh: '敏锐心智',   sub_age_target: null,                 target_dots_min: 8,  target_dots_max: 17 },
    { key_name: N7_KEY,    name_zh: '衰老清除',   sub_age_target: 'Cellular Age',       target_dots_min: 0,  target_dots_max: 33 },
];
// Cellular is the one dimension above chronological age — the real shape of the profile this was
// built against. Resilience reads NORMAL even for a user sleeping 5.3h a night, which is why rank
// has to outweigh severity: severity alone would floor every sleep dot.
const BIO = { ChronoAge: 49, SubAges: { CellularAge: 50.9, MicroVascularAge: 45.3, ResilienceAge: 43.6, MetabolicAge: 41.0 } };

const pos = (key, count) => {
    const d = F.find(x => x.key_name === key);
    return (count - d.target_dots_min) / (d.target_dots_max - d.target_dots_min);
};

test('every dose lands inside its own range, whatever the ranking', () => {
    const order = ['DOT-N1', 'DOT-N17', 'DOT-N9', 'DOT-N12', 'DOT-N3', 'DOT-N6', 'DOT-N4'];
    for (const [k, c] of D._doseFromRanking(order, F, BIO)) {
        const d = F.find(x => x.key_name === k);
        assert.ok(c >= d.target_dots_min && c <= d.target_dots_max, `${k} -> ${c}`);
    }
});

test('rank drives the dose — the same dot placed first and last differs', () => {
    const first = D._doseFromRanking(['DOT-N4', 'DOT-N9', 'DOT-N6', 'DOT-N3'], F, BIO).get('DOT-N4');
    const last  = D._doseFromRanking(['DOT-N9', 'DOT-N6', 'DOT-N3', 'DOT-N4'], F, BIO).get('DOT-N4');
    assert.ok(first > last, `ranking a dot first must dose it higher (${first} vs ${last})`);
});

test('a dot whose dimension is NOT elevated still gets a real dose when ranked highly', () => {
    // The reason rank outweighs severity. 静心夜 targets Resilience, which for this user reads
    // normal; if severity decided alone, a formula built around 5.3h of sleep would floor it.
    const dosed = D._doseFromRanking(['DOT-N3', 'DOT-N4', 'DOT-N9', 'DOT-N6'], F, BIO);
    assert.ok(pos('DOT-N4', dosed.get('DOT-N4')) > 0.2,
        'a highly ranked dot for a normal dimension must not be pinned to its floor');
});

test('severity lifts a dot targeting the elevated dimension over one that does not', () => {
    // Same rank position, different dimension: cellular is elevated, metabolic is the best.
    const a = D._doseFromRanking(['DOT-N9', 'DOT-N17'], F, BIO);
    const b = D._doseFromRanking(['DOT-N17', 'DOT-N9'], F, BIO);
    assert.ok(pos('DOT-N9', a.get('DOT-N9')) > pos('DOT-N17', b.get('DOT-N17')),
        'the elevated dimension must win when rank is equal');
});

test('nothing is dosed to its absolute ceiling — the capsule budget is shared', () => {
    for (const [k, c] of D._doseFromRanking(['DOT-N9', 'DOT-N6', 'DOT-N4'], F, BIO)) {
        const d = F.find(x => x.key_name === k);
        if (d.target_dots_max === d.target_dots_min) continue;
        assert.ok(c < d.target_dots_max, `${k} was maxed at ${c}; a first pick must not starve the rest`);
    }
});

test('DOT-N7, unknown keys and duplicates are all dropped, and D- keys are accepted', () => {
    const dosed = D._doseFromRanking(['D-N9', N7_KEY, 'DOT-N9', 'DOT-NOPE', 'D-N6'], F, BIO);
    assert.deepStrictEqual([...dosed.keys()], ['DOT-N9', 'DOT-N6'],
        'N7 is system-controlled, a repeat is not a second dot, and an invented key is never guessed at');
});

test('a user with no bioage still gets a formulation, ranked only', () => {
    const dosed = D._doseFromRanking(['DOT-N9', 'DOT-N6', 'DOT-N3'], F, null);
    assert.strictEqual(dosed.size, 3);
    assert.ok(pos('DOT-N9', dosed.get('DOT-N9')) > pos('DOT-N3', dosed.get('DOT-N3')));
});

test('the severity baseline needs no model, and puts the elevated dimension first', () => {
    const order = D._rankDotsBySeverity(F, BIO, null);
    assert.ok(!order.includes(N7_KEY), 'the reset dot is never ranked');
    assert.ok(['DOT-N6', 'DOT-N9'].includes(order[0]), `expected a cellular dot first, got ${order[0]}`);
    assert.deepStrictEqual(order, D._rankDotsBySeverity(F, BIO, null), 'must be deterministic');
});

test('an active focus lifts its recommended dots in the baseline', () => {
    const plain = D._rankDotsBySeverity(F, BIO, null);
    const focused = D._rankDotsBySeverity(F, BIO, new Set(['DOT-N17']));
    assert.ok(focused.indexOf('DOT-N17') < plain.indexOf('DOT-N17'));
});
