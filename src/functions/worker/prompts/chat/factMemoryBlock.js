'use strict';

/**
 * Shared personal-memory block — combines recall (known facts the user has previously
 * stated) with the extraction instruction (the remember_fact action JSON), so read and
 * write share one block per template instead of two. Parallel to factConstraint.js's
 * injection pattern, but user-scoped data instead of static text.
 *
 * user_memory_facts.fact_zh is always stored in Chinese regardless of persona/language
 * (single-column schema, not persona-scoped) — the model reads those bullets fine
 * inside an English instructional wrapper and still replies in the user's language.
 * Only the instructional wrapper text itself is bilingual via `isZh`.
 *
 * Parsing/persistence of the remember_fact action happens in handlers/chat.js's
 * finalizeChatReply(), following the exact same regex-extract/validate/strip mechanism
 * already used for record_weight and set_reminder.
 *
 * Moved out of prompts/viva/ (was Viva-only) when Nano adopted the same agentic engine.
 * `isZh` defaults to true to preserve Viva's existing behavior at every pre-existing call site.
 */
function getFactMemoryBlock(existingFacts, isZh = true) {
  const list = (existingFacts || []).map(f => `• [${f.category}] ${f.fact_zh}`).join('\n');

  if (isZh) {
    return `【已知用户信息 — 仅供参考，不要重复询问已知内容】
${list || '（暂无已知信息）'}

【记录新信息规则】
如果用户在对话中明确陈述了一项持久性的个人信息（饮食限制、过敏、生活方式偏好、健康目标等），先用正常的对话语气回应用户本次的问题或陈述，然后在回复末尾另起一行附上：
{"action":"remember_fact","category":"<dietary_restriction|allergy|preference|goal|other>","fact":"<简洁第三人称陈述，如"对海鲜过敏">"}
回复正文必须始终存在，绝不能只输出这一行 JSON 而没有任何对话内容。
分类时区分清楚：用户明确使用"过敏"等医学表述才归为 allergy；单纯不吃/不喜欢/避免某类食物但未提及过敏，归为 dietary_restriction 或 preference，不得升级为 allergy。
仅在用户明确陈述事实时记录，不要从推测或假设性问题中提取。已知信息的重复确认不需要附加 JSON。
只能提取用户本人这句话里直接说出的内容——绝不能把你自己这次回复中给出的数据、统计或答案（例如检测次数、生物标志物数值、生理年龄）当成"用户陈述的事实"记下来，那是你告诉用户的信息，不是用户告诉你的。
不要记录任何系统里已经有权威、实时数据来源的内容，例如当前具体在吃哪些原粒、检测次数、体重历史、生理年龄——这些一旦被冻结成一句静态文字，很快就会和真实数据脱节，而这个功能没有任何机制去更新或纠正它。这类内容只作为本轮对话的上下文使用，不要生成 JSON。`;
  }

  return `[KNOWN USER FACTS — reference only, don't re-ask for what's already known]
${list || '(no known facts yet)'}

[RULE FOR RECORDING NEW FACTS]
If the user explicitly states a durable personal fact during this conversation (a dietary restriction, allergy, lifestyle preference, health goal, etc.), first respond normally in conversational tone to whatever they actually asked or said, then append on a new line at the very end of your reply:
{"action":"remember_fact","category":"<dietary_restriction|allergy|preference|goal|other>","fact":"<a concise third-person statement, in Chinese, e.g. "对海鲜过敏">"}
Your reply must always contain real conversational content — never output only that JSON line with nothing else.
Categorize carefully: only use "allergy" when the user explicitly uses a medical term like "allergic"; simply not eating/disliking/avoiding a food without mentioning an allergy belongs under "dietary_restriction" or "preference", never escalated to "allergy".
Only record when the user states a fact explicitly — never extract from speculation or hypothetical questions. Restating an already-known fact doesn't need the JSON appended again.
Only extract something the user themselves directly said in their own message this turn — never record data, statistics, or an answer YOU are giving them in this same reply (e.g. their test count, a biomarker value, a sub-age) as if it were a fact the user stated; that's information you told them, not information they told you.
Never record anything the system already tracks as an authoritative, real-time source — current dot/supplement usage, test counts, weight history, sub-ages. The moment one of those is frozen into a static text fact it starts drifting out of sync with the real data, and this mechanism has no way to update or correct it later. Treat that kind of content as conversation context only — do not emit the JSON for it.`;
}

module.exports = { getFactMemoryBlock };
