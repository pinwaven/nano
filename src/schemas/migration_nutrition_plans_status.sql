-- Tracks the lifecycle of a nutrition_plans row so an in-flight async (agentic) dot
-- formulation doesn't overwrite the previously-active plan until it actually finishes.
-- 'pending'   — inserted immediately when formulation starts, no nutrition_schedules rows yet.
-- 'active'    — the one plan currently in effect for a user (at most one at a time).
-- 'superseded'— a formerly-active plan, kept for history (prior weeks' dot intake).
-- Default 'active' means every pre-existing row, and Nano's synchronous insert path, need
-- zero code change to stay correct. See CLAUDE.md for the full design writeup.

ALTER TABLE nutrition_plans ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('pending', 'active', 'superseded'));

CREATE INDEX IF NOT EXISTS idx_nutrition_plans_user_status ON nutrition_plans (user_id, status);
