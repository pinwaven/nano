module.exports = ({ user_profile, biomarkers, bioage, questionnaire_context, active_health_plans, health_twin }) => {
  const isZh = user_profile.language === 'zh';
  const hasBiomarkers = biomarkers && Object.keys(biomarkers).length > 0;
  const hasBioAge = bioage && bioage.BioAge;

  const dataSection = hasBioAge
    ? `BIO AGE: ${bioage.BioAge} vs chronological ${bioage.ChronoAge} (Δ ${bioage.AgeDifference})
Sub-ages — Cellular: ${bioage.SubAges?.CellularAge ?? '—'} | Metabolic: ${bioage.SubAges?.MetabolicAge ?? '—'} | Micro-Vascular: ${bioage.SubAges?.MicroVascularAge ?? '—'} | Resilience: ${bioage.SubAges?.ResilienceAge ?? '—'}
BIOMARKERS: ${hasBiomarkers ? JSON.stringify(biomarkers) : 'No raw values available.'}`
    : `BIOMARKER DATA: No test on record. Suggest the user run a Kino chip scan.`;

  const planSection = active_health_plans && active_health_plans.length > 0
    ? (isZh
        ? `当前健康方案：${active_health_plans.map(p => `「${p.name}」目标：${p.goal || '—'}，第 ${p.weeks_elapsed}/${p.total_weeks} 周，聚焦维度：${(p.target_sub_ages || []).join(', ')}`).join('；')}`
        : `ACTIVE HEALTH PLANS: ${active_health_plans.map(p => `"${p.name}" — Goal: ${p.goal || '—'} | Week ${p.weeks_elapsed}/${p.total_weeks} | Target: ${(p.target_sub_ages || []).join(', ')}`).join(' | ')}`)
    : '';

  const twinSection = health_twin
    ? (isZh
        ? `实时健康数据（近7天均值）：睡眠 ${health_twin.avg_sleep_hours != null ? health_twin.avg_sleep_hours.toFixed(1) + 'h' : '—'} / 深睡 ${health_twin.avg_deep_sleep_pct != null ? health_twin.avg_deep_sleep_pct.toFixed(0) + '%' : '—'} | 步数 ${health_twin.avg_daily_steps ?? '—'} | HRV ${health_twin.avg_hrv_ms != null ? health_twin.avg_hrv_ms.toFixed(0) + 'ms' : '—'} | 静息心率 ${health_twin.avg_resting_hr != null ? health_twin.avg_resting_hr.toFixed(0) + ' bpm' : '—'} | SpO₂ ${health_twin.avg_spo2 != null ? health_twin.avg_spo2.toFixed(1) + '%' : '—'}${health_twin.latest_weight_kg ? ' | 体重 ' + health_twin.latest_weight_kg + ' kg' : ''}`
        : `DIGITAL TWIN (7-day avg): Sleep ${health_twin.avg_sleep_hours != null ? health_twin.avg_sleep_hours.toFixed(1) + 'h' : '—'} / Deep ${health_twin.avg_deep_sleep_pct != null ? health_twin.avg_deep_sleep_pct.toFixed(0) + '%' : '—'} | Steps ${health_twin.avg_daily_steps ?? '—'} | HRV ${health_twin.avg_hrv_ms != null ? health_twin.avg_hrv_ms.toFixed(0) + 'ms' : '—'} | Resting HR ${health_twin.avg_resting_hr != null ? health_twin.avg_resting_hr.toFixed(0) + ' bpm' : '—'} | SpO₂ ${health_twin.avg_spo2 != null ? health_twin.avg_spo2.toFixed(1) + '%' : '—'}${health_twin.latest_weight_kg ? ' | Weight ' + health_twin.latest_weight_kg + ' kg' : ''}`)
    : '';

  return `You are Viva, a longevity AI built by Waven.

USER: ${user_profile.nickname || (isZh ? '用户' : 'the user')}, ${user_profile.age ? user_profile.age + ' years old' : 'age unknown'}${user_profile.gender ? ', ' + user_profile.gender : ''}
LANGUAGE: ${isZh ? 'Respond in Chinese (Simplified).' : 'Respond in English.'}
${questionnaire_context ? '\n' + questionnaire_context + '\n' : ''}
${dataSection}
${twinSection ? '\n' + twinSection : ''}
${planSection ? '\n' + planSection : ''}

RESPONSE RULES:
- Reference their specific numbers. Never give generic advice when you have real data.
- 2–3 short paragraphs max. No markdown headers (##).
- Explain what the numbers mean in plain language — what's driving the reading, and what it feels like in the body.
- Cross-reference Kino biomarkers with wearable data (sleep, HRV, activity) when both are available — patterns across data sources are more meaningful than any single reading.
- If the user is in an active health plan, relate the biomarker readings to their plan goal and progress.
- End with one concrete next step.`;
};
