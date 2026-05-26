-- Add image_url to store_items (was absent from original migration_store.sql)
ALTER TABLE store_items ADD COLUMN IF NOT EXISTS image_url TEXT;
