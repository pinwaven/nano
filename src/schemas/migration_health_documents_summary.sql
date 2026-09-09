-- @requires: migration_health_documents.sql
--
-- A plain-language summary of the document, written by the external extraction agent.
--
-- Lives on the document, not on health_reports: a discharge summary or clinic note routinely has
-- no observations and no parseable date, so it produces no report row at all — and that is
-- exactly the document whose summary is most worth having.
--
-- UNTRUSTED TEXT. It is written by an external system and later read by an LLM and rendered in
-- the miniapp, so it is sanitized on ingest the same way viva_ag_jobs.result_summary is: ':::'
-- display-card fences are stripped, because that syntax is interpreted by the chat renderer and
-- an external system emitting it could render arbitrary UI in the user's chat. Never feed this
-- column into a prompt as though it were nano's own record.
ALTER TABLE health_documents
    ADD COLUMN IF NOT EXISTS summary TEXT;

ALTER TABLE health_documents
    ADD COLUMN IF NOT EXISTS summary_generated_at TIMESTAMPTZ;
