-- Prevents duplicate Viva daily check-in messages: the dispatcher's per-tick
-- "already sent today" NOT EXISTS check only looks at the *final* notifications
-- row, which checkin.js previously only wrote after a multi-second LLM call —
-- leaving a window where multiple dispatcher ticks for the same user/period/day
-- all pass the check and each do the full LLM call + insert their own message.
-- checkin_date lets checkin.js atomically CLAIM a (user, notification_type, day)
-- slot via INSERT ... ON CONFLICT DO NOTHING *before* doing any slow work, so
-- only the first invocation to win the insert proceeds.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS checkin_date DATE;

-- Partial index: only checkin.js ever sets checkin_date, so every other
-- notification_type keeps inserting with it NULL (NULLs never conflict in a
-- unique index) and is unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_checkin_dedup
    ON notifications (user_id, notification_type, checkin_date)
    WHERE checkin_date IS NOT NULL;
