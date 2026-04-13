const { pool } = require('../../lib/db');
const { getNowShanghai } = require('../../lib/time-utils');
const axios = require('axios');

/**
 * Nano Dispatcher (Aliyun FC 3.0 Cron Trigger)
 * Periodically scans for users who need a health assessment.
 */
exports.handler = async (event, context) => {
    console.log(`[${getNowShanghai().toISO()}] Dispatcher started scanning for active users...`);

    try {
        // 1. Find users needing health assessment (already implemented)
        // 2. Find users needing nutrition plan top-up (Rolling 7-day window)
        const nutritionQuery = `
            SELECT u.id, u.wechat_openid, u.nickname, 
                   COUNT(s.id) as scheduled_days,
                   MAX(s.scheduled_date) as last_scheduled_date
            FROM users u
            LEFT JOIN nutrition_schedules s ON u.id = s.user_id AND s.scheduled_date >= CURRENT_DATE
            GROUP BY u.id
            HAVING COUNT(s.id) < 7;
        `;

        const nutritionResult = await pool.query(nutritionQuery);
        const usersToTopUp = nutritionResult.rows;

        console.log(`Found ${usersToTopUp.length} users needing nutrition plan top-up.`);

        for (const user of usersToTopUp) {
            console.log(`Dispatching nutrition top-up for: ${user.nickname}`);
            const workerUrl = process.env.WORKER_URL || 'http://localhost:3000/chat';
            
            try {
                await axios.post(workerUrl, {
                    openid: user.wechat_openid,
                    trigger_type: 'nutrition_topup',
                    days_needed: 7 - parseInt(user.scheduled_days),
                    start_from: user.last_scheduled_date || new Date().toISOString().split('T')[0]
                });
            } catch (err) {
                console.error(`Failed to top up nutrition for ${user.wechat_openid}:`, err.message);
            }
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ message: `Dispatched ${usersToScan.length} assessments.` })
        };
    } catch (error) {
        console.error('Dispatcher error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Internal Server Error' })
        };
    }
};
