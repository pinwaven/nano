-- Audit/history log for per-user persona subscription overrides (see
-- migration_users_persona_override.sql). Both admin-issued grants/revokes (web admin
-- panel) and GCN Viva code redemptions insert a row here, so the admin UI shows one
-- unified history regardless of origin — mirrors credit_ledger's role behind
-- UserCreditModal.
CREATE TABLE IF NOT EXISTS persona_subscription_grants (
    id             BIGSERIAL PRIMARY KEY,
    user_id        TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    persona_type   TEXT NOT NULL,                     -- 'nano' | 'viva'
    action         TEXT NOT NULL,                      -- 'grant' | 'revoke' | 'code_redeemed'
    duration_days  INTEGER,                             -- NULL for revoke
    new_expires_at TIMESTAMPTZ,                          -- resulting persona_override_expires_at; NULL after revoke
    note           TEXT NOT NULL,
    granted_by     TEXT NOT NULL,                        -- adminCtx.username/accountId, or 'gcn'
    channel_id     INTEGER REFERENCES channels(id),       -- snapshot of user's channel_id at grant time
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_persona_subscription_grants_user ON persona_subscription_grants(user_id, created_at DESC);
