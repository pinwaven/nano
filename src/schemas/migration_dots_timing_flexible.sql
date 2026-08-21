-- Migration: Add timing_flexible to dots — marks whether a dot's ingredients have no real
-- diurnal (AM vs PM) pharmacological constraint, so the agentic formulation loop
-- (systemFormulaGenerate.js) can actually rebalance its count across morning/evening for a
-- more even AM/PM pill split, instead of guessing per-dot from free-text stimulant/sedative
-- wording every time. `timing` remains each dot's default/primary slot.
--
-- Classification is a best-effort product/clinical judgment call (confirmed 2026-08-07):
-- flexible = no known reason the ingredients must be confined to one time of day (fat-soluble
-- vitamins, mitochondrial/antioxidant support, probiotics, cholesterol/glycemic agents
-- classically dosed with multiple meals, etc). Fixed = a real reason to keep it locked —
-- DOT-N3 (magnesium/ashwagandha/saffron) is sleep-support and evening-only; DOT-N4 (Rhodiola,
-- a stimulating adaptogen) and DOT-N12 (Citicoline/Huperzine A, cognitive stimulants that can
-- disrupt sleep) are morning-only.

ALTER TABLE dots ADD COLUMN IF NOT EXISTS timing_flexible BOOLEAN NOT NULL DEFAULT false;

UPDATE dots SET timing_flexible = true WHERE key_name IN (
    'DOT-N1', 'DOT-N2', 'DOT-N5', 'DOT-N6', 'DOT-N7', 'DOT-N8', 'DOT-N9', 'DOT-N10',
    'DOT-N11', 'DOT-N13', 'DOT-N14', 'DOT-N15', 'DOT-N16', 'DOT-N17', 'DOT-N18'
);
-- DOT-N3, DOT-N4, DOT-N12 stay at the false default.

-- Verify
SELECT key_name, name, timing, timing_flexible FROM dots ORDER BY id;
