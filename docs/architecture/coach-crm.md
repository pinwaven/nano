# Coach CRM System

The Coach CRM gives coaches a structured way to manage their clients beyond basic chat — tracking lifecycle stages, goals, notes, appointments, and communication campaigns. It is built in five phases, each adding a new capability layer, all sharing a common activity log as the audit trail.

**Coach Groups** extend the CRM with a mid-tier organising layer: business entities (clinics, studios, nutrition stores) that employ multiple coaches within a single channel. Groups unlock group-level KPI aggregation without splitting the channel or creating separate user pools.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  Miniapp coach page  (coach.js / .wxml / .wxss)         │
│  Tab 6: CRM   Tab 7: Performance   Client detail        │
└──────────────────────────┬──────────────────────────────┘
                           │  HTTP (wx.request)
┌──────────────────────────▼──────────────────────────────┐
│  FC 3.0 worker  (src/functions/worker/index.js)          │
│  35+ CRM routes + logActivity() helper                  │
└──────────────────────────┬──────────────────────────────┘
                           │  pg (raw SQL)
┌──────────────────────────▼──────────────────────────────┐
│  PolarDB (PostgreSQL 14)                                 │
│  12 CRM tables across 5 migrations + coach_groups        │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  Web admin panel  (src/web/admin-panel/src/App.jsx)      │
│  Coach CRM nav item → CoachCRMTab                       │
│  Sub-tabs: Pipeline | Campaigns | Performance | NPS | Groups │
└──────────────────────────┬──────────────────────────────┘
                           │  axios
                           └── same FC 3.0 worker
```

---

## Database Schema

All migrations live in `src/schemas/` with the prefix `migration_coach_crm_phase{N}.sql`. Run with `npm run migrate:dev` / `npm run migrate:prod`.

### Phase 1 — Client Organisation

#### `client_tags`
Coach-defined colour-coded labels.

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `coach_id` | INTEGER FK → coaches | Cascade delete |
| `name` | TEXT | Unique per coach |
| `color_hex` | TEXT | Default `#6375EC` |
| `created_at` | TIMESTAMPTZ | |

Unique constraint: `(coach_id, name)`.

#### `client_tag_assignments`
Many-to-many junction: tags ↔ users per coach.

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `tag_id` | INTEGER FK → client_tags | Cascade delete |
| `user_id` | TEXT FK → users | Cascade delete |
| `coach_id` | INTEGER FK → coaches | Denormalised for fast per-coach queries |
| `assigned_at` | TIMESTAMPTZ | |

Unique constraint: `(tag_id, user_id)`.

