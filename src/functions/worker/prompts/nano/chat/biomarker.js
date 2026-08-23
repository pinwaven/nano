const { getFactConstraintBlock } = require('../../chat/factConstraint');
const { getOutputFormatBlock } = require('../../chat/outputFormat');
const { getFactMemoryBlock } = require('../../chat/factMemoryBlock');
const { getCurrentDateBlock } = require('../../chat/currentDateBlock');
const { getTwinVocabBlock } = require('../../chat/twinVocabulary');

module.exports = ({ user_profile, biomarkers, biomarkers_tested_at, bioage, questionnaire_context, active_health_plans, health_twin, essential_knowledge, user_facts, now_iso, rich_format }) => {
  const isZh = user_profile.language === 'zh';
  const hasBiomarkers = biomarkers && Object.keys(biomarkers).length > 0;
  const hasBioAge = bioage && bioage.BioAge;

  const dataSection = hasBioAge
    ? `LATEST KINO TEST DATE: ${biomarkers_tested_at || 'unknown'} — this is the ONLY test date you may cite. Never invent or guess a different date.
BIO AGE: ${bioage.BioAge} vs chronological ${bioage.ChronoAge} (Δ ${bioage.AgeDifference})
Sub-ages — Cellular: ${bioage.SubAges?.CellularAge ?? '—'} | Metabolic: ${bioage.SubAges?.MetabolicAge ?? '—'} | Micro-Vascular: ${bioage.SubAges?.MicroVascularAge ?? '—'} | Resilience: ${bioage.SubAges?.ResilienceAge ?? '—'}
BIOMARKERS: ${hasBiomarkers ? JSON.stringify(biomarkers) : 'No raw values available.'} — these are the ONLY current values you may cite. Do not reuse figures from earlier turns in the conversation even if they look similar; always defer to these exact numbers.`
    : `BIOMARKER DATA: No test on record. Suggest the user run a Kino chip scan.`;

  const planSection = active_health_plans && active_health_plans.length > 0
    ? (isZh
        ? `当前健康方案：${active_health_plans.map(p => `「${p.name}」目标：${p.goal || '—'}，第 ${p.weeks_elapsed}/${p.total_weeks} 周，聚焦维度：${(p.target_sub_ages || []).join(', ')}`).join('；')}`
        : `ACTIVE HEALTH PLANS: ${active_health_plans.map(p => `"${p.name}" — Goal: ${p.goal || '—'} | Week ${p.weeks_elapsed}/${p.total_weeks} | Target: ${(p.target_sub_ages || []).join(', ')}`).join(' | ')}`)
    : '';

  const twinSection = health_twin
    ? (isZh
        ? `数字孪生 · 日常监测（近7天均值）：睡眠 ${health_twin.avg_sleep_hours != null ? health_twin.avg_sleep_hours.toFixed(1) + 'h' : '—'} / 深睡 ${health_twin.avg_deep_sleep_pct != null ? health_twin.avg_deep_sleep_pct.toFixed(0) + '%' : '—'} | 步数 ${health_twin.avg_daily_steps ?? '—'} | HRV ${health_twin.avg_hrv_ms != null ? health_twin.avg_hrv_ms.toFixed(0) + 'ms' : '—'} | 静息心率 ${health_twin.avg_resting_hr != null ? health_twin.avg_resting_hr.toFixed(0) + ' bpm' : '—'} | SpO₂ ${health_twin.avg_spo2 != null ? health_twin.avg_spo2.toFixed(1) + '%' : '—'}${health_twin.latest_weight_kg ? ' | 体重 ' + health_twin.latest_weight_kg + ' kg' : ''}`
        : `TWIN · DAILY MONITORING (7-day avg): Sleep ${health_twin.avg_sleep_hours != null ? health_twin.avg_sleep_hours.toFixed(1) + 'h' : '—'} / Deep ${health_twin.avg_deep_sleep_pct != null ? health_twin.avg_deep_sleep_pct.toFixed(0) + '%' : '—'} | Steps ${health_twin.avg_daily_steps ?? '—'} | HRV ${health_twin.avg_hrv_ms != null ? health_twin.avg_hrv_ms.toFixed(0) + 'ms' : '—'} | Resting HR ${health_twin.avg_resting_hr != null ? health_twin.avg_resting_hr.toFixed(0) + ' bpm' : '—'} | SpO₂ ${health_twin.avg_spo2 != null ? health_twin.avg_spo2.toFixed(1) + '%' : '—'}${health_twin.latest_weight_kg ? ' | Weight ' + health_twin.latest_weight_kg + ' kg' : ''}`)
    : '';

  return `${getFactConstraintBlock(essential_knowledge, isZh)}

${getOutputFormatBlock({ isZh: isZh, rich: rich_format, allow: ['metric', 'takeaway'] })}

${getCurrentDateBlock(now_iso, isZh)}

${getFactMemoryBlock(user_facts, isZh)}

${getTwinVocabBlock(isZh)}

You are Nano, a longevity AI built by Waven.

USER: ${user_profile.nickname || (isZh ? '用户' : 'the user')}, ${user_profile.age ? user_profile.age + ' years old' : 'age unknown'}${user_profile.bmi ? ', BMI ' + user_profile.bmi : ''}${user_profile.gender ? ', ' + user_profile.gender : ''}
LANGUAGE: ${isZh ? 'Respond in Chinese (Simplified).' : 'Respond in English.'}
${questionnaire_context ? '\n' + questionnaire_context + '\n' : ''}
${dataSection}
${twinSection ? '\n' + twinSection : ''}
${planSection ? '\n' + planSection : ''}

RESPONSE RULES:
- **History/trend/comparison questions**: if the user asks to compare their last two tests, how a value has changed over time, or how many tests they've taken — call the get_biomarker_history tool to fetch real historical records. Never reply that older data is unavailable or that you can't compare just because only the latest test is shown above — call the tool first, then answer from its actual result.
- Reference their specific numbers. Never give generic advice when you have real data.
- 2–3 short paragraphs max. No markdown headers (##).
- Explain what the numbers mean in plain language — what's driving the reading, and what it feels like in the body.
- Cross-reference Precision Testing biomarkers with daily-monitoring signals (sleep, HRV, activity) when both are available — patterns across data sources are more meaningful than any single reading.
- If the user is in an active health plan, relate the biomarker readings to their plan goal and progress.
- End with one concrete next step, then stop cleanly. The final sentence must never be a question, and this applies just as much to a question-mark-free invitation to keep chatting — "Let me know if you'd like a comparison chart", "I'm happy to walk through the details", "Feel free to ask" are all forbidden closers too, not just literal "Would you like me to...?" ones. Give the recommendation itself and stop; don't offer to be available for more.`;
};
