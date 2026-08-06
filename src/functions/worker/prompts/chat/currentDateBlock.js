'use strict';

const { DateTime } = require('luxon');

/**
 * Renders the actual current Shanghai date/weekday as an explicit, unambiguous fact — every
 * chat/health-advice/formula-generate prompt already receives `now_iso` in its context (see
 * handlers/chat.js, handlers/dots.js), but only chat/reminder.js ever rendered it. Every other
 * template left the model to guess "today" from whatever date happened to be nearby (most
 * often the latest Kino test date), which is not the same thing and can be days or weeks
 * stale. Found via live dev testing 2026-08-05: asked "今天几号？" under casual_chat (a
 * non-agentic intent, so no JUDGE ever checks date claims), Viva confidently stated a
 * fabricated date two days after the last Kino test, then used that wrong date's weekday to
 * justify a specific dosing-timing recommendation with no actual basis (dot pulse-day
 * scheduling has no weekday assignment anywhere in the DB).
 *
 * Persona-agnostic like factConstraint.js/factMemoryBlock.js (lives in prompts/chat/, not
 * prompts/viva/ or prompts/nano/) — takes isZh explicitly since only nano's templates branch
 * on language; viva's are always Chinese.
 */
function getCurrentDateBlock(nowIso, isZh = true) {
    if (!nowIso) return '';
    const dt = DateTime.fromISO(nowIso, { zone: 'Asia/Shanghai' });
    if (!dt.isValid) return '';
    return isZh
        ? `今天的真实日期：${dt.setLocale('zh').toFormat('yyyy年M月d日 cccc')}（中国上海时区）——这是你唯一可以引用的"今天"，禁止用检测日期或对话中的其他历史日期推算或猜测今天是哪天。`
        : `TODAY'S ACTUAL DATE: ${dt.setLocale('en').toFormat('cccc, MMMM d, yyyy')} (Asia/Shanghai) — this is the only date you may cite as "today." Never infer or guess today's date from a test date or any other historical date.`;
}

module.exports = { getCurrentDateBlock };
