# Worker API Endpoints

The `nano-worker` function handles all functional logic for the ecosystem.

## Accessing the API

### 1. Public API (Preferred)
Accessible directly via the main domain. This is the fastest route for external clients like simulators, mobile apps, or WeChat mini-programs.
*   **Base URL:** `https://nano.fros.cc/api`

### 2. Internal Legacy Proxy
Available for the Admin Dashboard to avoid CORS issues and leverage internal VPC performance.
*   **Base URL:** `https://nano.fros.cc/admin/api`

## Authentication

All HTTP requests to `/api/*` require a Bearer token in the `Authorization` header.

```
Authorization: Bearer <token>
```

Requests missing or providing an incorrect token receive a `401 Unauthorized` response:

```json
{ "error": "Unauthorized" }
```

The token is configured via the `API_BEARER_TOKEN` environment variable on the `nano-worker` function. `OPTIONS` preflight requests and EventBridge-triggered invocations bypass this check.

**Client implementations:**
- **WeChat Mini Program** — token stored in `app.globalData.apiToken` (`app.js`), injected in the `_req()` helper across all pages.
- **Admin Panel** — token baked into the Vite bundle via `VITE_API_TOKEN` in `.env`; injected globally via `axios.interceptors.request.use()` in `App.jsx`.

## Routing Summary

