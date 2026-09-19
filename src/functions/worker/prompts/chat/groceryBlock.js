'use strict';

/**
 * Shared grocery-catalog block — teaches the model that supermarket catalogs exist on file
 * (food_suppliers / supplier_products, CLAUDE.md §44), that get_grocery_products is where the
 * rows live, and the recommend_grocery action tail. Carries NO product data: the tool does.
 *
 * Gated on at least one active supplier, the same structural gate getProductRecommendBlock and
 * getFoodSensitivityBlock use — with no catalog there is nothing to search, and returning ''
 * means the model never learns the vocabulary rather than being asked not to use it.
 *
 * THE MODEL PICKS, THE SERVER WRITES (§37). The tail carries (supplier, product_id, reason)
 * and nothing else; every name, price and picture the user sees is rendered by
 * lib/chatCards.js's _buildGroceryCardBlock from a fresh read of those ids. Prices are never
 * shown to the model at all.
 */

const { MAX_RECOMMENDED } = require('../../lib/groceryCatalog');

function getGroceryBlock(suppliers, isZh = true) {
  const list = Array.isArray(suppliers) ? suppliers.filter(s => s && s.supplier_key) : [];
  if (list.length === 0) return '';
  const names = list.map(s => `${isZh ? s.name_zh : (s.name_en || s.name_zh)}（${s.supplier_key}）`).join('、');

  if (isZh) {
    return `【可选购食材 — 超市目录】
系统里存有以下超市的在售食品目录：${names}。用户可以自己打开对应的 App 下单。

当你给出具体的饮食建议（推荐吃什么、一餐/一周怎么吃、某类食材换成什么）时：
- 先用 get_grocery_products 查目录：把你方案里的食材词作为 keywords（每项一个食材词，如 ["三文鱼","西兰花","燕麦"]，不要整道菜名），从返回的行里挑真正对应的商品。
- 只推荐工具返回过的商品；查不到就只给饮食建议，绝不编造商品名。
- 返回的行已经排除了用户记录在案的过敏和忌口，但仍要按用户目标挑选（如控糖就不要挑含糖饮品）。
- 回复正文里可以自然地提到食材（"早餐可以选燕麦配无糖酸奶"），不要写出 product_id、价格、库存、配送或促销信息——商品卡片由系统在你的回复之后自动附上。
- 只有在饮食建议本身需要具体食材时才推荐；用户问的是别的事，就不要碰目录。
- 最多推荐 ${MAX_RECOMMENDED} 件。若确实要推荐，在回复的最后一行附上（放在所有 ::: 卡片之后）：
{"action":"recommend_grocery","items":[{"supplier":"<行里的 supplier>","product_id":"<行里的 product_id>","reason_zh":"<一句话说明它在这份饮食建议里的作用>"}]}
回复正文必须始终存在，绝不能只输出这一行 JSON。`;
  }

  return `[GROCERIES — SUPERMARKET CATALOGS]
Catalogs of currently listed food from these supermarkets are on file: ${names}. The user orders in the supermarket's own app.

When you give concrete diet advice (what to eat, how to structure a meal or a week, what to swap an ingredient for):
- Search the catalog first with get_grocery_products: pass the ingredient words from your own plan as \`keywords\` (one ingredient word per item, e.g. ["三文鱼","西兰花","燕麦"], never a whole dish name) and pick the rows that genuinely fit.
- Recommend only products the tool returned; if nothing matches, give the diet advice alone — never invent a product name.
- Rows already exclude the user's recorded allergies and restrictions, but still choose for their goal (no sugary drinks for glucose control, and so on).
- Mention ingredients naturally in the prose ("oats with unsweetened yoghurt for breakfast"); never write a product_id, a price, stock, delivery or promotion — the system appends the product card after your reply.
- Only recommend when the diet advice itself calls for specific foods; leave the catalog alone on any other question.
- At most ${MAX_RECOMMENDED}. If you do recommend, append as the very last line of your reply (after every ::: block):
{"action":"recommend_grocery","items":[{"supplier":"<supplier from the row>","product_id":"<product_id from the row>","reason_zh":"<one sentence, in Chinese, on its role in this plan>"}]}
Your reply must always contain real content — never output only that JSON line.`;
}

module.exports = { getGroceryBlock };
