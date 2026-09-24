-- @requires: migration_users_merge.sql
-- Older-created accounts remain the merge survivor, but a newer duplicate may have been
-- deliberately assigned to a more specific child channel or granted additional roles.
-- Repair existing merges using the same rule as handlers/user-merge.js.
WITH RECURSIVE merge_pairs AS (
    SELECT um.id AS merge_id,
           w.user_id AS winner_user_id,
           w.channel_id AS winner_channel_id,
           COALESCE(w.roles, '{}'::text[]) AS winner_roles,
           l.channel_id AS loser_channel_id,
           COALESCE(l.roles, '{}'::text[]) AS loser_roles
      FROM user_merges um
      JOIN users w ON w.user_id = um.winner_user_id
      JOIN users l ON l.user_id = um.loser_user_id
), loser_lineage AS (
    SELECT merge_id, loser_channel_id AS channel_id
      FROM merge_pairs
     WHERE loser_channel_id IS NOT NULL
    UNION ALL
    SELECT ll.merge_id, c.parent_channel_id
      FROM loser_lineage ll
      JOIN channels c ON c.id = ll.channel_id
     WHERE c.parent_channel_id IS NOT NULL
), reconciled AS (
    SELECT p.winner_user_id,
           ARRAY(
             SELECT role
               FROM unnest(p.winner_roles || p.loser_roles) WITH ORDINALITY AS merged(role, position)
              GROUP BY role
              ORDER BY MIN(position)
           ) AS roles,
           CASE
             WHEN p.winner_channel_id IS NULL THEN p.loser_channel_id
             WHEN p.loser_channel_id IS NOT NULL AND EXISTS (
                 SELECT 1 FROM loser_lineage ll
                  WHERE ll.merge_id = p.merge_id AND ll.channel_id = p.winner_channel_id
             ) THEN p.loser_channel_id
             ELSE p.winner_channel_id
           END AS channel_id
      FROM merge_pairs p
)
UPDATE users winner
   SET roles = reconciled.roles,
       channel_id = reconciled.channel_id,
       updated_at = NOW()
  FROM reconciled
 WHERE winner.user_id = reconciled.winner_user_id
   AND (winner.roles IS DISTINCT FROM reconciled.roles
        OR winner.channel_id IS DISTINCT FROM reconciled.channel_id);
