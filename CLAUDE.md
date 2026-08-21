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

### WeChat DevTools Automation (for driving/testing the miniapp)

WeChat DevTools' "Service Port" (Settings → Security Settings) is open on **`22038`** — this is the IDE's CLI HTTP port (`cli open`/`cli preview`/etc.), not the automation websocket by itself. To actually drive the running miniapp (e.g. via the `miniprogram-automator` Node package) for testing UI changes, automation must additionally be enabled with its own port:

```bash
/Applications/wechatwebdevtools.app/Contents/MacOS/cli auto --project /Users/pin/waven/nano/src/mini/nano-miniapp --auto-port <port>
```

Then `automator.connect({ wsEndpoint: 'ws://127.0.0.1:<port>' })` (not `22038`) attaches to it. `automator.launch({ cliPath, projectPath, port })` does the open+auto+connect flow in one call and is the more reliable path from a cold start — a plain `cli auto` against an already-open project can leave the simulator's app launch hanging (`routeTo appLaunch timeout` in the IDE's `WeappLog` logs) if the project window is in a stale state; quitting (`cli quit --project <path>`) and relaunching via `automator.launch` resolves it.

**Don't re-derive this by hand each session** — [`tools/wechat-automator/`](tools/wechat-automator/README.md) wraps the above into a reusable `launch()`/`connect()` helper, plus a documented list of gotchas found via live debugging (screenshots don't work in this environment, synthetic touch doesn't trigger real scroll-view scrolling, `wx.storage` persists the logged-in user across relaunches). Use it instead of reinventing the connection dance; only write throwaway one-off repro/verify scripts to your scratchpad, not into that tool.

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
    planTemplate.js       ← shared PLAN-stage prompt (§21)
    factConstraint.js     ← shared guardrail block, `getFactConstraintBlock()` (§21, §26)
    factMemoryBlock.js    ← shared personal-memory recall/extraction block (§27)
  viva/
    judgeTemplate.js       ← shared JUDGE-stage prompt (§21) — stale directory location,
                              used for both personas, not moved as of this writing
    subAgeLabels.js         ← Viva-only per-channel sub-age label override (see below)
    systemDailyCheckin.js   ← shared daily check-in prompt (§29)
    systemFormulaGenerate.js ← shared agentic Formulate-Dots prompt (§28)
  strings.js             ← shared UI strings
  systemAdminReport.js   ← shared admin report prompt
