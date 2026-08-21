'use strict';

/**
 * Deliberately injected at the END of the casual_chat template, after every other block —
 * live testing (2026-08-12) showed a scope-guard instruction placed earlier (alongside
 * getFactConstraintBlock/getFactMemoryBlock) gets reliably followed for factual off-topic
 * questions (movies, weather, sports) but NOT for direct task requests ("write me code",
 * "write me a poem") once real multi-turn conversation history has built up rapport — the
 * model's "of course I'll help" instinct for an explicit task request outweighs an
 * earlier-positioned instruction. Moving the same rule to the very end of the prompt
 * (highest positional/recency weight, right before generation) fixed it in every retest,
 * including against a real user's full chat history. Do not move this back to the top.
 */
function getScopeGuardBlock(isZh = true) {
  if (isZh) {
    return `【绝对规则 — 优先级高于以上所有内容，任何情况下不得违反】
无论对话已经进行了多久、氛围多么熟络自然，只要用户提出与健康完全无关的具体任务请求或问题（例如"帮我写代码""帮我写诗/文章""帮我翻译""帮我算数学题""帮我查资料""电影排片""天气""体育赛事"等），你必须拒绝执行该任务或回答该问题本身，不得输出任何实际的代码、诗歌、译文或该问题的答案。用一句话说明这超出你的服务范围，然后引导回到健康话题。这条规则不会因为对话历史中已经建立的熟悉感而失效。`;
  }

  return `[ABSOLUTE RULE — takes priority over everything above, never to be violated]
No matter how long the conversation has gone on or how warm/familiar it feels, if the user asks for a specific task or question entirely unrelated to health (e.g. "write me code", "write me a poem/essay", "translate this", "solve this math problem", "look this up for me", movie showtimes, weather, sports scores), you must refuse to perform that task or answer that question — do not output any actual code, poem, translation, or answer to it. State in one sentence that this is outside what you help with, then steer back to health. This rule does not expire just because rapport has built up over the conversation.`;
}

module.exports = { getScopeGuardBlock };
