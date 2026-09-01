-- Flexible partner types + N-level commission rules system
-- Replaces hardcoded tier strings and singleton partner_commission_config
-- Must run as one block to ensure correct dependency order:
--   1. Create partner_types (referenced by partners.tier FK below)
--   2. Drop hardcoded CHECK on partners.tier, add FK
--   3. Create partner_commission_rules, seed from existing config

-- ── Step 1: partner_types table ───────────────────────────────────────────────
-- @requires: migration_partners.sql

CREATE TABLE IF NOT EXISTS partner_types (
    id           SERIAL PRIMARY KEY,
    key          TEXT NOT NULL UNIQUE,
    label        TEXT NOT NULL,
    label_zh     TEXT,
    color        TEXT NOT NULL DEFAULT '#64748b',
    entry_fee    NUMERIC(12,2) NOT NULL DEFAULT 0,
    sort_order   INTEGER NOT NULL DEFAULT 0,
    description  TEXT,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_partner_types_sort ON partner_types(sort_order, id);

-- Seed the three existing hardcoded tiers
INSERT INTO partner_types (key, label, label_zh, color, entry_fee, sort_order)
VALUES
    ('light_entrepreneur', 'Light Entrepreneur', '轻创合伙人', '#0ea5e9',  9800,   1),
    ('leader_partner',     'Leader Partner',     '领袖合伙人', '#8b5cf6',  49800,  2),
    ('operations_center',  'Operations Center',  '运营中心',   '#f59e0b',  300000, 3)
ON CONFLICT (key) DO NOTHING;

-- ── Step 2: drop hardcoded tier CHECK, add FK to partner_types ───────────────

ALTER TABLE partners DROP CONSTRAINT IF EXISTS partners_tier_check;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_partners_tier') THEN
        ALTER TABLE partners ADD CONSTRAINT fk_partners_tier
            FOREIGN KEY (tier) REFERENCES partner_types(key)
            ON UPDATE CASCADE ON DELETE RESTRICT;
    END IF;
END $$;

-- Add commission_level for tracking which upline depth earned the commission
ALTER TABLE partner_commissions
    ADD COLUMN IF NOT EXISTS commission_level INTEGER;

-- Extend source_type CHECK to include 'team_income' (used for level 3+)
ALTER TABLE partner_commissions DROP CONSTRAINT IF EXISTS partner_commissions_source_type_check;
ALTER TABLE partner_commissions
    ADD CONSTRAINT partner_commissions_source_type_check
    CHECK (source_type IN ('referral', 'sales', 'team_primary', 'team_secondary', 'wholesale_margin', 'team_income'));

-- ── Step 3: partner_commission_rules table ────────────────────────────────────

CREATE TABLE IF NOT EXISTS partner_commission_rules (
    id           SERIAL PRIMARY KEY,
    event_type   TEXT NOT NULL CHECK (event_type IN ('referral', 'team_income', 'product_discount', 'training_discount')),
    upline_level INTEGER,
    earner_type  TEXT,
    subject_type TEXT,
    rate         NUMERIC(7,5) NOT NULL,
    description  TEXT,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order   INTEGER NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Expression-based unique index (PG14 compatible NULL handling via COALESCE sentinels)
CREATE UNIQUE INDEX IF NOT EXISTS idx_commission_rules_unique ON partner_commission_rules
    (event_type,
     COALESCE(upline_level, -1),
     COALESCE(earner_type, ''),
     COALESCE(subject_type, ''));

CREATE INDEX IF NOT EXISTS idx_commission_rules_event ON partner_commission_rules(event_type, is_active);

-- Seed rules from partner_commission_config if a row exists, else from hardcoded defaults
DO $$
DECLARE
    cfg            RECORD;
    ukey           TEXT;
    nkey           TEXT;
    rate_val       NUMERIC;
    order_val      INTEGER := 0;
    referral_rates JSONB;
    product_rates  JSONB;
    training_rates JSONB;
    team_primary   NUMERIC;
    team_secondary NUMERIC;
BEGIN
    BEGIN
        SELECT pcc.referral_rates, pcc.product_discount_rates, pcc.training_discount_rates,
               pcc.team_primary_rate, pcc.team_secondary_rate
        INTO STRICT cfg
        FROM partner_commission_config pcc WHERE pcc.id = 1;

        referral_rates := cfg.referral_rates;
        product_rates  := cfg.product_discount_rates;
        training_rates := cfg.training_discount_rates;
        team_primary   := cfg.team_primary_rate;
        team_secondary := cfg.team_secondary_rate;
    EXCEPTION WHEN NO_DATA_FOUND THEN
        referral_rates := '{"light_entrepreneur":{"light_entrepreneur":0.25,"leader_partner":0.20,"operations_center":0.10},"leader_partner":{"light_entrepreneur":0.40,"leader_partner":0.25,"operations_center":0.20},"operations_center":{"light_entrepreneur":0.50,"leader_partner":0.30,"operations_center":0.25}}';
        product_rates  := '{"light_entrepreneur":0.30,"leader_partner":0.40,"operations_center":0.50}';
        training_rates := '{"light_entrepreneur":0.10,"leader_partner":0.30,"operations_center":0.50}';
        team_primary   := 0.02;
        team_secondary := 0.02;
    END;

    FOR ukey IN SELECT jsonb_object_keys(referral_rates) LOOP
        FOR nkey IN SELECT jsonb_object_keys(referral_rates->ukey) LOOP
            rate_val := (referral_rates->ukey->>nkey)::NUMERIC;
            INSERT INTO partner_commission_rules
                (event_type, upline_level, earner_type, subject_type, rate, description, sort_order)
            VALUES ('referral', 1, ukey, nkey, rate_val, 'Referral: ' || ukey || ' → ' || nkey, order_val)
            ON CONFLICT (event_type, COALESCE(upline_level, -1), COALESCE(earner_type, ''), COALESCE(subject_type, ''))
            DO NOTHING;
            order_val := order_val + 1;
        END LOOP;
    END LOOP;

    FOR ukey IN SELECT jsonb_object_keys(product_rates) LOOP
        rate_val := (product_rates->>ukey)::NUMERIC;
        INSERT INTO partner_commission_rules
            (event_type, upline_level, earner_type, subject_type, rate, description, sort_order)
        VALUES ('product_discount', NULL, ukey, NULL, rate_val, 'Product discount: ' || ukey, order_val)
        ON CONFLICT (event_type, COALESCE(upline_level, -1), COALESCE(earner_type, ''), COALESCE(subject_type, ''))
        DO NOTHING;
        order_val := order_val + 1;
    END LOOP;

    FOR ukey IN SELECT jsonb_object_keys(training_rates) LOOP
        rate_val := (training_rates->>ukey)::NUMERIC;
        INSERT INTO partner_commission_rules
            (event_type, upline_level, earner_type, subject_type, rate, description, sort_order)
        VALUES ('training_discount', NULL, ukey, NULL, rate_val, 'Training discount: ' || ukey, order_val)
        ON CONFLICT (event_type, COALESCE(upline_level, -1), COALESCE(earner_type, ''), COALESCE(subject_type, ''))
        DO NOTHING;
        order_val := order_val + 1;
    END LOOP;

    INSERT INTO partner_commission_rules
        (event_type, upline_level, earner_type, subject_type, rate, description, sort_order)
    VALUES
        ('team_income', 1, NULL, NULL, team_primary,   'Team income level 1', order_val),
        ('team_income', 2, NULL, NULL, team_secondary, 'Team income level 2', order_val + 1)
    ON CONFLICT (event_type, COALESCE(upline_level, -1), COALESCE(earner_type, ''), COALESCE(subject_type, ''))
    DO NOTHING;
END $$;
