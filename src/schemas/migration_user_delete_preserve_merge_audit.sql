-- @requires: migration_user_delete_merged_accounts.sql

-- Keep the automatic-merge audit trail even when the underlying person is hard
-- deleted. Immutable snapshots preserve both original ids while nullable live
-- references are cleared by PostgreSQL during the winner/loser cascade.

ALTER TABLE user_merges
  ADD COLUMN IF NOT EXISTS winner_user_id_snapshot TEXT;
ALTER TABLE user_merges
  ADD COLUMN IF NOT EXISTS loser_user_id_snapshot TEXT;

UPDATE user_merges
SET winner_user_id_snapshot = winner_user_id
WHERE winner_user_id_snapshot IS NULL;
UPDATE user_merges
SET loser_user_id_snapshot = loser_user_id
WHERE loser_user_id_snapshot IS NULL;

CREATE OR REPLACE FUNCTION snapshot_user_merge_ids()
RETURNS TRIGGER AS $$
BEGIN
  NEW.winner_user_id_snapshot := COALESCE(NEW.winner_user_id_snapshot, NEW.winner_user_id);
  NEW.loser_user_id_snapshot := COALESCE(NEW.loser_user_id_snapshot, NEW.loser_user_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_snapshot_user_merge_ids ON user_merges;
CREATE TRIGGER trg_snapshot_user_merge_ids
BEFORE INSERT ON user_merges
FOR EACH ROW EXECUTE FUNCTION snapshot_user_merge_ids();

ALTER TABLE user_merges
  ALTER COLUMN winner_user_id_snapshot SET NOT NULL;
ALTER TABLE user_merges
  ALTER COLUMN loser_user_id_snapshot SET NOT NULL;
ALTER TABLE user_merges
  ALTER COLUMN winner_user_id DROP NOT NULL;
ALTER TABLE user_merges
  ALTER COLUMN loser_user_id DROP NOT NULL;

ALTER TABLE user_merges
  DROP CONSTRAINT IF EXISTS user_merges_winner_user_id_fkey;
ALTER TABLE user_merges
  ADD CONSTRAINT user_merges_winner_user_id_fkey
  FOREIGN KEY (winner_user_id) REFERENCES users(user_id) ON DELETE SET NULL;

ALTER TABLE user_merges
  DROP CONSTRAINT IF EXISTS user_merges_loser_user_id_fkey;
ALTER TABLE user_merges
  ADD CONSTRAINT user_merges_loser_user_id_fkey
  FOREIGN KEY (loser_user_id) REFERENCES users(user_id) ON DELETE SET NULL;
