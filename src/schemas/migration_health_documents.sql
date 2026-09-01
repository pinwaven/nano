-- User-uploaded health record documents (PDFs of hospital records, discharge summaries,
-- imaging reports, prescriptions, ...). Backs the Viva AG subtab's document manager and is
-- handed to the external viva-ag agent as part of the twin bundle.
--
-- Deliberately NOT health_reports. That table means "a parsed lab report": report_date is
-- mandatory, raw_data carries observations, health_events.report_id children hang off it, and
-- it feeds get_health_reports plus the twin's Medical Records layer. A hospital discharge PDF
-- has no observations and often no reliably parseable date, so overloading that table would
-- conflate "parsed lab panel" with "arbitrary document blob" across several existing readers.
--
-- Digital Twin layer (CLAUDE.md 34): layer 3, Medical Records / 医疗记录.
CREATE TABLE IF NOT EXISTS health_documents (
    id           BIGSERIAL PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    -- Always namespaced 'health-documents/<user_id>/<hex>.<ext>', built server-side. The
    -- register endpoint rejects any key outside the caller's own prefix, so a caller cannot
    -- register someone else's object into their own document list.
    oss_key      TEXT NOT NULL UNIQUE,
    filename     TEXT NOT NULL,           -- original user-facing name, shown in the list
    content_type TEXT,                    -- 'application/pdf' | 'image/jpeg' | ...
    size_bytes   BIGINT,
    -- OSS ETag captured at register time via a HEAD. Lets a downloader verify that a large,
    -- possibly resumed, multi-hour PDF fetch completed intact.
    etag         TEXT,
    doc_type     TEXT NOT NULL DEFAULT 'other',
        -- 'hospital_record'|'lab_report'|'imaging'|'discharge_summary'|'prescription'|'other'
    doc_date     DATE,                    -- OPTIONAL, unlike health_reports.report_date
    institution  TEXT,
    note         TEXT,
    status       TEXT NOT NULL DEFAULT 'active',   -- 'active' | 'deleted'
    uploaded_by  TEXT NOT NULL DEFAULT 'user',     -- 'user' | 'coach' | 'admin'
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_health_documents_user
    ON health_documents(user_id, created_at DESC) WHERE status = 'active';

-- Delete is a SOFT delete, on purpose. A running viva_ag_jobs row can hold a 6-hour presigned
-- URL to an object for hours, and snapshots document ids in viva_ag_jobs.document_ids;
-- hard-deleting the object breaks the job mid-run and hard-deleting the row breaks that
-- snapshot. Soft delete keeps both intact and hides the row from every user-facing list.
-- Cost: orphaned OSS objects. Follow-up (not in this migration): a purge job that deletes OSS
-- objects for rows with deleted_at < NOW() - 30 days and no non-terminal job referencing them.
