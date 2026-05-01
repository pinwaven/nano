const assert = require('node:assert');
const { test, describe } = require('node:test');
const { deriveTags } = require('../src/lib/estimator/tagDerivation');

const day = (offsetDays) => new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000).toISOString();

describe('deriveTags - empty / missing inputs', () => {
    test('returns [] when called with nothing', () => {
        assert.deepStrictEqual(deriveTags(), []);
    });

    test('returns [] when all inputs are empty', () => {
        assert.deepStrictEqual(deriveTags({ history: [], weightHistory: [], compliance: {}, selfReported: [] }), []);
    });
});

describe('deriveTags - compliance thresholds', () => {
    test('Resilience compliance >= 0.7 → inflammation_load_low', () => {
        const tags = deriveTags({ compliance: { ResilienceAge: 0.75 } });
        assert.ok(tags.includes('inflammation_load_low'));
        assert.ok(!tags.includes('inflammation_load_high'));
    });

    test('Resilience compliance <= 0.3 → inflammation_load_high', () => {
        const tags = deriveTags({ compliance: { ResilienceAge: 0.2 } });
        assert.ok(tags.includes('inflammation_load_high'));
    });

    test('compliance in dead-zone (0.3,0.7) emits no compliance tag', () => {
        const tags = deriveTags({ compliance: { ResilienceAge: 0.5, MetabolicAge: 0.5, CellularAge: 0.5, MicroVascularAge: 0.5 } });
        assert.deepStrictEqual(tags, []);
    });

    test('all four pathways high → all four "low load" tags', () => {
        const tags = deriveTags({ compliance: { ResilienceAge: 0.9, MetabolicAge: 0.9, CellularAge: 0.9, MicroVascularAge: 0.9 } });
        assert.ok(tags.includes('inflammation_load_low'));
        assert.ok(tags.includes('metabolic_load_low'));
        assert.ok(tags.includes('cellular_stress_low'));
        assert.ok(tags.includes('microvascular_load_low'));
    });

    test('NaN / non-numeric compliance is ignored', () => {
        const tags = deriveTags({ compliance: { ResilienceAge: NaN, MetabolicAge: null, CellularAge: 'x' } });
        assert.deepStrictEqual(tags, []);
    });
});

describe('deriveTags - weight trend', () => {
    test('-3 kg over 90 days → weight_loss_sustained', () => {
        const tags = deriveTags({
            weightHistory: [
                { tested_at: day(-100), weight: 80 },
                { tested_at: day(-30),  weight: 78 },
                { tested_at: day(0),    weight: 77 },
            ],
        });
        assert.ok(tags.includes('weight_loss_sustained'));
    });

    test('+3 kg over 90 days → weight_gain_recent', () => {
        const tags = deriveTags({
            weightHistory: [
                { tested_at: day(-100), weight: 70 },
                { tested_at: day(0),    weight: 73 },
            ],
        });
        assert.ok(tags.includes('weight_gain_recent'));
    });

    test('< 2 kg delta → no weight tag', () => {
        const tags = deriveTags({
            weightHistory: [
                { tested_at: day(-100), weight: 70 },
                { tested_at: day(0),    weight: 71 },
            ],
        });
        assert.ok(!tags.includes('weight_loss_sustained'));
        assert.ok(!tags.includes('weight_gain_recent'));
    });

    test('single weight entry → no weight tag', () => {
        const tags = deriveTags({ weightHistory: [{ tested_at: day(0), weight: 70 }] });
        assert.deepStrictEqual(tags, []);
    });
});

describe('deriveTags - hsCRP trajectory', () => {
    test('clear downward trend → inflammation_load_low', () => {
        const tags = deriveTags({
            history: [
                { tested_at: day(-30), biomarkers: { hsCRP: 4.0 } },
                { tested_at: day(-20), biomarkers: { hsCRP: 3.0 } },
                { tested_at: day(-10), biomarkers: { hsCRP: 2.0 } },
                { tested_at: day(0),   biomarkers: { hsCRP: 1.0 } },
            ],
        });
        assert.ok(tags.includes('inflammation_load_low'));
    });

    test('< 3 history points → no trajectory tag', () => {
        const tags = deriveTags({
            history: [
                { tested_at: day(-10), biomarkers: { hsCRP: 3 } },
                { tested_at: day(0),   biomarkers: { hsCRP: 1 } },
            ],
        });
        assert.deepStrictEqual(tags, []);
    });
});

describe('deriveTags - self-reported', () => {
    test('Chinese alias 糖尿病 normalizes to diabetes_diagnosed', () => {
        const tags = deriveTags({ selfReported: ['糖尿病'] });
        assert.ok(tags.includes('diabetes_diagnosed'));
    });

    test('unknown self-reported tag is dropped', () => {
        const tags = deriveTags({ selfReported: ['some_invented_thing'] });
        assert.deepStrictEqual(tags, []);
    });
});

describe('deriveTags - dedupe', () => {
    test('compliance + downward trajectory both wanting inflammation_load_low → deduped', () => {
        const tags = deriveTags({
            compliance: { ResilienceAge: 0.9 },
            history: [
                { tested_at: day(-30), biomarkers: { hsCRP: 4.0 } },
                { tested_at: day(-20), biomarkers: { hsCRP: 3.0 } },
                { tested_at: day(-10), biomarkers: { hsCRP: 2.0 } },
                { tested_at: day(0),   biomarkers: { hsCRP: 1.0 } },
            ],
        });
        const lows = tags.filter(t => t === 'inflammation_load_low');
        assert.strictEqual(lows.length, 1);
    });
});
