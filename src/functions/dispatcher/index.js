const { pool } = require('./lib/db');
const { getNowShanghai } = require('./lib/time-utils');
const EventBridge = require('@alicloud/eventbridge');
const OpenApi = require('@alicloud/openapi-client');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

/**
 * Nano Dispatcher (Aliyun FC 3.0 Cron Trigger)
 */
exports.handler = async (event, context) => {
    console.log(`[${getNowShanghai().toISO()}] Dispatcher started scanning for active users in region: ${context.region}...`);

    // Initialize EventBridge Client
    const ebConfig = new OpenApi.Config({
        accessKeyId: context.credentials.accessKeyId,
        accessKeySecret: context.credentials.accessKeySecret,
        securityToken: context.credentials.securityToken,
        endpoint: `eventbridge.${context.region}.aliyuncs.com`,
    });
    const ebClient = new EventBridge.default(ebConfig);

    try {
        const nutritionQuery = `
            SELECT u.user_id, u.external_id, u.nickname,
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

        // The internal VPC URL for nano-worker - fallback
        const workerUrl = process.env.WORKER_URL || 'https://nano-worker-napllanrqp.cn-shanghai-vpc.fcapp.run';

        for (const user of usersToTopUp) {
            console.log(`Dispatching nutrition top-up for: ${user.nickname}`);
            
            const payload = {
                openid: user.external_id,
                trigger_type: 'nutrition_topup',
                days_needed: 7 - parseInt(user.scheduled_days),
                start_from: user.last_scheduled_date || new Date().toISOString().split('T')[0]
            };

            // 1. Try EventBridge (Preferred)
            const cloudEvent = new EventBridge.CloudEvent({
                id: uuidv4(),
                source: 'acs.dispatcher',
                specversion: '1.0',
                type: 'nutrition.topup',
                subject: 'user_nutrition_needed',
                datacontenttype: 'application/json',
                data: Buffer.from(JSON.stringify(payload)),
                time: new Date().toISOString(),
                extensions: {
                    aliyuneventbusname: 'default'
                }
            });

            try {
                await ebClient.putEvents([cloudEvent]);
                console.log(`[EventBridge] Published event for ${user.external_id}`);
            } catch (ebErr) {
                console.warn(`[EventBridge] Failed, falling back to HTTP: ${ebErr.message}`);
                
                // 2. Fallback to HTTP (Direct Worker Call)
                try {
                    await axios.post(workerUrl, payload, { 
                        headers: { 
                            'Content-Type': 'application/json',
                            'x-fc-invocation-type': 'Async'
                        },
                        timeout: 10000 
                    });
                    console.log(`[HTTP Fallback] Dispatched to worker for ${user.external_id}`);
                } catch (httpErr) {
                    console.error(`[HTTP Fallback] Failed for ${user.external_id}:`, httpErr.message);
                }
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
