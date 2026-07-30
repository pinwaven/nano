-- Marks partner_types rows whose identity (key/label/label_zh) is owned by GCN, not nano.
-- GCN's aeviva "Wholesale Rules" panel (gcn/src/schemas/migration_0028/0029) is now the source
-- of truth for a GCN-linked tier's identity; nano's admin panel displays these read-only and
-- keeps local ownership only of its own operational fields (entry_fee/color/sort_order/
-- description/is_active), which GCN's schema has no equivalent for. Kept as its own boolean
-- rather than reusing channel_id scoping — channel_id is a separate, currently-unused-elsewhere
-- multi-tenant mechanism (migration_partner_types_channel_scope.sql) and shouldn't be overloaded
-- to also mean "GCN owns this."
ALTER TABLE partner_types ADD COLUMN IF NOT EXISTS managed_by_gcn BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill the 3 tiers already seeded on GCN's side (aeviva sector, migration_0028) so nano's UI
-- reflects reality before the first live sync round-trip (gcn -> POST /partner-types-gcn-sync).
UPDATE partner_types SET managed_by_gcn = TRUE
  WHERE key IN ('light_entrepreneur', 'leader_partner', 'operations_center');
