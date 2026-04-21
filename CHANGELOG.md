# Changelog

All user-facing changes must be reflected in **both** `src/web/user-app` and `src/mini/user-miniapp`.

---

## [Unreleased]

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
