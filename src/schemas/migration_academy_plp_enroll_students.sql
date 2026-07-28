-- Enrolls PLP ("谢克曼长寿管理实操班", course_id=4) students from
-- temp/PLP Student List.xlsx who have a 证书编号 (certificate number) assigned,
-- matched to existing users by phone number. Also corrects nickname where the
-- xlsx name differs from what's on file (matched by user_id, resolved from
-- phone at generation time). Idempotent: ON CONFLICT DO NOTHING on enrollment,
-- and nickname UPDATEs are safe to re-run. Each INSERT re-derives user_id via
-- a SELECT so it's a no-op (not an error) on any database where that user_id
-- doesn't exist (e.g. dev, unless it happens to mirror this data).
-- 3 xlsx rows with a 证书编号 had no matching user by phone and were skipped:
-- 刘君霞 (18510769862), 王悦 (13918472157), 秦湄 (13980633608).

-- Name corrections (xlsx 姓名 differs from users.nickname on file)
UPDATE users SET nickname = '宋灵彦' WHERE user_id = '6d20b3da';
UPDATE users SET nickname = '丁霞' WHERE user_id = '2b623b60';
UPDATE users SET nickname = '李智' WHERE user_id = 'fa52ae8f';
UPDATE users SET nickname = '刘荣华' WHERE user_id = 'eb821c10';
UPDATE users SET nickname = '毕辰' WHERE user_id = '641a6b10';
UPDATE users SET nickname = '陆艳' WHERE user_id = '619cbc19';
UPDATE users SET nickname = 'Karen张海燕' WHERE user_id = '45608991';
UPDATE users SET nickname = '李志娜' WHERE user_id = 'dc20b7f0';
UPDATE users SET nickname = '乔通宇' WHERE user_id = 'ef5e5ff3';

