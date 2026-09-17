-- Rescope the aspirational-copy exception from "upgrade rungs" to "each package's positioning line".
--
-- WHY
--
-- migration_knowledge_upgrade_copy.sql added an exception scoped BY NAME to the formulation card's
-- `"upgrades"` field. Two things have happened to that field since:
--
--   1. It stopped existing. The `tier` tag and the `upgrades` array were removed from both
--      systemFormulaGenerate.js prompts on 2026-09-07 — nine measured qwen-plus runs never once
--      produced the requested partition — and the copy moved to a second, tightly-scoped call
--      (lib/tierCopy.js) that is shown the dots it is describing.
--   2. The card stopped having rungs at all. Since 2026-09-10 it draws three COMPLETE formulas,
--      one per purchasable package, because GCN's migration_0107/0108 renamed the tiers off their
--      dot counts (轻享套装 / 臻选套装 / 尊享套装) and gave each its own positioning line. The
--      narrowest package now gets a line of its own, and "upgrade copy" no longer describes it.
--
-- So the exception was scoped to a field no prompt asks for, and did not cover the narrowest
-- package's line at all. An exception that names nothing is not a safe exception: the always-
-- injected essential block reads every claim as a clinical one, which is what made this clause
-- necessary in the first place (see the migration above for that reasoning in full).
--
-- WHAT IS STILL NOT LOOSENED — unchanged, and restated verbatim inside the clause:
--
--  * No onset window, improvement magnitude, numeric forecast, or guarantee of results.
--  * No invented ingredient, mechanism or effect. What is permitted is tone and framing.
--  * Dot numbers, names and ingredients stay verbatim from the formulary.
--  * No price, stock level, or purchase channel. nano does not price this product — a store sold
--    the code upstream and redemption charges nothing — so any number here would be invented.
--  * Still scoped by name, now to the card's per-package positioning line. It says nothing about
--    the prose analysis, the recommendable-products reason, or any other reply.
--
-- Both personas, for the same reason as the migration it supersedes: the ladder is gated on the
-- aeviva channel's commerce, not on persona.
--
-- Line-replaced rather than appended, so the clause keeps its position in the block and the two
-- hardcoded fallbacks stay paragraph-for-paragraph identical to the row. Guarded on the old
-- marker and idempotent: a second run matches nothing. A row an admin has edited past recognition
-- is left alone rather than half-rewritten — check `content_zh` by hand if this reports 0 rows on
-- an environment that should have had one.
--
-- KEEP IN SYNC with the two hardcoded fallback copies, used when this table is unreachable:
-- lib/knowledgeBase.js's FALLBACK_ESSENTIAL_BLOCK and prompts/chat/factConstraint.js's
-- FALLBACK_ZH / FALLBACK_EN. If those drift, a transient DB error silently returns the model to
-- refusing to write package copy at all — a card with three unlabelled packages and no error
-- anywhere.
--
-- @requires: migration_knowledge_entries.sql, migration_knowledge_upgrade_copy.sql

UPDATE knowledge_entries
SET content_zh = regexp_replace(
      content_zh,
      '升级文案例外[^\n]*',
      '套餐文案例外（仅适用于配方卡上每一款原粒套餐的那一句定位说明）：为一款套餐撰写的那句话，可以使用向往式、有画面感的产品介绍语气，不必逐字挂靠某一项指标——它是产品介绍，不是疗效承诺。上述禁令在此处全部照常生效：不得写出起效时间、改善幅度、任何数值预测或效果保证；不得编造成分、作用机制或功效；原粒的编号、名称与成分仍必须逐字取自配方库；也不得写出价格、库存或购买渠道。',
      'g'),
    updated_at = NOW()
WHERE tier = 'essential'
  AND content_zh LIKE '%升级文案例外%';
