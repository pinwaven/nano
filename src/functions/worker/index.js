const { pool } = require('../../lib/db');
const { getNowShanghai, calculateAge } = require('../../lib/time-utils');
const { BiomarkerEstimator } = require('../../lib/estimator/BiomarkerEstimator');

/**
 * Nano User Ingestion & Biomarker Estimation Handler
 */
exports.handler = async (request, response, context) => {
    try {
        const body = JSON.parse(request.body.toString());
        const { openid, nickname, gender, birth_date, test_type, test_data, tested_at, ...rest } = body;

        if (!openid) {
            response.setStatusCode(400);
            return response.send(JSON.stringify({ error: 'openid is required' }));
        }

        // 1. Upsert User Profile
        const userQuery = `
            INSERT INTO users (wechat_openid, nickname, gender, birth_date, bio_data)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (wechat_openid) 
            DO UPDATE SET 
                nickname = COALESCE(EXCLUDED.nickname, users.nickname),
                gender = COALESCE(EXCLUDED.gender, users.gender),
                birth_date = COALESCE(EXCLUDED.birth_date, users.birth_date),
                bio_data = users.bio_data || EXCLUDED.bio_data,
                updated_at = CURRENT_TIMESTAMP
            RETURNING id, birth_date, bio_data;
        `;

        const userResult = await pool.query(userQuery, [
            openid, 
            nickname, 
            gender, 
            birth_date, 
            JSON.stringify(rest)
        ]);

        const user = userResult.rows[0];
        const userId = user.id;

        // 2. Handle Biomarkers with Estimation (for Kino chip or other tests)
        if (test_data) {
            const age = calculateAge(user.birth_date);
            
            // Extract existing biometrics from profile for the estimator
            const biometrics = {
                Weight: user.bio_data.weight,
                Height: user.bio_data.height
            };

            // Use the Estimator to fill in any missing values
            const estimator = new BiomarkerEstimator(age, test_data, biometrics);
            const fullReport = estimator.generateReport();
            
            // Merge actual results with estimated ones
            const finalData = {
                actual: test_data,
                estimated: fullReport.BiomarkerValues,
                context: fullReport.ClinicalContext
            };

            const biomarkerQuery = `
                INSERT INTO biomarkers (user_id, test_type, data, tested_at)
                VALUES ($1, $2, $3, $4);
            `;
            
            await pool.query(biomarkerQuery, [
                userId,
                test_type || 'kino_chip',
                JSON.stringify(finalData),
                tested_at || new Date().toISOString()
            ]);
            
            console.log(`[${getNowShanghai().toISO()}] Biomarker report (actual + estimated) added for user ${userId}`);
        }

        console.log(`[${getNowShanghai().toISO()}] User ${openid} profile updated, ID: ${userId}`);

        response.setStatusCode(200);
        response.send(JSON.stringify({ 
            success: true, 
            user_id: userId 
        }));
    } catch (error) {
        console.error('Error handling request:', error);
        response.setStatusCode(500);
        response.send(JSON.stringify({ error: 'Internal Server Error' }));
    }
};
