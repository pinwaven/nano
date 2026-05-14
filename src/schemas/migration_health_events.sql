-- health_events: raw, append-only time-series log for wearable, sleep, activity, and lab data
-- Categories: 'sleep' | 'activity' | 'vitals' | 'lab_result' | 'body_composition'
-- Sources:    'apple_health' | 'garmin' | 'fitbit' | 'manual' | 'annual_lab' | 'hospital'

CREATE TABLE IF NOT EXISTS health_events (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    category TEXT NOT NULL,
    data_date DATE NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL,
    data JSONB NOT NULL,
    external_id TEXT,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_health_events_user_date
    ON health_events(user_id, data_date DESC);

CREATE INDEX IF NOT EXISTS idx_health_events_user_category_date
    ON health_events(user_id, category, data_date DESC);

-- Deduplication: ignore repeated syncs from the same source with the same external ID
CREATE UNIQUE INDEX IF NOT EXISTS idx_health_events_dedup
    ON health_events(user_id, source, external_id)
    WHERE external_id IS NOT NULL;
