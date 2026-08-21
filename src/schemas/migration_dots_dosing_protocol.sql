-- Migration: Add dosing_protocol to dots — marks dots that must NOT be dosed every day of a
-- weekly plan. Found via live agentic-formulation sampling 2026-08-08: DOT-N7's own catalog
-- description says "A senolytic pulse protocol -- 2 consecutive days per month only, not a
-- daily dose" but the commit pipeline (_commitNutritionPlan) wrote the model's chosen count into
-- all 7 identical days regardless — a real dosing-schedule bug, not a prompt/LLM issue, and
-- JUDGE independently caught it as a "critical protocol violation" on repeated live runs.
--
-- dosing_protocol: 'daily' (default, unchanged behavior for all other dots) | 'pulse'.
-- pulse_days_per_cycle / pulse_cycle_days: for a pulse dot, N consecutive active days out of
-- every M-day rolling cycle (DOT-N7: 2 days per ~30-day cycle) — anchored to a fixed epoch so
-- the active window is a deterministic function of the calendar date alone, not of when a plan
-- happens to be (re)generated (see _isPulseActiveDate in handlers/dots.js).

ALTER TABLE dots ADD COLUMN IF NOT EXISTS dosing_protocol TEXT NOT NULL DEFAULT 'daily'
    CHECK (dosing_protocol IN ('daily', 'pulse'));
ALTER TABLE dots ADD COLUMN IF NOT EXISTS pulse_days_per_cycle INTEGER;
ALTER TABLE dots ADD COLUMN IF NOT EXISTS pulse_cycle_days INTEGER;

UPDATE dots SET dosing_protocol = 'pulse', pulse_days_per_cycle = 2, pulse_cycle_days = 30
WHERE key_name = 'DOT-N7';

-- Verify
SELECT key_name, name, dosing_protocol, pulse_days_per_cycle, pulse_cycle_days FROM dots ORDER BY id;
