const { pool } = require('./lib/db');
const { getNowShanghai } = require('./lib/time-utils');
const axios = require('axios');

/**
 * Nano Dispatcher (Aliyun FC 3.0 Cron Trigger)
 */
exports.handler = async (event, context) => {
    console.log(`[${getNowShanghai().toISO()}] Dispatcher started scanning for active users...`);

    try {
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

        // The internal VPC URL for nano-worker - calling the HTTP trigger
        const workerUrl = process.env.WORKER_URL || 'https://nano-worker-napllanrqp.cn-shanghai-vpc.fcapp.run';

        for (const user of usersToTopUp) {
            console.log(`Dispatching nutrition top-up for: ${user.nickname}`);
            
            const payload = {
                openid: user.wechat_openid,
                trigger_type: 'nutrition_topup',
                days_needed: 7 - parseInt(user.scheduled_days),
                start_from: user.last_scheduled_date || new Date().toISOString().split('T')[0]
            };

            // Dispatched via HTTP (Calling the worker's HTTP trigger via VPC)
            try {
                await axios.post(workerUrl, payload, { 
                    headers: { 
                        'Content-Type': 'application/json',
                        'x-fc-invocation-type': 'Async'
                    },
                    timeout: 10000 
                });
                console.log(`[HTTP] Dispatched to worker for ${user.wechat_openid}`);
            } catch (httpErr) {
                console.error(`[HTTP] Failed for ${user.wechat_openid}:`, httpErr.message);
            }
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ message: `Dispatched ${usersToTopUp.length} top-ups.` })
        };
    } catch (error) {
        console.error('Dispatcher error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Internal Server Error' })
        };
    }
};
