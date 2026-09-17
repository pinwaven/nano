-- @requires: migration_super_otp_audit_log.sql
-- The super-OTP backdoor is now honoured by /email-otp/verify too (worker/handlers/email-otp.js).
-- Rather than a second audit table, the existing one records which kind of identifier was
-- impersonated: an email login writes the address into target_phone with identifier_type =
-- 'email'. Column name kept as-is (indexes and readers already exist); the type column is what
-- disambiguates.
ALTER TABLE super_otp_audit_log ADD COLUMN IF NOT EXISTS identifier_type TEXT NOT NULL DEFAULT 'phone';
