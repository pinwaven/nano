-- Coach CRM Phase 4 Migration
-- Tables: client_nps_surveys, coach_performance_snapshots

-- ── NPS Surveys ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_nps_surveys (
    id            BIGSERIAL PRIMARY KEY,
    coach_id      INTEGER NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
    user_id       TEXT    NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    survey_type   TEXT NOT NULL DEFAULT 'nps'
                  CHECK (survey_type IN ('nps','satisfaction','plan_feedback')),
    score         SMALLINT CHECK (score BETWEEN 0 AND 10),
    feedback_text TEXT,
    plan_id       BIGINT REFERENCES health_plans(id) ON DELETE SET NULL,
    sent_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    responded_at  TIMESTAMPTZ,
    status        TEXT NOT NULL DEFAULT 'sent'
                  CHECK (status IN ('sent','responded','skipped'))
);

CREATE INDEX IF NOT EXISTS idx_nps_coach_time ON client_nps_surveys(coach_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_nps_user       ON client_nps_surveys(user_id);
CREATE INDEX IF NOT EXISTS idx_nps_status     ON client_nps_surveys(status);

-- ── Coach Performance Snapshots ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coach_performance_snapshots (
    id                      SERIAL PRIMARY KEY,
    coach_id                INTEGER NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
    period                  VARCHAR(7) NOT NULL,
    total_clients           INTEGER NOT NULL DEFAULT 0,
    active_clients          INTEGER NOT NULL DEFAULT 0,
    at_risk_count           INTEGER NOT NULL DEFAULT 0,
    new_clients             INTEGER NOT NULL DEFAULT 0,
    scans_facilitated       INTEGER NOT NULL DEFAULT 0,
    plans_assigned          INTEGER NOT NULL DEFAULT 0,
    messages_sent           INTEGER NOT NULL DEFAULT 0,
    appointments_held       INTEGER NOT NULL DEFAULT 0,
    avg_bio_age_improvement NUMERIC(5,2),
    avg_nps_score           NUMERIC(4,2),
    nps_response_count      INTEGER NOT NULL DEFAULT 0,
    commission_cny          NUMERIC(12,2) NOT NULL DEFAULT 0,
    computed_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (coach_id, period)
);

CREATE INDEX IF NOT EXISTS idx_cps_coach_period ON coach_performance_snapshots(coach_id, period DESC);
