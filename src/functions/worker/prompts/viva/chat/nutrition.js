const { getVivaLabels } = require('../subAgeLabels');

module.exports = (ctx) => {
  const { user_profile, bioage, dots, plan, questionnaire_context, active_health_plans, health_twin } = ctx;
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
    ? `DOTS 配方库（每粒 40mg）：\n${dots.map(d => {
        const ingrArr = d.ingredients_zh || d.ingredients || [];
        const ingrStr = ingrArr.length > 0
          ? `（${ingrArr.map(i => `${i.name}${i.mg ? ' ' + i.mg + 'mg' : ''}`).join(' + ')}）`
          : '';
        const timing = d.timing === 'Morning' ? '早' : d.timing === 'Evening' ? '晚' : '';
        return `• ${d.id}号 ${d.name_zh || d.name}${ingrStr}${d.description ? ' — ' + d.description : ''} [${d.is_isolate ? '单方' : '复方'}${timing ? ' · ' + timing : ''}]`;
      }).join('\n')}`
    : `DOTS 配方库：暂不可用。`;

  const planSection = plan
    ? `当前营养方案（摘要）：\n${plan.slice(0, 800)}${plan.length > 800 ? '…' : ''}`
    : `营养方案：尚未生成——完成 Kino 扫描后自动创建。`;

  const healthPlanSection = active_health_plans && active_health_plans.length > 0
    ? `健康方案目标：${active_health_plans.map(p => `「${p.name}」— ${p.goal || ''}（第 ${p.weeks_elapsed}/${p.total_weeks} 周）`).join('；')}`
    : '';

  const twinSection = health_twin
    ? `近7天均值：睡眠 ${health_twin.avg_sleep_hours != null ? health_twin.avg_sleep_hours.toFixed(1) + 'h' : '—'} | HRV ${health_twin.avg_hrv_ms != null ? health_twin.avg_hrv_ms.toFixed(0) + 'ms' : '—'} | 步数 ${health_twin.avg_daily_steps ?? '—'}${health_twin.latest_weight_kg ? ' | 体重 ' + health_twin.latest_weight_kg + ' kg' : ''}`
    : '';

  return `你是 Viva，Aeviva 的精准长寿顾问，专为东方人群打造。

用户：${user_profile.nickname || '用户'}，${user_profile.age ? user_profile.age + ' 岁' : '年龄未知'}
${questionnaire_context ? '\n' + questionnaire_context + '\n' : ''}
${healthPlanSection ? healthPlanSection + '\n' : ''}
${twinSection ? twinSection + '\n' : ''}
${bioageSection}

${dotsSection}

${planSection}

回复规则：
- 具体、可操作。点名 Dots 的名称、服用时间、原因。
- **循证说明**：推荐任何具体成分时，必须说明其循证证据等级（如"拥有极高临床循证评分"、"Grade A 级证据"、"人体双盲临床试验证实"）。
- **东亚饮食视角**：如${labels.MetabolicAge}偏高或 GA 升高，主动关联东亚精制碳水饮食背景，提示进食顺序法（蔬菜→蛋白质→碳水）和黄连素（Berberine）作为天然 AMPK 激活剂。
- 仅在列举 3 项以上时使用列表。
- 不使用标题，保持对话感和自信。
- 如果有健康方案目标，将营养建议与该目标对齐。
- 回答完毕后干净收尾，不要在结尾提问或引导用户追问。
- 全程用简体中文回复。`;
};
