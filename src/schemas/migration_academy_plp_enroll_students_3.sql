-- Follow-up to migration_academy_plp_enroll_students.sql: the last unmatched
-- xlsx row (秦湄) was also found by name — different phone number in
-- temp/PLP Student List.xlsx than what's on file. Enrolls her into course_id 4
-- (谢克曼长寿管理实操班). All 31 xlsx rows with a 证书编号 are now enrolled.
INSERT INTO academy_enrollments (user_id, course_id, cohort, status, enrolled_by, notes) SELECT user_id, 4, '第一期', 'active', NULL, NULL FROM users WHERE user_id = '01255c93' ON CONFLICT (user_id, course_id) DO NOTHING;
