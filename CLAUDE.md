# Waven Nano AI Backend

# Project Rules

## 1. Project Context

- **Name:** Waven Nano AI (Precision Health Ecosystem)
- **Tech Stack:** Node.js (Latest LTS), PostgreSQL 14 (Aliyun PolarDB Serverless)
- **Architecture:** Serverless Event-Driven (Aliyun FC 3.0 + EventBridge)
- **Infrastructure:** All production code must respect Aliyun FC 3.0 constraints (max 24h runtime, stateless execution).

## 2. Dev vs Prod Environments

There are two separate PolarDB databases. Both share the same Aliyun account and VPC.

| | Dev | Prod |
|---|---|---|
| DB name | `nano_db_dev` | `nano_db_prod` |
| s.yaml config | `s.yaml` | `s-prod.yaml` |
| Deploy scripts | `deploy:worker`, `deploy:dispatcher`, etc. | `deploy:worker-prod`, `deploy:dispatcher-prod`, etc. |
| Connection var | `DATABASE_URL` | `DATABASE_URL_PROD` |
| Migrate | `npm run migrate:dev` | `npm run migrate:prod` |

**Always develop and test on dev first. Never run untested SQL directly on prod.**

### Miniapp Backend Selection

The WeChat Mini Program (`src/mini/nano-miniapp/`) automatically selects the backend URL based on its `envVersion`:

- **`develop`** (IDE/Local Dev): `https://nano-dev.gcn.net`
- **`trial`** (Preview/Experience): `https://nano.gcn.net`
- **`release`** (Production): `https://nano.gcn.net`

This ensures that only developers in the IDE touch the dev environment, while all uploaded versions (including previews) use the production backend. Logic resides in `src/mini/nano-miniapp/utils/config.js`.

### Miniapp VERSION Marker

`src/mini/nano-miniapp/utils/config.js` exports a `VERSION` string (format `MMDD-N` — month+day, build number that day). **Bump it on every code change under `src/mini/nano-miniapp/`** (WXML/WXSS/JS, any page or util), no matter how small — the miniapp has no build pipeline and no other way to confirm a WeChat DevTools preview/upload is actually running the latest code versus a stale cached compile. Increment `N` for another change the same day; reset to `-1` on a new date. This is a bare `const`, no build step reads it — just edit the literal.

### WeChat Domain Setup

See [docs/wechat-domain-setup.md](docs/wechat-domain-setup.md) for request domain whitelist troubleshooting and business domain verification steps.

### Dev/prod deploy commands

```bash
# Dev
npm run deploy:worker
npm run deploy:dispatcher

# Prod
npm run deploy:worker-prod
npm run deploy:dispatcher-prod
```

## 3. Database Migrations

Schema changes are tracked in a `schema_migrations` table and applied via `scripts/migrate.js`. **Never apply ad-hoc SQL directly to prod** — always write a migration file so it is tracked.

### Migration workflow

1. Write SQL as `src/schemas/migration_<name>.sql` (use `IF NOT EXISTS` for idempotency)
2. Apply to dev: `npm run migrate:dev`
3. Test, then apply to prod: `npm run migrate:prod`

### Key commands

```bash
npm run migrate:status        # show pending migrations on dev
npm run migrate:status:prod   # show pending migrations on prod
npm run migrate:dev            # apply pending to dev
npm run migrate:prod           # apply pending to prod
```

Full details: `docs/architecture/database-migrations.md`

## 4. Core Technical Constraints

- **Database:** Use the `pg` library for raw SQL. **STRICTLY PROHIBITED:** No ORMs (like Prisma or TypeORM) to minimize cold-start latency and overhead.
- **SQL Standards:** PostgreSQL 14 compatible syntax. Use `ON CONFLICT` for upserts.
- **Messaging:** Follow **CloudEvents 1.0** standards for all event payloads.
- **AI Logic:** The AI Worker must decouple prompt engineering from execution. Prompts should be stored in `/prompts` as template files.

## 5. Directory Structure & Naming

- `/src/functions/dispatcher/`: FC 3.0 code for user scanning (Cron-triggered).
- `/src/functions/worker/`: FC 3.0 code for AI processing and WeChat notifications.
- `/src/lib/`: Shared logic (Database clients, WeChat API helpers).
- `/src/schemas/`: JSON Schema files for event validation.
- `/src/mini/nano-miniapp/`: WeChat Mini Program frontend (WXML/WXSS/JS, no build pipeline).
  - The **Kino Simulator** is implemented as a native WXML overlay inside `pages/main/` — it is not an iframe or externally loaded resource. All UI, state, and logic live in `main.wxml`, `main.wxss`, and `main.js`. Only the biomarker result data is fetched remotely (`/api/biomarkers`).
  - This miniapp Kino Simulator is unrelated to the web simulator iframes in `/src/web/admin-panel` (`/admin/sim/...`). The old web Kino simulator (`/admin/sim/kino/`) has been removed; only the Chat and Coach web simulators remain.
  - The Mini Program can be compiled into native iOS/Android applications using the WeChat Donut Multiterminal framework. For structural details, tooling, native plugin integration, and OTA hot updates, see [wechat-multiterminal.md](docs/architecture/wechat-multiterminal.md).
