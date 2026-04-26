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

All paths below are relative to the Base URL (e.g., `GET /api/users`).

| Method | Path | Handler |
|---|---|---|
| `GET` | `/users` | List all users with latest biomarkers and Coach |
| `GET` | `/notifications` | Fetch pending notifications for a user |
| `GET` | `/biomarkers` | Fetch biomarker records for a user |
| `GET` | `/dots-inventory` | List all Dots cartridges |
| `GET` | `/coach-list` | List Coaches with user counts |
| `GET` | `/kino-devices` | List all Kino devices with stats |
| `GET` | `/kino-chip` | Look up a Kino chip scan by chip code |
| `GET` | `/kino-chip-batches` | List all chip batches with counts |
| `GET` | `/kino-chip-batches/:id/chips` | List chips in a batch (paginated) |
| `POST` | `/biomarkers` | Ingest Kino chip biomarker data, run BioAge calculation |
| `POST` | `/chat` | Send a chat message |
| `POST` | `/kino-devices` | Register a new Kino device |
| `POST` | `/kino-result` | Mark a chip scan complete and persist the result |
| `POST` | `/kino-chip-batches` | Create a batch and generate chip codes |
| `POST` | `/coach-instruction` | Send a Coach instruction to a user |
| `POST` | `/assign-coach` | Assign a Coach to a user |
| `POST` | `/users` | Create a new user |
| `PUT` | `/kino-devices/:id` | Update a Kino device |
| `PUT` | `/kino-chip-batches/:id` | Update a chip batch (model/notes) |
| `PUT` | `/users/:id` | Update a user |
| `DELETE` | `/kino-devices/:id` | Remove a Kino device |
| `DELETE` | `/kino-chip-batches/:id` | Delete a batch (blocked if any chip is used) |
| `DELETE` | `/users/:id` | Delete a user |

---

## GET /users

Returns all users with their latest biomarker snapshot, biological age, assigned Coach, and most recent nutrition plan and biological report.

**Response**
```json
{
  "success": true,
  "users": [
    {
      "id": 1,
      "user_id": "...",
      "nickname": "Nancy",
      "birth_date": "1992-05-14T...",
      "language": "zh",
      "gender": "female",
      "coach_id": 1,
      "bio_age": 34.4,
      "bio_data": { ... },
      "coach_name": "Pin",
      "latest_plan": "...",
      "latest_report": "...",
      "chrono_age": 33
    }
  ]
}
```

---

## GET /notifications?openid={openid}

Fetches all pending notifications for the given WeChat openid and marks them as `sent`.

**Query params**: `openid` — WeChat openid of the user.

**Response**
```json
{
  "success": true,
  "notifications": [
    { "id": 5, "content": "...", "notification_type": "chat_reply" }
  ]
}
```

---

## GET /dots-inventory

Returns all Dots cartridges.

**Response**: `{ "success": true, "dots": [ { "id", "key_name", "name", "color", ... } ] }`

---

## GET /coach-list

Returns all Coachs with user counts.

**Response**: `{ "success": true, "coachs": [ { "id", "name", "email", "phone", "user_count" } ] }`

---

## POST /chat

Sends a chat message and returns an AI reply via DashScope LLM. Classifies the intent first, then fetches only the data that intent requires (biomarkers, dots, nutrition plan, weight history).

1. Upserts the user profile
2. Classifies intent (`casual_chat`, `biomarker_question`, `nutrition_question`, etc.)
3. Fetches context data for the classified intent
4. Calls DashScope LLM with the appropriate system prompt
5. Queues a `chat_reply` notification

**Request body**
```json
{
  "openid": "required",
  "message": "How is my health?"
}
```

**Response**: `{ "success": true, "user_id": "wx_abc123" }`

---

## POST /coach-instruction

Inserts a formatted Coach instruction as a `pending` notification visible in the user's chat.

**Request body**: `{ "openid": "...", "instruction": "Drink more water." }`

