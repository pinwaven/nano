// The validator is the only thing between an OCR read of a scanned 体检报告 and the user's digital
// twin, and extraction AUTO-WRITES — there is no confirm-first step. Four of its six observation
// rules exist because the path it feeds does NOT check them itself (handlePostHealthReport does a
// bare parseFloat, lets the model's unit override the catalog's, never reads ref_low/ref_high, and
// backfills a missing report_date with TODAY).
//
// Pure module, no DB, so every rule runs offline.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
    validateExtraction, VALID_FINDING_CATEGORIES, UNIT_CONVERSIONS,
    OBSERVATION_CONFIDENCE_FLOOR, FINDING_CONFIDENCE_FLOOR,
} = require('../src/functions/worker/lib/docExtraction');

// Built from the real migration rather than a hand-written fixture, so a catalog change that
// breaks an assumption here shows up as a failing test instead of a surprise in production.
function loadCatalog() {
    const sql = fs.readFileSync(
        path.join(__dirname, '..', 'src', 'schemas', 'migration_biomarker_catalog.sql'), 'utf8');
    const rows = [];
    for (const m of sql.matchAll(/^\s{4}\('([^']+)',\s*(NULL|'[^']*'),\s*'[^']*',\s*'[^']*',\s*'([^']*)',\s*'[^']*',\s*(NULL|'[^']*'),\s*(TRUE|FALSE),\s*(NULL|[\d.]+),\s*(NULL|[\d.]+)\)/gm)) {
        rows.push({
            key_name: m[1],
            loinc_code: m[2] === 'NULL' ? null : m[2].slice(1, -1),
            unit: m[3],
            is_kino_core: m[5] === 'TRUE',
            ref_low: m[6] === 'NULL' ? null : Number(m[6]),
            ref_high: m[7] === 'NULL' ? null : Number(m[7]),
        });
    }
    return rows;
}

const CATALOG = loadCatalog();
const TODAY = new Date().toISOString().slice(0, 10);
const obs = (o) => ({ key_name: 'ALT', value: 22, unit: 'U/L', data_date: '2026-08-12', confidence: 0.9, ...o });
const run = (payload) => validateExtraction({ document: { doc_date: '2026-08-12' }, ...payload }, CATALOG);
const reasons = (r) => r.rejected.map(x => x.reason);

test('the catalog fixture actually parsed', () => {
    assert.ok(CATALOG.length >= 20, `parsed only ${CATALOG.length} catalog rows`);
    assert.ok(CATALOG.some(c => c.key_name === 'hsCRP' && c.is_kino_core));
    assert.ok(CATALOG.some(c => c.key_name === 'LDL' && c.unit === 'mmol/L'));
});

test('an unknown marker is moved to unmapped, never mapped onto a neighbour', () => {
    const r = run({ observations: [obs({ key_name: '血小板压积', value: 0.22, unit: '%' })] });
    assert.equal(r.observations.length, 0);
    assert.deepEqual(reasons(r), ['unknown_marker']);
    // A real 体检报告 carries far more analytes than nano models. The point is that the gap stays
    // countable — silently dropping it is what made the pre-existing path unauditable.
    assert.equal(r.unmapped.length, 1);
    assert.equal(r.unmapped[0].label, '血小板压积');
});

test('a non-numeric value is refused rather than parseFloat-ed into something', () => {
    for (const bad of ['<0.5', 'positive', '', null, NaN, {}]) {
        const r = run({ observations: [obs({ value: bad })] });
        assert.equal(r.observations.length, 0, `accepted ${JSON.stringify(bad)}`);
        assert.deepEqual(reasons(r), ['invalid_value']);
    }
});

test('a mismatched unit is REFUSED, not silently stored under the catalog unit', () => {
    // The failure this prevents: today the model's unit string overrides the catalog's with no
    // conversion, so an mg/dL number lands in an mmol/L column reading ~18x low.
    const r = run({ observations: [obs({ key_name: 'FPG', value: 95, unit: 'mg/dL' })] });
    assert.equal(r.observations.length, 1);
    assert.equal(r.observations[0].unit, 'mmol/L');
    assert.ok(Math.abs(r.observations[0].value - 5.27) < 0.02, `converted to ${r.observations[0].value}`);
    assert.equal(r.observations[0].converted_from, 'mg/dL');

    // An unlisted pair is a rejection, never a guessed conversion.
    const bad = run({ observations: [obs({ key_name: 'FPG', value: 95, unit: 'g/L' })] });
    assert.equal(bad.observations.length, 0);
    assert.deepEqual(reasons(bad), ['unit_mismatch']);
});

