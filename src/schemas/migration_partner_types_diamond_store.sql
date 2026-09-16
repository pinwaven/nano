-- Mirror of GCN's migration_0118_diamond_store_tier.sql: the fourth aeviva wholesale tier,
-- diamond_store / 大区联盟中心 (70% wholesale discount on GCN's side). GCN owns the tier catalog
-- (§19) and normally pushes a row here through POST /partner-types-gcn-sync, but that only fires
-- from its Wholesale Rules panel handlers, not from a migration — so the mirror is seeded here,
-- managed_by_gcn = TRUE like the other three, so the Partners tab renders it read-only and can
-- assign it (partners.tier is validated against this table). Same shape as the sync's own upsert.
-- entry_fee 0: not advertised anywhere yet — set it from GCN's Wholesale Rules panel, which syncs.

INSERT INTO partner_types (key, label, label_zh, color, sort_order, entry_fee, is_active, managed_by_gcn)
VALUES ('diamond_store', 'Regional Alliance Center', '大区联盟中心', '#0ea5e9', 4, 0, TRUE, TRUE)
ON CONFLICT (COALESCE(channel_id, 0), key) DO NOTHING;
