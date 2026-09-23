-- @requires: migration_admin_account_email_otp.sql
-- Superseded before production rollout: SMS admin login now reuses users/user_phones and
-- users.roles, exactly like Mini Program login. This migration remains because it was applied
-- once on dev; the follow-up removes the unused column there and is a no-op elsewhere.
ALTER TABLE admin_accounts
    ADD COLUMN IF NOT EXISTS phone TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_accounts_phone_unique
    ON admin_accounts (phone)
    WHERE phone IS NOT NULL;
