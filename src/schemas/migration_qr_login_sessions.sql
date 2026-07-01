-- QR login sessions: web app generates a session, miniapp confirms it with the user's openid.
CREATE TABLE IF NOT EXISTS qr_login_sessions (
    session_id   TEXT        PRIMARY KEY,
    status       TEXT        NOT NULL DEFAULT 'pending',   -- pending | confirmed | expired
    openid       TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at   TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '5 minutes',
    confirmed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_qr_login_sessions_expires ON qr_login_sessions (expires_at);
