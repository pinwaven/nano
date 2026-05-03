# Health Plan System

A **Health Plan** is the goal-oriented unit that ties all of Nano's loose pieces together — Kino biomarker scans, daily dot adherence, coaching conversations, and activity guidance — into a single trackable object. A user joins a plan with an explicit goal (e.g. "reduce metabolic age, lose body fat") and an estimated timeframe; from that point every Kino scan and check-in is measured against it.

Plans are the common ground between the user, their coach, and the Nano AI. The AI is plan-aware in every chat turn; coaches can recommend or author plans; users can browse, join, and track their own plans from the miniapp.

---

## Core Concepts

| Concept | Description |
|---|---|
| **Plan Template** | A reusable goal blueprint — name, description, duration, target sub-ages, recommended Dots, activity guidance, milestone schedule. Global or channel-scoped. |
| **Health Plan** | A user's active enrollment in a template (or a coach-created custom plan). Records start date, baseline bioage snapshot, source, and status. |
| **Check-in** | A daily adherence record for a plan. Idempotent — submitting twice on the same day updates the existing record. |
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
| `target_sub_ages` | TEXT[] | Sub-age dimensions this plan targets (`CellularAge`, `MetabolicAge`, `MicroVascularAge`, `ResilienceAge`) |
| `recommended_dot_ids` | JSONB | Array of `dots.id` values — the Dots recommended for this plan |
| `activity_guidance` | JSONB | Structured daily/weekly activity suggestions |
| `milestones` | JSONB | Array of `{ week, label_zh, label_en }` — defines when milestone check-ins should occur |
| `is_active` | BOOLEAN | Inactive templates are hidden from the browse sheet but still resolve for existing plans |
| `sort_order` | INTEGER | Display order in the browse sheet |
| `created_by` | TEXT FK → `users.user_id` | NULL for system-seeded templates |

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
| `duration_weeks` | INTEGER | Resolved from template at join time (coach may override) |
| `baseline_data` | JSONB | Bioage profile + raw biomarkers captured at enrollment (`{ bioage_profile, biomarkers }`) |
| `start_date` | DATE | Day of enrollment |
| `target_end_date` | DATE | `start_date + duration_weeks * 7` |
| `ended_at` | TIMESTAMPTZ | Set when status changes to `completed` or `abandoned` |

**Unique partial index:** `UNIQUE (user_id, plan_type) WHERE status = 'active'`

### `health_plan_checkins`

Daily adherence records. One row per `(plan_id, checkin_date)` — upserted, never duplicated.

| Column | Type | Description |
|---|---|---|
| `id` | BIGSERIAL PK | — |
| `plan_id` | BIGINT FK → `health_plans.id` | CASCADE delete |
| `user_id` | TEXT FK → `users.user_id` | CASCADE delete |
| `checkin_date` | DATE | The day of the check-in (client-supplied, not server time) |
| `dots_taken` | BOOLEAN | Whether the user took their dots that day |
| `activities_done` | JSONB | Array of completed activity key strings |
| `notes` | TEXT | Optional free-text note |

**Unique constraint:** `(plan_id, checkin_date)` — the upsert uses `ON CONFLICT ... DO UPDATE`.

### `health_plan_milestones`

Biomarker scans linked to a plan as progress snapshots. Each milestone corresponds to a slot in the template's `milestones` array (identified by `milestone_index`).

| Column | Type | Description |
|---|---|---|
| `id` | BIGSERIAL PK | — |
| `plan_id` | BIGINT FK → `health_plans.id` | CASCADE delete |
| `user_id` | TEXT FK → `users.user_id` | CASCADE delete |
| `biomarker_id` | INTEGER FK → `biomarkers.id` | The scan that triggered this milestone; SET NULL on biomarker delete |
| `milestone_index` | INTEGER | Which milestone slot this corresponds to (0-based, matches template array) |
| `label_zh` / `label_en` | TEXT | Copied from the template milestone at the time of achievement |
| `snapshot_data` | JSONB | Full `biomarkers.data` at milestone time — preserves the reading even if the biomarker row is later deleted |
| `achieved_at` | TIMESTAMPTZ | When the milestone was recorded |

