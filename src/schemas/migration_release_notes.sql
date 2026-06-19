CREATE TABLE IF NOT EXISTS release_notes (
    version      TEXT PRIMARY KEY,
    title        TEXT NOT NULL,
    summary      JSONB NOT NULL DEFAULT '[]',
    published_at DATE NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
