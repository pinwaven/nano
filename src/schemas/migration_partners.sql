-- Partner system: three-tier distributor network (MP-2026-05-001)
-- Tiers: light_entrepreneur (¥9,800) | leader_partner (¥49,800) | operations_center (¥300,000)

CREATE TABLE IF NOT EXISTS partners (
    id                     SERIAL PRIMARY KEY,
    user_id                TEXT REFERENCES users(user_id) ON DELETE SET NULL,
    channel_id             INTEGER REFERENCES channels(id) ON DELETE SET NULL,
    tier                   TEXT NOT NULL CHECK (tier IN ('light_entrepreneur', 'leader_partner', 'operations_center')),
    entry_fee_paid         NUMERIC(12,2) NOT NULL,
    real_name              TEXT NOT NULL,
    phone                  TEXT NOT NULL,
    contracted_at          TIMESTAMPTZ,
    referred_by_partner_id INTEGER REFERENCES partners(id) ON DELETE SET NULL,
    status                 TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active', 'inactive')),
    notes                  TEXT,
    created_at             TIMESTAMPTZ DEFAULT NOW(),
    updated_at             TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_partners_channel_id          ON partners(channel_id);
CREATE INDEX IF NOT EXISTS idx_partners_referred_by         ON partners(referred_by_partner_id);
CREATE INDEX IF NOT EXISTS idx_partners_status              ON partners(status);

-- One record per commission event (referral, sale, team income)
CREATE TABLE IF NOT EXISTS partner_commissions (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id        INTEGER NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
    source_type       TEXT NOT NULL CHECK (source_type IN ('referral', 'sales', 'team_primary', 'team_secondary', 'wholesale_margin')),
    source_partner_id INTEGER REFERENCES partners(id) ON DELETE SET NULL,
    amount_cny        NUMERIC(12,2) NOT NULL,
    rate              NUMERIC(5,4),
    base_amount       NUMERIC(12,2),
    description       TEXT,
    status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'transferred')),
    payout_id         UUID,
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_partner_comm_partner ON partner_commissions(partner_id);
CREATE INDEX IF NOT EXISTS idx_partner_comm_status  ON partner_commissions(status);
CREATE INDEX IF NOT EXISTS idx_partner_comm_payout  ON partner_commissions(payout_id);

-- Monthly payout records, one per partner per period
CREATE TABLE IF NOT EXISTS partner_payouts (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id     INTEGER NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
    period         VARCHAR(7) NOT NULL,
    total_cny      NUMERIC(12,2) NOT NULL,
    status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'transferred')),
    approved_by    TEXT REFERENCES users(user_id) ON DELETE SET NULL,
    approved_at    TIMESTAMPTZ,
    transferred_at TIMESTAMPTZ,
    notes          TEXT,
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(partner_id, period)
);

CREATE INDEX IF NOT EXISTS idx_partner_payouts_partner ON partner_payouts(partner_id, status);
