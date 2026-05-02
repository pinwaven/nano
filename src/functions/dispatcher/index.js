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
            SELECT u.user_id, u.nickname,
                   COUNT(s.id) as scheduled_days,
                   MAX(s.scheduled_date) as last_scheduled_date
            FROM users u
            LEFT JOIN nutrition_schedules s ON u.user_id = s.user_id AND s.scheduled_date >= CURRENT_DATE
            GROUP BY u.user_id
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
                user_id: user.user_id,
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
                console.log(`[EventBridge] Published event for ${user.user_id}`);
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
                    console.log(`[HTTP Fallback] Dispatched to worker for ${user.user_id}`);
                } catch (httpErr) {
                    console.error(`[HTTP Fallback] Failed for ${user.user_id}:`, httpErr.message);
                }
            }
        }

        const agentUrl = process.env.AGENT_URL || 'https://nano-agent-napllanrqp.cn-shanghai-vpc.fcapp.run';

        // Helper: dispatch a payload to the agent via EventBridge with HTTP fallback
        const dispatchToAgent = async (payload) => {
            const cloudEvent = new EventBridge.CloudEvent({
                id: uuidv4(),
                source: 'acs.dispatcher',
                specversion: '1.0',
                type: 'agent.coaching_session',
                subject: payload.trigger_reason,
                datacontenttype: 'application/json',
                data: Buffer.from(JSON.stringify(payload)),
                time: new Date().toISOString(),
                extensions: { aliyuneventbusname: 'default' }
            });
            try {
                await ebClient.putEvents([cloudEvent]);
                console.log(JSON.stringify({ level: 'INFO', msg: '[EventBridge] Agent event published', user_id: payload.user_id, trigger: payload.trigger_reason }));
            } catch (ebErr) {
                console.warn(JSON.stringify({ level: 'WARN', msg: '[EventBridge] Fallback to HTTP', error: ebErr.message }));
                try {
                    await axios.post(agentUrl, payload, {
                        headers: { 'Content-Type': 'application/json', 'x-fc-invocation-type': 'Async' },
                        timeout: 10000
                    });
                    console.log(JSON.stringify({ level: 'INFO', msg: '[HTTP Fallback] Agent dispatched', user_id: payload.user_id, trigger: payload.trigger_reason }));
                } catch (httpErr) {
                    console.error(JSON.stringify({ level: 'ERROR', msg: '[HTTP Fallback] Agent failed', user_id: payload.user_id, error: httpErr.message }));
                }
            }
        };

        // Scan 1: user_online — conversation-aware.
        // Only fire if the user has replied since the last agent message
        // (last chat message is not 'assistant', or no messages yet).
        try {
            const onlineResult = await pool.query(`
                SELECT user_id, nickname
                FROM users
                WHERE last_active_at > NOW() - INTERVAL '2 minutes'
                  AND 'user' = ANY(roles)
                  AND COALESCE(
                    (SELECT role FROM chat_messages
                     WHERE user_id = users.user_id
                     ORDER BY created_at DESC LIMIT 1),
                    'user'
                  ) != 'assistant'
            `);
            console.log(JSON.stringify({ level: 'INFO', msg: `Coaching scan: ${onlineResult.rows.length} user_online` }));
            for (const user of onlineResult.rows) {
                await dispatchToAgent({ user_id: user.user_id, trigger_reason: 'user_online' });
            }
        } catch (coachErr) {
            console.warn(JSON.stringify({ level: 'WARN', msg: 'user_online scan skipped', error: coachErr.message }));
        }

        // Scan 2: event-driven triggers — bypass conversation check.
        // These fire regardless of who sent the last message, because they carry
        // time-sensitive information the user needs to see (reminders, nutrition gaps, etc.).
        try {
            const dueRemindersForAgent = await pool.query(`
                SELECT r.user_id, r.content, r.id
                FROM reminders r
                JOIN users u ON u.user_id = r.user_id
                WHERE r.scheduled_for <= NOW()
                  AND r.status = 'pending'
                  AND u.last_active_at > NOW() - INTERVAL '2 minutes'
            `);
            console.log(JSON.stringify({ level: 'INFO', msg: `Coaching scan: ${dueRemindersForAgent.rows.length} reminder` }));
            for (const r of dueRemindersForAgent.rows) {
                await dispatchToAgent({ user_id: r.user_id, trigger_reason: 'reminder', reminder_content: r.content });
            }
        } catch (reminderErr) {
            console.warn(JSON.stringify({ level: 'WARN', msg: 'reminder scan skipped', error: reminderErr.message }));
        }

        // Flush due coach reminders into notifications
        try {
            const dueReminders = await pool.query(
                `SELECT id, user_id, content, recurrence FROM reminders
                 WHERE scheduled_for <= NOW() AND status = 'pending'`
            );
            for (const r of dueReminders.rows) {
                await pool.query(
                    `INSERT INTO notifications (user_id, notification_type, content, status)
                     VALUES ($1, 'coach_reminder', $2, 'pending')`,
                    [r.user_id, r.content]
                );
                if (r.recurrence === 'daily') {
                    await pool.query(
                        `UPDATE reminders SET scheduled_for = scheduled_for + INTERVAL '1 day' WHERE id = $1`,
                        [r.id]
                    );
                } else if (r.recurrence === 'weekly') {
                    await pool.query(
                        `UPDATE reminders SET scheduled_for = scheduled_for + INTERVAL '7 days' WHERE id = $1`,
                        [r.id]
                    );
                } else {
                    await pool.query(`UPDATE reminders SET status = 'sent' WHERE id = $1`, [r.id]);
                }
            }
            console.log(JSON.stringify({ level: 'INFO', msg: `Flushed ${dueReminders.rows.length} reminders` }));
        } catch (reminderErr) {
            // Table may not exist yet; skip silently
            console.warn(JSON.stringify({ level: 'WARN', msg: 'Reminder flush skipped', error: reminderErr.message }));
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
