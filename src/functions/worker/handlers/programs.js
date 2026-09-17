'use strict';

/**
 * Multi-day 打卡 programs — CLAUDE.md §42, docs/architecture/programs.md.
 *
 * A program is switched on by a COACH for a client they manage (handlePostProgramEnroll) —
 * there is no auto-enrollment. Activation delivers Day 1 inline; every later day is the daily
 * check-in's shape (handlers/checkin.js): the dispatcher's scan finds an enrolled user on their
 * first app-open of a day whose next program day is offerable, and the worker claims the
 * (user, 'program_day', date) slot atomically before doing any work. The card itself is
 * server-built (lib/programs.js buildProgramDayCard) — the model never emits :::lesson /
 * :::checkin.
 *
 * The 打卡 is a questionnaire. Its assignment is created LAZILY, when the user taps 开始打卡
 * (handlePostProgramDayStartCheckin) — never at offer time — because handleGetPendingQuestionnaires
 * has no type filter and the miniapp auto-starts every pending assignment on app open, which
 * would launch the form before the user had seen the card or the lesson.
 *
 * Three notification types are dual-written (chat_messages + notifications) and MUST stay in the
 * miniapp's AI_ECHO_TYPES, or the bubble renders twice (tests/static-invariants.test.js):
 */
const NOTIFY_DAY = 'program_day';
const NOTIFY_SUMMARY = 'program_day_summary';
const NOTIFY_COMMENT = 'program_day_comment';
const NOTIFY_NUDGE = 'program_day_nudge';
// A client who has quietly dropped out is reminded this many times (one per calendar day the
// day stays open), then left alone. The coach still sees the stall in their client view.
const MAX_NUDGES = 5;

const { pool } = require('../lib/db');
const ossLib = require('../lib/oss');
const { getEssentialBlock } = require('../lib/knowledgeBase');
const { saveChatMessage, deliverTerminalMessage } = require('./chat');
const {
    SHANGHAI_TODAY_SQL, renderSummaryTemplate, computeDeltas, buildProgramDayCard,
    isDayOfferable, tryCompleteDay, resolveProgramPersona,
} = require('../lib/programs');
const vivaCommentTemplate = require('../prompts/viva/systemProgramDayComment');
const nanoCommentTemplate = require('../prompts/nano/systemProgramDayComment');
const OpenAI = require('openai');

const getLlmClient = () => new OpenAI({
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
});

const _log = (level, msg, data) => console.log(JSON.stringify({ level, msg, ...(data || {}) }));

// ---------------------------------------------------------------------------------------
// CloudEvent: program.day — offer today's day
// ---------------------------------------------------------------------------------------