**Response**: `{ "success": true }` or `{ "success": false, "error": "User not found" }` (404)

---

## POST /assign-coach

Assigns or unassigns a Coach to a user.

**Request body**: `{ "user_id": 1, "coach_id": 2 }` — set `coach_id` to `null` to unassign.

**Response**: `{ "success": true }`

---

## POST /users

Creates a new user.

**Request body**: `{ "wechat_openid": "required", "nickname", "gender", "birth_date", "language", "coach_id" }`

**Response**: `{ "success": true, "id": 18 }` — returns 400 if `wechat_openid` is missing.

---

## PUT /users/:id

Updates an existing user's profile fields.

**Request body**: `{ "nickname", "gender", "birth_date", "language", "coach_id" }`

**Response**: `{ "success": true }`

---

## DELETE /users/:id

Deletes a user by ID.

**Response**: `{ "success": true }`

---

## Kino Simulator Endpoints

These four endpoints power the Kino Simulator flow inside the WeChat Mini Program (`pages/main/`). The sequence is: **kino-chip → biomarkers → biomarkers GET (fallback) → kino-result**.

---

## GET /kino-chip?chip_id={chip_id}

Looks up a Kino chip by its ID and returns the linked user and current scan status. Called immediately after the simulator scans a chip QR code.

**Query params**: `chip_id` — chip identifier (must start with `MVNS` or `KINO`).

**Response — chip found**
```json
{
  "found": true,
  "used": false,
  "scan_id": 42,
  "user_id": "wx_abc123",
  "nickname": "Nancy",
  "scan_status": "pending"
}
```

**Response — chip not registered**
```json
{ "found": false }
```

`used: true` means `scan_status` is `completed` — the simulator blocks re-analysis on a used chip.

---

## POST /biomarkers (Kino ingestion)

Submits biomarker data captured by the Kino chip. Runs `BiomarkerEstimator` and `BioAgeCalculator`, stores a biomarker record, generates a 7-day nutrition plan via LLM, and queues `biological_report` and `nutrition_plan` notifications.

**Request body**
```json
{
  "openid": "wx_abc123",
  "test_type": "kino_chip",
  "test_data": { "hsCRP": 1.38 }
}
```

`test_type` defaults to `kino_chip` if omitted.

**Response**
```json
{
  "success": true,
  "user_id": "wx_abc123",
  "biomarkers": { "hsCRP": 1.38, "GDF-15": 820, "CD38": 1.2, "GA": 14.1, "CystatinC": 0.85, "IL-6": 2.4 },
  "bioage_profile": {
    "BioAge": 36.2,
    "ChronoAge": 33,
    "SubAges": {
      "CellularAge": 37.1,
      "MetabolicAge": 34.8,
      "MicroVascularAge": 35.5,
      "ResilienceAge": 37.4
    }
  }
}
```

If `bioage_profile` is absent from the response (e.g. LLM timeout), the simulator falls back to `GET /biomarkers`.

---

## GET /biomarkers?openid={openid}

Fetches all biomarker records for a user, newest last. Used by the simulator as a fallback when `POST /chat` does not return `bioage_profile` inline.

**Query params**: `openid` — WeChat openid or `user_id`.

**Response**
```json
{
  "success": true,
  "records": [
    {
      "id": 12,
      "test_type": "kino_chip",
      "bio_age": 36.2,
      "tested_at": "2026-04-26T08:00:00Z",
      "data": {
        "biomarkers": { "hsCRP": 1.38 },
        "bioage_profile": { "BioAge": 36.2, "SubAges": { "CellularAge": 37.1 } }
      }
    }
  ]
}
```

The simulator reads `records[records.length - 1].data.bioage_profile` for the latest result.

---

## POST /kino-result

Marks a chip scan as `completed` and persists the final biomarker + bioage result. Called at the end of the simulator analysis flow.

