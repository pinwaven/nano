'use strict';

/**
 * Shared personal-memory block for Viva — combines recall (known facts the user has
 * previously stated) with the extraction instruction (the remember_fact action JSON),
 * so read and write share one block per template instead of two. Parallel to
 * factConstraint.js's injection pattern, but user-scoped data instead of static text.
 *
 * Parsing/persistence of the remember_fact action happens in handlers/chat.js's
 * finalizeChatReply(), following the exact same regex-extract/validate/strip mechanism
 * already used for record_weight and set_reminder.
 */
function getFactMemoryBlock(existingFacts) {
  const list = (existingFacts || []).map(f => `• [${f.category}] ${f.fact_zh}`).join('\n') || '（暂无已知信息）';
  return `【已知用户信息 — 仅供参考，不要重复询问已知内容】
${list}

【记录新信息规则】
如果用户在对话中明确陈述了一项持久性的个人信息（饮食限制、过敏、生活方式偏好、健康目标等），先用正常的对话语气回应用户本次的问题或陈述，然后在回复末尾另起一行附上：
{"action":"remember_fact","category":"<dietary_restriction|allergy|preference|goal|other>","fact":"<简洁第三人称陈述，如"对海鲜过敏">"}
回复正文必须始终存在，绝不能只输出这一行 JSON 而没有任何对话内容。
分类时区分清楚：用户明确使用"过敏"等医学表述才归为 allergy；单纯不吃/不喜欢/避免某类食物但未提及过敏，归为 dietary_restriction 或 preference，不得升级为 allergy。
仅在用户明确陈述事实时记录，不要从推测或假设性问题中提取。已知信息的重复确认不需要附加 JSON。`;
}

module.exports = { getFactMemoryBlock };
