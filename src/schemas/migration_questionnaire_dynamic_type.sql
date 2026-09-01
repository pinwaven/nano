-- Adds a 'dynamic' questionnaire type for Viva mid-conversation-generated questionnaires,
-- distinct from 'onboarding' (system, fixed 5-question intake) and 'custom' (admin/coach-
-- authored via the admin panel or /questionnaires/generate). A separate value lets:
--  1. handlers/chat.js's rate-limit guard (before creating a new one) and completion-detector
--     (before firing the proactive follow-up) cheaply discriminate "did Viva itself spawn
--     this" from coach-assigned/onboarding assignments, without a heuristic on created_by/
--     channel_id (both NULL for onboarding too).
--  2. Admin panel / coach app questionnaire lists to filter/label LLM-generated ones
--     separately for visibility, and a future cleanup policy to target only this type.
-- @requires: migration_questionnaire_system.sql
ALTER TABLE questionnaires DROP CONSTRAINT IF EXISTS questionnaires_type_check;
ALTER TABLE questionnaires ADD CONSTRAINT questionnaires_type_check
    CHECK (type IN ('onboarding', 'custom', 'dynamic'));
