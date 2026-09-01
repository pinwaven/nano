-- Narrow the "only recommend from the formulary, never suggest an outside purchase" rule so Viva
-- may also recommend from a store catalog explicitly provided in its own prompt.
--
-- WHY THIS RULE HAD TO CHANGE AT ALL
--
-- The aeviva-china channel's GCN storefront carries real products beyond Dots. Before this,
-- Viva was not merely unaware of them — it was instructed to refuse: the always-injected
-- essential block said every ingredient/supplement suggestion must come from the Dots formulary
-- and that no purchase channel may ever be named. No amount of catalog data in the prompt would
-- have overridden that.
--
-- WHAT IS DELIBERATELY *NOT* LOOSENED
--
--  * "never from outside knowledge" survives intact — the model still may not recommend a brand
--    or product recalled from training data. The door opens exactly as far as the prompt's own
--    provided list, and no further.
--  * The company-business-info ban (prices, stock, delivery times, promotions) is untouched, and
--    the new text reinforces it: the model explains WHY an item is relevant and nothing else.
--    Prices and stock are appended by the server from its own fetched snapshot, the same
--    principle _buildFormulaChartBlock already applies to the formula chart -- so the numbers
--    the user sees can never disagree with the numbers the system holds.
--  * With no list in the prompt (every non-aeviva channel, and every aeviva turn the intent
--    classifier did not flag), the parenthetical makes the rule collapse back to formulary-only.
--
-- THE PATTERN MUST TOLERATE THE ADMIN PANEL'S OWN EDITS
--
-- This text is editable from the admin panel (handlers/knowledge.js), and it HAS been edited:
-- dev's live row opens the paragraph with 仅推荐原粒 (the Chinese product name), not the seed
-- file's 仅推荐 Dots. A first version of this migration matched only the seed wording and applied
-- as a silent no-op — caught by inspecting the row afterwards rather than trusting the exit code.
-- The pattern therefore anchors on the parts that have stayed stable (仅推荐 … 不建议外购：) and
-- the replacement names both terms, so it reads correctly whichever one a channel has settled on.
--
-- Line-scoped regexp_replace rather than rewriting content_zh wholesale, so unrelated local edits
-- elsewhere in the block survive. Idempotent: once the old line is gone the pattern no longer
-- matches and a re-run is a no-op.
--
-- KEEP IN SYNC with the two hardcoded fallback copies, used when this table is unreachable:
-- lib/knowledgeBase.js's FALLBACK_ESSENTIAL_BLOCK and prompts/chat/factConstraint.js's
-- FALLBACK_ZH / FALLBACK_EN. If those drift back, a transient DB error silently returns Viva to
-- refusing to discuss any product at all.
UPDATE knowledge_entries
SET content_zh = regexp_replace(
        content_zh,
        '仅推荐[^\n]*不建议外购：[^\n]*',
        '只推荐已提供的产品：任何具体成分/补充剂/剂量建议都必须来自 Waven 原粒（Dots）配方库，或本提示词中明确列出的「可推荐商品」清单（若本次对话未提供该清单，则只有原粒可推荐）。绝不建议用户购买这两者之外的补充剂、草本、单体营养素或食材提取物（如“牛磺酸粉”“硫辛酸”“葡萄籽提取物”等），也不得凭训练记忆推荐任何品牌或产品。若两者都没有对应产品，直接说明“目前没有针对这一点的产品”，不得给出品牌、剂量或购买渠道建议。日常整体饮食/餐食建议不受此限制，但不得在饮食建议中夹带具体分离出的营养补充剂成分与剂量。
提及「可推荐商品」清单中的商品时：只说明它为什么与用户当前的情况相关，绝不可自行写出价格、库存、配送时效或优惠信息——这些由系统在你的回复之后自动附上，写出来只会与真实数据冲突。',
        'g'
    ),
    updated_at = NOW()
WHERE tier = 'essential'
  AND content_zh ~ '仅推荐[^\n]*不建议外购：';
