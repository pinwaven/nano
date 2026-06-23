const { pool } = require('../lib/db');
const { calculateAge } = require('../lib/time-utils');
const { BiomarkerEstimator } = require('../lib/estimator/BiomarkerEstimator');
const { deriveTags } = require('../lib/estimator/tagDerivation');
const { BioAgeCalculator } = require('../lib/bioage/BioAgeCalculator');
const { updateHealthTwin } = require('../lib/healthTwinUpdater');

// ─── Lab Admin API ────────────────────────────────────────────────────────────

async function handleGetLabProviders() {
    try {
        const result = await pool.query(
            'SELECT id, lab_name, label, api_base_url, poll_enabled, last_polled_at, is_active FROM lab_providers ORDER BY id'
        );
        return { success: true, providers: result.rows };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handleGetLabProviders', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

async function handlePostLabProvider(body) {
    try {
        const { lab_name, label, api_base_url, api_key, webhook_secret, poll_enabled = true } = body || {};
        if (!lab_name || !api_base_url) return { statusCode: 400, success: false, error: 'lab_name and api_base_url required' };
        const result = await pool.query(
            `INSERT INTO lab_providers (lab_name, label, api_base_url, api_key_enc, webhook_secret_enc, poll_enabled)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [lab_name, label || null, api_base_url, api_key || null, webhook_secret || null, poll_enabled]
        );
        return { success: true, id: result.rows[0].id };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handlePostLabProvider', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

async function handlePutLabProvider(id, body) {
    try {
        const { label, api_base_url, api_key, webhook_secret, poll_enabled, is_active } = body || {};
        await pool.query(
            `UPDATE lab_providers SET
               label = COALESCE($1, label),
               api_base_url = COALESCE($2, api_base_url),
               api_key_enc = COALESCE($3, api_key_enc),
               webhook_secret_enc = COALESCE($4, webhook_secret_enc),
               poll_enabled = COALESCE($5, poll_enabled),
               is_active = COALESCE($6, is_active)
             WHERE id = $7`,
            [label ?? null, api_base_url ?? null, api_key ?? null, webhook_secret ?? null,
             poll_enabled ?? null, is_active ?? null, id]
        );
        return { success: true };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handlePutLabProvider', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

async function handleDeleteLabProvider(id) {
    try {
        await pool.query('DELETE FROM lab_providers WHERE id = $1', [id]);
        return { success: true };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handleDeleteLabProvider', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

async function handleGetLabUserMappings(query) {
    try {
        const { user_id, lab_name } = query;
        const params = [];
        const where = [];
        if (user_id)  { params.push(user_id);  where.push(`m.user_id = $${params.length}`); }
        if (lab_name) { params.push(lab_name); where.push(`m.lab_name = $${params.length}`); }
        const result = await pool.query(
            `SELECT m.id, m.user_id, u.nickname, m.lab_name, m.lab_patient_id, m.created_at
             FROM lab_user_mappings m
             JOIN users u ON u.user_id = m.user_id
             ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
             ORDER BY m.created_at DESC LIMIT 200`,
            params
        );
        return { success: true, mappings: result.rows };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handleGetLabUserMappings', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

async function handlePostLabUserMapping(body) {
    try {
        const { user_id, lab_name, lab_patient_id } = body || {};
        if (!user_id || !lab_name || !lab_patient_id) return { statusCode: 400, success: false, error: 'user_id, lab_name and lab_patient_id required' };
        const result = await pool.query(
            `INSERT INTO lab_user_mappings (user_id, lab_name, lab_patient_id) VALUES ($1, $2, $3)
             ON CONFLICT (lab_name, lab_patient_id) DO NOTHING RETURNING id`,
            [user_id, lab_name, lab_patient_id]
        );
        if (result.rows.length === 0) return { statusCode: 409, success: false, error: 'This lab_patient_id is already mapped to another user' };
        return { success: true, id: result.rows[0].id };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handlePostLabUserMapping', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

async function handleDeleteLabUserMapping(id) {
    try {
        await pool.query('DELETE FROM lab_user_mappings WHERE id = $1', [id]);
        return { success: true };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handleDeleteLabUserMapping', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

async function handleGetLabReports(query) {
    try {
        const { user_id, source, limit = 100 } = query;
        const params = [];
        const where = [];
        if (user_id) { params.push(user_id); where.push(`r.user_id = $${params.length}`); }
        if (source)  { params.push(source);  where.push(`r.source = $${params.length}`); }
        params.push(Math.min(parseInt(limit) || 100, 500));
        const result = await pool.query(
            `SELECT r.id, r.user_id, u.nickname, r.report_date, r.source, r.institution,
                    r.report_type, r.status, r.created_at,
                    COUNT(he.id) AS event_count
             FROM health_reports r
             JOIN users u ON u.user_id = r.user_id
             LEFT JOIN health_events he ON he.report_id = r.id
             ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
             GROUP BY r.id, u.nickname
             ORDER BY r.created_at DESC
             LIMIT $${params.length}`,
            params
        );
        return { success: true, reports: result.rows };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handleGetLabReports', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

// ─── Lab Import EventBridge handler ──────────────────────────────────────────

// fetchTagDerivationContext is passed as a parameter from index.js (it relies on index.js internals)
async function handleLabImportEvent(data, fetchTagDerivationContext) {
    const { report_id, user_id } = data || {};
    if (!report_id || !user_id) throw new Error('report_id and user_id required');

    // Load Kino core observations from this report
    const eventsRes = await pool.query(
        `SELECT data FROM health_events
         WHERE report_id = $1 AND (data->>'is_kino_core')::boolean = true`,
        [report_id]
    );

    // Build partial biomarker values from confirmed lab observations
    const partialBiomarkers = {};
    for (const row of eventsRes.rows) {
        const d = row.data;
        if (d.key_name && d.value != null) partialBiomarkers[d.key_name] = d.value;
    }

    // Get user profile for age
    const userRes = await pool.query(
        `SELECT birth_date, bio_data FROM users WHERE user_id = $1`,
        [user_id]
    );
    if (userRes.rows.length === 0) throw new Error(`User not found: ${user_id}`);
    const { birth_date, bio_data } = userRes.rows[0];
    const age = calculateAge(birth_date);
    const bioData = bio_data || {};

    // Fetch tags for estimator context
    const tagContext = await fetchTagDerivationContext(user_id);
    const tags = deriveTags(tagContext);
    const seed = `${user_id}:lab:${report_id}`;
    const weekBucket = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
    const persistentSeed = `${user_id}:w${weekBucket}`;

    // Fill missing Kino core values via BiomarkerEstimator
    const estimator = new BiomarkerEstimator(age, partialBiomarkers, { Weight: bioData.weight, Height: bioData.height }, tags, { seed, persistentSeed });
    const estimationReport = estimator.generateReport();

    const bioAgeCalc = new BioAgeCalculator();
    const bioAgeReport = bioAgeCalc.calculateBioAge(age, estimationReport.BiomarkerValues);

    const finalData = {
        actual:         partialBiomarkers,
        validated:      estimationReport.BiomarkerValues,
        context:        estimationReport.ClinicalContext,
        bioage_profile: bioAgeReport,
        tags,
        source_report_id: report_id,
    };

    await pool.query(
        `INSERT INTO biomarkers (user_id, test_type, data, bio_age, tested_at)
         VALUES ($1, 'lab_import', $2, $3, NOW())`,
        [user_id, JSON.stringify(finalData), bioAgeReport.BioAge]
    );

    await updateHealthTwin(user_id);

    console.log(JSON.stringify({ level: 'INFO', msg: 'Lab import BioAge calculated', user_id, bio_age: bioAgeReport.BioAge, report_id }));
}

module.exports = {
    handleGetLabProviders,
    handlePostLabProvider,
    handlePutLabProvider,
    handleDeleteLabProvider,
    handleGetLabUserMappings,
    handlePostLabUserMapping,
    handleDeleteLabUserMapping,
    handleGetLabReports,
    handleLabImportEvent,
};
