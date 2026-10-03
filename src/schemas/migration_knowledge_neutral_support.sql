-- The essential block's canned "ask customer service" line names no company.
--
-- fact-constraint-core told the model to answer business questions (shipping, prices, stock…)
-- with 「这个问题需要联系 Aeviva 客服…」. Viva now serves channels under another brand
-- (SuperiorMed, channels.config.brand_name, 2026-10-03), whose users have no Aeviva customer
-- service — a managed customer's contact is their coach. The two code fallbacks
-- (lib/knowledgeBase.js FALLBACK_ESSENTIAL_BLOCK, prompts/chat/factConstraint.js) already say the
-- neutral 「联系客服」; this brings the row in line (CLAUDE.md §26: three sites together).
-- Idempotent: a row without the old text is left alone.
UPDATE knowledge_entries
SET content_zh = replace(content_zh, '联系 Aeviva 客服', '联系客服'),
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'fact-constraint-core'
  AND content_zh LIKE '%联系 Aeviva 客服%';
