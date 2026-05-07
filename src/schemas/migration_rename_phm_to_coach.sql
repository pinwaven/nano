-- Migration: Rename Coach to Coach (formerly PHM)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'phms') THEN
    ALTER TABLE phms RENAME TO coaches;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'phm_id') THEN
    ALTER TABLE users RENAME COLUMN phm_id TO coach_id;
  END IF;
END $$;
