/**
 * Health Advice Prompt — Precision Longevity Advisor for Oriental populations
 * Pure Chinese, optimised for Alibaba Qwen Plus
 */
const { getVivaLabels } = require('./subAgeLabels');
const { classifyBiomarkers, LABELS_ZH: STATUS_LABELS_ZH } = require('../../lib/biomarkerStatus');
const { getFactConstraintBlock } = require('./factConstraint');
const { getFactMemoryBlock } = require('./factMemoryBlock');

module.exports = (context) => {
  const {
    nickname, age, gender, bioAge, chronoAge,
    subAges, biomarkers, dotsByDimension, healthConditions, healthConditionsOther,
    health_twin, active_health_plans, plan_templates, current_solar_term,
  } = context;

  const labels = getVivaLabels(context.sub_age_display_names);
  const bmStatus = classifyBiomarkers(biomarkers || {});
  const statusTag = key => bmStatus[key] ? `（${STATUS_LABELS_ZH[bmStatus[key]]}）` : '';

  const hasBio = bioAge !== null && subAges && Object.keys(subAges).length > 0;

  const ageDelta = hasBio
    ? (Number(bioAge) - Number(chronoAge)).toFixed(1)
    : null;

  const bmLabelZh = { hsCRP: 'hsCRP', IL6: 'IL-6', GDF15: 'GDF-15', CD38: 'CD38', GA: '糖化白蛋白 (GA)', CystatinC: '胱抑素 C (Cystatin C)' };

  const dimDefs = [
    {
      dbKey: 'Resilience Age',
      subAgeKey: 'ResilienceAge',
      labelZh: labels.ResilienceAge,
      bmKeys: ['hsCRP', 'IL6'],
      whyZh: '慢性炎症与抗压能力',
      normalZh: 'hsCRP <1 mg/L、IL-6 <3 pg/mL',
      bmNotes: {
        hsCRP: '华人：肠道"漏"（LPS脂多糖渗入血液）是 hsCRP 升高的常见诱因，与精制碳水饮食导致的肠黏膜慢性应激密切相关。',
        IL6: '华人：肠道"漏"（LPS脂多糖渗入血液）是 IL-6 升高的常见诱因，与精制碳水饮食导致的肠黏膜慢性应激密切相关。',
      },
    },
    {
      dbKey: 'Cellular Age',
      subAgeKey: 'CellularAge',
      labelZh: labels.CellularAge,
      bmKeys: ['GDF15', 'CD38'],
      whyZh: '细胞衰老负担与NAD+消耗',
      normalZh: 'GDF-15 <750 pg/mL、CD38 ~1.0x',
      bmNotes: {
        GDF15: '高 GDF-15 信号衰老细胞负担加重，SASP毒性细胞因子向周围健康组织"传染"衰老。',
        CD38: 'CD38 随年龄升高直接耗竭 NAD+，削弱线粒体功能与DNA修复能力。',
      },
    },
    {
      dbKey: 'Metabolic Age',
      subAgeKey: 'MetabolicAge',
      labelZh: labels.MetabolicAge,
      bmKeys: ['GA'],
      whyZh: '短期血糖代谢效率',
      normalZh: 'GA <15%',
      bmNotes: {
        GA: `华人高度警惕：以精米白面为主的饮食文化使 GA 极易升高；"瘦胖体型"（BMI正常但内脏脂肪超标）在华人中极为普遍，是${labels.MetabolicAge}加速的隐形加速器。`,
      },
    },
    {
      dbKey: 'Micro-Vascular Age',
      subAgeKey: 'MicroVascularAge',
      labelZh: labels.MicroVascularAge,
      bmKeys: ['CystatinC'],
      whyZh: '毛细血管健康与营养/氧气输送',
      normalZh: 'Cystatin C <0.9 mg/L',
      bmNotes: {
        CystatinC: 'Cystatin C 升高反映毛细血管硬化与微循环受损；ApoB 脂蛋白颗粒（非 LDL 数值本身）穿透内皮氧化形成斑块是微血管老化的分子根源。',
      },
    },
  ];

  const subAgeLines = dimDefs.map(d => {
    const val = subAges?.[d.subAgeKey];
    const valStr = val != null ? `${Number(val).toFixed(1)} 岁` : '（暂无数据）';
    const relDots = (dotsByDimension[d.dbKey] || [])
      .map(dot => `${parseInt(dot.key_name.replace(/^DOT-?N?/, ''), 10)}号原粒 ${dot.name_zh || dot.name}`)
      .join(', ') || '暂无';
    const driverKeys = d.bmKeys.filter(k => bmStatus[k] === 'elevated' || bmStatus[k] === 'high');
    const normalKeys = d.bmKeys.filter(k => !driverKeys.includes(k));
    const bmZh = d.bmKeys.map(k => `${bmLabelZh[k]}${statusTag(k)}`).join('、');
    const driverNote = driverKeys.length > 0
      ? driverKeys.map(k => d.bmNotes[k]).join(' ')
      : '本维度相关生物标志物均在正常范围，暂无需特别关注的东方人群风险点。';
    const normalCaveat = normalKeys.length > 0 && driverKeys.length > 0
      ? `（${normalKeys.map(k => bmLabelZh[k]).join('、')}处于正常范围，并非本次异常的驱动因素，仅供参考，不应在分析中被描述为升高或异常）`
      : '';
    return `• ${d.labelZh}：${valStr}  [驱动因素：${bmZh}（${d.whyZh}）；正常范围：${d.normalZh}]\n  → 东方人群洞见：${driverNote}${normalCaveat}\n  → 相关原粒（推荐时请说明循证评分）：${relDots}`;
  }).join('\n\n');

  const bmLines = [
    `hsCRP: ${biomarkers.hsCRP != null ? biomarkers.hsCRP + ' mg/L' + statusTag('hsCRP') : '—'}`,
    `IL-6: ${biomarkers.IL6 != null ? biomarkers.IL6 + ' pg/mL' + statusTag('IL6') : '—'}`,
    `GDF-15: ${biomarkers.GDF15 != null ? biomarkers.GDF15 + ' pg/mL' + statusTag('GDF15') : '—'}`,
    `CD38: ${biomarkers.CD38 != null ? biomarkers.CD38 + 'x baseline' + statusTag('CD38') : '—'}`,
    `GA: ${biomarkers.GA != null ? biomarkers.GA + '%' + statusTag('GA') : '—'}`,
    `Cystatin C: ${biomarkers.CystatinC != null ? biomarkers.CystatinC + ' mg/L' + statusTag('CystatinC') : '—'}`,
  ].join('\n');

  const condStr = healthConditions.length > 0
    ? healthConditions.join('、') + (healthConditionsOther ? `（其他：${healthConditionsOther}）` : '')
    : '无';

  const bioSummaryLine = hasBio
    ? `生理年龄 ${Number(bioAge).toFixed(1)} 岁  |  实际年龄 ${chronoAge} 岁  |  差值 ${Number(ageDelta) >= 0 ? '+' : ''}${ageDelta} 岁`
    : '暂无检测数据';

  const seasonLine = current_solar_term
    ? `当前节气：${current_solar_term.name_zh}（${current_solar_term.season_zh}季 · ${current_solar_term.organ_zh}）— ${current_solar_term.theme_zh}（传统节气养生视角，非临床证据；如需关联子年龄维度，仅可关联${labels[current_solar_term.dimension]}，不得关联其他维度）`
    : null;

  const hasActivePlans = active_health_plans && active_health_plans.length > 0;
  const hasTemplates = plan_templates && plan_templates.length > 0;

  const activePlansSection = hasActivePlans
    ? `━━━ 当前健康方案 ━━━\n${active_health_plans.map(p =>
        `• ${p.plan_type === 'primary' ? '主方案' : '辅方案'}「${p.name}」— 目标：${p.goal || '—'} | 聚焦维度：${(p.target_sub_ages || []).join(', ')} | 第 ${p.weeks_elapsed}/${p.total_weeks} 周 | 已打卡 ${p.checkin_count} 次`
      ).join('\n')}`
    : '';

  const planTemplatesSection = !hasActivePlans && hasTemplates
    ? `━━━ 可选健康方案 ━━━\n${plan_templates.map(t =>
        `• 「${t.name}」— 目标：${t.goal || '—'} | 聚焦维度：${(t.target_sub_ages || []).join(', ')} | 周期：${t.duration_weeks} 周${t.desc ? ` | ${t.desc}` : ''}`
      ).join('\n')}`
    : '';

  const planTaskExtra = hasActivePlans
    ? `\n5. **方案进展关联** — 结合用户当前健康方案，说明当前生物标志物数据对方案目标的意义，以及是否在朝正确方向前进。`
    : hasTemplates
      ? `\n5. **健康方案推荐** — 用户目前尚无健康方案。根据其最薄弱的生物年龄维度，从上方"可选健康方案"中推荐1-2个最适合的方案，说明推荐理由，并告知用户可在"健康方案"页面加入。`
      : '';

  const task = `根据以下数据，为用户生成一条详细、有温度的健康分析消息。结构如下：

1. **总体状态** — 2-3句总结：生理年龄与实际年龄的对比，以及整体健康大图（积极或需关注）。如差值为正，可提及这代表生物学衰老加速，但同时强调这是完全可以逆转的。
2. **逐维度分析** — 对四个子年龄逐一分析：
   - 说明该维度的值是超前、正常还是滞后
   - 用通俗语言解释是哪些生物标志物在驱动这个结果，以及背后的生物学原理
   - 结合上方"东方人群洞见"，说明华人在该维度的特殊风险
   - 介绍1-2个相关原粒，使用顶部【事实约束】中的标准表述说明循证等级，不捏造具体研究细节
3. **生活方式关联** — 如有可穿戴数据（睡眠、HRV、步数），结合 Kino 生物标志物说明两者的关联（如睡眠不足→IL-6升高→${labels.ResilienceAge}偏高）。
4. **健康状况关联** — 如用户有申报的健康问题，结合生物标志物数据进行说明${planTaskExtra}
${seasonLine ? `\n如上方标注了当前节气，可自然融入1-2句应季养生建议（饮食、作息或情绪调节），仅作传统文化视角的补充，不得替代或凌驾于生物标志物驱动的分析之上。` : ''}
语言要温暖、有科学依据、可操作。使用 Markdown 格式。结尾干净收尾，不要提问或引导用户进行下一步操作。全程用简体中文回复。`;

  const twinLines = health_twin
    ? [
        `睡眠（近7天均值）：${health_twin.avg_sleep_hours != null ? health_twin.avg_sleep_hours.toFixed(1) + 'h' : '—'} | 深睡+REM：${health_twin.avg_deep_sleep_pct != null ? health_twin.avg_deep_sleep_pct.toFixed(0) + '%' : '—'} | 睡眠评分：${health_twin.avg_sleep_score != null ? health_twin.avg_sleep_score.toFixed(0) : '—'}`,
        `活动（近7天均值）：步数 ${health_twin.avg_daily_steps ?? '—'} | 活跃时长 ${health_twin.avg_active_minutes ?? '—'} 分钟`,
        `体征（近7天均值）：HRV ${health_twin.avg_hrv_ms != null ? health_twin.avg_hrv_ms.toFixed(0) + 'ms' : '—'} | 静息心率 ${health_twin.avg_resting_hr != null ? health_twin.avg_resting_hr.toFixed(0) + ' bpm' : '—'} | SpO₂ ${health_twin.avg_spo2 != null ? health_twin.avg_spo2.toFixed(1) + '%' : '—'}`,
        health_twin.latest_weight_kg ? `体型：体重 ${health_twin.latest_weight_kg} kg${health_twin.latest_bmi ? ' | BMI ' + health_twin.latest_bmi.toFixed(1) : ''}${health_twin.latest_body_fat_pct ? ' | 体脂率 ' + health_twin.latest_body_fat_pct.toFixed(1) + '%' : ''}` : null,
        health_twin.trend_data?.hrv_trend ? `趋势：HRV ${health_twin.trend_data.hrv_trend} | 睡眠 ${health_twin.trend_data.sleep_trend ?? '—'}` : null,
      ].filter(Boolean).join('\n')
    : '暂无可穿戴设备 / 生活方式数据。';

  return `${getFactConstraintBlock(context.essential_knowledge)}

${getFactMemoryBlock(context.user_facts)}
生物标志物的状态（正常/偏高/高）已在下方数据中直接标注，请严格使用该标注，不得自行根据数值判断状态或与之矛盾（例如：数据标注"正常"时不得称其为"升高"）。解释某维度的分数时，只能将标注为"偏高"或"高"的标志物描述为驱动因素；标注为"正常"的标志物只能简要说明其处于正常范围，不得暗示其导致或加重了该维度的异常。
东方人群相关洞见仅限于使用下方"东方人群洞见"中已提供的表述，不得在其基础上编造新的具体诱因。

你是 Viva——Aeviva 的精准长寿顾问，专为东方人群打造的精准健康生态系统的核心 AI。你在生物衰老、功能营养、炎症生物学、华人代谢特征和长寿科学领域有深厚积累。你只推荐拥有最高循证医学证据评分的干预措施。

━━━ 用户档案 ━━━
姓名：${nickname || '用户'}
年龄：${age != null ? age + ' 岁' : '未知'}
性别：${gender || '未填写'}
申报健康状况：${condStr}

━━━ 生理年龄概览 ━━━
${bioSummaryLine}
${seasonLine ? seasonLine + '\n' : ''}
${hasBio ? `子年龄、东方人群洞见与相关原粒：\n${subAgeLines}` : '用户尚未完成 Kino 生物标志物检测，无法提供个性化分析。请鼓励用户完成检测。'}

━━━ 生物标志物原始数值 ━━━
${bmLines}

━━━ 数字健康孪生（可穿戴 & 生活方式数据） ━━━
${twinLines}
${activePlansSection ? '\n' + activePlansSection + '\n' : ''}${planTemplatesSection ? '\n' + planTemplatesSection + '\n' : ''}
━━━ 你的任务 ━━━
${task}`;
};
