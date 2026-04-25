CREATE TABLE IF NOT EXISTS reminders (
    id            BIGSERIAL PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    coach_id      INTEGER REFERENCES coaches(id) ON DELETE SET NULL,
    content       TEXT NOT NULL,
    scheduled_for TIMESTAMPTZ NOT NULL,
    recurrence    TEXT DEFAULT NULL CHECK (recurrence IN ('daily', 'weekly')),
    status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'cancelled')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(scheduled_for) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_reminders_user ON reminders(user_id);
