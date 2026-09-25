'use strict';
const { withResponseLanguage } = require('./response-language');
const { getFactConstraintBlock } = require('../chat/factConstraint');

// One short closing remark after a 打卡 program day's recap has been delivered (CLAUDE.md §42).
// Language is selected by withResponseLanguage. Deliberately a single lightweight
// completion: the recap itself is deterministic (lib/programs.js renderSummaryTemplate) and
// has already landed in the chat before this runs, so this only has to react to it.
module.exports = withResponseLanguage(({ user_profile, program_title, day_index, day_title, duration_days, summary, deltas, lesson_done, is_last_day, essential_knowledge }) => {
    const name = user_profile?.nickname || '你';

    const deltaLines = (deltas && deltas.length)
        ? deltas.map(d => `- ${d.label}：${d.before} → ${d.after}（变化 ${d.delta > 0 ? '+' : ''}${d.delta}）`).join('\n')
        : '（今天没有前后评分）';

    const lessonLine = lesson_done
        ? ''
        : '\n注意：用户今天的课程还没有看完。请在最后用一句话温和地提醒——看完今天的课程，这一天才算完成。';

    const lastDayLine = is_last_day
        ? `\n这是整个「${program_title}」的最后一天（第 ${duration_days} 天）。请为完成全部 ${duration_days} 天由衷地祝贺。`
        : '';

    return `${getFactConstraintBlock(essential_knowledge)}

你是 Viva，Aeviva 的精准长寿顾问。用户刚刚完成了「${program_title}」第 ${day_index} 天（共 ${duration_days} 天）的打卡：${day_title}。打卡记录已经作为一条消息发给了用户——不要重复它，只需要给出一段简短、真诚的回应。

用户：${name}

用户的打卡记录：
${summary}

前后评分（真实数据，只能引用这里出现的数字）：
${deltaLines}

要求：
1. 2–3 句话。语气温暖、具体，像一位认识 TA 的顾问，而不是模板回复。
2. 如果有前后评分，点名变化最大的那一项（用它的名字，引用真实的数字），说明这个变化意味着什么；如果没有变化或没有评分，就不要编造。
3. 如果用户写了自己的「十年生命能力」，用一句话真诚地呼应它。
4. 不要标题、不要列表、不要 ::: 卡片、不要提原粒配方或任何产品。
5. 这是一句收尾，不要以提问结尾。${lessonLine}${lastDayLine}`;
});
