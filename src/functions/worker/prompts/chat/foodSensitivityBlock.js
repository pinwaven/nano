'use strict';

/**
 * Shared vocabulary block for 慢性食物过敏 — the food-specific IgG panel a user uploads as a
 * 健康文档, and the restrictions derived from it. CLAUDE.md §40.
 *
 * WHY THIS EXISTS. Before it, a user could upload a 120-item IgG panel and nothing downstream
 * changed: no tool could see it, the food advice they were given did not know about it, and their
 * dots formula was unchanged by a test they paid for. `过敏原`, `食物过敏` and `food_sensitivity`
 * returned zero hits across the whole repo — the only structured allergy representation was a
 * free-text string a user had typed in chat.
 *
 * THIS BLOCK CARRIES NO DATA. Everything factual comes from the get_food_sensitivity tool, whose
 * rows are read from the user's own stored panel. The block only teaches the model that the domain
 * exists, that the tool is where the answer lives, and the one distinction the model must not get
 * wrong on its own.
 *
 * IT NAMES NO CLASS THRESHOLD. What a class means, and how long a food is stopped, live in
 * lib/foodSensitivity.js's CLASS_WINDOWS and reach the model already written on the row, as
 * `severity_text` and `guidance`. A prompt restating them would be a second definition of a
 * clinical instruction in the one medium where drift is invisible: change the window in code and
 * the prompt would keep reciting the old one, confidently, forever. A test asserts no window
 * number appears in this file.
 *
 * Gated on the panel existing at all, the same structural gate getProductRecommendBlock and
 * getFormulationPackageBlock use: with no panel there is nothing to describe, and returning ''
 * means the model never learns the vocabulary rather than being asked not to use it.
 */

// Deterministic backstop, on the model of BIOMARKER_HISTORY_TRIGGER_RE and
// messageAsksAboutFormulationPackage, and for the same reason: PLAN decides `tools_needed` with an
// LLM and is unreliable, so "am I allergic to X" cannot depend on it.
//
// ANCHORED ON FOOD AND REACTION VOCABULARY. It must not match the Formulate-Dots trigger message
// (「请根据我的完整健康数据，为我配置一个 28 天周期的 Dots 方案。」 and its EN twin,
// handlers/dots.js), which rides the same runAgenticTurn — matching it would force an irrelevant
// tool call into a formulation turn. So: never 方案/配方/定制/营养 on their own.
//
// Same risk acceptance as every other regex heuristic here: a false positive costs one extra
// read-only tool call, never a wrong answer.
const FOOD_SENSITIVITY_TRIGGER_RE = /(过敏|敏感|不耐受|忌口|禁忌|食物不良反应|IgG|能不能[吃喝用]|能[吃喝]|可以[吃喝]|不能[吃喝]|该吃什么|不该吃|饮食禁忌|戒断|轮替饮食|发物)|(food (allergy|allergies|sensitivit|intoleran)|allergic to|intoleran(t|ce) to|can i (eat|drink|have)|should i avoid|foods? to avoid|elimination diet|igg panel)/i;

function messageAsksAboutFoodSensitivity(message) {
  return FOOD_SENSITIVITY_TRIGGER_RE.test(message || '');
}

function getFoodSensitivityBlock(enabled, isZh = true) {
  if (!enabled) return '';

  if (isZh) {
    return `【慢性食物过敏（食物特异性 IgG）】
这位用户上传过一份慢性食物过敏检测报告，结果已经进入他的数字孪生「医疗记录」。

关于"我对什么过敏 / 我能不能吃某样东西 / 我要忌口什么"这类问题：
- 必须调用 get_food_sensitivity 取得真实结果再回答。绝不可从原粒配方、营养方案、生物标志物或任何其他数据推断用户对哪些食物敏感——那些数据回答的是别的问题。
- 想确认某一样具体食物，把用户说的食物名放进 foods 参数里查询，不要凭印象回答。
- 这份检测只覆盖固定的一份食物清单。工具返回 not_tested 的，就是这次没有测，要如实说没测过；不可以说它安全，也不可以说它有问题。
- 每一行都自带 severity_text（这一级是什么）和 guidance（该怎么做）。直接引用它们，不要自己改写分级的含义，也不要自己推算戒断时间或复查时间。
- **这是 IgG 介导的慢性食物过敏，不是急性过敏。**不要把它称作"过敏"而不加限定，更不要说成终身过敏或需要严格禁食一辈子。它通常是暂时的，戒断一段时间后多数食物可以逐步恢复摄入——工具行里的 guidance 会说明具体做法。
- 如果某一行的 window_has_passed 是 true，说明建议的戒断期已经过去了，应当提示用户可以按 guidance 尝试恢复摄入或复查，而不是继续要求他忌口。
- hidden_in 是这种食物常见的隐藏来源，eat_instead 是可替代的食物；有就用，没有就不要编。
- value 是抗体浓度数值。below_detection 为 true 表示低于检出限，实验室没有测出具体数值——这种情况不要报任何数字。
- 如果工具返回空，说明这位用户没有上传过这类检测报告，就如实说没有记录，不要拿别的数据代替。
- 这是一份检测结果，不是诊断。不要据此判断任何疾病，也不要建议停用任何药物。`;
  }

  return `[CHRONIC FOOD SENSITIVITY (food-specific IgG)]
This user has uploaded a chronic food-sensitivity test, and its results are in their digital twin's Medical Records.

For any question about what they react to, whether a specific food is safe for them, or what they should avoid:
- Call get_food_sensitivity and answer from the real result. Never infer which foods a user reacts to from the Dots formulary, a nutrition plan, a biomarker or anything else — those answer a different question.
- To check one specific food, pass the food the user named in the \`foods\` parameter. Do not answer from impression.
- The panel covers a fixed list of foods. A row that comes back as not_tested was not tested: say so plainly. Do not call it safe and do not call it a problem.
- Every row carries its own severity_text (what this class is) and guidance (what to do). Use them as given; never rewrite what a class means and never work out an avoidance or recheck period yourself.
- **This is IgG-mediated chronic sensitivity, not an acute allergy.** Do not call it "an allergy" without qualification, and never describe it as lifelong or as requiring permanent strict avoidance. It is usually temporary and most foods can be reintroduced — the row's guidance says how.
- When a row's window_has_passed is true the advised avoidance period is over: point the user at reintroducing or rechecking as the guidance describes, rather than telling them to keep avoiding it.
- hidden_in lists where that food commonly hides; eat_instead lists substitutes. Use them when present, invent neither when absent.
- value is the antibody level. below_detection true means the lab did not measure a figure at all — report no number in that case.
- If the tool returns nothing, this user has uploaded no such test. Say there is no record rather than substituting other data.
- This is a test result, not a diagnosis. Do not diagnose a condition from it and never advise stopping a medication.`;
}

module.exports = {
  getFoodSensitivityBlock,
  messageAsksAboutFoodSensitivity,
  FOOD_SENSITIVITY_TRIGGER_RE,
};
