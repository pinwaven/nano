-- Phase 5 of gcn/docs/aeviva/10-partner-system-consolidation-roadmap.md — completes the Phase 2
-- tier-assignment handoff for partners that were already provisioned to GCN before this backfill
-- ran. Without this, only partners an admin happened to explicitly re-assign via GCN's "Set
-- Aeviva Tier" action had tier_managed_by_gcn = TRUE; every other already-provisioned partner's
-- tier remained nano-editable even though GCN is now the intended sole owner going forward.
--
-- Scoped to gcn_partner_id IS NOT NULL deliberately, not to a specific channel — a partner with
-- no GCN counterpart yet has nowhere to manage their tier except nano, so they're correctly left
-- alone here (they flip automatically the moment they're provisioned, via
-- handleNanoProvisionPartner's normal flow on GCN's side — no separate backfill needed for them).
-- Confirmed via dev DB before writing this: aeviva-china is the only channel with any partners at
-- all (10 total), of which 2 already have gcn_partner_id set — this backfill affects exactly
-- those 2 rows in dev.
UPDATE partners SET tier_managed_by_gcn = TRUE, updated_at = NOW()
  WHERE gcn_partner_id IS NOT NULL AND tier_managed_by_gcn = FALSE;
