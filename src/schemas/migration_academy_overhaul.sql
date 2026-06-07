-- Academy System Overhaul Migration
-- Adds credits, tiers, content types, quizzes, certifications, and learning paths

-- Extend academy_courses
ALTER TABLE academy_courses
  ADD COLUMN IF NOT EXISTS credit_value           INT DEFAULT 10,
  ADD COLUMN IF NOT EXISTS level                  TEXT NOT NULL DEFAULT 'foundation'
      CHECK (level IN ('foundation','intermediate','advanced','expert')),
  ADD COLUMN IF NOT EXISTS prerequisite_course_id INT REFERENCES academy_courses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS thumbnail_oss_key      TEXT;

-- Extend academy_lessons
ALTER TABLE academy_lessons
  ADD COLUMN IF NOT EXISTS content_type       TEXT NOT NULL DEFAULT 'video'
      CHECK (content_type IN ('video','text','interactive')),
  ADD COLUMN IF NOT EXISTS text_content       TEXT,
  ADD COLUMN IF NOT EXISTS credit_value       INT DEFAULT 5,
  ADD COLUMN IF NOT EXISTS min_watch_seconds  INT;

-- Extend academy_coach_progress
ALTER TABLE academy_coach_progress
  ADD COLUMN IF NOT EXISTS credits_earned      INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quiz_best_score     INT,
  ADD COLUMN IF NOT EXISTS time_spent_seconds  INT DEFAULT 0;

-- Quiz questions per lesson (supports video/text/interactive; case study = scenario field)
CREATE TABLE IF NOT EXISTS academy_lesson_quizzes (
  id            SERIAL PRIMARY KEY,
  lesson_id     INT NOT NULL REFERENCES academy_lessons(id) ON DELETE CASCADE,
  scenario      TEXT,
  question      TEXT NOT NULL,
  options       JSONB NOT NULL,   -- [{text, is_correct, explanation}]
  sort_order    INT DEFAULT 0,
  credit_value  INT DEFAULT 5,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_alq_lesson ON academy_lesson_quizzes(lesson_id);

-- Coach quiz submissions
CREATE TABLE IF NOT EXISTS academy_quiz_attempts (
  id              SERIAL PRIMARY KEY,
  coach_user_id   TEXT NOT NULL,
  lesson_id       INT NOT NULL REFERENCES academy_lessons(id) ON DELETE CASCADE,
  answers         JSONB NOT NULL,   -- {question_id: selected_option_index}
  score           INT NOT NULL,     -- 0–100
  passed          BOOLEAN NOT NULL,
  credits_earned  INT DEFAULT 0,
  attempted_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_aqa_coach ON academy_quiz_attempts(coach_user_id);

-- Academy credit ledger (separate from monetary credit_ledger)
CREATE TABLE IF NOT EXISTS academy_credit_ledger (
  id              SERIAL PRIMARY KEY,
  coach_user_id   TEXT NOT NULL,
  amount          INT NOT NULL,
  reason          TEXT NOT NULL,   -- lesson_complete / quiz_pass / cert_earned / bonus
  ref_type        TEXT,            -- lesson / quiz / certification
  ref_id          INT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_acl_coach ON academy_credit_ledger(coach_user_id);

-- Certification definitions (admin-managed)
CREATE TABLE IF NOT EXISTS academy_certifications (
  id                    SERIAL PRIMARY KEY,
  title                 TEXT NOT NULL,
  description           TEXT,
  required_course_ids   INT[],
  min_credits           INT DEFAULT 0,
  tier                  TEXT DEFAULT 'bronze'
      CHECK (tier IN ('bronze','silver','gold','platinum')),
  badge_image_url       TEXT,
  is_active             BOOLEAN DEFAULT TRUE,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Certifications earned by coaches
CREATE TABLE IF NOT EXISTS academy_coach_certifications (
  id                  SERIAL PRIMARY KEY,
  coach_user_id       TEXT NOT NULL,
  certification_id    INT NOT NULL REFERENCES academy_certifications(id) ON DELETE CASCADE,
  earned_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(coach_user_id, certification_id)
);
CREATE INDEX IF NOT EXISTS idx_acc_coach ON academy_coach_certifications(coach_user_id);

-- Curated learning paths
CREATE TABLE IF NOT EXISTS academy_learning_paths (
  id          SERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT,
  tier        TEXT DEFAULT 'foundation'
      CHECK (tier IN ('foundation','intermediate','advanced','expert')),
  sort_order  INT DEFAULT 0,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Courses within a learning path (ordered)
CREATE TABLE IF NOT EXISTS academy_learning_path_courses (
  id          SERIAL PRIMARY KEY,
  path_id     INT NOT NULL REFERENCES academy_learning_paths(id) ON DELETE CASCADE,
  course_id   INT NOT NULL REFERENCES academy_courses(id) ON DELETE CASCADE,
  sort_order  INT DEFAULT 0,
  UNIQUE(path_id, course_id)
);
