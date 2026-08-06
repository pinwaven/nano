'use strict';
const { getFactConstraintBlock } = require('../chat/factConstraint');

// Framing per time-of-day period — shares all data-fetching/context with the other two, only
// the emphasis differs. Evening explicitly echoes (not repeats) whatever morning's grounded
// data point was, for continuity across the day's touchpoints. Parallel to
// prompts/viva/systemDailyCheckin.js, bilingual + Waven Nano branded.
const PERIOD_FRAMING = {
    zh: {
        morning: `现在是早晨，这是今天第一次主动问候。你的任务：
1. 自然地打招呼。
2. 简要提及今天安排的 Dots（不必逐一罗列全部细节），询问是否已经服用。
3. 结合下方"本周期最需关注的维度"，给出今天需要特别留意的一件具体事情——必须落在这个真实数据点上，不可泛泛而谈。
4. 以一个邀请式的问题结尾。`,
        midday: `现在是午间，这是当天第二次主动问候，语气应轻松、不要重复早晨可能已经说过的内容。你的任务：
1. 简短问候，了解一下今天过得如何。
2. 如果上午安排了 Dots 但你无法确认是否已服用，可以温和地提一句（不必重复完整清单）。
3. 保持轻量，不必引入新的深度健康数据分析。
4. 以一个邀请式的问题结尾。`,
        evening: `现在是傍晚/夜间，这是当天的收尾问候。你的任务：
1. 简短问候。
2. 提及今晚安排的 Dots（如有），询问是否已服用。
3. 用一句话呼应"本周期最需关注的维度"，形成与今天的连续性（不要逐字重复，只需简短呼应）。
4. 给出一个轻松的睡前/放松建议。
5. 以一个邀请式的问题结尾。`,
    },
    en: {
        morning: `It's morning — this is today's first proactive check-in. Your task:
1. Greet the user naturally.
2. Briefly mention today's scheduled Dots (no need to list every detail) and ask if they've taken them yet.
3. Using "the dimension most worth watching this period" below, name one specific, concrete thing to watch for today — it must be grounded in that real data point, not generic.
4. End with an inviting question.`,
        midday: `It's midday — the day's second proactive check-in. Keep the tone light and don't repeat whatever morning may have already covered. Your task:
1. A brief, casual check-in on how their day is going.
2. If morning Dots were scheduled and you can't confirm they were taken, mention it gently (no need to repeat the full list).
3. Keep it light — no need to introduce new deep health-data analysis.
4. End with an inviting question.`,
        evening: `It's evening/night — the day's closing check-in. Your task:
1. A brief greeting.
2. Mention tonight's scheduled Dots (if any) and ask if they've been taken.
3. Echo (don't repeat verbatim) "the dimension most worth watching this period" in one sentence, for continuity with today.
4. Offer one light bedtime/relaxation suggestion.
5. End with an inviting question.`,
    },
};

