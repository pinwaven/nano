-- Rename coach_user_id → user_id in all academy per-user tracking tables.
-- Academy is now open to all users, not just coaches.

ALTER TABLE academy_coach_progress RENAME COLUMN coach_user_id TO user_id;
DROP INDEX IF EXISTS idx_academy_progress_coach;
CREATE INDEX IF NOT EXISTS idx_academy_progress_user ON academy_coach_progress(user_id);

ALTER TABLE academy_quiz_attempts RENAME COLUMN coach_user_id TO user_id;
DROP INDEX IF EXISTS idx_aqa_coach;
CREATE INDEX IF NOT EXISTS idx_aqa_user ON academy_quiz_attempts(user_id);

ALTER TABLE academy_credit_ledger RENAME COLUMN coach_user_id TO user_id;
DROP INDEX IF EXISTS idx_acl_coach;
CREATE INDEX IF NOT EXISTS idx_acl_user ON academy_credit_ledger(user_id);

ALTER TABLE academy_coach_certifications RENAME COLUMN coach_user_id TO user_id;
DROP INDEX IF EXISTS idx_acc_coach;
CREATE INDEX IF NOT EXISTS idx_acc_user ON academy_coach_certifications(user_id);
