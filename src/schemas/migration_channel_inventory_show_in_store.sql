ALTER TABLE channel_inventory_items
  ADD COLUMN IF NOT EXISTS show_in_store BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_channel_inventory_show_in_store
  ON channel_inventory_items(channel_id, show_in_store);
