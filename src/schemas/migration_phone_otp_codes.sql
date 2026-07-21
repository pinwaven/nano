-- Phone OTP codes for user-app SMS login (alternate to the WeChat QR-login flow).
-- One row per send attempt; verify checks the latest un-consumed, un-expired row for the phone.
-- code_hash is a salted scrypt hash ("<salt>:<hash>", same format as admin_accounts.password_hash) —
-- never stored plaintext, since a 6-digit code is a small enough space that a DB read leak would
-- otherwise be an instant account-takeover vector.
CREATE TABLE IF NOT EXISTS phone_otp_codes (
    id            SERIAL PRIMARY KEY,
    phone         TEXT        NOT NULL,
    code_hash     TEXT        NOT NULL,
    purpose       TEXT        NOT NULL DEFAULT 'login',
    attempts      INTEGER     NOT NULL DEFAULT 0,
    consumed      BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at    TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_phone_otp_codes_phone_created ON phone_otp_codes (phone, created_at DESC);
