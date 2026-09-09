-- Provenance: which uploaded document an extracted report was read out of.
--
-- Extraction auto-writes (no confirm-first step), so every row it creates has to be findable
-- again — both for the user's own 解析有误 correction and for a re-run, which MUST delete the
-- previous extraction before re-inserting. Without that delete, health_events' dedup index on
-- (user_id, source, external_id) turns a corrected value for the same marker and date into a
-- silent DO NOTHING, and the user's correction appears to do nothing at all.
--
-- ON DELETE SET NULL, not CASCADE: health_documents deletes are SOFT (status='deleted'), but a
-- hard delete arriving some other way must not take a report — and its health_events children,
-- and the twin's lab panel — with it. A report read off a document is still a real report.
ALTER TABLE health_reports
    ADD COLUMN IF NOT EXISTS source_document_id BIGINT REFERENCES health_documents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_health_reports_source_document
    ON health_reports(source_document_id)
    WHERE source_document_id IS NOT NULL;

-- health_reports.source is free TEXT (documented values, no CHECK). Extraction writes
-- 'document_extraction', which is load-bearing rather than cosmetic: health_events dedupes on
-- (user_id, source, external_id), so a distinct source keeps extracted observations from
-- colliding with hand-entered ones for the same marker and day, and makes every row this
-- feature created selectable in one predicate.
