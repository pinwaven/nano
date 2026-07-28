-- Follow-up to migration_academy_plp_enroll_students.sql: two of the three
-- xlsx rows that had no match by phone (刘君霞, 王悦) were found by name — they
-- used a different phone number in temp/PLP Student List.xlsx than what's on
-- file. Enrolls them into course_id 4 (谢克曼长寿管理实操班). The third
-- unmatched row (秦湄) is still not found and remains unenrolled.
INSERT INTO academy_enrollments (user_id, course_id, cohort, status, enrolled_by, notes) SELECT user_id, 4, '第一期', 'active', NULL, NULL FROM users WHERE user_id = 'f44c794a' ON CONFLICT (user_id, course_id) DO NOTHING;
INSERT INTO academy_enrollments (user_id, course_id, cohort, status, enrolled_by, notes) SELECT user_id, 4, '第一期', 'active', NULL, NULL FROM users WHERE user_id = '3298795e' ON CONFLICT (user_id, course_id) DO NOTHING;
