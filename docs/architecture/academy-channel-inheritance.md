# Academy channel opt-out

Channel admins see **Include parent-channel courses / 包含上级渠道课程** in the web admin Academy tab. The default is on. `GET/PUT /api/academy/channel-settings` reads/writes only the authenticated channel; PUT requires `academy:write` and a boolean `inherit_courses`.

`channels.config.academy_inherit_courses` is local, not inherited. Off hides all externally owned/shared courses, while channel-owned courses remain available. On preserves the existing shared catalog behavior; this change does not introduce ancestor-only distribution. Existing courses are attributed to Aeviva by the migration. New channel-admin courses belong to that admin's channel; superadmin-created courses remain shared.

`academy_course_visible` retains access for explicit per-course enrollments, without deleting progress or certificates. Filtered learning paths are hidden as a whole if they contain an unavailable course. The worker uses the same policy for course lists, direct lessons, progress, quizzes and course/lesson OSS download signing. Library documents remain separate from courses and are unchanged. Both web and miniapp consume the filtered APIs; no miniapp build is needed.

Migration: `migration_academy_channel_inheritance.sql`. Tests: `tests/academy-channel-inheritance.test.js`. Dev SQL verification exercised default-on, off, and own-course retention in a rolled-back transaction. No channel preference is automatically changed. The worker and admin UI are deployed to dev and production; SuperiorMed explicitly stores `academy_inherit_courses: false` in both environments.

Course visibility reads the authenticated survivor account's current `users.channel_id`. Duplicate-account merges therefore preserve a descendant channel assignment and union both accounts' roles (`migration_user_merge_preserve_access_context.sql`); otherwise an older parent-channel account could incorrectly regain the shared Academy catalog after absorbing a SuperiorMed account.

Production deployed 2026-09-23; SuperiorMed inheritance disabled and its channel catalog verified empty. All 1,065 tests passed. During deployment the CLI ignored the attempted `--type code` restriction and reset worker configuration; the complete configuration was restored from `s-prod.yaml` before final endpoint verification. Do not use that flag for code-only deployment.
