-- Rate limit for POST /phone-otp/send, which is unauthenticated and costs money per SMS.
-- PNVS generates and checks the code on Aliyun's side, so phone_otp_codes is only written by
-- the dev bypass and cannot back a limit; the attempt counter that once did was dropped in
-- migration_phone_otp_codes_drop_attempts.sql. One row per send attempt, checked per phone
-- and per client IP (handlers/phone-otp.js). FC containers are stateless, so this has to be
-- DB-backed rather than in memory.
CREATE TABLE IF NOT EXISTS phone_otp_send_log (
    id          BIGSERIAL   PRIMARY KEY,
    phone       TEXT        NOT NULL,
    client_ip   TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_phone_otp_send_log_phone ON phone_otp_send_log (phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_phone_otp_send_log_ip ON phone_otp_send_log (client_ip, created_at DESC) WHERE client_ip IS NOT NULL;
