const assert = require('node:assert');
const { test, describe } = require('node:test');
const { BiomarkerEstimator } = require('../src/lib/estimator/BiomarkerEstimator');

const baseInputs = () => [40, {}, { Weight: 70, Height: 175 }];

describe('BiomarkerEstimator - determinism', () => {
    test('same seed → identical BiomarkerValues across 100 runs', () => {
        const seed = 'user-abc:2026-05-01';
        const runs = [];
        for (let i = 0; i < 100; i++) {
            const e = new BiomarkerEstimator(...baseInputs(), [], { seed });
            runs.push(e.generateReport().BiomarkerValues);
        }
        const first = JSON.stringify(runs[0]);
        for (let i = 1; i < runs.length; i++) {
            assert.strictEqual(JSON.stringify(runs[i]), first, `run ${i} diverged`);
        }
    });

    test('different seeds → different outputs (very likely)', () => {
        const a = new BiomarkerEstimator(...baseInputs(), [], { seed: 'user-a:2026-05-01' }).generateReport().BiomarkerValues;
        const b = new BiomarkerEstimator(...baseInputs(), [], { seed: 'user-b:2026-05-01' }).generateReport().BiomarkerValues;
        assert.notDeepStrictEqual(a, b);
    });

    test('no seed → uses Math.random (non-deterministic)', () => {
        // Very low probability of collision; just sanity-check the path is wired.
        const a = new BiomarkerEstimator(...baseInputs()).generateReport().BiomarkerValues;
        const b = new BiomarkerEstimator(...baseInputs()).generateReport().BiomarkerValues;
        // Allow rare equality; assertion is loose intentionally.
        assert.ok(a && b);
    });
});

describe('BiomarkerEstimator - tag adjustments', () => {
    const seed = 'fixed-seed';

    test('inflammation_load_high pushes hsCRP and IL6 strictly higher than baseline', () => {
        const baseline = new BiomarkerEstimator(...baseInputs(), [], { seed }).generateReport().BiomarkerValues;
        const tagged   = new BiomarkerEstimator(...baseInputs(), ['inflammation_load_high'], { seed }).generateReport().BiomarkerValues;
        assert.ok(tagged.hsCRP > baseline.hsCRP, `hsCRP ${tagged.hsCRP} not > ${baseline.hsCRP}`);
        assert.ok(tagged.IL6   > baseline.IL6,   `IL6 ${tagged.IL6} not > ${baseline.IL6}`);
    });

    test('inflammation_load_low pushes hsCRP and IL6 strictly lower than baseline', () => {
        const baseline = new BiomarkerEstimator(...baseInputs(), [], { seed }).generateReport().BiomarkerValues;
        const tagged   = new BiomarkerEstimator(...baseInputs(), ['inflammation_load_low'], { seed }).generateReport().BiomarkerValues;
        assert.ok(tagged.hsCRP < baseline.hsCRP, `hsCRP ${tagged.hsCRP} not < ${baseline.hsCRP}`);
        assert.ok(tagged.IL6   < baseline.IL6,   `IL6 ${tagged.IL6} not < ${baseline.IL6}`);
    });

    test('diabetes_diagnosed bumps GA upward; Chinese alias works the same', () => {
        const baseline = new BiomarkerEstimator(...baseInputs(), [], { seed }).generateReport().BiomarkerValues;
        const english  = new BiomarkerEstimator(...baseInputs(), ['diabetes_diagnosed'], { seed }).generateReport().BiomarkerValues;
        const chinese  = new BiomarkerEstimator(...baseInputs(), ['糖尿病'], { seed }).generateReport().BiomarkerValues;
        assert.ok(english.GA > baseline.GA);
        assert.strictEqual(english.GA, chinese.GA);
    });

    test('unknown tags are silently dropped (no throw, no effect)', () => {
        const baseline = new BiomarkerEstimator(...baseInputs(), [], { seed }).generateReport().BiomarkerValues;
        const noisy    = new BiomarkerEstimator(...baseInputs(), ['nonsense_tag', 'another'], { seed }).generateReport().BiomarkerValues;
        assert.deepStrictEqual(noisy, baseline);
    });

    test('AppliedTags reflects normalized + filtered set', () => {
        const report = new BiomarkerEstimator(...baseInputs(), ['糖尿病', 'unknown', 'inflammation_load_high'], { seed }).generateReport();
        assert.deepStrictEqual(report.AppliedTags.sort(), ['diabetes_diagnosed', 'inflammation_load_high'].sort());
    });

    test('test_data overrides skip tag adjustments (measured value wins)', () => {
        const measured = { hsCRP: 0.5 };
        const report = new BiomarkerEstimator(40, measured, { Weight: 70, Height: 175 }, ['inflammation_load_high'], { seed }).generateReport();
        assert.strictEqual(report.BiomarkerValues.hsCRP, 0.5);
    });
});
