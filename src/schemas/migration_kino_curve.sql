-- kino_curve: raw ADC curve captured per chip scan.
-- Mirrors the production table (already live in prod); this migration brings dev to parity.
CREATE TABLE IF NOT EXISTS kino_curve (
    id               SERIAL PRIMARY KEY,
    kino_device_id   INTEGER REFERENCES kino_devices(id),
    chip_code        TEXT NOT NULL,
    curve            INTEGER[] NOT NULL,
    reference_values JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at       TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_kino_curve_device ON kino_curve(kino_device_id);
CREATE INDEX IF NOT EXISTS idx_kino_curve_chip_code ON kino_curve(chip_code);
