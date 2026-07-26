-- Same-system duplicate-account merge (matched on government_id, or normalized
-- first_name+last_name+birth_date when government_id is absent on either side).
-- merged_into_user_id on the loser row means "resolve this account's identity to
-- the winner" — every login path must follow it transparently (see
-- resolveMergedUser in handlers/login.js / phone-otp.js).
ALTER TABLE users ADD COLUMN IF NOT EXISTS merged_into_user_id TEXT REFERENCES users(user_id);

-- Required audit trail: a merge happens automatically, without the user initiating
-- it, so this is the only record of why two accounts became one.
CREATE TABLE IF NOT EXISTS user_merges (
    id              SERIAL PRIMARY KEY,
    winner_user_id  TEXT NOT NULL REFERENCES users(user_id),
    loser_user_id   TEXT NOT NULL REFERENCES users(user_id),
    matched_on      TEXT NOT NULL, -- 'government_id' | 'name_birthday'
    matched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    conflict_notes  JSONB NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_user_merges_loser ON user_merges (loser_user_id);

-- coaches has no active/inactive column — needed for the merge's soft-supersede
-- conflict handling (two merging accounts both being a coach): the older coaches
-- row is marked inactive rather than deleted, since deleting it would destroy
-- history other tables (coach_crm_*, health_plans, etc.) still reference.
ALTER TABLE coaches ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

-- coaches_user_id_unique / academy_enrollments' inline UNIQUE(user_id) are both plain
-- (non-partial) unique constraints — a superseded historical row can't coexist with the
-- surviving active one under the same user_id unless the constraint excludes superseded
-- rows. Without this, the merge's supersede step would itself throw a unique violation.
ALTER TABLE coaches DROP CONSTRAINT IF EXISTS coaches_user_id_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_coaches_user_id_active_unique ON coaches (user_id) WHERE status != 'superseded';

ALTER TABLE academy_enrollments DROP CONSTRAINT IF EXISTS academy_enrollments_user_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_academy_enrollments_user_id_active_unique ON academy_enrollments (user_id) WHERE status != 'superseded';
