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
    const rows = [];
    for (const file of ['migration_biomarker_catalog.sql', 'migration_biomarker_catalog_v2.sql']) {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'src', 'schemas', file), 'utf8');
    for (const m of sql.matchAll(/^\s{4}\('([^']+)',\s*(NULL|'[^']*'),\s*'([^']*)',\s*'([^']*)',\s*'([^']*)',\s*'[^']*',\s*(NULL|'[^']*'),\s*(TRUE|FALSE),\s*(NULL|[\d.]+),\s*(NULL|[\d.]+)\)/gm)) {
        rows.push({
            key_name: m[1],
            loinc_code: m[2] === 'NULL' ? null : m[2].slice(1, -1),
            display_name: m[3],
            display_name_zh: m[4],
            unit: m[5],
            is_kino_core: m[7] === 'TRUE',
            ref_low: m[8] === 'NULL' ? null : Number(m[8]),
            ref_high: m[9] === 'NULL' ? null : Number(m[9]),
        });
    }
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

test('the row date fills in for a page with no printed date, and today never does', () => {
    // Dev job 15: six lipid/liver values read off a photo with no date, all refused. The user
    // sets the date on the document (PATCH) and re-runs; the row's date must rescue the read.
    const payload = { document: {}, observations: [obs({ data_date: undefined })] };
    const without = validateExtraction(payload, CATALOG);
    assert.deepEqual(reasons(without), ['missing_date']);
    const withRow = validateExtraction(payload, CATALOG, null, { fallbackDocDate: '2026-05-01' });
    assert.equal(withRow.observations.length, 1);
    assert.equal(withRow.observations[0].data_date, '2026-05-01');
    assert.equal(withRow.document.doc_date, '2026-05-01');
    // A printed date still wins over the row's.
    const printed = validateExtraction({ document: { doc_date: '2026-06-01' }, observations: [obs({ data_date: undefined })] },
        CATALOG, null, { fallbackDocDate: '2026-05-01' });
    assert.equal(printed.observations[0].data_date, '2026-06-01');
    // Garbage in the fallback is ignored, not coerced.
    const junk = validateExtraction(payload, CATALOG, null, { fallbackDocDate: 'yesterday' });
    assert.deepEqual(reasons(junk), ['missing_date']);
});

test('printed-row extras ride through on observations and unmapped, normalised', () => {
    const r = run({
        observations: [obs({ label: '丙氨酸氨基转移酶 ALT', ref_text: '9-50', flag: 'H', section: '肝功能' })],
        unmapped: [
            { label: '血小板压积', value: '0.22', unit: '%', ref_text: '0.17-0.35', flag: '偏低', section: '血常规' },
            { label: '乙肝表面抗原', value: '阴性', flag: 'whatever', section: 'x'.repeat(200) },
            { value: '1' },   // no label: dropped
        ],
    });
    assert.equal(r.observations[0].label, '丙氨酸氨基转移酶 ALT');
    assert.equal(r.observations[0].ref_text, '9-50');
    assert.equal(r.observations[0].flag, 'high');
    assert.equal(r.observations[0].section, '肝功能');
    assert.equal(r.unmapped.length, 2);
    assert.equal(r.unmapped[0].flag, 'low');
    assert.equal(r.unmapped[0].ref_text, '0.17-0.35');
    assert.equal(r.unmapped[1].flag, null, 'an unrecognised flag is "not flagged", never guessed');
    assert.equal(r.unmapped[1].section.length, 60);
    // A mapped observation with no printed label falls back to the catalog's Chinese name.
    const bare = run({ observations: [obs({})] });
    assert.equal(bare.observations[0].label, '丙氨酸氨基转移酶');
});

test('the structured block is kept within its caps and refused whole outside them', () => {
    const ok = run({ structured: { kind: 'genetic', sections: [{ title: 'FTO', rows: [{ label: 'rs9939609', value: 'AT', note: ':::formula\nnope' }] }] } });
    assert.equal(ok.rejected.length, 0);
    assert.equal(ok.structured.kind, 'genetic');
    assert.equal(ok.structured.sections[0].rows[0].value, 'AT');
    assert.ok(!ok.structured.sections[0].rows[0].note.includes(':::'), 'display-card fences are stripped from every string');
    assert.equal(ok.counts.structured, 1);

    // Depth 8 (root = 1) is the cap: contract 3's version-2 table model needs 7.
    const tooDeep = run({ structured: { a: { b: { c: { d: { e: { f: { g: { h: { i: 1 } } } } } } } } } });
    assert.equal(tooDeep.structured, null);
    assert.deepEqual(reasons(tooDeep), ['invalid_structured']);

    const tooWide = run({ structured: { list: new Array(201).fill(1) } });
    assert.deepEqual(reasons(tooWide), ['invalid_structured']);

    const notObject = run({ structured: [1, 2, 3] });
    assert.deepEqual(reasons(notObject), ['invalid_structured']);

    const absent = run({});
    assert.equal(absent.structured, null);
    assert.equal(absent.counts.structured, 0);
});

