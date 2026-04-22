# Changelog

All user-facing changes must be reflected in **both** `src/web/user-app` and `src/mini/user-miniapp`.

---

## [Unreleased]

### Added
- **Nano Mini App — Admin panel** (`src/mini/nano-miniapp/pages/admin/`): full four-tab control panel (Users, Coaches, Dots, Store) accessible via ⚙ icon in the nano miniapp menu. Features per-tab card lists, bottom-sheet add/edit forms, bilingual dot names, and ingredient editing (name + mg rows with add/remove).
- **Nano Mini App — Formula generation flow**: "Formula my dots" chat tool now calls `POST /api/formula-dots`, shows a generating message, then a completion message with a tappable action card that navigates directly to the Dots tab.
- **Nano Mini App — Action message type**: chat messages now support `role: 'action'` cards rendered as tappable banners; wired to `handleMsgAction` which routes to the appropriate tab.
- **Backend — `POST /api/formula-dots`** (worker): generates a 7-day personalised Waven Dots dispensing plan and saves it as a `nutrition_plan` notification.
  - LLM (qwen-plus via DashScope) receives the formulary (all dots with ingredient mg data), the user's latest kino-chip biomarker values, and bio-age profile.
  - Prompt instructs the model to output one `DXX:N` count line per dot; explicit reference ranges (hsCRP, IL-6, GDF-15, GA, Cystatin-C) and a scoring guide (3–4 normal · 5–7 elevated · 8–10 critical) are included so counts vary by clinical need.
  - Worker parses the `DXX:N` lines; any dot not covered by the LLM falls back to a deterministic biomarker-severity score.
  - The resulting per-dot counts are passed to `_generatePlanText` which produces the 7-day calendar text in the `Dxx Month D, Weekday: Morning DXXxN … Evening DXXxN …` format consumed by `parsePlan` in the miniapp.
- **Backend — deterministic fallback scorer** (`_scoreMarker`, `_calcDotCounts`, `_generatePlanText` in worker): scores each biomarker on a 0–3 severity scale and maps it to per-dot counts (base 3, +score per relevant marker, clamped 1–10); used when the LLM output is missing a dot key.
- **Login screen**: replaced placeholder "W" ring with `waven-logo-icon.png`.

### Changed
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
