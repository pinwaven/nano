-- health_twin: materialized digital twin summary, one row per user.
-- Updated in real time after each health_events insert.
-- AI prompts read from this table for fast profile access.

CREATE TABLE IF NOT EXISTS health_twin (
    user_id TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,

    -- 7-day rolling averages: vitals
    avg_hrv_ms FLOAT,
    avg_resting_hr FLOAT,
    avg_spo2 FLOAT,

    -- 7-day rolling averages: sleep
    avg_sleep_hours FLOAT,
    avg_sleep_score FLOAT,
    avg_deep_sleep_pct FLOAT,

    -- 7-day rolling averages: activity
    avg_daily_steps INTEGER,
    avg_active_minutes INTEGER,

    -- Latest body composition
    latest_weight_kg FLOAT,
    latest_bmi FLOAT,
    latest_body_fat_pct FLOAT,

    -- Latest annual lab panel
    latest_lab_data JSONB,
    latest_lab_date DATE,

    -- Latest Kino scan (denormalized from biomarkers table)
    latest_bio_age FLOAT,
    latest_sub_ages JSONB,
    latest_kino_scan_at TIMESTAMPTZ,

    -- 30-day trend signals
    -- { hrv_trend, sleep_trend, weight_trend_kg, bio_age_trend }
    trend_data JSONB,

    -- Last data point per category
    -- { sleep, activity, vitals, lab_result, body_composition }
    data_coverage JSONB,

    last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
