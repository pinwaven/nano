-- Viva subscription activation codes. One row per purchased code (v1: one code per
-- GCN order, no bulk/multi-seat). `code` must be high-entropy/unguessable (generated via
-- crypto.randomBytes, NOT sequential like kino_chips.chip_code) — unlike a physical
-- single-use scan chip, this is a bearer credential worth real money if guessed.
--
-- `order_ref` is GCN's order_id/order_item_id and is the idempotency key for
-- POST /viva-subscription-checkout-confirmed: a replayed call with the same order_ref
-- must never mint a second code (see handlers/viva_subscription.js).

CREATE TABLE IF NOT EXISTS viva_subscription_codes (
    id                   BIGSERIAL PRIMARY KEY,
    code                 TEXT UNIQUE NOT NULL,
    plan_key             TEXT NOT NULL REFERENCES viva_subscription_plans(plan_key),
    duration_days        INTEGER NOT NULL,        -- snapshot at generation time, decoupled from later catalog changes
    status               TEXT NOT NULL DEFAULT 'unredeemed',  -- 'unredeemed' | 'redeemed' | 'revoked'
    order_ref            TEXT UNIQUE NOT NULL,
    purchaser_openid      TEXT,                    -- buyer's nano openid if known (self-purchase or gifter)
    redeemed_by_user_id   TEXT REFERENCES users(user_id) ON DELETE SET NULL,
    redeemed_at           TIMESTAMPTZ,
    expires_at            TIMESTAMPTZ,              -- unredeemed-code expiry (default NOW() + 1 year at generation)
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_viva_sub_codes_status ON viva_subscription_codes(status);
