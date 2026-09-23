/**
 * Updates the health_twin materialized summary for a user.
 * Called after every health_events INSERT (real-time mode).
 *
 * Aggregates last 7 days of health_events per category into rolling averages,
 * computes 30-day trends, and UPSERTs into health_twin.
 * Also syncs latest_bio_age / latest_sub_ages from the biomarkers table.
 */
const { buildLabPanel } = require('./labHistory');
const { fetchWearableDaily, fetchHrvReadings } = require('./wearableDaily');
const { analyzeWearable } = require('./wearableAnalysis');
const { formatToShanghai } = require('./time-utils');

// The analysis layer over the same 30 days (lib/wearableAnalysis.js). Its own try/catch:
// an analysis bug must never cost the twin upsert, so a failure here is a NULL column and a
// WARN, nothing more. Recomputed every call — never COALESCEd on the upsert below.
async function computeWearableInsights(userId, pool) {
    try {
        const [daily, readings] = await Promise.all([
            fetchWearableDaily(pool, userId, 30),
            fetchHrvReadings(pool, userId, 30),
        ]);
        if (!daily.length) return null;
        return analyzeWearable({ daily, readings, today: formatToShanghai(new Date()).slice(0, 10) });
    } catch (err) {
        console.log(JSON.stringify({ level: 'WARN', msg: 'wearable_insights_failed', userId, error: err.message }));
        return null;
    }
}

