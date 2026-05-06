# Changelog

All user-facing changes must be reflected in **both** `src/web/user-app` and `src/mini/user-miniapp`.

---

## [Unreleased]

### Added
- **NL2SQL tool call in chat** — the worker's chat LLM can now query the user's health data dynamically when the pre-loaded context isn't enough. An agentic loop (max 4 iterations) offers the model a `query_database` tool; when called, the worker validates the SQL is a `SELECT` with `$1` for `user_id`, runs it against PolarDB, and feeds the rows back. Supports `biomarkers`, `nutrition_schedules`, `reminders`, and `chat_messages`. No new routes, no schema changes — change is entirely within `handlePostChat` in `src/functions/worker/index.js`.
- **Tag-driven biomarker estimator** — the `BiomarkerEstimator` now consumes a registry-defined tag set so its 6 estimated biomarkers respond to the user's actual nutrition compliance, weight trend, and prior-scan trajectory instead of just age + BMI. The estimator stays deterministic and synchronous — no LLM on the hot path.
  - **New** `src/functions/worker/lib/estimator/tagRegistry.js`: controlled vocabulary mapping each tag to one or more biomarker adjustments (`['*' | '+', n]`). Includes Chinese-tag aliases (`糖尿病` → `diabetes_diagnosed`).
  - **New** `src/functions/worker/lib/estimator/tagDerivation.js`: pure `deriveTags({ history, weightHistory, compliance, selfReported })` returning a deduped tag set. Rules: per-pathway compliance ≥ 0.7 / ≤ 0.3 → "low/high load" tag; ≥ ±2 kg over 90 d → weight tag; clear hsCRP slope across ≥ 3 prior scans → trajectory tag.
  - **Refactor** `BiomarkerEstimator.js`: tag adjustments via generic registry loop (deletes inline `糖尿病` branches). Constructor accepts `{ seed }`; noise switches to a seeded mulberry32 PRNG so the same `userId + scan-date` reproduces identical estimates across retries (required for trajectory tags not to chase their own noise). v3 noise model (Box-Muller, capped) is now adopted in the worker copy too — the worker was previously running a simpler uniform-noise version.
  - **Wired in** `handlePostBiomarkers` (`src/functions/worker/index.js`): new `fetchTagDerivationContext(user_id)` runs three queries — last 5 `kino_chip` rows, last 10 `body_composition` rows, and a 14-day `nutrition_schedules ⨝ dots` per-pathway compliance aggregate keyed by `dots.sub_age_target`. Derived tags + a deterministic seed (`user_id:YYYY-MM-DD`) are passed to the estimator and persisted into `biomarkers.data.tags`. Each derivation logs a JSON `biomarker_tags_derived` line for production audit.
  - **Tests** `tests/tagRegistry.test.js`, `tests/tagDerivation.test.js`, `tests/biomarkerEstimator.test.js`: 29 unit tests covering registry validity, threshold rules, weight-trend boundaries, slope detection, dedup, alias normalization, seed determinism (100-run identity), and tag-effect direction. Run with `node --test tests/*.test.js`.
- **Store item images** — each store item can now have a product picture uploaded from the admin panel.
  - **DB migration** `temp/migration_store_items_image.sql`: adds `image_url TEXT` column to `store_items`.
  - **Worker** `GET /api/store-items` returns `image_url`; `POST` and `PUT` accept and persist `image_url`.
  - **Admin panel** — Store → Items tab: new image column shows a 40×40 thumbnail (or a placeholder icon). Add/Edit item modal has an image upload zone: picks a PNG/JPG, gets a presigned OSS PUT URL (category `store`), uploads directly from the browser, and stores the 10-year presigned GET URL in `image_url`. Existing image is previewed with a remove button.
- **Kino chip models registry** — first slice of bringing the physical Kino One device onto the nano flow. Replaces the per-batch free-text `model` string with a real per-model record that carries the chip's declared biomarker outputs and full physical scan config.
  - **DB migration** `temp/migration_kino_chip_models.sql`: new `kino_chip_models` table (`code` PK, `name`, `biomarker_keys TEXT[]`, `config JSONB`, `guide_video`, `guide_text`, `status`, `notes`, timestamps). Seeds K2 (`biomarker_keys=['hsCRP']`) with the verbatim card_config currently used by kone (scan_ppmm=40, 4-region top_list with hsCRP on id0, piecewise var_list, cut_off1=-10, cut_off2=300, scope=0.2, etc., supabase row metadata stripped). Normalizes existing `kino_chip_batches.model` values to `'K2'` and adds the `kino_chip_batches_model_fkey` foreign key.
  - **Worker** `GET /api/kino-chip` (`handleGetKinoChip`) now joins through `scans → kino_chips → kino_chip_batches → kino_chip_models` and returns `model`, `biomarker_keys`, `chip_config`, `guide_video`, `guide_text` alongside the existing user-linkage fields. Also includes `birth_date`, `chrono_age` (computed via existing `calculateAge`), and `gender` so the device can render the patient header without a second round-trip. Joins are LEFT so legacy/unmodeled chips still resolve with the model-side fields nulled. The `chip_config` JSONB blob is byte-compatible with the supabase `card_config` shape kone already deserializes.
