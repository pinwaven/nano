-- Migration: Add wx_unionid and wx_app_openid columns to users table
-- Safe to run repeatedly (IF NOT EXISTS guards).

ALTER TABLE users ADD COLUMN IF NOT EXISTS wx_unionid TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS wx_app_openid TEXT;

CREATE INDEX IF NOT EXISTS idx_users_wx_unionid ON users(wx_unionid);
CREATE INDEX IF NOT EXISTS idx_users_wx_app_openid ON users(wx_app_openid);