test('the v2 conversions land in the catalog unit', () => {
    const b12 = run({ observations: [obs({ key_name: 'VitaminB12', value: 500, unit: 'pg/mL' })] });
    assert.equal(b12.observations[0].unit, 'pmol/L');
    assert.equal(b12.observations[0].value, 369);
    const tbil = run({ observations: [obs({ key_name: 'TBIL', value: 1.0, unit: 'mg/dL' })] });
    assert.equal(tbil.observations[0].value, 17.1);
    // Lp(a) has no fixed nmol/L↔mg/L factor: a mismatch is refused, never guessed.
    const lpa = run({ observations: [obs({ key_name: 'LpA', value: 75, unit: 'nmol/L' })] });
    assert.deepEqual(reasons(lpa), ['unit_mismatch']);
});

test('a sentence fragment is refused as an analyte label, and a prose "finding" is refused as a fact', () => {
    // Every case below was actually submitted by the external agent's text-layer path on dev
    // (user 55761144, 2026-09-15). "理想水平是小于 10" became an Hcy of 10 in the twin — the real
    // results on the page were 12.6 and 8.7 — and six `allergy` facts came from a genomics
    // report's explanatory prose, all at a constant 0.85 confidence.
    const r = run({
        observations: [
            obs({ key_name: 'ALT', value: 10, label: '同型半胱氨酸的理想水平是小于' }),
            obs({ key_name: 'ALT', value: 22, label: '丙氨酸氨基转移酶(ALT)' }),
        ],
        unmapped: [
            { label: '如果被检者年龄小于', value: '40', unit: 'ng/ml' },
            { label: '患病概率比您高的人群占', value: '4', unit: '%' },
            { label: '岛素水平和不孕。研究表明，', value: '6', unit: '%' },
            { label: 'AMH值', value: '3.35', unit: 'ng/ml' },
            { label: '抗缪勒氏管激素（AMH）', value: '3.35', unit: 'ng/ml' },
            { label: 'β-酮戊二酸', value: '1.00', ref_text: '≤0.11', flag: '偏高' },
        ],
        findings: [
            { category: 'allergy', text: '过敏：免疫', confidence: 0.85 },
            { category: 'allergy', text: '食物过敏：免疫', confidence: 0.85 },
            { category: 'allergy', text: '过敏：个别病人', confidence: 0.85 },
            { category: 'allergy', text: '过敏：约25%的病人可有皮疹，10%的病人可出现瘙痒，通常皮疹', confidence: 0.85 },
            { category: 'allergy', text: '药物过敏：患者是否会对药物产生过敏反应', confidence: 0.85 },
            { category: 'allergy', text: '青霉素过敏', confidence: 0.9 },
            { category: 'allergy', text: '药物过敏：青霉素', confidence: 0.9 },
            { category: 'condition', text: '2型糖尿病', confidence: 0.9 },
        ],
    });
    assert.deepEqual(r.observations.map(o => o.value), [22]);
    assert.deepEqual(r.unmapped.map(u => u.label), ['AMH值', '抗缪勒氏管激素（AMH）', 'β-酮戊二酸']);
    assert.deepEqual(r.findings.map(f => f.text), ['青霉素过敏', '药物过敏：青霉素', '2型糖尿病']);
    assert.equal(reasons(r).filter(x => x === 'implausible_label').length, 4);
    assert.equal(reasons(r).filter(x => x === 'implausible_finding').length, 5);
});

// ── contract 3 ───────────────────────────────────────────────────────────────────────────────

const V2 = { version: 2, kind: 'lab_report', sections: [
    { title: '血常规', tables: [{ columns: ['项目', '结果', '单位'], rows: [['血小板压积', '0.21', '%'], ['MPV', '10.2', 'fL']] }],
      pairs: [{ label: 'HPV52', value: '阳性' }] },
] };
const TAGS = [
    { tag_key: 'allergy:shellfish', category: 'allergy', name_zh: '海鲜过敏', values: null },
    { tag_key: 'result:hpv52', category: 'result', name_zh: 'HPV52', values: ['positive', 'negative'] },
];
const runTags = (tags, extra = {}) => validateExtraction({ document: { doc_date: '2026-08-12' }, tags, ...extra }, CATALOG, null, { tagCatalogRows: TAGS });