---

## Seeded Plan Templates

Six global templates are seeded at migration time via `ON CONFLICT (key_name) DO NOTHING`. All have `channel_id = NULL` and are immediately available to all users.

| key_name | name_zh | Duration | Target Sub-Ages | Primary Dots |
|---|---|---|---|---|
| `weight_loss` | 代谢减重 | 8 wks | MetabolicAge, MicroVascularAge | DOT07, DOT08, DOT10, DOT11, DOT13 |
| `anti_aging` | 逆龄还原 | 12 wks | CellularAge, ResilienceAge | DOT01–DOT06, DOT09, DOT16 |
| `energy_boost` | 能量提升 | 6 wks | MicroVascularAge, MetabolicAge | DOT07–DOT11, DOT13, DOT14 |
| `sleep_improvement` | 深度睡眠 | 6 wks | ResilienceAge | DOT09, DOT12, DOT15, DOT16, DOT17 |
| `immunity` | 免疫防御 | 8 wks | ResilienceAge, CellularAge | DOT04, DOT09, DOT15–DOT18 |
| `metabolic_health` | 代谢健康 | 10 wks | MetabolicAge | DOT05, DOT07, DOT11 |

Each template includes a `milestones` array with 2–3 checkpoint entries (e.g. week 4 biomarker check, week 8 mid-assessment, final Kino scan).

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
    → POST /health-plans/:id/checkin  (idempotent upsert per day)
    → Kino scans generate health_plan_milestones rows at milestone weeks
    │
    ▼
Plan end
    PUT /health-plans/:id  { status: 'completed' | 'abandoned' }
    → Sets ended_at = NOW()
    → Frees the plan_type slot for a new enrollment
