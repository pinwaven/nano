-- Link inventory items to the lab provider that fulfills them
ALTER TABLE channel_inventory_items
  ADD COLUMN IF NOT EXISTS lab_provider_id INTEGER
    REFERENCES lab_providers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_channel_inventory_lab_provider
  ON channel_inventory_items(lab_provider_id);

-- Track external lab order state
-- lab_order_id: reference ID returned by the lab's API (NULL until order is submitted)
-- lab_order_status: NULL = not submitted | 'pending' | 'processing' | 'completed' | 'failed'
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS lab_order_id TEXT;
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS lab_order_status TEXT;
