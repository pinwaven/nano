ALTER TABLE channel_inventory_items
  ADD COLUMN IF NOT EXISTS store_item_id UUID REFERENCES store_items(id) ON DELETE SET NULL;
