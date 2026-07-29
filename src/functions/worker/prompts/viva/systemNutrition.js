/**
 * Viva AI Nutrition Prompt — Precision Longevity Advisor for Oriental populations
 * Pure Chinese, optimised for Alibaba Qwen Plus
 */
const { getVivaLabels } = require('./subAgeLabels');
const { classifyBiomarker, LABELS_ZH: STATUS_LABELS_ZH } = require('../../lib/biomarkerStatus');
const { getFactConstraintBlock } = require('./factConstraint');
const { getFactMemoryBlock } = require('./factMemoryBlock');

module.exports = (context) => {
  const formularyLines = context.dots_formulary && context.dots_formulary.length > 0
    ? context.dots_formulary.map(d => {
        const ingrArr = d.ingredients_zh || d.ingredients;
        const ingrStr = Array.isArray(ingrArr) && ingrArr.length > 0
          ? ' [' + ingrArr.map(i => `${i.name}: ${i.mg}mg`).join(', ') + ']'
          : '';
        const shortKey = d.key_name.replace(/^DOT/, 'D');
        return `${shortKey}: ${d.name_zh || d.name}${ingrStr}`;
      }).join('\n')
    : '配方库暂不可用。';

  const biomarkersStr = Object.entries(context.biomarkers || {})
    .map(([k, v]) => {
      const status = classifyBiomarker(k, v);
      return `  ${k}: ${v}${status ? `（${STATUS_LABELS_ZH[status]}）` : ''}`;
    })
    .join('\n') || '  （暂无生物标志物数据）';

  const bioage = context.bioage_profile?.BioAge ?? '未知';
  const chronoage = context.bioage_profile?.ChronoAge ?? '未知';

  const term = context.current_solar_term;
  const labels = getVivaLabels(context.sub_age_display_names);
  const seasonSection = term
    ? `当前节气：${term.name_zh}（${term.season_zh}季 · ${term.organ_zh}）
  节气养生主题：${term.theme_zh}
  这是传统节气养生文化视角，非临床证据，仅供参考。\n\n`
    : '';
  const seasonDimensionZh = term ? labels[term.dimension] : null;
  const seasonRule = term
    ? `- 节气调节规则（严格执行）：先仅依据"生物标志物参考范围"与上方规则，为每个原粒确定一个基础计数（此为"生物标志物基线"）。节气仅允许在此基线基础上，对与当前节气相关维度（${seasonDimensionZh}）直接对应的原粒，额外 +1（不得更多，不得对其他维度的原粒调整）。除此之外，最终计数必须等于生物标志物基线。\n  示例：若某原粒的生物标志物基线为 4，且属于${seasonDimensionZh}维度，节气调节后最多为 5；若不属于${seasonDimensionZh}维度，则必须保持为 4，不受节气影响。\n  在 ANALYSIS 中，若对任何原粒应用了节气调节，须明确写出"该原粒生物标志物基线为 X，因节气调整为 X+1"；未说明理由的调整视为违规。\n`
    : '';

  return `${getFactConstraintBlock(context.essential_knowledge)}

${getFactMemoryBlock(context.user_facts)}
生物标志物的状态（正常/偏高/高）已在下方"用户数据"中直接标注，请严格使用该标注，不得自行根据数值判断状态或与之矛盾。

你是一台专为东方人群设计的精密营养引擎，依托最高循证医学证据标准运作。请根据用户的生物标志物和生理年龄，分析其健康状况，并为每种 Waven 原粒分配每日摄入数量。

生物标志物参考范围：
  hsCRP (mg/L):       <1 = 正常 | 1–3 = 偏高 | >3 = 高炎症风险
  IL-6 (pg/mL):       <3 = 正常 | 3–6 = 偏高 | >6 = 高炎症风险
  GDF-15 (pg/mL):     <750 = 正常 | 750–1500 = 偏高 | >1500 = 细胞衰老加速
  GA (%):             <15 = 正常 | 15–20 = 偏高 | >20 = 代谢功能障碍
  Cystatin-C (mg/L):  <0.9 = 正常 | 0.9–1.2 = 偏高 | >1.2 = 血管/肾脏压力
  CD38 (x baseline):  <1.3 = 正常 | 1.3–1.7 = 偏高 | >1.7 = 高（NAD+消耗加速）
  BioAge vs ChronoAge: BioAge > ChronoAge 表示生物学衰老加速

东方人群特殊注意：
  GA 偏高时，优先考虑精制碳水饮食背景（进食顺序干预 + 配方库中 AMPK 激活/代谢相关原粒）
  hsCRP/IL-6 偏高时，关注肠道"漏"（LPS→血液→全身炎症）作为华人常见诱因
  BMI 正常但存在代谢指标偏高时，警惕东亚"瘦胖体型"内脏脂肪蓄积

${seasonSection}用户数据：
  生物标志物：
${biomarkersStr}
  年龄：BioAge = ${bioage}, ChronoAge = ${chronoage}

配方库 (短代码: 名称 [成分]):
${formularyLines}

任务：
1. 分析 (Analysis): 用两三句话简要说明核心健康洞察。如发现东亚代谢特征（如 GA 偏高），主动关联东方人群膳食背景（精制碳水文化、内脏脂肪代谢悖论）。
2. 配方 (Formulation): 为配方库中的每个短代码分配每日数量 (1-10)。优先为拥有最高循证评分的成分（如尿石素A、高活性姜黄素、甘氨酸镁）给予合理高权重。

输出格式 (必须严格遵守):
ANALYSIS: [你的简短分析]
FORMULATION:
D01:N
D02:N
... (以此类推)

规则：
- N 是 1 到 10 之间的整数。
- 对与用户异常指标无关的原粒，使用 3-4 作为基础量。
- 对针对用户偏高指标的原粒，使用 5-7。
- 对针对高风险或关键指标的高循证成分原粒，使用 8-10。
- 必须包含配方库中列出的所有 DXX 代码。
${seasonRule}`;
};
