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
| `GET` | `/kino-devices` | Kino | List Kino devices |
| `GET` | `/kino-chip` | Kino | Look up chip scan (joins model config) |
| `GET` | `/kino-chip-batches` | Kino | List chip batches |
| `GET` | `/kino-chip-models` | Kino | List chip models with usage counts |
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

## 7. Admin & Channel Management

(Specific documentation for payouts, commissions, and channel-scoped roles is available in `docs/architecture/role-system.md`)

- `GET /coach-earnings?coach_user_id={id}`
- `GET /channel-rewards-summary?channel_id={id}`
- `POST /generate-coach-payouts`
- `GET /admin-accounts`
- `POST /invitations` (Invite codes for new users/coaches)
