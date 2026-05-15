-- Coach CRM Phase 2 Migration
-- Tables: message_templates, bulk_message_campaigns, bulk_message_recipients

-- ── Message Templates ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS message_templates (
    id         SERIAL PRIMARY KEY,
    coach_id   INTEGER REFERENCES coaches(id) ON DELETE CASCADE,
    channel_id INTEGER REFERENCES channels(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    content_zh TEXT NOT NULL,
    content_en TEXT,
    category   TEXT NOT NULL DEFAULT 'general' CHECK (category IN (
                   'general','welcome','check_in','plan_update',
                   'scan_reminder','milestone','re_engagement','nps')),
    variables  TEXT[] DEFAULT '{}',
    use_count  INTEGER NOT NULL DEFAULT 0,
    is_active  BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_msg_tpl_coach   ON message_templates(coach_id);
CREATE INDEX IF NOT EXISTS idx_msg_tpl_channel ON message_templates(channel_id);
CREATE INDEX IF NOT EXISTS idx_msg_tpl_cat     ON message_templates(category, is_active);

-- ── Bulk Message Campaigns ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bulk_message_campaigns (
    id              BIGSERIAL PRIMARY KEY,
    coach_id        INTEGER NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
    template_id     INTEGER REFERENCES message_templates(id) ON DELETE SET NULL,
    title           TEXT NOT NULL,
    content         TEXT NOT NULL,
    target_filter   JSONB NOT NULL DEFAULT '{}'::jsonb,
    recipient_count INTEGER NOT NULL DEFAULT 0,
    sent_count      INTEGER NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','sending','sent','failed')),
    scheduled_at    TIMESTAMPTZ,
    sent_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bmc_coach_status ON bulk_message_campaigns(coach_id, status);
CREATE INDEX IF NOT EXISTS idx_bmc_coach_time   ON bulk_message_campaigns(coach_id, created_at DESC);

-- ── Bulk Message Recipients ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bulk_message_recipients (
    id           BIGSERIAL PRIMARY KEY,
    campaign_id  BIGINT NOT NULL REFERENCES bulk_message_campaigns(id) ON DELETE CASCADE,
    user_id      TEXT   NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    personalized TEXT,
    status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','sent','failed')),
    sent_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_bmr_campaign ON bulk_message_recipients(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_bmr_user     ON bulk_message_recipients(user_id);
