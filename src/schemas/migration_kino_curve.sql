-- @requires: migration_kino_devices.sql

CREATE TABLE IF NOT EXISTS kino_curve (
    id               SERIAL PRIMARY KEY,
    kino_device_id   INTEGER REFERENCES kino_devices(id) ON DELETE SET NULL,
    chip_code        TEXT NOT NULL,
    curve            INTEGER[] NOT NULL,
    reference_values JSONB NOT NULL DEFAULT '{}',
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_kino_curve_chip_code       ON kino_curve(chip_code);
CREATE INDEX IF NOT EXISTS idx_kino_curve_kino_device_id  ON kino_curve(kino_device_id);
CREATE INDEX IF NOT EXISTS idx_kino_curve_created_at      ON kino_curve(created_at);
