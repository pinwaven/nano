-- @requires: migration_admin_account_phone_otp.sql
-- Remove the briefly introduced duplicate phone identity. Admin SMS login uses user_phones.
DROP INDEX IF EXISTS idx_admin_accounts_phone_unique;
ALTER TABLE admin_accounts DROP COLUMN IF EXISTS phone;