- `/tests/mocks/`: Local EventBridge and MNS simulation scripts.
- `/src/web/admin-panel`: **Web Admin Panel** — React (Vite) SPA served by the FC worker. Full superadmin control: users, coaches, dots, store, channels, invites, simulators. Built with `npm run build` inside that directory; output goes to `src/functions/admin-panel/dist/`. Referred to as the **"web admin panel"**.
- `/src/mini/nano-miniapp/pages/admin/`: **Miniapp Admin Panel** — WeChat Mini Program page for channel-scoped admins. Manages users, coaches, store items, and invite codes within a single channel. No build step (native WXML/WXSS/JS). Referred to as the **"miniapp admin panel"**.
- `/src/mini/nano-miniapp/pages/superadmin/`: **Miniapp Superadmin Panel** — WeChat Mini Program page for superadmins. Global view of channels, users, coaches, dots (with full ingredient editing), and invites. Referred to as the **"miniapp superadmin panel"**.
- **File Naming:** kebab-case (e.g., `user-repository.js`).

## 6. Coding Standards (Node.js)

- **Style:** Modern ES Modules (`import/export`).
- **Error Handling:** Every async operation MUST be wrapped in a `try/catch` block.
- **Logging:** Use `console.log` for Aliyun CloudWatch integration, but format as JSON: `console.log(JSON.stringify({level: 'INFO', msg: '...', data: {}}))`.
- **Latency:** Keep the `lib/db.js` client outside the handler to leverage Aliyun container reuse.

## 7. Local Development & Testing

- Use `.env` for local variables. Never hardcode the PolarDB endpoint.
- **Command:** Run `npm run test:local` to trigger the `local-bus.js` harness.
- **Git:** Never commit without the user explicitly asking for it in that session — not even to satisfy a "commit after every build" habit. When a commit is requested, split it into one commit per modular component rather than bundling everything together.

## 8. AI Interaction Rules

- Before suggesting a change, check `src/schemas/` to ensure you aren't breaking the event contract.
- If writing a new Aliyun FC handler, always provide the `s.yaml` (Serverless Devs) configuration snippet.
- Prioritize **token efficiency**: Don't rewrite entire files if only one function needs a fix.

## 9. Changelog for code changes

- CHANGELOG.md

## 10. Role System

- 4 roles: `user`, `coach`, `admin`, `superadmin` — stored as `TEXT[]` on `users.roles`.
- A single WeChat openid can hold multiple roles simultaneously.
- Channel scoping is implicit via `users.channel_id`; no separate role-junction table.
- Coach role is auto-managed when `coaches.user_id` FK is set/unset.
- **`coaches` has NO `channel_id` column.** A coach's channel is always `users.channel_id` for the linked `user_id`. All channel-scoped coach queries join `coaches → users → channels`. Dropped via `migration_coaches_drop_channel_id.sql`.
- Full details: `docs/architecture/role-system.md`

## 11. The Four Sub Bio Ages

Waven Nano measures biological age across four independent dimensions. Each dimension produces a **sub-age** (in years) that contributes equally to the combined `BioAge`.

> **Canonical source:** When referring to `BiomarkerEstimator` or `BioAgeCalculator`, the canonical (production) versions are in `src/functions/worker/lib/`. The copies under `src/lib/` are mirrors kept in sync but are not used at runtime. All calibration changes, tests, and fixes go to the worker copies first.

### Canonical keys

These exact strings are used everywhere — in `bioage_profile.SubAges`, the `dots.sub_age_target` column, and any code that routes biomarkers to dots:

| Key (code)                   | English display    | Chinese display | DB value (`sub_age_target`) |
| ---------------------------- | ------------------ | --------------- | ----------------------------- |
| `SubAges.CellularAge`      | Cellular Age       | 细胞年龄        | `Cellular Age`              |
| `SubAges.MetabolicAge`     | Metabolic Age      | 代谢年龄        | `Metabolic Age`             |
| `SubAges.MicroVascularAge` | Micro-Vascular Age | 微血管年龄      | `Micro-Vascular Age`        |
| `SubAges.ResilienceAge`    | Resilience Age     | 抗压年龄        | `Resilience Age`            |

### Dimension details

#### 1. Cellular Age (`CellularAge`)

- **What it measures:** Raw vitality of individual cells — NAD+ metabolism, senescence burden, sirtuin activity.
- **Input biomarkers:** `GDF-15` (pg/mL), `CD38` (fold-change above 1.0)
- **Reference ranges:**
  - GDF-15: `<750` normal · `750–1500` elevated · `>1500` accelerated aging
  - CD38: `~1.0` baseline; each fold above 1.0 degrades NAD+ faster
- **Scoring:** Hill function on GDF-15; linear penalty on CD38; equal-weighted average
- **Target dots:** DOT01 (NMN), DOT02 (Apigenin/CD38 inhibitor), DOT03 (Trans-Resveratrol), DOT04 (senolytic blend), DOT06 (Collagen matrix), DOT10 (Dynamine+TeaCrine)

