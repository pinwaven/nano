-- Rationalize coaches table: make users the single source of truth for identity.
-- After this migration coaches = (id, user_id NOT NULL UNIQUE, channel_id, created_at)

-- Safety pre-check: if any coach has no user_id this will fail — create placeholder users first.
-- Run manually before applying:
--   SELECT id, name, email FROM coaches WHERE user_id IS NULL;

-- 1. Enforce required user link
ALTER TABLE coaches ALTER COLUMN user_id SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coaches_user_id_unique') THEN
    ALTER TABLE coaches ADD CONSTRAINT coaches_user_id_unique UNIQUE (user_id);
  END IF;
END $$;

-- Change FK to CASCADE so deleting a user removes their coach record
ALTER TABLE coaches DROP CONSTRAINT IF EXISTS coaches_user_id_fkey;
ALTER TABLE coaches ADD CONSTRAINT coaches_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE;

-- 2. Drop duplicated profile columns that now live on users
ALTER TABLE coaches DROP COLUMN IF EXISTS name;
ALTER TABLE coaches DROP COLUMN IF EXISTS email;
ALTER TABLE coaches DROP COLUMN IF EXISTS phone;
ALTER TABLE coaches DROP COLUMN IF EXISTS avatar_url;
ALTER TABLE coaches DROP COLUMN IF EXISTS language;
