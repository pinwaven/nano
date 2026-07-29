-- Dedupe guard for the chat.generate EventBridge event (Viva agentic-loop chat turns
-- moved off the synchronous HTTP path 2026-07-28). EventBridge is at-least-once delivery
-- and chat generation has real side effects (chat_messages insert, weight recording,
-- reminder creation), so a redelivered event must be detectable and skipped.
CREATE TABLE IF NOT EXISTS chat_generate_events (
    event_id   TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