- **Academy tab** in the web admin panel with two subtabs and Aliyun OSS-backed file storage:
  - **Courses subtab**: upload and manage video courses — admin gets a presigned OSS PUT URL, uploads the video directly from the browser (with progress bar), and the course record (title, description, status, OSS key) is saved to `academy_courses`. Published/draft status toggle; videos can be viewed via a time-limited OSS GET URL. Edit and delete with automatic OSS object cleanup.
  - **Library subtab**: upload and manage Markdown documents — same direct-to-OSS upload pattern, saved to `academy_library`. Documents can be opened directly from the admin via signed URL.
  - **DB migration** `temp/migration_academy.sql`: new `academy_courses` table (id, title, description, oss_key, thumbnail_key, status, sort_order, timestamps) and `academy_library` table (id, title, oss_key, file_size, created_at).
  - **OSS library** `src/functions/worker/lib/oss.js`: wraps `ali-oss` — `generateKey`, `generatePresignedPutUrl`, `generatePresignedGetUrl`, `deleteObject`. Requires env vars `OSS_REGION`, `OSS_ACCESS_KEY_ID`, `OSS_ACCESS_KEY_SECRET`, `OSS_BUCKET`.
  - **Worker API routes**: `GET /oss/presign` (presigned PUT or GET URL), `GET /academy/courses`, `POST /academy/courses`, `PUT /academy/courses/:id`, `DELETE /academy/courses/:id`, `GET /academy/library`, `POST /academy/library`, `PUT /academy/library/:id`, `DELETE /academy/library/:id`.
- **Invitation system**: coaches and channel admins can generate shareable invite codes; new users must enter a valid code to register.
  - **DB migration** `migration_add_invitations.sql`: new `invitations` table (code, created_by, channel_id, type, max_uses, use_count, is_active, expires_at); new `invitation_uses` table for per-redemption attribution; `invited_by_invitation_id` FK added to `users`.
  - **Worker API**: `GET /api/invitations` (filterable by `channel_id` or `created_by`), `POST /api/invitations` (generates a random 6-char uppercase code), `DELETE /api/invitations/:id` (soft-deactivates); `POST /api/wx-login` updated — new users without an invite code receive `{ new_user: true }` instead of being auto-created; an invalid code returns `{ invalid_code: true }`; valid codes resolve the channel, optionally assign the creating coach, increment `use_count`, insert an `invitation_uses` row, and set `users.invited_by_invitation_id`.
  - **Mini-app login page** (`pages/login`): auto-login now shows an invite code input card for new users; user types the code and taps **加入 Nano**; invalid code shows inline error; users arriving via `?invite=CODE` deep-link bypass the input step entirely.
  - **Coach panel** (`pages/coach`): new **邀请码 / Invite Codes** tab alongside the existing Clients tab; coaches can generate their own codes (`type: 'coach'`), copy the mini-program path to clipboard, and deactivate codes; code fetched filtered by `created_by`.
  - **Channel admin panel** (`pages/admin`): new **邀请 / Invites** tab; channel admins generate codes scoped to their channel (`type: 'channel'`).
  - **Super admin panel** (`pages/superadmin`): new **邀请 / Invites** tab showing all platform codes with channel name and creator; **Generate Invite** button on each channel card; deactivate from list.
- **Dots tab moved to Super Admin**: removed from Channel Admin panel (`pages/admin`) and added to Super Admin panel (`pages/superadmin`) — channels should not modify the platform formula.
- **Kino Simulator passcode bypass for superadmin**: users with the `superadmin` role skip the passcode and open the simulator directly from the menu.

### Changed
- **User deletion blocked when extra roles are present**: attempting to delete a user who holds any role beyond `user` now shows an error in both the mini-app Channel Admin page and the web admin panel, requiring all elevated roles to be removed first.
- **Login screen**: new users no longer auto-register on first open — registration now requires a valid invite code.
- **Top app header banner** (`pages/main`): increased padding, logo size, and font sizes to better balance with the bottom tab bar.

