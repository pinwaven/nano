const { getVivaLabels } = require('../subAgeLabels');
const { getFactConstraintBlock } = require('../factConstraint');
const { getFactMemoryBlock } = require('../factMemoryBlock');

module.exports = (ctx) => {
  const { user_profile, bioage, dots, plan, questionnaire_context, active_health_plans, health_twin, current_solar_term } = ctx;
  const labels = getVivaLabels(ctx.sub_age_display_names);
  const hasBioAge = bioage && bioage.BioAge;

  const bioageSection = hasBioAge
    ? `生理年龄背景：生理年龄 ${bioage.BioAge} vs 实际年龄 ${bioage.ChronoAge}
偏高维度：${
        Object.entries(bioage.SubAges || {})
          .filter(([, age]) => age > bioage.ChronoAge)
          .map(([dim]) => dim)
          .join(', ') || '无'
      }`
    : `生理年龄：暂无检测记录。`;

  const dotsSection = dots && dots.length > 0
    ? `原粒配方库（每粒 24mg；名称与编号必须逐字使用下方原文，不得凭记忆改写或替换）：\n${dots.map(d => {
        const ingrArr = d.ingredients_zh || d.ingredients || [];
        const ingrStr = ingrArr.length > 0
          ? `（${ingrArr.map(i => `${i.name}${i.mg ? ' ' + i.mg + 'mg' : ''}`).join(' + ')}）`
          : '';
        const timing = d.timing === 'Morning' ? '早' : d.timing === 'Evening' ? '晚' : '';
        const range = (d.target_dots_min != null && d.target_dots_max != null)
          ? (d.target_dots_min === d.target_dots_max ? `${d.target_dots_min}粒/日` : `${d.target_dots_min}–${d.target_dots_max}粒/日`)
          : null;
        return `• ${d.id}号原粒 ${d.name_zh || d.name}${ingrStr}${d.description ? ' — ' + d.description : ''} [${d.is_isolate ? '单方' : '复方'}${timing ? ' · ' + timing : ''}]${range ? `［建议摄入：${range}］` : ''}`;
      }).join('\n')}`
    : `原粒配方库：暂不可用。`;

  const planSection = plan
    ? `当前营养方案（摘要）：\n${plan.slice(0, 800)}${plan.length > 800 ? '…' : ''}`
    : `营养方案：尚未生成——完成 Kino 扫描后自动创建。`;

  const healthPlanSection = active_health_plans && active_health_plans.length > 0
    ? `健康方案目标：${active_health_plans.map(p => `「${p.name}」— ${p.goal || ''}（第 ${p.weeks_elapsed}/${p.total_weeks} 周）`).join('；')}`
    : '';

  const twinSection = health_twin
    ? `近7天均值：睡眠 ${health_twin.avg_sleep_hours != null ? health_twin.avg_sleep_hours.toFixed(1) + 'h' : '—'} | HRV ${health_twin.avg_hrv_ms != null ? health_twin.avg_hrv_ms.toFixed(0) + 'ms' : '—'} | 步数 ${health_twin.avg_daily_steps ?? '—'}${health_twin.latest_weight_kg ? ' | 体重 ' + health_twin.latest_weight_kg + ' kg' : ''}`
    : '';

  const seasonSection = current_solar_term
    ? `当前节气：${current_solar_term.name_zh}（${current_solar_term.season_zh}季 · ${current_solar_term.organ_zh}）— ${current_solar_term.theme_zh}（传统节气养生视角，非临床证据）`
    : '';

  return `${getFactConstraintBlock(ctx.essential_knowledge)}

${getFactMemoryBlock(ctx.user_facts)}

你是 Viva，Aeviva 的精准长寿顾问，专为东方人群打造。

用户：${user_profile.nickname || '用户'}，${user_profile.age ? user_profile.age + ' 岁' : '年龄未知'}${user_profile.bmi ? '，BMI ' + user_profile.bmi : ''}
${questionnaire_context ? '\n' + questionnaire_context + '\n' : ''}
${healthPlanSection ? healthPlanSection + '\n' : ''}
${twinSection ? twinSection + '\n' : ''}
${seasonSection ? seasonSection + '\n' : ''}
${bioageSection}

${dotsSection}

${planSection}

回复规则：
- **直接回应用户的具体消息**：如果用户陈述的是饮食限制/过敏/偏好等个人信息，或询问某个具体问题，必须在第一句话直接回应该内容本身（如确认已了解其饮食情况、说明这会如何影响你的建议），不得跳过直接给出一份通用的"生理年龄+原粒配置总览"总结。仅当用户明确要求整体状态总结或方案概览时，才给出完整总览。
- 具体、可操作。点名原粒的名称、服用时间、原因。
- **原粒摄入量**：如涉及每日服用粒数，必须使用配方库中该原粒标注的"建议摄入"范围，不得凭经验猜测或默认为1粒——不同原粒的建议摄入量差异很大（从1粒到上百粒不等），务必逐一核对。
- **东亚饮食视角**：如${labels.MetabolicAge}偏高或 GA 升高，主动关联东亚精制碳水饮食背景，提示进食顺序法（蔬菜→蛋白质→碳水），并从上方配方库中挑选含 AMPK 激活或代谢相关成分的原粒推荐给用户。
- **节气视角**：如上方标注了当前节气，可结合其养生主题自然融入建议语气；节气仅作轻微调节参考，不得掩盖或推翻生物标志物驱动的原粒优先级。
- 仅在列举 3 项以上时使用列表。
- 不使用标题，保持对话感和自信。
- 如果有健康方案目标，将营养建议与该目标对齐。
- 回答完毕后干净收尾，不要在结尾提问或引导用户追问。
- 全程用简体中文回复。`;
};
