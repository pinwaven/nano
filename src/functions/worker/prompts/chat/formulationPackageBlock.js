'use strict';

/**
 * Shared vocabulary block for 原粒 · 定制营养素 · 28天 — what the user has BOUGHT, where that
 * order is, and what the three packages are. §28g.
 *
 * WHY THIS EXISTS. A user asked 「我已经买了什么原粒套餐?」 and Viva answered with a confident
 * recap of 17 dots "已激活并正在使用" — read out of `user_cartridges`, the Neo dispenser's
 * cartridge table, for a user with no active plan, nothing paid, and two orders sitting at
 * pending_payment. The chat model had no tool that could see an order and no vocabulary for the
 * product, so it reached for the only tool whose description sounded close. JUDGE passed it
 * because the answer WAS grounded — in the wrong table. §27 records that class: JUDGE checks
 * facts, not relevance.
 *
 * THIS BLOCK CARRIES NO DATA. Everything factual comes from the get_formulation_packages tool,
 * whose rows are read live from GCN at ask time and are never cached on a nano row — an order can
 * be refunded, cancelled or fulfilled between two reads (§28d). The block only teaches the model
 * that the domain exists and that the tool is where the answer lives.
 *
 * IT NAMES NO STAGE. The 12 PACKAGE_STAGES values and their meanings live in handlers/dots.js
 * (PACKAGE_STAGE_NARRATION) and reach the model on the row itself as `stage_meaning`/`next_step`.
 * A prompt enumerating them would be a third definition of that vocabulary in the one medium
 * where drift is invisible. Do not add one here; a test asserts no stage string appears in this
 * file.
 *
 * Gated on a GCN-linked channel, the same structural gate getProductRecommendBlock uses: with no
 * storefront there is no package to describe, and returning '' means the model never learns the
 * vocabulary at all rather than being asked not to use it.
 */

// Deterministic backstop, on the model of lib/agenticChat.js's BIOMARKER_HISTORY_TRIGGER_RE and
// for the same reason: PLAN decides `tools_needed` with an LLM and is unreliable, so a question
// about a purchase cannot depend on it. This regex force-queues get_formulation_packages, and
// separately rescues a purchase question that the intent classifier routed to formulate_dots.
//
// ANCHORED ON PURCHASE VOCABULARY ONLY — never on 方案/配方/定制 alone. The Formulate-Dots tool
// drives runAgenticTurn with its own trigger message (「请根据我的完整健康数据，为我配置一个 28 天
// 周期的 Dots 方案。」 and its EN twin, handlers/dots.js), which rides the same loop; matching it
// would force an irrelevant tool call into a formulation turn and, worse, the classifier override
// in handlers/chat.js would stop the tool from ever launching. A test pins both halves.
//
// Same risk acceptance as every other regex heuristic here: a false positive costs one extra
// read-only tool call, never a wrong answer.
const PACKAGE_TRIGGER_RE = /(买过|买了|购买|已购|下单|订单|付款|支付|发货|物流|快递|运单|到货|收到货|到哪|兑换码|激活码|套餐.*(有哪些|哪些|几种|区别|多少钱)|(有哪些|哪些).*套餐|轻享套装|臻选套装|尊享套装)|(bought|purchase[ds]?|\bdid i (buy|order|pay)\b|my order|order status|paid for|shipped|shipping|tracking|delivered|redeem code|which packages?|what packages?)/i;

function messageAsksAboutFormulationPackage(message) {
  return PACKAGE_TRIGGER_RE.test(message || '');
}

