// Document tags (contract 3) and their mirror into user_memory_facts — lib/documentTags.js — and
// the re-promotion pass over stored records — lib/repromotion.js.
//
// The properties under test are the ones that make an auto-written statement about a person
// safe to act on: only a keyed, CURRENT fact with a memory_category reaches user_memory_facts;
// the newest `since` per key wins; a managed row is deactivated when the key resolves away; the
// user's own statements are never touched; and re-promotion is an EXACT lookup that never uses
// the agent's suggested_key. Offline — the pool is a pattern-matched stub.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const WORKER = path.join(__dirname, '..', 'src', 'functions', 'worker');
const tags = require(path.join(WORKER, 'lib', 'documentTags.js'));
const rp = require(path.join(WORKER, 'lib', 'repromotion.js'));

function makePool(rows) {
    const queries = [];
    return {
        queries,
        query: async (sql, params) => {
            queries.push({ sql, params });
            for (const [pattern, value] of Object.entries(rows)) {
                if (new RegExp(pattern).test(sql)) {
                    const r = typeof value === 'function' ? value(params, sql) : value;
                    return { rows: r, rowCount: r.length };
                }
            }
            return { rows: [], rowCount: 0 };
        },
    };
}

const RESOLVED_ROWS = [
    // shellfish: stated current in 2026, and current in 2024 — history
    { id: 5, document_id: 12, tag_key: 'allergy:shellfish', category: 'allergy', text: '海鲜过敏', value: null, status: 'current', since: '2026-05-10', source_ref: 's2.p4', confidence: 0.85, name_zh: '海鲜过敏', name_en: 'Shellfish allergy', memory_category: 'allergy' },
    { id: 2, document_id: 9, tag_key: 'allergy:shellfish', category: 'allergy', text: '鱼虾贝类过敏', value: null, status: 'current', since: '2024-03-01', source_ref: null, confidence: 0.9, name_zh: '海鲜过敏', name_en: 'Shellfish allergy', memory_category: 'allergy' },
    // statin: current in 2024, stopped in 2026 → resolves to stopped
    { id: 6, document_id: 12, tag_key: 'medication:statin', category: 'medication', text: '他汀已停用', value: null, status: 'stopped', since: '2026-05-10', source_ref: null, confidence: 0.85, name_zh: '他汀类', name_en: 'Statin', memory_category: 'medication' },
    { id: 3, document_id: 9, tag_key: 'medication:statin', category: 'medication', text: '服用他汀', value: null, status: 'current', since: '2024-03-01', source_ref: null, confidence: 0.9, name_zh: '他汀类', name_en: 'Statin', memory_category: 'medication' },
    // a family history: current, but its catalog row has no memory_category
    { id: 7, document_id: 12, tag_key: 'family_history:hypertension', category: 'family_history', text: '父亲高血压', value: null, status: 'current', since: '2026-05-10', source_ref: null, confidence: 0.85, name_zh: '高血压家族史', name_en: null, memory_category: null },
];

test('resolution is newest-since per key, with the rest kept as history', async () => {
    const pool = makePool({ 'FROM health_document_tags t\\s+JOIN tag_catalog': RESOLVED_ROWS });
    const r = await tags.resolveUserTags(pool, 'u-1');
    const byKey = Object.fromEntries(r.map(x => [x.tag_key, x]));
    assert.equal(byKey['allergy:shellfish'].status, 'current');
    assert.equal(byKey['allergy:shellfish'].history.length, 1);
    assert.equal(byKey['medication:statin'].status, 'stopped', 'the 2026 stop must out-rank the 2024 use');
    assert.equal(byKey['medication:statin'].history[0].status, 'current', '"was once current" is not lost');
});

test('only a current fact with a memory_category is mirrored; a stale managed row is deactivated; the user\'s own row is untouched', async () => {
    const pool = makePool({
        'FROM health_document_tags t\\s+JOIN tag_catalog': RESOLVED_ROWS,
        'SELECT id, tag_key FROM user_memory_facts': [
            { id: 40, tag_key: 'medication:statin' },      // mirrored earlier, now stopped → deactivate
            { id: 41, tag_key: 'allergy:shellfish' },      // still wanted → kept
        ],
        'INSERT INTO user_memory_facts': [{ inserted: true }],
    });
    const r = await tags.syncMemoryFactsFromTags(pool, 'u-1');
    assert.equal(r.wanted, 1, 'shellfish only: statin is stopped, family history has no memory_category');
    const deact = pool.queries.find(q => /SET status = 'inactive'/.test(q.sql));
    assert.deepEqual(deact.params, [[40]]);
    const inserts = pool.queries.filter(q => /INSERT INTO user_memory_facts/.test(q.sql));
    assert.equal(inserts.length, 1);
    assert.deepEqual(inserts[0].params, ['u-1', 'allergy', '海鲜过敏', 12, 'allergy:shellfish']);
    // The catalog's short name, never the document's sentence (§27: fact_zh renders uncapped).
    assert.ok(!inserts[0].params.includes('鱼虾贝类过敏'));
    // The deactivation predicate is on tag_key IS NOT NULL: a chat-stated fact has none.
    const sel = pool.queries.find(q => /SELECT id, tag_key FROM user_memory_facts/.test(q.sql));
    assert.match(sel.sql, /tag_key IS NOT NULL/);
    // And a collision with the user's own row leaves that row's tag_key alone.
    assert.match(inserts[0].sql, /CASE WHEN user_memory_facts\.source = 'document_extracted'/);
});

