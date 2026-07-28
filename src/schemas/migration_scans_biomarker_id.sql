-- Link a completed scan directly to the biomarker record it produced, so the
-- admin panel can reliably trace a tested chip -> its raw + validated results
-- without relying on the user_id/kino_device_id/time-window heuristic.
ALTER TABLE scans ADD COLUMN IF NOT EXISTS biomarker_id INTEGER REFERENCES biomarkers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_scans_biomarker_id ON scans(biomarker_id);
