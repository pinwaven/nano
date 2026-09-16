'use strict';

/**
 * Multi-day 打卡 programs — the pieces that are either pure (template rendering, the offer rule)
 * or are single-statement DB primitives shared by more than one handler (day completion, the
 * lesson-watched hook). CLAUDE.md §42, docs/architecture/programs.md.
 *
 * Deliberately requires no handler: handlers/academy.js calls markLessonWatched() from inside
 * POST /academy/progress, and handlers/programs.js requires handlers/chat.js — a handler
 * require here would close a cycle.
 */

const { pool } = require('./db');
const { sanitizeDisplayText } = require('./agQuestionnaire');
const { resolveEffectivePersona } = require('./persona');

// Every "today" in this feature is the Shanghai calendar date, computed in SQL so the dispatcher
// scan, the worker's re-check and the progress rows can never disagree by a timezone.
const SHANGHAI_TODAY_SQL = "(NOW() AT TIME ZONE 'Asia/Shanghai')::date";

// ---------------------------------------------------------------------------------------
// Pure
// ---------------------------------------------------------------------------------------

// A placeholder value goes into a chat bubble that mdToSegments will parse, so a fence or a
// pipe in a free-text answer must not be able to open a card or break a row. Newlines are
// collapsed because every template line is one field.
function _cell(v) {
    if (v == null) return '——';
    const s = sanitizeDisplayText(typeof v === 'object' ? JSON.stringify(v) : String(v))
        .replace(/\|/g, '/')
        .replace(/\s*\n+\s*/g, ' ')
        .trim();
    return s === '' ? '——' : s;
}

/**
 * Resolve `{{key}}` and `{{key.sub}}` against the answers of one assignment, keyed by question
 * key. A slider_group answer is an object ({before: 5, after: 3}); a text/time answer is a
 * scalar. Anything unresolvable renders as a dash rather than leaking the placeholder.
 */
function renderSummaryTemplate(template, answersByKey) {
    if (!template) return '';
    const answers = answersByKey || {};
    return String(template).replace(/\{\{\s*([a-z0-9_]+)(?:\.([a-z0-9_]+))?\s*\}\}/gi, (_m, key, sub) => {
        const a = answers[key];
        if (sub) return _cell(a && typeof a === 'object' && !Array.isArray(a) ? a[sub] : null);
        return _cell(a);
    });
}

/**
 * Before→after pairs from slider_group answers, for the comment prompt. Only sliders keyed
 * exactly `before`/`after` count — that is the seeded contract, and the prompt promises to
 * name real deltas, never inferred ones.
 */
function computeDeltas(questions, answersByKey, lang = 'zh') {
    const out = [];
    for (const q of questions || []) {
        if (q.input_type !== 'slider_group') continue;
        const a = (answersByKey || {})[q.key];
        if (!a || typeof a !== 'object') continue;
        const before = Number(a.before);
        const after = Number(a.after);
        if (!Number.isFinite(before) || !Number.isFinite(after)) continue;
        // A short config.label_* (the seed sets one) beats the full question prompt.
        const cfg = (q.config && typeof q.config === 'object') ? q.config : {};
        const label = lang === 'en'
            ? (cfg.label_en || cfg.label_zh || q.prompt_en || q.prompt_zh)
            : (cfg.label_zh || cfg.label_en || q.prompt_zh || q.prompt_en);
        out.push({ key: q.key, label: _cell(label), before, after, delta: after - before });
    }
    return out;
}

// Rows inside a ::: fence are |-separated; a title containing one would shift the columns.
function _row(v) {
    return String(v == null ? '' : v).replace(/\|/g, '/').replace(/\s*\n+\s*/g, ' ').trim();
}

/**
 * The Day N chat card. Server-written only — the model never emits :::lesson / :::checkin.
 *
 *   <intro>
 *
 *   :::lesson
 *   <lesson_id>|<title>
 *   :::
 *
 *   :::checkin
 *   <program_id>|<day_index>|<label>
 *   :::
 *
 * The lesson row carries only the id: the miniapp fetches a fresh presigned URL on tap, so no
 * OSS key or signed URL ever sits in chat history.
 */
function buildProgramDayCard({ program, day, lesson, lang = 'zh' }) {
    const zh = lang !== 'en';
    const intro = (zh ? day.intro_md_zh : day.intro_md_en) || day.intro_md_zh || day.intro_md_en
        || `**Day ${day.day_index} · ${zh ? (day.title_zh || day.title_en) : (day.title_en || day.title_zh)}**`;
    const parts = [String(intro).trim()];
    if (day.lesson_id && lesson) {
        parts.push(`:::lesson\n${Number(day.lesson_id)}|${_row(lesson.title || (zh ? '今日课程' : "Today's lesson"))}\n:::`);
    }
    const label = zh ? (day.checkin_label_zh || '开始打卡') : (day.checkin_label_en || 'Start check-in');
    parts.push(`:::checkin\n${Number(program.id)}|${Number(day.day_index)}|${_row(label)}\n:::`);
    return parts.join('\n\n');
}