#### 2. Metabolic Age (`MetabolicAge`)

- **What it measures:** Fuel-burning efficiency and mitochondrial throughput.
- **Input biomarker:** `GA` — Glycated Albumin (%)
- **Reference ranges:** `<15%` normal · `15–20%` elevated · `>20%` metabolic dysfunction
- **Scoring:** Sigmoid centered at 14.5%; if `ResilienceAge` score < 4, a 10% coupling penalty is applied (high inflammation degrades metabolism)
- **Target dots:** DOT05 (Urolithin A + Ca-AKG), DOT07 (PQQ), DOT11 (Cordyceps + Rhodiola)

#### 3. Micro-Vascular Age (`MicroVascularAge`)

- **What it measures:** Capillary health and nutrient/O₂ delivery to tissues.
- **Input biomarker:** `Cystatin C` (mg/L)
- **Reference ranges:** `<0.9` normal · `0.9–1.2` elevated · `>1.2` vascular/renal stress
- **Scoring:** Exponential decay from optimal threshold of 0.68 mg/L
- **Target dots:** DOT08 (Vascular Awakening — Beta-Alanine, Niacin, Methyl-B), DOT13 (CoQ10 + Nattokinase), DOT14 (D3 + K2 + MCT)

#### 4. Resilience Age (`ResilienceAge`)

- **What it measures:** Capacity to buffer chronic stress and suppress systemic inflammation.
- **Input biomarkers:** `hsCRP` (mg/L), `IL-6` (pg/mL)
- **Reference ranges:**
  - hsCRP: `<1` normal · `1–3` elevated · `>3` high inflammation
  - IL-6: `<3` normal · `3–6` elevated · `>6` high inflammation
- **Scoring:** Exponential decay from optimal thresholds (0.5 mg/L CRP, 1.5 pg/mL IL-6); equal-weighted
- **Target dots:** DOT09 (Curcumin), DOT12 (Deep Sleep stack), DOT15 (Kanna + Saffron), DOT16 (Glutathione + NAC), DOT17 (Gut + Microbiome), DOT18 (Immunity + Gastric)

### Data flow

```
Kino chip scan
  → raw biomarker values (hsCRP, IL-6, GDF-15, CD38, GA, CystatinC)
  → BioAgeCalculator.calculateBioAge(chronoAge, biomarkers)
  → bioage_profile = { BioAge, ChronoAge, SubAges: { CellularAge, MetabolicAge, MicroVascularAge, ResilienceAge }, Scores, ... }
  → stored in biomarkers.data JSONB column
  → systemNutrition prompt uses bioage_profile + biomarkers
  → dots.sub_age_target drives which dots are prioritized per elevated dimension
```

### Coupling rule

`MetabolicAge` is the only dimension with cross-dimension coupling: when `ResilienceAge` score < 4 (severe inflammation), Metabolic scoring takes a 10% penalty. This reflects the biological reality that chronic inflammation accelerates metabolic dysfunction.

## 12. Aliyun Function Compute 3.0 (FC 3.0) Runtime Behavior

FC 3.0's HTTP-trigger handler invocation model, event object shape, and response format differ from Express/Lambda conventions in ways that are easy to get wrong. Full reference (confirmed by live debugging): `fc3-handler-reference` skill — load it before writing or modifying an FC handler.

## 13. Kino Hardware System

The Kino hardware ecosystem has two distinct physical components, managed separately.

### Kino Device (Reusable)

- Physical reader unit deployed at a clinic or partner location
- Table: `kino_devices` — serial number, name, coach/channel assignment, status (`active` / `inactive` / `maintenance`)
- Every biomarker record ingested via a device stores `kino_device_id` in `biomarkers.kino_device_id`
- Migration: `src/schemas/migration_kino_devices.sql`
- Admin Panel: **Kino** tab

### Kino Chip (Disposable, Single-Use)

- NFC test chip with biochemical reagent layer — one scan per chip
- Chips are issued in **batches**: each batch has a unique 8-digit code (`KNC{8digits}`) and a `model` that FK-references `kino_chip_models.code`
- **Chip code format:** `KNC{8-digit-batch}-{4-digit-sequence}` e.g. `KNC12345678-0001`
  - The chip code IS the QR code value scanned by the Mini Program
  - Max 9,999 chips per batch
- Tables: `kino_chip_batches` (prefix, model, quantity), `kino_chips` (chip_code, status)
- Chip status: `available` → `used` (after scan completed) or `damaged`
- Migration: `src/schemas/migration_kino_chips.sql`
- Admin Panel: **Chips** tab → **Batches** sub-tab — add batches, view QR codes, download CSV, print

### Kino Chip Model (per-chip-type config)

