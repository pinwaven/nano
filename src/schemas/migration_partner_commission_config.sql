-- Partner commission rules config (singleton row, id always = 1)
CREATE TABLE IF NOT EXISTS partner_commission_config (
    id                     INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    referral_rates         JSONB NOT NULL DEFAULT '{"light_entrepreneur":{"light_entrepreneur":0.25,"leader_partner":0.20,"operations_center":0.10},"leader_partner":{"light_entrepreneur":0.40,"leader_partner":0.25,"operations_center":0.20},"operations_center":{"light_entrepreneur":0.50,"leader_partner":0.30,"operations_center":0.25}}',
    product_discount_rates JSONB NOT NULL DEFAULT '{"light_entrepreneur":0.30,"leader_partner":0.40,"operations_center":0.50}',
    training_discount_rates JSONB NOT NULL DEFAULT '{"light_entrepreneur":0.10,"leader_partner":0.30,"operations_center":0.50}',
    team_primary_rate      NUMERIC(5,4) NOT NULL DEFAULT 0.02,
    team_secondary_rate    NUMERIC(5,4) NOT NULL DEFAULT 0.02,
    updated_at             TIMESTAMPTZ DEFAULT NOW()
);

-- Seed the singleton row with defaults (no-op if already exists)
INSERT INTO partner_commission_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
