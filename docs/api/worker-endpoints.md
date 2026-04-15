# Worker API Endpoints

The `nano-worker` function handles all functional logic for the ecosystem.

## Accessing the API

### 1. Public API (Preferred)
Accessible directly via the main domain. This is the fastest route for external clients like simulators, mobile apps, or WeChat mini-programs.
*   **Base URL:** `https://nano.fros.cc/api`

### 2. Internal Legacy Proxy
Available for the Admin Dashboard to avoid CORS issues and leverage internal VPC performance.
*   **Base URL:** `https://nano.fros.cc/admin/api`

## Routing Summary

All paths below are relative to the Base URL (e.g., `GET /api/users`).

| Method | Path | Handler |
|---|---|---|
| `GET` | `/users` | List all users with latest biomarkers and coach |
| `GET` | `/notifications` | Fetch pending notifications for a user |
| `GET` | `/dots-inventory` | List all Dots cartridges |
| `GET` | `/phm-list` | List PHMs with customer counts |
| `POST` | `/chat` | Ingest biomarker data or send a chat message |
| `POST` | `/phm-instruction` | Send a PHM instruction to a user |
| `POST` | `/assign-phm` | Assign a PHM coach to a user |
| `POST` | `/users` | Create a new user |
| `PUT` | `/users/:id` | Update a user |
| `DELETE` | `/users/:id` | Delete a user |

---

## GET /users

Returns all users with their latest biomarker snapshot, biological age, assigned coach, and most recent nutrition plan and biological report.

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
      "phm_id": 1,
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

## GET /phm-list

Returns all PHMs with user counts.

**Response**: `{ "success": true, "phms": [ { "id", "name", "email", "phone", "user_count" } ] }`

---

## POST /chat

The main ingestion endpoint. Handles two flows depending on the body:

**Biomarker ingestion** (when `test_data` is present):
1. Upserts the user profile
2. Runs `BiomarkerEstimator` and `BioAgeCalculator`
3. Saves biomarker record
4. Generates a 7-day nutrition plan via DashScope LLM
5. Queues `biological_report` and `nutrition_plan` notifications

**Chat message** (when `message` is present):
1. Upserts the user profile
2. Fetches latest biomarker context
3. Calls DashScope LLM with system prompt
4. Queues `chat_reply` notification

**Request body**
```json
{
  "openid": "required",
  "nickname": "Nancy",
  "gender": "female",
  "birth_date": "1992-05-14",
  "language": "zh",
  "test_type": "kino_chip",
  "test_data": { "hsCRP": 1.38 },
  "tested_at": "2026-04-14T10:00:00Z",
  "message": "How is my health?"
}
```

**Response**: `{ "success": true, "user_id": 1 }`

---

## POST /phm-instruction

Inserts a formatted PHM instruction as a `pending` notification visible in the user's chat.

**Request body**: `{ "openid": "...", "instruction": "Drink more water." }`

**Response**: `{ "success": true }` or `{ "success": false, "error": "User not found" }` (404)

---

## POST /assign-phm

Assigns or unassigns a PHM coach to a user.

**Request body**: `{ "user_id": 1, "phm_id": 2 }` — set `phm_id` to `null` to unassign.

**Response**: `{ "success": true }`

---

## POST /users

Creates a new user.

**Request body**: `{ "wechat_openid": "required", "nickname", "gender", "birth_date", "language", "phm_id" }`

**Response**: `{ "success": true, "id": 18 }` — returns 400 if `wechat_openid` is missing.

---

## PUT /users/:id

Updates an existing user's profile fields.

**Request body**: `{ "nickname", "gender", "birth_date", "language", "phm_id" }`

**Response**: `{ "success": true }`

---

## DELETE /users/:id

Deletes a user by ID.

**Response**: `{ "success": true }`
