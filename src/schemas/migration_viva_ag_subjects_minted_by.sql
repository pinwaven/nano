-- Why a subject has a handle. `claim` is the default and the rule: a subject who
-- invoked the agent. `premier-partner` is the one widening, decided 2026-09-21:
-- every active premier-tier partner (GCN silver/gold/platinum/diamond_store)
-- is mirrored ahead of a first job, seeded by scripts/seed-viva-ag-subjects.js.
-- The column keeps the two populations countable apart.
-- @requires: migration_viva_ag_subjects.sql
ALTER TABLE viva_ag_subjects ADD COLUMN IF NOT EXISTS minted_by TEXT NOT NULL DEFAULT 'claim';
