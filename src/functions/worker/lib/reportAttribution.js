'use strict';
/**
 * Who produced a report, in one line a user can read — for the 综合报告 card and the Viva AG panel.
 *
 * Composed only from what the row records, never assumed:
 *   result.origin   — a contribution through the twin function: agent, platform agent or a
 *                     physician's agent, and whether a person reviewed it;
 *   result.speaker  — a job answered by Curia's queue worker (vivad): the same facts in its shape;
 *   neither         — an older row. Every row these surfaces list is a Viva AG result, so it says
 *                     Viva — and nothing about review, because nothing was recorded either way.
 * A platform agent and a physician's agent are different speakers, and an unreviewed output is
 * said to be one: the person reading the card is owed both.
 */

const PLATFORM = { zh: 'Viva（平台智能体）', en: 'Viva (platform agent)' };
const REVIEWED = { zh: '已经人工审阅', en: 'reviewed' };
const UNREVIEWED = { zh: '未经人工审阅', en: 'not reviewed by a person' };

function _clean(s, max = 40) {
    return String(s || '').replace(/[\x00-\x1f]/g, '').trim().slice(0, max);
}

/** { text, kind, reviewed }. `reviewed` is null when the row records nothing either way. */
function reportAttribution(result, lang = 'zh') {
    const L = lang === 'en' ? 'en' : 'zh';
    const r = result && typeof result === 'object' ? result : {};
    let kind = null, name = null, reviewed = null;
    if (r.origin && typeof r.origin === 'object') {
        kind = r.origin.principal_kind === 'physician' ? 'physician' : 'platform-agent';
        name = _clean(r.origin.display_name);
        reviewed = typeof r.origin.reviewed === 'boolean' ? r.origin.reviewed : null;
    } else if (r.speaker && typeof r.speaker === 'object') {
        kind = r.speaker.kind === 'physician' ? 'physician' : 'platform-agent';
        name = _clean(r.speaker.display_name || r.speaker.agent);
        reviewed = typeof r.speaker.reviewed === 'boolean' ? r.speaker.reviewed : null;
    } else {
        kind = 'platform-agent';
    }
    const who = kind === 'physician'
        ? (L === 'en' ? `${name || 'A physician'}'s agent` : `${name || '医生'}的智能体`)
        : PLATFORM[L];
    const head = L === 'en' ? `By ${who}` : `由${who}生成`;
    const tail = reviewed === true ? REVIEWED[L] : reviewed === false ? UNREVIEWED[L] : null;
    return { text: tail ? `${head} · ${tail}` : head, kind, reviewed };
}

module.exports = { reportAttribution };
