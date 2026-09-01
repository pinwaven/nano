/**
 * Nano AI Nutrition Prompt
 * ------------------------
 * Asks the LLM to analyze health profile and assign a daily dot count per key.
 * Output includes a brief analysis and the DXX:N formulation lines.
 */
const { classifyBiomarker, LABELS_ZH: STATUS_LABELS_ZH, LABELS_EN: STATUS_LABELS_EN } = require('../../lib/biomarkerStatus');
const { MAX_DOTS_PER_CAPSULE } = require('../../lib/dotsProductModel');
const { getFactConstraintBlock } = require('../chat/factConstraint');
const { getFactMemoryBlock } = require('../chat/factMemoryBlock');

module.exports = (context) => {
  const isZh = context.language === 'zh';

  const formularyLines = context.dots_formulary && context.dots_formulary.length > 0
    ? context.dots_formulary.map(d => {
        const ingrArr = isZh
          ? (d.ingredients_zh || d.ingredients)
          : (d.ingredients || d.ingredients_zh);
        const ingrStr = Array.isArray(ingrArr) && ingrArr.length > 0
          ? ' [' + ingrArr.map(i => `${i.name}: ${i.mg}mg`).join(', ') + ']'
          : '';
        const shortKey = d.key_name.replace(/^DOT/, 'D');
        const zhLabel = isZh && d.key_name_zh ? `（对话中称呼："${d.key_name_zh}"）` : '';
        // Each dot's intake range is its own, and they differ by more than an order of magnitude,
        // so it has to be shown per dot: one global range in the rules below is meaningless, and the
        // parse path clamps into target_dots_min/max anyway, silently discarding any guess made
        // without this. Mirrors the ［建议摄入：…］ rendering in viva/chat/nutrition.js.
        const rangeStr = (d.target_dots_min != null && d.target_dots_max != null)
          ? (d.target_dots_min === d.target_dots_max
              ? (isZh ? `［建议摄入：${d.target_dots_min}粒/日］` : ` [suggested intake: ${d.target_dots_min}/day]`)
              : (isZh ? `［建议摄入：${d.target_dots_min}–${d.target_dots_max}粒/日］` : ` [suggested intake: ${d.target_dots_min}–${d.target_dots_max}/day]`))
          : '';
        return `${shortKey}${zhLabel}: ${d.name}${d.name_zh ? ' / ' + d.name_zh : ''}${ingrStr}${rangeStr}`;
      }).join('\n')
    : 'Formulary not available.';

  const biomarkersStr = Object.entries(context.biomarkers || {})
    .map(([k, v]) => {
      const status = classifyBiomarker(k, v);
      const tag = status ? ` (${isZh ? STATUS_LABELS_ZH[status] : STATUS_LABELS_EN[status]})` : '';
      return `  ${k}: ${v}${tag}`;
    })
    .join('\n') || '  (no biomarker data available)';

  const bioage = context.bioage_profile?.BioAge ?? 'unknown';
  const chronoage = context.bioage_profile?.ChronoAge ?? 'unknown';

  if (isZh) {
    return `${getFactConstraintBlock(context.essential_knowledge, true)}

${getFactMemoryBlock(context.user_facts, true)}

你是一台精密营养引擎。请根据用户的生物标志物和生理年龄，分析其健康状况，并为每种 Waven Dot 分配每日摄入数量。

生物标志物参考范围：
  hsCRP (mg/L):       <1 = 正常 | 1–3 = 偏高 | >3 = 高炎症风险
  IL-6 (pg/mL):       <3 = 正常 | 3–6 = 偏高 | >6 = 高炎症风险
  GDF-15 (pg/mL):     <750 = 正常 | 750–1500 = 偏高 | >1500 = 细胞衰老加速
  GA (%):             <15 = 正常 | 15–20 = 偏高 | >20 = 代谢功能障碍
  Cystatin-C (mg/L):  <0.9 = 正常 | 0.9–1.2 = 偏高 | >1.2 = 血管/肾脏压力
  CD38 (x baseline):  <1.3 = 正常 | 1.3–1.7 = 偏高 | >1.7 = 高（NAD+消耗加速）
  BioAge vs ChronoAge: BioAge > ChronoAge 表示生物学衰老加速

生物标志物的状态（正常/偏高/高）已在下方"用户数据"中直接标注，请严格使用该标注，不得自行根据数值判断状态或与之矛盾。

用户数据：
  生物标志物：
${biomarkersStr}
  年龄：BioAge = ${bioage}, ChronoAge = ${chronoage}

配方库 (短代码: 名称 [成分]):
${formularyLines}

任务：
1. 分析 (Analysis): 用两三句话简要说明基于上述数据的核心健康洞察。提及 Dot 时使用配方库中标注的"对话中称呼"（如"原粒1号"）或名称，**不要**说出内部短代码（如"D-N1"）。
2. 配方 (Formulation): 为配方库中的每个短代码分配每日数量，数值必须落在该短代码自己标注的"建议摄入"区间内。

输出格式 (必须严格遵守，短代码必须与上方配方库中出现的完全一致，如 D-N1、D-N2)：
ANALYSIS: [你的简短分析]
FORMULATION:
D-N1:N
D-N2:N
... (以此类推)

规则：
- N 必须是整数，且必须落在上方配方库中该短代码自己标注的"建议摄入"区间内（含端点）。
- 各短代码的区间差异极大（有的仅个位数，有的高达数十粒/日），必须逐一核对上方配方库中该短代码自己标注的区间，不得套用统一数值，也不得默认使用个位数。
- 用量强度通过"在该短代码自己区间内的相对位置"表达，而非绝对数值：
  · 与用户异常指标无关的 Dot：取该区间的低端（约区间起点上方 1/4 处）。
  · 针对用户偏高指标的 Dot：取该区间的中段。
  · 针对高风险或关键指标的 Dot：取该区间的高端（约区间起点上方 3/4 处）。
- 全天总量上限：早、晚各一粒胶囊，每粒最多 ${MAX_DOTS_PER_CAPSULE} 颗原粒，全天合计不超过 ${MAX_DOTS_PER_CAPSULE * 2} 颗。这是硬性物理上限。
- 若按上述相对位置分配后总量超出该上限，必须做取舍：把与用户异常指标无关的原粒压到其区间下限，将额度让给针对用户异常指标的原粒。不要为了凑总量而把所有原粒一起等比例下调。
- 必须包含配方库中列出的所有 DXX 代码。
`;
  } else {
    return `${getFactConstraintBlock(context.essential_knowledge, false)}

${getFactMemoryBlock(context.user_facts, false)}

You are a precision nutrition engine. Based on the user's biomarkers and BioAge, analyze their health profile and assign a daily dot count for each Waven Dot, within that dot's own suggested intake range.

BIOMARKER REFERENCE RANGES:
  hsCRP (mg/L):       <1 = normal | 1–3 = elevated | >3 = high inflammation
  IL-6 (pg/mL):       <3 = normal | 3–6 = elevated | >6 = high inflammation
  GDF-15 (pg/mL):     <750 = normal | 750–1500 = elevated | >1500 = accelerated aging
  GA (%):             <15 = normal | 15–20 = elevated | >20 = metabolic dysfunction
  Cystatin-C (mg/L):  <0.9 = normal | 0.9–1.2 = elevated | >1.2 = vascular/renal stress
  CD38 (x baseline):  <1.3 = normal | 1.3–1.7 = elevated | >1.7 = high (accelerated NAD+ depletion)
  BioAge vs ChronoAge: BioAge > ChronoAge means accelerated biological aging

Biomarker status (normal/elevated/high) is already labeled directly in USER DATA below — use that label as-is; do not judge status from the raw value yourself or contradict the given label.

USER DATA:
  Biomarkers:
${biomarkersStr}
  Age: BioAge = ${bioage}, ChronoAge = ${chronoage}

FORMULARY (short key: name [ingredients]):
${formularyLines}

TASK:
1. Analysis: Provide a 2-3 sentence summary of core health insights based on the data.
2. Formulation: Assign a daily count for every dot key in the formulary, inside that key's own suggested intake range.

OUTPUT FORMAT (strictly follow this — short keys MUST match the formulary above exactly, e.g. D-N1, D-N2):
ANALYSIS: [Your brief analysis]
FORMULATION:
D-N1:N
D-N2:N
... (etc.)

Rules:
- N must be an integer inside that short key's own "suggested intake" range shown in the formulary above (endpoints included).
- Ranges differ enormously between dots — some are single digits, others run to dozens per day. Check each dot's own range in the formulary above individually; never reuse one number across dots, and never default to single digits.
- Express intensity as a RELATIVE POSITION within that dot's own range, not as an absolute number:
  - Dots not relevant to the user's elevated markers: the low end of that range (~1/4 of the way up).
  - Dots addressing elevated markers: the middle of that range.
  - Dots addressing high/critical markers: the high end of that range (~3/4 of the way up).
- TOTAL BUDGET: one morning capsule and one evening capsule, each holding at most ${MAX_DOTS_PER_CAPSULE} dots — ${MAX_DOTS_PER_CAPSULE * 2} per day in total. This is a hard physical limit.
- If your allocation exceeds that budget you MUST prioritize: push every dot unrelated to the user's elevated markers down to the low end of its range and give the headroom to the dots that address those markers. Do NOT scale every dot down uniformly to make it fit.
- You MUST include all DXX codes listed in the formulary.
`;
  }
};
