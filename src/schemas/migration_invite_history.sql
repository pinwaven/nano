-- Permanent invite history: preserve "who invited who" even after user deletion

-- Preserve inviter identity (no FK, written once at creation time)
ALTER TABLE invitations
  ADD COLUMN IF NOT EXISTS created_by_snapshot TEXT;

UPDATE invitations
  SET created_by_snapshot = created_by
  WHERE created_by IS NOT NULL AND created_by_snapshot IS NULL;

-- Preserve redeemer identity (no FK, written once at redemption time)
ALTER TABLE invitation_uses
  ADD COLUMN IF NOT EXISTS user_id_snapshot TEXT;

UPDATE invitation_uses
  SET user_id_snapshot = user_id
  WHERE user_id IS NOT NULL AND user_id_snapshot IS NULL;

-- Allow user_id to become NULL so the row survives when a user is deleted
ALTER TABLE invitation_uses ALTER COLUMN user_id DROP NOT NULL;

-- Change FK from CASCADE (row deleted with user) to SET NULL (row kept, user_id nulled)
ALTER TABLE invitation_uses DROP CONSTRAINT IF EXISTS invitation_uses_user_id_fkey;
ALTER TABLE invitation_uses ADD CONSTRAINT invitation_uses_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL;

-- Move unique constraint to the immutable snapshot column (user_id can now be NULL)
DROP INDEX IF EXISTS idx_invitation_uses_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_invitation_uses_unique
  ON invitation_uses(invitation_id, user_id_snapshot);
