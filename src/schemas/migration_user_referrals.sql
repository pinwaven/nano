-- Track which user referred each new user
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS referred_by_user_id TEXT REFERENCES users(user_id);

CREATE INDEX IF NOT EXISTS idx_users_referred_by
  ON users(referred_by_user_id)
  WHERE referred_by_user_id IS NOT NULL;

-- Referral commission records — one row per (order, referrer) pair
CREATE TABLE IF NOT EXISTS referral_commissions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    referrer_user_id TEXT NOT NULL REFERENCES users(user_id),
    referee_user_id TEXT NOT NULL REFERENCES users(user_id),
    order_id UUID REFERENCES orders(id),
    product_type TEXT,
    item_key TEXT,
    quantity INTEGER,
    amount_cny NUMERIC(10,2) NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    payout_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (order_id, referrer_user_id)
);

CREATE INDEX IF NOT EXISTS idx_referral_commissions_referrer
  ON referral_commissions(referrer_user_id);
