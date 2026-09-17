-- @requires: migration_health_reports_source_document.sql
--
-- health_report_items: every analyte the extraction agent read off a document, one row each —
-- MAPPED (key_name set, also written to health_events(lab_result) for the twin) and UNMAPPED
-- (key_name NULL, kept exactly as printed).
--
-- Why this exists. biomarker_catalog is a fixed vocabulary — ~75 keys after
-- migration_biomarker_catalog_v2.sql — and a real document carries far more: a 74-item
-- organic-acid panel, a 39-element hair panel, a 体检's full CBC differential. Everything outside
-- the catalog used to survive only inside doc_extraction_jobs.result JSON, which nothing reads:
-- not the twin, not the miniapp, not a chat tool, not the Viva AG bundle. The user paid for a
-- test and the app kept none of it. This table is the RECORD; health_events stays the twin FEED.
--
-- Not a vocabulary extension. An unmapped row is stored under its printed label and never
-- resolved to a neighbouring catalog key (§11's rule: drop or keep verbatim, never guess). It
-- feeds no computation — no BioAge, no formulation, no reference-range verdict beyond the flag
-- the report itself printed. It can be read back per label across reports, which is what makes a
-- catalog extension later a backfill (UPDATE key_name WHERE label matches) rather than a re-scan.
--
-- Lifecycle follows the report: a re-run or 解析有误 deletes the report row (clearExtraction) and
-- the items cascade with it.
CREATE TABLE IF NOT EXISTS health_report_items (
    id                  BIGSERIAL PRIMARY KEY,
    report_id           BIGINT NOT NULL REFERENCES health_reports(id) ON DELETE CASCADE,
    user_id             TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    source_document_id  BIGINT REFERENCES health_documents(id) ON DELETE SET NULL,
    key_name            TEXT,                       -- biomarker_catalog.key_name when mapped, else NULL
    label               TEXT NOT NULL,              -- the analyte name as printed
    value_num           NUMERIC,                    -- when the printed value is a plain number
    value_text          TEXT,                       -- otherwise: "<0.1", "阴性", "3+" … verbatim
    unit                TEXT,                       -- as printed (catalog unit for mapped rows)
    ref_text            TEXT,                       -- the printed reference range, verbatim
    flag                TEXT CHECK (flag IN ('high', 'low')),   -- the report's own ↑/↓; NULL = not flagged
    section             TEXT,                       -- panel heading the row sat under, if any
    data_date           DATE NOT NULL,
    sort_order          INTEGER NOT NULL DEFAULT 0, -- page order, so the record reads like the report
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_health_report_items_report
    ON health_report_items(report_id, sort_order);

-- Per-label history across reports ("my NAD+ over the last three tests").
CREATE INDEX IF NOT EXISTS idx_health_report_items_user_label
    ON health_report_items(user_id, label, data_date DESC);

CREATE INDEX IF NOT EXISTS idx_health_report_items_user_key
    ON health_report_items(user_id, key_name, data_date DESC)
    WHERE key_name IS NOT NULL;
