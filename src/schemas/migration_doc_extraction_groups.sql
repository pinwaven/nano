-- Pages of one report, uploaded as separate photos, are read as one document.
--
-- A person photographs a lab report page by page and each photo becomes its own
-- health_documents row and its own extraction job. Read separately, page 2 has no
-- date (it is printed on page 1), no masthead to say what lab or what kind of
-- report it is, and no way to dedupe a value against page 3 — so it lands as an
-- undated `other` document with nothing stored. Seen on prod 2026-09-21: 21 JPEGs
-- from one premier partner in three minutes, 21 queued jobs, an empty twin.
--
-- Grouping happens lazily at claim time (like the lease sweep): queued jobs of one
-- user whose documents are images uploaded within DOC_GROUP_WINDOW of each other
-- become a group. The earliest is the head and is the only job the agent claims;
-- the rest move to status 'grouped' — not claimable, not swept — and are closed
-- when the head's result lands. A single upload has no group and nothing changes.
-- @requires: migration_doc_extraction_jobs.sql
ALTER TABLE doc_extraction_jobs ADD COLUMN IF NOT EXISTS group_uid  TEXT;
ALTER TABLE doc_extraction_jobs ADD COLUMN IF NOT EXISTS group_role TEXT;   -- 'head' | 'member'
CREATE INDEX IF NOT EXISTS idx_doc_extraction_jobs_group ON doc_extraction_jobs (group_uid) WHERE group_uid IS NOT NULL;

-- A grouped member is active: a re-parse of that page while its head is in flight
-- would race the head's write of the same rows.
DROP INDEX IF EXISTS uniq_doc_extraction_active;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_doc_extraction_active
    ON doc_extraction_jobs (document_id) WHERE status IN ('queued','claimed','processing','grouped');