| Method | Path | Category | Handler |
|---|---|---|---|
| `GET` | `/users` | Core | List all users |
| `GET` | `/notifications` | Core | Fetch pending notifications |
| `GET` | `/biomarkers` | Core | Fetch biomarker records |
| `GET` | `/dots-inventory` | Dots | List all Dots cartridges |
| `GET` | `/my-cartridges` | Dots | Get user's active cartridges |
| `GET` | `/coach-list` | Admin | List Coaches |
| `GET` | `/kino-upgrade` | Kone Upgrade | Active APK version + download URL — **no auth** |
| `GET` | `/kino-devices` | Kino | List Kino devices |
| `GET` | `/kino-chip` | Kino | Look up chip scan (joins model config) |
| `GET` | `/kino-chip-batches` | Kino | List chip batches |
| `GET` | `/kino-chip-models` | Kino | List chip models with usage counts |
| `GET` | `/kone-apk-releases` | Kone Upgrade | List all APK releases |
| `GET` | `/oss/kone-apk/presign` | Kone Upgrade | Generate presigned PUT + GET URLs for APK upload |
| `POST` | `/kone-apk-releases` | Kone Upgrade | Create a new APK release record |
| `PUT` | `/kone-apk-releases/:id` | Kone Upgrade | Set release active or update notes |
| `DELETE` | `/kone-apk-releases/:id` | Kone Upgrade | Delete inactive release |
| `GET` | `/store-items` | E-commerce | List store items |
| `GET` | `/my-orders` | E-commerce | User's order history |
| `GET` | `/academy/courses` | Academy | List courses |
| `GET` | `/academy/library` | Academy | List library items |
| `POST` | `/biomarkers` | Core | Ingest Kino chip data |
| `POST` | `/chat` | Core | Send a chat message (AI reply) |
| `POST` | `/kino-result` | Kino | Finalize chip scan |
| `POST` | `/cartridge-insert` | Dots | Register new cartridge |
| `POST` | `/cartridge-remove` | Dots | Remove cartridge |
| `POST` | `/dispense` | Dots | Record dispensing |
| `POST` | `/formula-dots` | Dots | Generate dots formula |
| `POST` | `/store-items` | E-commerce | Create store item |
| `POST` | `/orders` | E-commerce | Create order |
| `POST` | `/health-advice` | Engagement | AI health analysis |
| `POST` | `/wx-login` | Auth | WeChat Login |
| `POST` | `/admin/login` | Auth | Admin Login |
| `GET` | `/pending-questionnaires` | Questionnaires | Pending assignments for a user |
| `GET` | `/questionnaires` | Questionnaires | List questionnaires |
| `GET` | `/questionnaires/:id/questions` | Questionnaires | List questions for a questionnaire |
| `GET` | `/questionnaire-assignments` | Questionnaires | List assignments |
| `GET` | `/questionnaire-responses` | Questionnaires | List responses |
| `POST` | `/questionnaire-responses` | Questionnaires | Submit a single answer |
| `POST` | `/questionnaires` | Questionnaires | Create questionnaire |
| `POST` | `/questionnaire-assignments` | Questionnaires | Assign questionnaire to user(s) |
| `PUT` | `/questionnaires/:id` | Questionnaires | Update questionnaire metadata |
| `PUT` | `/questionnaire-questions/:id` | Questionnaires | Edit a question |
| `PUT` | `/questionnaire-questions/reorder` | Questionnaires | Batch sort_order update |
| `PATCH` | `/questionnaire-assignments/:id` | Questionnaires | Update assignment status |
| `DELETE` | `/questionnaires/:id` | Questionnaires | Soft-delete questionnaire |
| `DELETE` | `/questionnaire-questions/:id` | Questionnaires | Remove a question |
| `GET` | `/health-plan-templates` | Health Plans | List plan templates (`?all=true` for admin) |
| `POST` | `/health-plan-templates` | Health Plans | Create template |
| `PUT` | `/health-plan-templates/:id` | Health Plans | Update template |
| `DELETE` | `/health-plan-templates/:id` | Health Plans | Delete template (blocked if active plans exist) |
| `GET` | `/health-plans` | Health Plans | User's plans (`?openid=X`) or all plans (`?all=true`) |
| `POST` | `/health-plans` | Health Plans | Enroll in a plan (captures baseline biomarkers) |
| `GET` | `/health-plans/:id` | Health Plans | Plan detail with checkins + milestones |
| `PUT` | `/health-plans/:id` | Health Plans | Update status or swap primary↔secondary |
| `POST` | `/health-plans/:id/checkin` | Health Plans | Daily check-in (idempotent upsert) |
| `POST` | `/health-plans/:id/milestone` | Health Plans | Record milestone biomarker snapshot |
| `GET` | `/coach-client-plans` | Health Plans | All active plans for a coach's clients |
| `GET` | `/coach-groups` | Coach Groups | List groups in channel (`?channel_id=X`) |
| `POST` | `/coach-groups` | Coach Groups | Create a new coach group |
| `PUT` | `/coach-groups/:id` | Coach Groups | Update coach group name/description/type |
| `DELETE` | `/coach-groups/:id` | Coach Groups | Delete coach group |
| `GET` | `/coach-group-kpis` | Coach Groups | Fetch aggregated performance KPIs for group |
| `GET` | `/channels/:id/rewards-config` | Rewards | Fetch effective rewards overrides and settings |
| `PUT` | `/channels/:id/rewards-config` | Rewards | Update channel rewards overrides |
| `PUT` | `/channels/:id/rewards-permission` | Rewards | Grant/revoke sub-channel rewards customization |
| `POST` | `/health-events` | Digital Twin | Single event ingestion (sleep, activity, manual, etc.) |
| `POST` | `/health-events/sync` | Digital Twin | Batch event ingestion (wearable sync, max 500) |
| `GET` | `/health-events` | Digital Twin | Query event log for user |
| `GET` | `/health-twin` | Digital Twin | Fetch complete user twin summary row |
| `POST` | `/health-reports` | Lab Integration | Ingest lab/health report (JSON/FHIR Bundle) |
| `GET` | `/health-reports` | Lab Integration | List health reports by user |
| `GET` | `/health-reports/:id` | Lab Integration | Retrieve report and linked events |
| `POST` | `/health-events/fhir` | Lab Integration | Ingest a FHIR resource directly |
| `POST` | `/lab/webhook/:labName` | Lab Integration | Webhook push target for external lab provider |

---

## Questionnaires

See full system documentation: [`docs/architecture/questionnaire-system.md`](../architecture/questionnaire-system.md)

### GET /pending-questionnaires?openid={user_id}

Returns all non-completed questionnaire assignments for a user, with full question lists and existing responses. Used by the miniapp on init to determine what to show in chat.

