-- Opaque, stable handles for the subjects the external Viva AG agent has worked for.
--
-- The /viva-ag/* contract returns no user_id, openid or nickname anywhere; job_uid was
-- the only handle. A job handle cannot key anything that outlives the job, and the agent
-- (Curia) now keeps a per-subject replica of the twin bundle so that a job does not
-- re-download an unchanged twin across a border every time. subject_ref is what that
-- replica is keyed on: random, minted at the subject's first claim, never derived from
-- user_id, and only ever handed to the agent inside a claim or a versions listing.
--
-- Only subjects with at least one AG job ever get a row, so the agent can hold nothing
-- about a user who never invoked it.
-- @requires: migration_viva_ag_jobs.sql
CREATE TABLE IF NOT EXISTS viva_ag_subjects (
    user_id     TEXT PRIMARY KEY,
    subject_ref TEXT NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
