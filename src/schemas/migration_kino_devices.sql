-- Kino device registry: reusable physical hardware units
CREATE TABLE IF NOT EXISTS kino_devices (
    id SERIAL PRIMARY KEY,
    serial_number TEXT UNIQUE NOT NULL,
    name TEXT,
    coach_id INTEGER REFERENCES coaches(id) ON DELETE SET NULL,
    channel_id INTEGER REFERENCES channels(id) ON DELETE SET NULL,
    status TEXT DEFAULT 'active',  -- FC3.0 states: 'inactive', 'active', 'disabled'
    notes TEXT,
    registered_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_kino_devices_coach_id   ON kino_devices(coach_id);
CREATE INDEX IF NOT EXISTS idx_kino_devices_channel_id ON kino_devices(channel_id);

-- FC3.0 device activation and token lifecycle fields. Machine number is stored
-- in the existing serial_number column; machine name is stored in name.
ALTER TABLE kino_devices ADD COLUMN IF NOT EXISTS model TEXT;
ALTER TABLE kino_devices ADD COLUMN IF NOT EXISTS production_year INTEGER;
ALTER TABLE kino_devices ADD COLUMN IF NOT EXISTS year_letter CHAR(1);
ALTER TABLE kino_devices ADD COLUMN IF NOT EXISTS production_month INTEGER;
ALTER TABLE kino_devices ADD COLUMN IF NOT EXISTS sequence_no INTEGER;
ALTER TABLE kino_devices ADD COLUMN IF NOT EXISTS mainboard_id TEXT;
ALTER TABLE kino_devices ADD COLUMN IF NOT EXISTS firmware_id TEXT;
ALTER TABLE kino_devices ADD COLUMN IF NOT EXISTS software_version TEXT;
ALTER TABLE kino_devices ADD COLUMN IF NOT EXISTS firmware_version TEXT;
ALTER TABLE kino_devices ADD COLUMN IF NOT EXISTS root_token_hash TEXT;
ALTER TABLE kino_devices ADD COLUMN IF NOT EXISTS root_token_ciphertext TEXT;
ALTER TABLE kino_devices ADD COLUMN IF NOT EXISTS comm_token_hash TEXT;
ALTER TABLE kino_devices ADD COLUMN IF NOT EXISTS comm_token_expires_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE kino_devices ADD COLUMN IF NOT EXISTS activated_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE kino_devices ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE kino_devices ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE kino_devices ALTER COLUMN status SET DEFAULT 'inactive';

CREATE UNIQUE INDEX IF NOT EXISTS idx_kino_devices_model_period_sequence
    ON kino_devices(model, production_year, production_month, sequence_no)
    WHERE model IS NOT NULL
      AND production_year IS NOT NULL
      AND production_month IS NOT NULL
      AND sequence_no IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_kino_devices_mainboard_id_unique
    ON kino_devices(mainboard_id)
    WHERE mainboard_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_kino_devices_firmware_id_unique
    ON kino_devices(firmware_id)
    WHERE firmware_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_kino_devices_model_period
    ON kino_devices(model, production_year, production_month);

CREATE INDEX IF NOT EXISTS idx_kino_devices_status
    ON kino_devices(status);

CREATE INDEX IF NOT EXISTS idx_kino_devices_root_token_hash
    ON kino_devices(root_token_hash)
    WHERE root_token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_kino_devices_comm_token_hash
    ON kino_devices(comm_token_hash)
    WHERE comm_token_hash IS NOT NULL;

-- Link biomarker records back to the device that produced them
ALTER TABLE biomarkers ADD COLUMN IF NOT EXISTS kino_device_id INTEGER REFERENCES kino_devices(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_biomarkers_kino_device_id ON biomarkers(kino_device_id);
