-- @requires: migration_users_merge.sql

-- A hard-deleted user may be the surviving identity of one or more automatic
-- account merges. Those retired user rows and their merge audit rows belong to
-- the same person, so remove the whole merge family instead of letting the two
-- NO ACTION foreign keys make the admin delete button fail.

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_merged_into_user_id_fkey;
ALTER TABLE users
  ADD CONSTRAINT users_merged_into_user_id_fkey
  FOREIGN KEY (merged_into_user_id) REFERENCES users(user_id) ON DELETE CASCADE;

ALTER TABLE user_merges
  DROP CONSTRAINT IF EXISTS user_merges_winner_user_id_fkey;
ALTER TABLE user_merges
  ADD CONSTRAINT user_merges_winner_user_id_fkey
  FOREIGN KEY (winner_user_id) REFERENCES users(user_id) ON DELETE CASCADE;

ALTER TABLE user_merges
  DROP CONSTRAINT IF EXISTS user_merges_loser_user_id_fkey;
ALTER TABLE user_merges
  ADD CONSTRAINT user_merges_loser_user_id_fkey
  FOREIGN KEY (loser_user_id) REFERENCES users(user_id) ON DELETE CASCADE;