/**
 * The offer rule, as a pure function over what the worker re-reads inside its transaction. The
 * dispatcher's SQL is the authority for *selection*; this is the in-transaction re-check that
 * protects against two ticks racing the same user (one tick's event may still be in flight
 * when the next tick runs the scan), and it is what the tests exercise.
 *
 *   - enrollment must be active;
 *   - no open day (completed_at IS NULL) — a missed day pauses, never skips;
 *   - nothing offered today and nothing completed today — max one program-day per calendar day.
 *
 * Dates are compared as 'YYYY-MM-DD' strings (DATE columns are read ::text — node-postgres
 * would otherwise parse a DATE at local midnight and land on the wrong day).
 */
function isDayOfferable({ enrollment, progressRows, today }) {
    if (!enrollment || enrollment.status !== 'active') return false;
    for (const r of progressRows || []) {
        if (!r.completed_at) return false;
        if (r.offered_on === today) return false;
        if (r.completed_on === today) return false;
    }
    return true;
}

// ---------------------------------------------------------------------------------------
// DB primitives
// ---------------------------------------------------------------------------------------

/**
 * Close a day if both halves are done. One UPDATE decides it, so two callers arriving at once
 * (the questionnaire completion and the lesson-ended hook) cannot both "complete" it — only the
 * one whose UPDATE returns a row advances the enrollment.
 *
 * @returns {{completed: boolean, programCompleted: boolean}}
 */
async function tryCompleteDay(client, progressId) {
    const db = client || pool;
    const { rows } = await db.query(
        `UPDATE program_day_progress dp
         SET completed_at = NOW()
         FROM program_enrollments e
         JOIN program_days d ON d.program_id = e.program_id
         WHERE dp.id = $1
           AND e.id = dp.enrollment_id
           AND d.day_index = dp.day_index
           AND dp.completed_at IS NULL
           AND dp.checkin_completed_at IS NOT NULL
           AND (d.lesson_id IS NULL OR dp.lesson_completed_at IS NOT NULL)
         RETURNING dp.enrollment_id, dp.day_index`,
        [progressId]
    );
    if (!rows.length) return { completed: false, programCompleted: false };
    const { enrollment_id, day_index } = rows[0];
    const adv = await db.query(
        `UPDATE program_enrollments e
         SET current_day = $2::int + 1,
             status = CASE WHEN $2::int >= p.duration_days THEN 'completed' ELSE e.status END,
             completed_at = CASE WHEN $2::int >= p.duration_days THEN NOW() ELSE e.completed_at END
         FROM programs p
         WHERE e.id = $1 AND p.id = e.program_id AND e.status = 'active'
         RETURNING e.status`,
        [enrollment_id, day_index]
    );
    return { completed: true, programCompleted: adv.rows[0]?.status === 'completed' };
}

/**
 * Called from handlers/academy.js's POST /academy/progress — wherever the lesson was watched
 * (the chat card's inline <video> or the Academy tab), any open program day built on it is
 * stamped and, if its 打卡 is already in, closed. Idempotent: a second call finds nothing to
 * stamp.
 */
async function markLessonWatched(user_id, lesson_id) {
    if (!user_id || !lesson_id) return [];
    const { rows } = await pool.query(
        `UPDATE program_day_progress dp
         SET lesson_completed_at = NOW()
         FROM program_enrollments e
         JOIN program_days d ON d.program_id = e.program_id
         WHERE dp.enrollment_id = e.id
           AND d.day_index = dp.day_index
           AND e.user_id = $1
           AND d.lesson_id = $2
           AND dp.lesson_completed_at IS NULL
         RETURNING dp.id`,
        [user_id, lesson_id]
    );
    const results = [];
    for (const r of rows) results.push({ progress_id: r.id, ...(await tryCompleteDay(null, r.id)) });
    return results;
}

/**
 * Effective persona + language for a user, for saving the day's bubbles under the persona the
 * chat tab will reload them from. Same SQL shape as lib/vivaAgAccess.js's loadUserForVivaAg.
 */
async function resolveProgramPersona(user_id) {
    const { rows } = await pool.query(
        `SELECT u.user_id, u.nickname, u.language,
                u.persona_override_type, u.persona_override_expires_at,
                effective_persona_type(c.id) AS channel_persona_type
         FROM users u LEFT JOIN channels c ON c.id = u.channel_id
         WHERE u.user_id = $1`,
        [user_id]
    );
    const u = rows[0];
    if (!u) return null;
    return {
        user_id: u.user_id,
        nickname: u.nickname,
        language: u.language || 'zh',
        persona: resolveEffectivePersona({
            channelPersonaType: u.channel_persona_type,
            personaOverrideType: u.persona_override_type,
            personaOverrideExpiresAt: u.persona_override_expires_at,
        }),
    };
}

module.exports = {
    SHANGHAI_TODAY_SQL,
    renderSummaryTemplate,
    computeDeltas,
    buildProgramDayCard,
    isDayOfferable,
    tryCompleteDay,
    markLessonWatched,
    resolveProgramPersona,
};