async function handleProgramDayEvent({ user_id, program_id, persona_type }) {
    if (!user_id || !program_id) {
        _log('WARN', 'handleProgramDayEvent missing user_id/program_id', { user_id, program_id });
        return { delivered: false, reason: 'missing_args' };
    }

    // Same claim as handlers/checkin.js: the dispatcher's own NOT EXISTS only sees rows that
    // already exist, so two ticks racing one user would otherwise both get here. Status starts
    // 'claiming' so the miniapp's poll cannot surface an empty bubble before content exists.
    let notificationId;
    try {
        const claim = await pool.query(
            `INSERT INTO notifications (user_id, notification_type, checkin_date, content, status)
             VALUES ($1, $2, ${SHANGHAI_TODAY_SQL}, '', 'claiming')
             ON CONFLICT (user_id, notification_type, checkin_date) WHERE checkin_date IS NOT NULL DO NOTHING
             RETURNING id`,
            [user_id, NOTIFY_DAY]
        );
        if (!claim.rows.length) {
            _log('INFO', 'program day skipped, already claimed', { user_id, program_id });
            return { delivered: false, reason: 'already_claimed_today' };
        }
        notificationId = claim.rows[0].id;
    } catch (err) {
        _log('ERROR', 'handleProgramDayEvent claim failed', { user_id, program_id, error: err.message });
        return { delivered: false, reason: 'claim_failed' };
    }

    const client = await pool.connect();
    let day = null;
    let program = null;
    let lesson = null;
    try {
        await client.query('BEGIN');
        // No auto-enroll: the enrollment row exists only because a coach activated the program.
        const enr = await client.query(
            `SELECT e.id, e.status, e.current_day, p.id AS program_id, p.key_name, p.title_zh, p.title_en,
                    p.duration_days, p.status AS program_status, ${SHANGHAI_TODAY_SQL}::text AS today
             FROM program_enrollments e JOIN programs p ON p.id = e.program_id
             WHERE e.user_id = $1 AND e.program_id = $2
             FOR UPDATE OF e`,
            [user_id, program_id]
        );
        const enrollment = enr.rows[0];
        if (!enrollment) throw new Error('not_enrolled');
        if (enrollment.program_status !== 'active') throw new Error('program_inactive');
        const prog = await client.query(
            `SELECT day_index, offered_on::text AS offered_on, completed_at,
                    (completed_at AT TIME ZONE 'Asia/Shanghai')::date::text AS completed_on
             FROM program_day_progress WHERE enrollment_id = $1`,
            [enrollment.id]
        );
        if (!isDayOfferable({ enrollment, progressRows: prog.rows, today: enrollment.today })) {
            await client.query('ROLLBACK');
            client.release();
            await pool.query(`UPDATE notifications SET status = 'failed' WHERE id = $1`, [notificationId]).catch(() => {});
            _log('INFO', 'program day not offerable on re-check', { user_id, program_id, current_day: enrollment.current_day });
            return { delivered: false, reason: 'not_offerable' };
        }
        if (enrollment.current_day > enrollment.duration_days) throw new Error('current_day_past_duration');

        const dayRes = await client.query(
            `SELECT d.*, l.title AS lesson_title
             FROM program_days d LEFT JOIN academy_lessons l ON l.id = d.lesson_id
             WHERE d.program_id = $1 AND d.day_index = $2`,
            [program_id, enrollment.current_day]
        );
        day = dayRes.rows[0];
        if (!day) throw new Error(`program_day_${enrollment.current_day}_missing`);
        program = enrollment;
        lesson = day.lesson_id ? { id: day.lesson_id, title: day.lesson_title } : null;

        // A lesson the user already watched (e.g. in the Academy tab) counts from the start —
        // subject to the lesson's min_watch_seconds, same rule as markLessonWatched.
        const ins = await client.query(
            `INSERT INTO program_day_progress (enrollment_id, day_index, offered_on, notification_id, lesson_completed_at)
             VALUES ($1, $2, ${SHANGHAI_TODAY_SQL}, $3,
                     (SELECT acp.completed_at
                      FROM academy_coach_progress acp JOIN academy_lessons l ON l.id = acp.lesson_id
                      WHERE acp.user_id = $4 AND acp.lesson_id = $5
                        AND (l.min_watch_seconds IS NULL OR COALESCE(acp.time_spent_seconds, 0) >= l.min_watch_seconds)))
             ON CONFLICT (enrollment_id, day_index) DO NOTHING
             RETURNING id`,
            [enrollment.id, enrollment.current_day, notificationId, user_id, day.lesson_id]
        );
        if (!ins.rows.length) throw new Error('progress_row_exists');
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        client.release();
        await pool.query(`UPDATE notifications SET status = 'failed' WHERE id = $1`, [notificationId]).catch(() => {});
        _log('ERROR', 'handleProgramDayEvent failed', { user_id, program_id, error: err.message });
        return { delivered: false, reason: err.message };
    }
    client.release();

    try {
        const who = await resolveProgramPersona(user_id);
        const personaType = who?.persona || persona_type || 'nano';
        const lang = who?.language || 'zh';
        const content = buildProgramDayCard({ program: { id: program.program_id }, day, lesson, lang });
        await saveChatMessage(user_id, 'ai', content, null, personaType);
        await pool.query(`UPDATE notifications SET content = $1, status = 'pending' WHERE id = $2`, [content, notificationId]);
        _log('INFO', 'program day delivered', { user_id, program_id, day_index: day.day_index });
        return { delivered: true, day_index: day.day_index };
    } catch (err) {
        await pool.query(`UPDATE notifications SET status = 'failed' WHERE id = $1`, [notificationId]).catch(() => {});
        _log('ERROR', 'handleProgramDayEvent delivery failed', { user_id, program_id, error: err.message });
        return { delivered: false, reason: 'delivery_failed' };
    }
}

// ---------------------------------------------------------------------------------------
// CloudEvent: program.nudge — "Day N 还没完成"
// ---------------------------------------------------------------------------------------

/**
 * Dispatched by the dispatcher's Scan N for an enrolled user who is online and has an OPEN day
 * offered on an earlier date. Deterministic text (no LLM) naming what is still missing, followed
 * by a fresh copy of the day's card so the buttons are right there. Same atomic
 * (user, type, date) claim as the day card; capped at MAX_NUDGES per day-row.
 */
