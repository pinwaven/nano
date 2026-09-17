-- @requires: migration_health_documents.sql
--
-- Lets document extraction record what a clinic note actually says about the person: a
-- penicillin allergy, a diagnosis, a dietary restriction.
--
-- These go HERE and not into users.bio_data.health_conditions. bio_data writes are a shallow
-- `bio_data || $1::jsonb` merge at every call site, so writing health_conditions would replace
-- the user's own onboarding checklist wholesale with OCR output. user_memory_facts already
-- carries per-row category/status/source, has an admin and coach CRUD UI plus a user-facing
-- surface (CLAUDE.md 34), and is already read into every prompt and into the AG twin bundle.
--
-- Two extensions, both narrow:
--   'condition'          — a diagnosis. The existing five categories have no home for one.
--   'document_extracted' — provenance, so an extracted fact is distinguishable from one the
--                          user said in chat or an admin typed, and so the whole set can be
--                          removed when the user corrects the extraction it came from.
--
-- BE CLEAR ABOUT THE STAKES: an 'allergy' row here is what _filterProductsByUserFacts
-- (CLAUDE.md 37) uses to suppress store recommendations, and it reaches dot formulation. A
-- misread allergy is a sharper failure than a misread lab value, which is why the extraction
-- validator holds findings to a HIGHER confidence floor than observations and why every
-- extracted fact is labelled as document-derived in the UI.
ALTER TABLE user_memory_facts DROP CONSTRAINT IF EXISTS user_memory_facts_category_check;
ALTER TABLE user_memory_facts ADD CONSTRAINT user_memory_facts_category_check
    CHECK (category IN ('dietary_restriction', 'allergy', 'preference', 'goal', 'condition', 'other'));

ALTER TABLE user_memory_facts DROP CONSTRAINT IF EXISTS user_memory_facts_source_check;
ALTER TABLE user_memory_facts ADD CONSTRAINT user_memory_facts_source_check
    CHECK (source IN ('chat_extracted', 'admin_added', 'document_extracted'));

ALTER TABLE user_memory_facts
    ADD COLUMN IF NOT EXISTS source_document_id BIGINT REFERENCES health_documents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_user_memory_facts_source_document
    ON user_memory_facts(source_document_id)
    WHERE source_document_id IS NOT NULL;
