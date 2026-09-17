-- @requires: migration_tag_catalog.sql
-- @requires: migration_health_documents.sql
--
-- health_document_tags: what a document says ABOUT THE PERSON, one row per statement, contract
-- version 3 (CLAUDE.md §39). The record behind user_memory_facts, the way health_report_items
-- is the record behind health_events(lab_result).
--
-- Two kinds, and the distinction is the whole point of the table:
--   fact       — tag_key resolves in tag_catalog. ACTED ON: lib/documentTags.js resolves the
--                newest `since` per tag_key across all of the user's documents and mirrors the
--                CURRENT ones whose catalog row has a memory_category into user_memory_facts,
--                which is what product filtering and formulation already read. Earlier rows are
--                kept as history — a 2024 「服用他汀」 and a 2026 「已停用」 resolve to stopped
--                without losing that it was once current.
--   descriptor — tag_key is NULL: the agent's key resolved to nothing (reason = unknown_tag),
--                or the agent sent none, or the row is a contract-2 `finding`. NEVER ACTED ON:
--                displayed under the document, kept for re-promotion when the catalog gains its
--                alias (lib/repromotion.js), and nothing in formulation, filtering or
--                recommendation may read it.
--
-- `text` is the document's own words, verbatim (an anchoring check on the agent's side drops
-- anything that is not a substring of the page). `source_ref` points at the cell of the
-- document's `structured` block it was read from ("s2.p4" = section 2, pair 4).
--
-- Lifecycle follows the extraction: clearExtraction deletes this document's rows and re-syncs
-- the user's mirrored facts from whatever remains.
CREATE TABLE IF NOT EXISTS health_document_tags (
    id            BIGSERIAL PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    document_id   BIGINT NOT NULL REFERENCES health_documents(id) ON DELETE CASCADE,
    kind          TEXT NOT NULL CHECK (kind IN ('fact', 'descriptor')),
    tag_key       TEXT,                                   -- tag_catalog.tag_key; NULL for a descriptor
    category      TEXT NOT NULL CHECK (category IN (
                      'allergy', 'condition', 'medication', 'diet', 'lifestyle',
                      'result', 'family_history', 'procedure', 'other')),
    text          TEXT NOT NULL,                          -- the document's words, ≤200
    value         TEXT,                                   -- a result tag's admitted value
    status        TEXT NOT NULL DEFAULT 'current' CHECK (status IN ('current', 'past', 'stopped')),
    since         DATE,                                   -- defaults to the document's date; never today
    source_ref    TEXT,                                   -- "s0.t0.r3" / "s2.p1" into extracted_json
    confidence    NUMERIC(4,3),
    reason        TEXT,                                   -- why a fact became a descriptor (unknown_tag, …)
    sort_order    INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT health_document_tags_fact_has_key CHECK (kind = 'descriptor' OR tag_key IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_health_document_tags_document
    ON health_document_tags (document_id, sort_order);

-- The resolution query: newest `since` per tag_key for one user.
CREATE INDEX IF NOT EXISTS idx_health_document_tags_user_key
    ON health_document_tags (user_id, tag_key, since DESC, id DESC)
    WHERE tag_key IS NOT NULL;
