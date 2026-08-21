-- Makes the chat.generate dedupe guard (migration_chat_generate_events.sql) retry-safe.
--
-- Previously the event_id row was inserted (ON CONFLICT DO NOTHING) the instant an attempt
-- started, before any of the slow PLAN->GENERATE->JUDGE->REVISE work ran. If Aliyun FC
-- hard-killed the invocation (a platform-level timeout/OOM, not a catchable JS exception)
-- before it finished, the row was left behind forever with nothing ever delivered to the
-- user, and the automatic EventBridge/FC retry that followed was silently swallowed as a
-- "duplicate" — found via a live incident 2026-08-21 (a biomarker_question turn hit the
-- worker's 300s FC timeout mid-REVISE; the retry 12s later was dropped, and the user never
-- got a reply, only the client's own 3-minute "still working" fallback text).
--
-- status + claimed_at let a stale claim (never marked 'done') be re-claimed by that retry.
-- Existing rows default to 'done' — they were inserted synchronously under the old
-- ON-CONFLICT-DO-NOTHING scheme, so there's no reliable signal for whether they finished;
-- defaulting to 'done' preserves the old behavior for them (never retried) rather than
-- risking a flood of stale re-claims across old data.
ALTER TABLE chat_generate_events ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'done';
ALTER TABLE chat_generate_events ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