- Table `kino_chip_models` — one row per chip type (`K2`, future `K6`, `S1`, …). FK target of `kino_chip_batches.model`.
- Carries `biomarker_keys` (which biomarkers the chip outputs) and `config` JSONB (verbatim `card_config` consumed by the Kino reader: `scan_ppmm`, `top_list`, `var_list`, `cut_off*`, noise floors, …) plus optional `guide_video` / `guide_text` and a `status` (`active` / `inactive`).
- `GET /kino-chip` joins through to expose `model`, `biomarker_keys`, `chip_config`, `guide_video`, `guide_text` to the Mini Program at scan time.
- Migration: `temp/migration_kino_chip_models.sql` (one-shot runner: `node temp/run-migration-kino-chip-models.js`).
- Admin Panel: **Chips** tab → **Models** sub-tab — full CRUD; delete is blocked while any batch references the model. Inactive models are hidden from the Add Batch dropdown but still resolve for existing batches.
- Full details: `docs/architecture/kino-system.md`

### Scan Flow

```
QR scan in Mini Program → POST /kino-scan (links chip to user)
  → POST /biomarkers (raw values → BioAge calculation)
  → POST /kino-result (marks scan completed, chip becomes "used")
```

Full details: `docs/architecture/kino-system.md`

## 14. Dots System

Waven Dots are 24 mg precision nutrition cartridges. Each cartridge delivers one or more active compounds in an exact dose, calibrated to the user's biomarker profile. The system targets four biological age dimensions measured by the Kino chip. The Dots can be mixed by AI at realtime according to the user's actual health data.

### Cartridge Format

- **Payload:** 24 mg per dot
- **Pack size:** 800 dots per cartridge
- **Timing:** Morning or Evening (fixed per dot — set by the `timing` column in the `dots` table)
- **Types:** Isolates (single active compound) and Blends (two or more actives)

## 15. TEMP Folder
- location: ./temp
- save one time scripts such as migration scripts in the temp folder

## 16. AI Persona System

The platform supports multiple AI personas, routed at the **channel level** via `channels.config.persona_type` (JSONB field, default `'nano'`).

### Personas

| Persona | Brand | LLM | Prompt language | Domain |
|---|---|---|---|---|
| `nano` | Waven Nano | DashScope (Qwen) | Bilingual (zh/en via `user.language`) | Kino biomarkers, BioAge, Dots nutrition |
| `viva` | Aeviva | Alibaba Qwen Plus | Pure Chinese (simplified) | Developer-defined — prompts in `prompts/viva/` |

### How routing works

1. `handlePostChat` calls `resolveOrUpsertUser` (which returns `channel_id`).
2. The channel's `config.persona_type` is fetched from the `channels` table.
3. `personaType` defaults to `'nano'` if the field is absent or the channel lookup fails.
4. The active prompt set (`nanoPrompts` or `vivaPrompts`) and LLM context are selected accordingly.
5. Every `chat_messages` row stores `persona_type` — conversation history is scoped per persona so histories never bleed across personas.

### Prompt directory layout

```
src/functions/worker/prompts/
  nano/                  ← Nano-specific prompts (bilingual)
    systemChat.js
    systemHealthAdvice.js
    systemHealthReport.js
    systemNutrition.js
    systemReport.js
    chat/
      casual.js  biomarker.js  nutrition.js  science.js
      record.js  reminder.js   emotional.js
  viva/                  ← Viva-specific prompts (pure Chinese)
    systemChat.js
    systemHealthAdvice.js
    systemHealthReport.js
    systemNutrition.js
    systemReport.js
    chat/
      casual.js  biomarker.js  nutrition.js  science.js
      record.js  reminder.js   emotional.js
  chat/
    intentClassifier.js  ← shared, persona-agnostic
  strings.js             ← shared UI strings
  systemAdminReport.js   ← shared admin report prompt
```

### Assigning a persona to a channel

Update `channels.config` via the admin panel (Channels tab) or directly in the DB:
```sql
UPDATE channels SET config = config || '{"persona_type":"viva"}' WHERE id = <channel_id>;
```

### Adding or modifying Viva prompts

Edit files under `src/functions/worker/prompts/viva/`. All Viva prompts are pure Chinese — do not add `isZh` branching. Deploy with `npm run deploy:worker`.

### DB migration

`chat_messages.persona_type` was added via `src/schemas/migration_chat_messages_persona_type.sql`. Existing rows default to `'nano'`.

## 17. Biomarker Actual vs Validated — Never Merge Actual Over Validated

`data.validated` (stored in the `biomarkers` table) is the **single source of truth** for biomarker values used in AI outputs. When passing biomarker values to any LLM prompt, always use `data.validated`, never merge `data.actual` on top of it.

### Why

`BiomarkerEstimator` validates each submitted value against a physiologically plausible range before accepting it. When a submitted value is within range, the estimator stores it as `validated` (so validated = actual). When a submitted value is out of range or missing, the estimator generates a plausible replacement. The BioAge calculation always runs on `data.validated`.

`data.actual` is the **raw unvalidated** value from the Kino reader. Merging it over `validated` in a prompt can pass an out-of-range value directly to the LLM while the stored BioAge was computed with the validated value — creating a contradiction in the report.

### The bug (fixed 2026-06-07)

