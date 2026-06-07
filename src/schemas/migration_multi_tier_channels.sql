-- Multi-tier channel management
-- Adds parent_channel_id (self-referential FK for 2-level hierarchy)
-- and can_manage_subchannels flag (superadmin grants per channel)

ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS parent_channel_id INTEGER REFERENCES channels(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS can_manage_subchannels BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_channels_parent ON channels(parent_channel_id);
