ALTER TABLE tickets
    ADD COLUMN IF NOT EXISTS channel_id INTEGER REFERENCES channels(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_channel ON tickets(channel_id);
