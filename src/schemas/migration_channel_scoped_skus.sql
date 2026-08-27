-- Scope SKUs to channels so each channel can define and manage its own products.
-- NULL channel_id = global SKU (superadmin-managed, e.g. Dots/Kino catalog).
-- Non-null channel_id = channel-owned SKU (sourced and described by that channel).
-- @requires: migration_orders_fulfillment.sql

ALTER TABLE skus ADD COLUMN IF NOT EXISTS channel_id INTEGER REFERENCES channels(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_skus_channel_id ON skus(channel_id);