`handlePostHealthAdvice` used `{ ...validatedBm, ...actualBm }`, which let `actual.hsCRP = 0.14` (below the estimator's 0.2 minimum) overwrite `validated.hsCRP = 1.02`. The LLM narrated "hsCRP = 0.14, excellent health" while the stored ResilienceAge had been scored with 1.02 — an internal contradiction visible to the user.

**Fix:** Use `validatedBm` directly (`src/functions/worker/index.js`, `handlePostHealthAdvice`).

### Rule for new code

When reading from `biomarkers.data` to feed an LLM prompt or build a user-facing biomarker summary:

```js
// CORRECT — validated, consistent with BioAge calculation
const biomarkers = latestBio?.data?.validated || {};

// WRONG — raw value can bypass estimator validation
const biomarkers = { ...latestBio?.data?.validated, ...latestBio?.data?.actual };
```

`data.actual` is for audit/debug purposes only. Do not use it to override `data.validated` in any user-facing output.

## 18. Wearable Ring System — Halo + V8 Only

**As of 2026-07, only Halo (`brand === 'halo'`) and V8 (`brand === 'v8'`) are actively supported.** Halo is our product name for the X3/X6/X9/V4 hardware family — X3, X6, and X9 are rings, V4 is a wrist-worn band; all four share the identical BLE protocol (confirmed, not assumed). V8 is a smart band from the same hardware team — a close protocol relative of Halo (same GATT UUIDs, same frame format, ~20 shared opcodes) but not identical (e.g. opcode `0x57` means something different on each) — see `docs/architecture/v8-smart-band.md`. BLE-advertised names literally start with the manufacturer's own model prefixes (`HALO_NAME_PREFIXES` in `halo/protocol.js`, `V8_NAME_PREFIXES` in `v8/protocol.js`) — not something we control or rename. Colmi and Aizo adapters (`src/mini/nano-miniapp/utils/wearable/colmi/`, `.../aizo/`) still exist in the codebase and must keep working for any users already bound to them, but **do not extend, "improve," or bug-fix their protocol/parsing code** — no new features, no refactors, no reuse-driven cleanups that touch `colmi/` or `aizo/`. All new wearable work (protocol changes, new data types, sync/backend changes, HealthTab UI) targets Halo and V8 only.

- `'x3'` is a legacy brand value from before the X3→Halo rename (2026-07) — still present in local storage / server rows for anyone bound before the rename shipped. `createWearable()` and the miniapp's `_normalizeBrand()` helper accept it as an alias for `'halo'`; don't remove that compat path without a data migration for existing bindings.
- Canonical Halo protocol + BLE implementation: `src/mini/nano-miniapp/utils/wearable/halo/` (`protocol.js` for packet builders/BCD parsing, `index.js` for the BLE-driven `HaloRing` class — also exports pure parsing helpers as `HaloRing.parsers` for reuse outside the wx.* BLE stack). The literal hardware name prefixes (`HALO_NAME_PREFIXES = ['X3', 'X6', 'X9', 'V4']`) must stay as-is — only the internal identifiers around them were renamed. Brand detection during scan (`user-health.js`) checks against this array directly rather than hardcoding individual prefixes, so adding a future model line is a one-line change there.
- Standalone debugging CLI for the Halo protocol (Node/noble, no phone required): `tools/halo/` — run with no arguments to dump every stored data type from a nearby ring. See its README for usage. `--device v8` targets V8 instead.
- V8 adapter: `src/mini/nano-miniapp/utils/wearable/v8/` (`protocol.js` + `index.js` for the `V8Band` class), registered as brand `'v8'` in `utils/wearable/index.js`. Wired into `user-health.js`'s bind/sync/interval-settings flow alongside Halo via a shared `_hasIntervalSettings(brand)` helper — their sync shapes are identical so this reuses Halo's code paths rather than duplicating them. Some fields are deliberately left `null` rather than guessed — notably sleep stage (deep/light/rem/awake) breakdown, since V8's raw stage codes don't match Halo's confirmed enum and mislabeling would be worse than a gap. Full protocol reference and the complete list of what didn't carry over 1:1 from Halo: `docs/architecture/v8-smart-band.md` §6–7.
- `HaloRing._stream()` resolves with whatever data has accumulated on timeout rather than rejecting — rings with a large unsynced backlog (sleep, HR log, temperature history) can take well over the 8–15s per-command timeout to fully stream. Do not revert this to a hard reject; every caller already expects partial results over a full failure.
- Server-side ring binding (`users.wearable_brand/wearable_mac/wearable_name/wearable_bound_at`, migration `migration_wearable_binding.sql`) is brand-agnostic in the DB/API layer, but in practice `wearable_mac` is only populated for Halo and V8 (the only brands implementing `getMac()`).
- Full Halo BLE protocol reference: `docs/architecture/halo-smart-ring.md`. The Colmi-focused `docs/architecture/wearable-system.md` predates Halo/Aizo and is kept for historical/OEM-transition context only — don't treat it as current guidance for new work.

## 19. GCN Integration (Aeviva Partner Storefront)

The `aeviva` nano channel's partner storefront, wholesale/resale inventory, and manual-QR checkout live in a separate sibling repo, `/Users/pin/waven/gcn`. Nano stays the source of truth for partner identity, MLM tier, and referral/commission math; GCN owns its own commerce engine and settlement rules. Full contract — cross-repo endpoints, SSO bridges, provisioning flow, admin-panel embed, miniapp entry point: `gcn-integration` skill — load it before touching any GCN-linked endpoint, the sibling repo, or aeviva storefront/inventory code.

## 20. Avatar Gallery System

Users pick a profile avatar from a gallery of 40 pregenerated characters (`components/avatar-picker/`) instead of uploading a real photo — WeChat's native `chooseAvatar` upload flow was removed entirely. Each character has 4 mood variants (engaged/relaxed/restored/stressed); `users.avatar_character` (migration `migration_avatar_character.sql`) records which character was picked, while `avatar_url` keeps storing a single resolved image URL exactly as before (now the character's `relaxed` variant) so every other read site is unaffected. In the health tab's self view only, `utils/mood.js`'s `computeMood()` derives a live mood client-side from already-synced wearable data and swaps the displayed image — purely client-rendered, never written back to the server. Gallery images live on the `waven-nano` OSS bucket; regenerate via `temp/upload-avatar-gallery.js` (rewrites `utils/avatar-gallery.js`). Full details: `docs/architecture/avatar-gallery.md`.

