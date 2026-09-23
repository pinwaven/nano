'use strict';
// Renders completed questionnaire answers as the text block the chat context, the Dots
// formulation and the twin bundle all carry. Pure: no database, no model client — which is
// why it lives here rather than in handlers/questionnaires.js, whose OpenAI and persona
// imports would otherwise follow it into the twin function (src/functions/twin), which
// ships a copy of lib/twinBundle.js and everything it requires.

function formatQuestionnaireContext(rows, language) {
    if (!rows || rows.length === 0) return null;
    const isZh = language === 'zh';
    const grouped = {};
    for (const r of rows) {
        const qName = isZh ? (r.name_zh || r.name) : r.name;
        if (!grouped[qName]) grouped[qName] = [];
        let answer = r.answer;
        if (Array.isArray(answer)) answer = answer.join(', ');
        else if (typeof answer === 'object' && answer !== null) answer = Object.entries(answer).map(([k, v]) => `${k}: ${v}`).join(', ');
        else answer = String(answer ?? '—');
        const question = isZh ? (r.prompt_zh || r.prompt_en) : (r.prompt_en || r.prompt_zh);
        grouped[qName].push(`  ${question}: ${answer}`);
    }
    const lines = [isZh ? '用户问卷回答（由护理团队收集）：' : 'QUESTIONNAIRE RESPONSES (collected by care team):'];
    for (const [name, items] of Object.entries(grouped)) {
        lines.push(`[${name}]`);
        lines.push(...items);
    }
    return lines.join('\n');
}

module.exports = { formatQuestionnaireContext };
