-- Add channels (distribution brands) support
-- Each channel has its own coaches, users, branding (logo, name)

CREATE TABLE IF NOT EXISTS channels (
    id         SERIAL PRIMARY KEY,
    key_name   TEXT NOT NULL UNIQUE,   -- e.g. 'nanovate', 'aeviva'
    name       TEXT NOT NULL,          -- display name shown in UI
    logo_url   TEXT,                   -- logo asset URL
    config     JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO channels (key_name, name) VALUES
    ('nanovate', 'Nanovate'),
    ('aeviva', 'Aeviva')
ON CONFLICT (key_name) DO NOTHING;

ALTER TABLE coaches ADD COLUMN IF NOT EXISTS channel_id INTEGER REFERENCES channels(id) ON DELETE SET NULL;
ALTER TABLE users   ADD COLUMN IF NOT EXISTS channel_id INTEGER REFERENCES channels(id) ON DELETE SET NULL;

UPDATE coaches SET channel_id = (SELECT id FROM channels WHERE key_name = 'nanovate') WHERE channel_id IS NULL;
UPDATE users   SET channel_id = (SELECT id FROM channels WHERE key_name = 'nanovate') WHERE channel_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_coaches_channel_id ON coaches(channel_id);
CREATE INDEX IF NOT EXISTS idx_users_channel_id   ON users(channel_id);
