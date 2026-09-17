// The twin's lab panel, and the history behind it, both come out of lib/labHistory.js.
//
// Two properties are load-bearing and invisible at runtime:
//   - the panel is LATEST VALUE PER MARKER across every lab event (a Vitamin-D-only report dated
//     after the 体检 must not collapse the panel to one marker), and
//   - health_twin's UPSERT must NOT coalesce latest_lab_data any more, or deleting the last
//     report leaves a stale panel forever.
//
// Offline: the pool is a pattern-matched stub, the same way tests/doc-extraction-queue.test.js
// does it.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const WORKER = path.join(__dirname, '..', 'src', 'functions', 'worker');
const { buildLabPanel, fetchLabHistory, fetchLabSeries, LEGACY_KEY_MAP } = require(path.join(WORKER, 'lib', 'labHistory.js'));

const CATALOG = [
    { key_name: 'LDL', display_name: 'LDL Cholesterol', display_name_zh: '低密度脂蛋白', unit: 'mmol/L', category: 'lipid', nano_dimension: 'MicroVascularAge', is_kino_core: false, ref_low: null, ref_high: '3.4' },
    { key_name: 'VitaminD', display_name: '25-OH Vitamin D', display_name_zh: '维生素D', unit: 'nmol/L', category: 'inflammation', nano_dimension: null, is_kino_core: false, ref_low: '50', ref_high: '150' },
    { key_name: 'HbA1c', display_name: 'Hemoglobin A1c', display_name_zh: '糖化血红蛋白', unit: '%', category: 'metabolic', nano_dimension: null, is_kino_core: false, ref_low: null, ref_high: '5.7' },
];

// Per-marker rows as the ranked subquery would return them (already newest-first per key).
const PER_MARKER = [
    { key_name: 'VitaminD', value: 72.1, unit: 'nmol/L', data_date: '2026-03-20', source: 'document_extraction', report_id: 3 },
    { key_name: 'VitaminD', value: 48.2, unit: 'nmol/L', data_date: '2025-11-18', source: 'document_extraction', report_id: 2 },
    { key_name: 'HbA1c', value: 5.4, unit: '%', data_date: '2026-05-23', source: 'document_extraction', report_id: 4 },
];
// A legacy whole-panel row: US units, dated between the two VitaminD reads, and the ONLY
// source of LDL.
const LEGACY = [{
    data: { results: { ldl: { value: 102, unit: 'mg/dL', ref_high: 100 }, vitamin_d: { value: 52, unit: 'ng/mL', ref_low: 30 } } },
    data_date: '2025-12-01', source: 'annual_lab', report_id: null,
}];

function makePool({ perMarker = PER_MARKER, legacy = LEGACY } = {}) {
    const queries = [];
    return {
        queries,
        query: async (sql, params) => {
            queries.push({ sql, params });
            if (/FROM biomarker_catalog/.test(sql)) return { rows: CATALOG };
            if (/ROW_NUMBER\(\) OVER/.test(sql)) {
                let rows = perMarker;
                const keyParam = params && params[1] && typeof params[1] === 'string' ? params[1] : null;
                if (keyParam) rows = rows.filter(r => r.key_name === keyParam);
                const limit = params && typeof params[params.length - 1] === 'number' && /rn <= \$/.test(sql) ? params[params.length - 1] : null;
                if (limit) {
                    const seen = {};
                    rows = rows.filter(r => { seen[r.key_name] = (seen[r.key_name] || 0) + 1; return seen[r.key_name] <= limit; });
                }
                return { rows };
            }
            if (/data \? 'results'/.test(sql)) return { rows: legacy };
            return { rows: [] };
        },
    };
}

test('the panel is the latest value per marker, each with its own date', async () => {
    const pool = makePool();
    const panel = await buildLabPanel(pool, 'u-1');
    const m = panel.data.markers;
    assert.deepEqual(Object.keys(m).sort(), ['HbA1c', 'LDL', 'VitaminD']);
    // Three markers from three different dates survive together — the old "everything on the
    // newest date" rule would have kept HbA1c alone.
    assert.equal(m.VitaminD.value, 72.1);
    assert.equal(m.VitaminD.data_date, '2026-03-20');
    assert.equal(m.HbA1c.data_date, '2026-05-23');
    assert.equal(panel.data_date, '2026-05-23', 'latest_lab_date is the newest of the marker dates');
    assert.deepEqual(panel.data.dates, ['2026-05-23', '2026-03-20', '2025-12-01']);
    assert.equal(panel.data.marker_count, 3);
});

test('a marker carries its catalog names and ranges, so no client needs a table for it', async () => {
    const panel = await buildLabPanel(makePool(), 'u-1');
    const v = panel.data.markers.VitaminD;
    assert.equal(v.display_name_zh, '维生素D');
    assert.equal(v.category, 'inflammation');
    assert.equal(v.ref_low, 50);
    assert.equal(v.ref_high, 150);
    assert.equal(v.source, 'document_extraction');
});

