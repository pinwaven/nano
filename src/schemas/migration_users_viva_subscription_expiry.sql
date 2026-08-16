-- Grants the user's Viva persona access until this timestamp. Set/extended by
-- POST /viva-subscription-redeem (stacks on top of remaining time via GREATEST(existing, NOW())
-- + duration_days — never resets backward). NULL or past means no active subscription.
ALTER TABLE users ADD COLUMN IF NOT EXISTS viva_subscription_expires_at TIMESTAMPTZ;
