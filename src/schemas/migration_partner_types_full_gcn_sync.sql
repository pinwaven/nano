-- Extends the GCN-managed tier mechanism (migration_partner_types_gcn_managed.sql) from
-- label/label_zh only to a tier's full identity: entry_fee and is_active now also sync from
-- GCN's own Wholesale Rules panel (gcn/src/schemas/migration_0047_gcn_owns_aeviva_tier_system.sql
-- added matching columns on GCN's side). color/description/sort_order remain nano-local by
-- design — see that migration's own comment. Column shapes match GCN's exactly
-- (NUMERIC(12,2)/BOOLEAN) so handleGcnSyncPartnerType's upsert needs no unit conversion; both
-- columns already exist here (migration_partner_flexible_commissions.sql), so this migration is
-- comment-only for schema purposes — the real change is in handleGcnSyncPartnerType /
-- handlePutPartnerType's application-level enforcement, not the schema.

-- Phase 2 (see /Users/pin/waven/gcn/docs/aeviva/10-partner-system-consolidation-roadmap.md):
-- moves tier ASSIGNMENT (which tier a specific partner holds) to GCN too, mirroring
-- managed_by_gcn's per-type pattern at the per-partner level. Until GCN's admin explicitly
-- assigns a tier for a given partner (via the new POST /partner-tier-assignment-gcn-sync),
-- nano's own tier <select> in the Add/Edit Partner form remains fully authoritative, exactly as
-- today. Once TRUE, nano's local tier field becomes read-only and GCN's assignment wins.
-- @requires: migration_partners.sql
ALTER TABLE partners ADD COLUMN IF NOT EXISTS tier_managed_by_gcn BOOLEAN NOT NULL DEFAULT FALSE;
