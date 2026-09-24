-- Subjects who invoked the agent before viva_ag_subjects existed get their handle now,
-- so the agent's change feed lists them without waiting for a next claim. Random via
-- md5(random()) rather than gen_random_bytes(): pgcrypto is not on this shared cluster.
-- @requires: migration_viva_ag_subjects.sql
INSERT INTO viva_ag_subjects (user_id, subject_ref)
SELECT DISTINCT j.user_id, 'vs_' || substr(md5(random()::text || clock_timestamp()::text || j.user_id), 1, 24)
  FROM viva_ag_jobs j
  JOIN users u ON u.user_id = j.user_id
ON CONFLICT (user_id) DO NOTHING;
