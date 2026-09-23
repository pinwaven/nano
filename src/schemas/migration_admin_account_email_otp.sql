-- Passwordless email OTP login for the web admin panel.
-- Existing accounts remain usable with username/password until an email is assigned.
ALTER TABLE admin_accounts
    ADD COLUMN IF NOT EXISTS email TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_accounts_email_unique
    ON admin_accounts (LOWER(email))
    WHERE email IS NOT NULL;
