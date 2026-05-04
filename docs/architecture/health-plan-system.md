# Health Plan System

A **Health Plan** is the goal-oriented unit that ties all of Nano's loose pieces together — Kino biomarker scans, daily dot adherence, coaching conversations, and activity guidance — into a single trackable object. A user joins a plan with an explicit goal (e.g. "reduce metabolic age, lose body fat") and an estimated timeframe; from that point every Kino scan and check-in is measured against it.

Plans are the common ground between the user, their coach, and the Nano AI. The AI is plan-aware in every chat turn; coaches can recommend or author plans; users can browse, join, and track their own plans from the miniapp.

---

## Core Concepts

| Concept | Description |
|---|---|
| **Plan Template** | A reusable goal blueprint — name, description, duration, target sub-ages, recommended Dots, activity guidance, milestone schedule, daily tasks config. Global or channel-scoped. |
| **Health Plan** | A user's active enrollment in a template (or a coach-created custom plan). Records start date, baseline bioage snapshot, source, and status. |
| **Daily Task** | One of three per-plan check-in actions (Dots, Weight, Questions). Which tasks are shown and their labels are configured per template in the admin panel. |
| **Check-in** | A daily adherence record for a plan. Idempotent — submitting twice on the same day updates the existing record. Tracks `dots_taken` (boolean) and `activities_done` (JSONB array of completed task keys). |
| **Milestone** | A biomarker scan that is linked to a plan as a progress snapshot, tagged to a specific milestone slot in the template's milestone schedule. |
| **plan_type** | `primary` or `secondary` — a user can hold at most one of each simultaneously. DB-enforced via a unique partial index. |
| **source** | How the user joined: `self` (user browsed and joined), `coach` (coach recommended it), `ai` (Nano AI suggested it). |

---

## User Constraints

- A user may have **at most one active `primary` plan and one active `secondary` plan** at the same time.
- This is enforced at two levels:
  1. **DB** — `UNIQUE (user_id, plan_type) WHERE status = 'active'` partial index on `health_plans`.
  2. **API** — `handlePostJoinHealthPlan` returns `{ error: 'conflict', existing_plan_id }` (HTTP 409) when the slot is occupied, allowing the client to offer a swap dialog.
- Swapping primary ↔ secondary is done in a **single transaction**: the displaced plan's `plan_type` is updated first, then the target plan's type is set, avoiding a momentary unique-index violation.

---

## Database Schema

Migration file: `src/schemas/migration_health_plans.sql`
Daily tasks column: `temp/migration_add_daily_tasks.sql`

### `health_plan_templates`

Library of reusable plan blueprints. Global templates have `channel_id = NULL`; channel-specific templates are scoped to one channel.

| Column | Type | Description |
|---|---|---|
| `id` | SERIAL PK | — |
| `channel_id` | INTEGER FK → `channels.id` | NULL = global template |
| `key_name` | TEXT UNIQUE | Slug (e.g. `weight_loss`, `anti_aging`) |
| `name_zh` / `name_en` | TEXT | Bilingual display name |
| `desc_zh` / `desc_en` | TEXT | Long-form description |
| `goal_zh` / `goal_en` | TEXT | One-sentence goal statement shown to users |
| `duration_weeks` | INTEGER | Estimated plan duration |
| `target_sub_ages` | TEXT[] | Sub-age dimensions this plan targets |
| `recommended_dot_ids` | JSONB | Array of `dots.id` values |
| `activity_guidance` | JSONB | Structured daily/weekly activity suggestions |
| `milestones` | JSONB | Array of `{ week, label_zh, label_en }` |
| `daily_tasks` | JSONB | Array of task config objects (see below) |
| `is_active` | BOOLEAN | Inactive templates hidden from browse sheet |
| `sort_order` | INTEGER | Display order in the browse sheet |
| `created_by` | TEXT FK → `users.user_id` | NULL for system-seeded templates |