module.exports = ({ user_profile, period, morning_dots, evening_dots, most_elevated, active_health_plans, health_twin, current_solar_term, essential_knowledge }) => {
    const isZh = user_profile?.language === 'zh';
    const name = user_profile?.nickname || (isZh ? '你' : 'there');

    const DIM_LABELS = {
        ResilienceAge:    { zh: '抗压年龄', en: 'Resilience Age' },
        CellularAge:      { zh: '细胞年龄', en: 'Cellular Age' },
        MetabolicAge:     { zh: '代谢年龄', en: 'Metabolic Age' },
        MicroVascularAge: { zh: '微血管年龄', en: 'Micro-Vascular Age' },
    };

    const dotsLine = (list) => (list && list.length)
        ? list.map(d => `${d.name}×${d.count}`).join(isZh ? '、' : ', ')
        : (isZh ? '（今日暂无安排）' : '(none scheduled today)');

    const elevatedLine = most_elevated
        ? (isZh
            ? `${DIM_LABELS[most_elevated.key]?.zh || most_elevated.key}：${most_elevated.sub_age}岁（实际年龄 ${most_elevated.chrono_age ?? '未知'}岁）`
            : `${DIM_LABELS[most_elevated.key]?.en || most_elevated.key}: ${most_elevated.sub_age} yrs (chrono age ${most_elevated.chrono_age ?? 'unknown'} yrs)`)
        : (isZh ? '（暂无最新检测数据，不要编造具体数值，可省略这部分）' : "(no recent test data — don't fabricate a value, this part can be omitted)");

    const planLine = (active_health_plans && active_health_plans.length)
        ? active_health_plans.map(p => p.goal || p.name).filter(Boolean).join(isZh ? '；' : '; ')
        : '';

    // Optional, secondary to most_elevated — a wearable (Halo/V8) trend the model MAY
    // reference for grounding, never fabricated when no device/data exists.
    const hasWearableData = health_twin && (
        health_twin.avg_sleep_hours != null || health_twin.avg_daily_steps != null ||
        health_twin.avg_hrv_ms != null || health_twin.avg_resting_hr != null
    );
    const wearableLine = hasWearableData
        ? (isZh
            ? [
                health_twin.avg_sleep_hours != null ? `平均睡眠 ${health_twin.avg_sleep_hours.toFixed(1)} 小时` : null,
                health_twin.avg_daily_steps != null ? `日均步数 ${Math.round(health_twin.avg_daily_steps)}` : null,
                health_twin.avg_resting_hr != null ? `静息心率 ${Math.round(health_twin.avg_resting_hr)} bpm` : null,
                health_twin.avg_hrv_ms != null ? `HRV ${Math.round(health_twin.avg_hrv_ms)}ms` : null,
              ].filter(Boolean).join('，')
            : [
                health_twin.avg_sleep_hours != null ? `avg sleep ${health_twin.avg_sleep_hours.toFixed(1)}h` : null,
                health_twin.avg_daily_steps != null ? `avg steps ${Math.round(health_twin.avg_daily_steps)}` : null,
                health_twin.avg_resting_hr != null ? `resting HR ${Math.round(health_twin.avg_resting_hr)} bpm` : null,
                health_twin.avg_hrv_ms != null ? `HRV ${Math.round(health_twin.avg_hrv_ms)}ms` : null,
              ].filter(Boolean).join(', '))
        : '';

    const seasonLine = current_solar_term
        ? (isZh
            ? `当前节气：${current_solar_term.name_zh}（${current_solar_term.season_zh}季 · ${current_solar_term.organ_zh}）— ${current_solar_term.theme_zh}（传统节气养生视角，非临床证据，仅作轻微参考，不得掩盖生物标志物驱动的优先级）`
            : `Current solar term: ${current_solar_term.name_zh} (${current_solar_term.season_zh} · ${current_solar_term.organ_zh}) — traditional seasonal-wellness framing, not clinical evidence; use only as a light accent, never override biomarker-driven priorities.`)
        : '';

    const framing = (PERIOD_FRAMING[isZh ? 'zh' : 'en'])[period] || (PERIOD_FRAMING[isZh ? 'zh' : 'en']).morning;

    if (isZh) {
        return `${getFactConstraintBlock(essential_knowledge, true)}

你是 Nano，Waven 打造的精准长寿顾问。你正在主动向用户发起一次问候——用户并没有主动发起这次对话，也没有提出任何问题。

用户：${name}

${framing}

今日 Dots 安排：
早间：${dotsLine(morning_dots)}
晚间：${dotsLine(evening_dots)}

本周期最需关注的维度：
${elevatedLine}
${planLine ? `进行中的健康计划目标：${planLine}` : ''}
${wearableLine ? `最近的可穿戴设备数据（仅供参考，可选择性提及，不得优先于上述维度）：${wearableLine}` : ''}
${seasonLine}

输出要求：
- 全程使用简体中文。
- 2-4句话，不使用markdown、不使用列表符号、不使用标题。
- 语气温暖、具体，像一位记得用户情况的顾问——不要说"系统检测到""触发了提醒"之类的话。
- 必须引用上方提供的真实数据（具体 Dot 名称或具体维度），不得输出泛泛而谈、缺乏具体信息的通用问候。
- 不要输出任何 JSON 或动作标签，这只是一条问候消息。`;
    }

    return `${getFactConstraintBlock(essential_knowledge, false)}

You are Nano, a warm precision-longevity AI built by Waven. You are proactively reaching out to the user right now — they did not start this conversation and haven't asked a question.

User: ${name}

${framing}

Today's Dots schedule:
Morning: ${dotsLine(morning_dots)}
Evening: ${dotsLine(evening_dots)}

Dimension most worth watching this period:
${elevatedLine}
${planLine ? `Active health plan goal(s): ${planLine}` : ''}
${wearableLine ? `Recent wearable data (optional context, may mention selectively — never override the dimension above): ${wearableLine}` : ''}
${seasonLine}

Output requirements:
- Write entirely in English.
- 2-4 sentences, no markdown, no bullet points, no headers.
- Warm, specific tone — like an advisor who remembers the user's situation. Don't say things like "the system detected" or "a reminder was triggered".
- Must reference the real data given above (a specific Dot name or dimension) — don't output a generic, content-free greeting.
- Do not output any JSON or action tag — this is only a check-in message.`;
};
