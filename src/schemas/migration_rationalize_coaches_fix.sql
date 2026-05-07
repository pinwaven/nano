-- Drop profile columns from coaches that were not removed by migration_rationalize_coaches.sql
ALTER TABLE coaches DROP COLUMN IF EXISTS name;
ALTER TABLE coaches DROP COLUMN IF EXISTS email;
ALTER TABLE coaches DROP COLUMN IF EXISTS phone;
ALTER TABLE coaches DROP COLUMN IF EXISTS avatar_url;
ALTER TABLE coaches DROP COLUMN IF EXISTS language;

-- Ensure user_id is NOT NULL and has a UNIQUE constraint
ALTER TABLE coaches ALTER COLUMN user_id SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coaches_user_id_unique') THEN
    ALTER TABLE coaches ADD CONSTRAINT coaches_user_id_unique UNIQUE (user_id);
  END IF;
END $$;
