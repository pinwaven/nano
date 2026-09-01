-- Re-adds tier as an optional (nullable) field on certifications — "None" is a valid value.
-- @requires: migration_academy_overhaul.sql
ALTER TABLE academy_certifications
  ADD COLUMN IF NOT EXISTS tier TEXT CHECK (tier IN ('bronze','silver','gold','platinum'));
