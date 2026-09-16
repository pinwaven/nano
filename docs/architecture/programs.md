# Check-in Programs (打卡计划) — Multi-day Curricula in the Chat Tab

**Status:** shipped 2026-09-16 (dev). CLAUDE.md §42 holds the rules; this is the record.

A **program** is a per-day curriculum: Day N has its own lesson (an Academy video) and its own
打卡 (a questionnaire), and a user works through the days sequentially, at most one per Shanghai
calendar day, entirely inside the chat tab. **A coach switches it on for a client they manage**
(coach app → client → 方案 → 打卡计划); nothing enrolls a user automatically. The first program is
`viva_7day_v1` — 7天生命能力打卡 — whose Day 1 is the user-specified template (十年生命能力 /
Day 1 行动记录 / 最大提醒) and its unified "Day 1完成 …" recap.

## Why not `health_plans`

`health_plans` is a week-scale *focus* (anti-aging, 8 weeks) with the **same three fixed tasks
every day** (dots / weight / three sliders), week-indexed milestones, `duration_weeks`
everywhere, and only two active slots per user (`primary`/`secondary`). "Day 1 do X, day 2 do
Y" is a different shape, and forcing it in would have meant teaching every consumer of that
table about days vs weeks while occupying a focus slot the user may need for anti-aging. So:
new `program_*` tables, and **everything around them reused** —

