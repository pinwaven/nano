-- Multi-day check-in programs (打卡计划) — CLAUDE.md §42.
--
-- A program is a per-day curriculum: Day N has its own lesson (an Academy video) and its own
-- 打卡 (a questionnaire), and the user works through the days sequentially, at most one per
-- Shanghai calendar day, entirely inside the chat tab. This is deliberately NOT built on
-- health_plans: that is a week-scale *focus* with the same three fixed tasks every day and only
-- two active slots per user — the wrong shape for "day 1 do X, day 2 do Y".
--
-- Nothing here invents a lesson or a form mechanism. Lessons are academy_lessons rows (already
-- open to every user, with POST /academy/progress as the idempotent "watched" write), and the
-- 打卡 answers land in the existing questionnaire_* tables through the chat tab's one-question-
-- at-a-time renderer. The two CHECK widenings at the bottom are the only touches to those.
--
-- ORDERING: this file sorts alphabetically BEFORE migration_questionnaire_system.sql and
-- migration_viva_ag_questionnaire.sql, both of which (re)define questionnaires_type_check.
-- Without the declarations below, a fresh database would apply this file first and then have
-- its 'program_day' value silently dropped by the later re-add. tests/migration-ordering.test.js
-- pins the mechanism.
--
-- @requires: migration_questionnaire_system.sql, migration_questionnaire_dynamic_type.sql, migration_viva_ag_questionnaire.sql
-- @requires: migration_academy_lessons.sql, migration_checkin_dedup.sql

CREATE TABLE IF NOT EXISTS programs (
    id              SERIAL PRIMARY KEY,
    key_name        TEXT NOT NULL UNIQUE,
    title_zh        TEXT NOT NULL,
    title_en        TEXT,
    description_zh  TEXT,
    description_en  TEXT,
    duration_days   INTEGER NOT NULL CHECK (duration_days BETWEEN 1 AND 365),
    status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Which channels auto-enroll into a program. A join table rather than INT[] so the dispatcher
-- scan can JOIN it on users.channel_id and so a deleted channel cannot leave a dangling id.
-- v1 is an exact channel match — no sub-channel inheritance.
CREATE TABLE IF NOT EXISTS program_channels (
    program_id      INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    channel_id      INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    PRIMARY KEY (program_id, channel_id)
);
CREATE INDEX IF NOT EXISTS idx_program_channels_channel ON program_channels (channel_id);

-- One row per day of the curriculum. lesson_id and questionnaire_id are both optional: a day
-- with neither is a pure "read the intro" day and completes on tap. summary_template_* is the
-- unified 打卡 recap ("Day 1完成 …") with {{question_key}} / {{question_key.slider_key}}
-- placeholders resolved from that day's questionnaire_responses.
CREATE TABLE IF NOT EXISTS program_days (
    id                  SERIAL PRIMARY KEY,
    program_id          INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    day_index           INTEGER NOT NULL CHECK (day_index >= 1),
    title_zh            TEXT NOT NULL,
    title_en            TEXT,
    intro_md_zh         TEXT,
    intro_md_en         TEXT,
    lesson_id           INTEGER REFERENCES academy_lessons(id) ON DELETE SET NULL,
    questionnaire_id    INTEGER REFERENCES questionnaires(id) ON DELETE SET NULL,
    summary_template_zh TEXT,
    summary_template_en TEXT,
    checkin_label_zh    TEXT NOT NULL DEFAULT '开始打卡',
    checkin_label_en    TEXT NOT NULL DEFAULT 'Start check-in',
    UNIQUE (program_id, day_index)
);

-- A user's membership. Created by the worker on the first program.day event (auto-enroll),
-- never by the user. current_day is the next day to OFFER, so it is what makes progression
-- sequential: a missed calendar day pauses the program instead of skipping content.
CREATE TABLE IF NOT EXISTS program_enrollments (
    id              SERIAL PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    program_id      INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'paused')),
    started_on      DATE NOT NULL,
    current_day     INTEGER NOT NULL DEFAULT 1,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, program_id)
);
CREATE INDEX IF NOT EXISTS idx_program_enrollments_program_status ON program_enrollments (program_id, status);

-- One row per offered day. completed_at is set only when BOTH halves are done (or the day has
-- no lesson): checkin_completed_at from the questionnaire completion, lesson_completed_at from
-- POST /academy/progress. An open row (completed_at IS NULL) is what blocks the next offer.
CREATE TABLE IF NOT EXISTS program_day_progress (
    id                          SERIAL PRIMARY KEY,
    enrollment_id               INTEGER NOT NULL REFERENCES program_enrollments(id) ON DELETE CASCADE,
    day_index                   INTEGER NOT NULL,
    offered_on                  DATE NOT NULL,
    notification_id             INTEGER,
    lesson_completed_at         TIMESTAMPTZ,
    questionnaire_assignment_id INTEGER REFERENCES questionnaire_assignments(id) ON DELETE SET NULL,
    checkin_completed_at        TIMESTAMPTZ,
    completed_at                TIMESTAMPTZ,
    summary                     TEXT,
    UNIQUE (enrollment_id, day_index)
);
CREATE INDEX IF NOT EXISTS idx_program_day_progress_open
    ON program_day_progress (enrollment_id) WHERE completed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_program_day_progress_assignment
    ON program_day_progress (questionnaire_assignment_id);

-- A program day's 打卡 is a questionnaire of its own type, so handlePostQuestionnaireResponse's
-- completion branch can tell it apart from onboarding/custom/dynamic/viva_ag, and so the admin
-- assign flow can keep it out of the coach-assignable set (a hand-assigned one would complete
-- with no program_day_progress row to land on).
ALTER TABLE questionnaires DROP CONSTRAINT IF EXISTS questionnaires_type_check;
ALTER TABLE questionnaires ADD CONSTRAINT questionnaires_type_check
    CHECK (type IN ('onboarding', 'custom', 'dynamic', 'viva_ag', 'program_day'));

-- time_picker: a bare "HH:mm" answer via <picker mode="time">. config {default?, start?, end?}.
-- Needed for 用餐时间 / 步行时间 — date_picker is calendar-only and there was no time widget.
ALTER TABLE questionnaire_questions DROP CONSTRAINT IF EXISTS questionnaire_questions_input_type_check;
ALTER TABLE questionnaire_questions ADD CONSTRAINT questionnaire_questions_input_type_check
    CHECK (input_type IN ('text', 'button_select', 'date_picker', 'slider_group', 'multi_select', 'time_picker'));
