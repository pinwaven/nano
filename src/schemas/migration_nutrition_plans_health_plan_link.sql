-- Links a committed nutrition_plans row back to the health_plans (focus) row(s)
-- that shaped it, so the miniapp/GCN can display/reference "which focus" a
-- formulation was for without re-deriving it from active_health_plans each time.
-- Nullable: a formulation run with no active focus (today's default behavior)
-- leaves both columns null.

ALTER TABLE nutrition_plans ADD COLUMN IF NOT EXISTS primary_health_plan_id BIGINT
    REFERENCES health_plans(id) ON DELETE SET NULL;
ALTER TABLE nutrition_plans ADD COLUMN IF NOT EXISTS secondary_health_plan_id BIGINT
    REFERENCES health_plans(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_nutrition_plans_primary_health_plan ON nutrition_plans (primary_health_plan_id);
CREATE INDEX IF NOT EXISTS idx_nutrition_plans_secondary_health_plan ON nutrition_plans (secondary_health_plan_id);
