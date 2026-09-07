-- Permit ASPIRATIONAL copy in the formulation card's upgrade rungs — and only there.
--
-- WHY THIS RULE HAD TO CHANGE AT ALL
--
-- The 营养定制 tool now proposes a nested ladder of formulas (the essential six, then +2, then
-- +2) when the user has bought nothing yet, and asks the model for one line of copy per rung
-- saying what the wider package completes. That copy is a product description, but the
-- always-injected essential block reads every claim as a clinical one: "predicted improvement
-- magnitudes", "specific onset windows" and the bar on introducing mechanisms not already in the
-- prompt together leave nothing a rung could legitimately say beyond restating a biomarker. The
-- model would either refuse the field or write something JUDGE then strips.
--
-- WHAT IS DELIBERATELY *NOT* LOOSENED
--
--  * Every hard ban is RESTATED inside the exception rather than suspended by it: no onset
--    window, no improvement magnitude, no numeric forecast, no guarantee of results, no invented
--    ingredient, mechanism or effect. What is permitted is tone and framing, not new facts.
--  * Dot numbers, names and ingredients stay verbatim from the formulary — the rung names real
--    dots the server has already validated, and a renamed one would not match the row beside it.
--  * The company-business-info ban is untouched and reinforced: no price, stock or purchase
--    channel. nano does not price this product (a store sold the code upstream, and redemption
--    charges nothing), so any number here would be one the model invented.
--  * Scoped to the "upgrades" field by name. It says nothing about the prose analysis, the
--    recommendable-products reason, or any other reply — those keep the rules they had.
--
-- Both personas: the ladder is gated on the aeviva channel's commerce, not on persona, and
-- prompts/{nano,viva}/systemFormulaGenerate.js both render the section.
--
-- Appended rather than line-replaced (contrast migration_knowledge_store_products.sql, which had
-- to rewrite an existing rule): this adds a clause that did not exist, so there is no local admin
-- edit for a pattern to miss. Idempotent via the marker in the WHERE.
--
-- KEEP IN SYNC with the two hardcoded fallback copies, used when this table is unreachable:
-- lib/knowledgeBase.js's FALLBACK_ESSENTIAL_BLOCK and prompts/chat/factConstraint.js's
-- FALLBACK_ZH / FALLBACK_EN. If those drift, a transient DB error silently returns the model to
-- refusing to write a rung at all — which is a card with the upsell missing and no error anywhere.
-- Appends to the end of the block, so it must run after the migration that creates the rows AND
-- after the one that last rewrote a paragraph in them — otherwise the clause order here stops
-- matching the two hardcoded fallbacks, which are the thing it has to stay in sync with.
--
-- @requires: migration_knowledge_entries.sql, migration_knowledge_store_products.sql

UPDATE knowledge_entries
SET content_zh = content_zh || E'\n\n升级文案例外（仅适用于配方卡要求的 "upgrades" 字段）：为更宽的原粒套餐撰写的那一句升级说明，可以使用向往式、有画面感的产品介绍语气，不必逐字挂靠某一项指标——它是产品介绍，不是疗效承诺。上述禁令在此处全部照常生效：不得写出起效时间、改善幅度、任何数值预测或效果保证；不得编造成分、作用机制或功效；原粒的编号、名称与成分仍必须逐字取自配方库；也不得写出价格、库存或购买渠道。',
    updated_at = NOW()
WHERE tier = 'essential'
  AND content_zh NOT LIKE '%升级文案例外%';