- Onboarding assignment is always first.
- If no onboarding assignment exists yet, one is auto-created (uses the active onboarding questionnaire for the user's channel, or the global fallback).

**Response:**
```json
{
  "assignments": [
    {
      "id": 5,
      "status": "pending",
      "questionnaire": { "id": 1, "name": "Onboarding", "name_zh": "入门问卷", "type": "onboarding" },
      "questions": [
        {
          "id": 1, "key": "nickname", "sort_order": 0, "input_type": "text",
          "prompt_zh": "你好！请问你的昵称是什么？", "prompt_en": "Hi! What should we call you?",
          "save_target": "user_field", "save_field": "nickname",
          "completion_check": { "type": "user_field", "field": "nickname" },
          "config": { "placeholder_zh": "输入你的昵称", "placeholder_en": "Enter your nickname", "max_length": 30 }
        }
      ],
      "responses": []
    }
  ]
}
```

### POST /questionnaire-responses

Submit one answer to one question within an assignment.

**Body:**
```json
{ "assignment_id": 5, "question_id": 1, "answer": "张三" }
```

- Upserts into `questionnaire_responses` (safe to resubmit).
- If the question has a `save_target`, also writes the answer to the user's profile (user field, bio_data JSONB, or biomarkers table).
- Marks assignment `in_progress` if it was `pending`.
- Marks assignment `completed` when all active questions have a response.

### PATCH /questionnaire-assignments/:id

Update an assignment's status manually.

**Body:** `{ "status": "in_progress" }`

### GET /questionnaires?channel_id=&type=

List questionnaires. Filterable by `channel_id` and/or `type` (`onboarding` / `custom`).

### POST /questionnaires

Create a questionnaire.

**Body:** `{ "name", "name_zh", "description", "description_zh", "type", "channel_id", "created_by" }`

### PUT /questionnaires/:id

Update questionnaire metadata (name, description, is_active, etc.).

### DELETE /questionnaires/:id

Soft-delete: sets `is_active = false`. Does not delete existing assignments or responses.

### GET /questionnaires/:id/questions

Returns all active questions for a questionnaire, ordered by `sort_order`.

### POST /questionnaires/:id/questions

Add a question to a questionnaire.

**Body:** `{ "key", "sort_order", "input_type", "prompt_zh", "prompt_en", "save_target", "save_field", "save_biomarker_type", "completion_check", "config" }`

### PUT /questionnaire-questions/:id

Edit a question (any field).

### DELETE /questionnaire-questions/:id

Removes a question (hard delete). Existing responses for that question are preserved but orphaned.

### PUT /questionnaire-questions/reorder

Batch update `sort_order` for multiple questions.

**Body:** `{ "questions": [{ "id": 1, "sort_order": 0 }, { "id": 2, "sort_order": 1 }] }`

### POST /questionnaire-assignments

Assign a questionnaire to one or more users.

**Body:** `{ "questionnaire_id": 1, "user_ids": ["oXxxx", "oYyyy"], "assigned_by": "oZzzz" }`

- `user_ids` may contain a single ID or multiple.
- `assigned_by` must be a coach or admin user ID. The server enforces that coaches can only assign to their own clients.

### GET /questionnaire-assignments?user_id=&questionnaire_id=

List assignments. Filter by `user_id`, `questionnaire_id`, or both.

### GET /questionnaire-responses?assignment_id=&user_id=

List responses. Filter by `assignment_id` or `user_id`. Results include `prompt_zh`, `prompt_en`, and questionnaire name for display.

---

## 1. Core Ecosystem

### GET /users
Returns all users with latest biomarkers, Coach, and plan/report status.

### GET /notifications?openid={openid}
Fetches and clears (marks 'sent') pending notifications.

### POST /chat
Unified chat endpoint. Classifies intent and returns AI reply with relevant context.

### POST /biomarkers
Ingests raw biomarker data, runs calculations, and triggers report/plan generation.

---

## 2. Dots & Nutrition Management

### GET /dots-inventory
Returns the master list of all available Dot types (D01-D20).

### GET /my-cartridges?openid={openid}
Returns the user's currently active/empty cartridges with remaining dot counts.

### POST /cartridge-insert
Registers a new cartridge.
**Body:** `{ "openid", "nfc_tag_id", "dot_key" }` (e.g., `dot_key: "DOT01"`)

### POST /cartridge-remove
Marks a cartridge as removed.
**Body:** `{ "openid", "nfc_tag_id" }`

### POST /dispense
Records a dispensing event, deducting counts from active cartridges.
**Body:** `{ "openid", "slot", "date", "dispensed": { "DOT01": 4, ... } }`

### POST /formula-dots
Triggers LLM to generate a new 7-day personalized nutrition plan based on latest biomarkers.
**Body:** `{ "openid" }`

---

## 3. E-commerce & Store

### GET /store-items?all=true
Lists items for sale. `all=true` includes inactive items (Admin).

### GET /my-orders?openid={openid}
Returns order history for a specific user.

### GET /orders
(Admin) Returns the 200 most recent orders across the system.

### POST /store-items
(Admin) Create a new store item.
**Body:** `{ key_name, name_en, name_zh, price_cny, price_usd, ... }`

### POST /orders
Creates a new pending order.
**Body:** `{ "openid", "item_id", "quantity" }`

---

## 4. Kino Hardware System

### GET /kino-devices
Lists all registered reader units with usage stats.

### POST /kino-devices
Registers a new physical device.

### GET /kino-chip-batches
Lists all generated chip batches.

### GET /kino-chip-batches/:id/chips?page=1
Lists chips within a batch (paginated).

### GET /kino-chip-models
Lists every row in `kino_chip_models` with usage stats joined from `kino_chip_batches`.
**Response:** `{ success, models: [{ code, name, biomarker_keys, config, guide_video, guide_text, status, notes, created_at, updated_at, batch_count, chip_count }] }`

### POST /kino-chip-models
(Admin) Creates a new chip model. `code` is auto-uppercased and must match `^[A-Z0-9]{1,16}$`. `biomarker_keys` must be a non-empty array. `config` must be a JSON object.
**Body:** `{ code, name?, biomarker_keys, config, guide_video?, guide_text?, status?, notes? }`

### PUT /kino-chip-models/:code
(Admin) Partial update — only the fields supplied in the body are changed. `updated_at` is bumped automatically. `code` itself is immutable.

### DELETE /kino-chip-models/:code
(Admin) Deletes a chip model. Returns `409` if any `kino_chip_batches` row still references it (the FK would block the delete anyway; the handler precounts and returns a friendlier error).

### GET /kino-chip?chip_id=…
Looks up a chip by code and returns the scan/user state alongside the model's `biomarker_keys`, `chip_config`, `guide_video`, and `guide_text` (all joined through `kino_chips → kino_chip_batches → kino_chip_models`). Used by the Mini Program to drive scan UI per chip type.

### POST /kino-result
Finalizes a scan flow. Marks the chip as `used` and persists the final `bio_age`.

---

## 5. Academy (Knowledge Base)

### GET /academy/courses
Lists all educational courses (video/text).

### GET /academy/library
Lists downloadable PDFs and research papers.

### POST /academy/courses
(Admin) Upload new course metadata and link to OSS key.

---

## 6. User Engagement & Auth

### POST /health-advice
Deep-dive AI analysis of user's current health state with personalized suggestions.
**Body:** `{ "openid" }`

### POST /wx-login
Exchanges a WeChat JS-SDK code for an openid and session.
**Body:** `{ "code" }`

### POST /bind-phone
Binds a phone number to a user profile using a verification code.
**Body:** `{ "user_id", "code" }`

### GET /oss/presign?filename=x.jpg
Returns a temporary Aliyun OSS PUT URL for client-side uploads.

---

## 8. Health Plan System

See full system documentation: [`docs/architecture/health-plan-system.md`](../architecture/health-plan-system.md)

### GET /health-plan-templates

Returns all active plan templates. Add `?all=true` to include inactive templates (admin only). Add `?channel_id=N` to filter by channel.

### POST /health-plan-templates / PUT /health-plan-templates/:id

Create or update a plan template.

**Body:** `{ key_name, name_zh, name_en, desc_zh, desc_en, goal_zh, goal_en, duration_weeks, target_sub_ages, recommended_dot_ids, activity_guidance, milestones, sort_order }`

### DELETE /health-plan-templates/:id

Deletes a template. Returns `409` if any user is actively enrolled in a plan that references it.

### POST /health-plans

Enroll a user in a plan.

**Body:** `{ openid, template_id, plan_type, source }` where `source` is `'self'` | `'coach'` | `'ai'`.

- Captures baseline `bioage_profile` from the user's latest Kino chip scan into `baseline_data`.
- Returns `409` with `{ conflict: true, existing_plan_id }` if the plan slot is already occupied, allowing the client to offer a replace dialog.

### PUT /health-plans/:id

Update plan status or swap plan type.

**Body:** `{ status }` to change lifecycle state, or `{ plan_type }` to swap primary↔secondary (uses a DB transaction to avoid violating the unique partial index).

### POST /health-plans/:id/checkin

Record daily adherence. Idempotent — safe to resubmit for the same date.

**Body:** `{ openid, checkin_date, dots_taken, activities_done, notes }`

### POST /health-plans/:id/milestone

Attach a biomarker scan as a milestone snapshot.

**Body:** `{ openid, biomarker_id, milestone_index, label_zh, label_en }`

### GET /coach-client-plans?coach_id={id}

Returns all active health plans for every user assigned to the given coach.

---

## 7. Admin & Channel Management

(Specific documentation for payouts, commissions, and channel-scoped roles is available in `docs/architecture/role-system.md`)

- `GET /coach-earnings?coach_user_id={id}`
- `GET /channel-rewards-summary?channel_id={id}`
- `POST /generate-coach-payouts`
- `GET /admin-accounts`
- `POST /invitations` (Invite codes for new users/coaches)

### GET /channels/:id/rewards-config

Retrieves the effective rewards, commission rates, and exchange rates for a channel. It recursively traverses up the parent channel chain if `can_customize_rewards` is false.

### PUT /channels/:id/rewards-config

Updates a channel's commission config and referral rate overrides.
**Body:**
```json
{
  "commission_config": {
    "coach_chip_flat": 20,
    "coach_dot_pct": 12,
    "coach_subscription_pct": 18,
    "channel_chip_flat": 10,
    "channel_dot_pct": 5,
    "channel_subscription_pct": 6
  },
  "referral_commission_rate": 8
}
```

### PUT /channels/:id/rewards-permission

Allows a parent channel admin or superadmin to enable/disable custom rewards for a sub-channel.
**Body:** `{ "can_customize_rewards": true }`

---

## 8. Coach Groups

Manages clinic, studio, or group entities within a channel for performance snapshot aggregates.

### GET /api/coach-groups?channel_id={id}

Lists all coach groups registered under a channel.
**Response:**
```json
{
  "success": true,
  "groups": [
    {
      "id": 1,
      "channel_id": 5,
      "name": "Shanghai Central Clinic",
      "description": "Main clinic branch",
      "type": "clinic",
      "coach_count": 8
    }
  ]
}
```

### POST /api/coach-groups

Creates a new coach group under a channel.
**Body:** `{ "channel_id", "name", "description", "type" }`

### PUT /api/coach-groups/:id

Updates metadata for a coach group.
**Body:** `{ "name", "description", "type" }`

### DELETE /api/coach-groups/:id

Deletes a coach group. Coaches in this group have their `group_id` set to `NULL` automatically.

### GET /api/coach-group-kpis?group_id={id}&period={YYYY-MM}

Fetches aggregated CRM and performance metrics across all coaches in a group.

---

## 9. Digital Twin (Wearable Ingestion)

Allows time-series wearable and lifestyle metric uploads and queries the synchronized rolling twin.

### POST /health-events

Ingests a single health event (e.g. sleep record, manual activity log, weight).
**Body:**
```json
{
  "openid": "oXxx...",
  "category": "sleep",
  "source": "apple_health",
  "data_date": "2026-05-30",
  "recorded_at": "2026-05-30T07:00:00Z",
  "data": {
    "duration_minutes": 460,
    "sleep_score": 82,
    "hrv_avg_ms": 58,
    "resting_hr": 55
  },
  "external_id": "ah-sleep-102938"
}
```

### POST /health-events/sync

Batch ingests wearable data (up to 500 records). Automatically handles deduplication via `external_id`.
**Body:** `{ "openid", "events": [...] }`

### GET /health-events?openid={openid}&category={category}&limit=30

Queries the time-series event log for a user.

### GET /health-twin?openid={openid}

Retrieves the aggregated, rolling 7-day average health twin row for the user.
**Response:**
```json
{
  "success": true,
  "twin": {
    "user_id": "oXxx...",
    "avg_hrv_ms": 57.5,
    "avg_resting_hr": 56.2,
    "avg_sleep_hours": 7.4,
    "avg_sleep_score": 80.5,
    "avg_daily_steps": 8500,
    "latest_weight_kg": 72.5,
    "trend_data": {
      "hrv_trend": "improving",
      "sleep_trend": "stable"
    },
    "data_coverage": {
      "sleep": "2026-05-30",
      "vitals": "2026-05-30"
    }
  }
}
```

---

## 10. External Lab Integration (`nano-lab`)

Ingests clinical panel results via push webhook or FHIR models, triggering BioAge recalibration.

### POST /lab/webhook/:labName

Pushed directly by third-party laboratories. Normalizes variables using regional adapters.

### POST /health-reports

Stores raw observations or FHIR R4 Bundle reports.

### GET /health-reports?openid={openid}

Lists all lab-imported or uploaded health reports for a user.

### GET /health-reports/:id

Fetches a specific report with all its parsed observation measurements and values.

### POST /health-events/fhir

Directly ingests clinical records in FHIR R4 JSON format.

