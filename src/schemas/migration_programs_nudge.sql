-- 打卡 programs: the open-day nudge (CLAUDE.md §42). A client who never finishes Day N used to
-- see nothing new, ever — an open day blocks the next offer by design. The dispatcher now sends
-- one "Day N 还没完成" reminder per Shanghai calendar day while a day stays open, capped so a
-- client who has quietly dropped out is not nagged forever. nudge_count is that cap's counter;
-- the per-day claim is the notifications.checkin_date index with notification_type =
-- 'program_day_nudge', exactly like the day card itself.
--
-- @requires: migration_programs.sql

ALTER TABLE program_day_progress ADD COLUMN IF NOT EXISTS nudge_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE program_day_progress ADD COLUMN IF NOT EXISTS last_nudged_on DATE;
