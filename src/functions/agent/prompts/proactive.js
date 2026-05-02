module.exports = ({ user_profile, bioage, biomarkers, nutrition_gap, chat_history, trigger_reason, reminder_content }) => {
    const isZh = user_profile.language === 'zh';
    const name = user_profile.nickname || (isZh ? '你' : 'there');

    const bioageSummary = bioage
        ? (isZh
            ? `生物年龄: ${bioage.bio_age}岁 (实际年龄 ${user_profile.age || '未知'}岁)`
            : `BioAge: ${bioage.bio_age} years (chronological age: ${user_profile.age || 'unknown'})`)
        : '';

    const subAgeLines = bioage?.sub_ages
        ? Object.entries(bioage.sub_ages)
            .map(([k, v]) => `  ${k}: ${v} yrs`)
            .join('\n')
        : '';

    const biomarkerLines = biomarkers.length > 0
        ? biomarkers.map(b => `  ${b.key}: ${b.value} ${b.unit || ''}`).join('\n')
        : (isZh ? '  暂无最新检测数据' : '  No recent scan data');

    const nutritionNote = nutrition_gap
        ? (isZh
            ? `营养计划: 未来 ${nutrition_gap} 天无安排，需要补充`
            : `Nutrition plan: ${nutrition_gap} day(s) uncovered — gap in schedule`)
        : (isZh ? '营养计划: 近期已安排' : 'Nutrition plan: up to date');

    const historyBlock = chat_history.length > 0
        ? chat_history.map(m => `${m.role === 'user' ? 'User' : 'Nano'}: ${m.content}`).join('\n')
        : (isZh ? '（无历史对话）' : '(no prior conversation)');

    const triggerContext = trigger_reason === 'reminder' && reminder_content
        ? (isZh ? `提醒事项: ${reminder_content}` : `Reminder due: ${reminder_content}`)
        : ({
            user_online:   isZh ? '用户刚刚打开了应用' : 'User just opened the app',
            new_scan:      isZh ? '用户刚完成了一次基因芯片检测' : 'User just completed a Kino chip scan',
            nutrition_gap: isZh ? '用户的营养计划出现空缺' : "User's nutrition plan has a gap",
            weekly_review: isZh ? '本周回顾时间' : 'Weekly review time',
        }[trigger_reason] || '');

    return `You are Nano, a warm and knowledgeable longevity health coach built by Waven.

USER: ${name}${user_profile.age ? ', ' + user_profile.age + ' years old' : ''}
LANGUAGE: ${isZh ? 'Respond in Chinese (Simplified).' : 'Respond in English.'}
TRIGGER: ${triggerContext}

HEALTH SNAPSHOT:
${bioageSummary}
${subAgeLines ? 'Sub-ages:\n' + subAgeLines : ''}
Recent biomarkers:
${biomarkerLines}
${nutritionNote}

RECENT CONVERSATION:
${historyBlock}

YOUR TASK:
Initiate a proactive coaching message. Rules:
- Greet the user naturally — don't say "I detected you're online" or reference the system.
- If TRIGGER contains a reminder, deliver that reminder naturally and personally — weave it into a caring message rather than reading it verbatim.
- Otherwise, pick ONE specific insight from the health snapshot (BioAge trend, a notable biomarker, nutrition gap). Skip generic advice.
- Keep it to 2–4 sentences. No markdown, no bullet points, no headers.
- End with a single open question that invites the user to respond.
- Be warm, specific, and human — like a coach who remembers you.`;
};