test('writeDocumentTags is one multi-row insert in submission order, and clear deletes by document', async () => {
    const pool = makePool({});
    const n = await tags.writeDocumentTags(pool, { userId: 'u-1', documentId: 12, tags: [
        { kind: 'fact', tag_key: 'allergy:shellfish', category: 'allergy', text: '海鲜过敏', status: 'current', since: '2026-05-10', source: 's2.p4', confidence: 0.85 },
        { kind: 'descriptor', tag_key: null, category: 'lifestyle', text: '长期夜班', status: 'current', since: '2026-05-10', reason: null },
    ] });
    assert.equal(n, 2);
    const ins = pool.queries.find(q => /INSERT INTO health_document_tags/.test(q.sql));
    assert.equal((ins.sql.match(/\(\$1, \$2,/g) || []).length, 2, 'two tuples in one statement');
    assert.equal(ins.params[ins.params.length - 1], 1, 'sort_order follows submission order');
    await tags.clearDocumentTags(pool, 12, 'u-1');
    const del = pool.queries.find(q => /DELETE FROM health_document_tags/.test(q.sql));
    assert.deepEqual(del.params, [12, 'u-1']);
});

// ── re-promotion ─────────────────────────────────────────────────────────────────────────────

const BIO = [
    { key_name: 'Hemoglobin', loinc_code: '718-7', display_name: 'Hemoglobin', display_name_zh: '血红蛋白', unit: 'g/L', ref_low: 115, ref_high: 150, aliases: ['Hb', 'HGB'], nano_dimension: null, is_kino_core: false },
    { key_name: 'HairZn', loinc_code: null, display_name: 'Hair Zinc', display_name_zh: '发锌', unit: 'ug/g', ref_low: 100, ref_high: 200, aliases: [], nano_dimension: null, is_kino_core: false },
];

test('the label fold is NFKC + exact: compatibility ideographs resolve, containment does not', async () => {
    assert.equal(rp.foldLabel('⾎红蛋⽩ Hb'), '血红蛋白hb');
    const { index } = await rp.loadBiomarkerIndex(makePool({ 'FROM biomarker_catalog': BIO }));
    assert.equal(index.get(rp.foldLabel('⾎红蛋⽩')).key_name, 'Hemoglobin');
    assert.equal(index.get(rp.foldLabel('HGB')).key_name, 'Hemoglobin');
    assert.equal(index.get(rp.foldLabel('血红蛋白浓度')), undefined, 'a longer label must not resolve by containment');
    assert.equal(index.get(rp.foldLabel('无青霉素过敏')), undefined);
});

test('checkValue applies the same unit, conversion and plausibility rules as a fresh observation', () => {
    const hb = BIO[0];
    assert.deepEqual(rp.checkValue(hb, '13.5', 'g/dL'), { value: 135, converted: true });
    assert.deepEqual(rp.checkValue(hb, '135', 'g/L'), { value: 135, converted: false });
    assert.equal(rp.checkValue(hb, '135', null).refused, 'unit_missing');
    assert.equal(rp.checkValue(hb, '135', 'mmol/L').refused, 'unit_mismatch');
    assert.equal(rp.checkValue(hb, '20000', 'g/L').refused, 'implausible_value');
    assert.equal(rp.checkValue(hb, '<10', 'g/L').refused, 'invalid_value');
});

test('unmapped items re-promote on an exact label match only; suggested_key is reported, never used', async () => {
    const pool = makePool({
        'FROM biomarker_catalog': BIO,
        'FROM health_report_items i': [
            { id: 1, report_id: 8, user_id: 'u-1', label: '⾎红蛋⽩', value_num: 135, value_text: null, unit: 'g/L', data_date: '2026-05-10', source_ref: 's0.t0.r2', suggested_key: null },
            { id: 2, report_id: 8, user_id: 'u-1', label: '发锌', value_num: 112, value_text: null, unit: null, data_date: '2026-05-10', source_ref: null, suggested_key: 'HairZn' },
            { id: 3, report_id: 8, user_id: 'u-1', label: '锌', value_num: 112, value_text: null, unit: 'ug/g', data_date: '2026-05-10', source_ref: null, suggested_key: 'HairZn' },
        ],
    });
    const r = await rp.repromoteUnmappedItems(pool, { userId: 'u-1' });
    assert.deepEqual(r.promoted.map(p => [p.item_id, p.key_name, p.value]), [[1, 'Hemoglobin', 135]]);
    assert.deepEqual(r.refused.map(p => [p.item_id, p.reason]), [[2, 'unit_missing']], 'a no-unit row cannot satisfy the unit rule');
    assert.deepEqual(r.suggested_unmatched.map(s => s.item_id), [3], 'the guess is the alias backlog, not a match');
    const upd = pool.queries.find(q => /UPDATE health_report_items SET key_name/.test(q.sql));
    assert.deepEqual(upd.params, [1, 'Hemoglobin']);
    const ev = pool.queries.find(q => /INSERT INTO health_events/.test(q.sql));
    assert.equal(ev.params[5], 'Hemoglobin::2026-05-10', 'same external_id as a fresh write, so ON CONFLICT dedupes');
    assert.ok(JSON.parse(ev.params[3]).source_ref === 's0.t0.r2');
    assert.deepEqual(r.users, ['u-1']);
});

test('descriptors re-promote to facts only at a fact\'s bar, and never a keyed result', async () => {
    const pool = makePool({
        'FROM tag_catalog': [
            { tag_key: 'allergy:shellfish', category: 'allergy', name_zh: '海鲜过敏', name_en: null, aliases: ['鱼虾贝类过敏'], values: null },
            { tag_key: 'result:hpv52', category: 'result', name_zh: 'HPV52', name_en: null, aliases: [], values: ['positive', 'negative'] },
        ],
        'FROM health_document_tags\\s+WHERE kind': [
            { id: 1, user_id: 'u-1', document_id: 9, category: 'other', text: '鱼虾贝类过敏', confidence: 0.9 },   // a contract-2 finding
            { id: 2, user_id: 'u-1', document_id: 9, category: 'allergy', text: '海鲜过敏', confidence: 0.6 },
            { id: 3, user_id: 'u-1', document_id: 9, category: 'condition', text: '海鲜过敏', confidence: 0.9 },
            { id: 4, user_id: 'u-1', document_id: 9, category: 'result', text: 'HPV52', confidence: 0.9 },
        ],
    });
    const r = await rp.repromoteDescriptors(pool, { userId: 'u-1' });
    assert.deepEqual(r.promoted.map(p => [p.tag_id, p.tag_key]), [[1, 'allergy:shellfish']]);
    assert.equal(r.low_confidence, 1);
    assert.equal(r.category_mismatch, 1);
    assert.equal(r.unresolved, 1, 'a result needs a value the text does not carry');
    const upd = pool.queries.find(q => /SET kind = 'fact'/.test(q.sql));
    assert.deepEqual(upd.params, [1, 'allergy:shellfish', 'allergy']);
    assert.ok(pool.queries.some(q => /SELECT id, tag_key FROM user_memory_facts/.test(q.sql)), 'the mirror was not re-synced');
});

test('a v2 table row re-promotes only when the table names label, value AND unit columns', async () => {
    const doc = { id: 12, user_id: 'u-1', doc_date: '2026-05-10', report_id: 8, extracted_json: { version: 2, sections: [
        { tables: [
            { columns: ['项目', '结果', '单位'], rows: [['血红蛋白', '13.5', 'g/dL'], ['发锌', '112', 'ug/g'], ['未知项', '1', 'x']] },
            { columns: ['项目', '结果'], rows: [['血红蛋白', '140']] },
        ] },
    ] } };
    const pool = makePool({
        'FROM biomarker_catalog': BIO,
        'FROM health_documents d': [doc],
        'FROM health_report_items WHERE report_id': [{ key_name: 'HairZn', data_date: '2026-05-10' }],
    });
    const r = await rp.repromoteStructuredTables(pool, { userId: 'u-1' });
    assert.deepEqual(r.promoted.map(p => [p.key_name, p.value, p.source]), [['Hemoglobin', 135, 's0.t0.r0']]);
    assert.equal(r.unresolved, 1);
    const item = pool.queries.find(q => /INSERT INTO health_report_items/.test(q.sql));
    assert.ok(item.params.includes('s0.t0.r0') && item.params.includes('Hemoglobin'));
    const dry = await rp.repromoteStructuredTables(makePool({ 'FROM biomarker_catalog': BIO, 'FROM health_documents d': [doc] }), { dryRun: true });
    assert.equal(dry.promoted.length, 2, 'dry run reports what it would do');
    assert.ok(!dry._writes);
});
