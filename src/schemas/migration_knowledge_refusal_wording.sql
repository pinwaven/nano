-- "Not enough information" is a qualifying sentence, never a whole reply.
--
-- WHAT WENT WRONG
--
-- The essential block handed the model a fixed sentence to copy verbatim:
--
--   如现有数据不足以支持某个判断，直接说："目前没有足够信息支持这个判断。"
--
-- A quoted, ready-made refusal is the cheapest thing in the prompt to emit, and prod shows the
-- model reaching for it in two shapes, 25 replies in 30 days:
--
--  * as the ENTIRE reply (message 61173, 2026-09-08 — 15 characters of refusal sitting above a
--    fully rendered 28-day :::formula card the user is invited to order; also 59250, 58763);
--  * as a self-contradiction — the refusal, then three paragraphs of specific, useful advice
--    (61136, 61129), which reads as the assistant disagreeing with itself.
--
-- Neither is what the rule was for. It exists to stop fabrication, not to hand out a dead end.
--
-- WHAT IS DELIBERATELY *NOT* LOOSENED
--
-- Nothing about fabrication changes. The model still may not invent a study, a number, a
-- mechanism or a product to fill a gap — it is told to NAME the gap and then continue with what
-- the data it does have supports. The new text adds two prohibitions that did not exist:
-- "insufficient" may not be the whole reply, and it may not be followed by the very advice it
-- just said could not be given.
--
-- Removing the quoted sentence is half the fix: with no canned string in the prompt there is
-- nothing to copy out verbatim.
--
-- The other half is not in this file. Formulate-Dots hit this hardest because it can run with no
-- Kino scan at all, and a formulation with no BioAge has nothing to scale its doses against — so
-- handlePostFormulaDots now refuses to formulate at all in that case and asks for a Kino scan,
-- rather than producing a card the narrative cannot justify. See handlers/dots.js.
--
-- KEEP IN SYNC with the two hardcoded fallback copies, used when this table is unreachable:
-- lib/knowledgeBase.js's FALLBACK_ESSENTIAL_BLOCK and prompts/chat/factConstraint.js's
-- FALLBACK_ZH / FALLBACK_EN (both already carry this wording). prompts/viva/systemReport.js
-- keeps its own copy of the line and was updated too.
--
-- Line-replaced rather than appended (contrast migration_knowledge_upgrade_copy.sql, which added
-- a clause that did not exist): this rewrites a rule already in the block, so it follows
-- migration_knowledge_store_products.sql's regexp_replace pattern. Idempotent via the WHERE.
--
-- @requires: migration_knowledge_entries.sql

UPDATE knowledge_entries
SET content_zh = regexp_replace(
        content_zh,
        '如现有数据不足以支持某个判断[^\n]*',
        '如现有数据不足以支持某个判断，说明缺的是哪一项数据、补上它需要做什么，然后继续把现有数据已经能支持的部分讲清楚。"信息不足"只能作为回复中的一句限定说明，绝不能构成整条回复的全部内容；也不得先声明信息不足、随后又给出大段具体建议而自相矛盾。',
        'g'
    ),
    updated_at = NOW()
WHERE tier = 'essential'
  AND content_zh ~ '如现有数据不足以支持某个判断，直接说';