async function handleProgramNudgeEvent({ user_id, program_id }) {
    if (!user_id || !program_id) return { delivered: false, reason: 'missing_args' };
    let notificationId;
    try {
        const claim = await pool.query(
            `INSERT INTO notifications (user_id, notification_type, checkin_date, content, status)
             VALUES ($1, $2, ${SHANGHAI_TODAY_SQL}, '', 'claiming')
             ON CONFLICT (user_id, notification_type, checkin_date) WHERE checkin_date IS NOT NULL DO NOTHING
             RETURNING id`,
            [user_id, NOTIFY_NUDGE]
        );
        if (!claim.rows.length) return { delivered: false, reason: 'already_claimed_today' };
        notificationId = claim.rows[0].id;
    } catch (err) {
        _log('ERROR', 'handleProgramNudgeEvent claim failed', { user_id, program_id, error: err.message });
        return { delivered: false, reason: 'claim_failed' };
    }
    try {
        // The open day, re-read here rather than trusted from the event: the user may have
        // finished it between the scan and this invocation.
        const { rows } = await pool.query(
            `UPDATE program_day_progress dp
             SET nudge_count = dp.nudge_count + 1, last_nudged_on = ${SHANGHAI_TODAY_SQL}
             FROM program_enrollments e
             JOIN programs p ON p.id = e.program_id
             JOIN program_days d ON d.program_id = e.program_id
             LEFT JOIN academy_lessons l ON l.id = d.lesson_id
             WHERE dp.enrollment_id = e.id
               AND d.day_index = dp.day_index
               AND e.user_id = $1 AND e.program_id = $2 AND e.status = 'active' AND p.status = 'active'
               AND dp.completed_at IS NULL
               AND dp.offered_on < ${SHANGHAI_TODAY_SQL}
               AND dp.nudge_count < $3
             RETURNING dp.day_index, dp.offered_on::text AS offered_on, dp.lesson_completed_at, dp.checkin_completed_at,
                       d.title_zh, d.title_en, d.intro_md_zh, d.intro_md_en, d.lesson_id, d.checkin_label_zh, d.checkin_label_en,
                       l.title AS lesson_title, p.title_zh AS program_title_zh, p.title_en AS program_title_en,
                       (${SHANGHAI_TODAY_SQL} - dp.offered_on) AS stalled_days`,
            [user_id, program_id, MAX_NUDGES]
        );
        const row = rows[0];
        if (!row) {
            await pool.query(`UPDATE notifications SET status = 'failed' WHERE id = $1`, [notificationId]).catch(() => {});
            return { delivered: false, reason: 'nothing_open' };
        }
        const who = await resolveProgramPersona(user_id);
        const personaType = who?.persona || 'nano';
        const lang = who?.language || 'zh';
        const zh = lang !== 'en';
        const missing = [];
        if (row.lesson_id && !row.lesson_completed_at) missing.push(zh ? '看完今天的课程' : "watch today's lesson");
        if (!row.checkin_completed_at) missing.push(zh ? '完成打卡' : 'do the check-in');
        const dayTitle = zh ? (row.title_zh || row.title_en) : (row.title_en || row.title_zh);
        const head = zh
            ? `**Day ${row.day_index} 还没完成** · ${dayTitle}\n\n还差：${missing.join('、')}。不用赶，今天补上就好——完成后明天的 Day ${row.day_index + 1} 才会开启。`
            : `**Day ${row.day_index} is still open** · ${dayTitle}\n\nLeft to do: ${missing.join(' and ')}. No rush — finish it today and Day ${row.day_index + 1} unlocks tomorrow.`;
        // A fresh copy of the card: same directives, so the lesson player and 开始打卡 button are
        // right under the reminder instead of somewhere up in the history.
        const card = buildProgramDayCard({
            program: { id: program_id },
            day: { ...row, intro_md_zh: null, intro_md_en: null },
            lesson: row.lesson_id ? { id: row.lesson_id, title: row.lesson_title } : null,
            lang,
        });
        const content = `${head}\n\n${card.replace(/^\*\*Day \d+ · [^\n]*\*\*\n\n/, '')}`;
        await saveChatMessage(user_id, 'ai', content, null, personaType);
        await pool.query(`UPDATE notifications SET content = $1, status = 'pending' WHERE id = $2`, [content, notificationId]);
        _log('INFO', 'program nudge delivered', { user_id, program_id, day_index: row.day_index, stalled_days: row.stalled_days });
        return { delivered: true, day_index: row.day_index };
    } catch (err) {
        await pool.query(`UPDATE notifications SET status = 'failed' WHERE id = $1`, [notificationId]).catch(() => {});
        _log('ERROR', 'handleProgramNudgeEvent failed', { user_id, program_id, error: err.message });
        return { delivered: false, reason: err.message };
    }
}

// ---------------------------------------------------------------------------------------
// Coach activation
// ---------------------------------------------------------------------------------------

// Same coarse ownership pattern as handleGetUserFacts / handleGetCoachUserChat: the client must
// be assigned to this coach (users.coach_id). Returns the user row or null.
async function _coachOwnsUser(coachId, openid) {
    const cid = parseInt(coachId, 10);
    if (!openid || !Number.isFinite(cid)) return null;
    const { rows } = await pool.query(
        `SELECT user_id, channel_id, nickname FROM users WHERE user_id = $1 AND coach_id = $2`,
        [openid, cid]
    );
    return rows[0] || null;
}

// Programs a coach may switch on for this client: active, and either unscoped (no
// program_channels rows at all) or bound to the client's channel or any ancestor of it — the
// same tree semantics resolveGcnSector uses, so binding the `aeviva` root covers `aeviva-china`.
const AVAILABLE_PROGRAMS_SQL = `
    WITH RECURSIVE up AS (
        SELECT id, parent_channel_id, 1 AS depth FROM channels WHERE id = $1
        UNION ALL
        SELECT c.id, c.parent_channel_id, up.depth + 1 FROM channels c JOIN up ON c.id = up.parent_channel_id WHERE up.depth < 10
    )
    SELECT p.id, p.key_name, p.title_zh, p.title_en, p.description_zh, p.description_en, p.duration_days
    FROM programs p
    WHERE p.status = 'active'
      AND (NOT EXISTS (SELECT 1 FROM program_channels pc WHERE pc.program_id = p.id)
           OR EXISTS (SELECT 1 FROM program_channels pc WHERE pc.program_id = p.id AND pc.channel_id IN (SELECT id FROM up)))
    ORDER BY p.created_at`;

