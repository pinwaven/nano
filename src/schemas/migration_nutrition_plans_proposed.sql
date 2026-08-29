-- The Formulate-Dots chat tool proposes a real 28-day plan again.
--
-- History: the tool used to commit an 'active' plan directly; CLAUDE.md §28b made it
-- evaluation-only (writing nothing) once the 28-day formula a user actually receives moved to
-- Viva AG's dots_formulation job. That left it with no path to the store — GCN's
-- custom-formulation checkout prices a recipe out of a nutrition_plans row, and there was no
-- longer a row to price. This adds a fourth status for exactly that gap.
--
-- 'proposed' — the user asked the chat tool what their data implies, and this is the answer.
--              It is a real, purchasable 28-day recipe, but nothing has been compounded and the
--              user has no capsules, so it is deliberately NOT a plan they are "on":
--
--                * NO nutrition_schedules rows (same rationale as 'approved'). The 56 capsules
--                  are generated when the delivered box is scanned, which is also when
--                  start_date becomes a real date — so the cycle starts the day the user can
--                  actually take them, not the day they asked a question in chat.
--                * handleGetNutritionPlan filters status = 'active', so a proposal is invisible
--                  to the Dots subtab with no code change. A user mid-cycle on a previous box
--                  keeps seeing that box's plan while a proposal sits alongside it.
--                * It never supersedes an 'active' plan. Only a previous 'proposed' row is
--                  superseded when a new proposal is made (see _commitProposedPlan).
--
-- Distinct from the three existing values, all of which it would be wrong to reuse:
--   'pending'   — an async formulation is mid-flight and may never land.
--   'approved'  — a nutrition expert has signed the recipe off and a batch is being compounded.
--                 A proposal has had no clinical review at all; conflating the two would let
--                 unreviewed model output reach the compounding queue.
--   'active'    — the user physically has the capsules and the schedule is running.
--
-- @requires: migration_nutrition_plans_ag_status.sql

ALTER TABLE nutrition_plans DROP CONSTRAINT IF EXISTS nutrition_plans_status_check;
ALTER TABLE nutrition_plans ADD CONSTRAINT nutrition_plans_status_check
    CHECK (status IN ('pending', 'proposed', 'approved', 'active', 'superseded'));

-- The steady-state AM/PM allocation, shaped { "morning": {"DOT-N1": 2, ...},
-- "evening": {...} }. A 'proposed' plan has no schedules to read the recipe back out of, so it
-- has to live on the row itself — the AG flow's equivalent lives in viva_ag_formulations.capsules.
-- Expanded into the 56 real capsules by _expandPlanDay at box-scan time.
ALTER TABLE nutrition_plans ADD COLUMN IF NOT EXISTS proposed_recipe JSONB;

-- One live proposal per user. Re-running the chat tool replaces the previous proposal rather
-- than accumulating rows the store could price inconsistently; _commitProposedPlan supersedes
-- the old one in the same transaction, so this index is a backstop against a concurrent double
-- submission, not the mechanism.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_nutrition_plans_proposed
    ON nutrition_plans (user_id) WHERE status = 'proposed';