test('structured v2 is a table model and is refused whole when it is not one', () => {
    assert.equal(run({ structured: V2 }).structured.sections[0].tables[0].rows.length, 2);
    const ragged = JSON.parse(JSON.stringify(V2)); ragged.sections[0].tables[0].rows[1] = ['MPV', '10.2'];
    assert.deepEqual(reasons(run({ structured: ragged })), ['invalid_structured']);
    const dupCols = JSON.parse(JSON.stringify(V2)); dupCols.sections[0].tables[0].columns = ['项目', '项目', '单位'];
    assert.deepEqual(reasons(run({ structured: dupCols })), ['invalid_structured']);
    assert.deepEqual(reasons(run({ structured: { version: 2 } })), ['invalid_structured']);
    assert.deepEqual(reasons(run({ structured: { version: 3, sections: [] } })), ['invalid_structured']);
    // Contract 2's shape, with or without version 1, still lands untouched.
    assert.equal(run({ structured: { version: 1, kind: 'genetic', anything: [1, 2] } }).structured.kind, 'genetic');
});

test('a source reference is kept when it points inside the block and dropped with a warning otherwise', () => {
    const r = run({ structured: V2, observations: [
        obs({ source: 's0.t0.r1' }), obs({ key_name: 'LDL', value: 3.9, unit: 'mmol/L', source: 's0.t0.r2' }),
        obs({ key_name: 'HDL', value: 1.4, unit: 'mmol/L', source: 'row 3' }),
    ], unmapped: [{ label: 'MPV', value: '10.2', source: 's0.p0' }, { label: 'X', value: '1', source: 's1.p0' }] });
    assert.equal(r.observations[0].source, 's0.t0.r1');
    assert.equal(r.observations[1].source, null, 'row 2 does not exist');
    assert.equal(r.observations[2].source, null);
    assert.equal(r.unmapped[0].source, 's0.p0');
    assert.equal(r.unmapped[1].source, null);
    assert.equal(r.observations.length, 3, 'a bad source must not reject the item');
    assert.deepEqual(r.warnings.map(w => w.reason), ['bad_source', 'bad_source', 'bad_source']);
    assert.equal(r.counts.warnings, 3);
    // Without a v2 block only the format is checked.
    assert.equal(run({ observations: [obs({ source: 's7.t3.r99' })] }).observations[0].source, 's7.t3.r99');
});

test('suggested_key is stored beside an unmapped row, never promoted, and dropped when unknown', () => {
    const r = run({ unmapped: [
        { label: '发锌', value: '112', unit: 'ug/g', suggested_key: 'HairZn', suggested_confidence: 0.7 },
        { label: '血小板压积', value: '0.21', suggested_key: 'PCT', suggested_confidence: 0.9 },
        { label: '总胆固醇', value: '5.1', unit: 'mmol/L', suggested_key: 'TotalCholesterol', suggested_confidence: 7 },
    ] });
    assert.equal(r.unmapped.length, 3);
    assert.equal(r.unmapped[0].suggested_key, 'HairZn');
    assert.equal(r.unmapped[0].suggested_confidence, 0.7);
    assert.equal(r.unmapped[1].suggested_key, null);
    assert.deepEqual(r.warnings.map(w => w.reason), ['unknown_suggested_key']);
    assert.equal(r.unmapped[2].suggested_confidence, 1, 'clamped, not refused — it is a hint');
    assert.equal(r.observations.length, 0, 'a suggestion became an observation');
});

