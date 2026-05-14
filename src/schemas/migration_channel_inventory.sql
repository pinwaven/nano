CREATE TABLE IF NOT EXISTS channel_inventory_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id      INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  key_name        TEXT NOT NULL,
  name_zh         TEXT NOT NULL DEFAULT '',
  name_en         TEXT DEFAULT '',
  desc_zh         TEXT DEFAULT '',
  desc_en         TEXT DEFAULT '',
  item_type       TEXT NOT NULL DEFAULT 'physical',
  unit_zh         TEXT DEFAULT '',
  unit_en         TEXT DEFAULT '',
  price_cny       NUMERIC(10,2),
  price_usd       NUMERIC(10,2),
  stock_quantity  INTEGER,
  tag             TEXT DEFAULT '',
  sort_order      INTEGER DEFAULT 0,
  active          BOOLEAN DEFAULT TRUE,
  image_url       TEXT DEFAULT '',
  metadata        JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(channel_id, key_name)
);

CREATE INDEX IF NOT EXISTS idx_channel_inventory_channel_id
  ON channel_inventory_items(channel_id);
