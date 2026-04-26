-- Kino device registry: reusable physical hardware units
CREATE TABLE IF NOT EXISTS kino_devices (
    id SERIAL PRIMARY KEY,
    serial_number TEXT UNIQUE NOT NULL,
    name TEXT,
    coach_id INTEGER REFERENCES coaches(id) ON DELETE SET NULL,
    channel_id INTEGER REFERENCES channels(id) ON DELETE SET NULL,
    status TEXT DEFAULT 'active',  -- 'active', 'inactive', 'maintenance'
    notes TEXT,
    registered_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_kino_devices_coach_id   ON kino_devices(coach_id);
CREATE INDEX IF NOT EXISTS idx_kino_devices_channel_id ON kino_devices(channel_id);

-- Link biomarker records back to the device that produced them
ALTER TABLE biomarkers ADD COLUMN IF NOT EXISTS kino_device_id INTEGER REFERENCES kino_devices(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_biomarkers_kino_device_id ON biomarkers(kino_device_id);
