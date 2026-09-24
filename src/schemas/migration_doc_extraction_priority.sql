-- The same knob viva_ag_jobs has: an operator can move a job ahead of the queue
-- without touching created_at. Default 0; the claim orders priority DESC first.
-- First use 2026-09-21: one premier partner's 21-page report ahead of 115 older
-- jobs that had been waiting on a worker nobody was running.
-- @requires: migration_doc_extraction_jobs.sql
ALTER TABLE doc_extraction_jobs ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 0;
