-- Channel-scoped store items
-- First-tier channels (no parent) can manage their own store items by default.
-- Sub-channels require explicit grant from their parent via can_customize_store.
-- @requires: migration_store.sql
-- @requires: migration_multi_tier_channels.sql

ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS can_customize_store BOOLEAN NOT NULL DEFAULT FALSE;

-- Grant permission to all existing root channels retroactively
UPDATE channels SET can_customize_store = TRUE WHERE parent_channel_id IS NULL;

-- Scope store_items to a channel (NULL = global / superadmin-managed)
ALTER TABLE store_items
  ADD COLUMN IF NOT EXISTS channel_id INTEGER REFERENCES channels(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_store_items_channel ON store_items(channel_id);
