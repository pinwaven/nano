-- @requires: migration_user_merge_preserve_access_context.sql
-- A merge demotes the loser's primary phone before moving it to the winner to avoid the
-- one-primary-per-user unique index. If the winner had no phone, the transferred number was
-- left secondary. Every merged survivor with at least one phone must have exactly one primary.
-- Clear the inactive row's denormalized cache first: users.phone itself is unique, even though
-- the authoritative user_phones row has already moved to the winner.
UPDATE users loser
   SET phone = NULL,
       phone_verified_at = NULL,
       updated_at = NOW()
  FROM user_merges um
 WHERE loser.user_id = um.loser_user_id
   AND loser.phone IS NOT NULL
   AND EXISTS (
       SELECT 1 FROM user_phones up
        WHERE up.user_id = um.winner_user_id AND up.phone = loser.phone
   );

WITH merged_winners AS (
    SELECT DISTINCT winner_user_id AS user_id FROM user_merges
), missing_primary AS (
    SELECT mw.user_id
      FROM merged_winners mw
     WHERE EXISTS (SELECT 1 FROM user_phones up WHERE up.user_id = mw.user_id)
       AND NOT EXISTS (
           SELECT 1 FROM user_phones up WHERE up.user_id = mw.user_id AND up.is_primary
       )
), selected AS (
    SELECT DISTINCT ON (up.user_id)
           up.user_id, up.id, up.phone, up.verified_at
      FROM user_phones up
      JOIN missing_primary mp ON mp.user_id = up.user_id
     ORDER BY up.user_id, up.verified_at DESC NULLS LAST, up.created_at DESC, up.id DESC
), promoted AS (
    UPDATE user_phones up
       SET is_primary = (up.id = selected.id)
      FROM selected
     WHERE up.user_id = selected.user_id
     RETURNING selected.user_id, selected.phone, selected.verified_at
)
UPDATE users u
   SET phone = promoted.phone,
       phone_verified_at = promoted.verified_at,
       updated_at = NOW()
  FROM promoted
 WHERE u.user_id = promoted.user_id;
