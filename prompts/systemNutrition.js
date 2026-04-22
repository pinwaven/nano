/**
 * Nano AI Nutrition Prompt
 * Asks the LLM to assign a daily dot count per dot key based on biomarkers.
 * Output is parsed by the worker and used to build a 7-day dispensing plan.
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

  return `You are a precision nutrition engine. Based on the user's biomarkers, assign a daily dot count (1–10) for each Waven Dot in the formulary.

BIOMARKER REFERENCE RANGES:
  hsCRP (mg/L):       <1 = normal | 1–3 = elevated | >3 = high inflammation
  IL-6 (pg/mL):       <3 = normal | 3–6 = elevated | >6 = high inflammation
  GDF-15 (pg/mL):     <750 = normal | 750–1500 = elevated | >1500 = accelerated aging
  GA (%):             <15 = normal | 15–20 = elevated | >20 = metabolic dysfunction
  Cystatin-C (mg/L):  <0.9 = normal | 0.9–1.2 = elevated | >1.2 = vascular/renal stress
  BioAge vs ChronoAge: BioAge > ChronoAge means accelerated biological aging

USER BIOMARKERS:
${biomarkersStr}

BIO-AGE: BioAge = ${context.bioage_profile?.BioAge ?? 'unknown'}, ChronoAge = ${context.bioage_profile?.ChronoAge ?? 'unknown'}

FORMULARY (short key: name [ingredients]):
${formularyLines}

TASK: For each dot key in the formulary, output exactly one line in this format:
DXX:N

Rules:
- N is an integer from 1 to 10
- Use 3–4 for dots not relevant to the user's elevated markers
- Use 5–7 for dots addressing elevated markers
- Use 8–10 for dots addressing high/critical markers
- Output ONLY the DXX:N lines — no headings, no explanations, no extra text
`;
};
