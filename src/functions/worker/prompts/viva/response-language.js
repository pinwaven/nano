'use strict';

const { subAgeLabel, SUB_AGE_KEYS } = require('../../lib/subAgeLabels');

// Keep Viva's clinical/personality instructions shared across locales. Contexts from
// chat/check-ins nest the profile; report/nutrition callers pass language directly.
function withResponseLanguage(buildPrompt) {
    return (context) => {
        const language = (context.user_profile?.language || context.language || (context.isZh === false ? 'en' : 'zh')) === 'en' ? 'en' : 'zh';
        const labels = SUB_AGE_KEYS.map(key => subAgeLabel(key, language, context.sub_age_display_names));
        const rule = language === 'en'
            ? `RESPONSE LANGUAGE: English. Write all user-facing prose, headings, explanations, and display-card text in natural English. Translate Chinese source descriptions and example wording into English; do not copy their language. Keep Viva's identity, warm tone, scope, and factual safeguards. Use biological age, chronological age, and these dimension names: ${labels.join(', ')}. Use English product names when supplied; preserve proper names when no translation is available. This language rule also applies when the conversation history or supplied knowledge is Chinese.`
            : `回复语言：简体中文。所有面向用户的正文、标题、解释和卡片文字都使用自然的简体中文。保持 Viva 的身份、温暖语气、职责范围和事实约束。年龄维度名称：${labels.join('、')}。历史对话或参考资料的语言不改变回复语言。`;
        return `${buildPrompt(context)}\n\n${rule}\nOnly localize user-facing text. Preserve required JSON keys, action names, enum values, dot codes, ANALYSIS/FORMULATION markers, and ::: markup exactly. Fields explicitly required in Chinese (such as remember_fact facts) must remain Chinese. Translate prescribed prose headings and examples, but never change the output structure or factual requirements.`;
    };
}

module.exports = { withResponseLanguage };