#### `daily_tasks` structure

Each element in the `daily_tasks` array configures one check-in task for the plan card:

```json
[
  { "key": "dots",      "label_zh": "服用原粒", "label_en": "Dots",      "enabled": true },
  { "key": "weight",    "label_zh": "记录体重", "label_en": "Weight",    "enabled": true },
  { "key": "questions", "label_zh": "每日问答", "label_en": "Questions", "enabled": false }
]
```

| Field | Description |
|---|---|
| `key` | Fixed identifier: `dots`, `weight`, or `questions` |
| `label_zh` / `label_en` | Customisable label shown on the task chip |
| `enabled` | Whether this task appears on the plan card |

When `daily_tasks` is an empty array (legacy or unset), the miniapp falls back to all three tasks enabled with their default labels.

### `health_plans`

A user's enrollment in a plan. One row per enrollment; completed or abandoned plans are retained as history.

| Column | Type | Description |
|---|---|---|
| `id` | BIGSERIAL PK | — |
| `user_id` | TEXT FK → `users.user_id` | CASCADE delete |
| `template_id` | INTEGER FK → `health_plan_templates.id` | NULL for coach-authored custom plans |
| `coach_id` | INTEGER FK → `coaches.id` | The coach who created or recommended the plan |
| `plan_type` | TEXT | `primary` or `secondary` |
| `status` | TEXT | `active` / `paused` / `completed` / `abandoned` |
| `source` | TEXT | `self` / `coach` / `ai` |
| `custom_name_zh` / `custom_name_en` | TEXT | Used when `template_id` is NULL |
| `custom_goal_zh` / `custom_goal_en` | TEXT | Used when `template_id` is NULL |
| `duration_weeks` | INTEGER | Resolved from template at join time |
| `baseline_data` | JSONB | Bioage profile + raw biomarkers at enrollment |
| `start_date` | DATE | Day of enrollment |
| `target_end_date` | DATE | `start_date + duration_weeks * 7` |
| `ended_at` | TIMESTAMPTZ | Set when status → `completed` or `abandoned` |

**Unique partial index:** `UNIQUE (user_id, plan_type) WHERE status = 'active'`

### `health_plan_checkins`

Daily adherence records. One row per `(plan_id, checkin_date)` — upserted, never duplicated.

| Column | Type | Description |
|---|---|---|
| `id` | BIGSERIAL PK | — |
| `plan_id` | BIGINT FK → `health_plans.id` | CASCADE delete |
| `user_id` | TEXT FK → `users.user_id` | CASCADE delete |
| `checkin_date` | DATE | The day of the check-in (client-supplied) |
| `dots_taken` | BOOLEAN | Whether the user took their dots |
| `activities_done` | JSONB | Array of completed activity key strings (e.g. `["weight_logged", "daily_questions"]`) |
| `notes` | TEXT | Optional free-text note |

**Unique constraint:** `(plan_id, checkin_date)` — upsert uses `ON CONFLICT ... DO UPDATE`.

#### `activities_done` keys

| Key | Set by | Meaning |
|---|---|---|
| `weight_logged` | Weight task | User logged body weight via the weight modal |
| `daily_questions` | Questions task | User completed the daily energy/sleep/mood survey |

### `health_plan_milestones`

Biomarker scans linked to a plan as progress snapshots.

| Column | Type | Description |
|---|---|---|
| `id` | BIGSERIAL PK | — |
| `plan_id` | BIGINT FK → `health_plans.id` | CASCADE delete |
| `user_id` | TEXT FK → `users.user_id` | CASCADE delete |
| `biomarker_id` | INTEGER FK → `biomarkers.id` | SET NULL on biomarker delete |
| `milestone_index` | INTEGER | 0-based slot index matching template array |
| `label_zh` / `label_en` | TEXT | Copied from template at achievement time |
| `snapshot_data` | JSONB | Full `biomarkers.data` at milestone time |
| `achieved_at` | TIMESTAMPTZ | When the milestone was recorded |

