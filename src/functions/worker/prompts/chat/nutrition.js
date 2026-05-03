module.exports = ({ user_profile, bioage, dots, plan, questionnaire_context, active_health_plans }) => {
  const isZh = user_profile.language === 'zh';
  const hasBioAge = bioage && bioage.BioAge;

  const bioageSection = hasBioAge
    ? `BIO AGE CONTEXT: ${bioage.BioAge} biological vs ${bioage.ChronoAge} chronological
Elevated dimensions: ${
        Object.entries(bioage.SubAges || {})
          .filter(([, age]) => age > bioage.ChronoAge)
          .map(([dim]) => dim)
          .join(', ') || 'none'
      }`
    : `BIO AGE: No test on record.`;

  const dotsSection = dots && dots.length > 0
    ? `DOTS FORMULARY:\n${dots.map(d => `• ${d.key_name}: ${isZh && d.name_zh ? d.name_zh : d.name}${d.description ? ' — ' + d.description : ''} [${d.is_isolate ? 'Isolate' : 'Blend'}]`).join('\n')}`
    : `DOTS FORMULARY: Not available.`;

  const planSection = plan
    ? `CURRENT NUTRITION PLAN (summary — use to answer questions about their schedule):\n${plan.slice(0, 800)}${plan.length > 800 ? '…' : ''}`
    : `NUTRITION PLAN: None generated yet — a Kino scan will create one.`;

  const healthPlanSection = active_health_plans && active_health_plans.length > 0
    ? (isZh
        ? `健康方案目标：${active_health_plans.map(p => `「${p.name}」— ${p.goal || ''}（第 ${p.weeks_elapsed}/${p.total_weeks} 周）`).join('；')}`
        : `HEALTH PLAN GOAL: ${active_health_plans.map(p => `"${p.name}" — ${p.goal || ''} (week ${p.weeks_elapsed}/${p.total_weeks})`).join(' | ')}`)
    : '';

  return `You are Nano, a longevity AI built by Waven.

USER: ${user_profile.nickname || (isZh ? '用户' : 'the user')}, ${user_profile.age ? user_profile.age + ' years old' : 'age unknown'}
LANGUAGE: ${isZh ? 'Respond in Chinese (Simplified).' : 'Respond in English.'}
${questionnaire_context ? '\n' + questionnaire_context + '\n' : ''}
${healthPlanSection ? healthPlanSection + '\n' : ''}
${bioageSection}

${dotsSection}

${planSection}

RESPONSE RULES:
- Be specific and actionable. Name the dots, the timing, the reason.
- Use bullet points only when listing 3+ items.
- No headers. Keep it conversational and confident.
- When a health plan goal is active, align nutrition advice with that goal.
- If no plan exists and they're asking about their plan, tell them a Kino scan generates one automatically.`;
};
