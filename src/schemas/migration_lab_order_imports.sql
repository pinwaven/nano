-- @requires: migration_health_report_items.sql, migration_doc_extraction_jobs.sql
-- lab_orders predates tracked migrations. Never stores the lab API credentials here.
CREATE TABLE IF NOT EXISTS lab_order_imports (
    order_id BIGINT PRIMARY KEY REFERENCES lab_orders(id) ON DELETE CASCADE,
    revision TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued','processing','imported','waiting','failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    counts JSONB NOT NULL DEFAULT '{}',
    error TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lab_order_imports_status ON lab_order_imports(status, updated_at);
ALTER TABLE health_reports ADD COLUMN IF NOT EXISTS lab_order_id BIGINT REFERENCES lab_orders(id) ON DELETE SET NULL;
ALTER TABLE health_reports ADD COLUMN IF NOT EXISTS lab_goods_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_health_reports_lab_good
    ON health_reports(lab_order_id, lab_goods_id) WHERE lab_order_id IS NOT NULL;
