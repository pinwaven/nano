-- health_reports: document-level wrapper for complete lab/health reports uploaded by users
-- Stores metadata about the report; individual observations are linked via health_events.report_id
-- Sources: 'manual_upload' | 'lab_api' | 'fhir_import' | 'hl7'

CREATE TABLE IF NOT EXISTS health_reports (
    id           BIGSERIAL PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    report_date  DATE NOT NULL,
    source       TEXT NOT NULL,       -- 'manual_upload' | 'lab_api' | 'fhir_import'
    institution  TEXT,                -- hospital or lab name
    report_type  TEXT,                -- 'annual_checkup' | 'lab_panel' | 'imaging' | 'other'
    status       TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'parsed' | 'error'
    oss_key      TEXT,                -- original file in OSS (PDF, image, etc.)
    raw_data     JSONB,               -- parsed/normalized representation of the report
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_health_reports_user
    ON health_reports(user_id, report_date DESC);

-- Link health_events rows to the report they came from
ALTER TABLE health_events ADD COLUMN IF NOT EXISTS report_id BIGINT REFERENCES health_reports(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_health_events_report_id
    ON health_events(report_id)
    WHERE report_id IS NOT NULL;
