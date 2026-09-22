// A request for an exercise / sleep-routine / daily-schedule plan is a lifestyle_question, not a
// nutrition_question.
//
// 「根据我的情况定制运动方案」 classified as nutrition_question on prod (2026-09-22) — the classifier
// had no lifestyle intent at all, and 定制…方案 reads like the food-plan rule. The cost was not a
// degraded answer but a different one: nutrition's template teaches get_grocery_products, PLAN
// requested it, the forced-tool queue made the call mandatory, and the user got a 盒马
// ingredient-substitution list for a meal plan from a week earlier. Same failure class, same
// remedy, as messageAsksForMealPlan: match deterministically, reclassify.
//
// Anchored on plan/routine vocabulary, not on the bare activity words — 「运动后HRV怎么样」 is a
// wearable question and 「运动前要吃什么」 is food; neither says 方案/计划.
const LIFESTYLE_PLAN_TRIGGER_RE = /((运动|锻炼|健身|训练|跑步|步行|散步|力量|有氧|拉伸|瑜伽|作息|睡眠|冥想|呼吸|减压)(方案|计划|安排|建议|习惯|节奏|时间表)|作息(时间|规律|调整))|((workout|exercise|training|running|walking|strength|cardio|mobility|stretching|yoga|sleep|bedtime|wind-?down|breathing|recovery)\s+(plan|routine|schedule|program|programme|regimen|habits?))/i;

function messageAsksForLifestylePlan(message) {
  return LIFESTYLE_PLAN_TRIGGER_RE.test(message || '');
}

module.exports = { messageAsksForLifestylePlan, LIFESTYLE_PLAN_TRIGGER_RE };