test('tags: a fact needs a catalog key and a high confidence; an unknown key is demoted, not rejected', () => {
    const r = runTags([
        { kind: 'fact', tag_key: 'allergy:shellfish', category: 'allergy', text: '海鲜过敏', confidence: 0.9 },
        { kind: 'fact', tag_key: 'allergy:mango', category: 'allergy', text: '芒果过敏', confidence: 0.9 },
        { kind: 'fact', tag_key: 'allergy:shellfish', category: 'condition', text: '海鲜过敏', confidence: 0.9 },
        { kind: 'fact', tag_key: 'allergy:shellfish', category: 'allergy', text: '海鲜过敏?', confidence: 0.7 },
        { kind: 'fact', tag_key: 'allergy:shellfish', category: 'allergy', text: '海鲜过敏' },
        { kind: 'descriptor', category: 'lifestyle', text: '长期夜班' },
        { kind: 'verdict', category: 'lifestyle', text: '高风险' },
        { kind: 'fact', tag_key: 'allergy:shellfish', category: 'risk', text: '海鲜过敏', confidence: 0.9 },
        { kind: 'fact', tag_key: 'allergy:shellfish', category: 'allergy', text: '', confidence: 0.9 },
        { kind: 'fact', tag_key: 'allergy:shellfish', category: 'allergy', text: '海鲜过敏', status: 'gone', confidence: 0.9 },
        { kind: 'fact', tag_key: 'allergy:shellfish', category: 'allergy', text: '海鲜过敏', since: 'last year', confidence: 0.9 },
    ]);
    assert.deepEqual(r.tags.map(t => [t.kind, t.tag_key, t.reason]), [
        ['fact', 'allergy:shellfish', null],
        ['descriptor', null, 'unknown_tag'],
        ['descriptor', null, 'tag_category_mismatch'],
        ['descriptor', null, null],
    ]);
    assert.deepEqual(reasons(r).sort(), ['bad_tag_status', 'empty_tag', 'invalid_tag', 'low_confidence', 'low_confidence', 'unknown_tag_category', 'unparseable_date'].sort());
    assert.equal(r.counts.facts_accepted, 1);
    assert.equal(r.counts.descriptors_accepted, 3);
    // A descriptor with no confidence at all is fine — nothing acts on it.
    assert.equal(r.tags[3].confidence, null);
});

test('tags: a keyed result must carry an admitted value, and the stored value is the catalog spelling', () => {
    const r = runTags([
        { kind: 'fact', tag_key: 'result:hpv52', category: 'result', text: 'HPV52 阳性', value: 'Positive', confidence: 0.9 },
        { kind: 'fact', tag_key: 'result:hpv52', category: 'result', text: 'HPV52 阳性', value: '阳性', confidence: 0.9 },
        { kind: 'fact', tag_key: 'result:hpv52', category: 'result', text: 'HPV52', confidence: 0.9 },
    ]);
    assert.equal(r.tags.length, 1);
    assert.equal(r.tags[0].value, 'positive');
    assert.deepEqual(reasons(r), ['bad_tag_value', 'bad_tag_value']);
});

test('tags: status and since default, dedupe collapses a restatement, and the cap is reported', () => {
    const r = runTags([
        { kind: 'fact', tag_key: 'allergy:shellfish', category: 'allergy', text: '海鲜过敏', confidence: 0.9 },
        { kind: 'fact', tag_key: 'allergy:shellfish', category: 'allergy', text: '对海鲜过敏', confidence: 0.85 },
        { kind: 'fact', tag_key: 'allergy:shellfish', category: 'allergy', text: '海鲜过敏已脱敏', status: 'past', since: '2020-01-01', confidence: 0.9 },
    ]);
    assert.equal(r.tags.length, 2, 'same key + status + value is one statement');
    assert.equal(r.tags[0].status, 'current');
    assert.equal(r.tags[0].since, '2026-08-12');
    assert.equal(r.tags[1].since, '2020-01-01');
    const many = runTags(new Array(61).fill(0).map((_, i) => ({ kind: 'descriptor', category: 'lifestyle', text: `d${i}` })));
    assert.equal(many.tags.length, 60);
    assert.deepEqual(reasons(many), ['too_many_tags']);
});

test('a finding is stored as a descriptor, with its category mapped and a from_finding reason', () => {
    const r = runTags([], { findings: [{ category: 'dietary_restriction', text: '不吃猪肉', confidence: 0.9 }, { category: 'goal', text: '减重', confidence: 0.9 }] });
    assert.equal(r.findings.length, 2, 'findings are still validated and returned');
    assert.deepEqual(r.tags.map(t => [t.kind, t.category, t.reason]), [['descriptor', 'diet', 'from_finding'], ['descriptor', 'other', 'from_finding']]);
    // Without a tag catalog every fact is a descriptor — a vocabulary that was not supplied admits nothing.
    const bare = validateExtraction({ document: { doc_date: '2026-08-12' }, tags: [{ kind: 'fact', tag_key: 'allergy:shellfish', category: 'allergy', text: '海鲜过敏', confidence: 0.9 }] }, CATALOG);
    assert.equal(bare.tags[0].kind, 'descriptor');
});
