-- Academy Lessons Migration
-- Adds multi-lesson/chapter support within each course

CREATE TABLE IF NOT EXISTS academy_lessons (
    id          SERIAL PRIMARY KEY,
    course_id   INTEGER NOT NULL REFERENCES academy_courses(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    description TEXT,
    oss_key     TEXT,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_academy_lessons_course ON academy_lessons(course_id);
