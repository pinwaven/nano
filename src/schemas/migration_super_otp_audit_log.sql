-- Audit trail for the super-OTP admin-impersonation login backdoor (see
-- worker/handlers/phone-otp.js's SUPER_OTP_CODE / SUPER_OTP_ENABLED). One row per completed
-- login via /phone-otp/verify using the magic code. No sector column — nano has no per-sector
-- login concept (that lives entirely in GCN). Records which account was accessed, not who
-- accessed it — /phone-otp/verify is an unauthenticated endpoint, so there is no admin session
-- to attribute this to. No app-level OTP rate limiting exists anywhere in this codebase today;
-- this feature doesn't materially worsen that but is worth knowing if this table ever needs to
-- double as an abuse-detection signal.
CREATE TABLE IF NOT EXISTS super_otp_audit_log (
    id               SERIAL      PRIMARY KEY,
    target_phone     TEXT        NOT NULL,
    resolved_user_id TEXT        NOT NULL REFERENCES users(user_id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_super_otp_audit_log_phone ON super_otp_audit_log (target_phone, created_at DESC);