---

## Seeded Plan Templates

Six global templates are seeded at migration time. All have `channel_id = NULL` and `daily_tasks = []` (falls back to all three tasks enabled).

| key_name | name_zh | Duration | Target Sub-Ages |
|---|---|---|---|
| `weight_loss` | 代谢减重 | 8 wks | MetabolicAge, MicroVascularAge |
| `anti_aging` | 逆龄还原 | 12 wks | CellularAge, ResilienceAge |
| `energy_boost` | 能量提升 | 6 wks | MicroVascularAge, MetabolicAge |
| `sleep_improvement` | 深度睡眠 | 6 wks | ResilienceAge |
| `immunity` | 免疫防御 | 8 wks | ResilienceAge, CellularAge |
| `metabolic_health` | 代谢健康 | 10 wks | MetabolicAge |

---

## Plan Lifecycle

```
User browses templates (browse sheet)
    │
    ▼
POST /health-plans
    → API checks for conflict in target slot
    → Captures baseline_data from latest kino_chip biomarker
    → Inserts health_plans row (status = 'active')
    │
    ▼
Daily use
    → User taps individual task chips on the plan card (Dots / Weight / Questions)
    → Each tap upserts POST /health-plans/:id/checkin with updated dots_taken + activities_done
    → Kino scans generate health_plan_milestones rows at milestone weeks
    │
    ▼
Plan end
    PUT /health-plans/:id  { status: 'completed' | 'abandoned' }
    → Sets ended_at = NOW()
    → Frees the plan_type slot for a new enrollment
```

### Switching Primary / Secondary

```
PUT /health-plans/:id  { plan_type: 'primary' }
```

The handler opens a transaction:
1. Moves any other active plan in the `'primary'` slot to `'secondary'`
2. Sets the target plan to `'primary'`
3. Commits

---

## AI Integration

Active health plans are **always** included in the chat LLM context. The payload is small (max 2 rows) and plan-aware responses are valuable for every chat turn.

Each row is projected into `llmContext.active_health_plans`:

```js
{
  plan_type:       'primary',
  name:            'Anti-Aging Protocol',
  goal:            'Reduce CellularAge and ResilienceAge',
  target_sub_ages: ['CellularAge', 'ResilienceAge'],
  weeks_elapsed:   3,
  total_weeks:     12,
  checkin_count:   14,
  milestones_done: 0,
}
```

Prompt templates that consume plan context: `prompts/chat/casual.js`, `prompts/chat/biomarker.js`, `prompts/chat/nutrition.js`.

---

## Miniapp — Plans Tab

**Tab order:** Chat → Health → **Plans** → Dots → Store

**Files:** `src/mini/nano-miniapp/pages/main/main.js`, `main.wxml`, `main.wxss`

### Tab data state

```js
plansLoading: true,
activePlans: [],      // up to 2 enriched plan objects
planTemplates: [],    // available templates for browse sheet
planDetailOpen: false,
planDetailData: null,
planSubTab: 'overview',
planBrowseOpen: false,
planCheckinBusy: false,
planTaskBusy: false,
// Weight modal
planWeightOpen: false,
planWeightInput: '',
planWeightPlanId: null,
planWeightKeyboard: 0,   // keyboard height in px, shifts modal above keyboard
// Questions modal
planQuestionsOpen: false,
planQuestionsData: { energy: 3, sleep: 3, mood: 3 },
planQuestionsPlanId: null,
```

Each plan in `activePlans` is enriched with computed display fields:
- `progressPct` — `(weeksElapsed / totalWeeks) * 100`, capped at 100
- `adherencePct` — `(checkin_count / days_since_start) * 100`, capped at 100
- `weeksDone` / `totalWeeks` — week counts
- `checkedInToday` — true when `checked_in_today > 0`
- `todayTasks` — array of `{ key, labelZh, labelEn, done }` derived from template `daily_tasks`; falls back to all three enabled if `daily_tasks` is empty
- `todayDoneCount` — number of tasks completed today
- `todayProgressPct` — `(todayDoneCount / todayTasks.length) * 100`
- `today_dots_taken` — raw boolean for upsert merging
- `today_activities` — raw `activities_done` array for upsert merging

