const { pool } = require('./lib/db');
const { getNowShanghai } = require('./lib/time-utils');
const EventBridge = require('@alicloud/eventbridge');
const OpenApi = require('@alicloud/openapi-client');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

// Environment-scoped EventBridge source (added 2026-08-01 after a real incident: dev and prod
// share one Aliyun account/EventBridge bus, and nano-worker-dev's/nano-worker's (prod)
// eb-triggers both filtered on the bare "acs.chat" source with no per-environment distinction,
// so a dev-published chat.generate event was also picked up and processed by prod, leaking a
// raw LLM action tail into a real user's live chat history — see chatEventBridge.js for the
// full writeup. The same shared-bus risk applies to every event this function publishes
// (agent.coaching_session / checkin.daily, both under source "acs.dispatcher"; nutrition.topup
// was published here too until it was removed 2026-08-28 — see the note in the handler)
// since nano-agent/nano-agent-dev's and nano-worker/nano-worker-dev's eb-triggers had the
// identical unscoped filter. EVENT_SOURCE_SUFFIX is set to ".dev" in s.yaml and left unset in
// s-prod.yaml (defaults to "", i.e. prod's original unsuffixed source — no prod change needed).
const DISPATCHER_EVENT_SOURCE = 'acs.dispatcher' + (process.env.EVENT_SOURCE_SUFFIX || '');

