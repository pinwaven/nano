-- Migration: add external_id and external_app columns to users table
-- Safe to run repeatedly (IF NOT EXISTS guards).

ALTER TABLE users ADD COLUMN IF NOT EXISTS external_id  TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS external_app TEXT;

-- For existing rows, backfill external_id from user_id (which currently stores the openid)
-- and default external_app to 'wechat' (the current integration).
UPDATE users SET external_id  = user_id   WHERE external_id  IS NULL;
UPDATE users SET external_app = 'wechat'  WHERE external_app IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_external_id ON users(external_id);
