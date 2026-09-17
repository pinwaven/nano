-- A chronic food-sensitivity (IgG) panel a user uploaded as a 健康文档. CLAUDE.md §40.
--
-- One row per test, its results in food_sensitivity_results. Deliberately NOT health_reports +
-- health_events(lab_result): see migration_food_catalog.sql's header for why a food panel
-- entering the lab pipeline would wipe the clinical panel out of health_twin.latest_lab_data.
--
-- class_bands stores ONLY the bands the page actually printed. This report prints
-- 轻度慢性过敏 (50.0-100.0) because the user has a class-1 result, and prints no class-2 or
-- class-3 band at all because they have none. The class itself is read off the page; the band
-- is a cross-check when present, never a rule for re-deriving a class we were given.

CREATE TABLE IF NOT EXISTS food_sensitivity_panels (
    id                 BIGSERIAL PRIMARY KEY,
    user_id            TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    source_document_id BIGINT REFERENCES health_documents(id) ON DELETE SET NULL,
    panel_key          TEXT NOT NULL,
    unit               TEXT NOT NULL,
    sampled_at         DATE,
    report_date        DATE NOT NULL,
    institution        TEXT,
    sample_no          TEXT,
    class_bands        JSONB NOT NULL DEFAULT '[]'::JSONB,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fs_panels_user ON food_sensitivity_panels (user_id, report_date DESC);
CREATE INDEX IF NOT EXISTS idx_fs_panels_doc  ON food_sensitivity_panels (source_document_id)
    WHERE source_document_id IS NOT NULL;
