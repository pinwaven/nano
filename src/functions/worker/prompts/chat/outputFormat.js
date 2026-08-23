'use strict';

/**
 * Shared display-format block: teaches the model a small set of ::: directive fences that the
 * WeChat miniapp's chat tab renders as designed cards instead of prose.
 *
 * Client side: src/mini/nano-miniapp/utils/markdown.js (mdToSegments) parses these into typed
 * segments, and pages/main/main.wxml renders each type as a native view. Everything not inside a
 * fence stays ordinary markdown and goes through <mp-html> as before.
 *
 * Degradation is the reason for this syntax rather than a JSON code fence. The same
 * chat_messages rows are also rendered by the coach app (raw <text>) and the web user-app
 * (react-markdown, no directive plugin), and a user on a stale cached miniapp build has the old
 * parser. In all three, a fence degrades to three readable lines with every number intact; a JSON
 * fence would degrade to a wall of braces.
 *
 * `rich` is the kill switch AND the surface gate: handlers/chat.js sets llmContext.rich_format
 * only for requests that came from the miniapp (body.client === 'miniapp') and only while
 * process.env.CHAT_MARKERS !== 'off'. When false this returns '' and the model never learns the
 * syntax at all, so nothing has to be stripped downstream.
 *
 * `allow` opts each template into just the cards that make sense for it — a template is never
 * told about a card it shouldn't emit. Persona-agnostic (lives in prompts/chat/, like
 * factConstraint / factMemoryBlock / twinVocabulary).
 */

const CARD_ZH = {
  metric: `- 生物标志物数值卡（最多一个区块，最多 4 行）：
:::metric
<指标名> | <数值> | <单位> | <状态>
:::
每行一个指标。状态请从以下词中选择：正常 / 偏高 / 偏低 / 良好 / 关注。数值和单位必须分开写在不同栏位。`,
  takeaway: `- 关键要点卡（最多一个区块，1-2 句）：
:::takeaway
<一句可执行的具体建议>
:::
必须是明确的陈述式建议，不得写成问句，也不得写成"需要我帮你……吗"这类征询语气。`,
  dots: `- 原粒推荐卡（最多一个区块）：
:::dots
<编号>号原粒 <名称> | <服用说明>
:::
编号与名称之间用空格分隔，不要用竖线；竖线只用于分隔后面的服用说明。`,
};

const CARD_EN = {
  metric: `- Biomarker value card (at most one block, at most 4 rows):
:::metric
<label> | <value> | <unit> | <status>
:::
One biomarker per line. Status must be one of: normal / high / low / good / watch. Keep the value and the unit in separate fields.`,
  takeaway: `- Key takeaway card (at most one block, 1-2 sentences):
:::takeaway
<one concrete, actionable next step>
:::
It must be a directive statement — never a question, and never an offer along the lines of "would you like me to...".`,
  dots: `- Dot recommendation card (at most one block):
:::dots
DOT-N<number> <name> | <dosage note>
:::
Separate the id and the name with a SPACE, not a pipe; the pipe only separates the dosage note that follows.`,
};

function getOutputFormatBlock({ isZh = true, rich = false, allow = ['takeaway'] } = {}) {
  if (!rich) return '';
  const picked = allow.filter((k) => (isZh ? CARD_ZH : CARD_EN)[k]);
  if (picked.length === 0) return '';

  if (isZh) {
    return `【展示格式】
除普通 Markdown 外，你可以使用下列 ::: 区块，客户端会把它们渲染成专门的卡片。区块必须独占整行，并以单独一行的 ::: 结束。

${picked.map((k) => CARD_ZH[k]).join('\n\n')}

使用规则：
- ::: 区块不是 Markdown 标题，也不是列表。上文关于"不使用标题/少用列表"的规则对正文散文依然完全有效，不因这些区块而放宽。
- 区块是可选的。没有值得单独强调的内容时就不要用，正常写散文即可。
- 每个数值只写一次：放进 metric 卡后，正文中可以提及该指标，但不要重复写出数字。
- 如果本次回复还需要附带 action JSON（record_weight / set_reminder / remember_fact / ask_questions 等），该 JSON 必须放在所有 ::: 区块之后的最后一行。
- 正文散文用 **加粗** 强调，不要用 *斜体*。表格最多 3 列。不要输出裸链接或 [文字](网址) 形式的链接。`;
  }

  return `[DISPLAY FORMAT]
In addition to ordinary markdown, you may use the ::: blocks below — the client renders them as purpose-built cards. A block must occupy whole lines of its own and close with a lone ::: line.

${picked.map((k) => CARD_EN[k]).join('\n\n')}

Rules:
- A ::: block is NOT a markdown heading and NOT a bullet list. The instructions above about avoiding headings / limiting lists still apply in full to your prose — these blocks do not relax them.
- Blocks are optional. If nothing genuinely warrants one, just write prose.
- State each number exactly once: put it in the metric card, then refer to the biomarker in prose without repeating the figure.
- If this reply also carries an action JSON (record_weight / set_reminder / remember_fact / ask_questions), that JSON goes on the very last line, AFTER every ::: block.
- Use **bold** for emphasis in prose, not *italics*. Tables: 3 columns maximum. Do not emit bare URLs or [text](url) links.`;
}

module.exports = { getOutputFormatBlock };
