# Changelog

All user-facing changes must be reflected in **both** `src/web/user-app` and `src/mini/user-miniapp`.

---

## [Unreleased]

### Added

- **User web app — full feature parity with miniapp (all 4 phases)** (`src/web/user-app/src/`)

  Refactored from a single 1,585-line `App.jsx` into a modular structure and added Plans, Store, Events, Kino scan, and Health Reports. App now has 6 tabs: Chat, Health, Dots, Plans, Store, Learn.

  **Architecture changes:**
  - `App.jsx` → root shell only (~120 lines), imports from tab files
  - `i18n.js` — all bilingual strings (zh/en) extracted into one place
  - `utils.js` — shared helpers (`chronoAge`, `fmtDate`, `fmtDateTime`, `bioAgeColor`, `BM_META`)
  - `components/LoginScreen.jsx`, `components/Sparkline.jsx`, `components/Widgets.jsx` (DatePickerWidget, NameInputWidget, BodySliderWidget, LangToggle)
  - `tabs/ChatTab.jsx`, `tabs/HealthTab.jsx`, `tabs/DotsTab.jsx`, `tabs/AcademyTab.jsx` — existing features
  - `tabs/PlansTab.jsx` — health plan templates browser, active plan check-in with progress tracking, events sign-up/cancel
  - `tabs/StoreTab.jsx` — product grid with cart, shipping address form, CNY/credits payment, order history, credits balance + history
  - Shared modal system (`.modal-overlay`, `.modal-card`) used by Kino scan, checkin, checkout

  **Phase 4 features added to HealthTab:**
  - Kino chip link button (`scanChip`) → modal for manual chip code entry, calls `POST /api/kino-scan`
  - Health report generation button → calls `POST /api/health-reports`, lists past reports with markdown viewer

  **Backend change (`src/functions/worker/index.js`):**
  - `GET /events` now accessible without admin auth when `openid` query param is present; automatically maps `openid` → `user_id` for the signed_up field

### Added