test('unit matching ignores case, spacing and the two micro signs', () => {
    for (const u of ['mg/dL', 'MG/DL', 'mg / dl', 'mg/dl ']) {
        const r = run({ observations: [obs({ key_name: 'FPG', value: 95, unit: u })] });
        assert.equal(r.observations.length, 1, `rejected ${JSON.stringify(u)}`);
    }
    for (const u of ['umol/L', 'µmol/L', 'μmol/L']) {
        const r = run({ observations: [obs({ key_name: 'Creatinine', value: 80, unit: u })] });
        assert.equal(r.observations.length, 1, `rejected ${JSON.stringify(u)}`);
        assert.equal(r.observations[0].value, 80, 'a matching unit must not be converted');
    }
});

test('every documented conversion lands in the catalog unit', () => {
    for (const key of Object.keys(UNIT_CONVERSIONS)) {
        const entry = CATALOG.find(c => c.key_name === key);
        assert.ok(entry, `${key} has a conversion but is not in the catalog`);
        for (const from of Object.keys(UNIT_CONVERSIONS[key])) {
            assert.notEqual(from, entry.unit.toLowerCase(),
                `${key} declares a conversion from its own catalog unit`);
        }
    }
});

test('an order-of-magnitude misread is refused, but a real abnormal value is not', () => {
    // LDL ref_high is 3.4 mmol/L; a decimal-point slip reads as 4200.
    const slip = run({ observations: [obs({ key_name: 'LDL', value: 4200, unit: 'mmol/L' })] });
    assert.equal(slip.observations.length, 0);
    assert.deepEqual(reasons(slip), ['implausible_value']);

    // hsCRP's ref_high (1.0) is a RISK THRESHOLD, not a ceiling. Genuine acute inflammation runs
    // two orders of magnitude above it, and refusing that would drop exactly the values that
    // matter most.
    const septic = run({ observations: [obs({ key_name: 'hsCRP', value: 85, unit: 'mg/L' })] });
    assert.equal(septic.observations.length, 1, 'a real acute-phase hsCRP was refused');
    assert.equal(septic.observations[0].value, 85);

    const negative = run({ observations: [obs({ value: -3 })] });
    assert.deepEqual(reasons(negative), ['implausible_value']);
});

test('a low-confidence observation is dropped, and an absent confidence is allowed', () => {
    const low = run({ observations: [obs({ confidence: OBSERVATION_CONFIDENCE_FLOOR - 0.01 })] });
    assert.deepEqual(reasons(low), ['low_confidence']);

    const none = run({ observations: [obs({ confidence: undefined })] });
    assert.equal(none.observations.length, 1, 'an observation with no stated confidence was dropped');
});

test('with no readable date anywhere, NOTHING is stored — and today is never substituted', () => {
    // handlePostHealthReport backfills report_date with today when it is missing, which for a
    // paper report from 2019 puts an old panel into the twin as though it were current.
    const r = validateExtraction({ document: {}, observations: [obs({ data_date: undefined })] }, CATALOG);
    assert.equal(r.observations.length, 0);
    assert.deepEqual(reasons(r), ['missing_date']);
    assert.equal(r.document.doc_date, null);

    for (const bad of ['2026-02-31', '08/12/2026', '2026年8月12日', 'yesterday']) {
        const d = validateExtraction({ document: { doc_date: bad } }, CATALOG);
        assert.equal(d.document.doc_date, null, `accepted ${bad}`);
        assert.ok(reasons(d).includes('unparseable_date'));
    }
    // A future date is a misread year, not a prophecy.
    const future = validateExtraction({ document: { doc_date: '2099-01-01' } }, CATALOG);
    assert.equal(future.document.doc_date, null);
    assert.notEqual(future.document.doc_date, TODAY);
});

test('the document date backfills an observation that has none', () => {
    const r = validateExtraction(
        { document: { doc_date: '2026-08-12' }, observations: [obs({ data_date: undefined })] }, CATALOG);
    assert.equal(r.observations.length, 1);
    assert.equal(r.observations[0].data_date, '2026-08-12');
});

