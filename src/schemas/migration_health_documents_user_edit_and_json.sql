-- @requires: migration_health_documents_summary.sql
--
-- Two additions to health_documents, both for the extraction pipeline (CLAUDE.md §39).
--
-- user_edited_at — set by PATCH /health-documents/:id when the OWNER corrects doc_type,
-- doc_date or institution. While it is non-null the extraction result handler no longer
-- overwrites those three columns; the agent's reading fills a blank, it does not out-vote a
-- person. The case that forced this: a photographed report with no printed date has every value
-- refused as `missing_date` (dev job 15: six lipid/liver values lost), and the only remedy is for
-- the user to say when it was taken and re-run. That date must survive the re-run.
ALTER TABLE health_documents
    ADD COLUMN IF NOT EXISTS user_edited_at TIMESTAMPTZ;

-- extracted_json — the agent's `structured` block: content that is neither a numeric analyte
-- nor a durable personal fact. A gene-variant table, a microbiome abundance list, HPV subtype
-- results, a telomere or immune-age interpretation. Held as JSON exactly because it has no
-- schema per test type; nano stores it, renders it as a generic key/value tree and ships it to
-- the twin bundle. It DERIVES NOTHING from it.
--
-- UNTRUSTED, like `summary`: written by an external system, later read by an LLM and rendered
-- in the miniapp. Capped and sanitized on ingest (lib/docExtraction.js — size, depth, array
-- length, ':::' stripped from every string). Never feed it into a prompt as nano's own record.
ALTER TABLE health_documents
    ADD COLUMN IF NOT EXISTS extracted_json JSONB;

ALTER TABLE health_documents
    ADD COLUMN IF NOT EXISTS extracted_json_at TIMESTAMPTZ;
