-- Add credit pricing to merchandise tables
ALTER TABLE store_items ADD COLUMN IF NOT EXISTS price_credits NUMERIC(10,2);
ALTER TABLE channel_inventory_items ADD COLUMN IF NOT EXISTS price_credits NUMERIC(10,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS price_credits NUMERIC(10,2);
