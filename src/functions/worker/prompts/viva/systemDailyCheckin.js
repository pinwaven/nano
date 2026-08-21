'use strict';
const { getFactConstraintBlock } = require('../chat/factConstraint');
const { getVivaLabels } = require('./subAgeLabels');

// Framing per time-of-day period — shares all data-fetching/context with the other two, only
// the emphasis differs. Evening explicitly echoes (not repeats) whatever morning's grounded
// data point was, for continuity across the day's touchpoints.
const PERIOD_FRAMING = {
    morning: `现在是早晨，这是今天第一次主动问候。你的任务：
1. 自然地打招呼。
2. 简要提及今天安排的原粒（不必逐一罗列全部细节），询问是否已经服用。
3. 参考下方"本周期最需关注的维度"给出的具体指引——如果有明确需要留意的维度，用真实数据点自然带出；如果状态整体平稳，就给出一句真实、积极的话，不要为了"找点什么说"而制造焦虑。
4. 以一个邀请式的问题结尾。`,
    midday: `现在是午间，这是当天第二次主动问候，语气应轻松、不要重复早晨可能已经说过的内容。你的任务：
1. 简短问候，了解一下今天过得如何。
2. 如果上午安排了原粒但你无法确认是否已服用，可以温和地提一句（不必重复完整清单）。
3. 保持轻量，不必引入新的深度健康数据分析。
4. 以一个邀请式的问题结尾。`,
    evening: `现在是傍晚/夜间，这是当天的收尾问候。你的任务：
1. 简短问候。
2. 提及今晚安排的原粒（如有），询问是否已服用。
3. 只有当"本周期最需关注的维度"确实指出了一个真实需要关注的点时，才用一句话轻轻呼应它（不要逐字重复）；如果今天状态整体平稳，不要硬找一个"问题"来呼应，改为独立给出一句真实的正面反馈或轻松的收尾即可。
4. 给出一个轻松的睡前/放松建议。
5. 以一个邀请式的问题结尾。`,
};

module.exports = ({ user_profile, period, morning_dots, evening_dots, most_elevated, active_health_plans, health_twin, current_solar_term, essential_knowledge }) => {
    const name = user_profile?.nickname || '你';
    const labels = getVivaLabels(null);

    const dotsLine = (list) => (list && list.length)
        ? list.map(d => `${d.name}×${d.count}`).join('、')
        : '（今日暂无安排）';

    const elevatedLine = most_elevated?.key
        ? `${labels[most_elevated.key] || most_elevated.key} 相对实际年龄（${most_elevated.chrono_age ?? '未知'}岁）偏高约 ${Math.round(most_elevated.delta)} 岁——请用你自己的话自然带出这个维度，语气像"这方面值得多留意一点"或"这是一个可以着力滋养的地方"，不要直接把数字念出来做成一个冷冰冰的对比句，每次的措辞也要有变化，不要每天用同一个句式。`
        : most_elevated?.status === 'all_tracking_well'
            ? '（当前四项维度都没有明显偏高，不需要制造一个"问题"来说——请给出一句真实、积极的反馈，可以参考下方的可穿戴设备趋势数据（如有改善趋势），或围绕原粒服用的坚持度、单纯的鼓励，但不要编造任何数据点）'
            : '（暂无最新检测数据，不要编造具体数值，可省略这部分）';

    const planLine = (active_health_plans && active_health_plans.length)
        ? active_health_plans.map(p => p.goal || p.name).filter(Boolean).join('；')
        : '';

    // Optional, secondary to most_elevated — a Daily Monitoring (Halo/V8) trend the model MAY
    // reference for grounding, never fabricated when no device/data exists.
    const hasDailyMonitoringData = health_twin && (
        health_twin.avg_sleep_hours != null || health_twin.avg_daily_steps != null ||
        health_twin.avg_hrv_ms != null || health_twin.avg_resting_hr != null
    );
    const TREND_ZH = { improving: '改善中', declining: '有所下滑', stable: '保持平稳' };
    const trendBits = [
        health_twin?.trend_data?.hrv_trend && health_twin.trend_data.hrv_trend !== 'unknown'
            ? `HRV趋势${TREND_ZH[health_twin.trend_data.hrv_trend] || health_twin.trend_data.hrv_trend}` : null,
        health_twin?.trend_data?.sleep_trend && health_twin.trend_data.sleep_trend !== 'unknown'
            ? `睡眠趋势${TREND_ZH[health_twin.trend_data.sleep_trend] || health_twin.trend_data.sleep_trend}` : null,
    ].filter(Boolean);
    const dailyMonitoringLine = hasDailyMonitoringData
        ? [
            health_twin.avg_sleep_hours != null ? `平均睡眠 ${health_twin.avg_sleep_hours.toFixed(1)} 小时` : null,
            health_twin.avg_daily_steps != null ? `日均步数 ${Math.round(health_twin.avg_daily_steps)}` : null,
            health_twin.avg_resting_hr != null ? `静息心率 ${Math.round(health_twin.avg_resting_hr)} bpm` : null,
            health_twin.avg_hrv_ms != null ? `HRV ${Math.round(health_twin.avg_hrv_ms)}ms` : null,
            ...trendBits,
          ].filter(Boolean).join('，')
        : trendBits.join('，');

    const seasonLine = current_solar_term
        ? `当前节气：${current_solar_term.name_zh}（${current_solar_term.season_zh}季 · ${current_solar_term.organ_zh}）— ${current_solar_term.theme_zh}（传统节气养生视角，非临床证据，仅作轻微参考，不得掩盖生物标志物驱动的优先级）`
        : '';

    return `${getFactConstraintBlock(essential_knowledge)}

你是 Viva，Aeviva 的精准长寿顾问。你正在主动向用户发起一次问候——用户并没有主动发起这次对话，也没有提出任何问题。

用户：${name}

${PERIOD_FRAMING[period] || PERIOD_FRAMING.morning}

今日原粒安排：
早间：${dotsLine(morning_dots)}
晚间：${dotsLine(evening_dots)}

本周期最需关注的维度：
${elevatedLine}
${planLine ? `进行中的健康计划目标：${planLine}` : ''}
${dailyMonitoringLine ? `数字孪生 · 日常监测（仅供参考，可选择性提及，不得优先于上述维度）：${dailyMonitoringLine}` : ''}
${seasonLine}

输出要求：
- 全程使用简体中文。
- 2-4句话，不使用markdown、不使用列表符号、不使用标题。
- 语气温暖、具体，像一位记得用户情况的顾问——不要说"系统检测到""触发了提醒"之类的话。
- 必须引用上方提供的真实数据（具体原粒名称、具体维度，或状态平稳时的正面信号），不得输出泛泛而谈、缺乏具体信息的通用问候。
- 避免只做冷冰冰的数字对比：不要每次都把某个维度的年龄数字和实际年龄摆出来做对比句；如果确实值得一提，尽量搭配一件做得好的事情一起说，不要只谈不足。
- 不要输出任何 JSON 或动作标签，这只是一条问候消息。`;
};
