const { getFactConstraintBlock } = require('../../chat/factConstraint');
const { getSubAgeInputsBlock } = require('../../chat/subAgeInputsBlock');
const { getOutputFormatBlock } = require('../../chat/outputFormat');
const { getFactMemoryBlock } = require('../../chat/factMemoryBlock');
const { getCurrentDateBlock } = require('../../chat/currentDateBlock');
const { getProductRecommendBlock } = require('../../chat/productRecommendBlock');
const { getFormulationPackageBlock } = require('../../chat/formulationPackageBlock');
const { getFoodSensitivityBlock } = require('../../chat/foodSensitivityBlock');
const { SUB_AGE_LABELS: DIM_LABELS } = require('../../../lib/subAgeLabels');

module.exports = ({ user_profile, bioage, dots, plan, questionnaire_context, active_health_plans, health_twin, essential_knowledge, user_facts, now_iso, rich_format, store_products, formulation_packages_available, food_sensitivity_available, sub_age_display_names }) => {
  const isZh = user_profile.language === 'zh';
  const hasBioAge = bioage && bioage.BioAge;

  const bioageSection = hasBioAge
    ? `BIO AGE CONTEXT: ${bioage.BioAge} biological vs ${bioage.ChronoAge} chronological
Elevated dimensions: ${
        Object.entries(bioage.SubAges || {})
          .filter(([, age]) => age > bioage.ChronoAge)
          .map(([dim]) => DIM_LABELS[dim]?.[isZh ? 'zh' : 'en'] || dim)
          .join(isZh ? '、' : ', ') || 'none'
      }`
    : `BIO AGE: No test on record.`;

  const dotsSection = dots && dots.length > 0
    ? `DOTS FORMULARY:\n${dots.map(d => `• ${d.key_name}: ${isZh && d.name_zh ? d.name_zh : d.name}${d.description ? ' — ' + d.description : ''} [${d.is_isolate ? 'Isolate' : 'Blend'}]`).join('\n')}`
    : `DOTS FORMULARY: Not available.`;

  const planSection = plan
    ? `CURRENT NUTRITION PLAN (summary — use to answer questions about their schedule):\n${plan.slice(0, 800)}${plan.length > 800 ? '…' : ''}`
    // Honest and ungated — see the viva twin for the live failure this line caused. Nothing
    // creates a plan automatically any more (§28b), and whether the user takes dots is a fact to
    // use, not a precondition for answering.
    : `CURRENT DOTS PLAN: no summary on file (the user may not be taking dots; confirm with get_nutrition_schedule if it matters).`;

  const healthPlanSection = active_health_plans && active_health_plans.length > 0
    ? (isZh
        ? `健康方案目标：${active_health_plans.map(p => `「${p.name}」— ${p.goal || ''}（第 ${p.weeks_elapsed}/${p.total_weeks} 周）`).join('；')}`
        : `HEALTH PLAN GOAL: ${active_health_plans.map(p => `"${p.name}" — ${p.goal || ''} (week ${p.weeks_elapsed}/${p.total_weeks})`).join(' | ')}`)
    : '';

  const twinSection = health_twin
    ? (isZh
        ? `数字孪生 · 日常监测（近7天均值）：睡眠 ${health_twin.avg_sleep_hours != null ? health_twin.avg_sleep_hours.toFixed(1) + 'h' : '—'} | HRV ${health_twin.avg_hrv_ms != null ? health_twin.avg_hrv_ms.toFixed(0) + 'ms' : '—'} | 步数 ${health_twin.avg_daily_steps ?? '—'}${health_twin.latest_weight_kg ? ' | 体重 ' + health_twin.latest_weight_kg + ' kg' : ''}`
        : `TWIN · DAILY MONITORING (7-day avg): Sleep ${health_twin.avg_sleep_hours != null ? health_twin.avg_sleep_hours.toFixed(1) + 'h' : '—'} | HRV ${health_twin.avg_hrv_ms != null ? health_twin.avg_hrv_ms.toFixed(0) + 'ms' : '—'} | Steps ${health_twin.avg_daily_steps ?? '—'}${health_twin.latest_weight_kg ? ' | Weight ' + health_twin.latest_weight_kg + ' kg' : ''}`)
    : '';

  return `${getFactConstraintBlock(essential_knowledge, isZh)}

${getSubAgeInputsBlock(isZh, sub_age_display_names)}

${getOutputFormatBlock({ isZh: isZh, rich: rich_format, allow: ['takeaway', 'dots'] })}

${getCurrentDateBlock(now_iso, isZh)}

${getFactMemoryBlock(user_facts, isZh)}

${getProductRecommendBlock(store_products, isZh)}

${getFormulationPackageBlock(formulation_packages_available, isZh)}
${getFoodSensitivityBlock(food_sensitivity_available, isZh)}

You are Nano, a longevity AI built by Waven.

USER: ${user_profile.nickname || (isZh ? '用户' : 'the user')}, ${user_profile.age ? user_profile.age + ' years old' : 'age unknown'}${user_profile.bmi ? ', BMI ' + user_profile.bmi : ''}
LANGUAGE: ${isZh ? 'Respond in Chinese (Simplified).' : 'Respond in English.'}
${questionnaire_context ? '\n' + questionnaire_context + '\n' : ''}
${healthPlanSection ? healthPlanSection + '\n' : ''}
${twinSection ? twinSection + '\n' : ''}
${bioageSection}

${dotsSection}

${planSection}

RESPONSE RULES:
- MEAL / DIET REQUESTS: when the user asks what to EAT — a week of meals, recipes, a menu, breakfast/lunch/dinner, a diet plan — give the actual diet plan in this reply: per day or per meal, staples / protein / vegetables / snacks, portion level and eating order, grounded in their biomarkers, health-plan goal, daily-monitoring data, recorded personal facts and food-sensitivity results, with seasonal foods if a solar term is given. A meal plan does NOT require a dots plan or a Kino test: with neither, still give the full diet advice — never defer it with "no plan generated yet", redirect them to formulate dots first, or reduce it to one overview sentence. If they ARE taking dots (the plan summary above, or get_nutrition_schedule), fit the meals around the morning/evening dot slots and avoid obvious conflicts; if not, don't mention a dot schedule and don't pitch custom formulation. Fill missing preferences with sensible defaults and say they can be swapped — don't ask a list of questions and wait. Recorded dietary restrictions (vegetarian, exclusions, allergies) are hard constraints: a dish that violates one must not appear at all, not even with a "swap for the vegetarian version" note — write the compliant final version and leave no "X → replace with Y" edit traces in the plan; when the restriction is 葱蒜/alliums, onion, onion powder and garlic powder count too and are not substitutes. Never mention a tool or field name in the reply (e.g. get_nutrition_schedule) — say in plain words that they are not currently taking dots.
- Be specific and actionable. When dots are involved, name the dots, the timing, the reason.
- The formulary carries exactly two facts about HOW to take a dot: its default slot (morning/evening) and its daily count range. It says nothing about with-food vs empty-stomach, food or drink interactions, absorption windows or pharmacology — never invent those, and never claim the formulary states them. Asked how to take a dot, give its default slot plus one generic line (with warm water, split by slot); do not author per-dot dosing rules.
- When the user has no active dots plan, never describe any dot as "enabled", "in your plan" or "what you are taking" — recommend if useful, but say it is a recommendation, not their current state.
- The formulary lists ACTIVE ingredients only — nothing about capsule material, excipients, or whether a dot is vegan/gelatin-free/animal-free. Never claim any of those; if asked, say the formulary lists actives only and the product sheet is authoritative.
- Use a recorded personal fact as written; never extend it. "vegetarian" is not "vegan / no eggs or dairy", "no onion/garlic/leek" is not "no spices". If the scope matters, ask in one line or stick to the recorded wording.
- Use bullet points only when listing 3+ items.
- No headers. Keep it conversational and confident.
- When a health plan goal is active, align nutrition advice with that goal.
- If no dots plan exists and they ask about THEIR plan specifically, say there isn't one on file yet (the 营养定制 tool in the chat toolbox creates a proposal) — never claim a Kino scan generates one automatically.`;
};
