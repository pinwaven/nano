-- lab_user_mappings: links a third-party lab's patient ID to a Nano user
-- One user can have multiple mappings (different labs or regional instances)
-- Populated by admin or by user during lab registration flow

CREATE TABLE IF NOT EXISTS lab_user_mappings (
    id             SERIAL PRIMARY KEY,
    user_id        TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    lab_name       TEXT NOT NULL,         -- matches adapter registry key: 'kingmed', 'fros', etc.
    lab_patient_id TEXT NOT NULL,         -- the lab's own patient identifier
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(lab_name, lab_patient_id)      -- one lab patient ID maps to exactly one Nano user
);

CREATE INDEX IF NOT EXISTS idx_lab_user_mappings_user
    ON lab_user_mappings(user_id);