// Viva proactive daily check-ins: the day is split into three non-overlapping Shanghai-time
// periods; at most one applies to any given moment, and 00:00-04:59 has no period at all (no
// "good morning" at 2am). Which period is "current" only matters at the instant a user's first
// app-open of that period is detected (see the check-in scan below) — the actual once-per-day
// guarantee comes from a NOT EXISTS check against `notifications`, not from this boundary.
function getCheckinPeriod(hour) {
    if (hour >= 5 && hour < 11) return 'morning';
    if (hour >= 11 && hour < 17) return 'midday';
    if (hour >= 17) return 'evening';
    return null;
}

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
        // ── Nutrition top-up: REMOVED 2026-08-28 ────────────────────────────────────────────
        // This scan used to publish a nutrition.topup CloudEvent for every user with fewer than
        // 7 upcoming nutrition_schedules rows, and the worker answered it by generating a fresh
        // formulation and committing it as that user's ACTIVE plan.
        //
        // It had no plan requirement at all — a LEFT JOIN over `users`, counting schedules — so
        // it did not "top up" anything: it MANUFACTURED a plan for anyone who did not have one,
        // including every user who had never ordered a box, never received capsules, and had no
        // intention of taking anything. That is how dev accumulated 1,133 plans across 676 users
        // with zero boxes ever produced.
        //
        // A plan now means "this person physically has these capsules", and the only two things
        // that may create one are a box scan (_activateProposedPlan for a chat-tool proposal,
        // _commitAgFormulation for a Viva AG formula). Nothing runs on a timer.
        //
        // Do not reintroduce a scan here that creates a plan. If a genuine top-up need ever
        // appears — a user mid-cycle running short of scheduled days — it must EXTEND the plan
        // they are already on, and must not match a user who has no plan.

        const agentUrl = process.env.AGENT_URL || 'https://nano-agent-napllanrqp.cn-shanghai-vpc.fcapp.run';

        // Helper: dispatch a payload to the agent via EventBridge with HTTP fallback
        const dispatchToAgent = async (payload) => {
            const cloudEvent = new EventBridge.CloudEvent({
                id: uuidv4(),
                source: DISPATCHER_EVENT_SOURCE,
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

        // The internal VPC URL for nano-worker, used as the HTTP fallback below.
        const workerUrl = process.env.WORKER_URL || 'https://nano-worker-napllanrqp.cn-shanghai-vpc.fcapp.run';

        // Helper: dispatch a payload to the worker function via EventBridge with HTTP fallback.
        // Originally factored out of the nutrition top-up dispatch (now removed, see above); the
        // Viva check-in scan below is what uses it today.
        const dispatchToWorker = async (payload, type, subject) => {
            const cloudEvent = new EventBridge.CloudEvent({
                id: uuidv4(),
                source: DISPATCHER_EVENT_SOURCE,
                specversion: '1.0',
                type,
                subject,
                datacontenttype: 'application/json',
                data: Buffer.from(JSON.stringify(payload)),
                time: new Date().toISOString(),
                extensions: { aliyuneventbusname: 'default' }
            });
            try {
                await ebClient.putEvents([cloudEvent]);
                console.log(JSON.stringify({ level: 'INFO', msg: '[EventBridge] Worker event published', type, user_id: payload.user_id }));
            } catch (ebErr) {
                console.warn(JSON.stringify({ level: 'WARN', msg: '[EventBridge] Fallback to HTTP for worker event', error: ebErr.message }));
                try {
                    await axios.post(workerUrl, payload, {
                        headers: { 'Content-Type': 'application/json', 'x-fc-invocation-type': 'Async' },
                        timeout: 10000
                    });
                    console.log(JSON.stringify({ level: 'INFO', msg: '[HTTP Fallback] Worker event dispatched', type, user_id: payload.user_id }));
                } catch (httpErr) {
                    console.error(JSON.stringify({ level: 'ERROR', msg: '[HTTP Fallback] Worker event failed', type, user_id: payload.user_id, error: httpErr.message }));
                }
            }
        };

        // Scan 0: proactive daily check-in (both personas — Nano adopted Viva's agentic core,
        // CLAUDE.md) — fires on a user's own first app-open within whichever time-of-day period
        // is currently active (see getCheckinPeriod above), not a fixed clock slot.
        // `checkinUserIds` is collected here and consulted by the user_online scan directly
        // below, so a user's first open of a period doesn't also trigger the legacy
        // (persona-agnostic, "You are Nano"-branded) proactive-coach nudge in the same tick.
        const checkinUserIds = new Set();
        const nowShanghai = getNowShanghai();
        const checkinPeriod = getCheckinPeriod(nowShanghai.hour);
        if (checkinPeriod) {
            try {
                // effective persona = active per-user override (migration_users_persona_override.sql)
                // if not expired, else channel default — mirrors worker/lib/persona.js's
                // resolveEffectivePersona/hasActiveVivaAccess, expressed inline since this FC
                // function has its own duplicated lib/ and can't require() the worker's copy.
                const checkinResult = await pool.query(
                    `WITH eff AS (
                       SELECT u.*, c.config AS channel_config,
                              CASE
                                  WHEN u.persona_override_type IS NOT NULL AND u.persona_override_expires_at > NOW()
                                      THEN u.persona_override_type
                                  ELSE COALESCE(c.config->>'persona_type', 'nano')
                              END AS effective_persona_type
                       FROM users u
                       JOIN channels c ON c.id = u.channel_id
                     )
                     SELECT eff.user_id, eff.effective_persona_type AS persona_type
                     FROM eff
                     JOIN nutrition_plans np ON np.user_id = eff.user_id AND np.status = 'active'
                     WHERE 'user' = ANY(eff.roles)
                       AND COALESCE((eff.preferences->>'daily_checkin_enabled')::boolean, true) = true
                       AND eff.last_active_at > NOW() - INTERVAL '2 minutes'
                       AND (eff.effective_persona_type != 'viva'
                            OR (eff.persona_override_type = 'viva' AND eff.persona_override_expires_at > NOW()))
                       AND EXISTS (SELECT 1 FROM nutrition_schedules s WHERE s.plan_id = np.id AND s.scheduled_date = CURRENT_DATE)
                       AND NOT EXISTS (
                         SELECT 1 FROM notifications n
                         WHERE n.user_id = eff.user_id AND n.notification_type = $1
                           AND n.sent_at::date = (NOW() AT TIME ZONE 'Asia/Shanghai')::date
                       )`,
                    [`${checkinPeriod}_checkin`]
                );
                console.log(JSON.stringify({ level: 'INFO', msg: `Coaching scan: ${checkinResult.rows.length} daily_checkin (${checkinPeriod})` }));
                for (const user of checkinResult.rows) {
                    checkinUserIds.add(user.user_id);
                    await dispatchToWorker({ user_id: user.user_id, period: checkinPeriod, persona_type: user.persona_type }, 'checkin.daily', `daily_checkin_${checkinPeriod}`);
                }
            } catch (checkinErr) {
                console.warn(JSON.stringify({ level: 'WARN', msg: 'daily_checkin scan skipped', error: checkinErr.message }));
            }
        }

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
                if (checkinUserIds.has(user.user_id)) continue;
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
                SELECT r.user_id, r.content, r.id, r.recurrence
                FROM reminders r
                JOIN users u ON u.user_id = r.user_id
                WHERE r.scheduled_for <= NOW()
                  AND r.status = 'pending'
                  AND r.coach_id IS NULL
                  AND u.last_active_at > NOW() - INTERVAL '2 minutes'
            `);
            console.log(JSON.stringify({ level: 'INFO', msg: `Coaching scan: ${dueRemindersForAgent.rows.length} reminder` }));
            for (const r of dueRemindersForAgent.rows) {
                await dispatchToAgent({ user_id: r.user_id, trigger_reason: 'reminder', reminder_content: r.content });
                // Mark processed immediately so the offline flush below doesn't double-deliver
                if (r.recurrence === 'daily') {
                    await pool.query(`UPDATE reminders SET scheduled_for = scheduled_for + INTERVAL '1 day' WHERE id = $1`, [r.id]);
                } else if (r.recurrence === 'weekly') {
                    await pool.query(`UPDATE reminders SET scheduled_for = scheduled_for + INTERVAL '7 days' WHERE id = $1`, [r.id]);
                } else {
                    await pool.query(`UPDATE reminders SET status = 'sent' WHERE id = $1`, [r.id]);
                }
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
            body: JSON.stringify({ message: 'Dispatcher scan complete.' })
        };
    } catch (error) {
        console.error('Dispatcher error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Internal Server Error' })
        };
    }
};
