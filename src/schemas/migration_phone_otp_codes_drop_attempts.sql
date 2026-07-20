-- Dropping custom rate-limit/attempt tracking after switching phone+OTP login from
-- classic Dysmsapi (self-hosted code hashing + attempt lockout) to Aliyun PNVS
-- (dypnsapi), which mirrors gcn's proven src/functions/auth/lib/otp.js: Aliyun
-- generates/sends/verifies the code server-side, so phone_otp_codes is now only used
-- as the local dev-bypass code store (no SMS_ACCESS_KEY_ID configured), matching gcn's
-- otp_codes table shape. attempts had no remaining reader once verify delegated to PNVS.
ALTER TABLE phone_otp_codes DROP COLUMN IF EXISTS attempts;