-- Enrollments
INSERT INTO academy_enrollments (user_id, course_id, cohort, status, enrolled_by, notes) SELECT user_id, 4, '第一期', 'active', NULL, NULL FROM users WHERE user_id = 'e983e7c2' ON CONFLICT (user_id, course_id) DO NOTHING;
INSERT INTO academy_enrollments (user_id, course_id, cohort, status, enrolled_by, notes) SELECT user_id, 4, '第一期', 'active', NULL, NULL FROM users WHERE user_id = '217438b4' ON CONFLICT (user_id, course_id) DO NOTHING;
INSERT INTO academy_enrollments (user_id, course_id, cohort, status, enrolled_by, notes) SELECT user_id, 4, '第一期', 'active', NULL, NULL FROM users WHERE user_id = 'e1a4a5a5' ON CONFLICT (user_id, course_id) DO NOTHING;
INSERT INTO academy_enrollments (user_id, course_id, cohort, status, enrolled_by, notes) SELECT user_id, 4, '第一期', 'active', NULL, NULL FROM users WHERE user_id = 'f6b766d1' ON CONFLICT (user_id, course_id) DO NOTHING;
INSERT INTO academy_enrollments (user_id, course_id, cohort, status, enrolled_by, notes) SELECT user_id, 4, '第一期', 'active', NULL, NULL FROM users WHERE user_id = '6d20b3da' ON CONFLICT (user_id, course_id) DO NOTHING;
INSERT INTO academy_enrollments (user_id, course_id, cohort, status, enrolled_by, notes) SELECT user_id, 4, '第一期', 'active', NULL, NULL FROM users WHERE user_id = 'd389f03b' ON CONFLICT (user_id, course_id) DO NOTHING;
INSERT INTO academy_enrollments (user_id, course_id, cohort, status, enrolled_by, notes) SELECT user_id, 4, '第一期', 'active', NULL, NULL FROM users WHERE user_id = '2b623b60' ON CONFLICT (user_id, course_id) DO NOTHING;
INSERT INTO academy_enrollments (user_id, course_id, cohort, status, enrolled_by, notes) SELECT user_id, 4, '第一期', 'active', NULL, NULL FROM users WHERE user_id = '0b9ef1ba' ON CONFLICT (user_id, course_id) DO NOTHING;
INSERT INTO academy_enrollments (user_id, course_id, cohort, status, enrolled_by, notes) SELECT user_id, 4, '第一期', 'active', NULL, NULL FROM users WHERE user_id = '6656d4e8' ON CONFLICT (user_id, course_id) DO NOTHING;
INSERT INTO academy_enrollments (user_id, course_id, cohort, status, enrolled_by, notes) SELECT user_id, 4, '第一期', 'active', NULL, NULL FROM users WHERE user_id = 'fa52ae8f' ON CONFLICT (user_id, course_id) DO NOTHING;
INSERT INTO academy_enrollments (user_id, course_id, cohort, status, enrolled_by, notes) SELECT user_id, 4, '第一期', 'active', NULL, NULL FROM users WHERE user_id = '15231f7a' ON CONFLICT (user_id, course_id) DO NOTHING;
INSERT INTO academy_enrollments (user_id, course_id, cohort, status, enrolled_by, notes) SELECT user_id, 4, '第一期', 'active', NULL, NULL FROM users WHERE user_id = 'eb821c10' ON CONFLICT (user_id, course_id) DO NOTHING;
INSERT INTO academy_enrollments (user_id, course_id, cohort, status, enrolled_by, notes) SELECT user_id, 4, '第一期', 'active', NULL, NULL FROM users WHERE user_id = '3d96f3d8' ON CONFLICT (user_id, course_id) DO NOTHING;
INSERT INTO academy_enrollments (user_id, course_id, cohort, status, enrolled_by, notes) SELECT user_id, 4, '第一期', 'active', NULL, NULL FROM users WHERE user_id = '641a6b10' ON CONFLICT (user_id, course_id) DO NOTHING;
INSERT INTO academy_enrollments (user_id, course_id, cohort, status, enrolled_by, notes) SELECT user_id, 4, '第一期', 'active', NULL, NULL FROM users WHERE user_id = 'fce8f13a' ON CONFLICT (user_id, course_id) DO NOTHING;
INSERT INTO academy_enrollments (user_id, course_id, cohort, status, enrolled_by, notes) SELECT user_id, 4, '第一期', 'active', NULL, NULL FROM users WHERE user_id = '2e62dc28' ON CONFLICT (user_id, course_id) DO NOTHING;
INSERT INTO academy_enrollments (user_id, course_id, cohort, status, enrolled_by, notes) SELECT user_id, 4, '第一期', 'active', NULL, NULL FROM users WHERE user_id = 'e045248d' ON CONFLICT (user_id, course_id) DO NOTHING;
INSERT INTO academy_enrollments (user_id, course_id, cohort, status, enrolled_by, notes) SELECT user_id, 4, '第一期', 'active', NULL, NULL FROM users WHERE user_id = '5891fcf0' ON CONFLICT (user_id, course_id) DO NOTHING;
INSERT INTO academy_enrollments (user_id, course_id, cohort, status, enrolled_by, notes) SELECT user_id, 4, '第一期', 'active', NULL, NULL FROM users WHERE user_id = '74a9b0c1' ON CONFLICT (user_id, course_id) DO NOTHING;
INSERT INTO academy_enrollments (user_id, course_id, cohort, status, enrolled_by, notes) SELECT user_id, 4, '第一期', 'active', NULL, NULL FROM users WHERE user_id = '619cbc19' ON CONFLICT (user_id, course_id) DO NOTHING;
INSERT INTO academy_enrollments (user_id, course_id, cohort, status, enrolled_by, notes) SELECT user_id, 4, '第一期', 'active', NULL, NULL FROM users WHERE user_id = '0d5c3cd9' ON CONFLICT (user_id, course_id) DO NOTHING;
INSERT INTO academy_enrollments (user_id, course_id, cohort, status, enrolled_by, notes) SELECT user_id, 4, '第一期', 'active', NULL, NULL FROM users WHERE user_id = '9e9998ea' ON CONFLICT (user_id, course_id) DO NOTHING;
INSERT INTO academy_enrollments (user_id, course_id, cohort, status, enrolled_by, notes) SELECT user_id, 4, '第一期', 'active', NULL, NULL FROM users WHERE user_id = '45608991' ON CONFLICT (user_id, course_id) DO NOTHING;
INSERT INTO academy_enrollments (user_id, course_id, cohort, status, enrolled_by, notes) SELECT user_id, 4, '第一期', 'active', NULL, NULL FROM users WHERE user_id = 'dc20b7f0' ON CONFLICT (user_id, course_id) DO NOTHING;
INSERT INTO academy_enrollments (user_id, course_id, cohort, status, enrolled_by, notes) SELECT user_id, 4, '第一期', 'active', NULL, NULL FROM users WHERE user_id = 'ef5e5ff3' ON CONFLICT (user_id, course_id) DO NOTHING;
INSERT INTO academy_enrollments (user_id, course_id, cohort, status, enrolled_by, notes) SELECT user_id, 4, '第一期', 'active', NULL, NULL FROM users WHERE user_id = '2f2cfeec' ON CONFLICT (user_id, course_id) DO NOTHING;
INSERT INTO academy_enrollments (user_id, course_id, cohort, status, enrolled_by, notes) SELECT user_id, 4, '第一期', 'active', NULL, NULL FROM users WHERE user_id = '5258fefc' ON CONFLICT (user_id, course_id) DO NOTHING;
INSERT INTO academy_enrollments (user_id, course_id, cohort, status, enrolled_by, notes) SELECT user_id, 4, '第一期', 'active', NULL, NULL FROM users WHERE user_id = '44b2292b' ON CONFLICT (user_id, course_id) DO NOTHING;
