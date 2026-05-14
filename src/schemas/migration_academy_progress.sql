-- Academy Coach Progress Migration
-- Tracks which lessons each coach has completed (idempotent inserts via ON CONFLICT)

CREATE TABLE IF NOT EXISTS academy_coach_progress (
    id              SERIAL PRIMARY KEY,
    coach_user_id   TEXT NOT NULL,
    lesson_id       INTEGER NOT NULL REFERENCES academy_lessons(id) ON DELETE CASCADE,
    completed_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(coach_user_id, lesson_id)
);

CREATE INDEX IF NOT EXISTS idx_academy_progress_coach ON academy_coach_progress(coach_user_id);
