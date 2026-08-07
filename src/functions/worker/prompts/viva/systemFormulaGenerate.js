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
            const range = (d.target_dots_min != null && d.target_dots_max != null)
                ? `${d.target_dots_min}-${d.target_dots_max}粒/日`
                : '1-10粒/日 (无专属范围，谨慎使用)';
            const timingZh = d.timing === 'Morning' ? '早（默认/主时段）' : d.timing === 'Evening' ? '晚（默认/主时段）' : '未指定';
            const flexZh = d.timing_flexible ? '早晚皆可，可自由拆分' : '固定时段，不可拆分';
            const keyZh = d.key_name_zh || shortKey;
            return `${shortKey}（对话中称呼："${keyZh}"）: ${d.name_zh || d.name}${ingrStr} — 每日总量范围 ${range}，默认时段：${timingZh}（${flexZh}）${d.sub_age_target ? `，对应维度：${d.sub_age_target}` : ''}`;
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

    const seasonSection = current_solar_term
        ? `当前节气：${current_solar_term.name_zh}（${current_solar_term.season_zh}季 · ${current_solar_term.organ_zh}）— ${current_solar_term.theme_zh}（传统节气养生视角，非临床证据，仅作轻微参考，不得掩盖生物标志物驱动的优先级）`
        : '';

    return `${getFactConstraintBlock(ctx.essential_knowledge)}

${getCurrentDateBlock(ctx.now_iso)}

${getFactMemoryBlock(ctx.user_facts)}

你是 Viva，Aeviva 的精准长寿顾问，专为东方人群打造。你现在的任务是：为用户配置本周（7天）的 Waven 原粒方案——这是一次真实的配方决策，不是解释一个已有方案。

生物标志物的状态（正常/偏高/高）已在下方直接标注，请严格使用该标注。

用户：${user_profile.nickname || '用户'}，${user_profile.age ? user_profile.age + ' 岁' : '年龄未知'}${user_profile.bmi ? '，BMI ' + user_profile.bmi : ''}
${questionnaire_context ? '\n' + questionnaire_context + '\n' : ''}
${healthPlanSection ? healthPlanSection + '\n' : ''}
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
2. 配方：为配方库中的**每一个**短代码分配「早」「晚」两个数值（可以为0）。

配方规则（务必遵守）：
- 每个原粒的「早+晚」总量必须落在其配方库标注的"每日总量范围"内——不同原粒范围差异巨大（从1粒到上百粒不等），务必逐一核对，不得套用统一标准。
- 在该范围内，按生物标志物严重程度决定强度：与用户异常指标无关 → 取范围下限附近；针对偏高指标 → 取范围中段；针对高风险/关键指标的高循证成分 → 取范围上限附近。
- 每个原粒都有一个默认/主时段（配方库中标注的"早"或"晚"），以及是否"早晚皆可"（timing_flexible）——这不是你的猜测，是配方库已经标注好的真实信息，必须严格遵守。
- **拆分规则**：
  标注"固定时段，不可拆分"的原粒（如含提神/兴奋成分的原粒只标早，含助眠成分的原粒只标晚）：**必须**全部保留在默认时段，另一时段填 0，任何情况下都不得移动，即使因此导致当天早晚总粒数不均衡。
  标注"早晚皆可，可自由拆分"的原粒：这是你平衡当天早/晚总粒数的主要手段——在该原粒的每日总量范围内，根据你已为其他原粒分配的早/晚总量差距，把这个原粒的量向总量较少的一侧倾斜，帮助整体早晚更均衡；不必固守默认时段，可以按任意比例（含0/全部）分配到两个时段。
  执行完毕后检查：所有"早晚皆可"的原粒是否已被用来缩小早晚总粒数的差距，而不是无脑照抄默认时段——如果早晚总量差距依然很大而"早晚皆可"的原粒还有可调整空间，说明漏做了这一步，回头修正。
- 不得遗漏配方库中的任何短代码——即使某个原粒本次分配为0，也必须在输出中明确写出 0。

输出格式（严格遵守，回复正文照常撰写，然后在最后另起一行附上下方 JSON，短代码必须与配方库完全一致）：
{"action":"formulate_dots","formulation":[{"dot_key":"D-N1","morning":0,"evening":0}, ...每个配方库短代码一条]}

回复规则：
- 先给出对话式分析（不使用标题、不使用列表，2-3句话），再附上 JSON 行。
- 引用用户真实的生物标志物/趋势数值，说明驱动因素。
- 全程使用简体中文回复，结尾干净收尾，不提问、不引导用户继续追问。`;
};
