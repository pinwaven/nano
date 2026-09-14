'use strict';

/**
 * Read the user's chronic food-sensitivity (IgG) panel for the miniapp's twin view. §40.
 *
 * Read-only, and deliberately so: the panel is a lab result, not something a user edits. Its
 * derived restrictions are ordinary user_memory_facts and are managed through /user-facts like
 * every other fact; a wrong panel is corrected by re-running or deleting the extraction, which
 * clears the panel, the results and the facts together (clearExtraction).
 *
 * OWNERSHIP IS ENFORCED, on the handleGetUserFacts pattern. Note that the neighbouring
 * handleGetHealthReport selects a report by bare id with no ownership check at all — do not copy
 * that shape here or anywhere else.
 */

const { pool } = require('../lib/db');

// Defined here rather than imported: handlers/userFacts.js has the same two-line resolver and does
// not export it, and pulling in a CRUD module for one query would put it on this path's warm load.
// `openid` is the caller's own handle — a user_id or an external_id — never a client-chosen id
// trusted for anything beyond lookup; the ownership check below is what gates access.
async function resolveUserId(openid) {
    const result = await pool.query(
        'SELECT user_id FROM users WHERE user_id = $1 OR external_id = $1 LIMIT 1', [openid]);
    return result.rows[0]?.user_id || null;
}

async function handleGetFoodSensitivity(openid, coachId) {
    try {
        if (!openid) return { success: false, error: 'openid is required' };
        const user_id = await resolveUserId(openid);
        if (!user_id) return { success: false, error: 'User not found' };
        // Same coarse ownership check handleGetUserFacts and handleGetCoachUserChat use, and only
        // when the caller supplies its own coach_id — the user's own app addresses itself.
        if (coachId) {
            const check = await pool.query('SELECT 1 FROM users WHERE user_id = $1 AND coach_id = $2', [user_id, coachId]);
            if (check.rows.length === 0) return { success: false, error: 'Access denied', statusCode: 403 };
        }

        // ::text on the DATE columns — node-postgres parses a DATE at local midnight, which
        // serialises to a UTC instant and reads as the previous day to the client.
        const { rows: panels } = await pool.query(
            `SELECT id, panel_key, unit, sampled_at::text AS sampled_at, report_date::text AS report_date,
                    institution, source_document_id
               FROM food_sensitivity_panels
              WHERE user_id = $1
              ORDER BY report_date DESC, id DESC
              LIMIT 1`,
            [user_id]
        );
        if (panels.length === 0) return { success: true, panel: null, foods: [] };
        const panel = panels[0];

        // The whole panel, not only the positives: "西瓜 was clear" is as much of an answer as
        // "牛奶 was not", and the negatives are what a rotation diet is built out of.
        const { rows: foods } = await pool.query(
            `SELECT r.food_key, r.value, r.below_detection, r.class,
                    c.name_zh, c.name_en, c.category, c.common_sources_zh, c.substitutes_zh,
                    f.valid_until::text AS avoid_until
               FROM food_sensitivity_results r
               JOIN food_catalog c ON c.food_key = r.food_key
               LEFT JOIN user_memory_facts f
                      ON f.user_id = r.user_id AND f.food_key = r.food_key AND f.status = 'active'
              WHERE r.panel_id = $1
              ORDER BY r.class DESC, r.value DESC NULLS LAST, c.category, c.food_key`,
            [panel.id]
        );

        return {
            success: true,
            panel: {
                panel_key: panel.panel_key,
                unit: panel.unit,
                sampled_at: panel.sampled_at,
                report_date: panel.report_date,
                institution: panel.institution,
                source_document_id: panel.source_document_id == null ? null : Number(panel.source_document_id),
                foods_tested: foods.length,
                foods_with_sensitivity: foods.filter(f => f.class >= 1).length,
            },
            foods: foods.map(f => ({
                food_key: f.food_key,
                name_zh: f.name_zh,
                name_en: f.name_en,
                category: f.category,
                // null when the lab reported below its detection limit — the client shows the
                // censored marker rather than a number nobody measured.
                value: f.value == null ? null : Number(f.value),
                below_detection: f.below_detection,
                class: f.class,
                avoid_until: f.avoid_until || null,
                common_sources_zh: f.common_sources_zh || [],
                substitutes_zh: f.substitutes_zh || [],
            })),
        };
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handleGetFoodSensitivity failed', error: err.message }));
        return { success: false, error: err.message };
    }
}

module.exports = { handleGetFoodSensitivity };
