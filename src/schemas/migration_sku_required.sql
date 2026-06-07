-- Enforce sku_id linkage for store_items and channel_inventory_items.
--
-- DB-level NOT NULL cannot be added to store_items while un-SKU'd items have
-- orders referencing them (FK from orders.item_id). App-level validation in
-- the worker handlers blocks new items without sku_id going forward.
--
-- This migration: backfills what it can, removes orphaned channel items, and
-- adds NOT NULL to channel_inventory_items (which has no such order FK issue).

-- 1. Backfill channel_inventory_items.sku_id from their linked store_item
UPDATE channel_inventory_items ci
SET sku_id = si.sku_id
FROM store_items si
WHERE ci.store_item_id = si.id
  AND ci.sku_id IS NULL
  AND si.sku_id IS NOT NULL;

-- 2. Remove channel_inventory_items without a SKU that have no associated orders
DELETE FROM channel_inventory_items ci
WHERE sku_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.channel_inventory_item_id = ci.id);

-- 3. Enforce NOT NULL on channel_inventory_items
--    (Safe: all unresolvable NULLs were removed above.)
ALTER TABLE channel_inventory_items ALTER COLUMN sku_id SET NOT NULL;

-- NOTE: store_items.sku_id intentionally left nullable at DB level.
-- Any existing un-SKU'd items with orders cannot be deleted. Fix those rows
-- manually (UPDATE store_items SET sku_id = '<uuid>' WHERE sku_id IS NULL),
-- then run: ALTER TABLE store_items ALTER COLUMN sku_id SET NOT NULL;