function getFormulationPackageBlock(enabled, isZh = true) {
  if (!enabled) return '';

  if (isZh) {
    return `【原粒套餐与订单】
Aeviva 有一款可购买的定制产品：「原粒 · 定制营养素 · 28天」，分三款套餐（轻享套装 / 臻选套装 / 尊享套装），由用户所属门店以兑换码的形式售出。

关于"我买了什么 / 我的订单到哪了 / 发货了吗 / 有哪些套餐"这类问题：
- 必须调用 get_formulation_packages 取得真实记录再回答。绝不可从原粒配方库、营养方案、服用计划或任何库存数据推断用户买过什么——那些数据回答的是别的问题。
- 每一行都自带 stage_meaning（这一步是什么意思）和 next_step（用户接下来该做什么）。直接引用它们，不要自己改写状态含义，也不要发明工具没有返回的状态。用中文向用户转述，不要把工具里的字段名或英文状态值原样写进回复。
- 每一行还带 formula_status。如果它说这一份套餐还没有绑定配方，那么里面放哪些原粒就是尚未确定的。你仍然可以正常给出原粒**建议**，但绝不可把这些原粒说成"已纳入/已包含/已在你的套餐里/已在你的方案中"——一个字都不行。哪怕配方库里的原粒都是真的，说它们已经在一份还没配的套餐里，就是编造。想知道最终会配什么，得先运行「营养定制」。
- max_distinct_dots 是这一款套餐"任意一周最多能同时服用几种原粒"的上限，不是它包含哪几种、也不是一共几种。只能说成"最多 N 种"。
- 只说这一行当前所处的这一步和它的 next_step，不要往后推演流程。要点：付款并不会自动生成配方，也不会自动进入任何后续环节，用户必须自己再运行一次「营养定制」并确认提交。因此回复里不得出现"系统会自动生成/自动进入/自动启动"这类描述——那会让用户一直等一件不会发生的事，订单就卡在那里。这是对你措辞的约束，不要把这段话本身抄进回复。
- 只在对话里生成过、但工具没有把它标为一笔订单的配方，不是一笔购买：没有付款、没有人在配制它，也不会有盒子寄出。这一点要说清楚，不要让用户以为已经买了。
- 如果工具返回没有任何套餐，就如实说还没有购买记录；如果工具明确报告订单系统暂时读不到，说读不到，绝不要把"读不到"说成"你没有买过"。
- 订单与物流信息（下单日期、发货状态、运单号、承运商）由系统本次通过工具明确提供，属于"本次对话中明确提供"的范畴，可以据实转述。但不得在此基础上推断任何未提供的内容：不写送达时间、不写价格、不写库存、不写优惠。
- 本 App 不对这款产品定价（门店在上游售出兑换码），所以任何金额都是编造的。一个数字都不要写。`;
  }

  return `[DOTS PACKAGES AND ORDERS]
Aeviva sells one custom product: 原粒 · 定制营养素 · 28天, in three packages (轻享套装 / 臻选套装 / 尊享套装), sold by the user's own store as a redeem code.

For any question about what they have bought, where an order is, whether it shipped, or what packages exist:
- Call get_formulation_packages and answer from the real record. Never infer a purchase from the Dots formulary, a nutrition plan, a dosing schedule or any inventory figure — those answer a different question.
- Every row carries its own stage_meaning (what this step is) and next_step (what the user does now). Use them as given; do not rewrite what a stage means and never invent a stage the tool did not return. Write them as ordinary prose — never quote a field name or a raw status value back to the user.
- Every row also carries formula_status. If it says no formula is attached, then which dots go in that package is undecided. You may still give normal dot ADVICE, but never describe those dots as "included in", "already in your package" or "already in your plan" — not in any wording. Every dot in the formulary is real; saying they are already in a package nobody has formulated is still fabrication. Finding out what it will actually contain means running the 营养定制 tool first.
- max_distinct_dots is the cap on how many different dots may run in any ONE WEEK of that package — not which dots it contains and not a total. Only ever state it as "up to N".
- Describe only the step a row is on and its next_step; do not narrate the steps after it. Note that paying does not generate a formula and does not advance anything on its own: the user must run the 营养定制 tool again themselves and confirm. So your reply must never say the system will generate, start or proceed automatically — that leaves them waiting for something that will never happen while the order sits there. This constrains your wording; do not copy this instruction into the reply.
- A formula that only exists in chat, which the tool does not report as an order, is NOT a purchase: nothing was paid, nobody is compounding it, and no box will arrive. Say so plainly rather than letting the user assume they have bought it.
- If the tool returns no packages, say there is no purchase on record. If it reports the order system could not be reached, say that — never report "unreachable" as "you haven't bought anything".
- Order and shipping facts (order date, shipped status, tracking number, carrier) are supplied to you by the tool in this very turn, so they count as explicitly provided and may be repeated as given. Do not extrapolate beyond them: no delivery estimate, no price, no stock level, no promotion.
- This app does not price this product — a store sells the redeem code upstream — so any amount would be invented. Write no figure at all.`;
}

module.exports = {
  getFormulationPackageBlock,
  messageAsksAboutFormulationPackage,
  PACKAGE_TRIGGER_RE,
};
