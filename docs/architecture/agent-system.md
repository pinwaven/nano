# Agent System (Proactive Coaching)

The agent system adds a **proactive** dimension to Nano's otherwise reactive chat. When a user is online, the dispatcher wakes a dedicated `nano-agent` function that analyses the user's health data and initiates a coaching conversation — like a coach who greets you when you walk in.

The existing worker handles everything reactive (user sends a message → worker responds). The agent handles the initiating step only; the worker takes over once the user replies.

---

## End-to-End Flow

```
Mini Program (onShow)
        │  POST /api/heartbeat  { user_id }
        ▼
nano-worker — UPDATE users SET last_active_at = NOW()

nano-dispatcher (cron, every minute)
        │
        │  Scan 1 — user_online (conversation-aware):
        │    SELECT users WHERE last_active_at > NOW()-2min
        │      AND last chat message is NOT from 'assistant'
        │
        │  Scan 2 — event-driven (bypass conversation check):
        │    Reminders due AND user is online
        │
        │  For each match → publish CloudEvent  type=agent.coaching_session
        ▼
Aliyun EventBridge  (filter: type = "agent.coaching_session")
        ▼
nano-agent
        │  1. Load user context (profile, biomarkers, BioAge, nutrition, chat history)
        │  2. Build proactive coaching prompt
        │  3. Call Qwen LLM → generate message
        │  4. INSERT chat_messages (role='assistant')
        │  5. INSERT notifications (type='coach_message', status='pending')
        │  6. UPDATE users SET last_coached_at = NOW()
        ▼
Mini Program polling (every 3s) — GET /api/notifications
        │  Receives coach message → displays in chat UI
        ▼
User replies → POST /chat → nano-worker handles it
```

---

## Components

### 1. Heartbeat (`nano-worker`)

**Endpoint:** `POST /api/heartbeat`  
**Handler:** `handlePostHeartbeat()` in `src/functions/worker/index.js`  
**Called from:** Mini Program `onShow()` in `src/mini/nano-miniapp/pages/main/main.js`

Updates `users.last_active_at = NOW()` so the dispatcher can detect live presence. The call is fire-and-forget (`.catch(() => {})`), so any failure is silently ignored and never shown to the user.

---

### 2. Dispatcher scans (`nano-dispatcher`)

Two independent scans run on every cron tick (`src/functions/dispatcher/index.js`):

#### Scan 1 — `user_online` (conversation-aware)

```sql
SELECT user_id FROM users
WHERE last_active_at > NOW() - INTERVAL '2 minutes'
  AND 'user' = ANY(roles)
  AND COALESCE(
    (SELECT role FROM chat_messages
     WHERE user_id = users.user_id
     ORDER BY created_at DESC LIMIT 1),
    'user'
  ) != 'assistant'
```

The `COALESCE(...) != 'assistant'` check ensures the agent only fires after the user has replied to the previous agent message (or when there is no conversation yet). This prevents the agent from interrupting an ongoing exchange.

#### Scan 2 — `reminder` (event-driven, no conversation check)

```sql
SELECT r.user_id, r.content FROM reminders r
JOIN users u ON u.user_id = r.user_id
WHERE r.scheduled_for <= NOW()
  AND r.status = 'pending'
  AND u.last_active_at > NOW() - INTERVAL '2 minutes'
```

Event-driven triggers bypass the conversation check because they carry time-sensitive information. The `reminder_content` is passed through to the agent prompt.

#### Trigger reasons

| `trigger_reason` | Conversation check | Source |
|---|---|---|
| `user_online` | Yes | Scan 1 |
| `reminder` | No | Scan 2 |
| `new_scan` | No | Future: post-Kino scan hook |
| `nutrition_gap` | No | Future: separate dispatcher scan |
| `weekly_review` | No | Future: scheduled cron |

---

### 3. Agent function (`nano-agent`)

**Code:** `src/functions/agent/index.js`  
**Triggers:** EventBridge (`type=agent.coaching_session`) + HTTP (for testing)

#### User context loaded per session

| Data | Source |
|---|---|
| Profile (name, age, language) | `users` |
| Latest BioAge + sub-ages | `biomarkers.data` |
| Recent biomarker values | `biomarkers.data` |
| Nutrition coverage (next 3 days) | `nutrition_schedules` |
| Last 10 chat messages | `chat_messages` |

#### Dry-run mode

Pass `dry_run: true` in the HTTP body to generate and print the message without writing anything to the DB. Used for local testing.

```
node tests/agent-test.js <user_id> user_online --dry-run
```

---

### 4. Proactive coaching prompt

**File:** `src/functions/agent/prompts/proactive.js`

The prompt instructs the LLM to:
- Open with a natural greeting grounded in one specific data point (BioAge, a biomarker, nutrition gap)
- For `reminder` triggers: deliver the reminder warmly rather than quoting it verbatim
- Keep the message to 2–4 sentences with no markdown
- End with a single open question
- Respond in the user's language (`zh` / `en`)

---

## Database Changes

**Migration:** `src/schemas/migration_coach_agent.sql`

```sql
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS last_active_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_coached_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_last_active ON users (last_active_at DESC);
```

`last_coached_at` is written on every agent send (for audit/analytics) but is not used as a gating condition — the conversation-aware check in the dispatcher replaces the old time-based cooldown.

---

## Deployment

The agent is a separate FC function defined in `s.yaml` under the `agent` resource key:

```
source .env && s agent deploy -y
```

After deploying the dispatcher or worker with changes, run the respective deploy command:

```
npm run deploy:dispatcher
npm run deploy:worker
```

---

## Conversation handoff

The agent **only initiates**. Once the user replies, all subsequent messages are handled by the worker's intent classification system (`src/functions/worker/prompts/chat/`). The worker loads `chat_messages` history on every request, so it has full context of the agent's opening message and can continue naturally.

```
Agent   →  opening message (written to chat_messages, role='assistant')
Worker  ←→  all further turns (reads history, responds to user intent)
```

---

## Testing

```bash
# Full run (writes to DB, sets last_coached_at)
node tests/agent-test.js <user_id>

# Dry run (generates message, no DB writes)
node tests/agent-test.js <user_id> user_online --dry-run

# Specific trigger
node tests/agent-test.js <user_id> reminder --dry-run
```

If a test run sets `last_coached_at` and the agent stops firing in the app, reset it:

```sql
UPDATE users SET last_coached_at = NULL WHERE user_id = '<user_id>';
```
