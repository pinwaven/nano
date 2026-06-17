CREATE TABLE IF NOT EXISTS digital_assets (
    id               SERIAL PRIMARY KEY,
    type             TEXT NOT NULL,
    title            TEXT NOT NULL,
    title_zh         TEXT,
    oss_key          TEXT NOT NULL,
    content_type     TEXT NOT NULL DEFAULT 'audio/mpeg',
    duration_seconds INTEGER,
    channel_id       INTEGER REFERENCES channels(id) ON DELETE SET NULL,
    is_active        BOOLEAN NOT NULL DEFAULT true,
    sort_order       INTEGER NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_digital_assets_type_active ON digital_assets (type, is_active);