### Fixed
- **Kino Simulator — silent "Failed" status with working chips** (`src/mini/nano-miniapp/pages/main/main.js`): `bmLabels` and `subAgeLabels` were referenced in `_runKinoAnalysis` but never defined in either the `zh` or `en` translation objects. Every successful chip scan threw a TypeError when building the biomarker display list, which was silently caught and set `kinoSimStatus: 'failed'` with no toast. Added both objects to both language blocks.
- **Login — existing sessions forced through re-auth on every launch** (`src/mini/nano-miniapp/pages/login/login.js`): the login page always called `wxLogin()` on every app start, even when a valid user was already in `app.globalData`. If the server was temporarily unavailable (cold start, transient error), users with valid sessions were locked out. `onLoad` now short-circuits to `main` when a session is already present and no `invite`/`coach_id` deep-link params are present.
- **Role system**: users can hold multiple roles simultaneously (`user`, `coach`, `admin`, `superadmin`).
  - **DB migration** `migration_add_roles.sql`: `roles TEXT[]` on `users` (default `{user}`); `user_id` FK on `coaches` to link a WeChat identity; GIN index on roles; Pin and echo seeded as superadmins.
  - **Worker API**: `handleWxLogin` now returns `roles` on the user object and fetches the `coach` record when the user has the coach role; `handleGetUsers` includes `roles`; `handlePutUser` accepts `roles`; `handlePostCoaches`/`handlePutCoach` accept `user_id` and auto-manage the `coach` role; new scoped endpoints `GET /channel-users/:id`, `GET /channel-coaches/:id`, `GET /coach-users/:id`.
  - **Mini-app global state**: `app.globalData` now holds `coach` (set at login, persisted to `nano_coach`).
  - **Mini-app header menu** (`pages/main`): shows **Coach Panel**, **Channel Admin**, and **Super Admin** links conditionally based on `user.roles`.
  - **New `pages/coach/coach`**: coach dashboard — lists assigned clients with bio/chrono age chips, client detail overlay with latest biomarkers, send health instruction to any client.
  - **Rebuilt `pages/admin/admin`**: now role-gated on `onLoad` (redirects if user lacks `admin`/`superadmin` role); data scoped to the user's own channel via `/channel-users/:id` and `/channel-coaches/:id`.
  - **New `pages/superadmin/superadmin`**: platform-wide panel — Channels tab (full CRUD), Users tab (all users with channel + roles display, inline role-management modal), Coaches tab (all coaches with channel and linked-user display).
- **Multi-channel support**: distribution channels (e.g. Nanovate, Aeviva) with per-channel branding (name, logo). distribution channels (e.g. Nanovate, Aeviva) with per-channel branding (name, logo).
  - **DB migration** `migration_add_channels.sql`: new `channels` table; `channel_id` FK added to `coaches` and `users`; existing rows backfilled to `nanovate`.
  - **Worker API**: `GET/POST /channels`, `PUT/DELETE /channels/:id`; all user and coach CRUD endpoints accept `channel_id`; `GET /users` and `GET /coach-list` return `channel_name` and `channel_logo_url`; `POST /wx-login` accepts optional `coach_id` (from deep-link invite), resolves channel from coach, and returns `{ user, channel }`.
  - **Admin panel**: new **Channels** tab (CRUD); channel badge column in Users and Coaches tables; channel selector in Add/Edit modals for both users and coaches.
  - **Mini-app login**: reads `coach_id` from URL params (deep-link onboarding), passes to `wx-login`, stores returned `channel` in `globalData` and local storage.
  - **Mini-app header**: displays `channel.name | username` and `channel.logo_url` (falls back to Waven logo if not set).

### Changed
- **Waven Dots Payload Update**: each dot is now 40mg (previously 16mg).
  - **Database — `dots` table**: scaled all `mg` values in `ingredients` and `ingredients_zh` columns by 2.5x.
  - **AI Prompts**: updated `systemChat.js`, `systemNutrition.js` (worker), and `systemNutrition.js` (dispatcher) to reflect the new 40mg payload per dot.
- **"营养点" renamed to "原粒"** throughout nano-miniapp admin panel and web admin panel.
- **Admin panel coach label**: Chinese label updated to "教练".
- **Admin panel tab text**: inactive tabs use `#7A9ABF` at weight 500; active tab uses `#A0B4FF` at weight 700 for clearer visibility.
- **`prompts/systemNutrition.js`** rewritten: LLM now outputs only `DXX:N` count lines (not a full 7-day text block), with explicit biomarker reference ranges and a clear scoring guide; 7-day calendar is assembled in code from those counts.
- **`POST /api/formula-dots`** model bumped from `qwen-turbo` to `qwen-plus` for better instruction-following on the structured count output.
- Dot `ingredients` / `ingredients_zh` columns now included in `PUT /api/dots` and `POST /api/dots` upsert queries; stored as JSONB `[{name, mg}]` arrays.

