ALTER TABLE academy_enrollments ADD COLUMN IF NOT EXISTS course_id INTEGER REFERENCES academy_courses(id);

UPDATE academy_enrollments SET course_id = 4 WHERE course_id IS NULL;

ALTER TABLE academy_enrollments ALTER COLUMN course_id SET NOT NULL;

ALTER TABLE academy_enrollments DROP CONSTRAINT IF EXISTS academy_enrollments_user_id_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'academy_enrollments_user_id_course_id_key'
  ) THEN
    ALTER TABLE academy_enrollments ADD CONSTRAINT academy_enrollments_user_id_course_id_key UNIQUE (user_id, course_id);
  END IF;
END $$;
