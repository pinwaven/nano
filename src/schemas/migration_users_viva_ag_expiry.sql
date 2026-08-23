-- Viva AG (Advanced Generation) is an ADD-ON on top of an active Viva subscription, not a
-- third persona: the regular chatbox stays powered by viva, and viva-ag is only active inside
-- the health tab's AG subtab.
--
-- Deliberately NOT a new persona_override_type value — resolveEffectivePersona() must keep
-- returning 'nano'|'viva' only, or every prompt-routing site downstream (prompts/<persona>/*,
-- chat_messages.persona_type, the dispatcher's inlined SQL copy) would need a third branch it
-- has no prompts for. Gated by hasActiveVivaAgAccess() in worker/lib/persona.js, always
-- composed with the existing hasActiveVivaAccess() check.
--
-- Grants/revokes are audited in the existing persona_subscription_grants table with
-- persona_type = 'viva_ag'; that table has no CHECK constraint on persona_type, so no change
-- is needed there.
--
-- v1 is admin-grant only. When AG becomes purchasable, the clean upgrade is one migration:
--   ALTER TABLE viva_subscription_plans ADD COLUMN product_type TEXT NOT NULL DEFAULT 'viva';
--   ALTER TABLE viva_subscription_codes ADD COLUMN product_type TEXT NOT NULL DEFAULT 'viva';
-- (snapshot at mint time, like duration_days already is) plus a branch in
-- _extendUserSubscription that calls the AG grant instead of grantPersonaOverride. No new
-- endpoint and no new GCN allowlist entry — /viva-subscription-checkout-confirmed already
-- takes plan_key.
ALTER TABLE users ADD COLUMN IF NOT EXISTS viva_ag_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_viva_ag_expires
    ON users (viva_ag_expires_at) WHERE viva_ag_expires_at IS NOT NULL;
