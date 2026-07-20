-- Enforce phone uniqueness so it's a safe login key for phone+OTP login.
-- Partial index (not a table-level UNIQUE) so NULL/empty phones on WeChat-only
-- users are unaffected. Applied after a one-time audit + manual cleanup of the
-- one pre-existing duplicate found on dev/prod (temp/audit-phone-duplicates.js).
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_unique ON users (phone) WHERE phone IS NOT NULL AND phone <> '';
