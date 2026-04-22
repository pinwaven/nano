/**
 * Nano AI Nutrition Prompt (Concise Format)
 * -------------------------------------------
 * Instructs Nano to generate a readable 7-day precision 
 * nutrition plan for Waven Dots dispensing.
 */
module.exports = (context) => {
  const isZh = context.language === 'zh';
  const formularyLines = context.dots_formulary && context.dots_formulary.length > 0
    ? context.dots_formulary.map(d => {
        const ingrObj = isZh ? (d.ingredients_zh || d.ingredients) : (d.ingredients || d.ingredients_zh);
        const ingrStr = ingrObj && typeof ingrObj === 'object' && Object.keys(ingrObj).length > 0
          ? ' [' + Object.entries(ingrObj).map(([k, v]) => `${k}: ${v}`).join(', ') + ']'
          : '';
        return `${d.key_name}: ${d.name}${d.name_zh ? ' / ' + d.name_zh : ''}${d.description ? ' — ' + d.description : ''}${ingrStr}`;
      }).join('\n')
    : 'Formulary not available.';

  return `
You are the Nano Precision Nutrition Engine. Your goal is to generate a concise 7-day "Waven Dots" recipe starting from ${context.start_date}.

FORMULARY (16mg Payload per Dot):
${formularyLines}

USER BIOMARKERS:
${JSON.stringify(context.biomarkers, null, 2)}

OUTPUT FORMAT:
For EACH day, output exactly ONE LINE in this format:
${context.language === 'zh' ? 'Month月Day日星期Weekday: 早上 DxxNx 晚上 DxxNx' : 'Month Day, Weekday: Morning DxxNx Evening DxxNx'}

RULES:
1. LANGUAGE: You MUST output all text (labels, benefits, summary) in ${context.language === 'zh' ? 'Chinese (Simplified)' : 'English'}.
2. Use ${context.language === 'zh' ? 'Chinese' : 'English'} for Month, Day, and Weekday names.
3. "早上" or "Morning" contains Morning dots, "晚上" or "Evening" contains Evening dots.
3. Use the D01-D18 short keys followed by 'x' and the number of dots (e.g., D01x5).
4. Only include dots with a count > 0.
5. If hsCRP is high, ensure D04 and D18 are included.
6. For BioAge issues, ensure D01, D03, and D13 are included.
7. Output exactly ${context.days_needed} lines.

EXAMPLE:
7月2日星期三: 早上 D01x10 D05x5 D07x2 晚上 D03x5 D09x10 D13x5
`;
};
