-- Makes the subscription catalog carry more than one product. Until now every plan_key in
-- viva_subscription_plans meant "a Viva persona subscription"; the AI 精准营养素 bundle sold in
-- GCN's aeviva store grants the Viva AG add-on instead (plus the physical 56-capsule batch GCN
-- fulfils on its own side).
--
-- This is exactly the upgrade path migration_users_viva_ag_expiry.sql's comment prescribed:
-- one column on each of the two tables, snapshotted at mint time like duration_days already is,
-- plus a branch in _extendUserSubscription. No new endpoint and no new GCN_ALLOWED_PATHS entry —
-- POST /viva-subscription-checkout-confirmed already takes plan_key and looks the plan up.
--
-- DEFAULT 'viva' means every existing plan and every already-minted code keeps its current
-- meaning with no backfill.
-- @requires: migration_viva_subscription_catalog.sql, migration_viva_subscription_codes.sql

ALTER TABLE viva_subscription_plans ADD COLUMN IF NOT EXISTS product_type TEXT NOT NULL DEFAULT 'viva';
ALTER TABLE viva_subscription_codes ADD COLUMN IF NOT EXISTS product_type TEXT NOT NULL DEFAULT 'viva';

-- Viva AG is an ADD-ON: requireVivaAgAccess() (worker/lib/vivaAgAccess.js) is a composite of
-- "effective persona is viva" AND "live Viva grant" AND "live AG grant". A viva_ag plan therefore
-- has to grant BOTH windows, or the buyer pays and still can't open the AG subtab. That is
-- handled in _extendUserSubscription, not here — recorded in this comment because the plan row
-- itself gives no hint that one purchase moves two columns.
INSERT INTO viva_subscription_plans (plan_key, label, label_zh, duration_days, product_type)
VALUES
    ('viva_ag_1m', 'AI Precision Nutrition 1 Month', 'AI 精准营养素 1个月', 30,  'viva_ag'),
    ('viva_ag_3m', 'AI Precision Nutrition 3 Months', 'AI 精准营养素 3个月', 90,  'viva_ag'),
    ('viva_ag_1y', 'AI Precision Nutrition 1 Year',  'AI 精准营养素 1年',   365, 'viva_ag')
ON CONFLICT (plan_key) DO NOTHING;
