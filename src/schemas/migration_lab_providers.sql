-- lab_providers: per-lab credentials and polling state
-- lab_name matches the adapter registry key (e.g. 'kingmed', 'fros')
-- Multiple rows with the same lab_name support regional instances of the same lab

CREATE TABLE IF NOT EXISTS lab_providers (
    id                  SERIAL PRIMARY KEY,
    lab_name            TEXT NOT NULL,        -- adapter key: 'kingmed', 'fros', etc.
    label               TEXT,                 -- human label: 'KingMed Shanghai'
    api_base_url        TEXT NOT NULL,
    api_key_enc         TEXT,                 -- AES-256 encrypted at rest
    webhook_secret_enc  TEXT,                 -- AES-256 encrypted at rest
    poll_enabled        BOOLEAN NOT NULL DEFAULT TRUE,
    last_polled_at      TIMESTAMPTZ,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE
);