| Reused as-is | For |
|---|---|
| Academy (`academy_lessons.oss_key`, `academy_coach_progress`, `POST /academy/progress`) — open to every user since `migration_academy_rename_coach_user_id.sql` | the daily lesson video and "watched" |
| Questionnaire engine (`questionnaires` / `_questions` / `_assignments` / `_responses`, the chat tab's one-question-at-a-time renderer, the admin editor) | the 打卡 answers |
| Daily check-in delivery (`handlers/checkin.js`'s atomic `notifications.checkin_date` claim; the dispatcher's first-app-open scan) | "here is Day N" |
| `:::` card directives (`utils/markdown.js`, `main.wxml` segment branches) | the inline lesson player and the 开始打卡 button |

## Tables (`src/schemas/migration_programs.sql`)

| Table | Row |
|---|---|
| `programs` | the curriculum: `key_name`, titles, `duration_days`, `status` (`draft` / `active` / `archived`) |
| `program_channels` | where coaches may offer the program: a bound channel **or any of its sub-channels** (recursive `parent_channel_id` walk); no rows = every channel. Never an enrollment trigger |
| `program_days` | one per `day_index`: titles, `intro_md_*`, `lesson_id → academy_lessons` (nullable), `questionnaire_id → questionnaires` (nullable, must be `type='program_day'`), `summary_template_*`, `checkin_label_*` |
| `program_enrollments` | one per (user, program), created only by a coach: `status` (`active` / `completed` / `paused`), `started_on`, **`current_day`** = the next day to offer, `completed_at`, `activated_by_coach_id` (`migration_programs_coach_activation.sql`); `UNIQUE (user_id, program_id)` |
| `program_day_progress` | one per offered day: `offered_on`, `notification_id`, `lesson_completed_at`, `questionnaire_assignment_id`, `checkin_completed_at`, `completed_at`, `summary`; `UNIQUE (enrollment_id, day_index)` |

Also widened: `questionnaires.type` gains `'program_day'`; `questionnaire_questions.input_type`
gains `'time_picker'` (answer `"HH:mm"`, config `{default?, start?, end?}`). The seed
(`migration_programs_seed_viva7.sql`) creates the program as `draft` with no channel bound.

**Ordering:** `migration_programs.sql` sorts alphabetically *before*
`migration_questionnaire_system.sql` and `migration_viva_ag_questionnaire.sql`, each of which
re-adds `questionnaires_type_check`. Its `-- @requires:` header is what stops a fresh database
from silently losing `'program_day'`; `tests/migration-ordering.test.js` pins it.

## State machine

```
coach app (client → 方案 → 打卡计划 → 激活)              worker
──────────────────────────────────────────              ──────
POST /programs/enroll {coach_id, openid, program_id} ─▶ handlePostProgramEnroll
                                                          users.coach_id ownership check
                                                          program active + available to the client's channel tree
                                                          INSERT program_enrollments (activated_by_coach_id)
                                                          handleProgramDayEvent(...) inline → Day 1 now

dispatcher Scan P (every minute, days 2..N)             worker
───────────────────────────────────────────             ──────
ENROLLED user (status active), active in last 2 min,
  no open day, nothing offered/completed today,         program.day CloudEvent
  no 'program_day' claim today                       ─▶ handleProgramDayEvent
                                                          claim (user,'program_day',today) atomically
                                                          BEGIN
                                                            load enrollment (FOR UPDATE) — none → fail the slot
                                                            re-check isDayOfferable
                                                            load program_days[current_day]
                                                            INSERT program_day_progress (offered_on=today,
                                                              lesson_completed_at ← academy_coach_progress if
                                                              the lesson was already watched)
                                                          COMMIT
                                                          saveChatMessage(card) + notification → 'pending'

miniapp                                                 worker
───────                                                 ──────
card renders (:::lesson + :::checkin)
tap 观看课程 → GET /programs/lesson-url → <video>
  video ends → POST /academy/progress ────────────────▶ markLessonWatched → tryCompleteDay
tap 开始打卡 → POST /programs/day/start-checkin ──────▶ create questionnaire_assignment (lazily)
  _checkForPendingQuestionnaire → one question at a time
  last answer → POST /questionnaire-responses ────────▶ completeProgramDayCheckin:
                                                          render summary_template from answers
                                                          UPDATE … SET checkin_completed_at WHERE IS NULL
                                                          deliver 'program_day_summary'
                                                          one qwen-plus comment → 'program_day_comment'
                                                          tryCompleteDay
tryCompleteDay: completed_at ← NOW() iff checkin done AND (no lesson OR lesson done)
                then current_day += 1; last day → enrollment 'completed'
```

The three rules the scan encodes, each in one predicate:

- **Sequential** — `current_day` lives on the enrollment; the worker always offers *that* day.
- **One program-day per calendar day** — nothing `offered_on` today, nothing completed today, and
  the `(user, 'program_day', checkin_date)` notification claim (reusing
  `migration_checkin_dedup.sql`'s partial unique index).
- **A missed day pauses, never skips** — an open row (`completed_at IS NULL`) blocks any new offer.

Every "today" is `(NOW() AT TIME ZONE 'Asia/Shanghai')::date` **in SQL**; DATE columns are read
`::text`; the miniapp receives `today` from `/programs/my` and never computes it.

## The card

Server-built by `lib/programs.js` `buildProgramDayCard()`; the model never emits these fences.

```
<intro_md, or **Day N · title**>

:::lesson
<academy_lesson_id>|<lesson title>
:::

:::checkin
<program_id>|<day_index>|<button label>
:::
```

The lesson row carries only the id. The miniapp (`handleLessonCardTap`) fetches a fresh 1-hour
presigned URL from `GET /api/programs/lesson-url` on each tap and mounts a native `<video>` in the
bubble — one live player at a time — with `bindended` → `_doMarkComplete` → `POST /academy/progress`.
No OSS key or signed URL ever sits in chat history. Done-state (`done` / `lessonDone` / `active`)
is **runtime** state stamped by `_attachProgramState` from `GET /api/programs/my`, refreshed after
history loads, when a `program_day*` notification lands, after a lesson ends and after the program
questionnaire completes — never on a timer of its own.

## Why the assignment is created lazily

`handleGetPendingQuestionnaires` has no type filter and the miniapp auto-starts **every** pending
assignment on app open (`_initChat`, `onShow`, `_poll`). An assignment created at offer time would
launch the form before the user had seen the card or the lesson. So `POST /programs/day/start-checkin`
creates it on the tap, and the miniapp then calls `_checkForPendingQuestionnaire()` itself — with
deliberately **no** `questionnaire_ready` notification, which would make the poll start the same
form a second time. A user who abandons mid-form sees it resume on the next open, which is right.

## Endpoints

| | | |
|---|---|---|
| `GET` | `/programs/my?openid=` | enrollments + progress rows (dates `::text`) + `today` |
| `GET` | `/programs/lesson-url?openid=&lesson_id=` | presigned URL for a lesson of a program the caller is enrolled in |
| `POST` | `/programs/day/start-checkin` `{openid, program_id, day_index}` | creates/returns the day's assignment; a day with no questionnaire completes on tap |
| coach | `GET /programs/coach?coach_id=&openid=` · `POST /programs/enroll {coach_id, openid, program_id}` · `PUT /programs/enrollment {…, status: paused\|active}` | the client's activatable programs + state; activate (delivers Day 1 inline; resumes a paused one; refuses a completed one); pause/resume. All gated on `users.coach_id` |
| admin (`content` tab) | `GET/POST /programs`, `PUT/DELETE /programs/:id`, `GET /programs/:id/days`, `PUT /programs/:id/days/:dayIndex`, `GET /programs/:id/enrollments` | Content ▸ Programs |

Notification types `program_day`, `program_day_summary`, `program_day_comment` are dual-written
(chat_messages + notifications) and are in the miniapp's `AI_ECHO_TYPES`;
`tests/static-invariants.test.js` enforces it.

## Authoring a program

1. Content ▸ Questionnaires: create a questionnaire of type **program_day** per day that has a
   打卡 (Day 1's is seeded). Answers land in `questionnaire_responses` only — leave `save_target`
   empty. Slider questions whose recap line is a before→after pair use two sliders keyed
   `before` / `after`; a short `config.label_zh` names the dimension in the comment prompt.
2. Content ▸ Programs: open the program's Days, link each day's Academy lesson (course → video)
   and questionnaire, write the intro and the recap template (`{{key}}`, `{{key.before}}`…; the
   editor lists the selected questionnaire's placeholders).
3. Set the program **active**; optionally bind channel(s) to limit which coaches see it (a bound
   channel covers its sub-channels; no bindings = every channel).
4. A coach opens the client in the coach app → 方案 tab → 打卡计划 → **激活**. Day 1 lands in the
   client's chat immediately; each later day arrives on the client's first app-open of that day.
   The coach can 暂停 / 继续 from the same row; the admin roster shows who activated each one.

Deactivate a question rather than deleting it while users are mid-form.

## Known limits (v1)

- The claim key is `(user, 'program_day', date)`, so a user of a channel bound to **two** active
  programs gets at most one program-day per day, whichever tick wins.
- `bindended` does not fire if the user backgrounds mid-play, and does fire after seeking to the
  end; `academy_lessons.min_watch_seconds` is not enforced (nor is it anywhere else). The Academy
  tab remains an alternate path since `markLessonWatched` hooks `POST /academy/progress` regardless
  of origin.
- No "you still have an open day" nudge; a user who never finishes Day 1 simply sees nothing new.
- `handlePostQuestionnaireResponse` saves the question/answer bubbles with the default persona
  `'nano'` (pre-existing); history display is not persona-filtered so they render, but they are
  invisible to a Viva user's LLM history context.
- `academy.js`'s `handleGetAcademyCourseProgressAll` still references `p.coach_user_id`, renamed by
  `migration_academy_rename_coach_user_id.sql` — pre-existing, unrelated, not fixed here.
