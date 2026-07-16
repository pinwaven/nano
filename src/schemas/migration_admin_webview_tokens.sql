-- One-time tokens for web admin panel → GCN admin console auth handoff.
-- Mirrors webview_tokens (miniapp → web app), but keyed by admin identity instead
-- of openid: admin_account_id is set for a real channel-scoped admin (adminCtx.role
-- === 'channel'), and left NULL for the anonymous superadmin case (nano's superadmin
-- web session carries no per-user identity — see CLAUDE.md §19). channel_id is always
-- the GCN-linked channel the token was scoped to. Single-use, 60-second expiry.
CREATE TABLE IF NOT EXISTS admin_webview_tokens (
    token             TEXT PRIMARY KEY,
    admin_role        TEXT NOT NULL CHECK (admin_role IN ('superadmin', 'channel')),
    admin_account_id  INTEGER REFERENCES admin_accounts(id),
    channel_id        INTEGER NOT NULL REFERENCES channels(id),
    used              BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at        TIMESTAMPTZ NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_webview_tokens_expires_at ON admin_webview_tokens (expires_at);
