-- Lets a physical Dots box be claimed by the person it was compounded for, which is what
-- activates their 28-day plan.
--
-- Until now `boxes` existed only to back a public, unauthenticated ingredient page: scanning a
-- box told you what was in it and nothing else. In the AG ordering flow the scan is the moment
-- the plan starts, so a box needs to know who claimed it and which plan it produced.
--
-- claimed_by_user_id is what makes the claim idempotent: re-scanning a box the same user already
-- claimed returns the existing plan rather than generating a second 28-day schedule.

ALTER TABLE boxes ADD COLUMN IF NOT EXISTS claimed_by_user_id TEXT REFERENCES users(user_id) ON DELETE SET NULL;
ALTER TABLE boxes ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
ALTER TABLE boxes ADD COLUMN IF NOT EXISTS nutrition_plan_id INTEGER REFERENCES nutrition_plans(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_boxes_claimed_by ON boxes (claimed_by_user_id) WHERE claimed_by_user_id IS NOT NULL;

-- A batch can now be snapshotted from an approved AG formulation instead of the user's currently
-- active nutrition plan — the whole point of the AG flow is that the box is manufactured BEFORE
-- the plan is in effect, so box_batches.plan_id would be null/stale for these.
ALTER TABLE box_batches ADD COLUMN IF NOT EXISTS ag_formulation_id BIGINT;
CREATE INDEX IF NOT EXISTS idx_box_batches_ag_formulation
    ON box_batches (ag_formulation_id) WHERE ag_formulation_id IS NOT NULL;
