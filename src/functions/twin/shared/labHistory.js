'use strict';

/**
 * Lab results over time, read from health_events(category = 'lab_result').
 *
 * One module, three readers that must agree on what a user's lab history is:
 *
 *   - buildLabPanel   → health_twin.latest_lab_data (lib/healthTwinUpdater.js)
 *   - fetchLabHistory → GET /lab-history and the agentic tool get_lab_history
 *   - fetchLabSeries  → the miniapp's per-marker trend chart, and the Viva AG twin bundle
 *
 * The panel is LATEST VALUE PER MARKER across every lab event, each marker carrying its own
 * date. Until 2026-09-15 it was "every marker on the single most recent lab date", which was
 * fine while a user had one 体检 a year and collapsed the moment they uploaded single-purpose
 * reports: a Vitamin-D-only test dated after the 体检 replaced the whole panel with one marker.
 * Dev user 55761144 has VitaminD ×4, NAD+ ×3, AMH ×2 across 22 documents.
 *
 * Every marker is joined to biomarker_catalog so a consumer gets display names and reference
 * ranges from the server rather than a client-side table — the miniapp's BIO_REF / REF_DISPLAY /
 * LAB_DISPLAY_NAME literals covered the original 25 keys and nothing after them.
 *
 * Two storage shapes, and this is the one place that knows both:
 *   per-marker  — one row per analyte, data->>'key_name' set (everything written since
 *                 handlePostHealthReport existed; also document extraction)
 *   legacy      — one row holding a whole panel in data.results, snake_case keys, US units
 *                 (four seed users per environment, incl. 55761144's 'annual_lab' row)
 *
 * DATE columns are cast ::text in SQL (CLAUDE.md §35): node-postgres parses a DATE at local
 * midnight, which serializes to a UTC instant and reads as the previous day downstream.
 */

// Legacy panel key → catalog key_name. Moved here from the miniapp / web user-app copies so
// the server expands a legacy row once and every client sees catalog keys.
const LEGACY_KEY_MAP = {
    ldl: 'LDL', hdl: 'HDL', alt: 'ALT', ast: 'AST', tsh: 'TSH',
    hba1c: 'HbA1c', ferritin: 'Ferritin', uric_acid: 'UricAcid',
    vitamin_d: 'VitaminD', creatinine: 'Creatinine',
    triglycerides: 'Triglycerides', glucose_fasting: 'FPG',
    total_cholesterol: 'TotalCholesterol', hscrp: 'hsCRP', hsCRP: 'hsCRP', il6: 'IL6',
    vitamin_b12: 'VitaminB12', wbc: 'WBC', hemoglobin: 'Hemoglobin',
};

const CATALOG_SQL = `SELECT key_name, display_name, display_name_zh, unit, category, nano_dimension, is_kino_core, ref_low, ref_high
                       FROM biomarker_catalog`;

async function _catalogByKey(pool) {
    const { rows } = await pool.query(CATALOG_SQL);
    const map = new Map();
    for (const r of rows) {
        map.set(r.key_name, {
            display_name: r.display_name, display_name_zh: r.display_name_zh, unit: r.unit,
            category: r.category, nano_dimension: r.nano_dimension, is_kino_core: !!r.is_kino_core,
            ref_low: r.ref_low == null ? null : Number(r.ref_low),
            ref_high: r.ref_high == null ? null : Number(r.ref_high),
        });
    }
    return map;
}

// Every per-marker lab event, newest first per key. `limitPerKey` bounds a marker with a long
// history (a ring-synced glucose would be daily); null means all.
async function _perMarkerRows(pool, userId, { keyName = null, limitPerKey = null } = {}) {
    const params = [userId];
    let keyClause = '';
    if (keyName) { params.push(keyName); keyClause = `AND data->>'key_name' = $${params.length}`; }
    let limitClause = '';
    if (limitPerKey) { params.push(limitPerKey); limitClause = `WHERE rn <= $${params.length}`; }
    const { rows } = await pool.query(
        `SELECT key_name, value, unit, data_date, source, report_id
           FROM (
             SELECT data->>'key_name' AS key_name,
                    (data->>'value')::float AS value,
                    data->>'unit' AS unit,
                    data_date::text AS data_date,
                    source, report_id,
                    ROW_NUMBER() OVER (PARTITION BY data->>'key_name' ORDER BY data_date DESC, recorded_at DESC, id DESC) AS rn
               FROM health_events
              WHERE user_id = $1 AND category = 'lab_result' AND data ? 'key_name' ${keyClause}
           ) ranked
           ${limitClause}
          ORDER BY key_name, data_date DESC`,
        params
    );
    return rows.filter(r => r.key_name && Number.isFinite(r.value));
}

