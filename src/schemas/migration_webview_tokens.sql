-- One-time tokens for miniapp → web app auth handoff.
-- The miniapp generates a wvt, passes it in the webview URL, and the web app
-- exchanges it for the user record. Single-use, 60-second expiry.
CREATE TABLE IF NOT EXISTS webview_tokens (
    token      TEXT PRIMARY KEY,
    openid     TEXT NOT NULL,
    used       BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webview_tokens_expires_at ON webview_tokens (expires_at);