### Fixed
- Chat scroll: switched from `scroll-into-view` to alternating `scroll-top` (999998/999999) via `wx.nextTick` so the view always lands at the last message.
- Admin dots edit modal: changed `max-height` → `height: 88vh` on the bottom sheet so flex children (including ingredient rows) can scroll correctly.
- Modal background scroll bleed: `catchtouchmove="noop"` added to both overlay and panel in admin.wxml.
- Ingredient display showing `[object Object]`: fixed `_ingrToArr` and save path in admin.js to correctly handle the `[{name, mg}]` array format.
- `handlePostFormulaDots`: `getNowShanghai()` returns a Luxon DateTime; changed `.toISOString()` → `.toISO()` (Luxon API) so the start date is correctly derived instead of throwing and silently returning the old plan.

---

## [Unreleased — pre-refactor]

### Added
- **Store — Mini App:** New Store tab (fourth tab) in the WeChat Mini Program. Products are fetched from `GET /api/store-items`. Tapping a product shows a confirmation modal; confirming posts an order to `POST /api/orders`. Bilingual display (zh/en); language-toggle re-maps labels from cached API data without a second request. Loading spinner and empty state included.
- **Store — Admin Panel:** New "Store" section in the admin panel sidebar (between Dots and Simulators), with two subtabs:
  - *Items:* full CRUD for store products — bilingual name/description/unit, CNY/USD pricing, tag (Best Seller / Value Pack), sort order, active toggle.
  - *Orders:* table of all orders with user, item, quantity, price, and an inline status selector (Pending → Confirmed → Shipped → Delivered → Cancelled).
  - Four stat cards: total items, active items, total orders, pending orders.
- **Backend — Store APIs** (worker):
  - `GET /api/store-items` — active items for the Mini App; pass `?all=true` to include inactive items (used by admin).
  - `POST /api/store-items`, `PUT /api/store-items/{id}`, `DELETE /api/store-items/{id}` — item CRUD.
  - `GET /api/orders` — all orders joined with user nickname and item names.
  - `POST /api/orders` — place an order; snapshots item price at time of purchase.
  - `PUT /api/orders/{id}` — update order status.
- **Database** (`src/schemas/migration_store.sql`): `store_items` and `orders` tables; seeded with three initial products (Kino chip ×1, Kino chip ×3, Waven Dots monthly).
- WeChat miniapp (`src/mini/user-miniapp`) — full clone of user-app with login, chat, health, and dots tabs.
- Health conditions onboarding step (miniapp): multi-select question 「您是否曾被诊断/体检出以下方面的问题？」with 9 options (血糖高, 血压高, 血脂高, 胆固醇高, 心脏问题, 痛风或尿酸高, 肾病, 睡眠不足, 其他). Runs after body composition; shown once and skipped on subsequent logins. Answers saved to `users.bio_data.health_conditions` (string array).
- `src/schemas/bio-data.schema.json` — JSON Schema documenting all known keys for `users.bio_data`.

### Changed
- `handleWxLogin` (worker) — returns `bio_data` in the user object so the miniapp can detect whether conditions have already been collected.
- `handlePutUser` (worker) — now accepts a `bio_data` field and merges it into the column using JSONB `||`, leaving unrelated keys untouched.

### Fixed
- Miniapp name input height: added `line-height`, `min-height`, `box-sizing` to `.ob-input` so text is fully visible.
- Miniapp height/weight sliders: added `bindchanging` so the displayed value updates in real time while dragging.
- Miniapp weight display: weight always shows one decimal place (e.g. `65.0`) to prevent digit-count jumping while sliding.

---

## [0.5.0] — 2026-04-20

### Added
- Dots / nutrition tab in user-app and miniapp: displays daily morning/evening supplement plan parsed from `/api/nutrition-plan`
- Chat context enriched with dots formulary and nutrition plan data

### Fixed
- Tab reload issue in user-app: all three tabs are now always mounted to preserve scroll and polling state
- `body_composition` record saving

---

## [0.4.0] — 2026-04-10

### Added
- Bio age and chrono age comparison chips on health tab hero section
- Sub-age grid (Resilience, Cellular, Metabolic, Micro-Vascular) on health tab

---

## [0.3.0] — 2026-04-05

### Added
- i18n: full English / Chinese toggle on login screen; language follows user profile setting
- Tabbed layout: Chat, Health, Dots bottom navigation

---

## [0.2.0] — 2026-03-20

### Added
- User app initial release (`src/web/user-app`): phone login, onboarding flow (name → gender → birthday → body), chat with AI polling

---

## How to update both platforms

When making a change, work through this checklist:

- [ ] `src/web/user-app/src/App.jsx` — React web app
- [ ] `src/mini/user-miniapp/pages/main/main.js` — miniapp logic
- [ ] `src/mini/user-miniapp/pages/main/main.wxml` — miniapp markup
- [ ] `src/mini/user-miniapp/pages/main/main.wxss` — miniapp styles
- [ ] `src/mini/user-miniapp/pages/login/login.js` — if login flow changes
- [ ] Add an entry to this file under `[Unreleased]`
