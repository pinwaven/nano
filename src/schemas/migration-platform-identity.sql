-- Migration: Rename users.wechat_openid to users.external_id
-- Run once against PolarDB before deploying updated code

ALTER TABLE users RENAME COLUMN wechat_openid TO external_id;

DROP INDEX IF EXISTS idx_users_wechat_openid;
CREATE INDEX idx_users_external_id ON users(external_id);