// GET /programs/coach?coach_id=&openid= — the client's activatable programs with their state.
async function handleGetCoachPrograms(query) {
    const { coach_id, openid } = query || {};
    try {
        const user = await _coachOwnsUser(coach_id, openid);
        if (!user) return { statusCode: 403, success: false, error: 'Access denied' };
        const [progs, enr] = await Promise.all([
            pool.query(AVAILABLE_PROGRAMS_SQL, [user.channel_id]),
            pool.query(
                `SELECT e.program_id, e.status, e.current_day, e.started_on::text AS started_on, e.completed_at,
                        e.activated_by_coach_id,
                        (SELECT COUNT(*) FROM program_day_progress dp WHERE dp.enrollment_id = e.id AND dp.completed_at IS NOT NULL)::int AS days_completed,
                        (SELECT MAX(dp.day_index) FROM program_day_progress dp WHERE dp.enrollment_id = e.id AND dp.completed_at IS NULL) AS open_day,
                        -- how many calendar days the open day has been sitting there (0 = offered today)
                        (SELECT (${SHANGHAI_TODAY_SQL} - dp.offered_on) FROM program_day_progress dp WHERE dp.enrollment_id = e.id AND dp.completed_at IS NULL ORDER BY dp.day_index DESC LIMIT 1)::int AS stalled_days,
                        (SELECT dp.nudge_count FROM program_day_progress dp WHERE dp.enrollment_id = e.id AND dp.completed_at IS NULL ORDER BY dp.day_index DESC LIMIT 1)::int AS nudge_count
                 FROM program_enrollments e WHERE e.user_id = $1`,
                [user.user_id]
            ),
        ]);
        const byProgram = Object.fromEntries(enr.rows.map(r => [r.program_id, r]));
        return {
            success: true,
            programs: progs.rows.map(p => ({ ...p, enrollment: byProgram[p.id] || null })),
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// POST /programs/enroll {coach_id, openid, program_id} — switch a program on for a client and
// deliver Day 1 right away (the claim inside handleProgramDayEvent keeps it one-per-day). A
// paused enrollment is resumed; an active one is left alone; a completed one is refused.
async function handlePostProgramEnroll(body) {
    const { coach_id, openid, program_id } = body || {};
    const pid = parseInt(program_id, 10);
    if (!Number.isFinite(pid)) return { statusCode: 400, success: false, error: 'program_id required' };
    try {
        const user = await _coachOwnsUser(coach_id, openid);
        if (!user) return { statusCode: 403, success: false, error: 'Access denied' };
        const avail = await pool.query(AVAILABLE_PROGRAMS_SQL, [user.channel_id]);
        if (!avail.rows.some(p => p.id === pid)) return { statusCode: 404, success: false, error: 'Program not available for this client' };

        const existing = (await pool.query(`SELECT id, status FROM program_enrollments WHERE user_id = $1 AND program_id = $2`, [user.user_id, pid])).rows[0];
        if (existing && existing.status === 'completed') return { statusCode: 409, success: false, error: 'already_completed' };
        if (existing && existing.status === 'paused') {
            await pool.query(`UPDATE program_enrollments SET status = 'active' WHERE id = $1`, [existing.id]);
        } else if (!existing) {
            await pool.query(
                `INSERT INTO program_enrollments (user_id, program_id, status, started_on, current_day, activated_by_coach_id)
                 VALUES ($1, $2, 'active', ${SHANGHAI_TODAY_SQL}, 1, $3)
                 ON CONFLICT (user_id, program_id) DO NOTHING`,
                [user.user_id, pid, parseInt(coach_id, 10)]
            );
        }
        // Day 1 (or the next offerable day of a resumed program) lands in the chat now, not on
        // the next dispatcher tick — the coach is usually with the client when they activate.
        const delivery = await handleProgramDayEvent({ user_id: user.user_id, program_id: pid });
        return { success: true, resumed: !!(existing && existing.status === 'paused'), delivery };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// PUT /programs/enrollment {coach_id, openid, program_id, status: 'paused'|'active'}
async function handlePutProgramEnrollment(body) {
    const { coach_id, openid, program_id, status } = body || {};
    const pid = parseInt(program_id, 10);
    if (!Number.isFinite(pid) || !['paused', 'active'].includes(status)) return { statusCode: 400, success: false, error: 'program_id and status (paused|active) required' };
    try {
        const user = await _coachOwnsUser(coach_id, openid);
        if (!user) return { statusCode: 403, success: false, error: 'Access denied' };
        const { rows } = await pool.query(
            `UPDATE program_enrollments SET status = $3 WHERE user_id = $1 AND program_id = $2 AND status IN ('active', 'paused') RETURNING id, status`,
            [user.user_id, pid, status]
        );
        if (!rows.length) return { statusCode: 404, success: false, error: 'No active enrollment' };
        return { success: true, status: rows[0].status };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ---------------------------------------------------------------------------------------
// User endpoints
// ---------------------------------------------------------------------------------------

// GET /programs/my?openid= — the card's done-state source. DATEs go out ::text; the client never
// computes "today" itself.
async function handleGetProgramsMy(query) {
    const openid = query && query.openid;
    if (!openid) return { statusCode: 400, success: false, error: 'openid required' };
    try {
        const [enr, today] = await Promise.all([
            pool.query(
                `SELECT e.id, e.program_id, e.status, e.current_day, e.started_on::text AS started_on, e.completed_at,
                        p.key_name, p.title_zh, p.title_en, p.duration_days
                 FROM program_enrollments e JOIN programs p ON p.id = e.program_id
                 WHERE e.user_id = $1
                 ORDER BY e.created_at DESC`,
                [openid]
            ),
            pool.query(`SELECT ${SHANGHAI_TODAY_SQL}::text AS today`),
        ]);
        const enrollments = [];
        for (const e of enr.rows) {
            const days = await pool.query(
                `SELECT dp.day_index, dp.offered_on::text AS offered_on, d.lesson_id,
                        dp.lesson_completed_at, dp.questionnaire_assignment_id,
                        dp.checkin_completed_at, dp.completed_at
                 FROM program_day_progress dp
                 LEFT JOIN program_days d ON d.program_id = $2 AND d.day_index = dp.day_index
                 WHERE dp.enrollment_id = $1
                 ORDER BY dp.day_index`,
                [e.id, e.program_id]
            );
            enrollments.push({
                program_id: e.program_id, key_name: e.key_name, title_zh: e.title_zh, title_en: e.title_en,
                duration_days: e.duration_days, status: e.status, current_day: e.current_day,
                started_on: e.started_on, completed_at: e.completed_at,
                days: days.rows,
            });
        }
        return { success: true, today: today.rows[0].today, enrollments };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// GET /programs/lesson-url?openid=&lesson_id= — a fresh 1h presigned URL for a lesson that is
// part of a program the caller is enrolled in. The chat card carries only the lesson id.
async function handleGetProgramLessonUrl(query) {
    const openid = query && query.openid;
    const lessonId = parseInt(query && query.lesson_id, 10);
    if (!openid || !Number.isFinite(lessonId)) return { statusCode: 400, success: false, error: 'openid and lesson_id required' };
    try {
        const { rows } = await pool.query(
            `SELECT l.id, l.title, l.oss_key, l.content_type, l.min_watch_seconds, c.thumbnail_oss_key
             FROM academy_lessons l
             LEFT JOIN academy_courses c ON c.id = l.course_id
             WHERE l.id = $1
               AND EXISTS (
                 SELECT 1 FROM program_days d
                 JOIN program_enrollments e ON e.program_id = d.program_id AND e.user_id = $2
                 WHERE d.lesson_id = l.id)`,
            [lessonId, openid]
        );
        const lesson = rows[0];
        if (!lesson) return { statusCode: 404, success: false, error: 'Lesson not found' };
        if (!lesson.oss_key) return { statusCode: 404, success: false, error: 'Lesson has no video' };
        const watched = await pool.query(`SELECT time_spent_seconds FROM academy_coach_progress WHERE user_id = $1 AND lesson_id = $2`, [openid, lessonId]);
        return {
            success: true,
            lesson_id: lesson.id,
            title: lesson.title,
            url: ossLib.generatePresignedGetUrl(lesson.oss_key, 3600),
            poster_url: lesson.thumbnail_oss_key ? ossLib.generatePresignedGetUrl(lesson.thumbnail_oss_key, 3600) : null,
            min_watch_seconds: lesson.min_watch_seconds,
            watched_seconds: watched.rows[0]?.time_spent_seconds || 0,
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// POST /programs/day/start-checkin {openid, program_id, day_index} — creates today's
// questionnaire assignment on demand (see the module header for why not earlier). The caller
// then fetches /pending-questionnaires itself; deliberately NO questionnaire_ready notification,
// which would make the poll start the same form a second time.
async function handlePostProgramDayStartCheckin(body) {
    const { openid, program_id, day_index } = body || {};
    const pid = parseInt(program_id, 10);
    const di = parseInt(day_index, 10);
    if (!openid || !Number.isFinite(pid) || !Number.isFinite(di)) {
        return { statusCode: 400, success: false, error: 'openid, program_id and day_index required' };
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { rows } = await client.query(
            `SELECT dp.id, dp.questionnaire_assignment_id, dp.checkin_completed_at, dp.completed_at, d.questionnaire_id
             FROM program_day_progress dp
             JOIN program_enrollments e ON e.id = dp.enrollment_id
             JOIN program_days d ON d.program_id = e.program_id AND d.day_index = dp.day_index
             WHERE e.user_id = $1 AND e.program_id = $2 AND dp.day_index = $3
             FOR UPDATE OF dp`,
            [openid, pid, di]
        );
        const dp = rows[0];
        if (!dp) { await client.query('ROLLBACK'); return { statusCode: 404, success: false, error: 'Day not offered' }; }
        if (dp.checkin_completed_at) { await client.query('COMMIT'); return { success: true, done: true }; }
        if (dp.questionnaire_assignment_id) {
            await client.query('COMMIT');
            return { success: true, assignment_id: dp.questionnaire_assignment_id, already: true };
        }
        if (!dp.questionnaire_id) {
            // A day with no form completes on tap.
            await client.query(`UPDATE program_day_progress SET checkin_completed_at = NOW() WHERE id = $1`, [dp.id]);
            const r = await tryCompleteDay(client, dp.id);
            await client.query('COMMIT');
            return { success: true, done: true, day_completed: r.completed, program_completed: r.programCompleted };
        }
        const a = await client.query(
            `INSERT INTO questionnaire_assignments (questionnaire_id, user_id, assigned_by, status)
             VALUES ($1, $2, NULL, 'pending') RETURNING id`,
            [dp.questionnaire_id, openid]
        );
        await client.query(`UPDATE program_day_progress SET questionnaire_assignment_id = $1 WHERE id = $2`, [a.rows[0].id, dp.id]);
        await client.query('COMMIT');
        return { success: true, assignment_id: a.rows[0].id };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        return { success: false, error: err.message };
    } finally {
        client.release();
    }
}

// ---------------------------------------------------------------------------------------
// Questionnaire completion hook (injected into handlePostQuestionnaireResponse from index.js)
// ---------------------------------------------------------------------------------------

/**
 * A 'program_day' questionnaire just completed. Render the day's recap from the answers,
 * deliver it, add one short comment, and close the day if the lesson is also done.
 *
 * Awaited by the caller (FC freezes the context on return). Idempotent: the recap is written
 * by an UPDATE guarded on checkin_completed_at IS NULL, so a duplicate completion no-ops. A
 * hand-assigned program_day questionnaire (no progress row) also no-ops.
 */
async function completeProgramDayCheckin(assignment_id) {
    const ctx = await pool.query(
        `SELECT dp.id AS progress_id, dp.day_index, e.user_id, e.program_id,
                p.duration_days, p.title_zh, p.title_en,
                d.lesson_id, d.title_zh AS day_title_zh, d.title_en AS day_title_en,
                d.summary_template_zh, d.summary_template_en, d.questionnaire_id,
                dp.lesson_completed_at
         FROM program_day_progress dp
         JOIN program_enrollments e ON e.id = dp.enrollment_id
         JOIN programs p ON p.id = e.program_id
         JOIN program_days d ON d.program_id = e.program_id AND d.day_index = dp.day_index
         WHERE dp.questionnaire_assignment_id = $1`,
        [assignment_id]
    );
    const row = ctx.rows[0];
    if (!row) {
        _log('WARN', 'program_day questionnaire completed with no progress row', { assignment_id });
        return { ok: false, reason: 'no_progress_row' };
    }

    const who = await resolveProgramPersona(row.user_id);
    const lang = who?.language || 'zh';
    const personaType = who?.persona || 'nano';

    const resp = await pool.query(
        `SELECT q.key, q.input_type, q.prompt_zh, q.prompt_en, q.sort_order, r.answer
         FROM questionnaire_responses r
         JOIN questionnaire_questions q ON q.id = r.question_id
         WHERE r.assignment_id = $1
         ORDER BY q.sort_order`,
        [assignment_id]
    );
    const answersByKey = {};
    for (const r of resp.rows) answersByKey[r.key] = r.answer;

    const template = (lang === 'en' ? row.summary_template_en : row.summary_template_zh)
        || row.summary_template_zh || row.summary_template_en
        || (lang === 'en' ? `**Day ${row.day_index} complete**` : `**Day ${row.day_index}完成**`);
    const summary = renderSummaryTemplate(template, answersByKey);

    const upd = await pool.query(
        `UPDATE program_day_progress SET checkin_completed_at = NOW(), summary = $1
         WHERE id = $2 AND checkin_completed_at IS NULL RETURNING id`,
        [summary, row.progress_id]
    );
    if (!upd.rows.length) return { ok: true, duplicate: true };

    await deliverTerminalMessage(row.user_id, personaType, NOTIFY_SUMMARY, summary);

    // One lightweight completion, same pattern as the daily check-in: no agentic loop, no JUDGE.
    // A failure here costs the comment only — the recap has already landed.
    try {
        const deltas = computeDeltas(resp.rows, answersByKey, lang);
        const essentialKnowledge = await getEssentialBlock(personaType);
        const tpl = personaType === 'viva' ? vivaCommentTemplate : nanoCommentTemplate;
        const systemPrompt = tpl({
            user_profile: { nickname: who?.nickname, language: lang },
            program_title: lang === 'en' ? (row.title_en || row.title_zh) : (row.title_zh || row.title_en),
            day_index: row.day_index,
            day_title: lang === 'en' ? (row.day_title_en || row.day_title_zh) : (row.day_title_zh || row.day_title_en),
            duration_days: row.duration_days,
            summary,
            deltas,
            lesson_done: !row.lesson_id || !!row.lesson_completed_at,
            is_last_day: row.day_index >= row.duration_days,
            essential_knowledge: essentialKnowledge,
        });
        const completion = await getLlmClient().chat.completions.create({
            model: process.env.MODEL || 'qwen-plus-latest',
            messages: [{ role: 'system', content: systemPrompt }],
            max_tokens: 150,
            temperature: 0.7,
        });
        const text = completion.choices?.[0]?.message?.content?.trim();
        if (text) await deliverTerminalMessage(row.user_id, personaType, NOTIFY_COMMENT, text.replace(/^:::.*$/gm, '').trim());
    } catch (err) {
        _log('WARN', 'program day comment failed', { user_id: row.user_id, assignment_id, error: err.message });
    }

    const r = await tryCompleteDay(null, row.progress_id);
    _log('INFO', 'program day checkin completed', { user_id: row.user_id, day_index: row.day_index, day_completed: r.completed, program_completed: r.programCompleted });
    return { ok: true, ...r };
}

// ---------------------------------------------------------------------------------------
// Admin CRUD (gated by requireAdminTab(adminCtx, 'content') in index.js)
// ---------------------------------------------------------------------------------------

const PROGRAM_STATUSES = new Set(['draft', 'active', 'archived']);

function _programFields(body) {
    const b = body || {};
    const out = {};
    if (b.key_name !== undefined) out.key_name = String(b.key_name).trim().toLowerCase();
    if (b.title_zh !== undefined) out.title_zh = String(b.title_zh).trim();
    if (b.title_en !== undefined) out.title_en = b.title_en == null ? null : String(b.title_en).trim();
    if (b.description_zh !== undefined) out.description_zh = b.description_zh == null ? null : String(b.description_zh);
    if (b.description_en !== undefined) out.description_en = b.description_en == null ? null : String(b.description_en);
    if (b.duration_days !== undefined) out.duration_days = parseInt(b.duration_days, 10);
    if (b.status !== undefined) out.status = String(b.status);
    return out;
}

async function handleGetPrograms() {
    try {
        const { rows } = await pool.query(
            `SELECT p.*,
                    COALESCE((SELECT json_agg(json_build_object('id', c.id, 'key_name', c.key_name, 'name', c.name) ORDER BY c.name)
                              FROM program_channels pc JOIN channels c ON c.id = pc.channel_id WHERE pc.program_id = p.id), '[]'::json) AS channels,
                    (SELECT COUNT(*) FROM program_enrollments e WHERE e.program_id = p.id)::int AS enrollment_count,
                    (SELECT COUNT(*) FROM program_enrollments e WHERE e.program_id = p.id AND e.status = 'completed')::int AS completed_count
             FROM programs p ORDER BY p.created_at DESC`
        );
        return { success: true, programs: rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function _replaceChannels(client, programId, channelIds) {
    if (!Array.isArray(channelIds)) return;
    await client.query('DELETE FROM program_channels WHERE program_id = $1', [programId]);
    for (const cid of channelIds) {
        const n = parseInt(cid, 10);
        if (!Number.isFinite(n)) continue;
        await client.query('INSERT INTO program_channels (program_id, channel_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [programId, n]);
    }
}

async function _ensureDayRows(client, programId, durationDays) {
    for (let i = 1; i <= durationDays; i++) {
        await client.query(
            `INSERT INTO program_days (program_id, day_index, title_zh, title_en)
             VALUES ($1, $2, $3, $3) ON CONFLICT (program_id, day_index) DO NOTHING`,
            [programId, i, `Day ${i}`]
        );
    }
}

async function handlePostProgram(body) {
    const f = _programFields(body);
    if (!f.key_name || !/^[a-z0-9_]{2,40}$/.test(f.key_name)) return { statusCode: 400, success: false, error: 'key_name must match ^[a-z0-9_]{2,40}$' };
    if (!f.title_zh) return { statusCode: 400, success: false, error: 'title_zh required' };
    if (!Number.isFinite(f.duration_days) || f.duration_days < 1 || f.duration_days > 365) return { statusCode: 400, success: false, error: 'duration_days must be 1..365' };
    if (f.status && !PROGRAM_STATUSES.has(f.status)) return { statusCode: 400, success: false, error: 'invalid status' };
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { rows } = await client.query(
            `INSERT INTO programs (key_name, title_zh, title_en, description_zh, description_en, duration_days, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [f.key_name, f.title_zh, f.title_en || null, f.description_zh || null, f.description_en || null, f.duration_days, f.status || 'draft']
        );
        const program = rows[0];
        await _ensureDayRows(client, program.id, program.duration_days);
        await _replaceChannels(client, program.id, (body || {}).channel_ids);
        await client.query('COMMIT');
        return { success: true, program };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        if (err.code === '23505') return { statusCode: 409, success: false, error: 'key_name already exists' };
        return { success: false, error: err.message };
    } finally {
        client.release();
    }
}

async function handlePutProgram(id, body) {
    const pid = parseInt(id, 10);
    if (!Number.isFinite(pid)) return { statusCode: 400, success: false, error: 'invalid id' };
    const f = _programFields(body);
    delete f.key_name; // immutable — it is the seed's idempotency key
    if (f.status && !PROGRAM_STATUSES.has(f.status)) return { statusCode: 400, success: false, error: 'invalid status' };
    if (f.duration_days !== undefined && (!Number.isFinite(f.duration_days) || f.duration_days < 1 || f.duration_days > 365)) {
        return { statusCode: 400, success: false, error: 'duration_days must be 1..365' };
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const keys = Object.keys(f);
        let program;
        if (keys.length) {
            const sets = keys.map((k, i) => `${k} = $${i + 2}`);
            const { rows } = await client.query(
                `UPDATE programs SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING *`,
                [pid, ...keys.map(k => f[k])]
            );
            program = rows[0];
        } else {
            const { rows } = await client.query('SELECT * FROM programs WHERE id = $1', [pid]);
            program = rows[0];
        }
        if (!program) { await client.query('ROLLBACK'); return { statusCode: 404, success: false, error: 'Program not found' }; }
        await _ensureDayRows(client, program.id, program.duration_days);
        await _replaceChannels(client, program.id, (body || {}).channel_ids);
        await client.query('COMMIT');
        return { success: true, program };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        return { success: false, error: err.message };
    } finally {
        client.release();
    }
}

async function handleDeleteProgram(id) {
    const pid = parseInt(id, 10);
    if (!Number.isFinite(pid)) return { statusCode: 400, success: false, error: 'invalid id' };
    try {
        const c = await pool.query('SELECT COUNT(*)::int AS n FROM program_enrollments WHERE program_id = $1', [pid]);
        if (c.rows[0].n > 0) return { statusCode: 409, success: false, error: 'Program has enrollments — archive it instead' };
        const { rowCount } = await pool.query('DELETE FROM programs WHERE id = $1', [pid]);
        if (!rowCount) return { statusCode: 404, success: false, error: 'Program not found' };
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetProgramDays(id) {
    const pid = parseInt(id, 10);
    if (!Number.isFinite(pid)) return { statusCode: 400, success: false, error: 'invalid id' };
    try {
        const { rows } = await pool.query(
            `SELECT d.*, l.title AS lesson_title, l.course_id AS lesson_course_id,
                    q.name AS questionnaire_name, q.name_zh AS questionnaire_name_zh
             FROM program_days d
             LEFT JOIN academy_lessons l ON l.id = d.lesson_id
             LEFT JOIN questionnaires q ON q.id = d.questionnaire_id
             WHERE d.program_id = $1 ORDER BY d.day_index`,
            [pid]
        );
        return { success: true, days: rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

const DAY_FIELDS = ['title_zh', 'title_en', 'intro_md_zh', 'intro_md_en', 'lesson_id', 'questionnaire_id',
    'summary_template_zh', 'summary_template_en', 'checkin_label_zh', 'checkin_label_en'];

async function handlePutProgramDay(programId, dayIndex, body) {
    const pid = parseInt(programId, 10);
    const di = parseInt(dayIndex, 10);
    if (!Number.isFinite(pid) || !Number.isFinite(di) || di < 1) return { statusCode: 400, success: false, error: 'invalid program id / day index' };
    const b = body || {};
    const f = {};
    for (const k of DAY_FIELDS) {
        if (b[k] === undefined) continue;
        if (k === 'lesson_id' || k === 'questionnaire_id') {
            f[k] = b[k] == null || b[k] === '' ? null : parseInt(b[k], 10);
            if (f[k] !== null && !Number.isFinite(f[k])) return { statusCode: 400, success: false, error: `invalid ${k}` };
        } else {
            f[k] = b[k] == null ? null : String(b[k]);
        }
    }
    if (f.title_zh !== undefined && !f.title_zh) return { statusCode: 400, success: false, error: 'title_zh cannot be empty' };
    if (f.checkin_label_zh === null) f.checkin_label_zh = '开始打卡';
    if (f.checkin_label_en === null) f.checkin_label_en = 'Start check-in';
    try {
        const p = await pool.query('SELECT duration_days FROM programs WHERE id = $1', [pid]);
        if (!p.rows.length) return { statusCode: 404, success: false, error: 'Program not found' };
        if (di > p.rows[0].duration_days) return { statusCode: 400, success: false, error: 'day_index beyond duration_days' };
        if (f.questionnaire_id != null) {
            const q = await pool.query(`SELECT type FROM questionnaires WHERE id = $1`, [f.questionnaire_id]);
            if (!q.rows.length || q.rows[0].type !== 'program_day') return { statusCode: 400, success: false, error: "questionnaire must be type 'program_day'" };
        }
        if (f.lesson_id != null) {
            const l = await pool.query(`SELECT id FROM academy_lessons WHERE id = $1`, [f.lesson_id]);
            if (!l.rows.length) return { statusCode: 400, success: false, error: 'lesson not found' };
        }
        const keys = Object.keys(f);
        const cols = ['program_id', 'day_index', ...keys];
        const vals = [pid, di, ...keys.map(k => f[k])];
        const placeholders = vals.map((_, i) => `$${i + 1}`);
        const updates = keys.length ? keys.map(k => `${k} = EXCLUDED.${k}`).join(', ') : 'day_index = EXCLUDED.day_index';
        // title_zh is NOT NULL: a brand-new row without one gets the placeholder.
        if (!keys.includes('title_zh')) { cols.push('title_zh'); vals.push(`Day ${di}`); placeholders.push(`$${vals.length}`); }
        const { rows } = await pool.query(
            `INSERT INTO program_days (${cols.join(', ')}) VALUES (${placeholders.join(', ')})
             ON CONFLICT (program_id, day_index) DO UPDATE SET ${updates}
             RETURNING *`,
            vals
        );
        return { success: true, day: rows[0] };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetProgramEnrollments(id) {
    const pid = parseInt(id, 10);
    if (!Number.isFinite(pid)) return { statusCode: 400, success: false, error: 'invalid id' };
    try {
        const { rows } = await pool.query(
            `SELECT e.id, e.user_id, u.nickname, e.status, e.current_day, e.started_on::text AS started_on, e.completed_at,
                    e.activated_by_coach_id, cu.nickname AS activated_by_name,
                    COALESCE((SELECT json_agg(json_build_object(
                                'day_index', dp.day_index, 'offered_on', dp.offered_on::text,
                                'lesson_done', dp.lesson_completed_at IS NOT NULL,
                                'checkin_done', dp.checkin_completed_at IS NOT NULL,
                                'completed', dp.completed_at IS NOT NULL,
                                'stalled_days', CASE WHEN dp.completed_at IS NULL THEN (${SHANGHAI_TODAY_SQL} - dp.offered_on) ELSE NULL END,
                                'nudge_count', dp.nudge_count) ORDER BY dp.day_index)
                              FROM program_day_progress dp WHERE dp.enrollment_id = e.id), '[]'::json) AS days
             FROM program_enrollments e
             LEFT JOIN users u ON u.user_id = e.user_id
             LEFT JOIN coaches co ON co.id = e.activated_by_coach_id
             LEFT JOIN users cu ON cu.user_id = co.user_id
             WHERE e.program_id = $1 ORDER BY e.created_at DESC`,
            [pid]
        );
        return { success: true, enrollments: rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = {
    NOTIFY_DAY, NOTIFY_SUMMARY, NOTIFY_COMMENT, NOTIFY_NUDGE, MAX_NUDGES,
    handleProgramDayEvent, handleProgramNudgeEvent,
    handleGetProgramsMy,
    handleGetProgramLessonUrl,
    handlePostProgramDayStartCheckin,
    completeProgramDayCheckin,
    handleGetCoachPrograms, handlePostProgramEnroll, handlePutProgramEnrollment,
    handleGetPrograms, handlePostProgram, handlePutProgram, handleDeleteProgram,
    handleGetProgramDays, handlePutProgramDay, handleGetProgramEnrollments,
};
