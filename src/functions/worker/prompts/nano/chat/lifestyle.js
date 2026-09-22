const { getFactConstraintBlock } = require('../../chat/factConstraint');
const { getWearableDailyBlock } = require('../../chat/wearableDailyBlock');
const { getSubAgeInputsBlock } = require('../../chat/subAgeInputsBlock');
const { getOutputFormatBlock } = require('../../chat/outputFormat');
const { getFactMemoryBlock } = require('../../chat/factMemoryBlock');
const { getCurrentDateBlock } = require('../../chat/currentDateBlock');
const { getTwinVocabBlock } = require('../../chat/twinVocabulary');

// lifestyle_question — exercise / sleep-routine / daily-schedule plans from the user's own data.
// No grocery, store or formulation block by design; see prompts/viva/chat/lifestyle.js.
module.exports = ({ user_profile, biomarkers, biomarkers_tested_at, bioage, questionnaire_context, active_health_plans, health_twin, essential_knowledge, user_facts, now_iso, rich_format, sub_age_display_names, wearable_daily, wearable_insights }) => {
  const isZh = user_profile.language === 'zh';
  const hasBiomarkers = biomarkers && Object.keys(biomarkers).length > 0;
  const hasBioAge = bioage && bioage.BioAge;

  const dataSection = hasBioAge
    ? `LATEST KINO TEST DATE: ${biomarkers_tested_at || 'unknown'} — this is the ONLY test date you may cite. Never invent or guess a different date.
BIO AGE: ${bioage.BioAge} vs chronological ${bioage.ChronoAge} (Δ ${bioage.AgeDifference})
Sub-ages — Cellular: ${bioage.SubAges?.CellularAge ?? '—'} | Metabolic: ${bioage.SubAges?.MetabolicAge ?? '—'} | Micro-Vascular: ${bioage.SubAges?.MicroVascularAge ?? '—'} | Resilience: ${bioage.SubAges?.ResilienceAge ?? '—'}
BIOMARKERS: ${hasBiomarkers ? JSON.stringify(biomarkers) : 'No raw values available.'} — these are the ONLY current values you may cite. Do not reuse figures from earlier turns in the conversation.`
    : `BIOMARKER DATA: No test on record. Build the plan from daily monitoring and the profile anyway — never defer it until a scan is done.`;

  const planSection = active_health_plans && active_health_plans.length > 0
    ? (isZh
        ? `当前健康方案：${active_health_plans.map(p => `「${p.name}」目标：${p.goal || '—'}，第 ${p.weeks_elapsed}/${p.total_weeks} 周，聚焦维度：${(p.target_sub_ages || []).join(', ')}`).join('；')}`
        : `ACTIVE HEALTH PLANS: ${active_health_plans.map(p => `"${p.name}" — Goal: ${p.goal || '—'} | Week ${p.weeks_elapsed}/${p.total_weeks} | Target: ${(p.target_sub_ages || []).join(', ')}`).join(' | ')}`)
    : '';

  const twinSection = health_twin
    ? (isZh
        ? `数字孪生 · 日常监测（近7天均值）：睡眠 ${health_twin.avg_sleep_hours != null ? health_twin.avg_sleep_hours.toFixed(1) + 'h' : '—'} / 深睡 ${health_twin.avg_deep_sleep_pct != null ? health_twin.avg_deep_sleep_pct.toFixed(0) + '%' : '—'} | 步数 ${health_twin.avg_daily_steps ?? '—'} | 活动 ${health_twin.avg_active_minutes != null ? health_twin.avg_active_minutes.toFixed(0) + ' 分钟' : '—'} | HRV ${health_twin.avg_hrv_ms != null ? health_twin.avg_hrv_ms.toFixed(0) + 'ms' : '—'} | 静息心率 ${health_twin.avg_resting_hr != null ? health_twin.avg_resting_hr.toFixed(0) + ' bpm' : '—'}${health_twin.latest_weight_kg ? ' | 体重 ' + health_twin.latest_weight_kg + ' kg' : ''}`
        : `TWIN · DAILY MONITORING (7-day avg): Sleep ${health_twin.avg_sleep_hours != null ? health_twin.avg_sleep_hours.toFixed(1) + 'h' : '—'} / Deep ${health_twin.avg_deep_sleep_pct != null ? health_twin.avg_deep_sleep_pct.toFixed(0) + '%' : '—'} | Steps ${health_twin.avg_daily_steps ?? '—'} | Active ${health_twin.avg_active_minutes != null ? health_twin.avg_active_minutes.toFixed(0) + ' min' : '—'} | HRV ${health_twin.avg_hrv_ms != null ? health_twin.avg_hrv_ms.toFixed(0) + 'ms' : '—'} | Resting HR ${health_twin.avg_resting_hr != null ? health_twin.avg_resting_hr.toFixed(0) + ' bpm' : '—'}${health_twin.latest_weight_kg ? ' | Weight ' + health_twin.latest_weight_kg + ' kg' : ''}`)
    : '';

  return `${getFactConstraintBlock(essential_knowledge, isZh)}

${getWearableDailyBlock(wearable_daily, isZh, now_iso, wearable_insights)}

${getSubAgeInputsBlock(isZh, sub_age_display_names)}

${getOutputFormatBlock({ isZh: isZh, rich: rich_format, allow: ['takeaway'] })}

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
- **This is a LIFESTYLE request (exercise / sleep routine / daily schedule / breathing or stress practice) — answer exactly what THIS message asks for.** An exercise plan gets an exercise plan; a sleep routine gets a sleep routine. Never answer with food, dots, shopping, or an earlier topic from the conversation history — history is background only, never this turn's subject.
- Make it actionable: lay it out by week or by day (type, frequency, duration, intensity level, progression), grounded in the user's age, BMI, weight, 7-day steps/active minutes, sleep, HRV, resting heart rate and recorded personal facts (injuries, preferences, limits). Align it with an active health plan goal when there is one.
- Not a clinical assessment: biomarkers and sub-ages may explain WHY a kind of activity is prioritised, but never present exercise as a treatment, promise a specific change in a value, or invent a study, percentage or timeline. For cardiovascular or pre-existing-condition risk, say to check with a physician first.
- Fill missing preferences (equipment, venue, available time) with sensible defaults and say they can be swapped — do not open with a list of questions and wait.
- No dots, no products, no supermarket or shopping references; no diet content unless this same message also asks what to eat.
- Use a list only for 3+ items. No markdown headers.
- End cleanly. The final sentence must never be a question or an invitation to keep chatting.`;
};
