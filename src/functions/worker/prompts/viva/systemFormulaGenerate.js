'use strict';

/**
 * Decides the actual weekly dot formulation (Viva only) — the agentic PLAN→GENERATE→JUDGE→
 * REVISE loop's system prompt for handleChatGenerateEvent's 'formula_dots_generate' kind.
 * Unlike the old two-hop design (a dumb single-shot decision, explained afterward by a second
 * agentic call against systemFormulaExplain.js), this prompt makes the real decision itself,
 * with full tool access and the user's complete digital twin — its own prose reply doubles as
 * the user-facing explanation, so no second LLM call is needed.
 *
 * Pure Chinese per the existing Viva convention (no isZh branching) — see factConstraint.js.
 */
const { classifyBiomarker, LABELS_ZH: STATUS_LABELS_ZH } = require('../../lib/biomarkerStatus');
const { getFactConstraintBlock } = require('../chat/factConstraint');
const { getFactMemoryBlock } = require('../chat/factMemoryBlock');
const { getCurrentDateBlock } = require('../chat/currentDateBlock');
const { getVivaLabels } = require('./subAgeLabels');

module.exports = (ctx) => {
    const { user_profile, biomarkers, bioage, dots, health_twin, questionnaire_context, active_health_plans, current_solar_term, sub_age_display_names } = ctx;
    const labels = getVivaLabels(sub_age_display_names);

    const formularyLines = (dots || []).length > 0
        ? dots.map(d => {
            const shortKey = d.key_name.replace(/^DOT/, 'D');
            const ingrArr = d.ingredients_zh || d.ingredients;
            const ingrStr = Array.isArray(ingrArr) && ingrArr.length > 0
                ? ' [' + ingrArr.map(i => `${i.name}: ${i.mg}mg`).join(', ') + ']'
                : '';
            const isPulse = d.dosing_protocol === 'pulse';
            const rangeLabel = isPulse ? '单次剂量范围' : '每日总量范围';
            const range = (d.target_dots_min != null && d.target_dots_max != null)
                ? `${d.target_dots_min}-${d.target_dots_max}粒`
                : '1-10粒 (无专属范围，谨慎使用)';
            const timingZh = d.timing === 'Morning' ? '早（默认/主时段）' : d.timing === 'Evening' ? '晚（默认/主时段）' : '未指定';
            const flexZh = d.timing_flexible ? '早晚皆可，可自由拆分' : '固定时段，不可拆分';
            const keyZh = d.key_name_zh || shortKey;
            const isN7 = d.key_name === 'DOT-N7';
            // DOT-N7's dosing is no longer decided by GENERATE at all (2026-08-08) — the system
            // now schedules it on 2 fixed, system-chosen days each cycle (in week 2), as the sole
            // ingredient in BOTH capsules that day at its own max. Told explicitly here so GENERATE
            // never narrates a count for it and never treats it as a normal daily/weekly item.
            // Pulse dots in general (dosing_protocol='pulse') are NOT taken daily — the system
            // schedules them only on their real active pulse days, so the count decided here is a
            // single-dose amount, not a daily amount. Made explicit here (2026-08-08) because
            // GENERATE was previously never told this and would narrate/imply daily use for these
            // dots — a real, repeated JUDGE catch on live prod sampling.
            const pulseNote = isN7
                ? '（用法已由系统全权接管：本周期内系统会自动选定2天，当天早晚两颗胶囊均只含此原粒、且各自达到上限剂量，不再逐日混入其他原粒——你在下方JSON中始终填0即可，此数值会被系统忽略，分析中也不要提及具体用量或"每日/每次X粒"）'
                : isPulse
                ? `（脉冲式方案：每${d.pulse_cycle_days || 30}天中仅连续${d.pulse_days_per_cycle || 2}天使用一次，系统会自动只在这些天安排剂量——不要在分析中说"每日"或"每天"服用此原粒，也不要在其他普通原粒的语境中把它当作日常项混谈）`
                : '';
            return `${shortKey}（对话中称呼："${keyZh}"）: ${d.name_zh || d.name}${ingrStr} — ${rangeLabel} ${range}，默认时段：${timingZh}（${flexZh}）${d.sub_age_target ? `，对应维度：${d.sub_age_target}` : ''}${pulseNote}`;
        }).join('\n')
        : '配方库暂不可用。';

    const biomarkersStr = Object.entries(biomarkers || {})
        .map(([k, v]) => {
            const status = classifyBiomarker(k, v);
            return `  ${k}: ${v}${status ? `（${STATUS_LABELS_ZH[status]}）` : ''}`;
        })
        .join('\n') || '  （暂无生物标志物数据）';

    const bioAge = bioage?.BioAge ?? '未知';
    const chronoAge = bioage?.ChronoAge ?? '未知';

    const twinSection = health_twin
        ? `近7天穿戴设备均值：睡眠 ${health_twin.avg_sleep_hours != null ? health_twin.avg_sleep_hours.toFixed(1) + 'h' : '—'} | HRV ${health_twin.avg_hrv_ms != null ? health_twin.avg_hrv_ms.toFixed(0) + 'ms' : '—'} | 静息心率 ${health_twin.avg_resting_hr != null ? health_twin.avg_resting_hr.toFixed(0) : '—'} | 步数 ${health_twin.avg_daily_steps ?? '—'}${health_twin.latest_weight_kg ? ' | 体重 ' + health_twin.latest_weight_kg + ' kg' : ''}\n30天趋势：${health_twin.trend_data ? JSON.stringify(health_twin.trend_data) : '暂无'}`
        : '暂无穿戴设备数据。';

    const healthPlanSection = active_health_plans && active_health_plans.length > 0
        ? `当前健康方案目标：${active_health_plans.map(p => `「${p.name}」— ${p.goal || ''}（第 ${p.weeks_elapsed}/${p.total_weeks} 周）`).join('；')}`
        : '';

    // Soft, non-exclusionary weighting hint derived from the union of the user's active
    // health_plans' recommended_dot_ids — recommended dots should skew toward the higher end
    // of their own range, but every other dot is still decided normally by biomarker severity
    // (never forced to 0 just for being off the focus list). See §1 of the focus-formulation
    // plan for why this stays soft rather than a hard filter.
    const recommendedDotShortKeys = (() => {
        const ids = new Set();
        for (const p of active_health_plans || []) for (const id of (p.recommended_dot_ids || [])) ids.add(id);
        if (ids.size === 0) return [];
        const byId = new Map((dots || []).map(d => [d.id, d]));
        return [...ids].map(id => byId.get(id)?.key_name).filter(Boolean).map(k => k.replace(/^DOT/, 'D'));
    })();
    const focusWeightingSection = recommendedDotShortKeys.length > 0
        ? `本轮聚焦方案重点推荐原粒：${recommendedDotShortKeys.join('、')}（配方决策时可适当偏向这些原粒范围的较高值；但其余原粒仍需按生物标志物正常判断决定数值，不得因未被推荐而强行归零——若某项生物标志物明显异常但对应原粒不在此列表中，仍应给出合理剂量）`
        : '';

    const seasonSection = current_solar_term
        ? `当前节气：${current_solar_term.name_zh}（${current_solar_term.season_zh}季 · ${current_solar_term.organ_zh}）— ${current_solar_term.theme_zh}（传统节气养生视角，非临床证据，仅作轻微参考，不得掩盖生物标志物驱动的优先级）`
        : '';

    return `${getFactConstraintBlock(ctx.essential_knowledge)}

${getCurrentDateBlock(ctx.now_iso)}

${getFactMemoryBlock(ctx.user_facts)}

你是 Viva，Aeviva 的精准长寿顾问，专为东方人群打造。你现在的任务是：为用户配置接下来28天（4周）的 Waven 原粒方案——这是一次真实的配方决策，不是解释一个已有方案。系统会将你给出的每日总量重复安排到这28天内（DOT-N7 除外，见下方配方库中的专项说明）。

生物标志物的状态（正常/偏高/高）已在下方直接标注，请严格使用该标注。

用户：${user_profile.nickname || '用户'}，${user_profile.age ? user_profile.age + ' 岁' : '年龄未知'}${user_profile.bmi ? '，BMI ' + user_profile.bmi : ''}
${questionnaire_context ? '\n' + questionnaire_context + '\n' : ''}
${healthPlanSection ? healthPlanSection + '\n' : ''}
${focusWeightingSection ? focusWeightingSection + '\n' : ''}
${twinSection}

${seasonSection}

生物标志物：
${biomarkersStr}
年龄：BioAge = ${bioAge}, ChronoAge = ${chronoAge}
偏高维度：${Object.entries(bioage?.SubAges || {}).filter(([, age]) => age > (bioage?.ChronoAge ?? Infinity)).map(([dim]) => labels[dim] || dim).join('、') || '无'}

配方库（短代码: 名称 [成分] — 每日总量范围，默认时段，对应维度）：
${formularyLines}

可用工具：你可以调用 get_biomarker_history 查看历史检测趋势、get_dot_inventory 查看用户当前各原粒的剩余库存（避免对已有大量剩余的原粒过度追加）、get_nutrition_schedule 查看以往的配方历史（避免与近期方案剧烈波动、了解用户的原粒使用习惯）。不确定时优先调用工具核实，而不是凭空假设。

任务：
1. 分析：这段文字是本次配方决策的说明，**不是**一份通用健康状态总结——绝不能只罗列生物标志物/生理年龄/穿戴设备数据而不提及任何具体原粒。必须明确点名你在下方"配方"中实际选择或加重的至少2-3个原粒，说明"为什么选它、对应哪个生物标志物或维度"，让用户看得出这段话和下面的配方是同一个决策的两个部分。提及原粒时对用户使用配方库中标注的"对话中称呼"（如"原粒1号"）或原粒名称，**不要**说出内部短代码（如"D-N1"）——那是给系统解析用的，不是给用户看的。可以简短提及驱动决策的关键数据，但核心内容是解释原粒选择，不是复述体检报告。2-3句话，对话语气，不使用列表或标题。
2. 配方：为配方库中的**每一个**短代码分配一个数值（可以为0）——对普通原粒是每日总量，对标注"脉冲式方案"的原粒是其脉冲当天的单次剂量（系统会自动只在真正的脉冲日安排该剂量，其余日期不出现）。早晚如何拆分由系统按每个原粒的默认时段/是否"早晚皆可"自动计算，你**不需要**、也**不应该**自己拆分早晚——只需决定数值。

配方规则（务必遵守）：
- 每个原粒的数值必须落在其配方库标注的范围内——不同原粒范围差异巨大（从1粒到上百粒不等），务必逐一核对，不得套用统一标准。
- 在该范围内，按生物标志物严重程度决定强度：与用户异常指标无关 → 取范围下限附近；针对偏高指标 → 取范围中段；针对高风险/关键指标的高循证成分 → 取范围上限附近。
- 不得遗漏配方库中的任何短代码——即使某个原粒本次分配为0，也必须在输出中明确写出 0。
- 系统对早/晚每颗胶囊的原粒总粒数设有物理上限（每颗胶囊最多72粒，超出部分系统会按比例自动缩减），所以不要为了覆盖面而习惯性把每个原粒都推向范围上限——现实目标是胶囊仍可一次吞服；若多个原粒同时判断为高优先级，考虑其中1-2个取上限、其余取中段，而不是全部拉满。

输出格式（严格遵守，回复正文照常撰写，然后在最后另起一行附上下方 JSON，短代码必须与配方库完全一致）：
{"action":"formulate_dots","formulation":[{"dot_key":"D-N1","count":0}, ...每个配方库短代码一条]}

回复规则：
- 先给出对话式分析（不使用标题、不使用列表，2-3句话），再附上 JSON 行。
- 引用用户真实的生物标志物/趋势数值，说明驱动因素。
- 全程使用简体中文回复，结尾干净收尾，不提问、不引导用户继续追问。`;
};
