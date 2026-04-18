-- Migration: Rename Coach to Coach (formerly PHM)
-- 1. Rename coaches table (if it was named phms)
ALTER TABLE phms RENAME TO coaches;

-- 2. Rename coach_id column in users table (if it was named phm_id)
ALTER TABLE users RENAME COLUMN phm_id TO coach_id;

-- 3. If there are any other dependencies or comments, update them here.
-- Note: Foreign key constraints should automatically follow the table rename.
