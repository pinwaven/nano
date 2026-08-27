-- @requires: migration_academy_overhaul.sql

ALTER TABLE academy_certifications DROP COLUMN IF EXISTS tier;
