-- Email OTP codes — the email counterpart of phone_otp_codes, but unlike that table this one
-- is the PRODUCTION store, not a dev-only bypass. PNVS generates and verifies SMS codes on
-- Aliyun's side; DirectMail (the email sender) has no managed-OTP equivalent, it only sends,
-- so nano owns the whole lifecycle here: generate, hash, store, rate-limit, verify, consume.
-- See worker/lib/email-otp.js.
--
-- email is stored lowercased+trimmed by the app. code_hash is sha256 hex of the 6-digit code
-- (same as phone_otp_codes' dev path). attempts is bumped on every wrong guess and the row is
-- consumed at 5 — without it a 6-digit code is brute-forceable inside its 5-minute window.
CREATE TABLE IF NOT EXISTS email_otp_codes (
    id            SERIAL PRIMARY KEY,
    email         TEXT        NOT NULL,
    code_hash     TEXT        NOT NULL,
    purpose       TEXT        NOT NULL DEFAULT 'login',
    attempts      INTEGER     NOT NULL DEFAULT 0,
    consumed      BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at    TIMESTAMPTZ NOT NULL
);

-- Also serves the send rate limit (counts rows per email in the last minute / hour).
CREATE INDEX IF NOT EXISTS idx_email_otp_codes_email_created ON email_otp_codes (email, created_at DESC);
