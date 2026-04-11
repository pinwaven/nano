const { pool } = require('../../lib/db');
const { getNowShanghai } = require('../../lib/time-utils');

/**
 * Nano User Ingestion Handler (Aliyun FC 3.0)
 * Handles incoming questionnaire data for user creation/update.
 */
exports.handler = async (request, response, context) => {
    try {
        const body = JSON.parse(request.body.toString());
        const { openid, nickname, gender, birth_date, ...rest } = body;

        if (!openid) {
            response.setStatusCode(400);
            return response.send(JSON.stringify({ error: 'openid is required' }));
        }

        const query = `
            INSERT INTO users (wechat_openid, nickname, gender, birth_date, bio_data)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (wechat_openid) 
            DO UPDATE SET 
                nickname = EXCLUDED.nickname,
                gender = EXCLUDED.gender,
                birth_date = EXCLUDED.birth_date,
                bio_data = users.bio_data || EXCLUDED.bio_data, -- Deep merge
                updated_at = CURRENT_TIMESTAMP
            RETURNING id;
        `;

        const result = await pool.query(query, [
            openid, 
            nickname, 
            gender, 
            birth_date, 
            JSON.stringify(rest) // All other fields (height, weight, body_fat, etc.) go into bio_data
        ]);

        console.log(`[${getNowShanghai().toISO()}] User ${openid} upserted, ID: ${result.rows[0].id}`);

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