```

**`prompts/nano/systemChat.js` and `prompts/viva/systemChat.js` are dead code** — no `require()` site for either exists anywhere in the codebase; both personas are fully routed through the intent-classified `chat/*.js` files instead. Don't add to them expecting it to take effect.

### Persona-unification note (2026-08-14)

An in-repo refactor ("Nano adopted Viva's core," commit `e81b344`) genericized what §21/§22/§24/§25/§28 below originally described as Viva-only mechanisms — the agentic PLAN→GENERATE→JUDGE→REVISE loop, its async CloudEvent delivery, the Health Advice tool's agentic path, and Formulate Dots' agentic generation — so **all of them are now gated on intent/feature, not on `personaType === 'viva'`**, and apply equally to Nano. Each affected section below has been corrected to reflect this; where a section's title or body still says "(Viva...)" in a way that reads as a persona gate, treat it as historical framing from when the feature first shipped, not current behavior. Two genuine, still-live asymmetries remain (not doc drift — actual gaps): `_regenerateIfFabricationRisk` (the older, non-agentic-path fabrication retry) is still gated `personaType === 'viva' && !useAgenticLoop`, so Nano's `casual_chat`/`emotional_support` intents get no equivalent retry; and `knowledge_entries` (§26) has zero `persona_type = 'nano'` rows seeded, so Nano's PLAN/JUDGE always falls back to the hardcoded default block. Full detail: `docs/ai-persona/09-known-issues.md`.

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

The `aeviva` nano channel's partner storefront, wholesale/resale inventory, and manual-QR checkout live in a separate sibling repo, `/Users/pin/waven/gcn`. **As of 2026-08-09, this is no longer "nano owns partner identity/tier/referral/commission, GCN owns commerce"** — GCN now owns the wholesale tier catalog, tier assignment, the referral tree, and commission computation too (Phases 0-4 of the consolidation roadmap below, shipped). Nano still owns end-user identity/auth (OTP, WeChat) and remains where new recruitment edges are actually created (its own admin panel / self-service apply flow), pushing them to GCN on every provision/re-sync — but nano's own `recordReferralCommission`/`recordSalesCommission` are now disabled (commented out, not removed) to avoid double-paying against GCN's ported computation. Full contract — cross-repo endpoints, SSO bridges, provisioning flow, admin-panel embed, miniapp entry point: `gcn-integration` skill — load it before touching any GCN-linked endpoint, the sibling repo, or aeviva storefront/inventory code.

**All 5 phases shipped 2026-08-09**: GCN now owns aeviva's wholesale tier catalog (key/label/rank/
entry_fee/active status), tier assignment, the referral tree
(`partners.aeviva_upline_partner_id` on GCN's side — deliberately not `parent_partner_id`, which
GCN already uses for two other hierarchies), and commission computation (referral + sales-margin +
team-income, ported rate-for-rate from nano's `partner_commission_rules`). Phase 5 (retiring
nano's redundant local surface) turned out to mean UI/logic retirement, not schema deletion —
`partners.tier`'s `NOT NULL` FK makes dropping the catalog unsafe for no benefit, and
`referred_by_partner_id` was never meant to retire (nano still creates new recruitment edges).
What actually retired: `PartnersTab.jsx`'s "Rules" subtab, found to be a live ungated editor for
the exact rate data GCN's port was sourced from — now disabled with a banner, since editing it
did nothing to real payouts once nano's own commission functions were disabled. See the
`gcn-integration` skill's "Partner-system consolidation" section for the full
mechanics (`managed_by_gcn`, `tier_managed_by_gcn`, all four `*-gcn-sync` endpoints, and which
nano call sites were disabled), and
`/Users/pin/waven/gcn/docs/aeviva/10-partner-system-consolidation-roadmap.md` for the complete
writeup, including the live end-to-end verification performed against aeviva-dev.

**Custom-formulation purchase flow (in-flight, see §31):** a separate, newer cross-repo addition — GCN can now validate and confirm purchases of a user's actual committed Dot formulation (`GET /formulation-checkout-snapshot`, `POST /formulation-purchase-confirmed`, both in `GCN_ALLOWED_PATHS`), and `webview_tokens.context` carries a `{intent, nutrition_plan_id}` payload through the SSO handoff so GCN's checkout knows which formulation to price. Unrelated to the partner/commission consolidation above — this is nano's own Dots product (§14), not aeviva's wholesale inventory.

## 20. Avatar Gallery System

Users pick a profile avatar from a gallery of 40 pregenerated characters (`components/avatar-picker/`) instead of uploading a real photo — WeChat's native `chooseAvatar` upload flow was removed entirely. Each character has 4 mood variants (engaged/relaxed/restored/stressed); `users.avatar_character` (migration `migration_avatar_character.sql`) records which character was picked, while `avatar_url` keeps storing a single resolved image URL exactly as before (now the character's `relaxed` variant) so every other read site is unaffected. In the health tab's self view only, `utils/mood.js`'s `computeMood()` derives a live mood client-side from already-synced wearable data and swaps the displayed image — purely client-rendered, never written back to the server. Gallery images live on the `waven-nano` OSS bucket; regenerate via `temp/upload-avatar-gallery.js` (rewrites `utils/avatar-gallery.js`). Full details: `docs/architecture/avatar-gallery.md`.

## 21. Agentic Plan→Generate→Judge→Revise Loop (High-Risk Intents, Shared by Both Personas)

Added 2026-07-28, originally Viva-only, **genericized to both personas by the 2026-08 persona-unification refactor** (see §16's note). Applies when the classified intent is in `HIGH_RISK_INTENTS` (`biomarker_question`, `nutrition_question`, `longevity_science`, `record_action`) — gated in `handlers/chat.js` via `useAgenticLoop = HIGH_RISK_INTENTS.has(intent)`, independent of `personaType`. Nano's and Viva's `casual_chat`/`emotional_support` are unaffected and take the pre-existing code path, for both personas.

### Flow

For the gated case, `handlers/chat.js` delegates to `runAgenticTurn()` (`lib/agenticChat.js`) instead of the classic 4-iteration `query_database` tool loop:

1. **PLAN** (1 LLM call, `prompts/chat/planTemplate.js`) — produces a structured `intended_claims` list *before* any prose is written.
2. **Plan validation** (deterministic, 0 LLM calls) — cross-checks dot/dimension references in the plan against real data; mismatches become an extra instruction folded into the GENERATE system prompt rather than blocking generation outright.
3. **GENERATE** (up to 3 tool-calling iterations) — uses dedicated per-domain read tools (`lib/agenticTools.js`: `get_biomarkers`, `get_biomarker_history`, `get_dots`, `get_health_plan`, `get_dot_inventory`, `get_health_reports`, `get_questionnaire_responses`, `get_weight_history`, `get_health_twin`, `get_nutrition_schedule`, `get_reminders`) instead of the generic `query_database` SQL tool. Each tool is a fixed, typed wrapper — never raw model-authored SQL — and biomarker-shaped data always comes from `data.validated`, never `data.actual` (per §17). `get_biomarker_history`/`get_dot_inventory`/`get_health_reports` were added 2026-07-28 after live testing showed the original tool set (mirroring the pre-fetch context) had no way to answer questions like "how many Kino tests have I done" or "how many doses of a dot do I have left" — data that existed in `biomarkers`/`user_cartridges`/`health_reports` but was reachable by nothing, causing Viva to correctly but unhelpfully fall back to "not enough information." `health_events` (raw wearable ingestion log) was deliberately left unexposed — `health_twin`'s rolling averages/trend_data already summarize it cleanly, and dumping its heterogeneous per-category JSONB into a tool would add hallucination surface rather than reduce it.
4. **JUDGE** (1 LLM call, `prompts/viva/judgeTemplate.js`) — grades the draft against the plan; the full pre-fetched `llmContext` GENERATE's system prompt was itself built from (health_twin, questionnaire_context, active_health_plans, user_profile, plan, ...), with `biomarkers`/`dots` overridden by a fresh re-fetch (not the GENERATE-time snapshot, so drift is still caught for those two specifically); `tool_calls_made`, the complete list of every tool call GENERATE actually made with its real result; the curated knowledge base (below); and `factCheck.js`'s existing detectors (via the shared `detectAllRisks` export). Both the `llmContext` spread and `tool_calls_made` were added 2026-07-28 after live testing found the same bug twice — first narrowly (JUDGE couldn't verify `get_biomarker_history`'s test count, only `get_biomarkers`/`get_dots`), then broadly (JUDGE had no visibility into `llmContext` at all, so a correct wearable-data analysis sourced straight from the pre-fetched `health_twin` got fully stripped out as "unsupported" across 2 revise rounds). The fix generalizes to the whole context rather than patching each data source one at a time.
5. **REVISE + RE-JUDGE** — on REJECT, up to 2 correction-retry + re-check rounds (`REVISE_MAX_ROUNDS`), stopping early the moment a re-judge PASSes; ships the latest revision regardless if it still REJECTs after the last round. Widened from 1 to 2 rounds on 2026-07-28 after live dev testing showed a single revise pass sometimes left residual violations unfixed on multi-violation drafts. Never loops past this bound.
6. `verifyBiomarkerGrounding` still runs unconditionally afterward for every intent/persona (unchanged, orthogonal check: numeric drift vs. science/catalog fabrication) — for the agentic branch it also receives `extraValidDates`/`extraValidValues`, extracted from every tool call GENERATE actually made (`extractToolGroundTruth()` in `lib/agenticChat.js`). Without this, any legitimate historical date/value surfaced via `get_biomarker_history` (or the other history-shaped tools) gets misflagged as a fabrication — it only ever compared against the single latest snapshot — and gets silently rewritten away. Found and fixed via live dev testing 2026-07-28 (a correct "63 past tests" answer citing real historical dates/values was rewritten twice before this fix). Empty for the non-agentic path, which has no tool history to draw from, so its behavior is unchanged.
7. `_regenerateIfFabricationRisk` is **superseded** for this branch only (JUDGE subsumes it) — guarded with `!useAgenticLoop` at its call site; still runs as before for `casual_chat`/`emotional_support`. Note this retry itself remains gated `personaType === 'viva' && !useAgenticLoop` — a genuine, still-open asymmetry (Nano's non-agentic intents get no equivalent retry), not doc drift; see §16's persona-unification note.

Hard per-turn ceilings: plan 1, generate ≤3, judge 1, revise ≤2, re-judge ≤2 — logged as `turn_budget_used` for tuning. Typical-case cost (~4 calls) is roughly today's worst case; worst-case cost (~11 calls) is not user-latency-sensitive because the production (non-`sandbox`) path never returns synchronously — replies are delivered via the `notifications` polling mechanism regardless. Only `sandbox: true` (admin "login as" preview) is latency-sensitive to this change.

**Correction (2026-07-28):** the previous paragraph's claim that the production path "never returns synchronously" was aspirational, not actually true, until §22 below shipped — `handlePostChat` originally awaited the entire agentic loop inline within the HTTP request/response cycle regardless of sandbox, and Aliyun FC cancels the invocation the moment the client disconnects, so a client-side timeout genuinely destroyed in-progress work rather than just delaying it. See §22 for the actual fix.

### Curated knowledge base

`prompts/viva/knowledge/` (`tcmGeneVariants.js`, `nutritionProtocols.js`, `longevityScience.js`, merged by `index.js`) is the ground truth PLAN/JUDGE check Viva's science/TCM/protocol claims against — the one hallucination surface `factCheck.js` never covered (it only validates biomarker numbers and dot names/ingredients). Matching is a cheap in-process keyword/tag substring check (`findRelevantEntries()`), not embeddings/RAG — none exists in this codebase. Zero KB matches is not a failure signal; JUDGE falls back to `factConstraint.js`'s general rules + detector hits alone in that case. Seeded from claims already shipping as static prose in `systemChat.js`/`chat/science.js` (already implicitly product-approved). **Open question, not yet resolved:** who authors/vets *new* KB entries beyond the seed set — a product/clinical decision, recommended to require a named reviewer via normal PR review once someone is assigned.

## 22. Async Chat Delivery for the Agentic Loop (High-Risk Intents, Shared by Both Personas)

Added 2026-07-28 to fix a real bug, not just a UX rough edge: `handlePostChat` originally awaited the entire agentic loop (§21) inline within the HTTP request/response cycle. Live testing found Aliyun FC **cancels the function invocation** the instant the client (the WeChat Mini Program's `wx.request`) disconnects — confirmed via a live log line, `FC Invoke End RequestId: ..., Error: Invocation canceled by client (duration: 60990ms...)`. So a client-side timeout didn't just fail to show the reply, it destroyed the in-progress work server-side: no notification was ever saved, and the user's question went unanswered until they asked again.

### The fix

For any of the 4 high-risk intents (`useAgenticLoop === true`, either persona — originally Viva-only, genericized by the persona-unification refactor, see §16) on **real (non-sandbox) traffic only**, `handlers/chat.js` publishes a `chat.generate` CloudEvent and returns `{success:true, user_id, processing:true}` immediately, instead of awaiting `runAgenticTurn` inline. The worker's existing EventBridge trigger (`s.yaml`'s `eb-trigger`, previously only consuming `acs.dispatcher`/`acs.lab`, now also `acs.chat`) delivers the event back to the same worker function on a **separate invocation** a client disconnect can't reach, where `handleChatGenerateEvent` runs the real generation and delivers the reply through the existing `notifications`-table polling mechanism.

- **Scope:** deliberately narrow — both personas' `casual_chat`/`emotional_support` (already 2-15s) and **`sandbox: true`** (admin "login as" preview, chat-simulator dev tool — no polling mechanism, needs the reply synchronously) are completely unaffected; they never take the async branch.
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

## 24. Health Advice Tool: Agentic Loop + Async (Phase A) — Shared by Both Personas

Added 2026-07-29, originally Viva-only, **now unconditional for both personas** (persona-unification refactor, see §16's note — `handlePostHealthAdvice`'s `useAgenticLoop` is `true` unconditionally, not persona-gated). The toolbox's "Health Advice" button (`utils/tool-actions.js`'s `runHealthAdvice`) never went through §21/§22's work — it calls a completely separate handler, `handlePostHealthAdvice` (`chat.js`), which historically ran a single completion + (viva-only) `_regenerateIfFabricationRisk` retry, not `runAgenticTurn`. Fixed: the same PLAN→GENERATE→JUDGE→REVISE loop, and (for the miniapp's own chat tab only) the same async `chat.generate` delivery §22 built for `/chat`.

### Scope decision (confirmed via discussion)

`handlePostHealthAdvice` has **3 callers**, only one of which had a landing spot for async replies:
- `pages/main/main.js` (end user's own chat) — has `_poll`, so this is the only caller wired for async (`opts.async: true` passed to `runHealthAdvice`).
- `pages/coach/coach.js` (coach viewing a client's chat) — confirmed via investigation: **no polling mechanism at all** (no `setInterval`/`/api/notifications` anywhere in that file). Stays fully synchronous by design; building async delivery here would require new polling infrastructure from scratch, out of scope for this pass.
- `src/web/user-app`'s `ChatTab.jsx` — a separate browser app, also synchronous, also out of scope.

### Backend reuse — no new event type needed

`handlePostHealthAdvice`'s fetched data is reshaped into the *same* `llmContext` contract `handlePostChat` produces (`user_profile`, `biomarkers`, `biomarkers_tested_at`, `dots`, `active_health_plans`, ... — `plan`/`questionnaire_context`/`sub_age_display_names` left `null`, not fetched by this handler, flagged as a known Phase-A gap rather than faked). Because the shape matches, the handler can publish through the **exact same** `publishChatGenerateEvent`/`handleChatGenerateEvent`/`finalizeChatReply` pipeline §22 already built — no new CloudEvent type, no new EventBridge routing. The synchronous tail (nano always; viva when sandbox, no `async` flag, or EventBridge-publish-failure fallback) uses a new small `finalizeHealthAdviceReply()` instead — same grounding-check-with-one-retry logic, but returns `{success:true, message}` directly rather than writing to `notifications` (this endpoint's synchronous callers expect the reply inline, not via polling).

### Two real bugs found during verification, fixed same pass

1. **`coach.js`'s call site had no timeout override** and the agentic loop measured up to **~167s** synchronously (vs. ~15-25s for the old single completion) — without a fix this would have made the FC-cancellation-on-client-timeout bug (§22's original motivation) *more* likely to hit here, not less. Fixed: `coach.js`'s `_req` gained the same optional `timeoutMs` param `main.js`'s already had; `runHealthAdvice` now requests 180s specifically for this call.
2. **The sandbox router short-circuit was missing `/health-advice`** — `index.js`'s blanket `if (sandbox && method !== 'GET' && path !== '/chat')` rule meant a sandbox request to `/health-advice` never reached the handler at all (confirmed live: instant `{success:true,sandbox:true}` with no `message`), so the toolbox's Health Advice button has **never actually worked in sandbox/admin-preview mode** — always showed a generic error. This predates this session's changes entirely. Fixed by adding `/health-advice` to the same exemption `/chat` already has.

### Files

Modified: `handlers/chat.js` (`finalizeHealthAdviceReply`, `handlePostHealthAdvice` rewrite), `index.js` (sandbox router exemption), `utils/tool-actions.js` (`runHealthAdvice` async + timeout), `pages/main/main.js` (`onAsyncStart`, `{async:true}`), `pages/coach/coach.js` (`_req` timeout param — behavior otherwise unchanged), `utils/config.js` (VERSION bump).

## 25. Formulate Dots Tool: Agentic Narrative for an Already-Committed Plan

**Superseded by §28** — the `kind: 'formula_dots'` narrative-only design described here was replaced by §28's `kind: 'formula_dots_generate'`, which makes the dot-count decision itself agentic rather than just narrating an already-decided plan. Kept for historical context; nothing currently publishes the `'formula_dots'` kind this section describes.

Added 2026-07-29. The toolbox's "Formulate Dots" button (`handlePostFormulaDots`, `handlers/dots.js`) computes a 7-day per-dot dose allocation — this stayed **out of scope** for the agentic-loop treatment (§21/§24) because the numeric decision itself doesn't need it: dot counts are clamped (`Math.min(10,Math.max(1,...))`) and backed by a deterministic fallback (`_calcDotCounts`) regardless of what the LLM returns, so there's very little free-text surface for the hallucination classes this work targets to occur on. What *was* missing: the short `analysis` blurb shown to the user was un-grounded, ungraded LLM prose.

### Design: two decoupled phases, not one slower endpoint

**Phase 1 (unchanged, stays fast and synchronous)**: the existing single completion → parse `ANALYSIS:`/`FORMULATION:` → clamp/fallback → DB transaction (`nutrition_plans` + `nutrition_schedules`). `handlePostFormulaDots` still returns `{success:true}` in seconds, exactly as before.

**Phase 2 (new, Viva only, fully async)**: right after Phase 1's transaction commits, publish a `chat.generate` event (reusing `publishChatGenerateEvent`/`handleChatGenerateEvent` — §22's machinery, unmodified) with a new `kind: 'formula_dots'` field and `formulated_plan` — the *real, already-committed* allocation (`{dot_id, name_zh, count, timing, target_dimension}[]`), not a fresh recommendation request. `handleChatGenerateEvent` branches on `kind`: default runs `finalizeChatReply` as before; `'formula_dots'` runs the new `finalizeFormulaDotsNarrative` instead (same grounding-check-with-one-retry pattern, but delivers via a `'nutrition_plan'` notification, and appends the deterministic `planText` — computed once in Phase 1, passed through the event, never regenerated or restated by the model).

`runAgenticTurn` itself needed **zero changes** — `intent: 'nutrition_question'`, a dedicated prompt (`prompts/viva/systemFormulaExplain.js` — explicitly instructed to explain the given allocation, not re-recommend one), and `llmContext.formulated_plan` as the grounding target. Because that target is the literal data structure Phase 1 just produced (not a general claim checked against a database that could have drifted), JUDGE's job here is unusually precise: "does this narrative match what was actually scheduled."

**No frontend changes were needed at all** — `runFormulaDs` (`utils/tool-actions.js`) has never displayed `finalContent` directly; it shows its own canned "generating…"/"complete" messages and always relied on the `notifications`/polling mechanism to deliver the plan text whenever it was ready. That mechanism already tolerated arbitrary delay; Phase 2 just uses that slack instead of computing everything before Phase 1 returns.

### A second real bug found and fixed along the way

`_saveChatMessage(user.user_id, 'ai', finalContent)` never passed `persona_type` (defaulting to `'nano'`) — so a Viva user's formula-dots confirmation was saved under the wrong persona, invisible in their (persona-scoped) chat history on reload even though it briefly appeared via the one-time notification poll. Fixed for both the nano path (unchanged content, now correctly tagged) and the new viva async path (correct from the start).

### Files

New: `prompts/viva/systemFormulaExplain.js`. Modified: `handlers/dots.js` (`handlePostFormulaDots` persona branch + event publish + persona_type fix), `handlers/chat.js` (`finalizeFormulaDotsNarrative`, `handleChatGenerateEvent`'s `kind` branch).

### Follow-up (2026-07-29): dropped the raw per-dot text dump from the message

The chat message (both the nano blurb and the viva agentic narrative) originally had the raw `_generatePlanText()` output appended — an 18-dot `D-N1x3 D-N2x3 ...` listing repeated once per identical day for all 7 days. This read as confusing technical noise, not something a user should parse in a chat bubble; the "查看方案" (view plan) action button is the actual place to see exact per-dot numbers (reads `nutrition_schedules` directly). Removed the concatenation from both the nano/fail-open path (`dots.js`) and the viva async narrative (`finalizeFormulaDotsNarrative`, `chat.js`) — nano's message is now just its short `analysis` blurb (with a canned fallback if empty), and viva's is just the agentic narrative on its own. `_generatePlanText()` and its `MONTH_EN`/`WEEKDAY_EN`/`WEEKDAY_ZH` constants had no other callers, so removed entirely rather than left dead.

## 26. Knowledge Base Moved to DB — `knowledge_entries` (Essential + Optional Tiers)

Added 2026-07-29. Viva's two static, code-only knowledge layers (§21) — the always-injected `factConstraint.js` guardrail block and the 13-entry, keyword-matched-on-request curated KB (`prompts/viva/knowledge/*.js`) — are now backed by a single DB table, `knowledge_entries`, editable from the web admin panel without a deploy. This also resolves §21's open question about who vets new KB entries: `reviewed_by` is now a real, enforced field (an entry cannot be set to `status='active'` without one), not a hardcoded `'placeholder'`.

### Why one table, not two

Essential and optional entries share an identical shape (id, content, evidence/review-tracking) and differ only in which consumption path reads them — a `tier` column (`'essential' | 'optional'`) does this split within one table, the same way `kino_chip_models.status` already splits active/inactive without a second table. `persona_type` (default `'viva'`) is included from the start even though only Viva populates it today, so Nano could plug into the same table later with zero schema change.

### Schema

`knowledge_entries` (migration `src/schemas/migration_knowledge_entries.sql`): `id` (PK, lowercase kebab-case slug), `persona_type`, `tier`, `category`, `topic` (`TEXT[]`, tag list — unused for essential rows), `content_zh`, `evidence_level` (optional-tier only), `status` (`active`/`inactive`), `sort_order` (essential-row concatenation order), `last_reviewed`, `reviewed_by`, `created_at`/`updated_at`. Seeded once with the prior static content: the 13 optional entries (unchanged content, `category` set per source file) plus one essential row (`id='fact-constraint-core'`, `content_zh` = factConstraint.js's original guardrail text verbatim).

### Loading layer — `lib/knowledgeBase.js`

Replaces the static `require()`-based merge:
- `getEssentialBlock(personaType)` — `SELECT content_zh ... WHERE tier='essential' AND status='active' ORDER BY sort_order, id`, joined with `\n\n`. On any DB error, or if the table has zero matching rows, falls back to `FALLBACK_ESSENTIAL_BLOCK` — a hardcoded copy of the original guardrail text kept in code for exactly this case, so a transient DB error can never ship a Viva reply with zero anti-hallucination guardrails.
- `findRelevantEntries(personaType, text, limit=8)` — fetches all active optional-tier rows for the persona, then runs the **exact same in-process substring/tag match** `findRelevantEntries` always used (`entry.topic.some(tag => text.includes(tag))`) — only the source of the entry list changed from `require()` to a query. Still no RAG/embeddings, per the existing by-design constraint.
- No caching: the table is small (~15 rows today) and each function runs at most once or twice per chat turn, negligible next to the LLM call latency it sits beside. Add a TTL cache later only if this is ever shown to matter.

### Call-site plumbing — fetched once per request, not re-fetched per template

`factConstraint.js`'s `getFactConstraintBlock()` is called inline inside a template literal in 12 Viva prompt files, all synchronous. Rather than making all 12 async, each handler (`handlers/chat.js`'s `handlePostChat`/`handlePostHealthAdvice`, `handlers/dots.js`'s `handlePostFormulaDots`) fetches `essentialKnowledge` once via `await getEssentialBlock('viva')` right where it already resolves `personaType`, and threads it through as `llmContext.essential_knowledge` (or the equivalent `context`/`ctx` field each of the 12 templates already receives) — `getFactConstraintBlock(preloaded)` now returns `preloaded || FALLBACK_ESSENTIAL_BLOCK`, a one-line change at each of the 12 call sites, no async propagation needed. `handleChatGenerateEvent` (the EventBridge-triggered async path, §22) needs no separate fetch — `llmContext` (already carrying `essential_knowledge`) travels whole through the published event payload. `runAgenticTurn`'s only `findRelevantEntries` call site was already inside an async function, so it became a one-line `await` plus a new `personaType` param threaded from all 3 of its call sites in `chat.js`.

### Admin panel — Knowledge sub-tab under Content

Full CRUD (`handlers/knowledge.js`, routes mirroring `kino_chip_models`'s pattern in `index.js`) plus a new **Knowledge** sub-tab under the Content tab (`ContentTab.jsx` → `KnowledgeTab.jsx`), superadmin-only. Add/edit form: tier and persona selects, topic tags as a comma-separated input, content textarea, evidence-level select (optional-tier only), and a `reviewed_by` field the backend rejects `status='active'` without.

### Files

New: `src/schemas/migration_knowledge_entries.sql`, `src/functions/worker/lib/knowledgeBase.js`, `src/functions/worker/handlers/knowledge.js`, `src/web/admin-panel/src/tabs/KnowledgeTab.jsx`. Modified: `prompts/viva/factConstraint.js` (`getFactConstraintBlock(preloaded)` + `FALLBACK_ESSENTIAL_BLOCK`), all 12 Viva prompt template files (one-line call-site change each), `lib/agenticChat.js` (`findRelevantEntries` now async + `personaType` param), `handlers/chat.js`/`handlers/dots.js` (essential-knowledge prefetch + `personaType` threading into `runAgenticTurn`), `index.js` (`/knowledge-entries[/:id]` routes), `ContentTab.jsx` (new sub-tab). Deleted (superseded): `prompts/viva/knowledge/{index,tcmGeneVariants,nutritionProtocols,longevityScience}.js`.

## 27. Personal Memory Facts — `user_memory_facts` (Dietary Restrictions, Allergies, Preferences, Goals)

Added 2026-07-29. Viva previously had no way to remember durable personal facts a user states in conversation ("I don't eat pork," "I'm allergic to shellfish"). This is distinct from `users.bio_data` (fixed onboarding checklist — height/weight/`health_conditions`) and from §26's `knowledge_entries` (persona-scoped curated *general* science KB, not user-specific facts). A `users.preferences JSONB` column already existed in the schema but was confirmed to have **zero read/write call sites anywhere in the codebase** — dead column, not reused here in favor of a real table with per-fact metadata (category, source, timestamps) the admin panel and coach app can list/edit/audit.

### Design: reuses the existing action-JSON mechanism, not a new one

The codebase already had a proven pattern for "the LLM detects an explicit statement, emits a trailing action JSON, the server parses/persists/strips it" — `record_weight` and `set_reminder`, both handled in `handlers/chat.js`'s `finalizeChatReply()`. This adds a third action, `remember_fact`, following the identical mechanism and the same risk-acceptance level (regex + fixed-enum validation only, no semantic/JUDGE verification — consistent with the existing two, not a new gap).

### Schema

`user_memory_facts` (migration `src/schemas/migration_user_memory_facts.sql`): `id`, `user_id` (FK, **not** persona-scoped — an allergy is true regardless of which persona the user talks to, intentionally diverging from `knowledge_entries`' persona scoping), `category` (fixed enum: `dietary_restriction`/`allergy`/`preference`/`goal`/`other`), `fact_zh`, `status` (`active`/`inactive`), `source` (`chat_extracted`/`admin_added`), `first_mentioned_at`, `last_mentioned_at`. A partial unique index on `(user_id, category, fact_zh) WHERE status='active'` powers an `ON CONFLICT ... DO UPDATE` upsert — a repeated exact restatement just bumps `last_mentioned_at` instead of creating a duplicate row. No fuzzy-dedup/contradiction-resolution ("vegetarian" superseding "no pork") — explicitly out of scope, left for manual cleanup via the CRUD UI.

### Extraction (write) — 5 templates, not all 7

New shared prompt block `prompts/viva/factMemoryBlock.js`'s `getFactMemoryBlock(existingFacts)` combines recall (lists known facts) + the extraction instruction (`{"action":"remember_fact","category":"...","fact":"..."}`) in one block, injected the same way `getFactConstraintBlock(context.essential_knowledge)` is — called right after it in each template. Wired into `chat/{casual,biomarker,nutrition,record,emotional}.js` (where personal facts realistically surface) plus `systemHealthAdvice.js`, `systemNutrition.js`, and `systemFormulaExplain.js` (report/formulation prompts — recall-only there, since those flows have no free-form user message to extract a *new* fact from). Deliberately excludes `chat/science.js` (pure science Q&A, low signal) and `chat/reminder.js` (scheduling, unrelated). Nano is out of scope for this pass; nothing in the table design blocks adding nano's equivalent templates later since the table isn't persona-scoped.

`finalizeChatReply()` gained a `remember_fact` regex-extract/`JSON.parse`/validate block (category checked against a fixed `Set`, never trusted blindly from the LLM — same principle as `record_weight`'s numeric bounds check) alongside the existing weight/reminder blocks, plus the upsert `INSERT ... ON CONFLICT`. `stripActionJson()` and the final reply-cleanup `.replace()` chain were both extended with the new pattern so it never leaks into the biomarker-grounding check or the user-visible reply (same rationale as the 2026-07-26 `set_reminder` strip fix).

### Recall (read) — always-fetched, not matched-on-request

Mirrors how `biomarkers`/`dots`/`health_twin` are unconditionally fetched every turn, not gated behind the intent classifier's `required_data` — an allergy needs to be visible regardless of intent. `fetches.user_facts` added to the existing `Promise.all` bundle in `handlePostChat`, plus separate fetches in `handlePostHealthAdvice` and `handlePostFormulaDots` (both `nutritionContext`/Phase-1 and `llmContext`/Phase-2, since ingredient-conflict awareness matters for the dot-count decision itself, not just the narrative explaining it).

### Admin/coach visibility

New `handlers/userFacts.js` (CRUD, mirrors `handlers/knowledge.js`'s shape but scoped by `user_id`), routed at `/api/user-facts[?openid=/coach_id=][/:id]` in `index.js` — follows the existing `?openid=`-scoped fan-out pattern the admin panel/coach app already use per-section (`/api/biomarkers?openid=`, `/api/health-reports?openid=`), rather than one big nested user-detail endpoint. `handleGetUserFacts` takes an optional `coachId` and enforces the same coarse ownership check `handleGetCoachUserChat` already does (`SELECT 1 FROM users WHERE user_id=$1 AND coach_id=$2`) — only when the caller supplies its own `coach_id`; the admin panel omits it and sees everyone.

- Admin panel: new "Facts" tab in `UserDetailModal` (`UsersTab.jsx`), lazy-fetched on tab click exactly like the existing `chat`/`plans` tabs, with a `UserFactModal` add/edit form (category select, status select, fact textarea).
- Coach app: new "Facts" tab in the client detail sheet (`pages/coach/coach.js`/`.wxml`), mirroring the existing Notes tab's compose-area pattern (category `<picker>` + textarea + save button, list with delete).

### Files

New: `src/schemas/migration_user_memory_facts.sql`, `src/functions/worker/prompts/viva/factMemoryBlock.js`, `src/functions/worker/handlers/userFacts.js`. Modified: `handlers/chat.js` (`remember_fact` action parsing/upsert in `finalizeChatReply()`, `user_facts` fetch + `llmContext` field in `handlePostChat`/`handlePostHealthAdvice`), `handlers/dots.js` (same in `handlePostFormulaDots`), `prompts/viva/{systemHealthAdvice,systemNutrition,systemFormulaExplain}.js` + `chat/{casual,biomarker,nutrition,record,emotional}.js` (one `getFactMemoryBlock()` call site each), `index.js` (`/user-facts` routes), `src/web/admin-panel/src/tabs/UsersTab.jsx` (Facts tab + `UserFactModal`), `src/mini/nano-miniapp/pages/coach/{coach.js,coach.wxml}` (Facts tab, `utils/config.js` VERSION bump).

### Follow-up (2026-07-29): real-user bug report — Viva replied with an unrelated bioage/dots recap instead of acknowledging a stated food preference

Found via a live dev report (user "Pin", channel `aeviva`): stating "我吃素，也吃鸡蛋和牛奶" (a food preference) got back a completely unrelated ~200-word BioAge/dot-formulation summary. Root-caused via direct log inspection (`s worker logs`) and local reproduction (`handlePostChat({...}, {sandbox:true})` run directly against the dev DB, bypassing FC/EventBridge to iterate fast) — **three separate, compounding bugs**, all in code shipped earlier the same day as part of §27:

1. **JUDGE had no visibility into the current user message.** `judgeTemplate.js` only received pre-fetched DB ground truth (`llmContext` + fresh biomarkers/dots + `tool_calls_made`) — never the raw `message` the user just sent. A `remember_fact` action recording a fact for the very first time is, by definition, not yet in `user_facts` (that only reflects facts saved from *prior* turns), so JUDGE flagged the model's correct acknowledgment of what the user just said as an unsupported `biomarker_mismatch`/fabrication and forced a REVISE cycle. **Fix:** `judgeTemplate.js` now takes a `message` param and is told explicitly that content merely restating the user's own current message (including a `remember_fact` tail) is self-evidently grounded, not a claim requiring a database record. `planTemplate.js` got a parallel one-line clarification (PLAN was separately flagging self-reported diet facts as needing knowledge-base "evidence_level" backing, which they don't).
2. **A REVISE-round completion could ship as a blank reply.** When forced into an unnecessary REVISE cycle by bug #1, the model sometimes complied with "remove the unsupported claim" so literally that its rewritten completion was *only* the corrected `remember_fact` JSON tail with no prose — `finalizeChatReply()`'s action-stripping `.replace()` chain then removed everything, shipping an empty string. **Fix:** the stripped result now falls back to an acknowledgment referencing the actual recorded fact (`好的，已记录：<fact>`) rather than ever shipping blank — the fact text is already validated (fixed-enum category) by that point, so it's safe to echo back. `agenticChat.js`'s REVISE correction prompt also now explicitly forbids a bare-JSON-only rewrite, to reduce how often the fallback is needed at all.
3. **`chat/nutrition.js` was missing the "answer what was actually asked" guardrail `chat/biomarker.js` already had.** Even after fixing #1, GENERATE would still sometimes default to a generic BioAge/dots status recap for `nutrition_question` regardless of the actual message — and since that canned content is factually accurate, JUDGE has no basis to flag it (JUDGE checks facts, not relevance/topicality, so a correct-but-irrelevant answer passes clean). **Fix:** added the same "directly address the user's specific message first; don't default to a generic status overview unless one was actually requested" rule `chat/biomarker.js` already carried, to `chat/nutrition.js`.

A fourth, smaller issue was also caught and fixed along the way: on a long/complex ground-truth payload, JUDGE would occasionally reason its own way to "no real issue found" in its analysis text but still emit a structured `REJECT` (a JSON self-consistency failure, not specific to this feature) — `runJudge()` in `agenticChat.js` now downgrades a `REJECT` to `PASS` when every violation's `correction_hint` comes back empty (a real violation always names a concrete fix; an empty hint is the reliable signal that the judge itself found nothing fixable).

**Verified via repeated local trials** (`sandbox:true` runs against dev, bypassing async delivery for fast iteration): before these fixes the canned-recap failure reproduced consistently; after, the large majority of trials correctly acknowledge the stated fact, with the fallback text (`好的，已记录：...`) as an honest, on-topic minimum whenever GENERATE still doesn't produce full prose. **Known residual risk, explicitly out of scope for this pass:** JUDGE is separately prone to rejecting on purely cosmetic wording differences (e.g. "41.0岁" vs "41岁", "已验证" vs "validated") — a pre-existing, systemic over-strictness issue affecting the whole agentic loop, not specific to personal facts, and too large a retuning to take on as part of a targeted bug fix. Revisit if this keeps surfacing as user-visible unnecessary REVISE churn.

## 28. Formulate Dots: Digital-Twin-Driven Agentic Formulation with AM/PM Balancing (Shared by Both Personas)

Added 2026-07-29, originally Viva-only. **Genericized by the persona-unification refactor** (see §16's note): the handler described below as `_handleFormulaDotsViva()` was renamed `_handleFormulaDotsAgentic()` and now runs for both personas — Nano's non-agentic single-completion path (`_runDeterministicFormulation()`) is a shared *fallback* used by either persona on EventBridge-publish failure or agentic-turn failure, not Nano's primary path. §25 gave Viva an agentic *narrative* for an already-committed dot plan, but the actual dot-count decision was still made by `handlePostFormulaDots`'s single non-agentic LLM completion, seeing only the latest biomarker snapshot — never `health_twin` (wearable trends), questionnaire/`bio_data` history, active health-plan goals, physical dot inventory (`user_cartridges`), or prior weeks' formulations, all of which already existed and were queryable but never fed into this one decision. This pass makes the decision itself agentic and adds a new requirement: try to balance total morning vs. evening pill counts, allowed to split a single dot's daily count across both slots (previously a dot was hard-locked to whichever one slot its `timing` column said).

### Three pre-existing bugs fixed along the way (found during research, independent of this feature)

1. `nano/systemNutrition.js` and `viva/systemNutrition.js` showed the model an output-format example using stale `D01:N`/`D02:N` keys, while the formulary listing in the same prompt (and the parser regex) use the real `D-N1`/`D-N2` format from `migration_dots_new_lineup.sql` (2026-07-25). Following the literal example silently parsed to `{}`, falling back to a flat count for every dot — i.e. personalization may frequently not have been taking effect at all. **Fix:** output-format example corrected to `D-N1:N`/`D-N2:N` in both files.
2. `dots` has real per-dot `target_dots_min`/`target_dots_max` columns (e.g. 1–2 for DOT-N1 vs. 56–100 for DOT-N15), but `handlePostFormulaDots` didn't even SELECT them — the clamp was a hardcoded global `Math.min(10, Math.max(1, N))`, and the old `_calcDotCounts()` fallback was a flat constant `4` regardless of the dot. **Fix:** the formulary SELECT now includes both columns; clamping and the fallback (`_fallbackCountForDot()`, midpoint of a dot's own min/max) are per-dot.
3. `agenticTools.js`'s `get_nutrition_schedule` tool queried `dot_id, dot_name, timing, quantity` — columns that don't exist on `nutrition_schedules` (the real schema only has `recipe JSONB`). It failed silently (caught, returned no data) on every call. **Fix:** rewritten to join `nutrition_plans` for `status` and flatten `recipe->'dots'` into rows in JS. This mattered here because the new agentic formulation flow reads schedule history through this exact tool.

### Design

**Deterministic formulator becomes a reusable, shared building block.** The original single-shot "call LLM, parse ANALYSIS/FORMULATION, clamp per-dot, split into morning/evening keys" logic was extracted out of `handlePostFormulaDots` into `_runDeterministicFormulation()` (`handlers/dots.js`) — it no longer touches the DB, just returns `{analysis, finalContent, morningRecipe, eveningRecipe}`. A second extracted helper, `_commitNutritionPlan()`, does the actual transaction: supersede any existing `active` plan for the user, activate (or insert) the plan row, write 7 identical days of morning/evening `nutrition_schedules`. Nano's path calls both directly, unchanged in behavior beyond inheriting the three bug fixes above.

**The decision now runs through the full agentic loop, delivered async — not a blocking HTTP call.** Given §22's confirmed FC 3.0 behavior (the platform cancels an invocation the instant the HTTP client disconnects) and that a PLAN→GENERATE→JUDGE→REVISE turn can take 10s–180s+, `handlePostFormulaDots`'s agentic branch (`_handleFormulaDotsAgentic()`, both personas — see this section's opening note) does not run the decision inline. Instead:

1. **Phase 1 (fast, synchronous):** insert a `nutrition_plans` row with `status = 'pending'` (new column, migration `migration_nutrition_plans_status.sql`; `'pending' | 'active' | 'superseded'`, default `'active'` so every pre-existing row and Nano's path need zero change) — no schedules yet. Build a rich `llmContext` following the same "always-fetch" convention `handlePostChat`/`handlePostHealthAdvice` use: `health_twin`, `questionnaire_context`, `active_health_plans` are now fetched here for the first time (previously `null`/never fetched for this handler); `user_facts`, `essential_knowledge`, `current_solar_term`, `dots` (now with min/max) as before. Biomarker history, dot inventory, and prior schedules are deliberately *not* pre-fetched — they're reachable on-demand through the agentic loop's existing tools (`get_biomarker_history`, `get_dot_inventory`, `get_nutrition_schedule`), mirroring how `handlePostChat` already splits "always fetched" vs. "tool-fetched" data. Publish a `chat.generate` event (`publishChatGenerateEvent`, unmodified) with a new `kind: 'formula_dots_generate'` and `pending_plan_id` in the payload, then return `{success:true, processing:true}` immediately — actually *faster* than the old synchronous path, since no LLM call blocks the response anymore.
2. **Phase 2 (async, `handleChatGenerateEvent`'s `kind === 'formula_dots_generate'` branch):** runs `runAgenticTurn()` unmodified against a new prompt, `prompts/viva/systemFormulaGenerate.js` (supersedes and replaces the old narrative-only `systemFormulaExplain.js`, now deleted — nothing publishes the old `'formula_dots'` kind anymore). The prompt lists each dot's real min–max range (not a flat 1–10) and default timing slot, includes the full digital-twin context, and instructs the model to scale within each dot's own range by biomarker severity, plus a **soft, prompt-driven AM/PM balancing rule**: after assigning each dot's total to its default slot, compare morning vs. evening totals and move part of a dot's count to its non-primary slot to narrow the gap — but keep the majority of any dot's count in its biologically appropriate slot, and never move a stimulant dot into evening or a sleep/relaxation dot into morning. (The schema has no hard `timing_flexible` flag — this is a "try the best" scope by design; a future column could tighten the guarantee if the soft version proves too loose in practice.) Output is normal prose analysis followed by a trailing action-JSON tail, the same established convention `record_weight`/`set_reminder`/`remember_fact` use: `{"action":"formulate_dots","formulation":[{"dot_key":"D-N1","morning":2,"evening":1}, ...]}`, one entry per formulary dot including explicit 0s.
3. **New finalizer `finalizeFormulaDotsGenerate()`** (`handlers/chat.js`) parses the action tail (`_extractTrailingJson()` — a brace-depth scan, not a `[^}]*` regex, since this action's JSON nests objects unlike the other three's flat shape), validates every `dot_key` against the real formulary and clamps each dot's `morning + evening` total into its own min/max (scaling the split proportionally if clamping changes the total) — never trusting the model's numbers or keys blindly, same principle as every other action. Any dot the model omitted gets the same deterministic per-dot fallback (`_fallbackCountForDot()`), split entirely into its default slot. If the action tail is missing or unparseable entirely, the whole thing falls back to `_runDeterministicFormulation()` so the user is never left with nothing (same resilience principle as §27's `remember_fact` blank-reply fix). Commits via `_commitNutritionPlan()` against the `pending_plan_id`. **The agentic reply's own prose (tail stripped) doubles as the user-facing explanation** — collapsing the old two-hop "decide, then a second agentic call to explain" design into one, since Phase 2 is now the smart call itself rather than a dumb single-shot needing a narrator.
4. On any Phase-2 failure (agentic turn throws), `handleChatGenerateEvent`'s catch block runs the same deterministic-formulation-and-commit fallback rather than just posting an error notification — a pending row is never left orphaned.
5. `handleGetNutritionPlan` filters `WHERE status = 'active'` — while a new formulation is `pending`, this naturally keeps serving the previous plan (graceful "still last week's plan until the new one lands," no new frontend state needed).

**No miniapp changes.** `runFormulaDs` (`utils/tool-actions.js`) already never displayed inline formulation content — it shows canned "generating…"/"complete" text and relies entirely on the existing notification-poll mechanism (confirmed true since §25). The Viva POST returns at least as fast as before (faster, since no synchronous LLM call blocks it), so none of §24's timeout/async-flag plumbing was needed here.

### Files

New: `src/schemas/migration_nutrition_plans_status.sql`, `src/functions/worker/prompts/viva/systemFormulaGenerate.js` (later joined by a Nano-branded `prompts/nano/systemFormulaGenerate.js` — see §16's persona-unification note). Modified: `handlers/dots.js` (shared bug fixes, `_runDeterministicFormulation()`/`_commitNutritionPlan()`/`_fallbackCountForDot()` extraction and export, `_handleFormulaDotsAgentic()` — originally `_handleFormulaDotsViva()`, renamed and shared, `handleGetNutritionPlan` status filter), `prompts/nano/systemNutrition.js` + `prompts/viva/systemNutrition.js` (key-format fix), `lib/agenticTools.js` (`get_nutrition_schedule` real-column fix), `handlers/chat.js` (`finalizeFormulaDotsGenerate()`, `_extractTrailingJson()`, `handleChatGenerateEvent`'s `kind` branch + failure fallback). Deleted: `prompts/viva/systemFormulaExplain.js` (superseded — its job is now done by `systemFormulaGenerate.js`'s own reply).

Files: `prompts/viva/judgeTemplate.js` (`message` param), `prompts/chat/planTemplate.js` (self-reported-fact clarification), `lib/agenticChat.js` (`message` threaded into `runJudge`, REVISE correction prompt strengthened, self-contradiction downgrade), `handlers/chat.js` (`recordedFactText`-aware fallback, replacing the old bare-generic fallback), `prompts/viva/chat/nutrition.js` (relevance-first rule, mirroring `chat/biomarker.js`).

## 29. Viva Proactive Daily Check-Ins (Morning / Midday / Evening)

Added 2026-07-29. Every previous Viva feature (§21-28) only responds when the user speaks first. This adds the reverse: Viva initiates, up to three times a day, checking in on today's dots and flagging one grounded thing to watch for. Delivery is **in-app only** — the message waits in `notifications` for the user's next app-open (identical to how reminders/coach messages already surface), not a true WeChat push (no subscribe-message/template-message send exists anywhere in this codebase; that would need a new WeChat-platform template plus opt-in UI — out of scope). Content generation is a **single lightweight completion**, not the full PLAN→GENERATE→JUDGE→REVISE agentic loop — appropriate for a routine message going out to every eligible user up to 3x/day. **Viva only.**

### Trigger model: each user's own first app-open within a period, not a fixed clock slot

Different users open the app at different times, so this fires on individual activity, not a global time. The signal already existed: the miniapp's `onShow()` (`pages/main/main.js`, fires on every app open/foreground) calls `POST /api/heartbeat` → `UPDATE users SET last_active_at = NOW()` (`handlePostHeartbeat`, `handlers/chat.js`) — the same recency signal the pre-existing `user_online` dispatcher scan already keys off (`last_active_at > NOW() - INTERVAL '2 minutes'`). The day is split into three non-overlapping Shanghai-time periods via a new `getCheckinPeriod(hour)` helper (`dispatcher/index.js`):

| Period | Shanghai hours | `notification_type` |
|---|---|---|
| morning | 05:00–10:59 | `morning_checkin` |
| midday | 11:00–16:59 | `midday_checkin` |
| evening | 17:00–23:59 | `evening_checkin` |
| (none) | 00:00–04:59 | — no check-in fires |

Each period is independently gated by "already sent today" (a `NOT EXISTS` against `notifications`, checked per period-specific `notification_type`) — this, not the period boundary, is what actually enforces "once per period per day," so a missed cron tick is harmless and there's no per-user schedule state to store. A user whose first open of the day happens to be at 8pm gets only the evening message, not a backdated morning+midday. `users.preferences->>'daily_checkin_enabled'` (the pre-existing, previously-unused `preferences JSONB` column) is an opt-out honored from day one even though no settings UI was built for it in v1.

### Dispatcher scan (`src/functions/dispatcher/index.js`)

New "Scan 0," run once per cron tick before the existing scans, gated on `getCheckinPeriod(getNowShanghai().hour)` returning non-null:

```sql
SELECT u.user_id
FROM users u
JOIN channels c ON c.id = u.channel_id
JOIN nutrition_plans np ON np.user_id = u.user_id AND np.status = 'active'
WHERE c.config->>'persona_type' = 'viva'
  AND 'user' = ANY(u.roles)
  AND COALESCE((u.preferences->>'daily_checkin_enabled')::boolean, true) = true
  AND u.last_active_at > NOW() - INTERVAL '2 minutes'
  AND EXISTS (SELECT 1 FROM nutrition_schedules s WHERE s.plan_id = np.id AND s.scheduled_date = CURRENT_DATE)
  AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = u.user_id AND n.notification_type = $1 /* e.g. 'morning_checkin' */ AND n.sent_at::date = (NOW() AT TIME ZONE 'Asia/Shanghai')::date)