### Plan cards

Each active plan renders a card showing:
- Type badge (Primary / Secondary)
- Plan name
- Progress bar (weeks elapsed)
- Adherence % and week count
- **Daily task chips** — one chip per enabled task; tapping completes or toggles the task
- **Daily progress bar** — fills as tasks are completed; turns green when all done; counter shows `N/total today`

Tapping the card body (not a task chip) opens the **Plan Detail Sheet**.

### Daily task chips

| Task key | Tap action |
|---|---|
| `dots` | Toggles `dots_taken` on today's check-in |
| `weight` | Opens **Weight modal** — user enters weight (kg), app POSTs to `/api/biomarkers` (body_composition) then upserts check-in with `weight_logged` in `activities_done` |
| `questions` | Opens **Questions modal** — three 1–5 sliders (energy, sleep, mood); submitting upserts check-in with `daily_questions` in `activities_done` |

All task completions upsert `POST /health-plans/:id/checkin` preserving the full accumulated state for that day (dots_taken + all activities_done). Tapping Dots again toggles it back off.

### Weight modal

Bottom sheet with a digit input. Uses `adjust-position="{{false}}"` + `bindfocus` / `bindblur` to shift the sheet up by the exact keyboard height (`planWeightKeyboard` px), keeping the input visible above the keyboard. The modal lives outside the `plans-tab` view to avoid being clipped by its `overflow: hidden`.

### Questions modal

Bottom sheet with three labelled sliders (energy / sleep / mood, each 1–5). Labels are not stored separately — only the completion flag (`daily_questions` key in `activities_done`) is persisted.

### Plan Detail Sheet

Bottom sheet overlay with 4 sub-tabs: Overview · Progress · Activities · Guidance.

### Plan Browse Sheet

Half-screen modal listing available templates. Join as Primary / Join as Secondary. Conflict handled via `wx.showModal`.

### Key methods

| Method | Purpose |
|---|---|
| `_loadPlans(user, lang)` | Parallel-fetches `/health-plans` + `/health-plan-templates`; enriches plan objects including daily task state |
| `handlePlanTask(e)` | Dispatcher — routes tap to `_doDotsTask`, `openWeightTask`, or `openQuestionsTask` |
| `_upsertCheckin(planId, dots_taken, activities_done)` | Shared helper — POSTs today's check-in with full merged state |
| `_doDotsTask(planId)` | Toggles `dots_taken`, upserts check-in, reloads plans |
| `handleWeightSubmit()` | POSTs body_composition biomarker + adds `weight_logged` to check-in |
| `handleQuestionsSubmit()` | Adds `daily_questions` to check-in |
| `handlePlanCheckin(e)` | Legacy single-tap check-in (still used in the Plan Detail Sheet activities sub-tab) |
| `handleJoinPlan(e)` | POSTs join; handles 409 conflict with replace dialog |
| `handleAbandonPlan(e)` | Confirms + PUTs `{ status: 'abandoned' }` |
| `handleSwitchPlanType(e)` | Confirms + PUTs `{ plan_type: newType }` |

---

## Coach Panel

**Files:** `src/mini/nano-miniapp/pages/coach/coach.js`, `coach.wxml`, `coach.wxss`

The client detail sheet has a **Plans** tab with the client's active plans, a **Recommend a Plan** button, and a **Create Custom Plan** form.

---

## Admin Panel — Health Plans Tab

**File:** `src/web/admin-panel/src/App.jsx`

### Templates sub-tab

Full CRUD for `health_plan_templates`. The template edit modal has four tabs:

