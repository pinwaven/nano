'use strict';

/**
 * GET /lab-history?openid=&key_name=&coach_id=&series=1
 *
 * A user's lab results over time — twin layer 3, Medical Records (CLAUDE.md §34) — read from
 * health_events(lab_result) through lib/labHistory.js, the same module that builds
 * health_twin.latest_lab_data. Until this existed the only lab view was that single snapshot;
 * with per-document extraction a user accumulates VitaminD ×4, NAD+ ×3, AMH ×2 and nothing
 * charted them.
 *
 * `series=1` returns the per-marker chart shape ({key_name: {…, points: [{date, value}]}});
 * otherwise flat rows newest-first per marker. A coach reads a client through coach_id with the
 * ownership check handlers/health_documents.js already applies to their records.
 */

const { pool } = require('../lib/db');
const { fetchLabHistory, fetchLabSeries } = require('../lib/labHistory');
const { resolveOwner } = require('./health_documents');

async function handleGetLabHistory(query) {
    try {
        const owner = await resolveOwner(query?.openid, query?.coach_id);
        if (!owner.ok) return owner.error;
        const keyName = query?.key_name ? String(query.key_name).trim() : null;
        const limit = Math.min(200, Math.max(1, parseInt(query?.limit, 10) || 24));
        if (String(query?.series || '') === '1') {
            const series = await fetchLabSeries(pool, owner.userId, { limitPerKey: limit });
            return { success: true, series };
        }
        const rows = await fetchLabHistory(pool, owner.userId, { keyName, limitPerKey: limit });
        return { success: true, rows };
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handleGetLabHistory failed', error: err.message }));
        return { success: false, error: err.message };
    }
}

module.exports = { handleGetLabHistory };
