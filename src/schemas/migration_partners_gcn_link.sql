-- Mirrors GCN's existing nano_partner_id back-reference, so nano's admin panel can show
-- whether a partner has had a GCN store explicitly provisioned for them (see
-- POST /api/partners/:id/gcn-provision, handlers/partners.js).
ALTER TABLE partners ADD COLUMN IF NOT EXISTS gcn_partner_id UUID;
