const { pool } = require('../../lib/db');
const { getNowShanghai } = require('../../lib/time-utils');

/**
 * Nano User Ingestion Handler (Aliyun FC 3.0)
 * Handles incoming questionnaire data for user creation/update.
 */
exports.handler = async (request, response, context) => {
    try {
        const body = JSON.parse(request.body.toString());
        const { openid, nickname, gender, birth_date, test_type, test_data, tested_at, ...rest } = body;

        if (!openid) {
            response.setStatusCode(400);
            return response.send(JSON.stringify({ error: 'openid is required' }));
        }

        // Start a transaction if needed, but for simplicity we'll do two queries
        // 1. Upsert User (Core Profile)
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
            RETURNING id;
        `;

        const userResult = await pool.query(userQuery, [
            openid, 
            nickname, 
            gender, 
            birth_date, 
            JSON.stringify(rest)
        ]);

        const userId = userResult.rows[0].id;

        // 2. Insert Biomarker (Time-series Record) if test data is present
        if (test_data) {
            const biomarkerQuery = `
                INSERT INTO biomarkers (user_id, test_type, data, tested_at)
                VALUES ($1, $2, $3, $4);
            `;
            await pool.query(biomarkerQuery, [
                userId,
                test_type || 'default',
                JSON.stringify(test_data),
                tested_at || new Date().toISOString()
            ]);
            console.log(`[${getNowShanghai().toISO()}] Biomarker record added for user ${userId}`);
        }

        console.log(`[${getNowShanghai().toISO()}] User ${openid} profile updated, ID: ${userId}`);

        response.setStatusCode(200);
        response.send(JSON.stringify({ 
            success: true, 
            user_id: result.rows[0].id 
        }));
    } catch (error) {
        console.error('Error ingesting user data:', error);
        response.setStatusCode(500);
        response.send(JSON.stringify({ error: 'Internal Server Error' }));
    }
};