- **Store cart — inline shipping form with WeChat address pre-fill** (`app.json`, `pages/main/main.{js,wxml,wxss}`, `handlers/chat.js`, `docs/architecture/orders-fulfillment.md`)

  The store cart now collects shipping details via an editable 收货信息 form inside the cart sheet, replacing reliance on the deprecated-fragile `wx.chooseAddress()` as the sole path. Recipient name pre-fills from `user.nickname` and phone from `user.phone`; the WeChat address book is an optional pre-fill helper via a 「使用微信地址」 button.

  **What changed:**
  - Cart sheet renders a name/phone/address form *inside* the `scroll-view` (so it scrolls with items while 结算 stays pinned). Fields fixed for text clipping (`box-sizing: border-box`, `line-height`, `min-height`).
  - `handleCheckout`: validates the form and submits directly; when the address is empty it pre-fills name/phone and calls `fetchWechatAddress()`. `fetchWechatAddress()` calls `wx.chooseAddress` to pre-fill, staying silent on cancel/deny and toasting otherwise.
  - **`app.json`: added `"chooseAddress"` to `requiredPrivateInfos`** — `wx.chooseAddress` fails with `the api need to be declared in the requiredPrivateInfos field` without it (that field is *not* geolocation-only). Still requires the MP-backend 用户隐私保护指引 「用户收货地址」 declaration; first-use consent flows through the existing `onNeedPrivacyAuthorization` modal.
  - `POST /api/heartbeat` now returns `phone` (`UPDATE ... RETURNING phone`), cached onto the user in `main.js`, because `login.js` strips phone from session storage as PII so it's null on session restore.
  - Fixed cart sheet dismissing on any inner button tap: `catchtap=""` → `catchtap="noop"` (empty handler name doesn't reliably register the catch binding).
  - **Insufficient-credits guard**: for credit-paid carts, `handleCheckout` now stops before submitting and shows an 积分不足 modal (with need/have amounts) when `creditBalance < needCredits`. Also fixed a latent bug where `_submitBatchOrder` ignored the response payload — `wx.request` resolves on HTTP 4xx too, so a backend `Insufficient credits` 400 previously still showed the success toast. It now checks `res.data.success`, surfaces insufficient-credits (re-syncing balance) vs. generic errors, and refreshes the balance after a successful debit. (Backend `handlePostOrderBatch` already validates balance transactionally — this is matching client UX + defense in depth.)
  - **No DB migration.**

- **Chat lab-report upload → consent → save to digital twin + photo lookup** (`prompts/nano/systemHealthReport.js`, `handlers/chat.js`, `handlers/health-plans.js`, `index.js`, `utils/tool-actions.js`, `pages/main/main.js`, `components/user-health/user-health.{js,wxml,wxss}`)

  When a user uploads a lab/checkup report photo in the chatbox, Nano now reads it out and then **asks for consent** before saving — instead of silently storing it. The user is asked (1) "Is this your own report?" and (2) "Save it to your health records?" via inline Yes/No buttons. On confirmation the report is saved to `health_reports` (with the photo) and, when core biomarkers are present, the BioAge digital twin is updated. Saved report photos are now viewable in the Health tab (thumbnail on each Lab card + full photo in the report detail sheet, tap to preview full-screen).

  **What changed:**
  - Vision prompt: Type-A (health report) output now also emits `institution`, `report_type`, and an `observations[]` array keyed by canonical `biomarker_catalog` `key_name`s.
  - `handlePostAnalyzeImage`: for `content_type === 'health_report'`, no longer auto-inserts a `biomarkers` row — returns `pending_health_report: true` + a `payload` (oss_key, get_url, report_date, institution, report_type, observations) and still saves the chat read-out. All other photo types unchanged.
  - `handlePostHealthReport`: accepts `oss_key`/`get_url`/`compute_bioage`, maps observations by `key_name` (in addition to `loinc_code`), stores the photo (`oss_key` column + `raw_data.image_url`), allows photo-only reports, and runs the existing lab-import BioAge pipeline inline when core markers are present (deps injected from `index.js`). `handleGetHealthReports` now returns `image_url`. Also fixed a pre-existing bug where its `ON CONFLICT (user_id, source, external_id)` on `health_events` was missing the `WHERE external_id IS NOT NULL` predicate, so it failed to match the partial dedup index and threw on every insert with observations.
  - Miniapp: `tool-actions.js` surfaces the pending flag to the page; `main.js` runs the two-step consent state machine (inline action-card buttons) and POSTs `/api/health-reports` on confirm; `user-health` renders report photo thumbnails + a tappable photo in the detail sheet (`wx.previewImage`). New zh/en strings added.
  - **No DB migration** — `health_reports.oss_key` already exists; the photo URL is stored in `raw_data`.

- **Coach invite codes — optional note/label** (`migration_invitations_note.sql`, `handlers/users.js`, `index.js`, `pages/coach/coach.js`, `coach.wxml`, `coach.wxss`)

  Coaches can now attach a free-text note to each invite code (e.g. "WeChat group A", "Spring promo") so they remember what each code is for. The note is captured when generating a code and can be edited later, and it shows on each invite card.

  **What changed:**
  - DB: `invitations` gains a nullable `note TEXT` column (`migration_invitations_note.sql`). **Run `npm run migrate:dev` then `npm run migrate:prod`.**
  - Backend: `handlePostInvitation` accepts and stores `note`; `handleGetInvitations` selects `note`; new `handlePatchInvitation(id, { note })` updates it, routed at `PATCH /api/invitations/:id` (guarded by `requireAdminTab('invites')`, same as create).
  - Miniapp: `generateInvite` now opens an editable `wx.showModal` to capture the note before creating; new `editInviteNote` edits an existing code's note via PATCH. The invite card shows a tappable note row (placeholder "Tap to add a note" when empty). Strings added to the `invite` block in both zh and en.

- **Coach CRM — move clients between pipeline stages via long-press** (`pages/coach/coach.js`, `pages/coach/coach.wxml`)

  Coaches can now long-press a card in the CRM pipeline kanban to open an action sheet of the other stages and move the client. The change persists via the existing `POST /api/client-pipeline` upsert and updates the kanban in place (counts adjust immediately); a short tap still opens the client detail sheet. No backend change.

  **What changed:**
  - `coach.js`: new `openStagePicker(e)` (action sheet → `POST /api/client-pipeline` with `coach_id`/`user_id`/`stage`, then local `clients` update + rebuild). Extracted `_buildPipelineColumns()` (plus `_stageOrder`/`_stageColorMap`) so `_loadCRM` and the picker share column-building logic. Added `crmMoveTitle`/`crmMoveSuccess`/`crmMoveError` strings (zh + en).
  - `coach.wxml`: pipeline card gains `bindlongpress="openStagePicker"` (keeps `catchtap` for detail).

### Changed

- **Coach panel swipe navigation is now edge-only** (`pages/coach/coach.js`, `pages/main/main.js`)

  The swipe shortcuts that open (main → coach, left-swipe) and exit (coach → back, right-swipe) the coach panel now only trigger when the swipe *starts* within ~40px of the relevant screen edge, matching native iOS edge gestures. Previously these were page-wide, so any horizontal in-page gesture (e.g. the CRM kanban interaction) could unintentionally navigate. The coach panel remains reachable via the menu button and native back.

- **Chatbox — load older messages on scroll to top** (`handlers/chat.js`, `index.js`, `pages/main/main.js`, `pages/main/main.wxml`)

  The miniapp chatbox previously loaded only the most recent 20 messages with no way to see older history. Scrolling to the top of the chat now fetches the previous page of messages and prepends them, while keeping the scroll position anchored to what was the first visible message.

  **What changed:**
  - `handleGetChatHistory` accepts a new `beforeId` parameter. When provided, it queries messages with `id < beforeId` (DESC, `limit+1`) then re-orders ASC, returning a `has_more` flag. The initial load also returns `has_more`.
  - `index.js` extracts `before_id` from the query string and passes it to the handler.
  - `main.wxml`: scroll-view gains `bindscrolltoupper="onScrollToUpper"` and `scroll-into-view="{{scrollAnchor}}"`. Message element IDs changed from `msg{{index}}` (unstable after prepend) to `m{{item.id}}` (content-based, stable).
  - `main.js`: `_initChat` now records `_oldestDbId` (min DB id in first batch) and `_hasMoreHistory`. `onScrollToUpper` triggers `_loadMoreHistory`, which fetches the previous page, normalises messages, prepends them, then anchors the scroll-view to the former first message via `scrollAnchor`. The anchor resets to `''` after 300 ms so normal bottom-scroll continues to work.

- **X3 ring — workMode badges and scheduled monitoring** (`user-health.js`, `user-health.wxml`, `user-health.wxss`)

  The interval settings panel now shows a tappable workMode badge next to each metric label (HRV, SpO₂, HR, Temp). Tapping cycles Off → Auto → Sched → Off. Badges are color-coded: green for active modes, red for Off. Defaults are `hr: 30 min / spo₂: 60 min / temp: 60 min / hrv: 120 min`, all in Scheduled mode (workMode = 2).

  **What changed:**
  - `x3WorkModes: { hr, spo2, temp, hrv }` added to component data; persisted via `wx.setStorageSync('x3_work_mode_settings')`.
  - `handleWorkModeChange(e)` handler cycles the mode; sets `x3IntervalsChanged: true` so Save button appears.
  - `saveRingIntervals` reads stored workModes and passes them to `setAutoMonitoring`.
  - `toggleRingSettings` reads back all 4 types via `getAutoMonitoring` and stores workModes alongside intervals.
  - On first X3 bind (`handleBindWearable`), default scheduled config is applied immediately to the ring and saved to storage.
  - `handleSyncWearable` now reads back type=4 after `setAutoMonitoring` and logs a WARN if HRV monitoring is not active.
  - Error logging in the X3 sync catch block gated behind `IS_DEV`.

- **X3 ring — temperature history fetch** (`user-health.js`, `x3/index.js`, `sync.js`)

  Temperature was collected by the ring but never fetched or displayed. Added `getTemperatureHistory()` method on the X3 driver (command 0x62, all cached days, no date filter). Sync now fetches the full temp history, picks the latest valid reading (>34 °C), and stores `bodyTempC` / `tempSlots` in the raw snapshot.

  `sync.js` now emits one `health_events` row per temperature reading (`external_id: smart_ring_temp_<timestamp>`) with `body_temp_c` and `skin_temp_c` fields, following the same per-reading upsert pattern as HRV/SpO₂.

- **X3 ring data display — multi-day trend charts** (`user-health.js`, `user-health.wxml`, `user-health.wxss`)

  The detail card now shows four daily trend bar charts above the dense history charts:

  | Chart | Source | Color scale |
  |---|---|---|
  | HRV 趋势 | `hrvSlots` daily avg, last 7 days | blue ≥80 / green ≥50 / orange ≥30 / red |
  | SpO₂ 趋势 | `spo2Slots` daily avg, last 7 days | blue ≥98% / green ≥95% / orange ≥90% / red |
  | 睡眠趋势 | `sleepHistory` per night, last 7 nights | green ≥7h / blue ≥6h / orange ≥5h / red |
  | 体温 | latest `bodyTempC` | green <37.2°C / orange <38°C / red |

  Body temperature also appears as a summary card in the metrics grid (same row as HRV/SpO₂/Stress), gated on `hasBodyTemp`.

  **What changed:**
  - `_buildRingDisplayData`: added `hrvDayBars`, `spo2DayBars`, `sleepDayBars`, `bodyTempC`, `tempPct`, `tempColor`, `hasBodyTemp`; `hasSlotCharts` extended to include all new chart types.
  - `.ring-chart-day-col`, `.ring-chart-day-avg`, `.ring-chart-day-label`, `.ring-reading-date-header` added to WXSS.

- **X3 ring data display — dense bar charts for HRV/SpO₂/Stress history** (`user-health.js`, `user-health.wxml`, `user-health.wxss`)

  Replaced the long scrollable grouped readings list (which could reach 200+ entries) with three dense bar charts — one each for HRV, SpO₂, and Stress. Each chart bins up to 48 bars from all cached readings (oldest → newest, left → right), with bar height encoding the value within its min–max range and bar color encoding quality.

  The header row shows the latest reading colored by quality; the footer shows min / count / max.

  **Note:** WeChat Mini Program does not apply `{{}}` data bindings to SVG child element attributes (`<polyline points="...">`, `<path d="...">`). The initial SVG implementation rendered blank charts. Replaced with the same WXML bar-column pattern used by the existing steps/HR charts.

  **What changed:**
  - `_buildReadingLineCharts(readings)` added: extracts HRV/SpO₂/Stress value arrays, bins into ≤48 bars with `_toBars()`, returns `{ hrvChart, spo2Chart, stressChart }` each with `{ hasData, bars, latestVal, latestColor, minVal, maxVal, count }`.
  - Called at both `_commitRingData` sites; result spread into `ringData` with `hasSlotCharts` updated to include line chart data.
  - `.ring-lc-bars`, `.ring-lc-col`, `.ring-lc-bar` added to WXSS.

- **X3 ring — multi-night sleep history** (`user-health.js`, `x3/index.js`)

  Sleep trend requires multi-night data. The X3 ring caches up to ~3 nights via command 0x53.

  **What changed:**
  - X3 sync path: `getSleep()` replaced with `getSleepHistory()` (returns all cached nights oldest → newest). Last element is used for the existing `sleepMinutes` / `sleepSlots` / `sleepStart` / `sleepEnd` fields. Full array stored as `sleepHistory: [{ date, totalMinutes, deep, light, rem, awake }]`.
  - Colmi sync path: `getSleep()` result wrapped into a single-element `sleepHistory` array so the display code is uniform.
  - `_buildRingDisplayData`: `sleepDayBars` computed from `raw.sleepHistory` (up to last 7 nights).

### Added

- **Finance tab visible to channel admins** (`auth.js`, `index.js`, `handlers/partners.js`, `handlers/credits.js`)

  Channel admin accounts (including autonomous channels like Aeviva China) can now access the **Finance** tab in the admin panel. They see partner payouts, coach commissions, channel payouts, and credit withdrawals scoped to their own channel. Previously the Finance tab was superadmin-only.

  - Added `finance:read`, `finance:write` to `CHANNEL_ADMIN_FULL_PERMS`
  - All Finance GET routes in `index.js` now inject `adminCtx.channelId` so channel admins are auto-scoped
  - `handleGetPartnerCommissions` now supports `channel_id` filtering
  - `handleGetAdminWithdrawals` now supports `channel_id` filtering via `users.channel_id`
  - Generate-payouts POST routes enforce channel scope for channel admin callers

### Fixed

- **Toolbox image upload — second upload silently hangs, picker never opens** (`components/toolbox/toolbox.js`, `pages/main/main.js`, `pages/coach/coach.js`, `utils/tool-actions.js`)

  After a user successfully uploaded an image, tapping "Upload Image" in the toolbox again produced no visible result — `wx.chooseMedia` was called (confirmed via vConsole) but neither the success nor fail callback ever fired.

  **Root cause:** `wx.chooseMedia` requires WeChat's privacy authorization (`onNeedPrivacyAuthorization`). The app routes that event through `_app._onPrivacyRequest`, which the `user-health` component registers to show its own privacy popup. However, `user-health` lives inside `.health-tab`, which applies `display: none !important` whenever the chat tab is active. A `position: fixed; z-index: 9999` element inside a `display: none` parent is also hidden — the user never saw the privacy prompt, could never tap "Agree", `resolve()` was never called, and `wx.chooseMedia` hung indefinitely. Each subsequent tap stacked another pending call.

  **What changed:**
  - `main.js` and `coach.js` each register their own `_app._onPrivacyRequest` in `onReady` (which fires after component `attached()`, so it wins over user-health's registration). This points to a page-level `showPrivacyModal` flag instead of user-health's component-scoped flag.
  - A privacy consent modal (`page-privacy-mask`) was added at the root of `main.wxml` and `coach.wxml`, outside all tab containers, so it is always visible regardless of which tab is active.
  - `onPrivacyAgree` / `onPrivacyCancel` handlers added to both pages; they call `_app._privacyResolve(...)` the same way user-health did.
  - After `readFile` loads the image into memory as an ArrayBuffer, the temp file is immediately `unlink`'d so WeChat can allocate a fresh temp path on the next `wx.chooseMedia` call.
  - After OSS PUT succeeds, the chat image message URL is swapped from the local temp path to the permanent OSS `get_url` (better for persistence and frees the temp file reference).

- **Aizo ring (Infinity Ring) — BLE scanning and UUID normalization fixes** (`ble-manager.js`, `user-health.js`, `aizo/index.js`, `colmi/index.js`)

  **What changed:**
  - **UUID Normalization:** Modified `_normalizeUUID` in `ble-manager.js` and `colmi/index.js` to support expanding standard 16-bit and 32-bit UUIDs (e.g., `fe02`, `010a`) to their 128-bit equivalents (using the standard Bluetooth base UUID `00000000-0000-1000-8000-00805f9b34fb`). This ensures standard 16-bit characteristic UUIDs returned by WeChat match the 128-bit strings defined in protocol files.
  - **Scanning by Name:** The physical "infinity ring" does not advertise its service UUID `fe02` in its BLE advertisement headers. Changed `AizoRing.scan` in `aizo/index.js` to scan by name prefixes (`AIZO_NAME_PREFIXES` which contains `"infinity"`) rather than filtering on `[BLE_SERVICE_UUID]`.
  - **Case-Insensitive Scan Matching:** Updated the scan loop in `user-health.js` and `ble-manager.js` to perform case-insensitive name prefix matching (e.g., matching `"Infinity Ring"` to `"infinity"`) and check `d.localName` if `d.name` is empty.

- **X3 ring settings — BLE connection leak causing '同步失败' on Save** (`user-health.js`)

  `toggleRingSettings` used `Promise.all` for 4 concurrent `getAutoMonitoring` calls. Because `_send` has a single `notifyHandler` slot, concurrent calls overwrote each other: 3 of 4 timed out, `Promise.all` rejected, and `ring.disconnect()` was never reached — leaving the BLE device connected. When "Save to Ring" was subsequently pressed, `ring.connect()` failed because the device was already connected, triggering the error toast.

  **What changed:**
  - `toggleRingSettings`: `Promise.all` replaced with sequential `await` calls; `ring` declared before `try` so `finally` can always call `ring.disconnect().catch(() => {})`.
  - `saveRingIntervals`: `ring.disconnect()` likewise moved to `finally`; catch now logs the error for easier debugging.

- **X3 health tab — repeated sync shows identical HRV/Stress/SpO2 readings** (`user-health.js`)

  `_commitRingData` accumulated the latest ring reading into `wearable_realtime_today` on every sync call. Because X3 auto-monitoring readings don't change between syncs (only the ring's own schedule updates them), each sync pushed the same HRV=142, Stress=91, SpO2=95 values with a new timestamp, making the "readings" list grow with identical entries.

  The `wearable_realtime_today` store was designed for Colmi Phase 2 on-demand measurements (each reading is new). For X3 the full per-measurement history is already in `raw.hrvSlots`/`raw.spo2Slots`.

  **What changed:**
  - Added `_slotsToReadings(hrvSlots, spo2Slots)` — merges HRV and SpO2 slot arrays by timestamp into the standard reading shape (CST timestamps converted to Unix ms via `+08:00` suffix).
  - `_commitRingData`: skips `wearable_realtime_today` accumulation when `raw.hrvSlots != null`; builds `realtimeReadings` from slots instead.
  - Page-load path (`_loadWearableFromStorage`) updated to the same slot-first logic.
  - Colmi path unchanged — falls through to existing `_getRealtimeReadings` when no slots are present.

- **X3 sync pipeline — per-measurement HRV and SpO2 storage** (`sync.js`, `user-health.js`)

  The X3 sync path in `user-health.js` was broken after `getHrvLog()` and `getSpo2Log()` were updated to return arrays: the code still accessed `.hrv` and `.spo2` as scalar properties on the returned arrays (both resolving to `undefined`).

  Additionally, only the last reading was ever stored; the full day's auto-monitoring history was discarded.

  **What changed:**
  - `user-health.js` X3 path: `getHrvLog()` / `getSpo2Log()` results now treated as arrays; last element used for display fields (`hrv`, `stress`, `spo2`, …); full arrays passed as new `hrvSlots` / `spo2Slots` fields.
  - `sync.js`: Added `hrvSlots` and `spo2Slots` to `WearableSnapshot`. When present, one `health_events` vitals row is generated per measurement (unique `external_id` = `smart_ring_hrv_<timestamp>` / `smart_ring_spo2_<timestamp>`). The existing single-realtime-event path is preserved for Colmi (which has no slots).
  - Repeated syncs upsert the same rows via `ON CONFLICT (user_id, source, external_id)` — no duplicates accumulate.
  - `health_twin` averages (`avg_hrv_ms`, `avg_spo2`) now reflect all daily readings rather than just the last sync.

- **X3 ring auto-SpO2 parser — array returned instead of single latest value** (`src/mini/nano-miniapp/utils/wearable/x3/index.js`)

  The old `getSpo2Log()` returned a single scalar (the last matching SpO2 value for today) instead of all readings.

  **What changed:**
  - `_parseSpo2Log66` replaced by `_parseSpo2Records66` — returns an array of `{ timestamp, spo2 }` records, deduped by timestamp and sorted oldest-first.
  - Added `getAutoSpo2History()` returning the full multi-day array (named `getAuto…` to avoid collision with the existing `getSpo2History()` which reads the 0x57 detail stream).
  - `getSpo2Log(date)` now calls `getAutoSpo2History()` internally and filters to the requested day.

  **Verified live** against an X3B ring: 80 unique records across 4 days (Jun 17–20) returned; today's 6 readings all correct.

- **X3 ring HRV parser — all records returned instead of last** (`src/mini/nano-miniapp/utils/wearable/x3/index.js`)

  The old `_parseHrvLog56` accumulated HRV fields into a single result object, overwriting each field with the next matching record. A ring with 293 records in its buffer (3+ days at 15-min intervals) returned only the values from the final record.

  **Root cause:** The parser looped through all 0x56 records but kept only one accumulator object, so every record overwrote the previous.

  **What changed:**
  - `_parseHrvLog56` replaced by `_parseHrvRecords56` — returns an array of all records, with `Set`-based deduplication by timestamp (ring sends the full batch twice in one BLE response) and sorted oldest-first.
  - `getHrvLog(date)` now calls the new `getHrvHistory()` internally and filters to the requested day, so both methods share a single BLE round-trip.
  - Added `getHrvHistory()` returning the full multi-day array, parallel to `getSleepHistory()`.

  **Verified live** against an X3B ring: 230 unique records across 4 days (Jun 17–20) now returned by `getHrvHistory()`; `getHrvLog()` for today returns all 15 readings instead of 1.

- **X3 ring sleep parser — multi-block 1-min format** (`src/mini/nano-miniapp/utils/wearable/x3/index.js`)

  The X3B ring stores sleep data as **130-byte 1-minute-resolution blocks** (up to 12 blocks ≈ 3 nights cached), not as 34-byte 5-minute blocks. The old `_parseSleep53` treated the entire multi-block response as one 130-byte single-block record, producing a 5-min nap instead of a full night.

  **Root cause:** the original format-detection used `buf.length === 130` as the only 1-min guard; any larger buffer fell through to the 34-byte parser, which then only found one valid `0x53` header (at offset 0) and discarded the rest.

  **What changed:**
  - Added `_dateStrToMin()` helper for gap arithmetic without JS `Date` timezone hazards.
  - `_parseSleep53` now checks `dataLen % 130 === 0` first (multi-block 1-min path), sorts the blocks oldest-first (ring transmits newest-first, with a sequence counter at `byte[1]`), then isolates the most recent continuous sleep session by dropping any blocks separated from the tail by a gap > 4 hours. Falls through to the 34-byte 5-min path for rings that use that format.
  - `getSleep()` stream timeout raised from 12 s → 15 s to handle larger multi-block transfers reliably.

  **Verified live** against an X3B ring: 1 562-byte response (12 × 130-byte blocks, 3 nights) now correctly returns only the last session — onset 00:17, 5 blocks, 6 h 47 m total (Deep 27 % / Light 53 % / REM 18 % / Awake 2 %).

### Refactored
- **Admin Panel — hub tab consolidation** — The web admin panel sidebar was reduced from 24 tabs to 20 by grouping related tabs under three new hub wrappers. Each hub renders a top-level subtab row and delegates to the existing tab components unchanged; no backend changes.

  | New hub tab | Replaces | Subtabs |
  |---|---|---|
  | **Hardware** (`tabs/HardwareTab.jsx`) | `kino` + `chips` | Devices (`KinoTab`) · Chips (`ChipsTab`) |
  | **Content** (`tabs/ContentTab.jsx`) | `academy` + `questionnaires` + `health-plans` + `events` | Academy · Questionnaires · Health Plans · Events |
  | **Finance** (`tabs/FinanceTab.jsx`) | scattered subtabs in Rewards + Partners + Store | Overview · Credit Withdrawals · Channel Payouts · Coach Commissions · Partner Payouts · Order Payments |

  **Finance tab** additionally adds a new **Order Payments** subtab — the first UI surface that exposes `payment_status` management for orders (mark an unpaid order as paid via `PUT /api/orders/:id { payment_status: 'paid' }`). Previously `payment_status` was displayed read-only inside the Store orders row detail.

  **Rewards tab** (`RewardsTab.jsx`) now shows only the Commission Settings subtab (rate config). Channel Payouts, Coach Commissions, and Credit Withdrawals subtabs moved to Finance.

  **Partners tab** (`PartnersTab.jsx`) Payouts subtab moved to Finance; Partners, Commissions, Commission Rules, and Partner Types subtabs remain.

- **Worker and Admin Panel modularisation** — Both large monolith files have been split into focused domain modules to improve maintainability and reduce Claude Code editing errors caused by context-window overrun.

  **Worker (`src/functions/worker/index.js`):** 11,635 → 1,019 lines. All handler functions extracted into `handlers/` (one file per domain) and shared auth/permission helpers extracted into `lib/auth.js`.

  | Handler file | Domain |
  |---|---|
  | `handlers/academy.js` | Academy courses, lessons, certifications, learning paths |
  | `handlers/admin-accounts.js` | Admin accounts, channel roles, admin login |
  | `handlers/channels.js` | Channel CRUD, subchannel management, rewards/store/warehouse config |
  | `handlers/chat.js` | AI chat, health advice, biomarkers, health events, health twin |
  | `handlers/coach-groups.js` | Coach group CRUD and KPIs |
  | `handlers/coaches.js` | Coach management, reminders, coach-user chat |
  | `handlers/commissions.js` | Commission settings, payout generation |
  | `handlers/crm.js` | Coach CRM — tags, pipeline, notes, campaigns, appointments, goals, NPS, KPIs, follow-up rules |
  | `handlers/credits.js` | User credit balance, history, withdrawals |
  | `handlers/digital-assets.js` | Digital assets, OSS presign, Kone APK releases |
  | `handlers/dots.js` | Dots inventory, cartridges, dispense, orders, nutrition plan, formulation |
  | `handlers/events.js` | Offline events (线下活动) |
  | `handlers/health-plans.js` | Health plan templates, plans, checkins, milestones, health reports |
  | `handlers/inventory.js` | Warehouse inventory stock |
  | `handlers/kino.js` | Kino devices, chip batches, chip models, scan flow |
  | `handlers/labs.js` | Lab providers, user mappings, lab reports, lab import |
  | `handlers/login.js` | WeChat login (miniapp + app), phone binding, invite validation, referrals |
  | `handlers/partners.js` | Partner system — types, rules, commission rules, referral network, payouts |
  | `handlers/questionnaires.js` | Questionnaire CRUD, assignments, responses, AI fill |
  | `handlers/reports.js` | Saved reports, admin report generation |
  | `handlers/store.js` | SKUs, store items, orders |
  | `handlers/tickets.js` | Support tickets |
  | `handlers/users.js` | User CRUD, dashboard stats, biomarkers, notifications, invitations |
  | `lib/auth.js` | Token sign/verify, permission constants, `requirePermission`, WeChat access-token cache |

  **Admin Panel (`src/web/admin-panel/src/App.jsx`):** 17,761 → 284 lines. All tab components extracted into `tabs/` (one file per tab). Shared utilities and the translation object split into `shared.jsx` and `translations.js`.

  | File | Contents |
  |---|---|
  | `translations.js` | The full `T` i18n object (EN + ZH) |
  | `shared.jsx` | `LangCtx`, `useLang`, `PERMS`, `hasPermission`, `LoginScreen`, `StatCard`, `RichStatCard`, `Badge`, `fmt`, `fmtDate`, `bioAgeColor`, Kino normalisation helpers |
  | `tabs/AcademyTab.jsx` | Academy — courses, lessons, library, certifications, learning paths _(wrapped by ContentTab)_ |
  | `tabs/AdminAccountsTab.jsx` | Admin account management |
  | `tabs/ChannelTab.jsx` | Channel CRUD, subchannel config, `ChannelConfigModal` |
  | `tabs/ChipsTab.jsx` | Kino chip batches and chip models _(wrapped by HardwareTab)_ |
  | `tabs/CoachCRMTab.jsx` | Coach CRM kanban, campaigns, client drawer |
  | `tabs/CoachTab.jsx` | Coach management, coach groups |
  | `tabs/ContentTab.jsx` | Hub: Academy · Questionnaires · Health Plans · Events |
  | `tabs/DashboardTab.jsx` | Dashboard KPIs and sparklines |
  | `tabs/DigitalAssetsTab.jsx` | Digital asset upload and management |
  | `tabs/DotsTab.jsx` | Dots catalogue management |
  | `tabs/EventsTab.jsx` | Offline events _(wrapped by ContentTab)_ |
  | `tabs/FinanceTab.jsx` | Hub: Credit Withdrawals · Channel Payouts · Coach Commissions · Partner Payouts · Order Payments |
  | `tabs/HardwareTab.jsx` | Hub: Kino Devices · Chips |
  | `tabs/HealthPlansTab.jsx` | Health plan templates and active plans _(wrapped by ContentTab)_ |
  | `tabs/InventoryTab.jsx` | Channel inventory, warehouses, SKUs |
  | `tabs/InvitesTab.jsx` | Invite code management |
  | `tabs/KinoTab.jsx` | Kino device management and APK releases _(wrapped by HardwareTab)_ |
  | `tabs/LabTab.jsx` | Lab providers, user mappings, lab reports |
  | `tabs/PartnersTab.jsx` | Partner system — Partners, Commissions, Commission Rules, Partner Types |
  | `tabs/QuestionnairesTab.jsx` | Questionnaire CRUD, assignment, responses _(wrapped by ContentTab)_ |
  | `tabs/ReportsTab.jsx` | Saved reports and admin report generation |
  | `tabs/RewardsTab.jsx` | Commission rate settings only (payouts moved to FinanceTab) |
  | `tabs/SimulatorsTab.jsx` | Kino and Nano simulators |
  | `tabs/StoreTab.jsx` | Store items, orders, SKUs, stock adjustments |
  | `tabs/TicketsTab.jsx` | Support tickets |
  | `tabs/UsersTab.jsx` | User management, user detail, credit, referral network |

  No functional changes — pure structural refactor. Build (`npm run build`) and worker syntax check (`node -e "require('./src/functions/worker/index.js')"`) both pass.

### Added
- **Magic Box (魔盒) — Digital Asset Distribution** — New miniapp tab and admin panel section for distributing large digital files (audio, video, APK, documents) to channel members.
  - **Schema** (`migration_digital_assets.sql`): new `digital_assets` table with `type`, `title`, `title_zh`, `oss_key`, `content_type`, `duration_seconds`, `channel_id`, `is_active`, `sort_order`.
  - **Backend** (`index.js`): 5 new endpoints — `GET /api/digital-assets`, `POST /api/digital-assets`, `PUT /api/digital-assets/:id`, `DELETE /api/digital-assets/:id`, `GET /api/digital-assets/presign`. Channel admins are scoped to their own channel's assets. Presigned GET URLs use 7-day expiry and the `nano-oss.fros.cc` CNAME domain.
  - **Miniapp — Box tab**: replaces the placeholder Wellness tab. Fetches all active assets for the user's channel. Audio assets play via `wx.getBackgroundAudioManager()` (lock-screen capable). Video/other assets copy a presigned download link to clipboard. Icon: `assets/icons/box.svg`. Tab label: **Box** (EN) / **魔盒** (ZH).
  - **Admin panel — Media tab**: full CRUD for digital assets. Channel admins see only their channel's assets with no channel selector. Superadmins get a channel filter dropdown. Presigned PUT URLs power direct-to-OSS uploads. Tab is at the bottom of the sidebar and is granted via `CHANNEL_ADMIN_FULL_PERMS`.
  - **OSS CNAME** (`nano-oss.fros.cc`): custom domain CNAME → `waven-nano.oss-cn-shanghai.aliyuncs.com`; `*.fros.cc` wildcard SSL cert bound via `aliyun oss bucket-cname --item certificate`. Download links are browser-accessible without raw OSS endpoint exposure. Full details: `docs/architecture/digital-assets.md`.

- **SKU Variant System** — Products with multiple sizes, colours, or other attributes are now modelled with a parent-child relationship inside the `skus` table.
  - **Schema** (`migration_sku_variants.sql`): added `parent_sku_id UUID REFERENCES skus(id)`, `attributes JSONB DEFAULT '{}'`, and `is_parent BOOLEAN DEFAULT FALSE` to `skus`. Index on `parent_sku_id` for fast child lookups. All three columns default to their "standalone" state so existing rows are unaffected.
  - **Backend** (`index.js`): `handlePostSku` and `handlePutSku` now persist and return the three variant columns.
  - **Admin panel — SKU modal**: 3-mode selector: **Standalone** (default), **Parent product** (`is_parent=TRUE`), **Variant / Child SKU** (`parent_sku_id` + attributes). Variant mode shows a parent picker, a dynamic key-value attribute editor, and a **Suggest code** button that auto-builds `{PARENT_CODE}-{ATTR_VALUES}`.
  - **Admin panel — SKU list** (Store tab and Inventory → SKUs sub-tab): collapsible tree view. Parent rows show a `PARENT` badge, variant count, and **Add Variant** shortcut. Child rows appear indented with coloured attribute chips. Standalone rows unchanged.

- **Autonomous channel flag** — A new `channels.autonomous` boolean (superadmin-only) lets a channel operate as a fully independent unit (e.g. country-level partner `aeviva-china`). When set, all capability flags are implicitly true; the JWT carries `auto: true` and the auth middleware overrides all per-request flags accordingly. Admin panel: purple `AUTO` badge on channel rows; toggle in Channel Settings → General (superadmin-only). API: `PUT /api/channels/:id/autonomous`. Migration: `migration_autonomous_channel.sql`.

- **Warehouse management for channel admins** — New `channels.can_manage_warehouses` boolean unlocks the **Inventory → Warehouses sub-tab** for channel admins, scoped to SKUs they own. Delegatable from a parent channel admin with `can_manage_subchannels`. Autonomous channels get this automatically. API: `PUT /api/channels/:id/warehouse-permission`. Migration: `migration_warehouse_permission.sql`.

- **Store tab access for autonomous channel admins** — Autonomous channel admins can now browse the **Store → Items sub-tab** (global catalog, read-only). SKUs, Warehouses, and Orders sub-tabs within Store remain superadmin-only.

### Fixed
- **WeChat unionid/openid db columns missing crash** — Created and applied [migration_add_wx_unionid_and_app_openid.sql](file:///Users/pin/waven/nano/src/schemas/migration_add_wx_unionid_and_app_openid.sql) to add missing `wx_unionid` and `wx_app_openid` columns to the `users` table, resolving database crash: `column "wx_unionid" of relation "users" does not exist` during guest registration/sign-on in WeChat mini-program.
- **Channels tab click blank screen / crash** — Fixed a crash in the web admin panel where clicking the "Channels" tab caused a blank screen. This was caused by: (1) Missing imports for `Building2`, `Users`, `Cpu`, and `Activity` icons from `lucide-react`. (2) Missing definition for `EMPTY_CHANNEL` referenced by the add channel modal state. (3) Missing definition for `SUB_AGE_KEYS_CONFIG` referenced by the sub-age label customization modal. (4) Missing definition for `uploadToOSS` helper referenced by the channel logo upload flow. All missing dependencies have been added/defined within [ChannelTab.jsx](file:///Users/pin/waven/nano/src/web/admin-panel/src/tabs/ChannelTab.jsx).
- **`loadTierCfg` ReferenceError hoisting fix** — Moved the `useEffect` hook below the declaration of the `loadTierCfg` async arrow function inside [ChannelTab.jsx](file:///Users/pin/waven/nano/src/web/admin-panel/src/tabs/ChannelTab.jsx) to prevent a runtime `ReferenceError` (accessing variable before initialization) when the "Partner Tiers" settings are loaded.
- **Missing `handleGetKinoUpgrade` endpoint handler** — Restored the `handleGetKinoUpgrade` handler function to [digital-assets.js](file:///Users/pin/waven/nano/src/functions/worker/handlers/digital-assets.js) and imported it inside [index.js](file:///Users/pin/waven/nano/src/functions/worker/index.js), resolving an undeclared `ReferenceError` that crashed the worker's `/kino-upgrade` GET endpoint after the code split.
- **SKU save "nothing happens" bug** — Three compounding issues were fixed: (1) `t.saveFailed` was referenced at the wrong object path in `SkuModal`. (2) Template literals in PUT/DELETE URLs used a backslash-escaped `\${sku.id}`, preventing interpolation. (3) `handlePostSku` didn't return a `statusCode` on DB errors, so unique-constraint failures returned HTTP 200 and the modal closed silently.

### Added
- **Channel-scoped Partner System** — Channels granted `can_customize_partner_system` permission can now define their own partner types and commission rules independently of the global system.
  - **Schema** (`migration_partner_channel_scope.sql`): added `channel_id` FK to `partner_types` and `partner_commission_rules`; unique constraint changed to `(COALESCE(channel_id,0), key)` so each channel can have its own type with the same key as a global type; `partners.tier` FK dropped (application-layer validation). Added `can_customize_partner_system BOOLEAN DEFAULT FALSE` to `channels`.
  - **Commission engine** (`partnerCommissions.js`): `getCommissionRules(eventType, channelId)` now prefers channel-specific rules when they exist; falls back to global rules if not. `getPartnerProductDiscount`, `recordReferralCommission`, and `recordSalesCommission` all pass channel context.
  - **API**: `GET /api/partner-types` returns effective types for caller context (channel-specific if permission+types exist, else global); `?channel_id=X` returns only types stored for channel X (for CRUD). All partner-types and commission-rules CRUD endpoints are channel-scoped — channel admins with permission can only manage their own channel's records. New `PUT /api/channels/:id/partner-system-permission` endpoint (same permission model as `partner-tiers-permission`).
  - **Admin panel**: New **Partner System** tab in Channel Settings modal — permission toggle, Partner Types CRUD table + add/edit form, Commission Rules CRUD table + add/edit form, subchannel permission toggles. Tab is only shown when the channel has permission or viewer is superadmin.

- **Flexible Partner Types & Commission Rules** — Replaced all hardcoded partner tier strings (`light_entrepreneur`, `leader_partner`, `operations_center`) and the singleton `partner_commission_config` table with dynamic, admin-configurable systems.
  - **New `partner_types` table** — create/edit/deactivate partner types from the admin panel without code changes. `sort_order`, `label`, `label_zh`, `color`, `entry_fee` all configurable per type. `partners.tier` CHECK constraint replaced with a FK to `partner_types.key` (ON UPDATE CASCADE).
  - **New `partner_commission_rules` table** — replaces `partner_commission_config` singleton. Each row is one commission rule: `event_type` (`referral`, `team_income`, `product_discount`, `training_discount`), `upline_level` (N levels supported), `earner_type` / `subject_type` (NULL = wildcard). Seeded from existing config on migration.
  - **N-level commission engine** (`src/functions/worker/lib/partnerCommissions.js`) — `recordReferralCommission` and `recordSalesCommission` now use recursive CTEs to walk up as many levels as defined in commission rules, enabling 2nd-level referral cascade and 3+ level team income. Rate resolution uses most-specific-match (earner+subject > earner-only > wildcard).
  - **8 new API endpoints** — `GET/POST /api/partner-types`, `PUT/DELETE /api/partner-types/:key`, `GET/POST /api/partner-commission-rules`, `PUT/DELETE /api/partner-commission-rules/:id`. Existing `/api/partner-commission-config` endpoints kept as backward-compat shims.
  - **Admin panel** (`src/web/admin-panel/src/App.jsx`) — Partners tab gains "Partner Types" sub-tab with full CRUD. Tier dropdowns, referral matrix, and discount tables all render dynamically from the API. Channel config partner-tiers tab fetches types from API instead of hardcoded defaults.
  - **Migrations**: `migration_partner_types.sql`, `migration_partner_tier_dynamic.sql`, `migration_partner_commission_rules.sql`.

### Fixed
- **Health report shows wrong biomarker value inconsistent with BioAge** — `handlePostHealthAdvice` merged `data.actual` over `data.estimated` when building the biomarker object passed to the LLM prompt. Because `BiomarkerEstimator` only accepts hsCRP values ≥ 0.2 mg/L, a submitted value of 0.14 was rejected and replaced with an age-based estimate (1.02) for the BioAge calculation — but `data.actual.hsCRP = 0.14` still survived the merge and reached the LLM. The report then narrated "hsCRP = 0.14 mg/L, excellent health" while the stored ResilienceAge was computed with 1.02, contradicting the text. Fix: use `data.estimated` directly (already contains the actual value when it is valid, and the validated estimate when it is not). `src/functions/worker/index.js` `handlePostHealthAdvice`.
- **Coaches tab shows stale channel after user reassignment** — `coaches.channel_id` was a redundant copy of `users.channel_id` that was never synced when a user's channel changed. Finished the rationalization started by `migration_rationalize_coaches`: dropped the column and updated all queries to derive channel via `JOIN coaches → users → channels`. Migration: `src/schemas/migration_coaches_drop_channel_id.sql`. The Coach modal's channel selector has been removed.

### Added
- **WeChat Multiterminal Apps (Donut) Documentation** — Added architectural documentation (`docs/architecture/wechat-multiterminal.md`) outlining WeChat's Donut Multi-platform Framework. This includes configuration workflows, DevTools integration, Mobile App Assistant testing tools, debugging limitations, and the path for deploying `nano-miniapp` as native iOS and Android packages.
- **Weight recording via scale photo** — Users can now photograph their weight scale in the chat tab (toolbox → Upload Image). The vision model (`qwen-vl-plus`) reads the displayed value, handles kg/lb conversion, compares to the last 5 weight records for plausibility, auto-saves as a `body_composition` biomarker, and replies in chat with the recorded value and a trend vs. recent average (or a warning if the value differs by more than 20 kg). No UI changes to the miniapp — reuses the existing photo upload flow. `src/functions/worker/index.js` `handlePostAnalyzeImage`, `buildWeightNarrative`; `src/functions/worker/prompts/nano/systemHealthReport.js` (added Type E — scale_reading).
- **Web Admin Panel — Dashboard overhaul** (`src/web/admin-panel/src/App.jsx`, `style.css`, `src/functions/worker/index.js`) — rebuilt the Dashboard tab around real time-series data instead of static aggregate buckets.
  - **New backend endpoint** `GET /api/admin/dashboard-stats` (`handleGetDashboardStats`) — read-only aggregates in one round trip: daily signups / scans / orders+revenue for the last 30 days, bio-age-delta histogram (6 buckets, latest biomarker per user vs chrono age), average sub-ages for the four dimensions (from `biomarkers.data->bioage_profile->SubAges`), top-8 channels by user count (superadmin only), revenue totals (30d + all-time), open ticket count, and the 6 newest users with avatar/bio-age/channel. Channel admins are automatically scoped via `adminCtx.channelId`; requires worker deploy to take effect.
  - **KPI row**: five cards with 30-day sparklines — users (+7d), scans (+7d), revenue 30d (with all-time sub), coaches (+7d), avg bio-age (Δ vs chrono).
  - **30-Day Activity chart**: dual-gradient area chart of daily signups and scans (zero-filled days).
  - **Needs Attention panel**: live counts for pending orders, open tickets, inactive Kino devices, low chip stock (<15% available), and untested users — each row navigates to the relevant tab (respecting channel-admin tab permissions); shows an all-clear state when empty.
  - **Bio-Age Δ distribution** histogram (green→red buckets) with gender/tested% footer; **Four Dimensions card** with average sub-age bars and per-dimension delta vs average chrono age; **Orders & Revenue card** with status donut (computed from the orders list) plus 30d/all-time revenue.
  - **Superadmin row**: top channels by users (ranked bars) and Kino hardware with a chip-usage progress bar.
  - **Recent Users / Recent Orders** tables upgraded: avatars, channel column, item name (localized), order amount (¥ price×qty), and status badges. Recent users now come from the new endpoint — previously the superadmin list was sorted by a `created_at` field the minimal users query never returned.
- **Web Admin Panel — CRM tab overhaul** (`src/web/admin-panel/src/App.jsx`, `style.css`) — the CRM tab now surfaces the full coach-CRM backend (tags, stage changes, notes, activity log, goals, campaign recipients, message templates) that was previously API-only. Frontend-only change; no backend or DB modifications.
  - **Pipeline**: new Kanban board view (default) with one column per stage — client cards show avatar, bio-age delta, colored coach tags (`/api/coach-tags`), last scan, and days-in-stage; drag-and-drop between columns persists the stage via `POST /api/client-pipeline` (optimistic update with rollback on failure). Toggleable table view with inline stage dropdown, search box (name / user id / tag), and summary stat cards (total, active, at-risk, avg Δ bio-age, scanned %).
  - **Client drawer**: clicking a client opens a slide-in panel with four tabs — Overview (ages, delta, stage, tags, stage note), Notes (full CRUD + pin/unpin via `/api/coach-notes`), Activity (icon timeline from `/api/client-activity`), Goals (progress bars from `/api/client-goals`).
  - **Campaigns**: stat cards (total / sent / drafts / reach), per-campaign delivery progress bar (`sent_count/recipient_count`), recipients modal with per-user delivery status (`/api/bulk-campaigns/:id/recipients`), and a message-template picker in the create modal (`/api/message-templates`) that prefills title/content. Create modal switched from the unstyled `modal-backdrop` class to the proper `modal-overlay`.
  - **Activity (new sub-tab)**: coach-wide activity timeline (`/api/coach-activity-feed`) alongside the next 7 days of appointments (`/api/appointments/upcoming`).
  - **Performance**: clickable sortable column headers, totals row, and a clients-vs-scans comparison bar chart across coaches.
  - **NPS**: 0–10 score-distribution histogram (promoter/passive/detractor colors), coach filter, and a response-rate stat; aggregate cards always visible.
  - Sub-tab buttons now use the shared `.subtab-btn` style; new CSS blocks for the kanban board, drawer, timeline, notes, tag chips, and progress bars appended to `style.css`.
- **HTML store item descriptions (text + pictures)** — store item and channel inventory descriptions can now contain HTML, including `<img>` pictures.
  - **Web Admin Panel** `src/web/admin-panel/src/App.jsx`: new shared `HtmlDescField` component replaces the plain desc inputs in both the Store item modal and the Channel Inventory item modal — multiline HTML textarea, an **Insert image** button (uploads to OSS via the existing `/api/oss/presign` flow with progress %, inserts the `<img>` tag at the cursor position), and a live HTML preview toggle. The preview is sanitized (scripts, iframes, `on*` handlers, and `javascript:` URLs stripped) since descriptions can be authored by channel admins but previewed by superadmins.
  - **Miniapp** `src/mini/nano-miniapp/pages/main/`: store cards detect HTML descriptions and render them with `<rich-text>`; `<img>` tags are normalized to `max-width:100%` so pictures fit the card. Plain-text descriptions render exactly as before.
  - No DB change — `desc_en` / `desc_zh` are already `TEXT` on both tables.
- **Partner store pricing** — active partners see (and pay) their tier's discounted product price in the miniapp store, with the regular price shown struck-through next to a "合伙人价 / Partner Price" badge. The discount comes from `partner_commission_config.product_discount_rates` (default 30% / 40% / 50% for light_entrepreneur / leader_partner / operations_center).
  - **Backend** `src/functions/worker/lib/partnerCommissions.js`: new `getPartnerProductDiscount(userId)` (resolves the active partner record for a user and its tier's product discount rate) and `applyPartnerDiscount(price, rate)`.
  - **Backend** `src/functions/worker/index.js`: `GET /api/store-items?openid=…` returns `partner_price_cny` / `partner_price_usd` per item plus a top-level `partner: {tier, discount_rate}` when the user is an active partner; `POST /api/orders` and `POST /api/orders/batch` apply the same discount server-side so the recorded order price matches the displayed partner price.
  - **Miniapp** `src/mini/nano-miniapp/pages/main/`: store cards show the partner price (accent color) with the regular price struck through; cart rows and the cart total use the partner price.
- **Channel-scoped partner tier customization** — root channels and permitted sub-channels can override partner tier display names, entry fees, colors, and descriptions on a per-channel basis; unpermitted sub-channels inherit from their parent.
  - **DB migration** `src/schemas/migration_partner_tiers_config.sql`: adds `can_customize_partner_tiers BOOLEAN` (permission flag, default false) and `partner_tiers_config JSONB` (null = inherit) on `channels`.
  - **Backend** `src/functions/worker/index.js`: `GET/PUT /api/channels/:id/partner-tiers-config` (walk parent chain, read/write tier config), `PUT /api/channels/:id/partner-tiers-permission` (parent admin grants flag to child).
  - **Web Admin Panel** `src/web/admin-panel/src/App.jsx`: new **Partner Tiers** tab in `ChannelConfigModal` with per-tier card editor (label EN/ZH, entry fee, color, description), source-inheritance badge, and sub-channel permission toggles. `PartnersTab` now fetches the effective tier config for the current channel and uses live labels/colors.
- **Academy System Overhaul** — upgraded the academy from a flat video library into a full continuous-learning platform for coaches with credits, tiers, quizzes, certifications, and learning paths.
  - **DB migration** `src/schemas/migration_academy_overhaul.sql` (migration #79):
    - Extended `academy_courses` with `credit_value`, `level` (foundation/intermediate/advanced/expert), `prerequisite_course_id`, `thumbnail_oss_key`.
    - Extended `academy_lessons` with `content_type` (video/text/interactive), `text_content`, `credit_value`, `min_watch_seconds`.
    - Extended `academy_coach_progress` with `credits_earned`, `quiz_best_score`, `time_spent_seconds`.
    - New `academy_lesson_quizzes` — per-lesson quiz questions with scenario text, JSONB options, and per-question credit values.
    - New `academy_quiz_attempts` — per-coach attempt record with answers, 0–100 score, pass/fail status.
    - New `academy_credit_ledger` — append-only event log separate from the monetary `credit_ledger` (reasons: `lesson_complete / quiz_pass / cert_earned / bonus`).
    - New `academy_certifications` — admin-managed cert definitions with required course list, min credits, and tier (bronze/silver/gold/platinum).
    - New `academy_coach_certifications` — certs earned by coaches (unique per coach+cert).
    - New `academy_learning_paths` and `academy_learning_path_courses` — curated ordered course sequences by tier.
  - **Backend** `src/functions/worker/index.js`:
    - Modified `GET /academy/courses`, `POST/PUT /academy/courses`, `GET /academy/lessons`, `POST/PUT /academy/lessons` to accept/return the new fields.
    - Modified `POST /academy/progress` to award lesson credits (first completion only) and auto-check certification eligibility via `_checkAndAwardCertifications()`.
    - New `GET /academy/lessons/:id` — lesson detail with quiz questions.
    - New `POST /academy/quiz-attempts` — scores submitted answers, awards credits on first pass, returns `{score, passed, credits_earned, correct_answers[]}`.
    - New `GET/POST/PUT/DELETE /academy/lesson-quizzes` — admin CRUD for quiz questions.
    - New `GET/POST/PUT/DELETE /academy/certifications` — admin CRUD for certification definitions.
    - New `GET/POST/PUT/DELETE /academy/learning-paths` — admin CRUD for learning paths with ordered course assignment.
    - New `GET /academy/coach-dashboard` — aggregated stats (credits, tier, lessons, quizzes, certs).
    - New `GET /academy/coach-credits` — credit total, tier, ledger history.
    - New `GET /academy/coach-certifications` — coach's earned certifications.
    - New `GET /academy/leaderboard` — top 20 coaches by total credits.
  - **Web Admin Panel** `src/web/admin-panel/src/App.jsx` — AcademyTab expanded from 3 to 5 subtabs:
    - **Courses**: course form adds level, credit_value, prerequisite dropdown; lesson form adds content_type toggle (Video/Text/Interactive), text editor, credit_value, min_watch_seconds; inline `QuizEditorSection` per lesson for managing quiz questions.
    - **Certifications** (new): CRUD table + modal for certification definitions — tier badge, required courses checklist, min credits.
    - **Paths** (new): CRUD table + modal for learning paths — ordered course list with up/down reordering.
    - **Progress** (enhanced): adds credits_earned and quiz_best_score columns; side panel shows top-20 leaderboard with tier badges.
    - Full bilingual (EN/ZH) localization via existing `useLang()` hook.
  - **Coach Mini-App** `src/mini/nano-miniapp/pages/coach/`:
    - Credit dashboard card at top of Training tab (total credits, tier badge, lesson/quiz/cert counts).
    - Learning paths section with per-path progress bars.
    - Lesson player: content_type routing (video → presigned OSS; text/interactive → scrollable text); quiz panel with scenario, question list, submit, score + explanations.
    - Mark-complete button gated on quiz pass (if quiz exists).
    - Certifications grid: earned badge cards + locked (grayed) not-yet-earned certs.
  - **Docs** `docs/architecture/academy-system.md` — full architecture reference.

- **Credit system for commissions** — all commission earnings (referral, coach, channel) now flow into a per-user credit ledger. Users can exchange credits for cash via a withdrawal request processed by a superadmin.
  - **DB migration** `src/schemas/migration_credit_system.sql`:
    - `credit_ledger` — append-only ledger; one row per earn or debit event; balance = `SUM(amount)` per user.
    - `credit_withdrawals` — tracks cash-out requests through `pending → approved → completed` (or `rejected`). Exchange rate is snapshotted at request time.
  - **Credit library** `src/functions/worker/lib/credits.js`: `creditUser`, `debitUser`, `getUserBalance`, `getLedgerHistory`, `getChannelExchangeRate`, `getChannelCurrency`.
  - **Commission service** `src/functions/worker/lib/commissions.js`: after each commission insert, calls `creditUser()` using the channel's exchange rate. Covers referral, coach, and channel commissions.
  - **Per-channel exchange rate**: stored in `channels.config.credit_exchange_rate` (credits per 1 unit of currency) and `channels.config.currency` (ISO code). Configurable in the Channels edit modal.
  - **Backend** `src/functions/worker/index.js`:
    - `GET /api/credits/balance` — user's balance, exchange rate, currency.
    - `GET /api/credits/history` — paginated ledger.
    - `POST /api/credits/withdraw` — submit a cash-out request (validates balance).
    - `GET /api/credits/withdrawals` — user's own withdrawal history.
    - `GET /api/admin/credit-withdrawals` — admin list, filterable by status.
    - `PUT /api/admin/credit-withdrawals/:id` — approve (triggers ledger debit) / reject / complete.
  - **Web Admin Panel** `src/web/admin-panel/src/App.jsx`:
    - Rewards tab → new **Credit Withdrawals** sub-tab: table with approve / reject / mark-completed actions.
    - Channels edit modal → **Exchange Rate** and **Currency** fields.
  - **Miniapp main page** `pages/main/main.js` + `main.wxml` + `main.wxss`: credit balance fetched on load and on show; displayed as a tinted row at the top of the header menu when balance > 0; tapping navigates to the referral page.
  - **Miniapp referral page** `pages/referral/referral.js` + `.wxml` + `.wxss`: credit balance card, cash-equivalent display, withdrawal bottom-sheet form, withdrawal history list with status badges.


- **Complete Orders Fulfillment & SKU Registry System** — comprehensive, enterprise-grade e-commerce, multi-location stock tracking, and logistics workflow across backend, mini program client, and web admin dashboards.
  - **DB Migration (`migration_orders_fulfillment.sql`)**:
    - `skus` table: centralized registry of raw physical/virtual product assets (`WD-DOT-MONTHLY`, `KINO-CHIP-V2`, etc.) mapping standard names, units, and types.
    - `inventory_stock` table: maps SKU assets to specific warehouse (`shanghai-central`) or clinic channels with quantities and low-stock warning thresholds.
    - Extended `orders` table: adds support for shipping recipient name, phone, address, carrier name, tracking numbers, shipped/delivered timestamps, and asset serial logs.
  - **Worker Backend (`index.js`)**:
    - Extended `handlePostOrder` to extract `sku_id` and perform atomic location-scoped stock checks and decrements.
    - Upgraded `handlePutOrder` to log shipped/delivered timestamps and implement **auto-restock on cancellation** (cancelling orders automatically returns stock to locations).
    - Upgraded `handleGetMyOrders` and `handleGetOrders` to resolve joined custom names, units, and tracking data via `skus` fallbacks.
    - Added SKU CRUD APIs (`GET/POST/PUT/DELETE /api/skus`) and Stock Adjustments APIs (`POST /api/inventory-stock`).
  - **WeChat Mini Program Client**:
    - Integrated native WeChat address picker (`wx.chooseAddress`) with developer mock fallbacks.
    - Upgraded order cards with recipient details, collapsible logs, click-to-copy courier codes (`wx.setClipboardData`), and client-side cancellation actions.
    - Fixed shortId fallback naming rendering bug in client-side order listings.
  - **Web Admin Panel Dashboard (`App.jsx`)**:
    - Added collapsible order drawer rows displaying shipping address cards, fulfillment logs, and payment states.
    - Built a premium glassmorphic **Fulfillment & Shipping Modal** to collect courier carrier, tracking code, logistical comments, and pre-printed hardware serial IDs.
    - Built the **SKUs & Stock Registry Subtab** inside the Store Management page with comprehensive SKU CRUD modals (`SkuModal`, `DeleteSkuConfirm`) and a premium **Location Stock Adjuster Widget** (`StockAdjustModal`) with low-stock warnings.
    - Added SKU binding selectors to both global `StoreItemModal` and channel-specific `ChannelInventoryItemModal`.
- **Coach Groups** — business entity groupings (clinics, studios, nutrition stores) within a channel, enabling group-level KPI aggregation.
  - **DB migration** `src/schemas/migration_coach_groups.sql`: new `coach_groups` table (`id, channel_id, name, description, type`); adds nullable `group_id` FK on `coaches`.
  - **Backend** `src/functions/worker/index.js`:
    - `GET /api/coach-groups?channel_id=X` — list groups with `coach_count` per group.
    - `POST /api/coach-groups` — create a group (channel-scoped).
    - `PUT /api/coach-groups/:id` — update name/description/type.
    - `DELETE /api/coach-groups/:id` — delete group; `ON DELETE SET NULL` FK ungroups coaches automatically.
    - `GET /api/coach-group-kpis?group_id=X&period=YYYY-MM` — aggregate KPIs across all coaches in the group; uses `coach_performance_snapshots` for historical months, live SQL for current month.
    - `GET /coach-list` and `GET /channel-coaches/:id` — now return `group_id` and `group_name` per coach.
    - `POST /coaches` and `PUT /coaches/:id` — now accept optional `group_id`.
  - **Web admin panel** `src/web/admin-panel/src/App.jsx`:
    - **CoachTab**: group filter pills, "Group" column in coach table, inline group management panel (add/edit/delete groups), group assignment in `CoachModal`.
    - **CoachCRMTab**: new "Groups" sub-tab showing aggregate stat cards + KPI table + per-coach breakdown for the selected group.

### Changed
- **Coach / user architecture rationalized** — `users` is now the single source of truth for coach identity. The `coaches` table is a thin "coach seat" (`id, user_id NOT NULL UNIQUE, channel_id, created_at`); all profile data (name, email, phone, avatar_url, language) is read from the linked `users` row via JOIN.
  - **DB migration** `src/schemas/migration_rationalize_coaches.sql`: enforces `coaches.user_id NOT NULL UNIQUE`, changes FK to `ON DELETE CASCADE`, drops the duplicated profile columns. A follow-up `migration_rationalize_coaches_fix.sql` ensures the drops are applied where the first migration was tracked but rolled back.
  - **Worker** `src/functions/worker/index.js`:
    - `GET /coach-list` and `GET /channel-coaches/:id` now JOIN `users` for profile fields; response shape is unchanged (same field names).
    - `GET /users`, `GET /channel-users/:id`, `GET /wx-login` — `coach_name` now comes from the linked coach's `users.nickname` instead of the dropped `coaches.name` column.
    - `POST /coaches` — `user_id` is now required; inserts only `(user_id, channel_id)`; always adds `'coach'` role to the linked user.
    - `PUT /coaches/:id` — updates only `user_id` and `channel_id`; profile edits go through `PUT /users/:id`.
    - `DELETE /coaches/:id` — **bug fixed**: now removes `'coach'` role from the linked user after deletion; blocked with 409 if the coach still has assigned users.
    - `PUT /users/:id` — **new**: assigning the `'coach'` role automatically creates a `coaches` row (using the user's `channel_id`); removing the `'coach'` role deletes it. Removal is blocked with 409 if users are still assigned.
    - `GET /users` — results now ordered by `created_at DESC` (newest first).
  - **Web admin panel** `src/web/admin-panel/src/App.jsx` — `CoachModal` replaced name/email/phone/language inputs with a live user-search picker; only `user_id` and `channel_id` are submitted.
  - **Miniapp admin panel** `src/mini/nano-miniapp/pages/admin/` — coach add/edit form replaced with a native picker over the channel's user list.
  - **Miniapp coach panel** — no change required; only uses `coach.id` and `coach.channel_id` from the login response.

### Added
- **External lab integration (`nano-lab`)** — new Aliyun FC function that ingests clinical lab results from third-party laboratory systems and feeds them back into the BioAge pipeline.
  - **New FC function** `src/functions/lab/` (512 MB, 600 s timeout): routes `POST /lab/webhook/:labName` (push — lab notifies Nano) and a 4-hour timer trigger (pull — Nano polls the lab API). Both paths converge on the same normalization and storage pipeline.
  - **Adapter registry** `src/functions/lab/lib/adapters/`: each lab is one file implementing `{ validateWebhook, fetchOrder, fetchNewResults, parseResponse }`. `generic.js` ships as a reference implementation. Adding a lab = one file + one `lab_providers` row + redeploy.
  - **DB migrations**:
    - `migration_biomarker_catalog.sql` — `biomarker_catalog` table: registry of all 26 known biomarkers (6 Kino core + 20 clinical panel) with LOINC codes, Chinese display names, units, categories, `nano_dimension` mapping, and reference ranges.
    - `migration_health_reports.sql` — `health_reports` table: document-level wrapper for complete lab/health report uploads (institution, date, status, OSS key, raw observations). Adds `report_id` FK to `health_events`.
    - `migration_lab_user_mappings.sql` — `lab_user_mappings` table: maps each lab's patient identifier to a Nano `user_id`. Fallback: phone number match.
    - `migration_lab_providers.sql` — `lab_providers` table: per-lab instance credentials, base URL, polling state, and soft-delete flag. Supports multiple regional instances of the same lab.
  - **EventBridge integration**: on ingestion, if ≥1 Kino core biomarker is found, `nano-lab` publishes `{ source: 'acs.lab', type: 'biomarker.lab_complete', data: { report_id, user_id } }` using FC context credentials (same pattern as the dispatcher).
  - **Worker: `handleLabImportEvent`** — new EventBridge handler in `src/functions/worker/index.js`. Loads the report's Kino core observations, fills missing values via `BiomarkerEstimator`, runs `BioAgeCalculator`, inserts a `biomarkers` row with `test_type='lab_import'`, and calls `updateHealthTwin`.
  - **Worker: health report API routes** — `POST /health-reports` (store a report with raw observations or a FHIR R4 Bundle), `POST /health-events/fhir` (alias with `source='fhir_import'`), `GET /health-reports` (list by user), `GET /health-reports/:id` (report + linked events).
  - **Worker EventBridge CloudEvent detection** — the handler now checks for `event.specversion` before HTTP routing and short-circuits to the appropriate CloudEvent handler; returns 200 immediately for all EventBridge invocations.
  - **`tagRegistry.js`**: restored `BIOMARKER_DEFINITIONS` export (6 Kino biomarkers with LOINC codes + units) that was removed by a previous linter pass.
  - **`s.yaml` / `s-prod.yaml`**: `lab:` function block added; worker EventBridge filter extended to `["acs.dispatcher","acs.lab"]`; domain routes `/lab/*` and `/lab` added.
  - **`package.json`**: `deploy:lab` and `deploy:lab:prod` scripts added.
  - **Architecture doc** `docs/architecture/lab-integration.md`.

- **Digital Twin health profile system** — continuous wearable/lifestyle data stored as a two-layer model alongside the existing Kino chip biomarkers.
  - **DB migrations** `src/schemas/migration_health_events.sql` and `src/schemas/migration_health_twin.sql`: append-only event log (`health_events`) for all time-series health data and a one-row-per-user materialized summary (`health_twin`) with 7-day rolling averages, latest body/lab/Kino values, and 30-day trend signals.
  - **Five event categories**: `sleep`, `activity`, `vitals`, `body_composition`, `lab_result`. Six data sources: `apple_health`, `garmin`, `fitbit`, `manual`, `annual_lab`, `hospital`. Deduplication via `UNIQUE (user_id, source, external_id) WHERE external_id IS NOT NULL`.
  - **Real-time updater** `src/functions/worker/lib/healthTwinUpdater.js`: `updateHealthTwin(userId, pool)` runs aggregation queries and UPSERTs `health_twin` after every event insert. Non-fatal — ingestion never fails due to twin computation errors.
  - **Worker API routes**: `POST /health-events` (single event), `POST /health-events/sync` (batch up to 500), `GET /health-events` (paginated query), `GET /health-twin` (full twin row).
  - **AI prompt integration**: `health_twin` is always fetched alongside questionnaire data in `handlePostChat` and passed to intent-specific prompts (`chat/biomarker.js`, `chat/nutrition.js`, `chat/emotional.js`); `handlePostHealthAdvice` includes a full `DIGITAL TWIN` section in the system prompt with a "Lifestyle Connection" reasoning step.
  - **Miniapp health tab** (`components/user-health/`): Digital Twin section at the bottom of the health tab with a visual health dashboard:
    - **Health Score card** — 0–100 aggregate score with grade label (优秀/良好/一般/偏低) and per-domain breakdown bars (Recovery, Cardio, Activity, Body).
    - **Vital gauge rows** — each metric (Sleep, HRV, Resting HR, SpO₂, Daily Steps) rendered as a color-zoned track (red/orange/green/blue clinical ranges) with a floating dot marker at the user's current value, trend arrow, and optimal-range sublabel.
    - **Body composition bar** — horizontal segmented bar: lean mass (green gradient) and fat (orange gradient) with percentage legend.
    - **Source coverage chips** — shows which data streams have data and their last sync date.
  - **Scoring functions** (`user-health.js`): `_scoreSleep`, `_scoreHrv`, `_scoreRestHr`, `_scoreSpo2`, `_scoreSteps`, `_scoreBmi` map raw metric values to 0–100 health scores using clinically meaningful thresholds; domain scores are averaged into Recovery, Cardio, Activity, and Body composites.
  - **Demo seed script** `temp/seed-pin-digital-twin.js`: inserts 14 days of realistic data across all 5 categories for user Pin and calls `updateHealthTwin`.
  - **Architecture doc** `docs/architecture/digital-twin.md`.

- **Coach CRM system** — full production-grade CRM across DB, API, miniapp, and web admin panel.
  - **DB migrations** `src/schemas/migration_coach_crm_phase{1–5}.sql`: 12 new tables — `client_tags`, `client_tag_assignments`, `client_pipeline_stages`, `coach_client_notes`, `client_activity_log` (Phase 1); `message_templates`, `bulk_message_campaigns`, `bulk_message_recipients` (Phase 2); `appointments`, `client_goals` (Phase 3); `client_nps_surveys`, `coach_performance_snapshots` (Phase 4); `follow_up_rules` (Phase 5).
  - **Worker API** (`src/functions/worker/index.js`): 35+ new routes covering tags, pipeline stages, notes, activity log, message templates, bulk campaigns, appointments, client goals, NPS surveys, coach KPIs, and follow-up rules. `handleGetCoachUsers` extended to support `?stage=` and `?tag_id=` filters via LEFT JOINs. `refreshGoalProgress(userId)` called fire-and-forget after every Kino scan to auto-advance goal milestones. `logActivity()` helper writes to `client_activity_log` fire-and-forget throughout all handlers.
  - **Miniapp coach page** (`src/mini/nano-miniapp/pages/coach/`): two new tabs added — **CRM** (pipeline kanban by stage, upcoming appointments, cross-client activity feed, appointment booking modal) and **Performance** (KPI grid, top improvers leaderboard). Client cards now show stage pill and tag chips. Client detail sheet gains **Notes** tab (pinned-first list, compose, long-press actions) and **Goals** tab (progress bars, goal-type picker with target value/date). Message template picker added to chat compose area. 7 new tabs total.
  - **Web admin panel** (`src/web/admin-panel/src/App.jsx`): new **Coach CRM** nav item (using `Target` icon from lucide-react) renders `CoachCRMTab` with 4 sub-tabs — **Pipeline** (coach selector, Recharts stage-distribution BarChart, client table with stage badge + bio-age delta + tags), **Campaigns** (bulk campaign table with send action, create draft modal with stage filter), **Performance** (period picker, coach comparison table with all KPI columns), **NPS** (date-range filter, response table, aggregate promoter/passive/detractor cards + NPS score).

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
- **Store item images returning 403 in production** — 7 store items had `image_url` values signed with a rotated OSS access key (`LTAI5t9hF93pvWC8BiDpMXiy`). Because OSS validates presigned URLs against the key that signed them, rotating the key immediately invalidates all URLs generated with the old key. Fix: `temp/fix-prod-store-image-urls.js` extracts the OSS object key from each stored URL, regenerates a 10-year presigned GET URL with the current credentials, and updates the prod DB row. **Operational note:** any time `OSS_ACCESS_KEY_ID` is rotated, all presigned GET URLs stored in the database (currently `store_items.image_url`, `channel_inventory.image_url`, `chat_messages.image_url`) will break and must be regenerated.
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
