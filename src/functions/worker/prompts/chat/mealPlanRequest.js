// A request for FOOD — a meal plan, recipes, a diet menu — is not a request for a dots formula.
//
// 「也给我订制一周的营养餐」 classified as formulate_dots on prod (2026-09-14): 订制 + 营养 is one
// character away from 定制营养素, and the classifier decides with an LLM. The cost of that miss is
// not a degraded answer but a wrong ACTION — handlers/chat.js's formulate_dots branch returns
// launch_tool and the miniapp starts a brand-new 28-day formulation the user never asked for.
// Same failure class, same remedy, as messageAsksAboutFormulationPackage and
// messageAsksAboutFoodSensitivity: match deterministically, reclassify to nutrition_question.
//
// Anchored on meal / diet vocabulary only. It must NOT match:
//   - the Formulate-Dots trigger message (请根据我的完整健康数据…Dots 方案), which rides the same
//     handler — a test pins this;
//   - 套餐 (a purchased 原粒 package) — none of the terms below is a suffix of it;
//   - 营养素 / 定制配方 / 配制方案 — the genuine formulation requests.
const MEAL_PLAN_TRIGGER_RE = /(营养餐|餐单|食谱|菜谱|菜单|膳食|食疗|饮食(计划|方案|安排|搭配|建议|调理)|一日三餐|三餐|早餐|午餐|晚餐|加餐|减脂餐|轻食)|(meal[- ]?(plan|prep)s?|diet (plan|menu)|recipes?|weekly menu|what (should|can) i (eat|cook)|breakfast|lunch|dinner)/i;

function messageAsksForMealPlan(message) {
  return MEAL_PLAN_TRIGGER_RE.test(message || '');
}

// Wider than MEAL_PLAN_TRIGGER_RE: does the message mention food at all? This is the gate
// lib/agenticChat.js's buildForcedToolQueue puts on get_grocery_products — PLAN may still name
// the tool for a message that never mentions food (it did, for 「根据我的情况定制运动方案」 on prod
// 2026-09-22), but it is only FORCED when the user's own words are about eating. A false positive
// here costs one advisory tool call; a false negative leaves tool_choice:'auto', not a ban.
const FOOD_MENTION_RE = /(吃|餐|食|饮|菜|忌口|蔬|水果|坚果|肉|蛋|奶|豆|谷|粥|汤|零食|烹|煮|炒|超市|盒马|采购|购买)|(eat|food|meal|diet|recipe|ingredient|grocer|cook|breakfast|lunch|dinner|snack|vegetable|fruit|supermarket|shopping)/i;

function messageMentionsFood(message) {
  return FOOD_MENTION_RE.test(message || '');
}

module.exports = { messageAsksForMealPlan, messageMentionsFood, MEAL_PLAN_TRIGGER_RE, FOOD_MENTION_RE };
