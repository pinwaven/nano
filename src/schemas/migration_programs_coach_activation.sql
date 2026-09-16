-- 打卡 programs are activated by a COACH for a client they manage — never auto-enrolled by
-- channel (CLAUDE.md §42). Records which coach switched the program on; program_channels stays
-- as the "which programs a coach in this channel tree may offer" scope, no longer an enrollment
-- trigger.
--
-- @requires: migration_programs.sql

ALTER TABLE program_enrollments
    ADD COLUMN IF NOT EXISTS activated_by_coach_id INTEGER REFERENCES coaches(id) ON DELETE SET NULL;
