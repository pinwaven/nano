-- @requires: migration_add_wx_unionid_and_app_openid.sql
-- OpenIDs are scoped to an AppID. users.external_id remains a legacy login key;
-- new mini programs attach here without replacing it.
CREATE TABLE IF NOT EXISTS wechat_miniapp_identities (
    app_id TEXT NOT NULL,
    openid TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    unionid TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (app_id, openid)
);

CREATE INDEX IF NOT EXISTS idx_wechat_miniapp_identities_user_id
    ON wechat_miniapp_identities (user_id);
CREATE INDEX IF NOT EXISTS idx_wechat_miniapp_identities_unionid
    ON wechat_miniapp_identities (unionid) WHERE unionid IS NOT NULL;
