-- @requires: migration_academy_base.sql
-- Existing catalog is Aeviva Academy. NULL remains a shared legacy catalog if absent.
ALTER TABLE academy_courses ADD COLUMN IF NOT EXISTS channel_id INTEGER REFERENCES channels(id);
UPDATE academy_courses SET channel_id = (SELECT id FROM channels WHERE key_name = 'aeviva') WHERE channel_id IS NULL;
-- Opt-out is local to a channel. Existing explicit enrollments retain access.
CREATE OR REPLACE FUNCTION academy_course_visible(course INTEGER, channel INTEGER, learner TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
 SELECT EXISTS (
   SELECT 1 FROM academy_courses c WHERE c.id = course AND (
     channel IS NULL OR c.channel_id = channel
     OR COALESCE((SELECT config->>'academy_inherit_courses' FROM channels WHERE id = channel), 'true') <> 'false'
     OR EXISTS (SELECT 1 FROM academy_enrollments e WHERE e.course_id = c.id AND e.user_id = learner)
   )
 )
$$;
