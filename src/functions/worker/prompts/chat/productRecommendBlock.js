'use strict';

/**
 * Shared store-catalog block — the reviewed, AI-approved slice of the user's own bound GCN
 * storefront, plus the recommend_product action instruction.
 *
 * Only ever populated for a GCN-linked channel (aeviva / aeviva-china) when the intent
 * classifier flagged `store_products` in required_data, i.e. when the user's own message asked
 * what they could obtain for a concern. Returns '' otherwise, so on every other turn the model
 * never learns this vocabulary and the essential block's rule collapses back to Dots-only —
 * which is what makes "Viva never volunteers a product" a structural property rather than an
 * instruction it could drift away from.
 *
 * THE MODEL PICKS, THE SERVER WRITES. The action tail carries sku ids and a reason, nothing
 * else. Every product name and price the user actually sees is rendered by
 * handlers/dots.js's _buildProductCardBlock from the same snapshot rendered here, never from
 * model output — the same rule _buildFormulaChartBlock follows so a chart can't disagree with
 * the numbers it draws. Prices are therefore deliberately NOT shown to the model at all: it
 * cannot leak a number it was never given.
 *
 * Parsing/validation of the action happens in handlers/chat.js's finalizeChatReply(), following
 * the same extract/validate-against-server-data/strip mechanism as record_weight, set_reminder,
 * remember_fact and formulate_dots.
 */

// A chat reply is not a product grid. Three is enough to be useful and few enough that the
// reply still reads as health advice that happens to mention a product, rather than an ad.
const MAX_RECOMMENDATIONS = 3;

function _fmtList(arr, max = 4) {
  if (!Array.isArray(arr) || arr.length === 0) return '';
  return arr.slice(0, max).join('、');
}

function getProductRecommendBlock(storeProducts, isZh = true) {
  const items = Array.isArray(storeProducts) ? storeProducts : [];
  if (items.length === 0) return '';

  const lines = items.map((p) => {
    const parts = [];
    if (p.summary_zh) parts.push(p.summary_zh);
    const ind = _fmtList(p.indications_zh);
    if (ind) parts.push(isZh ? `适用：${ind}` : `for: ${ind}`);
    const act = _fmtList(p.key_actives_zh);
    if (act) parts.push(isZh ? `成分：${act}` : `actives: ${act}`);
    const dim = _fmtList(p.sub_age_targets);
    if (dim) parts.push(isZh ? `对应维度：${dim}` : `dimensions: ${dim}`);
    const cau = _fmtList(p.cautions_zh);
    if (cau) parts.push(isZh ? `注意：${cau}` : `cautions: ${cau}`);
    if (p.in_stock === false) parts.push(isZh ? '当前缺货' : 'out of stock');
    return `• [${p.sku_id}] ${p.product_name_zh} — ${parts.join('；')}`;
  }).join('\n');

  if (isZh) {
    return `【可推荐商品 — 用户所属门店当前在售、且已通过审核】
${lines}

【推荐规则】
只有当用户这次明确在问"有什么可以用/可以买"这类问题，且清单中确实有真正对症的商品时，才推荐；否则正常回答，不要提及任何商品。宁可不推荐，也不要硬凑。
最多推荐 ${MAX_RECOMMENDATIONS} 件。优先 Dots 配方库中已有的方案，商城商品作为补充，不要用商品替代本该给出的健康建议。
绝不可自行写出价格、库存、配送或优惠信息，也不要写出上面方括号里的 ID——商品卡片由系统在你的回复之后自动附上，你只需用一句话说明它为什么与用户当前的情况相关。
若确实要推荐，在回复的最后一行附上（放在所有 ::: 卡片之后）：
{"action":"recommend_product","skus":[{"sku_id":"<上面方括号中的 ID>","reason_zh":"<一句话说明为什么适合这位用户>"}]}
回复正文必须始终存在，绝不能只输出这一行 JSON。`;
  }

  return `[RECOMMENDABLE PRODUCTS — currently sold by this user's own store, and review-approved]
${lines}

[RECOMMENDATION RULES]
Only recommend when the user is explicitly asking what they could use or obtain this turn, AND the list genuinely contains something that fits. Otherwise answer normally and mention no product at all — recommending nothing is always better than forcing a match.
At most ${MAX_RECOMMENDATIONS}. Prefer a solution from the Dots formulary first; store products supplement that, they never replace the health advice you would otherwise give.
Never write out a price, stock level, delivery detail or promotion, and never write out the bracketed ID — the system appends the product card to your reply automatically. Give one sentence on why it fits this user's situation.
If you do recommend, append as the very last line of your reply (after every ::: block):
{"action":"recommend_product","skus":[{"sku_id":"<the bracketed ID above>","reason_zh":"<one sentence, in Chinese, on why it suits this user>"}]}
Your reply must always contain real content — never output only that JSON line.`;
}

module.exports = { getProductRecommendBlock, MAX_RECOMMENDATIONS };
