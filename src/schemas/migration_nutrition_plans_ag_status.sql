-- A nutrition plan can now originate from the external Viva AG agent, and such a plan exists in
-- a state nano has never had before: expert-approved, but not yet in effect, because the user
-- does not physically have the capsules yet.
--
-- 'approved' — the recipe is settled and a batch is being compounded/shipped. Deliberately NOT
--              'pending': that value means "an async formulation is mid-flight and may never
--              land", is written and read by _handleFormulaDotsAgentic's own flow, and carries
--              no schedules by a different rationale. Reusing it would let the topup/commit
--              paths activate a plan whose box hasn't shipped.
--
-- An 'approved' plan has NO nutrition_schedules rows. They are generated at the moment the user
-- scans the received box (handlers/boxes.js), which is also when start_date is rewritten to that
-- day — so the 28-day cycle starts when the user can actually take the capsules.
--
-- handleGetNutritionPlan filters status = 'active', so an approved-not-yet-scanned plan is
-- invisible to the Dots subtab with no code change: the user keeps seeing their previous plan
-- until the new box arrives.

ALTER TABLE nutrition_plans DROP CONSTRAINT IF EXISTS nutrition_plans_status_check;
ALTER TABLE nutrition_plans ADD CONSTRAINT nutrition_plans_status_check
    CHECK (status IN ('pending', 'approved', 'active', 'superseded'));

-- 'nano' (the default) covers every pre-existing row and everything nano's own formulator makes.
ALTER TABLE nutrition_plans ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'nano';
ALTER TABLE nutrition_plans ADD COLUMN IF NOT EXISTS ag_formulation_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_nutrition_plans_ag_formulation
    ON nutrition_plans (ag_formulation_id) WHERE ag_formulation_id IS NOT NULL;
