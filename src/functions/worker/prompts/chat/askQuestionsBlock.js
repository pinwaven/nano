'use strict';

/**
 * Shared "ask a structured follow-up" trigger block — lets the model propose a short
 * on-the-fly questionnaire (rendered natively by the miniapp, reusing the existing
 * questionnaires/questionnaire_questions/questionnaire_assignments engine) when free-text
 * chat is a poor fit for what it needs to collect.
 *
 * Parsing/validation/persistence of the ask_questions action happens in handlers/chat.js's
 * finalizeChatReply(), via _extractTrailingJson() (nested-brace shape, like formulate_dots)
 * — every question is validated strictly server-side and a malformed one is dropped, never
 * fabricated. A server-side rate-limit guard (questionnaires.js's
 * canCreateDynamicQuestionnaire) blocks a new one while the user has an incomplete dynamic
 * assignment or received one recently, regardless of what this prompt instructs — the model
 * doesn't need to self-track frequency.
 *
 * Persona-agnostic like factMemoryBlock/factConstraint (lives in prompts/chat/, not
 * prompts/viva/), but only wired into Viva templates for now. `isZh` defaults to true to
 * match every current call site.
 */
function getAskQuestionsBlock(isZh = true) {
  if (isZh) {
    return `【主动提问规则】
当自由文本回复无法干净地收集所需信息时（例如需要同时了解几项独立的结构化事实，如日常作息、运动频率与类型、饮食类型等），可以生成一份简短的补充问卷，而不是在多轮对话中逐一追问。使用前请先检查上方已知的问卷回答和用户信息，绝不重复询问已知内容。仅在真正需要结构化信息、且无法用一句话问清楚时才使用；不要滥用，也不要在每次回复中都提出。

如果决定提问，先用正常的对话语气回应用户本次的问题或陈述，然后在回复末尾另起一行附上：
{"action":"ask_questions","name":"<英文标题>","name_zh":"<中文标题>","questions":[{"key":"<snake_case英文标识，同一问卷内唯一>","prompt_en":"<英文问题>","prompt_zh":"<中文问题>","input_type":"<text|button_select|date_picker|slider_group|multi_select>","config":{...}}]}

每份问卷 1-5 个问题。为每个问题选择最合适的 input_type：能枚举的选项用 button_select 或 multi_select（config: {"options":[{"value"或"key":"...","label_en":"...","label_zh":"..."}]}，2-7 个选项）；数值范围用 slider_group（config: {"sliders":[{"key":"...","label_en":"...","label_zh":"...","min":0,"max":100,"step":1,"default":50}]}）；日期用 date_picker；只有前面都不合适时才用 text。
回复正文必须始终存在真实的对话内容，绝不能只输出这一行 JSON 而没有任何对话内容。`;
  }

  return `[PROACTIVE QUESTIONNAIRE RULE]
When a normal free-text reply can't cleanly collect what's needed (e.g. several distinct structured facts at once — a typical sleep schedule, exercise frequency and type, diet type), you may generate a short follow-up questionnaire instead of asking one thing per turn across several messages. Check the known questionnaire responses and user facts above first — never re-ask something already known. Only use this when the information genuinely needs structure and can't be asked in one sentence; don't overuse it, and don't propose one on every reply.

If you decide to ask, first respond normally in conversational tone to whatever the user actually asked or said, then append on a new line at the very end of your reply:
{"action":"ask_questions","name":"<English title>","name_zh":"<中文标题>","questions":[{"key":"<snake_case identifier, unique within this set>","prompt_en":"<question text>","prompt_zh":"<问题（中文）>","input_type":"<text|button_select|date_picker|slider_group|multi_select>","config":{...}}]}

1-5 questions per set. Choose the input_type that best fits each question: enumerable choices use button_select or multi_select (config: {"options":[{"value" or "key":"...","label_en":"...","label_zh":"..."}]}, 2-7 options); numeric ranges use slider_group (config: {"sliders":[{"key":"...","label_en":"...","label_zh":"...","min":0,"max":100,"step":1,"default":50}]}); dates use date_picker; text only as a last resort.
Your reply must always contain real conversational content — never output only that JSON line with nothing else.`;
}

module.exports = { getAskQuestionsBlock };
