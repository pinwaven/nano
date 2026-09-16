'use strict';

/**
 * Re-promotion: when biomarker_catalog or tag_catalog gains a key or an alias, re-run promotion
 * over what is ALREADY STORED — unmapped report items, descriptor tags, and version-2 structured
 * tables — without re-reading a single file. Contract 3 of the extraction API (CLAUDE.md §39).
 *
 * This is the return on storing the record and not just the twin feed: the catalog grew 25 → 86
 * keys in one day (2026-09-15), and every document processed before that holds rows that now
 * resolve. Each stored row carries what a fresh extraction would have: the label, the printed
 * value, the unit, the reference text, the flag, and (contract 3) the cell it came from.
 *
 * SAME RULES AS A FRESH EXTRACTION, no looser. A promoted item goes through the exact unit,
 * conversion and plausibility checks validateExtraction applies, because it lands in the same
 * health_events row the twin reads. What is deliberately NOT done:
 *   - `suggested_key` is never used as a match. It is a model's guess; a re-run of promotion is
 *     a deterministic lookup. The guess is reported beside the label so a human can add the
 *     alias, which is the honest way for it to become a match.
 *   - No substring or fuzzy matching. A label resolves by EXACT match (NFKC-folded, whitespace
 *     and case dropped) against display_name_zh, display_name, key_name and aliases. 「无青霉素
 *     过敏」 contains 「青霉素过敏」; containment would promote the negation.
 *   - A structured table row is promoted only when the table names a label column, a value
 *     column AND a unit column. A no-unit table cannot satisfy the unit rule, so its rows stay
 *     where they are.
 *
 * Every function takes the pool and returns what it did, so the runner (temp/
 * repromote-extractions.js) can dry-run and report. Nothing here delivers a chat message: the
 * user asked nothing, and a silently widened panel is what the twin surfaces already show.
 */

const { normalizeUnit, toNumber } = require('./extractionPrimitives');
const { UNIT_CONVERSIONS, PLAUSIBLE_LOW_FACTOR, PLAUSIBLE_HIGH_FACTOR, TAG_CONFIDENCE_FLOOR } = require('./docExtraction');
const { syncMemoryFactsFromTags } = require('./documentTags');

const EXTRACTION_SOURCE = 'document_extraction';

