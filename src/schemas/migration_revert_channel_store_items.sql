-- Revert channel-scoped store_items: channels manage custom products via
-- channel_inventory_items instead. can_customize_store is kept and repurposed
-- to gate whether a channel admin can add custom (non-catalog) inventory items.
-- @requires: migration_store.sql

ALTER TABLE store_items DROP COLUMN IF EXISTS channel_id;
ALTER TABLE channels    DROP COLUMN IF EXISTS can_share_store_items;
