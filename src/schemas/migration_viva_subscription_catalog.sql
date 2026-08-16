-- Viva subscription plan catalog. Nano stays authoritative on granted duration_days;
-- GCN owns its own SKU/pricing catalog in the aeviva store and only references plan_key
-- (fetched via GET /viva-subscription-plans) when creating an order.

CREATE TABLE IF NOT EXISTS viva_subscription_plans (
    id            SERIAL PRIMARY KEY,
    plan_key      TEXT UNIQUE NOT NULL,          -- e.g. 'viva_1m', 'viva_3m', 'viva_1y'
    label         TEXT NOT NULL,
    label_zh      TEXT,
    duration_days INTEGER NOT NULL,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO viva_subscription_plans (plan_key, label, label_zh, duration_days)
VALUES
    ('viva_1m', 'Viva 1 Month', 'Viva 1个月', 30),
    ('viva_3m', 'Viva 3 Months', 'Viva 3个月', 90),
    ('viva_1y', 'Viva 1 Year', 'Viva 1年', 365)
ON CONFLICT (plan_key) DO NOTHING;