## 21. Agentic Plan→Generate→Judge→Revise Loop (Viva, High-Risk Intents)

Added 2026-07-28 to reduce hallucination further than the existing single-retry checks (`verifyBiomarkerGrounding`, `_regenerateIfFabricationRisk`) allowed. Applies **only** when `personaType === 'viva'` AND the classified intent is in `HIGH_RISK_INTENTS` (`biomarker_question`, `nutrition_question`, `longevity_science`, `record_action`) — gated in `handlers/chat.js` via `useAgenticLoop`. Nano and Viva's `casual_chat`/`emotional_support` are completely unaffected and take the pre-existing code path.

### Flow

For the gated case, `handlers/chat.js` delegates to `runAgenticTurn()` (`lib/agenticChat.js`) instead of the classic 4-iteration `query_database` tool loop:

1. **PLAN** (1 LLM call, `prompts/chat/planTemplate.js`) — produces a structured `intended_claims` list *before* any prose is written.
2. **Plan validation** (deterministic, 0 LLM calls) — cross-checks dot/dimension references in the plan against real data; mismatches become an extra instruction folded into the GENERATE system prompt rather than blocking generation outright.
3. **GENERATE** (up to 3 tool-calling iterations) — uses dedicated per-domain read tools (`lib/agenticTools.js`: `get_biomarkers`, `get_biomarker_history`, `get_dots`, `get_health_plan`, `get_dot_inventory`, `get_health_reports`, `get_questionnaire_responses`, `get_weight_history`, `get_health_twin`, `get_nutrition_schedule`, `get_reminders`) instead of the generic `query_database` SQL tool. Each tool is a fixed, typed wrapper — never raw model-authored SQL — and biomarker-shaped data always comes from `data.validated`, never `data.actual` (per §17). `get_biomarker_history`/`get_dot_inventory`/`get_health_reports` were added 2026-07-28 after live testing showed the original tool set (mirroring the pre-fetch context) had no way to answer questions like "how many Kino tests have I done" or "how many doses of a dot do I have left" — data that existed in `biomarkers`/`user_cartridges`/`health_reports` but was reachable by nothing, causing Viva to correctly but unhelpfully fall back to "not enough information." `health_events` (raw wearable ingestion log) was deliberately left unexposed — `health_twin`'s rolling averages/trend_data already summarize it cleanly, and dumping its heterogeneous per-category JSONB into a tool would add hallucination surface rather than reduce it.
4. **JUDGE** (1 LLM call, `prompts/viva/judgeTemplate.js`) — grades the draft against the plan; the full pre-fetched `llmContext` GENERATE's system prompt was itself built from (health_twin, questionnaire_context, active_health_plans, user_profile, plan, ...), with `biomarkers`/`dots` overridden by a fresh re-fetch (not the GENERATE-time snapshot, so drift is still caught for those two specifically); `tool_calls_made`, the complete list of every tool call GENERATE actually made with its real result; the curated knowledge base (below); and `factCheck.js`'s existing detectors (via the shared `detectAllRisks` export). Both the `llmContext` spread and `tool_calls_made` were added 2026-07-28 after live testing found the same bug twice — first narrowly (JUDGE couldn't verify `get_biomarker_history`'s test count, only `get_biomarkers`/`get_dots`), then broadly (JUDGE had no visibility into `llmContext` at all, so a correct wearable-data analysis sourced straight from the pre-fetched `health_twin` got fully stripped out as "unsupported" across 2 revise rounds). The fix generalizes to the whole context rather than patching each data source one at a time.
5. **REVISE + RE-JUDGE** — on REJECT, up to 2 correction-retry + re-check rounds (`REVISE_MAX_ROUNDS`), stopping early the moment a re-judge PASSes; ships the latest revision regardless if it still REJECTs after the last round. Widened from 1 to 2 rounds on 2026-07-28 after live dev testing showed a single revise pass sometimes left residual violations unfixed on multi-violation drafts. Never loops past this bound.
6. `verifyBiomarkerGrounding` still runs unconditionally afterward for every intent/persona (unchanged, orthogonal check: numeric drift vs. science/catalog fabrication) — for the agentic branch it also receives `extraValidDates`/`extraValidValues`, extracted from every tool call GENERATE actually made (`extractToolGroundTruth()` in `lib/agenticChat.js`). Without this, any legitimate historical date/value surfaced via `get_biomarker_history` (or the other history-shaped tools) gets misflagged as a fabrication — it only ever compared against the single latest snapshot — and gets silently rewritten away. Found and fixed via live dev testing 2026-07-28 (a correct "63 past tests" answer citing real historical dates/values was rewritten twice before this fix). Empty for the non-agentic path, which has no tool history to draw from, so its behavior is unchanged.
7. `_regenerateIfFabricationRisk` is **superseded** for this branch only (JUDGE subsumes it) — guarded with `!useAgenticLoop` at its call site; still runs as before for `casual_chat`/`emotional_support` and Nano.

