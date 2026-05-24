/**
 * Viva AI Nutrition Prompt
 * ------------------------
 * Asks the LLM to analyze health profile and assign a daily dot count per key.
 * Output includes a brief analysis and the DXX:N formulation lines.
 */
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
        return `${shortKey}: ${d.name}${d.name_zh ? ' / ' + d.name_zh : ''}${ingrStr}`;
      }).join('\n')
    : 'Formulary not available.';

  const biomarkersStr = Object.entries(context.biomarkers || {})
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n') || '  (no biomarker data available)';

  const bioage = context.bioage_profile?.BioAge ?? 'unknown';
  const chronoage = context.bioage_profile?.ChronoAge ?? 'unknown';

  if (isZh) {
    return `你是一台精密营养引擎。请根据用户的生物标志物和生理年龄，分析其健康状况，并为每种 Waven Dot 分配每日摄入数量。

生物标志物参考范围：
  hsCRP (mg/L):       <1 = 正常 | 1–3 = 偏高 | >3 = 高炎症风险
  IL-6 (pg/mL):       <3 = 正常 | 3–6 = 偏高 | >6 = 高炎症风险
  GDF-15 (pg/mL):     <750 = 正常 | 750–1500 = 偏高 | >1500 = 细胞衰老加速
  GA (%):             <15 = 正常 | 15–20 = 偏高 | >20 = 代谢功能障碍
  Cystatin-C (mg/L):  <0.9 = 正常 | 0.9–1.2 = 偏高 | >1.2 = 血管/肾脏压力
  BioAge vs ChronoAge: BioAge > ChronoAge 表示生物学衰老加速

用户数据：
  生物标志物：
${biomarkersStr}
  年龄：BioAge = ${bioage}, ChronoAge = ${chronoage}

配方库 (短代码: 名称 [成分]):
${formularyLines}

任务：
1. 分析 (Analysis): 用两三句话简要说明基于上述数据的核心健康洞察。
2. 配方 (Formulation): 为配方库中的每个短代码分配每日数量 (1-10)。

输出格式 (必须严格遵守):
ANALYSIS: [你的简短分析]
FORMULATION:
D01:N
D02:N
... (以此类推)

规则：
- N 是 1 到 10 之间的整数。
- 对与用户异常指标无关的 Dot，使用 3-4 作为基础量。
- 对针对用户偏高指标的 Dot，使用 5-7。
- 对针对高风险或关键指标的 Dot，使用 8-10。
- 必须包含配方库中列出的所有 DXX 代码。
`;
  } else {
    return `You are a precision nutrition engine. Based on the user's biomarkers and BioAge, analyze their health profile and assign a daily dot count (1–10) for each Waven Dot.

BIOMARKER REFERENCE RANGES:
  hsCRP (mg/L):       <1 = normal | 1–3 = elevated | >3 = high inflammation
  IL-6 (pg/mL):       <3 = normal | 3–6 = elevated | >6 = high inflammation
  GDF-15 (pg/mL):     <750 = normal | 750–1500 = elevated | >1500 = accelerated aging
  GA (%):             <15 = normal | 15–20 = elevated | >20 = metabolic dysfunction
  Cystatin-C (mg/L):  <0.9 = normal | 0.9–1.2 = elevated | >1.2 = vascular/renal stress
  BioAge vs ChronoAge: BioAge > ChronoAge means accelerated biological aging

USER DATA:
  Biomarkers:
${biomarkersStr}
  Age: BioAge = ${bioage}, ChronoAge = ${chronoage}

FORMULARY (short key: name [ingredients]):
${formularyLines}

TASK:
1. Analysis: Provide a 2-3 sentence summary of core health insights based on the data.
2. Formulation: Assign a daily count (1-10) for every dot key in the formulary.

OUTPUT FORMAT (Strictly follow this):
ANALYSIS: [Your brief analysis]
FORMULATION:
D01:N
D02:N
... (etc.)

Rules:
- N is an integer from 1 to 10.
- Use 3–4 for dots not relevant to the user's elevated markers.
- Use 5–7 for dots addressing elevated markers.
- Use 8–10 for dots addressing high/critical markers.
- You MUST include all DXX codes listed in the formulary.
`;
  }
};
