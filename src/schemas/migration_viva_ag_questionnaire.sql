-- Viva AG clarifying questionnaires: lets the external agent park a claimed job, ask the user a
-- short questionnaire, and resume once it is answered.
--
-- Nothing here invents a questionnaire mechanism — the four questionnaire_* tables, the five
-- server-driven input widgets and the chat-tab renderer all already exist, and completed answers
-- already reach the agent through twinBundle.js's layers.personal_profile.questionnaire_context.
-- This migration only adds the job state to park in and the link back to the assignment.

-- A questionnaire the external AG agent pushed back mid-job. A distinct type (rather than reusing
-- 'dynamic') is what lets handlePostQuestionnaireResponse's completion block tell "resume an AG
-- job" apart from "fire Viva's own follow-up turn", and lets the admin/coach questionnaire lists
-- label or filter agent-authored forms — the same reasoning migration_questionnaire_dynamic_type
-- .sql gives for adding 'dynamic'.
ALTER TABLE questionnaires DROP CONSTRAINT IF EXISTS questionnaires_type_check;
ALTER TABLE questionnaires ADD CONSTRAINT questionnaires_type_check
    CHECK (type IN ('onboarding', 'custom', 'dynamic', 'viva_ag'));

-- One element per round asked, in order. Mirrors the existing document_ids snapshot convention on
-- this table, and its length IS the round counter — no separate column to keep in step.
ALTER TABLE viva_ag_jobs ADD COLUMN IF NOT EXISTS questionnaire_assignment_ids INTEGER[];

-- A parked job holds no lease (the user may take days), so claim_expires_at cannot bound it.
-- This is the separate deadline that stops an ignored questionnaire holding the user's one
-- in-flight slot forever.
ALTER TABLE viva_ag_jobs ADD COLUMN IF NOT EXISTS awaiting_input_expires_at TIMESTAMPTZ;

-- 'awaiting_input' MUST count as active. The job still owns the user's one in-flight slot: letting
-- them enqueue a second job while a questionnaire is outstanding would leave two jobs competing
-- for the same answers, and the second would resume off the first one's form.
--
-- Safe to widen — no existing row can already hold the new status, so the unique CREATE cannot
-- fail on current data.
DROP INDEX IF EXISTS uniq_viva_ag_jobs_active;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_viva_ag_jobs_active
    ON viva_ag_jobs (user_id) WHERE status IN ('queued', 'claimed', 'processing', 'awaiting_input');

-- Backs the deadline sweep in _sweepExpiredLeases. Deliberately NOT folded into
-- idx_viva_ag_jobs_lease: that index covers claim_expires_at for leased jobs, and a parked job
-- has no lease at all.
CREATE INDEX IF NOT EXISTS idx_viva_ag_jobs_awaiting
    ON viva_ag_jobs (awaiting_input_expires_at) WHERE status = 'awaiting_input';
