# Coach Panel

## Overview

The coach panel is a WeChat Mini Program page (`pages/coach/coach`) that gives coaches a dashboard to manage their assigned clients. It is only accessible to users whose `roles` array includes `coach`, `admin`, or `superadmin`.

## Navigation Model

The user panel (`pages/main/main`) is always the entry point after login. Coaches land on the user panel first, then swipe left to reach the coach panel.

```
[User Panel]  ←→  [Coach Panel]
  (root)              (navigateTo stack)
```

- **Swipe left** on the user panel → coach panel slides in from the right (`navigateTo`, `slide-in-right`)
- **Swipe right** on the coach panel (or tap the header) → user panel slides back in from the left (`navigateBack`, `slide-out-right`)

Because the user panel is the root page, its state (chat history, scroll position) is fully preserved when the coach panel is in view. `onLoad` only fires once per session on the user panel; `onShow` fires on return.

### Why not a redirect on login

Earlier designs used `wx.reLaunch` to land coaches directly on the coach panel. This caused the user panel to reload every time the coach wanted to check their own chat — losing scroll position and triggering a full history fetch. The current model avoids this by keeping the user panel alive in the page stack.

## Page Files

| File | Purpose |
|------|---------|
| `pages/coach/coach.wxml` | Layout: header, tab content, client detail overlay, compose area |
| `pages/coach/coach.wxss` | Styles: dark navy theme matching the user panel |
| `pages/coach/coach.js` | Data, API calls, swipe gesture, 3-way chat |
| `pages/coach/coach.json` | `navigationStyle: "custom"` — hides WeChat's native nav bar |

## Layout

```
┌─────────────────────────┐
│  Status bar spacer      │
│  App header (tap → back)│
├─────────────────────────┤
│                         │
│  Tab content            │  flex: 1, scroll-view
│                         │
├─────────────────────────┤
│  Clients │ Invites      │  Bottom tab bar
│  Earnings│ Forms        │
└─────────────────────────┘
```

A `›` glyph is fixed to the right edge at 50% height (35% opacity) as a subtle hint that swiping right returns to the user panel.

## Tabs

| Tab key | Label (ZH / EN) | What it shows |
|---------|-----------------|---------------|
| `clients` | 我的客户 / My Clients | Cards for each assigned client with bio age, last scan, and a Message button |
| `invites` | 邀请码 / Invite Codes | Generates and manages invite codes for the coach's channel |
| `earnings` | 我的收益 / My Earnings | Monthly earnings summary and payout history |
| `questionnaires` | 问卷 / Forms | Available questionnaires; assign to one or more clients |

## Client Detail Overlay

Tapping a client card opens a full-screen overlay with two sub-tabs:

### Health tab
- Bio age and all four sub-age dimensions (Cellular, Metabolic, Micro-Vascular, Resilience)
- Bio age trend chart
- Raw biomarker values from the latest Kino scan

### Chat tab
Displays the full unified 3-way conversation thread for the selected client — user messages, Nano AI responses, and coach messages — in a single chronological scroll view.

Coaches can compose and send messages directly from this tab. Sent messages are stored in `chat_messages` with `role = 'coach'` and appear in the user's own chatbox in real time (via polling).

## 3-Way Chat Architecture

All chat messages live in a single `chat_messages` table:

| `role` value | Who wrote it |
|--------------|-------------|
| `user` | The client |
| `assistant` / `ai` | Nano AI |
| `coach` | The coach |

**Coach sends a message** → `POST /api/coach-instruction` → inserts into `chat_messages` with `role = 'coach'`.

**User panel polls for coach messages** → `_poll()` in `main.js` calls `GET /api/chat-history?openid=…&since_id=<lastMsgId>` every 3 seconds. The backend returns only `role = 'coach'` rows newer than `since_id`. New rows are appended to the chatbox and the scroll position is updated.

**LLM context** — the AI worker's history builder skips `role = 'coach'` rows when constructing the prompt for the language model, since LLM APIs only accept `user`/`assistant`/`system`/`tool` roles.

```
chat_messages
  role = 'user'       → shown in both user panel and coach chat tab
  role = 'assistant'  → shown in both; fed to LLM as 'assistant'
  role = 'coach'      → shown in both; skipped by LLM history builder
```

## Swipe Gesture

Both pages bind `touchstart`/`touchend` on their root view. A gesture is recognised when:
- `|dx| > 70px`
- `|dx| > 1.5 × |dy|` (horizontal dominance)
- No overlay/modal is open

Overlays that suppress the swipe gesture on the coach panel: `detailOpen`, `reminderOpen`, `qAssignOpen`, `qResponsesOpen`, `menuOpen`.

## API Endpoints Used

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/coach-users?coach_id=…` | Load assigned clients |
| `GET` | `/api/chat-history?openid=…` | Load full chat history for a client |
| `GET` | `/api/chat-history?openid=…&since_id=…` | Poll for new coach messages (user panel) |
| `POST` | `/api/coach-instruction` | Send a message to a client |
| `GET` | `/api/biomarkers?openid=…` | Client biomarker data for Health tab |
| `GET` | `/api/invite-codes?coach_id=…` | Coach's invite codes |
| `POST` | `/api/invite-codes` | Generate a new invite code |
| `GET` | `/api/coach-earnings?coach_id=…` | Earnings summary |
| `GET` | `/api/questionnaires?channel_id=…` | Available questionnaires |
| `POST` | `/api/assign-questionnaire` | Assign a questionnaire to clients |
| `GET` | `/api/questionnaire-responses?…` | View a client's responses |
| `POST` | `/api/reminders` | Schedule a reminder for a client |
