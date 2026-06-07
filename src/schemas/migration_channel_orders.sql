-- Make orders.item_id nullable (was NOT NULL tied to global store_items)
ALTER TABLE orders ALTER COLUMN item_id DROP NOT NULL;

-- Add channel_inventory_item_id FK to channel_inventory_items
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS channel_inventory_item_id UUID
    REFERENCES channel_inventory_items(id) ON DELETE SET NULL;

-- Add channel_id to orders (set at order creation time from item's channel)
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS channel_id INTEGER
    REFERENCES channels(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_channel_id ON orders(channel_id);
CREATE INDEX IF NOT EXISTS idx_orders_channel_inventory_item_id ON orders(channel_inventory_item_id);
