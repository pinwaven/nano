-- Coach CRM Phase 5 Migration
-- Tables: follow_up_rules

CREATE TABLE IF NOT EXISTS follow_up_rules (
    id             SERIAL PRIMARY KEY,
    coach_id       INTEGER NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
    rule_name      TEXT NOT NULL,
    trigger_event  TEXT NOT NULL CHECK (trigger_event IN (
                       'no_scan_days','no_message_days','plan_week_start',
                       'plan_completed','bio_age_increased','nps_detractor',
                       'stage_changed_at_risk','goal_deadline_approaching')),
    trigger_value  INTEGER,
    action_type    TEXT NOT NULL DEFAULT 'send_reminder'
                   CHECK (action_type IN (
                       'send_reminder','send_message','change_stage','create_appointment')),
    template_id    INTEGER REFERENCES message_templates(id) ON DELETE SET NULL,
    action_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_active      BOOLEAN NOT NULL DEFAULT true,
    last_run_at    TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fur_coach_active ON follow_up_rules(coach_id, is_active);
CREATE INDEX IF NOT EXISTS idx_fur_trigger      ON follow_up_rules(trigger_event, is_active);
