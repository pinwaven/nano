# Chat Prompt Chain

How a user message travels from the user-app to the AI and back.

## Overview

```
User types message
       │
       ▼
user-app  POST /api/chat  { openid, message }
       │
       ▼
nano-worker  handlePostChat()
  ┌──────────────────────────────────────────┐
  │ 1. Resolve user record                   │
  │ 2. Fetch context (3 parallel DB queries) │
  │ 3. Build system prompt                   │
  │ 4. Call LLM (Qwen via DashScope)         │
  │ 5. Persist reply                         │
  └──────────────────────────────────────────┘
       │
       ▼
PostgreSQL  notifications (status = 'pending')
       │
       ▼
user-app  GET /api/notifications  (polls every 3 s)
       │
       ▼
Chat bubble rendered  →  notification marked 'sent'
```

---

## Step-by-step

### 1. Frontend sends the message
**File:** `src/web/user-app/src/App.jsx` — `handleSend()`

```js
POST /api/chat
{ openid: user.user_id, message: "user's text" }
```

The normal chat input is only active when `obStep === 'done'` (onboarding complete).

---

### 2. Worker routes to the chat branch
**File:** `src/functions/worker/index.js` — `handlePostChat()`

The handler checks the request body in order:

| Condition | Branch |
|---|---|
| `test_data` present AND `test_type === 'kino_chip'` | Biomarker estimation + report generation |
| `test_data` present, other `test_type` | Raw record save only (e.g. `body_composition`) |
| `message` present | **Chat branch** ← this path |

---

### 3. Context assembly (parallel DB queries)
Three queries run simultaneously via `Promise.all`:

| Query | Table | Purpose |
|---|---|---|
| Latest biomarker record | `biomarkers` | Actual measured values + full bio age profile |
| Dots formulary | `dots` | All D01–D18 names, descriptions, isolate/blend flag |
| Latest nutrition plan | `notifications` | The user's current 7-day dot schedule text |

The user record (name, age, gender, language) was already resolved in the preceding lookup step.

---

### 4. System prompt construction
**File:** `src/functions/worker/prompts/systemChat.js`

The prompt is assembled from sections:

```
USER PROFILE
  name, age, gender, language preference

HEALTH DATA
  LATEST BIOMARKER RESULTS
    hsCRP, GDF-15, IL-6, GA, CystatinC, CD38 (or "no data yet")

  BIOLOGICAL AGE PROFILE
    BioAge, ChronoAge, Δ
    Resilience Age    (hsCRP + IL-6)
    Cellular Age      (GDF-15 + CD38)
    Metabolic Age     (Glycated Albumin)
    Micro-Vascular Age (Cystatin C)

WAVEN DOTS & NUTRITION PLAN
  WAVEN DOTS FORMULARY
    D01–D18: key, name, description, Isolate/Blend

  USER'S CURRENT NUTRITION PLAN
    raw plan text, e.g.:
    "4月20日星期一: 早上 D01x5 D03x5 D05x5 晚上 D07x5 D09x5 D13x5"

YOUR ROLE & PERSONALITY
  Nano's persona, tone, knowledge domains

RESPONSE GUIDELINES
  personalise, be substantive, format well, language rule

USER MESSAGE
  <the actual message>
```

---

### 5. LLM call
The system prompt is combined with the last 20 turns of conversation history fetched from `chat_messages`:

```js
messages: [
  { role: 'system',    content: <full context prompt> },
  { role: 'user',      content: '...' },   // history, oldest first
  { role: 'assistant', content: '...' },
  ...                                       // up to CHAT_HISTORY_LIMIT (default 20)
]
```

Model: configured via `MODEL` env var (default `qwen-turbo`), called through the DashScope-compatible OpenAI client.

The incoming user message is saved to `chat_messages` **before** the LLM call so it appears in history for future turns.

---

### 6. Response persistence
After the LLM replies:

1. Assistant reply saved to `chat_messages` (role = `assistant`) — becomes part of history on the next turn.
2. Same reply inserted into `notifications` with `notification_type = 'chat_reply'` and `status = 'pending'`.

---

### 7. Frontend delivery
**File:** `src/web/user-app/src/App.jsx` — notification polling `useEffect`

- Polls `GET /api/notifications?openid=...` every **3 seconds**, but only when `obStep === 'done'`.
- Any unseen notifications (tracked by id in `seenIds`) are appended to the chat message list.
- The `GET /api/notifications` handler marks all returned rows as `status = 'sent'` in the same request.

---

## Prompt files

| File | Used when |
|---|---|
| `prompts/systemChat.js` | Every user chat message |
| `prompts/systemReport.js` | Biological age report (delivered via `biological_report` notification after a Kino test) |
| `prompts/systemNutrition.js` | 7-day nutrition plan generation after a Kino test |

---

## Trigger restrictions

- **Biomarker estimation, bio age calculation, biological report, and nutrition plan** are only triggered when `test_type === 'kino_chip'`.
- Other `test_data` submissions (e.g. `body_composition`) save a raw record without triggering any LLM calls or notifications.
- Chat replies are only triggered by a `message` field — never by test data submission.
