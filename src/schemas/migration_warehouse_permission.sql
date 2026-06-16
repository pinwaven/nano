-- Channel warehouse management permission.
-- Parent channel (or superadmin) grants this to a child channel.
-- Once granted, the channel admin sees a Warehouses sub-tab in Inventory
-- and can manage inventory_stock rows of type 'warehouse' for their own SKUs.
ALTER TABLE channels ADD COLUMN IF NOT EXISTS can_manage_warehouses BOOLEAN NOT NULL DEFAULT FALSE;
-- Root channels already own their warehouses.
UPDATE channels SET can_manage_warehouses = TRUE WHERE parent_channel_id IS NULL;