```

The schedule-existence check is scoped to `s.plan_id = np.id` (the specific active plan), not just `user_id` + today's date — testing during this pass surfaced that a user can accumulate schedule rows sharing the same `scheduled_date` across multiple superseded/pending plans from repeated re-formulation, so an unscoped check could false-positive on stale rows. Matched users are dispatched via a new `dispatchToWorker()` helper (factored out of the existing inline `nutrition_topup` EventBridge-publish-with-HTTP-fallback block, now shared) as a CloudEvent (`source: 'acs.dispatcher'`, `type: 'checkin.daily'`, `data: { user_id, period }`) straight to the `worker` function — not to the legacy `agent` function (see below).

**Same-tick dedupe against `user_online`:** because this scan keys off the same `last_active_at` recency as the pre-existing `user_online` scan, a Viva user's first open within a period could otherwise double-fire — this check-in *and* the legacy proactive-coach nudge. `checkinUserIds` (the set of users dispatched by Scan 0 this tick) is checked and skipped inside the `user_online` scan's dispatch loop.

### Why this bypasses the legacy `agent` FC function entirely

`src/functions/agent/index.js` + its `proactive.js` prompt (used today for `user_online`/`reminder` triggers) is **entirely persona-agnostic and hardcodes "You are Nano"** in its system prompt — it predates the nano/viva persona split built in `worker/`. Reusing it as-is would ship a Viva user a Nano-branded message. Instead, this feature routes straight to `worker` (which already owns every Viva prompt, `getEssentialBlock`, `saveChatMessage`, persona-aware everything) via the identical EventBridge dispatch pattern `dispatcher` already uses to reach `worker` for `nutrition.topup`.

**Pre-existing gap noticed in passing, not fixed here:** `worker/index.js`'s EventBridge CloudEvent routing block had cases only for `acs.lab`/`biomarker.lab_complete` and `acs.chat`/`chat.generate` — no case for `acs.dispatcher`/`nutrition.topup`. Since the trigger's source filter already allows `acs.dispatcher` through, a `nutrition.topup` CloudEvent that reaches `worker` via a successful EventBridge publish matches no branch and is silently dropped (`{ok:true}` returned, nothing done) — only the rarer HTTP-fallback path (used when EventBridge itself throws) would have any chance of being handled, and even that fallback POSTs a bare payload with no `rawPath`, so it likely doesn't route correctly either. This feature's own `checkin.daily` gets an explicit, correct case (see below) so it doesn't inherit the same silent-drop bug, but the `nutrition_topup` gap itself is untouched — worth a dedicated follow-up.

### Worker routing (`src/functions/worker/index.js`)

New branch alongside the existing two:
```js
} else if (event.source === 'acs.dispatcher' && event.type === 'checkin.daily') {
    try { await handleDailyCheckinEvent(cloudData); }
    catch (err) { console.error(JSON.stringify({ level: 'ERROR', msg: 'handleDailyCheckinEvent failed', error: err.message })); }
}
```

### New handler (`src/functions/worker/handlers/checkin.js`)

`handleDailyCheckinEvent({ user_id, period })` fetches (single-purpose queries, no agentic tool loop): user profile, today's `nutrition_schedules` for the user's **active** plan specifically (flattened via the `dots` table into real names, `recipe.dots` keyed by `key_name` e.g. `DOT01`), the latest biomarker snapshot's `bioage_profile.SubAges` (never `data.actual`, per §17), active health plans, `getEssentialBlock('viva')`, and the current solar term. The single most-elevated sub-age dimension is picked **deterministically in code** (highest sub-age value, not left for the LLM to compare) — consistent with this codebase's general principle of not trusting an LLM with arithmetic it doesn't need to do. One `qwen-plus` completion via a new prompt, `prompts/viva/systemDailyCheckin.js` (one shared template parameterized by `period`, not three near-duplicate files — fetched context and output-format rules are identical across periods, only framing/emphasis differs: morning asks about today's dots + names one thing to watch for; midday is a light, no-new-data progress check; evening asks about evening dots and echoes — not repeats — morning's grounded data point for day-to-day continuity). No action-JSON parsing (one-way message, not a user action) and no grounding/JUDGE pass, consistent with the "lightweight" scope decision. Saved via the existing `saveChatMessage(user_id, 'ai', message, null, 'viva')` and a `notifications` insert (`notification_type: '${period}_checkin'`). On any failure, logs and returns without throwing further — the next period (or tomorrow) naturally retries via the dispatcher's own idempotency check.

**No frontend changes** — surfaces exactly like existing proactive coach/reminder messages, a `chat_messages` row + `notifications` insert shown as a normal AI bubble on the miniapp's next 3s poll. The user's eventual reply flows through the normal `/chat` → `handlePostChat` path like any other message.

**RESOLVED 2026-07-31 — users could receive up to 3 duplicate check-in messages per period instead of 1.** Root cause: the dispatcher's per-tick eligibility query (`NOT EXISTS` against `notifications`) was only ever satisfied by the `notifications` INSERT at the *end* of `handleDailyCheckinEvent`, after two DB round trips and a full LLM completion — a multi-second window during which the dedup guard didn't exist yet. A real user re-foregrounding the app a few times in a row (each `onShow()` → `/api/heartbeat` re-extends the 2-minute `last_active_at` eligibility window) let 2-3 dispatcher ticks all pass the `NOT EXISTS` check and each independently generate + save their own message before the first one's insert landed; `notifications` also had no unique constraint to catch it at the DB level. Fixed by claiming the `(user_id, notification_type, day)` slot **atomically before any slow work starts**: `migration_checkin_dedup.sql` adds `notifications.checkin_date` plus a partial unique index on `(user_id, notification_type, checkin_date) WHERE checkin_date IS NOT NULL`; `handleDailyCheckinEvent` now opens with an `INSERT ... ON CONFLICT (...) WHERE checkin_date IS NOT NULL DO NOTHING RETURNING id` and returns immediately if it loses the race, before touching the DB fan-out or the LLM. The claim row starts `status='claiming'` rather than `'pending'` — the miniapp's 3s `/api/notifications` poll surfaces and marks-sent any `'pending'` row immediately, so an empty-content claim would otherwise flash a blank bubble and burn the slot; the row only flips to `'pending'` (with real content) once the LLM completion succeeds, or to `'failed'` on error. Verified via a direct concurrent-insert test against dev (3 simultaneous claims for the same user/period/day → exactly 1 winner) before shipping to prod.

### Files

New: `src/functions/worker/prompts/viva/systemDailyCheckin.js`, `src/functions/worker/handlers/checkin.js`. Modified: `src/functions/dispatcher/index.js` (`getCheckinPeriod()`, `dispatchToWorker()` helper, Scan 0, `user_online` same-tick dedupe), `src/functions/worker/index.js` (new EventBridge case + `handlers/checkin` require).

## 30. Deploy DNS Workaround — `scripts/dns-override.js`

Ported 2026-08-08 from the sibling GCN repo (`/Users/pin/waven/gcn/scripts/dns-override.js`), which hit and fixed the identical issue for its own Aliyun FC deploys.

`s <fn> deploy` can fail with `getaddrinfo ENOTFOUND resourcemanager.aliyuncs.com` (or another `*.aliyuncs.com` host Serverless Devs resolves during deploy) — confirmed 2026-08-08: the system DNS resolver returned nothing for `resourcemanager.aliyuncs.com` while `nslookup resourcemanager.aliyuncs.com 8.8.8.8` resolved it fine. This is local/ISP DNS resolver flakiness, not an actual outage or a code/config problem — safe to reach for whenever this specific error shows up, no need to diagnose further first.

`scripts/dns-override.js` works around this **without touching any system/network settings** — it's a `--require`-loaded Node module that monkey-patches `dns.lookup` in that one process only, using `dns.Resolver` (Node's own c-ares client, independent of the OS resolver) pointed at `8.8.8.8`. Nothing persists after the command exits.

```bash
source .env && NODE_OPTIONS="--require ./scripts/dns-override.js" s worker deploy -t s-prod.yaml -y
```

Substitute the function name / `-t s-prod.yaml` as needed for other functions or the dev target.

## 31. Health-Plan-Focus-Linked Dot Formulation + GCN Custom-Formulation Purchase Flow

**In-flight, uncommitted as of 2026-08-14** — `git status` on this repo shows this feature's files still modified/untracked on the working tree. Documented here per this codebase's own convention of tracking current disk state; verify with `git log`/`git status` before relying on it as shipped/deployed.

Lets a user's active health-plan **focus** (`health_plans`, §"Health Plan System" in `docs/architecture/health-plan-system.md`) influence which Dots their next formulation emphasizes, links a committed formulation back to the focus that shaped it, and adds a GCN-side purchase flow for buying that exact formulation as a physical product — closing the loop between "join a focus" → "get a formulation weighted toward it" → "buy it."

### Schema

Three new migrations (`src/schemas/`):
- `migration_nutrition_plans_health_plan_link.sql` — `nutrition_plans.primary_health_plan_id`/`secondary_health_plan_id` (nullable FKs to `health_plans`, `ON DELETE SET NULL`). Records which active focus(es) shaped a committed formulation; null when no focus was active at formulation time (today's default, unaffected).
- `migration_custom_formulation_purchase_flag.sql` — `users.custom_formulation_purchased_at` (nullable `TIMESTAMPTZ`). Nano has no visibility into GCN's own orders table, so this one column, set by GCN via `POST /formulation-purchase-confirmed` the moment an order is confirmed paid, is nano's entire signal for "has this user ever bought a custom formulation."
- `migration_webview_token_context.sql` — `webview_tokens.context` (`JSONB`). Lets the miniapp attach an arbitrary intent payload to a minted webview token (e.g. `{intent: 'buy_custom_formulation', nutrition_plan_id}`), carried through the existing `wvt` → `POST /exchange-webview-token` → GCN SSO handoff and returned to the target page (GCN's `dashboard.html`) verbatim after exchange — no new endpoint needed for a new intent, just a new `context` shape.

### Formulation weighting — soft, never exclusionary

`health_plan_templates.recommended_dot_ids` (pre-existing column, previously unused by the formulation engine) now biases both formulation paths toward a user's active focus(es):

- **Deterministic path** (`handlers/dots.js`): `_resolveCandidateDotKeys(activeHealthPlans, dotsFormulary)` unions `recommended_dot_ids` across the user's active `health_plans` (primary + secondary) into a `Set` of `key_name`s, or `null` if no active focus has any recommended dots ("no narrowing," not "recommend nothing"). `_fallbackCountForDot(dot, isRecommended)` then biases the fallback count toward 75% of the dot's own `target_dots_min`–`target_dots_max` range when recommended, 25% when a focus is active but this dot isn't on its list, or the plain midpoint when no focus is active at all — **never zeroes a non-recommended dot out**, per the confirmed product decision that a real biomarker need outside the chosen focus must still be able to surface.
- **Agentic path** (`prompts/{nano,viva}/systemFormulaGenerate.js`): a new `focusWeightingSection` tells the LLM the same thing in prose — skew recommended dots toward the higher end of their range, but every other dot is still decided normally by biomarker severity, never forced to 0 for being off the focus list.

### Linking a formulation back to its focus

`_commitNutritionPlan()` (`handlers/dots.js`) now also writes `primary_health_plan_id`/`secondary_health_plan_id` onto the `nutrition_plans` row it activates, resolved from whichever `activeHealthPlans` entries have `plan_type === 'primary'`/`'secondary'`. `handleGetHealthPlanDetail` (`handlers/health-plans.js`) uses this link in reverse: it now also returns a `formulation` field — the committed dot breakdown (from `nutrition_schedules`, day 0 of the plan) for whichever active `nutrition_plans` row links back to *this specific* focus, or `null` if Formulate Dots hasn't run since joining it. The miniapp's health-plan detail overlay (`pages/main/main.js`/`.wxml`) surfaces this: a dot-breakdown chip row when a formulation exists, or a hint pointing at the chat toolbox's "Formulate Dots" tool when it doesn't.

### Background reformulation bug fix, found along the way

`handleNutritionTopupEvent` (new, `handlers/dots.js`) is the dispatcher's periodic `nutrition.topup` CloudEvent handler — **this event was previously silently dropped**: `worker/index.js`'s EventBridge router had no case for `acs.dispatcher`/`nutrition.topup` at all (a gap §29 already flagged as "noticed in passing, not fixed there"). Now routed and handled: runs `_runDeterministicFormulation()` (the non-agentic path — this is an unattended background job, no user waiting on a reply, mirroring every other fallback path's same latency/cost tradeoff) and commits via `_commitNutritionPlan()`. Sends a `formulation_reorder_ready` notification instead of the generic `nutrition_plan` one when `users.custom_formulation_purchased_at` is set, since a user who's already bought a physical formulation once is the one audience for whom "your formula refreshed, reorder?" is the right framing.

### GCN purchase flow

Two new endpoints, both gated via the existing scoped `GCN_ALLOWED_PATHS` allowlist (§19/`gcn-integration` skill), not nano's superadmin bearer token:

- **`GET /formulation-checkout-snapshot?planId=&openid=`** (`handleGetFormulationCheckoutSnapshot`, `handlers/dots.js`) — lets GCN validate a purchase against the buyer's real, currently-committed recipe before creating an order line, rather than trusting a client-supplied plan id blindly. `openid` is the buyer GCN already resolved from its own SSO session, never client input trusted independently. Reads day-0 of the plan's schedule specifically (every day in the 28-day cycle recomputes the same steady-state recipe except the two DOT-N7 isolation days, which would misrepresent the real formulation — day 0 is never one). Returns `{valid:false, reason: 'plan_owner_mismatch'|'plan_not_active'|'plan_not_found'|'plan_has_no_schedule'|'plan_has_no_dots'|'missing_params'|'invalid_plan_id'|'internal_error'}` or `{valid:true, plan:{...}, recipe_summary:{dot_breakdown:[...]}, verification_ref: <uuid>}` — never a 404/500 for a routine "not ready" case; the caller branches on `valid`.
- **`POST /formulation-purchase-confirmed`** (`handlePostFormulationPurchaseConfirmed`, `handlers/users.js`) — GCN calls this the moment an order is confirmed paid; sets `users.custom_formulation_purchased_at = NOW()` unconditionally (no `ON CONFLICT` guard needed, this is a plain UPDATE, not a first-write-only upsert).

`/health-plan-templates` was also added to `GCN_ALLOWED_PATHS` (it already existed as an internal admin route) so GCN can read the focus catalog directly.

### Miniapp: "Buy This Formulation"

`pages/main/main.js`'s `handleBuyFormulation()` — rendered only in the health-plan detail overlay once `planDetailData.formulation` is populated (i.e. a real committed formulation exists for this focus), and only on the Aeviva channel. Opens the GCN store webview via the existing `_openAevivaStoreGated()` → `openUserApp(path, context)` → `appview.js` chain, now threading `context: {intent: 'buy_custom_formulation', nutrition_plan_id}` through `options.context` → `POST /webview-token`'s `context` body field → `webview_tokens.context` → returned verbatim to GCN's `dashboard.html` on token exchange, so GCN's checkout can read back which exact formulation to price and validate (via the checkout-snapshot endpoint above) rather than a placeholder/generic "buy dots" flow.

### Files

New: `src/schemas/migration_nutrition_plans_health_plan_link.sql`, `src/schemas/migration_custom_formulation_purchase_flag.sql`, `src/schemas/migration_webview_token_context.sql`. Modified: `handlers/dots.js` (`_fallbackCountForDot(dot, isRecommended)`, `_resolveCandidateDotKeys()`, `handleGetFormulationCheckoutSnapshot()`, `handleNutritionTopupEvent()`, `_commitNutritionPlan()`'s new FK writes), `handlers/health-plans.js` (`handleGetHealthPlanDetail`'s `formulation` field), `handlers/login.js` (`handlePostWebviewToken`/`handleExchangeWebviewToken`'s `context` passthrough), `handlers/users.js` (`handlePostFormulationPurchaseConfirmed`), `index.js` (new routes, `GCN_ALLOWED_PATHS` additions, `nutrition.topup` EventBridge case), `prompts/{nano,viva}/systemFormulaGenerate.js` (`focusWeightingSection`), `pages/main/main.js`/`.wxml`/`.wxss` (formulation display + Buy CTA), `pages/appview/appview.js` (`context` passthrough), `utils/config.js` (VERSION bump).

## 32. Shared PolarDB Cluster with GCN — Connection Exhaustion Incident (2026-08-16)

**This cluster is not nano-exclusive.** `pc-uf6ttj5kse63r270k` (console description "nano-polardb",
`polar.pg.sl.small.c`, region `cn-shanghai`) hosts `nano_db`/`nano_db_dev`/`nano_db_test` *and*
GCN's `gcn_db`/`gcn_db_dev` — GCN's `DATABASE_URL`/`DATABASE_URL_PROD` point at this same cluster's
public endpoint (`amclbdsyqvfq.rwlb.rds.aliyuncs.com`), just a different database name. This wasn't
documented anywhere in either repo before this incident — found only by tracing the connection
string via `aliyun polardb DescribeDBClusterEndpoints`.

**Incident**: 2026-08-16 ~08:39 UTC, GCN prod started failing all DB connections with `Sorry, too
many clients already` / `number of normal user connections (193) plus polar super user connections
(8) have exceeded limits`. `pg_stat_activity` on the shared cluster showed 227 total backend
connections, 181 of them `nano_admin`/`nano_db` — GCN's own usage was 1 connection. Root cause: all
five of nano's Postgres `db.js` copies (`worker`, `dispatcher`, `agent`, `lab`, `kino`) constructed
`new Pool({...})` with **no explicit `max`**, so each defaulted to `node-postgres`'s built-in cap
of 10 — and since each warm FC container gets its own module-level pool with no cross-container
coordination, a burst of concurrent FC scale-out had no ceiling on the aggregate connection count
across all of them. Contrast with GCN's own `auth/lib/db.js`, which has always capped `max: 5`.

**Why PolarDB Serverless autoscaling didn't absorb this**: `DescribeDBClusterServerlessConf` shows
`ScaleMax: 4` (PCU) and `ServerlessRuleCpuEnlargeThreshold: 85` — scale-up triggers on CPU%
crossing 85, nothing else. The connection storm was mostly idle pooled connections, not compute
load: CPU peaked at 46.8% during the incident (never near the 85% trigger), even though memory
usage did spike (2% → ~48%, since every open backend connection costs PolarDB per-connection
shared memory regardless of whether it's doing work). A pile of idle-but-open connections is
invisible to this cluster's autoscaling policy.

**Fix**: added `max: 5, idleTimeoutMillis: 10000` to every `new Pool({...})` call in all five
`db.js` copies (`worker`/`dispatcher`/`agent`/`lab`/`kino`, both the `DATABASE_URL` and discrete
`DB_HOST` branches), mirroring GCN's own already-safe pattern. `worker/lib/estimator/db.js` is a
Tablestore client, not Postgres — untouched, not part of this issue. Deployed to all five functions
on both `s.yaml` (dev) and `s-prod.yaml` (prod) — 10 deploys, `npm run deploy:<fn>` /
`npm run deploy:<fn>:prod`. Verified live: `pg_stat_activity` on the shared cluster dropped from
227 total / 181 `nano_admin` to 46 total / 5 `nano_admin` within minutes of the prod deploys as old
unbounded-pool containers cycled out; GCN prod connections succeeded cleanly afterward.

**Known gap, not fully closed by this fix**: capping each pool at 5 lowers the ceiling per
container but doesn't remove it — enough simultaneous warm FC containers across all five functions
can still exhaust the shared cluster's connection budget (~200 at the then-current 1-PCU serverless
tier) under a big enough traffic burst, and PolarDB Serverless's CPU-only scale-up trigger still
won't reliably catch a connection-count-driven (rather than compute-driven) squeeze. No FC-level
concurrency cap was added as part of this fix. If this recurs, check `pg_stat_activity` grouped by
`usename`/`datname` on this cluster first — nano and GCN are genuine neighbors on shared infra, not
two independent databases, and either side's connection behavior can take the other down.

## 33. Multi-Phone System (2026-08-19)

A user can hold more than one verified phone (`user_phones`, primary/secondary via `is_primary`), switch which is primary, remove one, and log in with **any** of them — not just the primary. `users.phone`/`phone_verified_at` are a denormalized cache of whichever row is currently primary, kept in sync by every phone-changing code path (`syncPrimaryPhone` in `handlers/users.js`, `handlers/phone-otp.js`'s bind/set-primary/remove, `login.js`'s WeChat bind/resolve), never a second source of truth.

- **Self-service (miniapp):** `GET/POST /phone-otp/{list,bind,set-primary,remove}` (`handlers/phone-otp.js`), new page `pages/phones/` reached from the main menu.
- **Admin panel:** the Phones tab (in the tabbed user-detail drawer, `UserDetailModal` — click the user's row, not the pencil icon) has full list/set-primary/remove plus an **Add Phone** action (`POST /admin-phone-add` → `handlePhoneOtpAdminAdd`, attaches an unverified number with no OTP proof, for staff use). That endpoint is deliberately **not** under `/phone-otp/`'s bearer-auth exemption — it's gated by `requireAdminTab(adminCtx, 'users')` like every other admin user-write endpoint, since it lets the caller attach an arbitrary number to an arbitrary account with zero ownership proof. The older pencil-icon "编辑用户" modal (`UserModal`) now shows the real phone list read-only (with a "Manage in Phones tab" handoff) instead of its own separate, single-value phone input — it can no longer mutate phone data at all.
- **Login (`handlePhoneOtpVerify`) matches through `user_phones`, not `users.phone`** — any verified phone, primary or secondary, logs into the same account (used by both the miniapp's phone-login screen and the web user-app). This also holds for an admin-added *unverified* phone the moment someone completes a real OTP check against it at login — it resolves to the existing account rather than forking a duplicate, though the login itself doesn't retroactively set that row's `verified_at` (known, un-fixed cosmetic gap — the phone still shows "Unverified" afterward even though possession was just proven).
- **GCN identity bridge (`gcn/src/functions/auth/index.js`'s `handleNanoSSO`):** previously matched a GCN consumer account by phone alone, so switching primary phone on nano's side silently forked a second GCN account. Fixed to resolve by `nano_user_id` first (phone-match only as fallback for first-time/pre-migration accounts), and to mirror nano's **full** phone list (not just primary) into GCN's own `user_phones` on every login, reconciled exactly (stale/removed numbers dropped) — this is also what lets GCN's own native OTP login recognize any of a user's nano-verified phones. `partners.phone` (the separate, single-value cache for a *provisioned partner/store* record — unrelated to the consumer-account phone above) is now kept in sync via `syncPartnerPhoneFromUser`, called from every phone-changing call site rather than only partner-record edits.

Full detail: `docs/architecture/multi-phone-system.md`.

## 34. Digital Twin Terminology & Layer Taxonomy (2026-08-21)

"Digital Twin / 数字孪生" is the umbrella for a user's **entire** health model — never any single
data source. Before this pass the term meant three different narrow things depending on where you
looked: the user manual defined it as "a rolling summary of data synced from your wearable ring,"
every prompt rendering `health_twin` was headed `DIGITAL TWIN (WEARABLE & LIFESTYLE DATA)`, and
`dispatcher/prompts/systemReport.js` used `数字孪生评分 / Digital Twin Scores` for an unrelated
legacy ILI/MFI/MRI/MVII block. The `health_twin` table was never actually that narrow (it already
carries the latest lab panel, latest body composition and denormalized BioAge alongside the ring
averages) — the narrowness was purely in labels and layout, so this was a terminology + IA pass
with **zero schema change**.

### Canonical layer names

These exact strings are used in the miniapp's `t.layer*` i18n keys, the prompt section headers,
and `prompts/chat/twinVocabulary.js`:

| # | ZH | EN | Backing tables |
|---|---|---|---|
| 1 | `精准检测` | `Precision Testing` | `biomarkers(test_type='kino_chip')`; `health_twin.latest_bio_age / latest_sub_ages / latest_kino_scan_at` |
| 2 | `日常监测` | `Daily Monitoring` | `health_events(sleep\|activity\|vitals\|body_composition)`; `health_twin.avg_* / latest_weight_kg / latest_bmi / latest_body_fat_pct / trend_data` |
| 3 | `医疗记录` | `Medical Records` | `health_reports`; `health_events(category='lab_result')`; `health_twin.latest_lab_data / latest_lab_date` |
| 4 | `个人档案` | `Personal Profile` | `users.bio_data`; `questionnaire_responses`; `user_memory_facts` |

The miniapp's Precision Testing section keeps the KINO brand in its label (`KINO 精准检测` /
`KINO Precision Testing`); the bare names above are what prompts and docs use.

**Interventions are deliberately not a layer.** `health_plans` / `nutrition_plans` are what the
user *does*, not what they *are*, and they own the Plans tab. Folding them in would make "twin"
mean "everything," which is how the term lost its meaning in the first place.

### Coupling rule

Like §11's sub-age keys, these names are cross-cutting. When changing any of them, change all
four call sites together:

1. `src/mini/nano-miniapp/components/user-health/user-health.js` — `TWIN_LAYER_LABELS` and the
   `t.layer*` keys in **both** language blocks (WXML has no compile-time key checking, so a
   renamed key silently renders empty — verify with the key-resolve loop in §7 of the plan).
2. `src/functions/worker/prompts/chat/twinVocabulary.js` — `getTwinVocabBlock()`, injected by the
   six heavyweight prompts; the light prompts carry an inline `数字孪生 · 日常监测` /
   `TWIN · DAILY MONITORING` prefix instead.
3. `src/web/user-app/src/i18n.js` — both language blocks.
4. The layer table in `docs/architecture/digital-twin.md`, which is the canonical definition.

**Any new health data surface must declare which layer it belongs to.** If it doesn't fit one of
the four, that's a signal to question the surface, not to add a fifth layer.

### Notable behavior change

The miniapp's tags strip, weight/BMI/steps/HRV strip and photo-captured BP/glucose row were all
inside a card gated on `subAgeList.length > 0` — so a user with a bound ring but no Kino scan saw
none of their own data. They're now in an ungated sibling card. `user_memory_facts` also got its
first end-user surface (read-only, self view only; the coach app already has its own Facts tab).

Full detail: `docs/architecture/digital-twin.md`.
