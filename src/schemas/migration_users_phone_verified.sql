-- Tracks whether users.phone has been proven via SMS-OTP (see handlePhoneOtpBind,
-- worker/handlers/phone-otp.js). NULL means unverified — this includes every phone
-- already on file before this migration (WeChat consent alone does not set it; only
-- a successful phone-otp/bind or phone-otp/verify does).
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ;