// The same fold the agent applies before matching: NFKC (⾎ → 血, ｍｇ → mg), no whitespace,
// lower case. Parentheses and their content are kept — 「糖化血红蛋白(HbA1c)」 is its own alias.
function foldLabel(s) {
    return String(s == null ? '' : s).normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

function _buildIndex(rows, nameFields, keyField) {
    const index = new Map();
    const put = (name, row) => {
        const k = foldLabel(name);
        if (k.length < 2) return;
        // An ambiguous alias (two keys claim it) resolves to nothing — the §11 rule.
        if (index.has(k) && index.get(k)[keyField] !== row[keyField]) index.set(k, null);
        else if (!index.has(k)) index.set(k, row);
    };
    for (const row of rows) {
        for (const f of nameFields) if (row[f]) put(row[f], row);
        for (const a of row.aliases || []) put(a, row);
    }
    return index;
}

async function loadBiomarkerIndex(pool) {
    const { rows } = await pool.query(
        `SELECT key_name, loinc_code, display_name, display_name_zh, unit, nano_dimension, is_kino_core,
                ref_low, ref_high, aliases
           FROM biomarker_catalog WHERE is_active = TRUE`
    );
    return { rows, index: _buildIndex(rows, ['key_name', 'display_name', 'display_name_zh'], 'key_name') };
}

async function loadTagIndex(pool) {
    const { rows } = await pool.query(
        `SELECT tag_key, category, name_zh, name_en, aliases, values FROM tag_catalog WHERE is_active = TRUE`
    );
    return { rows, index: _buildIndex(rows, ['name_zh', 'name_en'], 'tag_key') };
}

// The unit and plausibility half of validateExtraction, over a stored row. Returns the value to
// store in the catalog unit, or {refused} with the reason a fresh submission would have got.
function checkValue(catalog, rawValue, rawUnit) {
    let value = toNumber(rawValue == null ? null : String(rawValue));
    if (value === null) return { refused: 'invalid_value' };
    const catalogUnit = normalizeUnit(catalog.unit);
    const givenUnit = normalizeUnit(rawUnit);
    let converted = false;
    if (!givenUnit) return { refused: 'unit_missing' };
    if (givenUnit !== catalogUnit) {
        const convert = (UNIT_CONVERSIONS[catalog.key_name] || {})[givenUnit];
        if (!convert) return { refused: 'unit_mismatch' };
        value = Math.round(convert(value) * 1000) / 1000;
        converted = true;
    }
    const low = catalog.ref_low == null ? null : Number(catalog.ref_low);
    const high = catalog.ref_high == null ? null : Number(catalog.ref_high);
    const floor = low != null ? low * PLAUSIBLE_LOW_FACTOR : 0;
    const ceiling = high != null ? high * PLAUSIBLE_HIGH_FACTOR : null;
    if (value < 0 || value < floor || (ceiling != null && value > ceiling)) return { refused: 'implausible_value' };
    return { value, converted };
}

// The write a fresh observation gets in handlePostHealthReport, byte for byte: same external_id,
// same data shape, same ON CONFLICT, so a re-promoted marker for a day that already has one is a
// no-op rather than a duplicate.
async function _insertLabEvent(pool, { userId, reportId, catalog, value, dataDate, sourceRef }) {
    const { rowCount } = await pool.query(
        `INSERT INTO health_events (user_id, source, category, data_date, recorded_at, data, report_id, external_id)
         VALUES ($1, $2, 'lab_result', $3, NOW(), $4, $5, $6)
         ON CONFLICT (user_id, source, external_id) WHERE external_id IS NOT NULL DO NOTHING`,
        [userId, EXTRACTION_SOURCE, dataDate, JSON.stringify({
            key_name: catalog.key_name, loinc_code: catalog.loinc_code, value, unit: catalog.unit,
            nano_dimension: catalog.nano_dimension, is_kino_core: catalog.is_kino_core,
            ...(sourceRef ? { source_ref: sourceRef } : {}),
            repromoted: true,
        }), reportId, `${catalog.key_name}::${dataDate}`]
    );
    return rowCount > 0;
}

/**
 * Unmapped health_report_items whose printed label now resolves. Sets key_name on the item and
 * writes the health_events row. Returns per-item outcomes.
 */
async function repromoteUnmappedItems(pool, { userId = null, dryRun = false } = {}) {
    const { index } = await loadBiomarkerIndex(pool);
    const { rows } = await pool.query(
        `SELECT i.id, i.report_id, i.user_id, i.label, i.value_num, i.value_text, i.unit,
                i.data_date::text AS data_date, i.source_ref, i.suggested_key
           FROM health_report_items i
          WHERE i.key_name IS NULL ${userId ? 'AND i.user_id = $1' : ''}
          ORDER BY i.user_id, i.report_id, i.sort_order`,
        userId ? [userId] : []
    );
    const out = { scanned: rows.length, promoted: [], refused: [], unresolved: 0, suggested_unmatched: [] };
    const touchedUsers = new Set();
    for (const it of rows) {
        const catalog = index.get(foldLabel(it.label));
        if (!catalog) {
            out.unresolved++;
            // A guess the deterministic lookup did not confirm: reported, never used.
            if (it.suggested_key) out.suggested_unmatched.push({ item_id: Number(it.id), label: it.label, suggested_key: it.suggested_key });
            continue;
        }
        const raw = it.value_num != null ? it.value_num : it.value_text;
        const c = checkValue(catalog, raw, it.unit);
        if (c.refused) { out.refused.push({ item_id: Number(it.id), label: it.label, key_name: catalog.key_name, reason: c.refused }); continue; }
        out.promoted.push({ item_id: Number(it.id), label: it.label, key_name: catalog.key_name, value: c.value, unit: catalog.unit, data_date: it.data_date, converted: c.converted });
        if (dryRun) continue;
        await pool.query('UPDATE health_report_items SET key_name = $2 WHERE id = $1', [it.id, catalog.key_name]);
        await _insertLabEvent(pool, { userId: it.user_id, reportId: it.report_id, catalog, value: c.value, dataDate: it.data_date, sourceRef: it.source_ref });
        touchedUsers.add(it.user_id);
    }
    out.users = [...touchedUsers];
    return out;
}

/**
 * Descriptor tags whose text now resolves to a tag_catalog key (exact fold). Promoted to a fact
 * only at a fact's confidence bar; the reason column records that it was re-promoted.
 */
async function repromoteDescriptors(pool, { userId = null, dryRun = false } = {}) {
    const { index } = await loadTagIndex(pool);
    const { rows } = await pool.query(
        `SELECT id, user_id, document_id, category, text, confidence
           FROM health_document_tags
          WHERE kind = 'descriptor' ${userId ? 'AND user_id = $1' : ''}
          ORDER BY user_id, document_id, sort_order`,
        userId ? [userId] : []
    );
    const out = { scanned: rows.length, promoted: [], unresolved: 0, low_confidence: 0, category_mismatch: 0 };
    const touchedUsers = new Set();
    for (const t of rows) {
        const cat = index.get(foldLabel(t.text));
        if (!cat) { out.unresolved++; continue; }
        if (t.confidence == null || Number(t.confidence) < TAG_CONFIDENCE_FLOOR) { out.low_confidence++; continue; }
        // A descriptor filed under `other` (a contract-2 finding) may take the catalog's
        // category; one the agent filed under a DIFFERENT real category is a disagreement the
        // catalog does not get to settle.
        if (t.category !== 'other' && t.category !== cat.category) { out.category_mismatch++; continue; }
        // A result tag needs an admitted value the descriptor's text does not carry.
        if (Array.isArray(cat.values) && cat.values.length > 0) { out.unresolved++; continue; }
        out.promoted.push({ tag_id: Number(t.id), text: t.text, tag_key: cat.tag_key });
        if (dryRun) continue;
        await pool.query(
            `UPDATE health_document_tags
                SET kind = 'fact', tag_key = $2, category = $3, reason = 'repromoted'
              WHERE id = $1`,
            [t.id, cat.tag_key, cat.category]
        );
        touchedUsers.add(t.user_id);
    }
    if (!dryRun) for (const u of touchedUsers) await syncMemoryFactsFromTags(pool, u);
    out.users = [...touchedUsers];
    return out;
}

// Column roles in a version-2 table, by header. Conservative on purpose: a table has to name all
// three of label / value / unit for a row to be promotable (see the module header).
const COLUMN_ROLES = {
    label: /^(项目|检测项目|检验项目|指标|名称|项目名称|item|test|analyte|marker|name)$/i,
    value: /^(结果|检测结果|检验结果|测定值|测定结果|数值|result|value)$/i,
    unit: /^(单位|unit|units)$/i,
    ref: /^(参考区间|参考范围|参考值|正常范围|reference|ref|range)$/i,
};
function _tableRoles(columns) {
    const roles = {};
    columns.forEach((c, i) => {
        const h = String(c).normalize('NFKC').trim();
        for (const [role, re] of Object.entries(COLUMN_ROLES)) if (roles[role] == null && re.test(h)) roles[role] = i;
    });
    return roles.label != null && roles.value != null && roles.unit != null ? roles : null;
}

/**
 * Rows of version-2 structured tables whose label resolves and that no health_report_items row
 * already covers (by report + key + date). Needs the document to have a report row to hang the
 * item on; a document with none is reported and skipped.
 */
async function repromoteStructuredTables(pool, { userId = null, dryRun = false } = {}) {
    const { index } = await loadBiomarkerIndex(pool);
    const { rows: docs } = await pool.query(
        `SELECT d.id, d.user_id, d.doc_date::text AS doc_date, d.extracted_json,
                (SELECT r.id FROM health_reports r WHERE r.source_document_id = d.id AND r.user_id = d.user_id
                  ORDER BY r.id DESC LIMIT 1) AS report_id
           FROM health_documents d
          WHERE d.status = 'active' AND d.extracted_json IS NOT NULL
            AND (d.extracted_json->>'version') = '2' ${userId ? 'AND d.user_id = $1' : ''}
          ORDER BY d.user_id, d.id`,
        userId ? [userId] : []
    );
    const out = { documents: docs.length, promoted: [], refused: [], no_report: [], unresolved: 0 };
    const touchedUsers = new Set();
    for (const d of docs) {
        const s = d.extracted_json;
        if (!d.report_id) { out.no_report.push(Number(d.id)); continue; }
        if (!d.doc_date) continue;
        const { rows: existing } = await pool.query(
            'SELECT key_name, data_date::text AS data_date FROM health_report_items WHERE report_id = $1 AND key_name IS NOT NULL',
            [d.report_id]
        );
        const covered = new Set(existing.map(e => `${e.key_name}::${e.data_date}`));
        let sortOrder = 10000;
        (s.sections || []).forEach((sec, si) => {
            (sec.tables || []).forEach((t, ti) => {
                const roles = _tableRoles(t.columns || []);
                if (!roles) return;
                (t.rows || []).forEach((r, ri) => {
                    const label = r[roles.label];
                    const catalog = index.get(foldLabel(label));
                    if (!catalog) { out.unresolved++; return; }
                    const key = `${catalog.key_name}::${d.doc_date}`;
                    if (covered.has(key)) return;
                    const c = checkValue(catalog, r[roles.value], r[roles.unit]);
                    if (c.refused) { out.refused.push({ document_id: Number(d.id), label, key_name: catalog.key_name, reason: c.refused }); return; }
                    const sourceRef = `s${si}.t${ti}.r${ri}`;
                    out.promoted.push({ document_id: Number(d.id), label, key_name: catalog.key_name, value: c.value, unit: catalog.unit, source: sourceRef });
                    covered.add(key);
                    if (dryRun) return;
                    // Sequential, not awaited in a forEach — collected and written below.
                    out._writes = out._writes || [];
                    out._writes.push({ d, catalog, value: c.value, label: String(label), unit: r[roles.unit], ref: roles.ref != null ? r[roles.ref] : null, sourceRef, sortOrder: sortOrder++ });
                });
            });
        });
    }
    for (const w of out._writes || []) {
        await pool.query(
            `INSERT INTO health_report_items
                (report_id, user_id, source_document_id, key_name, label, value_num, unit, ref_text, data_date, source_ref, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::date, $10, $11)`,
            [w.d.report_id, w.d.user_id, w.d.id, w.catalog.key_name, w.label.slice(0, 200), w.value, w.catalog.unit,
             w.ref == null ? null : String(w.ref).slice(0, 60), w.d.doc_date, w.sourceRef, w.sortOrder]
        );
        await _insertLabEvent(pool, { userId: w.d.user_id, reportId: w.d.report_id, catalog: w.catalog, value: w.value, dataDate: w.d.doc_date, sourceRef: w.sourceRef });
        touchedUsers.add(w.d.user_id);
    }
    delete out._writes;
    out.users = [...touchedUsers];
    return out;
}

module.exports = {
    foldLabel, checkValue,
    loadBiomarkerIndex, loadTagIndex,
    repromoteUnmappedItems, repromoteDescriptors, repromoteStructuredTables,
};
