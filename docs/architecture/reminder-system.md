# Reminder System

Reminders are scheduled messages delivered to the user's chat tab. They come from two sources — the user asking Nano AI, or a coach setting one directly.

---

## Data Model

```sql
reminders (
    id            BIGSERIAL PRIMARY KEY,
    user_id       TEXT REFERENCES users(user_id),
    coach_id      INTEGER REFERENCES coaches(id),  -- NULL = AI/user-generated
    content       TEXT,
    scheduled_for TIMESTAMPTZ,
    recurrence    TEXT  -- NULL | 'daily' | 'weekly'
    status        TEXT  -- 'pending' | 'sent' | 'cancelled'
)
```

`coach_id IS NULL` → reminder was created by the user through Nano AI chat.  
`coach_id IS NOT NULL` → reminder was assigned by a coach via the coach panel.

---

## Creation

### User-generated (via Nano AI chat)

1. User says something like "remind me to drink water in 30 minutes".
2. `intentClassifier` prompt routes to `set_reminder` intent.
3. Worker calls the `reminder` prompt (`prompts/chat/reminder.js`), which instructs the LLM to reply with a JSON action block:
   ```json
   {"action":"set_reminder","content":"喝水","scheduled_for":"2026-05-04T14:30:00+08:00"}
   ```
4. Worker parses the action from `rawReply` (regex match) and calls `handlePostReminder` — inserts the row with `coach_id = NULL`.
5. The JSON block is stripped from the reply before it's shown to the user.

### Coach-assigned

1. Coach opens the coach panel → user profile → sets content, date/time, and optional recurrence.
2. Coach panel calls `POST /api/reminders` with `{ user_id, coach_id, content, scheduled_for, recurrence }`.
3. Worker `handlePostReminder` inserts the row with `coach_id` set.

---

## Delivery

The **dispatcher** (Aliyun FC cron, runs every minute) handles delivery in two separate scans.

### Scan 2 — AI-mediated delivery (user-generated reminders, active users only)

```sql
SELECT r.user_id, r.content, r.id, r.recurrence
FROM reminders r
JOIN users u ON u.user_id = r.user_id
WHERE r.scheduled_for <= NOW()
  AND r.status = 'pending'
  AND r.coach_id IS NULL                          -- user-generated only
  AND u.last_active_at > NOW() - INTERVAL '2 minutes'
```

- Dispatches each result to the **agent** with `trigger_reason: 'reminder'` and `reminder_content`.
- The agent weaves the reminder into a natural, caring message and inserts it as a `chat_messages` row + a `notifications` row (`type: 'coach_message'`).
- Immediately advances `scheduled_for` (recurring) or marks `status = 'sent'` (one-time) so the Flush doesn't double-deliver.

### Flush — Direct delivery (all reminders, all users)

```sql
SELECT id, user_id, content, recurrence FROM reminders
WHERE scheduled_for <= NOW() AND status = 'pending'
```

- Runs for every user regardless of online status.
- Inserts a `notifications` row (`type: 'coach_reminder', status: 'pending'`) directly — no AI involved.
- Advances `scheduled_for` (recurring) or marks `status = 'sent'` (one-time).
- Coach-assigned reminders always reach this path because Scan 2 filters them out.
- User-generated reminders also reach this path if the user was offline during Scan 2 (their reminder was not consumed by Scan 2).

> **Important:** Scan 2 must mark reminders before the Flush runs (the dispatcher executes them sequentially). If Scan 2 marks a reminder `sent`, the Flush won't double-deliver it.

---

## Display

The miniapp polls `GET /api/notifications?openid={user_id}` every 3 seconds (`_poll` in `main.js`). Any unseen `pending` notifications are appended to the chat as `role: 'ai'` messages and marked `sent` server-side.

The user also sees upcoming reminders in the **Plans tab** (`upcomingReminders` state), populated by `GET /api/reminders?openid={user_id}`, which returns all `pending` reminders with `scheduled_for >= NOW() - 1 hour`.

---

## Delivery Path Summary

| Reminder type | User active? | Path | Delivery mechanism |
|---|---|---|---|
| User-generated | Yes | Scan 2 → Agent | LLM-crafted chat message |
| User-generated | No | Flush | Direct notification |
| Coach-assigned | Yes | Flush | Direct notification |
| Coach-assigned | No | Flush | Direct notification |

Coach-assigned reminders always go through the Flush. This guarantees reliable delivery regardless of whether the user is online, and avoids routing a coach-authored reminder through the AI agent.

---

## Recurrence

| Value | Dispatcher action after delivery |
|---|---|
| `NULL` | `SET status = 'sent'` |
| `'daily'` | `SET scheduled_for = scheduled_for + INTERVAL '1 day'` |
| `'weekly'` | `SET scheduled_for = scheduled_for + INTERVAL '7 days'` |

Recurring reminders are never marked `sent` — they stay `pending` with a rolling `scheduled_for`.

---

## API Reference

| Method | Path | Handler | Auth |
|---|---|---|---|
| `POST` | `/api/reminders` | `handlePostReminder` | Bearer token |
| `GET` | `/api/reminders?openid=` | `handleGetReminders` | Bearer token |

**POST body:**
```json
{
  "user_id": "37c8774e",
  "coach_id": 5,
  "content": "喝水",
  "scheduled_for": "2026-05-04T15:00:00+08:00",
  "recurrence": "daily"
}
```
`coach_id` and `recurrence` are optional.

---

## Files

| File | Role |
|---|---|
| `src/schemas/migration_add_reminders.sql` | Table definition and indexes |
| `src/functions/worker/index.js` → `handlePostReminder`, `handleGetReminders` | API handlers |
| `src/functions/worker/prompts/chat/reminder.js` | LLM prompt for user-initiated reminder creation |
| `src/functions/worker/prompts/chat/intentClassifier.js` | Routes `set_reminder` intent |
| `src/functions/dispatcher/index.js` | Scan 2 (AI delivery) + Flush (direct delivery) |
| `src/functions/agent/prompts/proactive.js` | Agent prompt — handles `trigger_reason: 'reminder'` |
| `src/mini/nano-miniapp/pages/main/main.js` → `_loadReminders`, `_poll` | Miniapp fetch + notification polling |
| `src/mini/nano-miniapp/pages/coach/coach.js` → `submitReminder` | Coach panel reminder creation |