| Tab | Fields |
|---|---|
| Basics | key_name, duration_weeks, sort_order, name_zh/en, goal_zh/en, is_active |
| Content | desc_zh, desc_en |
| Targets | Target sub-ages (multi-select), Recommended Dots (multi-select), **Daily Tasks** |
| Schedule | Milestones, Daily Reminders |

#### Daily Tasks section (Targets tab)

Three fixed task rows — one per built-in task type (💊 dots, ⚖️ weight, 📋 questions). Each row has:
- **Checkbox** — enable or disable the task for this plan
- **Chinese label** input — customise the chip label
- **English label** input — customise the chip label

New templates default to all three enabled. Editing an existing template merges saved config over the defaults, so adding a new task type in the future won't break existing templates.

### User Plans sub-tab

Read-only view of all enrollments, filterable by status. Uses `GET /health-plans?all=true`.

---

## API Endpoints

All endpoints require `Authorization: Bearer <token>`.

### Templates

| Method | Path | Description |
|---|---|---|
| `GET` | `/health-plan-templates` | List active templates |
| `POST` | `/health-plan-templates` | Create template — accepts `daily_tasks` array |
| `PUT` | `/health-plan-templates/:id` | Update template — accepts `daily_tasks` array |
| `DELETE` | `/health-plan-templates/:id` | Delete — 409 if active plans reference it |

### User Plans

| Method | Path | Description |
|---|---|---|
| `GET` | `/health-plans` | User's active plans (`?openid=X`) or all plans (`?all=true`). Returns `today_checkin` (today's `dots_taken` + `activities_done`) and `daily_tasks` per plan for the miniapp card |
| `GET` | `/health-plans/:id` | Full plan detail — plan row + last 30 check-ins + milestones |
| `POST` | `/health-plans` | Join a plan — 409 `{ error: 'conflict' }` if slot occupied |
| `PUT` | `/health-plans/:id` | Update `status` or `plan_type` |

### Check-ins & Milestones

| Method | Path | Description |
|---|---|---|
| `POST` | `/health-plans/:id/checkin` | Upsert daily check-in. Body: `{ openid, checkin_date, dots_taken, activities_done, notes? }`. Idempotent — calling multiple times per day replaces the record. |
| `POST` | `/health-plans/:id/milestone` | Link a biomarker scan to a milestone slot |

### Coach

| Method | Path | Description |
|---|---|---|
| `GET` | `/coach-client-plans` | All active plans for a coach's clients |

---

## Component Map

| Component | File | Role |
|---|---|---|
| DB migration | `src/schemas/migration_health_plans.sql` | All 4 tables, indexes, triggers, 6 seed templates |
| daily_tasks migration | `temp/migration_add_daily_tasks.sql` | Adds `daily_tasks` JSONB column to `health_plan_templates` |
| Migration runner | `temp/run-migration-health-plans.js` | One-shot runner for initial schema |
| daily_tasks runner | `temp/run-migration-daily-tasks.js` | One-shot runner for daily_tasks column |
| API handlers | `src/functions/worker/index.js` | All 11 handlers + plan context in chat |
| Chat prompts | `src/functions/worker/prompts/chat/` | casual.js, biomarker.js, nutrition.js |
| Miniapp Plans tab | `src/mini/nano-miniapp/pages/main/main.js` | Plans tab logic, task handlers |
| Miniapp Plans UI | `src/mini/nano-miniapp/pages/main/main.wxml` | Plan cards, task chips, daily bar, weight + questions modals, detail sheet, browse sheet |
| Miniapp Plans CSS | `src/mini/nano-miniapp/pages/main/main.wxss` | All plans tab styles including task chips, daily bar, modals |
| Coach panel | `src/mini/nano-miniapp/pages/coach/coach.js` | Plans sub-tab in client detail |
| Admin panel | `src/web/admin-panel/src/App.jsx` | `HealthPlansTab` component — templates CRUD, daily tasks config, user plans view |
