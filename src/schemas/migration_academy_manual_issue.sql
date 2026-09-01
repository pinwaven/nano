-- @requires: migration_academy_overhaul.sql

ALTER TABLE academy_coach_certifications
  ADD COLUMN IF NOT EXISTS is_manual_issue BOOLEAN DEFAULT FALSE;
