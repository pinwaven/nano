-- @requires: migration_user_memory_facts_food.sql
-- @requires: migration_tag_catalog.sql
--
-- tag_key on user_memory_facts: the mirror of a document tag (health_document_tags, contract
-- version 3). Same pattern as food_key (§40): a fact carrying a tag_key is MANAGED — lib/
-- documentTags.js inserts it when the resolved status of that key is `current` and deactivates
-- it when a newer document says `stopped` / `past`, or when the document it came from is
-- cleared. A fact without one (the user's own words in chat, an admin's entry) is never touched
-- by that sync, even when it reads the same as a document tag.
--
-- 'medication' joins the category CHECK because a current medication is a fact with a
-- consumer-in-waiting (interaction checks) and no existing category is honest for it. It is
-- rendered by getFactMemoryBlock like any other fact, so its fact_zh is the catalog's short
-- name_zh (二甲双胍), never the document's sentence — §27's "fact_zh must stay short" rule.
ALTER TABLE user_memory_facts DROP CONSTRAINT IF EXISTS user_memory_facts_category_check;
ALTER TABLE user_memory_facts ADD CONSTRAINT user_memory_facts_category_check
    CHECK (category IN ('dietary_restriction', 'allergy', 'preference', 'goal', 'condition', 'medication', 'other'));

ALTER TABLE user_memory_facts
    ADD COLUMN IF NOT EXISTS tag_key TEXT;

CREATE INDEX IF NOT EXISTS idx_user_memory_facts_tag
    ON user_memory_facts (user_id, tag_key) WHERE tag_key IS NOT NULL;
