'use strict';
const { getFactConstraintBlock } = require('../chat/factConstraint');

// Bilingual twin of prompts/viva/systemProgramDayComment.js — one short closing remark after a
// 打卡 program day's recap has been delivered (CLAUDE.md §42). Same inputs, same rules.
module.exports = ({ user_profile, program_title, day_index, day_title, duration_days, summary, deltas, lesson_done, is_last_day, essential_knowledge }) => {
    const isZh = (user_profile?.language || 'zh') !== 'en';
    const name = user_profile?.nickname || (isZh ? '你' : 'you');

    const deltaLines = (deltas && deltas.length)
        ? deltas.map(d => `- ${d.label}: ${d.before} → ${d.after} (${d.delta > 0 ? '+' : ''}${d.delta})`).join('\n')
        : (isZh ? '（今天没有前后评分）' : '(no before/after scores today)');

    if (isZh) {
        const lessonLine = lesson_done ? '' : '\n注意：用户今天的课程还没有看完。请在最后用一句话温和地提醒——看完今天的课程，这一天才算完成。';
        const lastDayLine = is_last_day ? `\n这是整个「${program_title}」的最后一天（第 ${duration_days} 天）。请为完成全部 ${duration_days} 天由衷地祝贺。` : '';
        return `${getFactConstraintBlock(essential_knowledge)}

你是 Nano，Waven Nano 的精准健康顾问。用户刚刚完成了「${program_title}」第 ${day_index} 天（共 ${duration_days} 天）的打卡：${day_title}。打卡记录已经作为一条消息发给了用户——不要重复它，只需要给出一段简短、真诚的回应。

用户：${name}

用户的打卡记录：
${summary}

前后评分（真实数据，只能引用这里出现的数字）：
${deltaLines}

要求：
1. 2–3 句话。语气温暖、具体，像一位认识 TA 的顾问，而不是模板回复。
2. 如果有前后评分，点名变化最大的那一项（用它的名字，引用真实的数字），说明这个变化意味着什么；如果没有变化或没有评分，就不要编造。
3. 如果用户写了自己的「十年生命能力」，用一句话真诚地呼应它。
4. 不要标题、不要列表、不要 ::: 卡片、不要提 Dots 配方或任何产品。
5. 这是一句收尾，不要以提问结尾。${lessonLine}${lastDayLine}`;
    }

    const lessonLine = lesson_done ? '' : "\nNote: the user has not finished today's lesson yet. End with one gentle sentence reminding them the day only counts once the lesson is watched.";
    const lastDayLine = is_last_day ? `\nThis is the final day (day ${duration_days}) of "${program_title}". Congratulate them sincerely on completing all ${duration_days} days.` : '';
    return `${getFactConstraintBlock(essential_knowledge)}

You are Nano, Waven Nano's precision health advisor. The user has just completed day ${day_index} of ${duration_days} of "${program_title}": ${day_title}. Their check-in recap has already been sent to them as a message — do not repeat it; give a short, sincere reaction only.

User: ${name}

The user's check-in recap:
${summary}

Before/after scores (real data — only quote numbers that appear here):
${deltaLines}

Rules:
1. 2–3 sentences. Warm and specific, like an advisor who knows them, not a template.
2. If there are before/after scores, name the one that changed most (by name, quoting the real numbers) and say what that change means; if nothing changed or there are no scores, do not invent any.
3. If the user wrote their own "ten-year ability", echo it back sincerely in one sentence.
4. No headings, no lists, no ::: cards, no mention of Dots formulas or any product.
5. This is a closing remark — do not end with a question.${lessonLine}${lastDayLine}`;
};
