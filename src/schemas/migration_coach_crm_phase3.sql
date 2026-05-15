-- Coach CRM Phase 3 Migration
-- Tables: appointments, client_goals

-- ── Appointments ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS appointments (
    id            BIGSERIAL PRIMARY KEY,
    coach_id      INTEGER NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
    user_id       TEXT    NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    title         TEXT NOT NULL,
    scheduled_at  TIMESTAMPTZ NOT NULL,
    duration_min  INTEGER NOT NULL DEFAULT 30,
    format        TEXT NOT NULL DEFAULT 'video'
                  CHECK (format IN ('video','phone','in_person','wechat')),
    status        TEXT NOT NULL DEFAULT 'scheduled'
                  CHECK (status IN ('scheduled','completed','cancelled','no_show')),
    coach_notes   TEXT,
    meeting_link  TEXT,
    reminder_sent BOOLEAN NOT NULL DEFAULT false,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appt_coach_time ON appointments(coach_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS idx_appt_user       ON appointments(user_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS idx_appt_status     ON appointments(status, scheduled_at);

-- ── Client Goals ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_goals (
    id              BIGSERIAL PRIMARY KEY,
    coach_id        INTEGER NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
    user_id         TEXT    NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    goal_type       TEXT NOT NULL CHECK (goal_type IN (
                        'bio_age','sub_age','weight','steps','sleep_score',
                        'hrv','kino_scan_count','custom')),
    title_zh        TEXT NOT NULL,
    title_en        TEXT,
    target_value    NUMERIC(10,2),
    target_unit     TEXT,
    target_sub_age  TEXT,
    baseline_value  NUMERIC(10,2),
    current_value   NUMERIC(10,2),
    target_date     DATE,
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','achieved','missed','cancelled')),
    achieved_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cg_coach_user ON client_goals(coach_id, user_id);
CREATE INDEX IF NOT EXISTS idx_cg_status     ON client_goals(status, target_date);
CREATE INDEX IF NOT EXISTS idx_cg_user       ON client_goals(user_id, status);