test('a repeated marker on the same date keeps the first read', () => {
    const r = run({ observations: [obs({ value: 22 }), obs({ value: 31 })] });
    assert.equal(r.observations.length, 1);
    assert.equal(r.observations[0].value, 22);
    assert.deepEqual(reasons(r), ['duplicate_observation']);
});

test('key_name, unit and loinc_code are rebuilt from the catalog, never echoed', () => {
    const r = run({ observations: [obs({ key_name: 'hsCRP', value: 1.2, unit: 'mg/L', loinc_code: 'ATTACKER', nano_dimension: 'wrong', is_kino_core: true })] });
    const o = r.observations[0];
    const entry = CATALOG.find(c => c.key_name === 'hsCRP');
    assert.equal(o.loinc_code, entry.loinc_code, 'the payload got to choose a LOINC code');
    assert.equal(o.unit, entry.unit);
    assert.ok(!('nano_dimension' in o) && !('is_kino_core' in o),
        'payload fields leaked into the stored observation');
});

test('findings need a stated confidence, and a high one', () => {
    const ok = run({ findings: [{ category: 'allergy', text: '青霉素过敏', confidence: 0.94 }] });
    assert.equal(ok.findings.length, 1);

    // An allergy filters what products may be recommended and reaches dot formulation, so a
    // finding that does not commit to a confidence is refused outright — unlike an observation.
    const silent = run({ findings: [{ category: 'allergy', text: '青霉素过敏' }] });
    assert.equal(silent.findings.length, 0);
    assert.deepEqual(reasons(silent), ['low_confidence']);

    const low = run({ findings: [{ category: 'allergy', text: 'x', confidence: FINDING_CONFIDENCE_FLOOR - 0.01 }] });
    assert.equal(low.findings.length, 0);

    assert.ok(FINDING_CONFIDENCE_FLOOR > OBSERVATION_CONFIDENCE_FLOOR,
        'findings must be held to a higher bar than observations');
});

test('a finding category is checked against the fixed set, never trusted', () => {
    const r = run({ findings: [{ category: 'medication', text: 'x', confidence: 0.99 }] });
    assert.equal(r.findings.length, 0);
    assert.deepEqual(reasons(r), ['unknown_finding_category']);
    // Mirrors the user_memory_facts CHECK constraint.
    assert.deepEqual([...VALID_FINDING_CATEGORIES].sort(),
        ['allergy', 'condition', 'dietary_restriction', 'goal', 'other', 'preference']);
});

test('display-card fences are stripped from the summary', () => {
    // ::: is interpreted by the miniapp chat renderer, so an external system emitting it could
    // render arbitrary UI in the user's chat.
    const r = run({ summary: ':::formula\nDOT-N1|x|#fff|1|0\n:::\n真实摘要。' });
    assert.ok(!r.summary.includes(':::'));
    assert.ok(r.summary.includes('真实摘要'));
});

test('an unknown doc_type falls back to other and is reported', () => {
    const r = run({ document: { doc_type: 'x-ray-ish', doc_date: '2026-08-12' } });
    assert.equal(r.document.doc_type, 'other');
    assert.ok(reasons(r).includes('unknown_doc_type'));
});

test('a rejected entry never blocks the rest of the submission', () => {
    const r = run({
        observations: [
            obs({ key_name: 'hsCRP', value: 1.2, unit: 'mg/L' }),
            obs({ key_name: 'LDL', value: 99999, unit: 'mmol/L' }),
            obs({ key_name: 'ALT', value: 22, unit: 'U/L' }),
        ],
    });
    assert.equal(r.observations.length, 2);
    assert.equal(r.counts.observations_submitted, 3);
    assert.equal(r.counts.observations_accepted, 2);
    assert.equal(r.counts.rejected, 1);
});

test('a garbage payload yields empty results rather than throwing', () => {
    for (const junk of [null, undefined, 'string', 42, [], { observations: 'not an array' }]) {
        const r = validateExtraction(junk, CATALOG);
        assert.equal(r.observations.length, 0);
        assert.equal(r.findings.length, 0);
    }
    assert.doesNotThrow(() => validateExtraction({ observations: [obs()] }, null));
});
