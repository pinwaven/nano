-- Add persona_type to chat_messages so history is scoped per persona.
-- Existing rows default to 'nano' to preserve current Nano conversation history.
ALTER TABLE chat_messages
    ADD COLUMN IF NOT EXISTS persona_type TEXT NOT NULL DEFAULT 'nano';

CREATE INDEX IF NOT EXISTS idx_chat_messages_user_persona
    ON chat_messages (user_id, persona_type, created_at DESC);