```

### Switching Primary / Secondary

When a user wants to promote a secondary plan to primary (or vice versa):

```
PUT /health-plans/:id  { plan_type: 'primary' }
```

The handler opens a transaction:
1. Moves any other active plan currently in the `'primary'` slot to `'secondary'`
2. Sets the target plan to `'primary'`
3. Commits

This ensures the unique partial index is never violated mid-transaction.

---

## AI Integration

Active health plans are **always** included in the chat LLM context — unlike biomarkers or dots which are only fetched when the intent classifier requests them. The payload is small (max 2 rows) and plan-aware responses are valuable for every chat turn.

### Context injection in `handlePostChat`

```js
fetches.health_plans = pool.query(
    `SELECT hp.id, hp.plan_type, hp.start_date, hp.duration_weeks, ...
     FROM health_plans hp
     LEFT JOIN health_plan_templates hpt ON hpt.id = hp.template_id
     WHERE hp.user_id = $1 AND hp.status = 'active'
     ORDER BY hp.plan_type ASC LIMIT 2`,
    [user_id]
);
```

Each row is projected into `llmContext.active_health_plans`:

```js
{
  plan_type:       'primary',
  name:            'Anti-Aging Protocol',   // language-resolved
  goal:            'Reduce CellularAge and ResilienceAge',
  target_sub_ages: ['CellularAge', 'ResilienceAge'],
  weeks_elapsed:   3,
  total_weeks:     12,
  checkin_count:   14,
  milestones_done: 0,
}
```

### Prompt templates that consume plan context

| Prompt | File | Usage |
|---|---|---|
| `casual` | `prompts/chat/casual.js` | One-line plan snippet — enables natural plan references in small talk |
| `biomarker` | `prompts/chat/biomarker.js` | Relates biomarker readings to plan goal and target sub-ages |
| `nutrition` | `prompts/chat/nutrition.js` | Aligns nutrition and Dots advice to the active plan goal |

All three templates render nothing when `active_health_plans` is empty — no changes to the prompt output for users without plans.

---

## Miniapp — Plans Tab

**Tab order:** Chat → Health → **Plans** → Dots → Store

**Files:** `src/mini/nano-miniapp/pages/main/main.js`, `main.wxml`, `main.wxss`

**Icon:** `src/mini/nano-miniapp/assets/icons/plans.svg` — target/crosshair (two concentric circles + tick marks), matching the existing icon style.

### Tab data state

```js
plansLoading: true,
activePlans: [],      // up to 2 enriched plan objects
planTemplates: [],    // available templates for browse sheet
planDetailOpen: false,
planDetailData: null,
planSubTab: 'overview', // 'overview' | 'progress' | 'activities' | 'guidance'
planBrowseOpen: false,
planCheckinBusy: false,
```

Each plan in `activePlans` is enriched with computed display fields:
- `progressPct` — `(weeksElapsed / totalWeeks) * 100`, capped at 100
- `adherencePct` — `(checkin_count / days_since_start) * 100`, capped at 100
- `weeksDone` / `totalWeeks` — week counts
- `checkedInToday` — true when `checked_in_today > 0` (server computes via `CURRENT_DATE` subquery)
- `sub_ages_display` — `target_sub_ages.join(' · ')` pre-computed in JS (WXML does not support method calls in mustache)

### Plan cards

Each active plan renders as a card showing:
- Type badge (Primary / Secondary) with colour: purple for primary, green for secondary
- Plan name (language-resolved)
- Progress bar (weeks elapsed)
- Adherence % and week count
- "Today Check-in" / "Checked In" button

Tapping a card opens the **Plan Detail Sheet**.

### Plan Detail Sheet

Bottom sheet overlay with 4 sub-tabs:

| Sub-tab | Content |
|---|---|
| Overview | Goal statement, start date, duration, target sub-age chips, recommended Dots chips, Switch Type + Abandon actions |
| Progress | Adherence %, total check-ins, weeks elapsed, milestone timeline |
| Activities | Today's activity guidance; inline check-in button |
| Guidance | Full template description + recommended Dots list |

### Plan Browse Sheet

Half-screen modal listing all available templates. Each card shows name, goal, duration, target sub-ages, and two join buttons: "Join as Primary" / "Join as Secondary". Conflict handling via `wx.showModal` — user can replace the existing plan or cancel.

### Key methods

| Method | Purpose |
|---|---|
| `_loadPlans(user, lang)` | Parallel-fetches `/health-plans` + `/health-plan-templates`; enriches plan objects |
| `handlePlanCheckin(e)` | POSTs today's check-in; idempotent |
| `handleJoinPlan(e)` | POSTs join; handles 409 conflict with replace dialog |
| `handleAbandonPlan(e)` | Confirms + PUTs `{ status: 'abandoned' }` |
| `handleSwitchPlanType(e)` | Confirms + PUTs `{ plan_type: newType }` |

---

## Coach Panel

**Files:** `src/mini/nano-miniapp/pages/coach/coach.js`, `coach.wxml`, `coach.wxss`

The client detail sheet gains a **Plans** tab between Health and Chat.

### Plans panel content

- List of the client's active plans (type badge, name, adherence %, weeks remaining)
- **Recommend a Plan** button — opens a template picker; POSTs with `source: 'coach'` and `plan_type: 'secondary'`
- **Create Custom Plan** button — opens an inline form (name, goal, duration) for template-free plans (`template_id: null`)

### Coach data state

```js
detailPlans: [],
detailPlansLoading: false,
planTemplates: [],
planRecommendOpen: false,
planCustomOpen: false,
planCustomName: '', planCustomGoal: '', planCustomDuration: 4,
planActionBusy: false,
```

`switchDetailTab` triggers `_loadClientPlans()` when the Plans tab is opened — lazy loads client plans and available templates in parallel.

---

## Admin Panel — Health Plans Tab

**File:** `src/web/admin-panel/src/App.jsx`

**Navigation:** Added between Questionnaires and Reports. Icon: `Activity` from lucide-react.

### Templates sub-tab

Full CRUD for `health_plan_templates`:

- **Table** — key_name, bilingual name, duration, target sub-ages (comma-joined), status, sort order, active enrollment count
- **Add / Edit modal** — all fields including multi-select for target sub-ages (the 4 canonical keys), checkbox grid for recommended Dots (using the existing `dots` state), JSON textarea for milestones
- **Delete** — blocked if `active_enrollments > 0` (both server 409 and a count-based UI disable)
- **Status toggle** — inactive templates disappear from the miniapp browse sheet but remain resolvable for existing enrollments

### User Plans sub-tab

Read-only view of all user enrollments, loaded lazily on first activation:

- Filter by status (`active` / `completed` / `abandoned` / `paused`)
- Columns: user nickname, plan name, type badge, source, check-in count, weeks elapsed/total, start date

The API call uses `GET /health-plans?all=true` which bypasses the `openid` requirement and returns all plans (worker enforces via the standard Bearer token check).

---

## API Endpoints

All endpoints require the standard `Authorization: Bearer <token>` header.

### Templates

| Method | Path | Description |
|---|---|---|
| `GET` | `/health-plan-templates` | List active templates (`?all=true` includes inactive; `?channel_id=N` scopes to channel + global) |
| `POST` | `/health-plan-templates` | Create a new template (admin/coach) |
| `PUT` | `/health-plan-templates/:id` | Update template fields or toggle `is_active` |
| `DELETE` | `/health-plan-templates/:id` | Delete — returns 409 if any active plans reference the template |

### User Plans

| Method | Path | Description |
|---|---|---|
| `GET` | `/health-plans` | User's active plans (`?openid=X`); or all plans (`?all=true`) for admin |
| `GET` | `/health-plans/:id` | Full plan detail — plan row + last 30 check-ins + milestones (`?openid=X` ownership check) |
| `POST` | `/health-plans` | Join a plan — returns 409 `{ error: 'conflict', existing_plan_id }` if slot occupied |
| `PUT` | `/health-plans/:id` | Update `status` or `plan_type`; type swap uses a transaction |

### Check-ins & Milestones

| Method | Path | Description |
|---|---|---|
| `POST` | `/health-plans/:id/checkin` | Record daily check-in (idempotent upsert) |
| `POST` | `/health-plans/:id/milestone` | Link a biomarker scan to a milestone slot |

### Coach

| Method | Path | Description |
|---|---|---|
| `GET` | `/coach-client-plans` | All active plans for a coach's clients (`?coach_id=N`) |

---

## Component Map

| Component | File | Role |
|---|---|---|
| DB migration | `src/schemas/migration_health_plans.sql` | All 4 tables, indexes, triggers, 6 seed templates |
| Migration runner | `temp/run-migration-health-plans.js` | One-shot runner with verification output |
| API handlers | `src/functions/worker/index.js` | All 11 handlers + route registrations + plan context in chat |
| Chat — casual | `src/functions/worker/prompts/chat/casual.js` | Plan snippet in casual conversation |
| Chat — biomarker | `src/functions/worker/prompts/chat/biomarker.js` | Plan goal in biomarker analysis |
| Chat — nutrition | `src/functions/worker/prompts/chat/nutrition.js` | Plan goal in nutrition/Dots advice |
| Miniapp Plans tab | `src/mini/nano-miniapp/pages/main/main.js` | Plans tab logic, all action methods |
| Miniapp Plans UI | `src/mini/nano-miniapp/pages/main/main.wxml` | Plans tab, detail sheet, browse sheet, tab bar |
| Miniapp Plans CSS | `src/mini/nano-miniapp/pages/main/main.wxss` | Plans tab styles (appended) |
| Plans icon | `src/mini/nano-miniapp/assets/icons/plans.svg` | Target/crosshair icon |
| Coach panel | `src/mini/nano-miniapp/pages/coach/coach.js` | Plans sub-tab in client detail |
| Coach panel UI | `src/mini/nano-miniapp/pages/coach/coach.wxml` | Plans panel with recommend + custom plan forms |
| Coach panel CSS | `src/mini/nano-miniapp/pages/coach/coach.wxss` | Plans panel styles (appended) |
| Admin panel | `src/web/admin-panel/src/App.jsx` | `HealthPlansTab` component, NAV entry, `fetchData` |
