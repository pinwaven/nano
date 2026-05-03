-- Migration: health plan reminder system extension
-- Adds reminders config to plan templates, links reminders to plans, adds 'paused' status

-- 1. Add reminders JSONB config to health_plan_templates
ALTER TABLE health_plan_templates
  ADD COLUMN IF NOT EXISTS reminders JSONB NOT NULL DEFAULT '[]'::jsonb;

-- 2. Add plan_id FK to reminders table (enables bulk-cancel when plan ends)
ALTER TABLE reminders
  ADD COLUMN IF NOT EXISTS plan_id BIGINT REFERENCES health_plans(id) ON DELETE CASCADE;

-- 3. Extend status enum to include 'paused'
ALTER TABLE reminders DROP CONSTRAINT IF EXISTS reminders_status_check;
ALTER TABLE reminders ADD CONSTRAINT reminders_status_check
  CHECK (status IN ('pending', 'sent', 'cancelled', 'paused'));

-- Index for efficient plan-scoped reminder lookups
CREATE INDEX IF NOT EXISTS idx_reminders_plan_id
  ON reminders(plan_id) WHERE plan_id IS NOT NULL;