#### `client_pipeline_stages`
One row per coach–client pair recording the current CRM stage.

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `coach_id` | INTEGER FK → coaches | |
| `user_id` | TEXT FK → users | |
| `stage` | TEXT | See [Pipeline Stages](#pipeline-stages) |
| `stage_changed_at` | TIMESTAMPTZ | Updated on each stage change |
| `note` | TEXT | Optional reason for the last change |

Unique constraint: `(coach_id, user_id)`. Upserted with `ON CONFLICT`.

#### `coach_client_notes`
Private freeform notes a coach writes about a client. Never visible to the client.

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `coach_id` | INTEGER FK → coaches | |
| `user_id` | TEXT FK → users | |
| `content` | TEXT | |
| `is_pinned` | BOOLEAN | Pinned notes sort to the top |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

#### `client_activity_log`
Append-only audit trail of every significant interaction. Written fire-and-forget by the server — never blocks an HTTP response.

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `coach_id` | INTEGER FK → coaches | |
| `user_id` | TEXT FK → users | |
| `activity_type` | TEXT | See enum below |
| `metadata` | JSONB | Arbitrary context (plan name, stage, score, …) |
| `occurred_at` | TIMESTAMPTZ | |

`activity_type` values: `message_sent`, `reminder_set`, `plan_assigned`, `plan_completed`, `kino_scan`, `stage_changed`, `note_added`, `appointment_scheduled`, `appointment_completed`, `nps_received`, `questionnaire_assigned`, `goal_set`, `goal_achieved`, `bulk_message_sent`.

---

### Phase 2 — Communication

#### `message_templates`
Reusable message templates with variable slots.

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `coach_id` | INTEGER FK → coaches | NULL = channel-wide template |
| `channel_id` | INTEGER FK → channels | NULL = not channel-scoped |
| `title` | TEXT | |
| `content_zh` | TEXT | Canonical content |
| `content_en` | TEXT | Optional English copy |
| `category` | TEXT | `general`, `welcome`, `check_in`, `plan_update`, `scan_reminder`, `milestone`, `re_engagement`, `nps` |
| `variables` | TEXT[] | e.g. `{name,bio_age,plan_name}` |
| `use_count` | INTEGER | Incremented each time the template is sent |
| `is_active` | BOOLEAN | |
| `created_at` | TIMESTAMPTZ | |

Variable substitution is performed client-side in the miniapp (replace `{name}`, `{bio_age}`, etc. from `detailClient` data). The preview endpoint (`POST /api/message-templates/:id/preview`) performs server-side substitution for a given `user_id`.

#### `bulk_message_campaigns`
Group messaging jobs targeting a filtered subset of a coach's clients.

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `coach_id` | INTEGER FK → coaches | |
| `template_id` | INTEGER FK → message_templates | Nullable |
| `title` | TEXT | |
| `content` | TEXT | Final message text (may differ from template after edits) |
| `target_filter` | JSONB | `{stage:[], tag_ids:[], has_scanned:bool, bio_age_delta_min:n}` |
| `recipient_count` | INTEGER | Resolved at campaign creation time |
| `sent_count` | INTEGER | Incremented as each batch completes |
| `status` | TEXT | `draft` → `sending` → `sent` / `failed` |
| `scheduled_at` | TIMESTAMPTZ | Reserved for future scheduled sends |
| `sent_at` | TIMESTAMPTZ | When the send job finished |
| `created_at` | TIMESTAMPTZ | |

#### `bulk_message_recipients`
Per-user delivery record for each campaign.

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `campaign_id` | BIGINT FK → bulk_message_campaigns | Cascade delete |
| `user_id` | TEXT FK → users | |
| `personalized` | TEXT | Rendered message after variable substitution |
| `status` | TEXT | `pending` → `sent` / `failed` |
| `sent_at` | TIMESTAMPTZ | |

---

### Phase 3 — Scheduling & Goals

#### `appointments`
Coach–client sessions (video, phone, in-person, or WeChat call).

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `coach_id` | INTEGER FK → coaches | |
| `user_id` | TEXT FK → users | |
| `title` | TEXT | |
| `scheduled_at` | TIMESTAMPTZ | |
| `duration_min` | INTEGER | Default 30 |
| `format` | TEXT | `video`, `phone`, `in_person`, `wechat` |
| `status` | TEXT | `scheduled`, `completed`, `cancelled`, `no_show` |
| `coach_notes` | TEXT | Post-session notes |
| `meeting_link` | TEXT | Video link (Zoom, Tencent Meeting, …) |
| `reminder_sent` | BOOLEAN | Whether the reminder notification was dispatched |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

#### `client_goals`
Structured health targets a coach sets for a client.

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `coach_id` | INTEGER FK → coaches | |
| `user_id` | TEXT FK → users | |
| `goal_type` | TEXT | `bio_age`, `sub_age`, `weight`, `steps`, `sleep_score`, `hrv`, `kino_scan_count`, `custom` |
| `title_zh` | TEXT | Display title |
| `title_en` | TEXT | |
| `target_value` | NUMERIC | |
| `target_unit` | TEXT | |
| `target_sub_age` | TEXT | For `sub_age` goals: `CellularAge`, `MetabolicAge`, … |
| `baseline_value` | NUMERIC | Captured at goal creation |
| `current_value` | NUMERIC | Updated automatically after each Kino scan |
| `target_date` | DATE | |
| `status` | TEXT | `active`, `achieved`, `missed`, `cancelled` |
| `achieved_at` | TIMESTAMPTZ | Set when `status` flips to `achieved` |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

**Goal auto-refresh**: `refreshGoalProgress(userId)` is called fire-and-forget inside `handlePostBiomarkers` after every successful Kino scan. It reads `health_twin.latest_bio_age` and `latest_sub_ages`, updates `current_value` on all active goals for that user, and flips `status = 'achieved'` where the threshold is met. For bio-age and sub-age goals, lower current value = improvement (progress % is computed inversely).

---

### Phase 4 — Feedback & Analytics

#### `client_nps_surveys`
NPS and satisfaction surveys sent by a coach to a client.

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `coach_id` | INTEGER FK → coaches | |
| `user_id` | TEXT FK → users | |
| `survey_type` | TEXT | `nps`, `satisfaction`, `plan_feedback` |
| `score` | SMALLINT | 0–10 (NPS scale) |
| `feedback_text` | TEXT | |
| `plan_id` | BIGINT FK → health_plans | Nullable; links to the plan being evaluated |
| `sent_at` | TIMESTAMPTZ | |
| `responded_at` | TIMESTAMPTZ | |
| `status` | TEXT | `sent`, `responded`, `skipped` |

#### `coach_performance_snapshots`
Monthly KPI cache for historical reporting. Live data is computed on demand for the current period; past periods are read from this table.

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `coach_id` | INTEGER FK → coaches | |
| `period` | VARCHAR(7) | `YYYY-MM` |
| `total_clients` | INTEGER | |
| `active_clients` | INTEGER | |
| `at_risk_count` | INTEGER | |
| `new_clients` | INTEGER | |
| `scans_facilitated` | INTEGER | |
| `plans_assigned` | INTEGER | |
| `messages_sent` | INTEGER | |
| `appointments_held` | INTEGER | |
| `avg_bio_age_improvement` | NUMERIC | Average delta across active clients |
| `avg_nps_score` | NUMERIC | |
| `commission_cny` | NUMERIC | |
| `computed_at` | TIMESTAMPTZ | |

Unique constraint: `(coach_id, period)`. Written via `POST /api/coach-kpis/compute` (superadmin only).

---

### Phase 5 — Automation

#### `follow_up_rules`
Trigger-based automation rules that fire actions on matching clients.

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `coach_id` | INTEGER FK → coaches | |
| `rule_name` | TEXT | Human-readable label |
| `trigger_event` | TEXT | See trigger enum below |
| `trigger_value` | INTEGER | Threshold (e.g. number of days) |
| `action_type` | TEXT | See action enum below |
| `template_id` | INTEGER FK → message_templates | Nullable; used by `send_message` action |
| `action_payload` | JSONB | Extra action data (stage to set, appointment title, …) |
| `is_active` | BOOLEAN | |
| `last_run_at` | TIMESTAMPTZ | Updated each time the rule fires |
| `created_at` | TIMESTAMPTZ | |

**Trigger events**: `no_scan_days`, `no_message_days`, `plan_week_start`, `plan_completed`, `bio_age_increased`, `nps_detractor`, `stage_changed_at_risk`, `goal_deadline_approaching`.

**Action types**: `send_reminder`, `send_message`, `change_stage`, `create_appointment`.

The rule engine is evaluated by calling `POST /api/follow-up-rules/evaluate`. This endpoint is designed to be triggered by a cron job. It scans all active rules, finds matching clients for each trigger condition, and fires the configured action for each match.

---

---

## Coach Groups

### Concept

A **coach group** represents a business entity (e.g. an anti-aging clinic, a nutrition store, a wellness studio) that employs one or more coaches within a single channel. It sits between the channel and the individual coach in the organisational hierarchy:

```
Channel
  └── Coach Group (e.g. "Aeviva Clinic", "NutraStudio")
        └── Coach A
        └── Coach B
        └── Coach C
```

Groups are purely organisational — they have no separate user pool, invite codes, or access credentials. Deleting a group ungrouped its coaches (`ON DELETE SET NULL`) without removing any coach or user data.

### Database Schema

**Migration:** `src/schemas/migration_coach_groups.sql`

#### `coach_groups`

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `channel_id` | INTEGER FK → channels | `ON DELETE CASCADE` — deleting a channel removes its groups |
| `name` | TEXT NOT NULL | Unique per channel |
| `description` | TEXT | Optional free-text notes |
| `type` | TEXT | Optional free-text category: `clinic`, `studio`, `nutrition`, etc. |
| `created_at` | TIMESTAMPTZ | |

Unique constraint: `(channel_id, name)` — duplicate group names within a channel are rejected with HTTP 409.

#### `coaches.group_id` (added column)

`group_id INTEGER REFERENCES coach_groups(id) ON DELETE SET NULL` is added to the `coaches` table. A coach with `group_id = NULL` is considered ungrouped.

### API Reference

All routes live in `src/functions/worker/index.js`. Route ordering matters: `/coach-group-kpis` and `/coach-groups` must appear before `/coach-kpis` and `/coaches` respectively in the routing chain (path matching uses `path.includes()`).

#### Groups CRUD

| Method | Path | Body / Query | Description |
|---|---|---|---|
| GET | `/api/coach-groups` | `?channel_id=X` | List groups for a channel with `coach_count`. Channel admins are auto-scoped to their own channel. |
| POST | `/api/coach-groups` | `{channel_id, name, description?, type?}` | Create a group. Channel admins use their own `channel_id` regardless of the body value. |
| PUT | `/api/coach-groups/:id` | `{name, description?, type?}` | Update. Channel admins may only edit groups in their own channel (403 otherwise). |
| DELETE | `/api/coach-groups/:id` | — | Delete. Coaches in the group have `group_id` set to NULL automatically. |

**Coach CRUD changes** — `POST /api/coaches` and `PUT /api/coaches/:id` now accept an optional `group_id` field. Passing `null` explicitly ungroups a coach. `GET /coach-list` and `GET /channel-coaches/:id` return `group_id` and `group_name` on every coach row.

#### Group KPIs

```
GET /api/coach-group-kpis?group_id=X&period=YYYY-MM
```

Returns aggregate KPI metrics across all coaches in the group.

**Response shape:**

```json
{
  "success": true,
  "kpis": {
    "group_id": 3,
    "period": "2026-05",
    "total_clients": 42,
    "active_clients": 28,
    "at_risk_count": 4,
    "scans_facilitated": 19,
    "plans_assigned": 11,
    "messages_sent": 87,
    "appointments_held": 14,
    "avg_nps_score": 8.3,
    "nps_response_count": 9,
    "commission_cny": 12450,
    "coach_count": 3
  },
  "group": { "id": 3, "name": "Aeviva Clinic", "type": "clinic" },
  "source": "snapshot"
}
```

**KPI resolution strategy** — mirrors `GET /api/coach-kpis`:

| Period | Source |
|---|---|
| Past months | Aggregated from `coach_performance_snapshots` (one SQL query) |
| Current month | Seven parallel live SQL queries across all `coaches WHERE group_id = X` |

**NPS aggregation** uses a weighted average to avoid distortion from coaches with few responses:

```sql
SUM(avg_nps_score * nps_response_count) / SUM(nps_response_count)
```

A group with no coaches returns zeroed KPIs with `coach_count: 0`.

### Web Admin Panel

#### Coaches Tab (`CoachTab`)

- **Group filter pills** — a row of purple-tinted pills below the channel filter strip. Each pill shows the group name and a `coach_count` badge. Clicking a pill filters the coach table to that group; clicking again clears the filter.
- **"Group" column** — new column in the coach table showing a purple badge with the group name, or `—` for ungrouped coaches.
- **Group management panel** — a collapsible card below the coach table listing all groups with their type, description, and coach count. Add / Edit / Delete buttons open `CoachGroupModal` or `DeleteCoachGroupConfirm` respectively.
- **"+ Add Group" shortcut** — appears inline in the filter pills row even before any groups exist, allowing quick group creation.
- **`CoachModal` group assignment** — when groups exist for the channel, an additional `<select>` dropdown for "Group" appears below the channel selector.

#### Coach CRM Tab (`CoachCRMTab`) — Groups sub-tab

New sub-tab `Groups` (after NPS) in the Coach CRM nav:

1. **Group selector** — dropdown listing all groups for the channel (derived from `coaches[0].channel_id`).
2. **Period picker** — shared `<input type="month">` with the Performance sub-tab.
3. **Stat cards** — Total Clients, Active, At Risk, Coach Count (purple).
4. **Aggregate KPI table** — single row: Scans, Plans Assigned, Messages, Appts Held, Avg NPS, Commission ¥.
5. **Per-coach breakdown** — table of coaches in the selected group, reusing `kpiRows` loaded in the Performance sub-tab if already populated. Shows individual Total Clients, Active, Scans, Avg NPS, Commission per coach.

### Design Decisions

**Why not sub-channels?** Sub-channels (`channels.parent_channel_id`) are for brand or geographic separation — they carry their own user pools, invite codes, and admin access. A business entity within a channel does not need any of that. Using sub-channels for groups would have created ownership ambiguity for users and coaches, and polluted the channel list with entities that are not top-level brands.

**No user ↔ group FK** — users belong to coaches who belong to groups. There is no `users.group_id` column. Group-level stats are always derived by joining through `coaches`: `users JOIN coaches ON users.coach_id = coaches.id WHERE coaches.group_id = X`. This keeps the user model clean and means a user's group affiliation changes automatically when their coach's group assignment changes.

---

## Pipeline Stages

Every coach–client relationship has a lifecycle stage stored in `client_pipeline_stages`.

| Stage | Colour | Meaning |
|---|---|---|
| `lead` | `#f59e0b` (amber) | Prospect; invited but not yet onboarded |
| `onboarding` | `#6375EC` (indigo) | First scan done; plan not yet established |
| `active` | `#10b981` (green) | Regular scanning and plan adherence |
| `at_risk` | `#ef4444` (red) | Engagement drop or bio-age regression |
| `churned` | `#6b7280` (grey) | No engagement for extended period |
| `graduated` | `#0ea5e9` (sky) | Goals achieved; self-managing |

Stage changes are written with `ON CONFLICT (coach_id, user_id) DO UPDATE`. Every stage change also writes a fire-and-forget `stage_changed` row to `client_activity_log`.

---

## API Reference

All routes are `else if` branches in `src/functions/worker/index.js`. Path matching is on `event.rawPath`; method from `event.requestContext.http.method`.

### Tags

| Method | Path | Body / Query | Description |
|---|---|---|---|
| GET | `/api/coach-tags` | `?coach_id=` | List all tags for a coach |
| POST | `/api/coach-tags` | `{coach_id, name, color_hex}` | Create a tag |
| PUT | `/api/coach-tags/:id` | `{name?, color_hex?}` | Rename or recolour |
| DELETE | `/api/coach-tags/:id` | — | Delete (cascades assignments) |
| POST | `/api/coach-tag-assignments` | `{coach_id, user_id, tag_ids:[]}` | Assign tags to a client |
| DELETE | `/api/coach-tag-assignments` | `?tag_id=&user_id=` | Remove one assignment |

### Pipeline

| Method | Path | Body / Query | Description |
|---|---|---|---|
| GET | `/api/client-pipeline` | `?coach_id=` | All clients with their current stage |
| POST | `/api/client-pipeline` | `{coach_id, user_id, stage, note?}` | Set (upsert) a client's stage |

`handleGetCoachUsers` (the existing client list endpoint) was extended to accept `?stage=` and `?tag_id=` filters. It LEFT JOINs `client_pipeline_stages` and `client_tag_assignments` and returns `crm_stage`, `crm_tags` (name array), and `crm_tag_objects` (id+name+color array) on every client row.

### Notes

| Method | Path | Body / Query | Description |
|---|---|---|---|
| GET | `/api/coach-notes` | `?coach_id=&user_id=&limit=&before=` | Paginated notes, newest first (pinned first) |
| POST | `/api/coach-notes` | `{coach_id, user_id, content, is_pinned?}` | Create a note |
| PUT | `/api/coach-notes/:id` | `{content?, is_pinned?}` | Edit or toggle pin |
| DELETE | `/api/coach-notes/:id` | — | Delete |

### Activity Log

| Method | Path | Body / Query | Description |
|---|---|---|---|
| GET | `/api/client-activity` | `?coach_id=&user_id=&limit=50&before=` | Client-specific timeline |
| GET | `/api/coach-activity-feed` | `?coach_id=&limit=30` | Cross-client feed (all clients) |

### Message Templates

| Method | Path | Body / Query | Description |
|---|---|---|---|
| GET | `/api/message-templates` | `?coach_id=&channel_id=&category=` | List templates |
| POST | `/api/message-templates` | `{coach_id?, channel_id?, title, content_zh, category, variables?}` | Create |
| PUT | `/api/message-templates/:id` | Partial update | Edit |
| DELETE | `/api/message-templates/:id` | — | Delete |
| POST | `/api/message-templates/:id/preview` | `{user_id}` | Render variables for a specific user |

### Bulk Campaigns

| Method | Path | Body / Query | Description |
|---|---|---|---|
| GET | `/api/bulk-campaigns` | `?coach_id=` | List campaigns |
| POST | `/api/bulk-campaigns` | `{coach_id, title, content, target_filter, template_id?}` | Create draft + resolve recipients |
| POST | `/api/bulk-campaigns/:id/send` | — | Trigger send (returns 202 immediately) |
| GET | `/api/bulk-campaigns/:id/recipients` | — | Per-user delivery status |

**Send flow**: `POST /send` returns `202 Accepted` immediately. Processing happens via `setImmediate` in batches of 50 recipients with a 100 ms gap between batches to protect the DB connection pool. Each batch updates `bulk_message_recipients.status` and increments `bulk_message_campaigns.sent_count`. Campaign `status` flips to `sent` when all batches complete.

### Appointments

| Method | Path | Body / Query | Description |
|---|---|---|---|
| GET | `/api/appointments` | `?coach_id=&user_id=&status=` | List appointments |
| GET | `/api/appointments/upcoming` | `?coach_id=` | Next 7 days across all clients |
| POST | `/api/appointments` | `{coach_id, user_id, title, scheduled_at, duration_min?, format?, meeting_link?}` | Create |
| PUT | `/api/appointments/:id` | Partial update | Edit status, notes, or link |
| DELETE | `/api/appointments/:id` | — | Sets status to `cancelled` |

### Client Goals

| Method | Path | Body / Query | Description |
|---|---|---|---|
| GET | `/api/client-goals` | `?coach_id=&user_id=&status=` | List goals |
| POST | `/api/client-goals` | `{coach_id, user_id, goal_type, title_zh, target_value, baseline_value, target_date?}` | Create |
| PUT | `/api/client-goals/:id` | `{current_value?, status?, achieved_at?}` | Update progress or status |
| DELETE | `/api/client-goals/:id` | — | Delete |

### NPS Surveys

| Method | Path | Body / Query | Description |
|---|---|---|---|
| GET | `/api/nps-surveys` | `?coach_id=&period=&start=&end=` | List surveys |
| POST | `/api/nps-surveys` | `{coach_id, user_id, survey_type, plan_id?}` | Send survey to a client |
| PATCH | `/api/nps-surveys/:id` | `{score, feedback_text}` | Client submits a response |

### Coach KPIs

| Method | Path | Body / Query | Description |
|---|---|---|---|
| GET | `/api/coach-kpis` | `?coach_id=&period=YYYY-MM` | Live data for current month; snapshot for past |
| POST | `/api/coach-kpis/compute` | `{coach_id?, period?}` | Superadmin: compute + store snapshots |

### Follow-Up Rules

| Method | Path | Body / Query | Description |
|---|---|---|---|
| GET | `/api/follow-up-rules` | `?coach_id=` | List rules |
| POST | `/api/follow-up-rules` | `{coach_id, rule_name, trigger_event, trigger_value?, action_type, template_id?, action_payload?}` | Create rule |
| PUT | `/api/follow-up-rules/:id` | Partial update | Edit or toggle `is_active` |
| DELETE | `/api/follow-up-rules/:id` | — | Delete |
| POST | `/api/follow-up-rules/evaluate` | — | Cron-callable rule engine scan |

### Coach Groups

See the full reference in [Coach Groups → API Reference](#api-reference-1) above. Summary:

| Method | Path | Body / Query | Description |
|---|---|---|---|
| GET | `/api/coach-groups` | `?channel_id=X` | List groups with coach count |
| POST | `/api/coach-groups` | `{channel_id, name, description?, type?}` | Create group |
| PUT | `/api/coach-groups/:id` | `{name, description?, type?}` | Update group |
| DELETE | `/api/coach-groups/:id` | — | Delete (ungroups coaches via FK cascade) |
| GET | `/api/coach-group-kpis` | `?group_id=X&period=YYYY-MM` | Aggregate KPIs for all coaches in a group |

---

## Activity Log Helper

```js
function logActivity(coachId, userId, activityType, metadata = {}) {
  pool.query(
    `INSERT INTO client_activity_log (coach_id, user_id, activity_type, metadata)
     VALUES ($1, $2, $3, $4)`,
    [coachId, userId, activityType, JSON.stringify(metadata)]
  ).catch(console.error);
  // no await — never blocks the response path
}
```

Called from inside every CRM handler after a state-changing action. The `metadata` JSONB holds whatever context is useful for display (stage name, template title, goal type, appointment format, NPS score, etc.).

---

## Miniapp Coach Page

The coach page (`pages/coach/`) has 7 tabs after the CRM additions:

| Tab | Key | Label (ZH / EN) | Description |
|---|---|---|---|
| 1 | `clients` | 我的客户 / My Clients | Client list with stage pills and tag chips |
| 2 | `invites` | 邀请码 / Invite Codes | Generate and share invite codes |
| 3 | `earnings` | 我的收益 / My Earnings | Commission and payout history |
| 4 | `questionnaires` | 问卷 / Forms | Assign questionnaires |
| 5 | `training` | 培训 / Training | Academy content |
| 6 | `crm` | 客户管理 / CRM | Pipeline kanban + appointments + activity |
| 7 | `performance` | 我的指标 / KPIs | KPI cards + top improvers |

### Client Card Enhancements (Tab 1)

Each client card in the list now shows:
- **Stage pill** — coloured badge with the stage label
- **Tag chips** — up to 3 tag chips in the tag's `color_hex`; overflows with "+N more"

### Client Detail Sheet — Notes Tab

- Notes loaded via `GET /api/coach-notes?coach_id=&user_id=`
- Pinned notes appear first (sorted by `is_pinned DESC, created_at DESC`)
- Long-press on a note opens a context menu: Pin / Unpin, Delete
- Compose area at the bottom: `textarea` + Save button → `POST /api/coach-notes`

### Client Detail Sheet — Goals Tab

- Goals loaded via `GET /api/client-goals?coach_id=&user_id=`
- Each goal shows a progress bar. For `bio_age` and `sub_age` goals, progress is computed inversely (lower current value = better):
  ```
  progress = (baseline - current) / (baseline - target) × 100
  ```
  For other goal types, progress is direct: `(current - baseline) / (target - baseline) × 100`.
- Tap "Set Goal" → picker for goal type, target value, and target date → `POST /api/client-goals`

### Tab 6 — CRM Dashboard

Three sections stacked vertically:

**Pipeline Kanban** — `scroll-view` with `scroll-x`. Six fixed-width (`240rpx`) columns, one per stage. Each column shows client name pills with bio-age delta. Tapping a pill opens the client detail sheet.

**Upcoming Appointments** — next 5 appointments from `GET /api/appointments/upcoming?coach_id=`. Each card shows client name, scheduled time, and format icon. Tap "+" FAB → appointment booking overlay (client picker, title, date/time, format, meeting link → `POST /api/appointments`).

**Activity Feed** — 30 most recent entries from `GET /api/coach-activity-feed?coach_id=`. Each entry shows an activity-type icon, client name, timestamp, and metadata snippet.

### Tab 7 — Performance Dashboard

**KPI grid** (2 × 3 layout):
- Total Clients / Active Clients
- At-Risk Count / Messages Sent
- Commission ¥ / Avg NPS Score

Data from `GET /api/coach-kpis?coach_id=&period=YYYY-MM`.

**Top Improvers** — clients ranked by bio-age improvement since their baseline, showing delta in years. Computed from the `crm_pipeline` client list by comparing `latest_bio_age` against the first scan's bio age.

### Message Template Picker in Chat

A template icon in the existing chat compose area opens a bottom sheet. Selecting a template pre-fills `msgText` with client-side variable substitution (`{name}` → `detailClient.name`, `{bio_age}` → `detailClient.latest_bio_age`, etc.).

---

## Web Admin Panel

The admin panel gains a **Coach CRM** nav item (using the `Target` icon from lucide-react) that renders `CoachCRMTab`. It is a superadmin-only tab, visible alongside all others in the sidebar.

### Sub-tabs

**Pipeline**
- Coach selector dropdown
- Recharts `BarChart` showing client count per stage (colour-matched to stage colours)
- Client table: Name, Stage badge, Tags, Bio-age delta (green if negative, red if positive), Last Scan date

**Campaigns**
- Requires coach selection
- Table: Title, Status badge, Recipient count, Sent count, Created date, Send action
- "New Campaign" button → modal with: Title, Message content (supports `{name}` variable), optional Stage filter → creates a draft with `POST /api/bulk-campaigns`
- "Send" button on `draft` rows → `POST /api/bulk-campaigns/:id/send`

**Performance**
- Month picker (`<input type="month">`)
- Coach comparison table with one row per coach: Total Clients, Active, At Risk, Scans, Plans Assigned, Messages, Appointments Held, Avg NPS (colour-coded), Commission ¥
- Data fetched in parallel across all coaches via `Promise.all`

**NPS**
- Date range filter (from / to)
- Aggregate cards: Promoters (≥9), Passives (7–8), Detractors (≤6), NPS Score
- NPS Score formula: `((promoters - detractors) / responded) × 100`
- Response table: Coach, User ID, Survey type, Score (colour-coded), Feedback text, Responded At

---

## Cross-Cutting Design Decisions

### Fire-and-forget activity log

Activity log writes never block the HTTP response. The `logActivity()` helper uses `.catch(console.error)` and is never `await`ed. This means:
- Activity rows are eventually consistent — a crash immediately after a successful action may drop the log entry, but the underlying data change is already committed.
- Handlers stay fast and the activity log never causes a user-visible error.

### Bulk send batching

The send job runs outside the HTTP request lifecycle:
```
POST /api/bulk-campaigns/:id/send
  → 202 Accepted (immediate)
  → setImmediate(() => {
      while (batches remain) {
        process 50 recipients
        await sleep(100ms)
      }
    })
```
The 100 ms gap between batches prevents exhausting the PolarDB connection pool under a large send.

### Goal auto-refresh after scan

`refreshGoalProgress(userId)` is invoked inside `handlePostBiomarkers` without `await`. It runs three queries:
1. Read `health_twin` for `latest_bio_age` and `latest_sub_ages`
2. Update `current_value` on all `active` goals for the user
3. Flip `status = 'achieved'` and set `achieved_at` for goals that crossed their threshold

This means goal progress is always up-to-date after a Kino scan without any manual coach action.

### Pipeline filtering on the client list

`GET /api/coach-users/:coachId` accepts two optional query params:
- `?stage=active` — returns only clients at that pipeline stage
- `?tag_id=7` — returns only clients with that tag assigned

Implemented via LEFT JOINs rather than a separate endpoint, so the existing client card data (bio age, last scan, plan info) is returned in the same response alongside the CRM fields.

---

## Verification

| Feature | How to verify |
|---|---|
| Tags | Create tag → assign to client → `GET /api/coach-users/:id` → confirm `crm_tags` array |
| Pipeline | Set stage → `GET /api/client-pipeline?coach_id=` → confirm stage and `stage_changed_at` |
| Notes | Add note → `GET /api/coach-notes?…` → confirm sorted with pinned first |
| Activity log | Any CRM action → `GET /api/client-activity?…` → confirm matching row |
| Bulk send | Create campaign → `POST /send` → confirm `bulk_message_recipients` rows and status transitions |
| Goal auto-refresh | Create `bio_age` goal → run Kino scan → `GET /api/client-goals` → confirm `current_value` updated |
| Follow-up rules | Create `no_scan_days` rule with `trigger_value=14` → ensure client has no scan in 15+ days → `POST /api/follow-up-rules/evaluate` → confirm action fired |
| Admin pipeline | Open Coach CRM → Pipeline sub-tab → select coach → confirm bar chart and client table render |
| Admin NPS | Open NPS sub-tab → load → confirm promoter/passive/detractor counts and NPS score |
| Coach groups CRUD | Coaches tab → "Add Group" → create a group → confirm it appears in the filter pills and management panel |
| Coach group assignment | Edit a coach → assign to a group → confirm purple badge appears in the Group column and `coach_count` increments |
| Group filter | Click a group pill in the Coaches tab → confirm table filters to only that group's coaches |
| Group KPIs | Coach CRM → Groups sub-tab → select group + period → confirm aggregate stat cards and KPI row render; `coach_count` matches the number of coaches assigned |
| Group delete cascade | Delete a group → confirm its coaches now show `group_id: null` in `GET /api/coach-list` |
