-- Parent-child grouping for channel inventory items.
-- A parent item (linked to a parent SKU) spawns one child item per child SKU.
-- Child items are not shown independently in the store; they exist for cart/order/inventory tracking.
ALTER TABLE channel_inventory_items
  ADD COLUMN IF NOT EXISTS parent_item_id UUID REFERENCES channel_inventory_items(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_channel_inventory_parent ON channel_inventory_items(parent_item_id)
  WHERE parent_item_id IS NOT NULL;
