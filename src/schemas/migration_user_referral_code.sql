-- Each user gets a unique 6-digit referral code (same format as coach invite codes)
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code) WHERE referral_code IS NOT NULL;

-- Backfill existing users
DO $$
DECLARE
  u RECORD;
  candidate TEXT;
BEGIN
  FOR u IN SELECT user_id FROM users WHERE referral_code IS NULL LOOP
    LOOP
      candidate := LPAD((FLOOR(RANDOM() * 900000) + 100000)::TEXT, 6, '0');
      BEGIN
        UPDATE users SET referral_code = candidate WHERE user_id = u.user_id;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        -- collision, retry
      END;
    END LOOP;
  END LOOP;
END $$;
