-- Academy Base Tables Migration
-- Creates academy_courses and academy_library with IF NOT EXISTS for idempotency

CREATE TABLE IF NOT EXISTS academy_courses (
    id          SERIAL PRIMARY KEY,
    title       TEXT NOT NULL,
    description TEXT,
    oss_key     TEXT,
    status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS academy_library (
    id          SERIAL PRIMARY KEY,
    title       TEXT NOT NULL,
    oss_key     TEXT NOT NULL,
    file_size   INTEGER,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
