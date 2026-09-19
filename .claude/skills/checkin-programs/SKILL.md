---
name: checkin-programs
description: Check-in programs (打卡计划) rules — per-day curricula in the chat tab, one day per Shanghai calendar day, Academy lesson + questionnaire. Load when touching program/check-in handlers or the Academy lesson flow.
---

Moved verbatim from `CLAUDE.md` on 2026-09-19 (section numbers kept; `§N` references point at `CLAUDE.md`).

## 42. Check-in Programs (打卡计划) — Multi-day Curricula in the Chat Tab — Rules

A program is a per-day curriculum (Day N = an Academy lesson + a 打卡 questionnaire), worked
through sequentially, at most one day per Shanghai calendar day, entirely in the chat tab. Record:
[docs/architecture/programs.md](docs/architecture/programs.md).

- **A coach activates a program for a client they manage — no auto-enrollment.**
  `POST /programs/enroll {coach_id, openid, program_id}` (coach app → client → 方案 → 打卡计划)
  is the only thing that creates `program_enrollments`, stamped `activated_by_coach_id`, gated by
  the same `users.coach_id` ownership check as `handleGetUserFacts`; it delivers Day 1 inline.
  `program_channels` only scopes which coaches may offer a program (bound channel **or any
  sub-channel** via the recursive tree walk; no bindings = every channel). The dispatcher's
  Scan P reads `program_enrollments` only and never creates one.
- **New `program_*` tables, never `health_plans`.** A focus has the same three tasks every day,
  week semantics and two slots; a curriculum has none of those. Everything around it is reused:
  Academy for lessons (`POST /academy/progress` is the "watched" write, hooked by
  `lib/programs.js` `markLessonWatched`), the questionnaire engine for answers, the daily
  check-in's atomic claim for delivery, `:::` cards for the UI.
- **One program-day per Shanghai date**, three predicates in the dispatcher's Scan P and mirrored
  by `isDayOfferable()`: no open day (`completed_at IS NULL` — a missed day pauses, never skips),
  nothing offered or completed today, and the `(user, 'program_day', checkin_date)` notification
  claim. Every "today" is `(NOW() AT TIME ZONE 'Asia/Shanghai')::date` in SQL; DATE columns read
  `::text`; the client gets `today` from `/programs/my` and never computes it.
- **The 打卡 assignment is created lazily, on 开始打卡** (`POST /programs/day/start-checkin`) —
  never at offer time: `handleGetPendingQuestionnaires` has no type filter and the miniapp
  auto-starts every pending assignment on app open. And **no `questionnaire_ready` row** for it —
  the miniapp calls `_checkForPendingQuestionnaire()` itself; a poll-driven second call would
  start the same form twice.
- `:::lesson` / `:::checkin` are **server-written only** (`buildProgramDayCard`). The lesson row
  carries the Academy lesson id and nothing else; the URL is presigned per tap and the done-state
  is runtime (`_attachProgramState` ← `GET /programs/my`), so no signed URL or stale flag ever
  sits in `chat_messages`.
- **An open day is nudged, not skipped.** Scan N sends one `program_day_nudge` per Shanghai
  date (same `checkin_date` claim) while a day offered on an *earlier* date stays open, capped at
  `MAX_NUDGES` per day-row (`program_day_progress.nudge_count`); the coach sees `stalled_days`.
  Deterministic text + a fresh copy of the card — no LLM.
- **`min_watch_seconds` is enforced for the program stamp only.** `<video bindended>` fires after
  a seek, so the card accumulates real playback from `timeupdate` (deltas > 1.5 s are seeks) and
  reports `time_spent_seconds` on pause/end; `POST /academy/progress` GREATEST-merges it and
  `markLessonWatched` (and the offer-time backfill) require it to reach the lesson's threshold.
  The Academy's own binary "completed" row is unchanged.
- Questionnaire Q/A bubbles are saved under the **effective persona** (`resolveEffectivePersona`
  in `handlePostQuestionnaireResponse`) — they used to default to `'nano'` on every channel.
- `program_day`, `program_day_summary`, `program_day_comment`, `program_day_nudge` are
  dual-written and **must stay in `AI_ECHO_TYPES`** (`tests/static-invariants.test.js`). The recap is deterministic
  (`renderSummaryTemplate`, `{{key}}` / `{{key.before}}`, values sanitized); the comment is one
  `qwen-plus` completion, no agentic loop, no JUDGE, and its failure costs only the comment.
- `tryCompleteDay` is the **only** thing that closes a day and advances `current_day` — one
  guarded UPDATE, so the questionnaire completion and the lesson-ended hook cannot both win.
- `migration_programs.sql` **must keep its `@requires`** on the questionnaire migrations — it
  sorts before the files that re-add `questionnaires_type_check`. `program_day` is deliberately
  not in the admin panel's `ASSIGNABLE_TYPES`; a hand-assigned copy completes into nothing.
- `time_picker` is the sixth questionnaire input type (`"HH:mm"`); it is accepted by
  `lib/agQuestionnaire.js` too, so `worker/docs/viva-ag-{api.md,openapi.json}` list it.