test('a legacy whole-panel row fills only the markers nothing newer wrote', async () => {
    const panel = await buildLabPanel(makePool(), 'u-1');
    const m = panel.data.markers;
    // LDL exists only in the legacy row: kept, in its own unit with its own range, and flagged.
    assert.equal(m.LDL.value, 102);
    assert.equal(m.LDL.unit, 'mg/dL');
    assert.equal(m.LDL.ref_high, 100);
    assert.equal(m.LDL.legacy, true);
    // VitaminD has a per-marker value dated AFTER the legacy panel: the legacy one loses.
    assert.equal(m.VitaminD.value, 72.1);
    assert.equal(m.VitaminD.legacy, undefined);
    assert.ok(LEGACY_KEY_MAP.vitamin_d === 'VitaminD');
});

test('with no lab events the panel is null — the twin must clear, not keep, a deleted panel', async () => {
    const panel = await buildLabPanel(makePool({ perMarker: [], legacy: [] }), 'u-1');
    assert.equal(panel.data, null);
    assert.equal(panel.data_date, null);
});

test('history is flat rows newest-first per marker, and a series keeps only unit-consistent points', async () => {
    const rows = await fetchLabHistory(makePool(), 'u-1');
    const vd = rows.filter(r => r.key_name === 'VitaminD');
    assert.deepEqual(vd.map(r => r.data_date), ['2026-03-20', '2025-12-01', '2025-11-18']);
    assert.ok(vd.every(r => typeof r.value === 'number' && r.display_name_zh === '维生素D'));

    const series = await fetchLabSeries(makePool(), 'u-1');
    // The legacy ng/mL point must not sit on a nmol/L line.
    assert.deepEqual(series.VitaminD.points, [{ date: '2025-11-18', value: 48.2 }, { date: '2026-03-20', value: 72.1 }]);
    assert.equal(series.VitaminD.unit, 'nmol/L');
    // A legacy-only marker keeps its own unit and its single point.
    assert.equal(series.LDL.unit, 'mg/dL');
    assert.deepEqual(series.LDL.points, [{ date: '2025-12-01', value: 102 }]);
});

test('a single-marker history is scoped in SQL, not filtered after the fact', async () => {
    const pool = makePool();
    const rows = await fetchLabHistory(pool, 'u-1', { keyName: 'HbA1c' });
    assert.ok(rows.every(r => r.key_name === 'HbA1c'));
    const q = pool.queries.find(x => /ROW_NUMBER\(\) OVER/.test(x.sql));
    assert.match(q.sql, /data->>'key_name' = \$2/);
});

test('every DATE the module reads out of health_events is cast ::text in SQL', () => {
    const src = fs.readFileSync(path.join(WORKER, 'lib', 'labHistory.js'), 'utf8');
    // node-postgres parses a DATE at local midnight → UTC instant → the previous day downstream.
    // Both reads of health_events (per-marker ranked subquery, legacy rows) must cast.
    const reads = src.split('FROM health_events').length - 1;
    assert.equal(reads, 2, 'a new read of health_events was added — cast its data_date');
    assert.equal(src.split('data_date::text AS data_date').length - 1, 2);
});

test('the twin updater takes the panel from labHistory and no longer coalesces it away', () => {
    const src = fs.readFileSync(path.join(WORKER, 'lib', 'healthTwinUpdater.js'), 'utf8');
    assert.match(src, /buildLabPanel\(pool, userId\)/);
    assert.ok(!/MAX\(data_date\) AS max_date/.test(src), 'the old "newest lab date only" query is back');
    assert.match(src, /latest_lab_data\s*=\s*EXCLUDED\.latest_lab_data,/);
    assert.match(src, /latest_lab_date\s*=\s*EXCLUDED\.latest_lab_date,/);
    assert.ok(!/COALESCE\(EXCLUDED\.latest_lab_data/.test(src), 'latest_lab_data is COALESCEd again — a deleted report would leave a stale panel');
});

test('the lab-history endpoint and tool exist and the tool returns flat lab_result rows', () => {
    const indexJs = fs.readFileSync(path.join(WORKER, 'index.js'), 'utf8');
    assert.match(indexJs, /path === '\/lab-history'/);
    const tools = fs.readFileSync(path.join(WORKER, 'lib', 'agenticTools.js'), 'utf8');
    assert.match(tools, /name: 'get_lab_history'/);
    const impl = tools.slice(tools.indexOf('async get_lab_history('));
    assert.match(impl.slice(0, 2500), /kind: 'lab_result'/);
    assert.match(impl.slice(0, 2500), /date: r\.data_date/, 'the date field must be named `date` to be harvested by extractToolGroundTruth');
    // The plan template must list it, or PLAN can never ask for it.
    const plan = fs.readFileSync(path.join(WORKER, 'prompts', 'chat', 'planTemplate.js'), 'utf8');
    assert.match(plan, /get_lab_history/);
    // And the grounding harvest must pick up its values under their key_name.
    const chat = fs.readFileSync(path.join(WORKER, 'lib', 'agenticChat.js'), 'utf8');
    assert.match(chat, /row\.kind === 'lab_result' && row\.key_name/);
});