Hard per-turn ceilings: plan 1, generate ≤3, judge 1, revise ≤2, re-judge ≤2 — logged as `turn_budget_used` for tuning. Typical-case cost (~4 calls) is roughly today's worst case; worst-case cost (~11 calls) is not user-latency-sensitive because the production (non-`sandbox`) path never returns synchronously — replies are delivered via the `notifications` polling mechanism regardless. Only `sandbox: true` (admin "login as" preview) is latency-sensitive to this change.

**Correction (2026-07-28):** the previous paragraph's claim that the production path "never returns synchronously" was aspirational, not actually true, until §22 below shipped — `handlePostChat` originally awaited the entire agentic loop inline within the HTTP request/response cycle regardless of sandbox, and Aliyun FC cancels the invocation the moment the client disconnects, so a client-side timeout genuinely destroyed in-progress work rather than just delaying it. See §22 for the actual fix.

### Curated knowledge base

`prompts/viva/knowledge/` (`tcmGeneVariants.js`, `nutritionProtocols.js`, `longevityScience.js`, merged by `index.js`) is the ground truth PLAN/JUDGE check Viva's science/TCM/protocol claims against — the one hallucination surface `factCheck.js` never covered (it only validates biomarker numbers and dot names/ingredients). Matching is a cheap in-process keyword/tag substring check (`findRelevantEntries()`), not embeddings/RAG — none exists in this codebase. Zero KB matches is not a failure signal; JUDGE falls back to `factConstraint.js`'s general rules + detector hits alone in that case. Seeded from claims already shipping as static prose in `systemChat.js`/`chat/science.js` (already implicitly product-approved). **Open question, not yet resolved:** who authors/vets *new* KB entries beyond the seed set — a product/clinical decision, recommended to require a named reviewer via normal PR review once someone is assigned.

## 22. Async Chat Delivery for Viva's Agentic Loop (High-Risk Intents Only)

