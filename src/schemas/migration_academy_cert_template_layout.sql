-- Per-template text overlay positions for auto-generating certificate images
-- @requires: migration_academy_overhaul.sql
ALTER TABLE academy_certifications
  ADD COLUMN IF NOT EXISTS template_layout JSONB DEFAULT '{}'::jsonb;