**Request body**
```json
{
  "chip_id": "KINO-0042",
  "bio_age": 36.2,
  "data": {
    "biomarkers": { "hsCRP": 1.38 },
    "bioage_profile": { "BioAge": 36.2, "SubAges": { "CellularAge": 37.1 } }
  }
}
```

**Response**
```json
{
  "success": true,
  "scan_id": 42,
  "biomarker_id": 12,
  "user_id": "wx_abc123"
}
```

Returns an error if no registered scan exists for the `chip_id` (i.e. `GET /kino-chip` was never called first).

---

## Kino Devices

### GET /kino-devices

Returns all registered Kino devices with coach/channel assignment and usage stats.

**Response**
```json
{
  "success": true,
  "devices": [
    {
      "id": 1,
      "serial_number": "KNO-2024-0001",
      "name": "Clinic Unit A",
      "status": "active",
      "notes": "",
      "coach_id": 2,
      "coach_name": "Pin",
      "channel_id": 1,
      "channel_name": "Shanghai",
      "test_count": 42,
      "last_used_at": "2026-04-26T08:00:00Z",
      "registered_at": "2026-01-01T00:00:00Z"
    }
  ]
}
```

### POST /kino-devices

Registers a new Kino device.

**Request body**
```json
{
  "serial_number": "KNO-2024-0001",
  "name": "Clinic Unit A",
  "coach_id": 2,
  "channel_id": 1,
  "status": "active",
  "notes": ""
}
```

`serial_number` is required and auto-uppercased. `coach_id` and `channel_id` are optional.

**Response**: `{ "success": true, "id": 1 }`

### PUT /kino-devices/:id

Updates a device's name, assignment, status, or notes. `serial_number` cannot be changed after registration.

**Request body**: `{ "name", "coach_id", "channel_id", "status", "notes" }`

**Response**: `{ "success": true }`

### DELETE /kino-devices/:id

Removes a device. Historical biomarker records retain the `kino_device_id` value (set to NULL via FK `ON DELETE SET NULL`).

**Response**: `{ "success": true }`

---

## Kino Chip Batches

### GET /kino-chip-batches

Returns all chip batches with aggregate counts.

**Response**
```json
{
  "success": true,
  "batches": [
    {
      "id": 1,
      "prefix": "KNC12345678",
      "model": "K2",
      "quantity": 100,
      "notes": "",
      "created_at": "2026-04-26T08:00:00Z",
      "total_chips": 100,
      "available": 98,
      "used": 2,
      "damaged": 0
    }
  ]
}
```

### GET /kino-chip-batches/:id/chips

Returns a paginated list of chips in a batch with their scan status.

**Query params**: `page` (default `1`), `limit` (default `50`, max `100`)

**Response**
```json
{
  "success": true,
  "chips": [
    {
      "id": 1,
      "chip_code": "KNC12345678-0001",
      "status": "available",
      "created_at": "2026-04-26T08:00:00Z",
      "scan_status": null,
      "user_id": null,
      "nickname": null
    }
  ],
  "total": 100,
  "page": 1,
  "limit": 50
}
```

### POST /kino-chip-batches

Creates a batch and auto-generates all chip codes.

**Request body**
```json
{
  "prefix": "KNC12345678",
  "model": "K2",
  "quantity": 100,
  "notes": ""
}
```

`prefix` must match `KNC\d{8}` (generated client-side by the admin panel). `quantity` must be 1–9,999. Chips are inserted in bulk within a single DB transaction.

**Response**: `{ "success": true, "id": 1, "prefix": "KNC12345678", "quantity": 100 }`

### PUT /kino-chip-batches/:id

Updates a batch's model or notes. `prefix` and `quantity` are immutable after creation.

**Request body**: `{ "model": "S1", "notes": "Replacement batch" }`

**Response**: `{ "success": true }`

### DELETE /kino-chip-batches/:id

Deletes a batch and all its chips via CASCADE. Blocked if any chip in the batch has `status = 'used'`.

**Response**: `{ "success": true }` or `{ "success": false, "error": "Cannot delete a batch with used chips" }`