Added 2026-07-28 to fix a real bug, not just a UX rough edge: `handlePostChat` originally awaited the entire agentic loop (§21) inline within the HTTP request/response cycle. Live testing found Aliyun FC **cancels the function invocation** the instant the client (the WeChat Mini Program's `wx.request`) disconnects — confirmed via a live log line, `FC Invoke End RequestId: ..., Error: Invocation canceled by client (duration: 60990ms...)`. So a client-side timeout didn't just fail to show the reply, it destroyed the in-progress work server-side: no notification was ever saved, and the user's question went unanswered until they asked again.

### The fix

For Viva's 4 high-risk intents (`useAgenticLoop === true`) on **real (non-sandbox) traffic only**, `handlers/chat.js` publishes a `chat.generate` CloudEvent and returns `{success:true, user_id, processing:true}` immediately, instead of awaiting `runAgenticTurn` inline. The worker's existing EventBridge trigger (`s.yaml`'s `eb-trigger`, previously only consuming `acs.dispatcher`/`acs.lab`, now also `acs.chat`) delivers the event back to the same worker function on a **separate invocation** a client disconnect can't reach, where `handleChatGenerateEvent` runs the real generation and delivers the reply through the existing `notifications`-table polling mechanism.

- **Scope:** deliberately narrow — Nano and Viva's `casual_chat`/`emotional_support` (already 2-15s) and **`sandbox: true`** (admin "login as" preview, chat-simulator dev tool — no polling mechanism, needs the reply synchronously) are completely unaffected; they never take the async branch.
- **Shared tail:** the grounding-check/action-detection/save+notify logic that used to run inline is extracted into `finalizeChatReply()`, called identically by the synchronous callers (classic path, sandbox, and the fail-open fallback below) and by `handleChatGenerateEvent` — one implementation, not two copies drifting apart.
- **Fail-open on publish failure:** if `publishChatGenerateEvent` throws (EventBridge unavailable), `handlePostChat` falls through and runs the agentic loop synchronously right there, exactly as before — never silently drops the user's message just because EventBridge is down.
- **Dedupe:** EventBridge is at-least-once delivery, and generation has real side effects (chat_messages insert, weight recording, reminder creation). `chat_generate_events` (migration `migration_chat_generate_events.sql`) is checked via `INSERT ... ON CONFLICT (event_id) DO NOTHING RETURNING event_id` before any real work — a duplicate delivery is a no-op.
- **Progress status, not a static "typing…":** `runAgenticTurn` (`lib/agenticChat.js`) takes an optional `onStatus(key)` callback fired at 3 phase checkpoints (before PLAN, before GENERATE, before the first JUDGE) — `makeStatusNotifier()` in `chat.js` turns each into a `notifications` row (`notification_type: 'chat_status'`, reusing the existing table/polling with zero schema change). The miniapp (`pages/main/main.js`) routes these rows to a `chatStatusText` caption instead of a chat bubble, replacing the old static 3-dot animation's lack of feedback during a long wait. A client-side 3-minute safety timeout clears the wait UI with a gentle "still working" message if nothing arrives — pure UX bound, not an assumption the turn failed (server-side work may still complete and deliver on a later poll).

### The credentials gotcha

`publishChatGenerateEvent` (`lib/chatEventBridge.js`) does **not** use `context.credentials`/`context.region` the way the Cron-triggered `dispatcher/index.js` does — a live probe found `context` is an **empty object** for this HTTP-triggered function. It uses the runtime role's env-injected STS credentials instead (`ALIBABA_CLOUD_ACCESS_KEY_ID`/`_SECRET`/`ALIBABA_CLOUD_SECURITY_TOKEN`, `FC_REGION`), confirmed present regardless of trigger type. Full details: `fc3-handler-reference` skill.

### Files

- New: `src/schemas/migration_chat_generate_events.sql`, `lib/chatEventBridge.js`.
- Modified: `handlers/chat.js` (fork point, `finalizeChatReply` extraction, `handleChatGenerateEvent`, `makeStatusNotifier`), `lib/agenticChat.js` (`onStatus` param), `index.js` (new EventBridge routing case), `worker/package.json` (`@alicloud/eventbridge`, `uuid`), `s.yaml`/`s-prod.yaml` (`eb-trigger`'s source filter), `pages/main/main.js`/`main.wxml`/`main.wxss` (status caption UI, safety timeout), `utils/config.js` (VERSION bump).

## 23. Chat Scroll-to-Bottom: Short Last Messages Clipped on Real Devices

Found and fixed 2026-07-29 via a real-device screenshot: a short last message (e.g. a one-line reply to "Hi") sometimes rendered almost entirely hidden behind the `.ai-disclaimer`/`.input-container` bar at the bottom of the chat tab (`pages/main/`), while long messages (e.g. a full health report) always rendered correctly. Not reproducible in WeChat DevTools' simulator — only seen on a real device.

### Root cause

`scrollTop`/`scroll-into-view` are **no-ops when there's nothing to scroll** — a short message that fits within the scroll-view's viewport never overflows, so neither mechanism ever fires. Real WeChat clients (unlike the DevTools simulator) appear to sometimes not fully repaint a newly-appended last message into the `scroll-view`'s content box until something forces a relayout — which an actual overflowing scroll triggers, but a short non-overflowing message never does. This is why long messages (which always overflow and actively scroll) were unaffected while short ones clipped.

Two rounds of scroll-mechanism fixes were tried first and did **not** resolve it — worth recording so the same dead end isn't retried:
1. Replacing `_scrollBottom()`'s single blind `setTimeout(50ms)` with `wx.nextTick()` + two follow-up timers (120ms/500ms), to rule out a render-timing race.
2. Adding `scroll-into-view` (bound to the last message's DOM id, `id="m{{item.id}}"` in `main.wxml`) as a second, layout-aware scroll mechanism alongside the numeric `scrollTop` flip trick, to rule out a `scroll-view`-first-paint quirk.

Both were reasonable and are still in place (real, if secondary, improvements for the *overflowing* case — e.g. long messages, or the async agentic-loop status captions arriving via polling), but neither touches the actual bug, which only manifests when there's no overflow to scroll in the first place.

### The fix

`.chat-inner`'s (the scrollable content wrapper) bottom padding was bumped from `8rpx` to `200rpx` (`main.wxss`) — generous buffer well past the disclaimer + input bar's own height, so the last line of any message clears the clipping edge regardless of whether the underlying repaint quirk fires. This is the standard, low-risk mitigation for this bug class in WeChat Mini Programs — chasing the exact real-device relayout behavior further wasn't worth it once a reliable, cheap fix was in hand. **Do not shrink this padding back down** without confirming the underlying repaint issue is actually fixed, not just untested.

Files: `pages/main/main.wxss` (`.chat-inner` padding), `pages/main/main.js` (`_scrollBottom`/`_onChatImageLoad`, kept from the earlier rounds), `pages/main/main.wxml` (`scroll-into-view`/`data-id`, kept from the earlier rounds), `utils/config.js` (VERSION bump).