'use strict';

// Who the words in a managed customer's thread are for (CLAUDE.md §49). The customer never opens
// the app — their coach reads the thread and acts on it — so every message written there speaks
// ABOUT the customer, in the third person, to the coach: the scan result line, the formulation
// proposal, the health-advice report, a coach-asked chat turn. A regular user is addressed as 您
// exactly as before; nothing here changes for them.

function isManaged(user) {
    return !!user && user.account_type === 'managed';
}

function customerName(user, zh) {
    return (user && user.nickname) || (zh ? '该客户' : 'the customer');
}

// The chat line a finished Kino scan leaves in the thread. kino/lib/deviceHandlers.js carries the
// same wording (each FC function ships its own code) — change both together.
function scanResultMessage(bioAge, user) {
    const age = Number(bioAge).toFixed(1);
    const zh = ((user && user.language) || 'zh') === 'zh';
    if (isManaged(user)) {
        const name = customerName(user, zh);
        return zh
            ? `已完成 ${name} 的生物标志物检测分析，其生理年龄为 **${age} 岁**。可在客户的健康数据中查看详细分析。`
            : `Biomarker test analyzed for ${name}: their biological age is **${age} years**. See the customer's health data for details.`;
    }
    return zh
        ? `已完成生物标志物检测分析。您的生理年龄为 **${age} 岁**。请用健康管理小工具查看详细分析！`
        : `I've analyzed your biomarker test. Your biological age is **${age} years**. Check your health advice tool for details!`;
}

// Appended to an LLM system prompt when the account is managed. `asked` = the coach typed the
// question (a chat turn); otherwise the output is a report the coach triggered from the toolbox
// (formulation, health advice, an analyzed image). Either way it is read by the coach.
function managedVoiceBlock(user, { asked = false } = {}) {
    if (!isManaged(user)) return '';
    const zh = ((user && user.language) || 'zh') !== 'en';
    const name = user.nickname;
    if (zh) {
        return `\n\n【对话对象】${asked ? '你正在与该客户的健康教练对话' : '这份内容由该客户的健康教练发起、由教练阅读'}，而不是客户本人——客户不使用本应用，由教练代为管理。`
            + `以第三人称指称客户（${name ? `称"${name}"或` : '用'}"该客户"），不要用"您"称呼客户；`
            + (asked ? '直接回答教练的问题，' : '')
            + '建议写成教练可以执行或转告客户的形式。'
            + (asked ? '教练提供的关于客户的信息（饮食、过敏、目标、健康状况）即客户本人的情况。' : '');
    }
    return `\n\n[WHO YOU ARE TALKING TO] ${asked ? "You are talking to this customer's health coach" : "This was requested by, and will be read by, this customer's health coach"}, not the customer — the customer does not use this app; their coach manages their care. `
        + `Refer to the customer in the third person (${name ? `as "${name}" or ` : ''}"the customer"), never as "you". `
        + (asked ? "Answer the coach's question directly, and phrase" : 'Phrase')
        + ' advice as things the coach can do or tell the customer.'
        + (asked ? " Information the coach gives about the customer (diet, allergies, goals, conditions) is the customer's own." : '');
}

module.exports = { isManaged, scanResultMessage, managedVoiceBlock };
