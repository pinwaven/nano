-- Deleting a user no longer fails because a super code was ever used on their account.
--
-- resolved_user_id was NOT NULL with no ON DELETE rule, so DELETE FROM users raised a foreign-key
-- violation for any account someone had signed in to with the super code — the admin panel showed
-- only user_delete_failed (dev 2026-10-03, 13761117931). The audit row outlives the account: it
-- keeps target_phone (the identifier used) and the time, and the user link becomes NULL.
-- Deliberately not CASCADE: an audit trail that vanishes with the account is no audit trail.
ALTER TABLE super_otp_audit_log ALTER COLUMN resolved_user_id DROP NOT NULL;
ALTER TABLE super_otp_audit_log DROP CONSTRAINT IF EXISTS super_otp_audit_log_resolved_user_id_fkey;
ALTER TABLE super_otp_audit_log
    ADD CONSTRAINT super_otp_audit_log_resolved_user_id_fkey
    FOREIGN KEY (resolved_user_id) REFERENCES users(user_id) ON DELETE SET NULL;