// Legacy whole-panel rows, expanded to catalog keys. Their units are whatever the seed wrote
// (mg/dL for the US-convention demo panel), so each point carries its own unit and its own
// ref_low/ref_high, and a consumer must not mix them into a series in the catalog unit.
async function _legacyRows(pool, userId) {
    const { rows } = await pool.query(
        `SELECT data, data_date::text AS data_date, source, report_id
           FROM health_events
          WHERE user_id = $1 AND category = 'lab_result' AND NOT (data ? 'key_name') AND data ? 'results'
          ORDER BY data_date DESC`,
        [userId]
    );
    const out = [];
    for (const r of rows) {
        const results = r.data && r.data.results;
        if (!results || typeof results !== 'object') continue;
        for (const [legacyKey, info] of Object.entries(results)) {
            const keyName = LEGACY_KEY_MAP[legacyKey] || LEGACY_KEY_MAP[String(legacyKey).toLowerCase()] || null;
            const value = info && Number(info.value);
            if (!keyName || !Number.isFinite(value)) continue;
            out.push({
                key_name: keyName, value, unit: (info && info.unit) || null,
                data_date: r.data_date, source: r.source, report_id: r.report_id,
                legacy: true,
                ref_low: info && info.ref_low != null ? Number(info.ref_low) : null,
                ref_high: info && info.ref_high != null ? Number(info.ref_high) : null,
            });
        }
    }
    return out;
}

function _decorate(row, catalog) {
    const c = catalog.get(row.key_name) || {};
    return {
        key_name: row.key_name,
        value: row.value,
        unit: row.unit || c.unit || '',
        data_date: row.data_date,
        source: row.source || null,
        report_id: row.report_id == null ? null : Number(row.report_id),
        display_name: c.display_name || row.key_name,
        display_name_zh: c.display_name_zh || c.display_name || row.key_name,
        category: c.category || null,
        nano_dimension: c.nano_dimension || null,
        is_kino_core: !!c.is_kino_core,
        // A legacy point keeps the ranges the seed wrote in its own unit; a per-marker point
        // is in the catalog unit and takes the catalog's.
        ref_low: row.legacy ? row.ref_low : (c.ref_low ?? null),
        ref_high: row.legacy ? row.ref_high : (c.ref_high ?? null),
        ...(row.legacy ? { legacy: true } : {}),
    };
}

/**
 * The twin's lab panel: latest value per marker across all lab events.
 * @returns {{ data: {markers, marker_count, dates}|null, data_date: string|null }}
 *          `null` data when the user has no lab events at all — the caller writes NULL, and the
 *          UPSERT no longer COALESCEs it, so a deleted last report actually clears the panel.
 */
async function buildLabPanel(pool, userId) {
    const [catalog, perMarker, legacy] = await Promise.all([
        _catalogByKey(pool),
        _perMarkerRows(pool, userId, { limitPerKey: 1 }),
        _legacyRows(pool, userId),
    ]);
    const markers = {};
    for (const r of perMarker) {
        if (!markers[r.key_name]) markers[r.key_name] = _decorate(r, catalog);
    }
    // A legacy value fills a key only where nothing newer was written per-marker.
    for (const r of legacy) {
        const cur = markers[r.key_name];
        if (!cur || cur.data_date < r.data_date) markers[r.key_name] = _decorate(r, catalog);
    }
    const keys = Object.keys(markers);
    if (keys.length === 0) return { data: null, data_date: null };
    const dates = [...new Set(keys.map(k => markers[k].data_date).filter(Boolean))].sort().reverse();
    return {
        data: { markers, marker_count: keys.length, dates },
        data_date: dates[0] || null,
    };
}

/**
 * Flat rows, newest first within each marker — the shape the agentic tool and the coach/admin
 * endpoint return. Every row carries display names and ranges so the consumer needs no table.
 */
async function fetchLabHistory(pool, userId, { keyName = null, limitPerKey = 24 } = {}) {
    const [catalog, perMarker, legacy] = await Promise.all([
        _catalogByKey(pool),
        _perMarkerRows(pool, userId, { keyName, limitPerKey }),
        _legacyRows(pool, userId),
    ]);
    const rows = perMarker.map(r => _decorate(r, catalog));
    for (const r of legacy) {
        if (keyName && r.key_name !== keyName) continue;
        rows.push(_decorate(r, catalog));
    }
    rows.sort((a, b) => a.key_name === b.key_name
        ? (a.data_date < b.data_date ? 1 : a.data_date > b.data_date ? -1 : 0)
        : (a.key_name < b.key_name ? -1 : 1));
    return rows;
}

/**
 * Per-marker series for charting: { [key_name]: { display_name_zh, unit, ref_low, ref_high,
 * points: [{date, value}] (oldest first) } }. A legacy point is included only when its unit
 * matches the series unit — a mg/dL point on a mmol/L line is a wrong chart, not a longer one.
 */
async function fetchLabSeries(pool, userId, { limitPerKey = 24 } = {}) {
    const rows = await fetchLabHistory(pool, userId, { limitPerKey });
    const series = {};
    for (const r of rows) {
        let s = series[r.key_name];
        if (!s) {
            s = series[r.key_name] = {
                key_name: r.key_name, display_name: r.display_name, display_name_zh: r.display_name_zh,
                category: r.category, unit: r.unit, ref_low: r.ref_low, ref_high: r.ref_high, points: [],
            };
        }
        if (r.legacy && String(r.unit || '').toLowerCase() !== String(s.unit || '').toLowerCase()) continue;
        s.points.push({ date: r.data_date, value: r.value });
    }
    for (const s of Object.values(series)) s.points.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return series;
}

module.exports = { buildLabPanel, fetchLabHistory, fetchLabSeries, LEGACY_KEY_MAP };
