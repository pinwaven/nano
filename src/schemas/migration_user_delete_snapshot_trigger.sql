-- @requires: migration_user_delete_preserve_merge_audit.sql

-- The preservation migration was exercised on dev before production and showed
-- that new merge rows also need their immutable snapshots filled automatically.
-- Keep this as a DB invariant so every current and future merge writer is safe.
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
