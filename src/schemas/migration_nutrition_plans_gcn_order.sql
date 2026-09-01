-- Links a proposed plan to the paid GCN order it was formulated to fulfil.
--
-- A custom-dots order can be placed in either sequence, and nano needs to tell them apart:
--
--   formulate → buy   the user runs the chat tool, gets a 'proposed' plan, and orders it. GCN's
--                     checkout prices that exact recipe (handleGetFormulationCheckoutSnapshot),
--                     so the order already knows which formula it is for and nano needs no link.
--   buy → formulate   the user buys a flat-priced 28-day package first. GCN parks the order at
--                     'awaiting_formulation' with no recipe, and the chat tool is what fills it
--                     in. THAT is what these columns record.
--
-- gcn_order_id is plain TEXT with no FK, the same way viva_ag_formulations.gcn_order_id is: GCN
-- is a separate database on the same cluster (CLAUDE.md §32), so cross-boundary referential
-- integrity is unavailable and is not pretended at.
--
-- A 'proposed' row with submitted_to_gcn_at set and gcn_order_id NULL means the submit call to
-- GCN was attempted and did not land — the query that finds orders needing a manual retry.
--
-- @requires: migration_nutrition_plans_proposed.sql

ALTER TABLE nutrition_plans ADD COLUMN IF NOT EXISTS gcn_order_id TEXT;
ALTER TABLE nutrition_plans ADD COLUMN IF NOT EXISTS submitted_to_gcn_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_nutrition_plans_gcn_order
    ON nutrition_plans (gcn_order_id) WHERE gcn_order_id IS NOT NULL;
