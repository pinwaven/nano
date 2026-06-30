/**
 * Lab result normalizer — maps raw LOINC-coded observations to the Nano
 * biomarker catalog (biomarker_catalog table).
 *
 * The catalog is cached in memory with a 5-minute TTL so that container-reused
 * FC instances pick up admin changes without requiring a redeploy.
 */
'use strict';

const db = require('./db');

let _catalogCache = null;
let _catalogCacheTime = 0;

/** Cache TTL in ms. Balances cold-start cost against catalog freshness. */
const CATALOG_TTL_MS = 5 * 60 * 1000;

async function getCatalog() {
    if (_catalogCache && (Date.now() - _catalogCacheTime < CATALOG_TTL_MS)) return _catalogCache;
    const res = await db.query(
        'SELECT key_name, loinc_code, nano_dimension, is_kino_core, unit FROM biomarker_catalog WHERE is_active = TRUE'
    );
    const byLoinc = {};
    const byKey = {};
    for (const row of res.rows) {
        byKey[row.key_name] = row;
        if (row.loinc_code) byLoinc[row.loinc_code] = row;
    }
    _catalogCache = { byLoinc, byKey };
    _catalogCacheTime = Date.now();
    return _catalogCache;
}

/**
 * Normalize a raw observation array into resolved catalog entries.
 *
 * Input:  [{ loinc_code, value, unit, data_date, lab_patient_id }]
 * Output: [{ key_name, loinc_code, nano_dimension, is_kino_core, value, unit, data_date, lab_patient_id }]
 *
 * Observations whose LOINC code is not in biomarker_catalog are silently dropped.
 */
async function normalizeObservations(observations) {
    const catalog = await getCatalog();
    const result = [];
    for (const obs of observations) {
        const entry = catalog.byLoinc[obs.loinc_code];
        if (!entry) continue;
        result.push({
            key_name:       entry.key_name,
            loinc_code:     obs.loinc_code,
            nano_dimension: entry.nano_dimension,
            is_kino_core:   entry.is_kino_core,
            value:          obs.value,
            unit:           obs.unit || entry.unit,
            data_date:      obs.data_date,
            lab_patient_id: obs.lab_patient_id,
        });
    }
    return result;
}

module.exports = { normalizeObservations, getCatalog };
