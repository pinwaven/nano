CREATE TABLE IF NOT EXISTS academy_enrollments (
  id            SERIAL PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  cohort        TEXT,
  status        TEXT NOT NULL DEFAULT 'active',
  enrolled_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  enrolled_by   TEXT,
  notes         TEXT,
  UNIQUE(user_id)
);