async function updateHealthTwin(userId, pool) {
    try {
        // 7-day rolling aggregates across all categories in one pass
        const aggResult = await pool.query(`
            SELECT
              AVG(CASE WHEN category = 'vitals' THEN (data->>'hrv_ms')::FLOAT END)    AS avg_hrv_ms,
              AVG(CASE WHEN category = 'vitals' THEN (data->>'resting_hr')::FLOAT END)     AS avg_resting_hr,
              AVG(CASE WHEN category = 'vitals' THEN (data->>'spo2')::FLOAT END)           AS avg_spo2,
              AVG(CASE WHEN category = 'sleep'  THEN (data->>'duration_minutes')::FLOAT / 60 END) AS avg_sleep_hours,
              AVG(CASE WHEN category = 'sleep'  THEN (data->>'sleep_score')::FLOAT END)    AS avg_sleep_score,
              -- Nights with no stage split (V8; all-zero rows synced before 2026-09-23) are left
              -- out rather than averaged in as 0% deep+REM.
              AVG(CASE WHEN category = 'sleep' AND (data->>'duration_minutes')::FLOAT > 0
                        AND COALESCE((data->>'deep_minutes')::FLOAT, (data->'stages'->>'deep_minutes')::FLOAT, 0)
                          + COALESCE((data->>'rem_minutes')::FLOAT, (data->'stages'->>'rem_minutes')::FLOAT, 0)
                          + COALESCE((data->>'light_minutes')::FLOAT, (data->'stages'->>'light_minutes')::FLOAT, 0)
                          + COALESCE((data->>'awake_minutes')::FLOAT, (data->'stages'->>'awake_minutes')::FLOAT, 0) > 0
                  THEN (COALESCE((data->>'deep_minutes')::FLOAT, (data->'stages'->>'deep_minutes')::FLOAT, 0)
                      + COALESCE((data->>'rem_minutes')::FLOAT, (data->'stages'->>'rem_minutes')::FLOAT, 0))
                      / (data->>'duration_minutes')::FLOAT * 100
              END)                                                                           AS avg_deep_sleep_pct,
              AVG(CASE WHEN category = 'activity' THEN (data->>'steps')::FLOAT
                       WHEN category = 'vitals'   THEN (data->>'steps')::FLOAT END)         AS avg_daily_steps,
              AVG(CASE WHEN category = 'activity' THEN (data->>'duration_minutes')::FLOAT END) AS avg_active_minutes
            FROM health_events
            WHERE user_id = $1
              AND data_date >= CURRENT_DATE - INTERVAL '7 days'
        `, [userId]);

        // Latest body_composition event
        const bodyResult = await pool.query(`
            SELECT data FROM health_events
            WHERE user_id = $1 AND category = 'body_composition'
            ORDER BY data_date DESC LIMIT 1
        `, [userId]);

        // Latest lab panel: latest value PER MARKER across every lab_result event, each marker
        // carrying its own date, joined to biomarker_catalog for names and ranges. lib/labHistory.js
        // owns the query — the same module serves GET /lab-history and the chat tool, so the
        // panel and the history can never disagree about what a user's latest LDL is.
        const labPanel = await buildLabPanel(pool, userId);

        // Latest Kino scan from biomarkers table
        const kinoResult = await pool.query(`
            SELECT bio_age, data->'bioage_profile'->'SubAges' AS sub_ages, tested_at
            FROM biomarkers
            WHERE user_id = $1 AND test_type = 'kino_chip'
            ORDER BY tested_at DESC LIMIT 1
        `, [userId]);

        // 30-day trend: compare current 7-day avg to the 7-day period ending 30 days ago
        const trendResult = await pool.query(`
            SELECT
              AVG(CASE WHEN category = 'vitals' THEN (data->>'hrv_ms')::FLOAT END)           AS old_hrv,
              AVG(CASE WHEN category = 'sleep'  THEN (data->>'duration_minutes')::FLOAT / 60 END) AS old_sleep_hours
            FROM health_events
            WHERE user_id = $1
              AND data_date >= CURRENT_DATE - INTERVAL '30 days'
              AND data_date < CURRENT_DATE - INTERVAL '23 days'
        `, [userId]);

        // Latest data_date per category (for data_coverage)
        const coverageResult = await pool.query(`
            SELECT category, MAX(data_date)::TEXT AS last_date
            FROM health_events
            WHERE user_id = $1
            GROUP BY category
        `, [userId]);

        const wearableInsights = await computeWearableInsights(userId, pool);

        const agg = aggResult.rows[0] || {};
        const body = bodyResult.rows[0]?.data || {};
        const kino = kinoResult.rows[0] || null;
        const old = trendResult.rows[0] || {};

        const trendData = {
            hrv_trend: computeTrend(agg.avg_hrv_ms, old.old_hrv),
            sleep_trend: computeTrend(agg.avg_sleep_hours, old.old_sleep_hours),
            weight_trend_kg: null, // updated separately when body_composition events arrive
        };

        const dataCoverage = {};
        for (const row of coverageResult.rows) {
            dataCoverage[row.category] = row.last_date || null;
        }

        await pool.query(`
            INSERT INTO health_twin (
                user_id,
                avg_hrv_ms, avg_resting_hr, avg_spo2,
                avg_sleep_hours, avg_sleep_score, avg_deep_sleep_pct,
                avg_daily_steps, avg_active_minutes,
                latest_weight_kg, latest_bmi, latest_body_fat_pct,
                latest_lab_data, latest_lab_date,
                latest_bio_age, latest_sub_ages, latest_kino_scan_at,
                trend_data, data_coverage, wearable_insights, last_updated_at
            ) VALUES (
                $1,
                $2, $3, $4,
                $5, $6, $7,
                $8, $9,
                $10, $11, $12,
                $13, $14,
                $15, $16, $17,
                $18, $19, $20, NOW()
            )
            ON CONFLICT (user_id) DO UPDATE SET
                avg_hrv_ms            = EXCLUDED.avg_hrv_ms,
                avg_resting_hr        = EXCLUDED.avg_resting_hr,
                avg_spo2              = EXCLUDED.avg_spo2,
                avg_sleep_hours       = EXCLUDED.avg_sleep_hours,
                avg_sleep_score       = EXCLUDED.avg_sleep_score,
                avg_deep_sleep_pct    = EXCLUDED.avg_deep_sleep_pct,
                avg_daily_steps       = EXCLUDED.avg_daily_steps,
                avg_active_minutes    = EXCLUDED.avg_active_minutes,
                latest_weight_kg      = COALESCE(EXCLUDED.latest_weight_kg,    health_twin.latest_weight_kg),
                latest_bmi            = COALESCE(EXCLUDED.latest_bmi,          health_twin.latest_bmi),
                latest_body_fat_pct   = COALESCE(EXCLUDED.latest_body_fat_pct, health_twin.latest_body_fat_pct),
                -- NOT coalesced, unlike the other latest_* columns: the panel is recomputed from
                -- scratch on every call, so NULL means "no lab events left". With COALESCE a user
                -- whose last report was deleted (解析有误, DELETE /health-reports/:id) kept the
                -- stale panel forever, while both callers claimed to recompute without it.
                latest_lab_data       = EXCLUDED.latest_lab_data,
                latest_lab_date       = EXCLUDED.latest_lab_date,
                latest_bio_age        = COALESCE(EXCLUDED.latest_bio_age,      health_twin.latest_bio_age),
                latest_sub_ages       = COALESCE(EXCLUDED.latest_sub_ages,     health_twin.latest_sub_ages),
                latest_kino_scan_at   = COALESCE(EXCLUDED.latest_kino_scan_at, health_twin.latest_kino_scan_at),
                trend_data            = EXCLUDED.trend_data,
                data_coverage         = EXCLUDED.data_coverage,
                wearable_insights     = EXCLUDED.wearable_insights,
                last_updated_at       = NOW()
        `, [
            userId,
            agg.avg_hrv_ms ?? null,
            agg.avg_resting_hr ?? null,
            agg.avg_spo2 ?? null,
            agg.avg_sleep_hours ?? null,
            agg.avg_sleep_score ?? null,
            agg.avg_deep_sleep_pct ?? null,
            agg.avg_daily_steps != null ? Math.round(agg.avg_daily_steps) : null,
            agg.avg_active_minutes != null ? Math.round(agg.avg_active_minutes) : null,
            body.weight_kg ?? null,
            body.bmi ?? null,
            body.body_fat_pct ?? null,
            labPanel.data ? JSON.stringify(labPanel.data) : null,
            labPanel.data_date ?? null,
            kino?.bio_age ?? null,
            kino?.sub_ages ? JSON.stringify(kino.sub_ages) : null,
            kino?.tested_at ?? null,
            JSON.stringify(trendData),
            JSON.stringify(dataCoverage),
            wearableInsights ? JSON.stringify(wearableInsights) : null,
        ]);

    } catch (err) {
        // Non-fatal: log and continue so the main request still succeeds
        console.log(JSON.stringify({ level: 'ERROR', msg: 'updateHealthTwin failed', userId, error: err.message }));
    }
}

function computeTrend(current, previous) {
    if (current == null || previous == null || previous === 0) return 'unknown';
    const delta = (current - previous) / previous;
    if (delta > 0.05) return 'improving';
    if (delta < -0.05) return 'declining';
    return 'stable';
}

module.exports = { updateHealthTwin, computeWearableInsights };
