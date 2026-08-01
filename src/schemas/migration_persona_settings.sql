-- Persona-level feature settings, first entry: the Viva dynamic mid-conversation
-- questionnaire feature (ask_questions action, shipped 2026-08-01), which previously had
-- zero admin control — hardcoded to always-on for Viva with a hardcoded 24h cooldown.
-- Scoped by persona_type (not per-channel) because the feature is already a persona-level
-- concept in code (gated by which persona's prompt templates are loaded), not channel-level.
-- Managed from the admin panel's "AI Persona" tab.

CREATE TABLE IF NOT EXISTS persona_settings (
    persona_type TEXT PRIMARY KEY,
    dynamic_questionnaires_enabled BOOLEAN NOT NULL DEFAULT true,
    dynamic_questionnaire_cooldown_hours INTEGER NOT NULL DEFAULT 24,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by TEXT
);

INSERT INTO persona_settings (persona_type) VALUES ('nano'), ('viva')
ON CONFLICT (persona_type) DO NOTHING;
