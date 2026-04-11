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
        // Find users who haven't been scanned in 24 hours or have never been scanned
        const query = `
            SELECT id, wechat_openid, nickname, last_scanned_at 
            FROM users 
            WHERE last_scanned_at IS NULL 
               OR last_scanned_at < NOW() - INTERVAL '24 hours'
            LIMIT 50; -- Batching to stay within timeout
        `;

        const result = await pool.query(query);
        const usersToScan = result.rows;

        console.log(`Found ${usersToScan.length} users requiring assessment.`);

        for (const user of usersToScan) {
            console.log(`Dispatching worker for user: ${user.nickname} (${user.wechat_openid})`);
            
            // In a production Aliyun FC environment, you'd use the FC SDK to 
            // invoke the worker asynchronously. For now, we simulate with an HTTP call.
            try {
                // Assuming the worker is available at this internal/external URL
                // In FC 3.0, you can use the function's internal endpoint
                const workerUrl = process.env.WORKER_URL || 'http://localhost:3000/chat';
                
                await axios.post(workerUrl, {
                    openid: user.wechat_openid,
                    trigger_type: 'scheduled_scan'
                });

                // Update last_scanned_at to prevent re-dispatching in the next cycle
                await pool.query('UPDATE users SET last_scanned_at = NOW() WHERE id = $1', [user.id]);
            } catch (err) {
                console.error(`Failed to dispatch for user ${user.wechat_openid}:`, err.message);
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
