/**
 * Health Advice Prompt
 * Generates a structured, personalized health analysis with dot recommendations.
 * Called by handlePostHealthAdvice — context includes all 4 sub-ages + relevant dots.
 */
module.exports = (context) => {
  const {
    isZh, nickname, age, gender, bioAge, chronoAge,
    subAges, biomarkers, dotsByDimension, healthConditions, healthConditionsOther,
    active_health_plans,
  } = context;

  const hasBio = bioAge !== null && subAges && Object.keys(subAges).length > 0;

  const ageDelta = hasBio
    ? (Number(bioAge) - Number(chronoAge)).toFixed(1)
    : null;

  const dimDefs = [
    {
      dbKey: 'Resilience Age',
      subAgeKey: 'ResilienceAge',
      labelZh: '抗压年龄',
      labelEn: 'Resilience Age',
      bmZh: 'hsCRP、IL-6',
      bmEn: 'hsCRP, IL-6',
      whyZh: '慢性炎症与抗压能力',
      whyEn: 'chronic inflammation & stress buffering capacity',
      normalZh: 'hsCRP <1 mg/L、IL-6 <3 pg/mL',
      normalEn: 'hsCRP <1 mg/L, IL-6 <3 pg/mL',
    },
    {
      dbKey: 'Cellular Age',
      subAgeKey: 'CellularAge',
      labelZh: '细胞年龄',
      labelEn: 'Cellular Age',
      bmZh: 'GDF-15、CD38',
      bmEn: 'GDF-15, CD38',
      whyZh: '细胞衰老负担与NAD+消耗',
      whyEn: 'cellular senescence burden & NAD+ depletion',
      normalZh: 'GDF-15 <750 pg/mL、CD38 ~1.0x',
      normalEn: 'GDF-15 <750 pg/mL, CD38 ~1.0x baseline',
    },
    {
      dbKey: 'Metabolic Age',
      subAgeKey: 'MetabolicAge',
      labelZh: '代谢年龄',
      labelEn: 'Metabolic Age',
      bmZh: '糖化白蛋白 (GA)',
      bmEn: 'Glycated Albumin (GA)',
      whyZh: '短期血糖代谢效率',
      whyEn: 'short-term glucose metabolism efficiency',
      normalZh: 'GA <15%',
      normalEn: 'GA <15%',
    },
    {
      dbKey: 'Micro-Vascular Age',
      subAgeKey: 'MicroVascularAge',
      labelZh: '微血管年龄',
      labelEn: 'Micro-Vascular Age',
      bmZh: '胱抑素 C (Cystatin C)',
      bmEn: 'Cystatin C',
      whyZh: '毛细血管健康与营养/氧气输送',
      whyEn: 'capillary health & nutrient/oxygen delivery',
      normalZh: 'Cystatin C <0.9 mg/L',
      normalEn: 'Cystatin C <0.9 mg/L',
    },
  ];

  const subAgeLines = dimDefs.map(d => {
    const val = subAges?.[d.subAgeKey];
    const valStr = val != null ? `${Number(val).toFixed(1)} yrs` : (isZh ? '（暂无数据）' : '(no data)');
    const relDots = (dotsByDimension[d.dbKey] || [])
      .map(dot => `${dot.key_name}: ${isZh ? (dot.name_zh || dot.name) : dot.name}`)
      .join(', ') || (isZh ? '暂无' : 'none');
    return isZh
      ? `• ${d.labelZh}：${valStr}  [驱动因素：${d.bmZh}（${d.whyZh}）；正常范围：${d.normalZh}]\n  → 相关 Dots：${relDots}`
      : `• ${d.labelEn}: ${valStr}  [driven by ${d.bmEn} (${d.whyEn}); normal: ${d.normalEn}]\n  → Relevant Dots: ${relDots}`;
  }).join('\n\n');

  const bmLines = [
    `hsCRP: ${biomarkers.hsCRP != null ? biomarkers.hsCRP + ' mg/L' : '—'}`,
    `IL-6: ${biomarkers.IL6 != null ? biomarkers.IL6 + ' pg/mL' : '—'}`,
    `GDF-15: ${biomarkers.GDF15 != null ? biomarkers.GDF15 + ' pg/mL' : '—'}`,
    `CD38: ${biomarkers.CD38 != null ? biomarkers.CD38 + 'x baseline' : '—'}`,
    `GA: ${biomarkers.GA != null ? biomarkers.GA + '%' : '—'}`,
    `Cystatin C: ${biomarkers.CystatinC != null ? biomarkers.CystatinC + ' mg/L' : '—'}`,
  ].join('\n');

  const condStr = healthConditions.length > 0
    ? healthConditions.join(', ') + (healthConditionsOther ? ` (other: ${healthConditionsOther})` : '')
    : (isZh ? '无' : 'none reported');

  const bioSummaryLine = hasBio
    ? (isZh
      ? `生理年龄 ${Number(bioAge).toFixed(1)} 岁  |  实际年龄 ${chronoAge} 岁  |  差值 ${Number(ageDelta) >= 0 ? '+' : ''}${ageDelta} 岁`
      : `BioAge: ${Number(bioAge).toFixed(1)} yrs  |  ChronoAge: ${chronoAge} yrs  |  Δ: ${Number(ageDelta) >= 0 ? '+' : ''}${ageDelta} yrs`)
    : (isZh ? '暂无检测数据' : 'No biomarker test completed yet');

  const dimListZh = '① 抗压年龄  ② 细胞年龄  ③ 代谢年龄  ④ 微血管年龄';
  const dimListEn = '① Resilience Age  ② Cellular Age  ③ Metabolic Age  ④ Micro-Vascular Age';

  const activePlansSection = active_health_plans && active_health_plans.length > 0
    ? (isZh
        ? `━━━ 当前健康方案 ━━━\n${active_health_plans.map(p =>
            `• ${p.plan_type === 'primary' ? '主方案' : '辅方案'}「${p.name}」— 目标：${p.goal || '—'} | 聚焦维度：${(p.target_sub_ages || []).join(', ')} | 第 ${p.weeks_elapsed}/${p.total_weeks} 周 | 已打卡 ${p.checkin_count} 次`
          ).join('\n')}`
        : `━━━ ACTIVE HEALTH PLANS ━━━\n${active_health_plans.map(p =>
            `• ${p.plan_type === 'primary' ? 'Primary' : 'Secondary'}: "${p.name}" — Goal: ${p.goal || '—'} | Targets: ${(p.target_sub_ages || []).join(', ')} | Week ${p.weeks_elapsed}/${p.total_weeks} | ${p.checkin_count} check-ins`
          ).join('\n')}`)
    : '';

  const planTaskZhExtra = active_health_plans && active_health_plans.length > 0
    ? `\n5. **方案进展关联** — 结合用户当前健康方案，说明当前生物标志物数据对方案目标的意义，以及是否在朝正确方向前进。`
    : '';

  const planTaskEnExtra = active_health_plans && active_health_plans.length > 0
    ? `\n5. **Plan Alignment** — Relate the biomarker findings to the user's active health plan(s): are they on track toward their goal? Which target dimensions need the most attention right now?`
    : '';

  const taskZh = `根据以下数据，为用户生成一条详细、有温度的健康分析消息。结构如下：

1. **总体状态** — 2-3句总结：生理年龄与实际年龄的对比，以及整体健康大图（积极或需关注）。
2. **逐维度分析** — 对四个子年龄逐一分析：
   - 说明该维度的值是超前、正常还是滞后
   - 用通俗语言解释是哪些生物标志物在驱动这个结果，以及背后的生物学原理
   - 介绍1-2个相关 Dots，简述其作用机制
3. **健康状况关联** — 如用户有申报的健康问题，结合生物标志物数据进行说明
4. **下一步提问** — 结尾提问："您最想先从哪个方面开始改善？"并列出四个维度选项（${dimListZh}）。告知用户选择后，你会帮他们决定具体应该购买哪些 Dots 开始。${planTaskZhExtra}

语言要温暖、有科学依据、可操作。使用 Markdown 格式。全程用简体中文回复。`;

  const taskEn = `Based on the data below, generate a detailed, warm health analysis message for the user. Structure it as follows:

1. **Overall Status** — 2–3 sentences summarizing their biological age vs. chronological age and the big picture (positive or concerning).
2. **Dimension-by-Dimension Breakdown** — For each of the 4 sub-ages:
   - State whether the value is ahead, on-track, or lagging
   - Explain in plain language which biomarkers are driving it and the underlying biology
   - Name 1–2 relevant Dots and briefly explain what they do
3. **Health Conditions Connection** — If the user has declared health conditions, connect them to the biomarker findings
4. **Next Step Question** — End by asking: "Which area would you like to focus on and improve first?" and list the 4 dimensions as options (${dimListEn}). Tell them that once they choose, you'll help them decide exactly which Dots to start with.${planTaskEnExtra}

Keep it warm, evidence-based, and actionable. Use Markdown formatting. Write in English.`;

  return `You are Nano — a warm, expert longevity AI built by Waven. You have deep expertise in biological aging, functional nutrition, inflammation biology, and longevity science.

━━━ USER PROFILE ━━━
Name: ${nickname || 'the user'}
Age: ${age != null ? age + ' years old' : 'unknown'}
Gender: ${gender || 'not specified'}
Declared health conditions: ${condStr}

━━━ BIOLOGICAL AGE OVERVIEW ━━━
${bioSummaryLine}

${hasBio ? `SUB-AGES & RELEVANT DOTS:\n${subAgeLines}` : (isZh ? '用户尚未完成 Kino 生物标志物检测，无法提供个性化分析。请鼓励用户完成检测。' : 'The user has not completed a Kino biomarker test yet. Encourage them to do their first scan for personalized analysis.')}

━━━ RAW BIOMARKER VALUES ━━━
${bmLines}
${activePlansSection ? '\n' + activePlansSection + '\n' : ''}
━━━ YOUR TASK ━━━
${isZh ? taskZh : taskEn}`;
};
