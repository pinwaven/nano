-- Coach CRM Phase 1 Migration
-- Tables: client_tags, client_tag_assignments, client_pipeline_stages,
--         coach_client_notes, client_activity_log

-- ── Client Tags ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_tags (
    id         SERIAL PRIMARY KEY,
    coach_id   INTEGER NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    color_hex  TEXT NOT NULL DEFAULT '#6375EC',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (coach_id, name)
);

CREATE INDEX IF NOT EXISTS idx_client_tags_coach ON client_tags(coach_id);

-- ── Tag Assignments (many-to-many) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_tag_assignments (
    id          BIGSERIAL PRIMARY KEY,
    tag_id      INTEGER NOT NULL REFERENCES client_tags(id) ON DELETE CASCADE,
    user_id     TEXT    NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    coach_id    INTEGER NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tag_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_cta_user  ON client_tag_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_cta_tag   ON client_tag_assignments(tag_id);
CREATE INDEX IF NOT EXISTS idx_cta_coach ON client_tag_assignments(coach_id);

-- ── CRM Pipeline Stages ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_pipeline_stages (
    id               SERIAL PRIMARY KEY,
    coach_id         INTEGER NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
    user_id          TEXT    NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    stage            TEXT    NOT NULL DEFAULT 'lead'
                     CHECK (stage IN ('lead','onboarding','active','at_risk','churned','graduated')),
    stage_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    note             TEXT,
    UNIQUE (coach_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_cps_coach_stage ON client_pipeline_stages(coach_id, stage);
CREATE INDEX IF NOT EXISTS idx_cps_user        ON client_pipeline_stages(user_id);

-- ── Coach Client Notes ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coach_client_notes (
    id         BIGSERIAL PRIMARY KEY,
    coach_id   INTEGER NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
    user_id    TEXT    NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    content    TEXT NOT NULL,
    is_pinned  BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ccn_coach_user ON coach_client_notes(coach_id, user_id, created_at DESC);

-- ── Client Activity Log ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_activity_log (
    id            BIGSERIAL PRIMARY KEY,
    coach_id      INTEGER NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
    user_id       TEXT    NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    activity_type TEXT    NOT NULL CHECK (activity_type IN (
                      'message_sent','reminder_set','plan_assigned','plan_completed',
                      'kino_scan','stage_changed','note_added','appointment_scheduled',
                      'appointment_completed','nps_received','questionnaire_assigned',
                      'goal_set','goal_achieved','bulk_message_sent')),
    metadata      JSONB   NOT NULL DEFAULT '{}'::jsonb,
    occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cal_coach_user ON client_activity_log(coach_id, user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_cal_coach_time ON client_activity_log(coach_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_cal_type       ON client_activity_log(activity_type);
