-- Migration: shorten user_id to 7 hex chars derived from md5(old_user_id)
-- Also adds UNIQUE constraint on external_id for ON CONFLICT upserts.
-- Safe to run once against nano_db_dev.

BEGIN;

-- Step 1: add new short id column on users and populate
ALTER TABLE users ADD COLUMN IF NOT EXISTS new_uid TEXT;
UPDATE users SET new_uid = left(md5(user_id), 7) WHERE new_uid IS NULL;

-- Step 2: add matching column on every child table and populate
ALTER TABLE biomarkers           ADD COLUMN IF NOT EXISTS new_uid TEXT;
ALTER TABLE notifications         ADD COLUMN IF NOT EXISTS new_uid TEXT;
ALTER TABLE scans                 ADD COLUMN IF NOT EXISTS new_uid TEXT;
ALTER TABLE nutrition_plans       ADD COLUMN IF NOT EXISTS new_uid TEXT;
ALTER TABLE nutrition_schedules   ADD COLUMN IF NOT EXISTS new_uid TEXT;
ALTER TABLE user_identities       ADD COLUMN IF NOT EXISTS new_uid TEXT;

UPDATE biomarkers          b   SET new_uid = u.new_uid FROM users u WHERE b.user_id   = u.user_id;
UPDATE notifications        n   SET new_uid = u.new_uid FROM users u WHERE n.user_id   = u.user_id;
UPDATE scans                s   SET new_uid = u.new_uid FROM users u WHERE s.user_id   = u.user_id;
UPDATE nutrition_plans      p   SET new_uid = u.new_uid FROM users u WHERE p.user_id   = u.user_id;
UPDATE nutrition_schedules  ns  SET new_uid = u.new_uid FROM users u WHERE ns.user_id  = u.user_id;
UPDATE user_identities      ui  SET new_uid = u.new_uid FROM users u WHERE ui.user_id  = u.user_id;

-- Step 3: drop all FK constraints referencing users(user_id)
ALTER TABLE biomarkers          DROP CONSTRAINT IF EXISTS biomarkers_user_id_fkey;
ALTER TABLE notifications        DROP CONSTRAINT IF EXISTS notifications_user_id_fkey;
ALTER TABLE scans                DROP CONSTRAINT IF EXISTS scans_user_id_fkey;
ALTER TABLE nutrition_plans      DROP CONSTRAINT IF EXISTS nutrition_plans_user_id_fkey;
ALTER TABLE nutrition_schedules  DROP CONSTRAINT IF EXISTS nutrition_schedules_user_id_fkey;
ALTER TABLE user_identities      DROP CONSTRAINT IF EXISTS user_identities_user_id_fkey;

-- Step 4: drop old PK on users, swap columns
ALTER TABLE users DROP CONSTRAINT users_pkey;
ALTER TABLE users RENAME COLUMN user_id TO _old_user_id;
ALTER TABLE users RENAME COLUMN new_uid  TO user_id;
ALTER TABLE users ADD PRIMARY KEY (user_id);

-- Step 5: swap user_id on child tables
ALTER TABLE biomarkers          DROP COLUMN user_id; ALTER TABLE biomarkers          RENAME COLUMN new_uid TO user_id;
ALTER TABLE notifications        DROP COLUMN user_id; ALTER TABLE notifications        RENAME COLUMN new_uid TO user_id;
ALTER TABLE scans                DROP COLUMN user_id; ALTER TABLE scans                RENAME COLUMN new_uid TO user_id;
ALTER TABLE nutrition_plans      DROP COLUMN user_id; ALTER TABLE nutrition_plans      RENAME COLUMN new_uid TO user_id;
ALTER TABLE nutrition_schedules  DROP COLUMN user_id; ALTER TABLE nutrition_schedules  RENAME COLUMN new_uid TO user_id;
ALTER TABLE user_identities      DROP COLUMN user_id; ALTER TABLE user_identities      RENAME COLUMN new_uid TO user_id;

-- Step 6: re-add FK constraints
ALTER TABLE biomarkers          ADD CONSTRAINT biomarkers_user_id_fkey          FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE;
ALTER TABLE notifications        ADD CONSTRAINT notifications_user_id_fkey       FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE;
ALTER TABLE scans                ADD CONSTRAINT scans_user_id_fkey               FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE;
ALTER TABLE nutrition_plans      ADD CONSTRAINT nutrition_plans_user_id_fkey     FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE;
ALTER TABLE nutrition_schedules  ADD CONSTRAINT nutrition_schedules_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE;
ALTER TABLE user_identities      ADD CONSTRAINT user_identities_user_id_fkey     FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE;

-- Step 7: clean up old user_id column; add UNIQUE on external_id
ALTER TABLE users DROP COLUMN _old_user_id;
ALTER TABLE users ADD CONSTRAINT users_external_id_unique UNIQUE (external_id);

-- Step 8: rebuild indexes
DROP INDEX IF EXISTS idx_users_external_id;
DROP INDEX IF EXISTS idx_biomarkers_user_id_tested_at;
DROP INDEX IF EXISTS idx_notifications_user_id;
DROP INDEX IF EXISTS idx_scans_user_id;
DROP INDEX IF EXISTS idx_nutrition_plans_user_id;
DROP INDEX IF EXISTS idx_nutrition_schedules_user_date;

CREATE INDEX idx_users_external_id             ON users(external_id);
CREATE INDEX idx_biomarkers_user_id_tested_at  ON biomarkers(user_id, tested_at DESC);
CREATE INDEX idx_notifications_user_id         ON notifications(user_id);
CREATE INDEX idx_scans_user_id                 ON scans(user_id);
CREATE INDEX idx_nutrition_plans_user_id       ON nutrition_plans(user_id);
CREATE INDEX idx_nutrition_schedules_user_date ON nutrition_schedules(user_id, scheduled_date);

COMMIT;
