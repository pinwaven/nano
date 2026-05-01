const assert = require('node:assert');
const { test, describe } = require('node:test');
const { TAG_REGISTRY, TAG_ALIASES, VALID_BIOMARKER_KEYS, normalizeTag } = require('../src/lib/estimator/tagRegistry');

describe('tagRegistry', () => {
    test('every tag has at least one biomarker effect', () => {
        for (const [tag, effects] of Object.entries(TAG_REGISTRY)) {
            assert.ok(Object.keys(effects).length > 0, `tag ${tag} has no effects`);
        }
    });

    test('every effect targets a valid biomarker key with a valid operator', () => {
        for (const [tag, effects] of Object.entries(TAG_REGISTRY)) {
            for (const [biomarker, rule] of Object.entries(effects)) {
                assert.ok(VALID_BIOMARKER_KEYS.has(biomarker), `${tag} targets unknown biomarker ${biomarker}`);
                assert.ok(Array.isArray(rule) && rule.length === 2, `${tag}.${biomarker} rule is not [op, n]`);
                assert.ok(['*', '+'].includes(rule[0]), `${tag}.${biomarker} bad op ${rule[0]}`);
                assert.ok(typeof rule[1] === 'number', `${tag}.${biomarker} non-numeric value`);
            }
        }
    });

    test('aliases resolve to valid registry entries', () => {
        for (const [alias, target] of Object.entries(TAG_ALIASES)) {
            assert.ok(TAG_REGISTRY[target], `alias ${alias} → ${target} not in registry`);
            assert.strictEqual(normalizeTag(alias), target);
        }
    });

    test('normalizeTag passes through unknown tags unchanged', () => {
        assert.strictEqual(normalizeTag('inflammation_load_low'), 'inflammation_load_low');
        assert.strictEqual(normalizeTag('made_up_tag'), 'made_up_tag');
    });
});
