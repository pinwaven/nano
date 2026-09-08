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
| Deploy scripts | `deploy:worker`, `deploy:dispatcher`, etc. | `deploy:worker:prod`, `deploy:dispatcher:prod`, etc. |
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
npm run deploy:worker:prod
npm run deploy:dispatcher:prod
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

Waven Dots are 36 mg precision nutrition cartridges. Each cartridge delivers one or more active compounds in an exact dose, calibrated to the user's biomarker profile. The system targets four biological age dimensions measured by the Kino chip. The Dots can be mixed by AI at realtime according to the user's actual health data.

### Cartridge Format

- **Payload:** 36 mg per dot
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

**Coach relationship now feeds GCN's store bindings (2026-08-27).** `WEBVIEW_USER_SELECT` in
`worker/handlers/login.js` (the `/exchange-webview-token` GCN SSO exchange) additionally projects
`p.user_id AS coach_user_id` — one line, next to the `cu.nickname AS coach_name` it already
returned. It falls into the existing `...user` rest-spread and reaches GCN as
`nanoUser.coach_user_id`. **No new endpoint and no `GCN_ALLOWED_PATHS` change** — that path was
already allowlisted. **Deployed to nano prod 2026-08-27** (`nano-worker`), together with the 4
pending viva-ag migrations and the unreleased viva-ag commits, at the user's explicit direction.
Verified live: `/api/exchange-webview-token` on prod returns `coach_user_id` matching nano's DB,
with `coach_id`/`coach_name` unchanged. GCN uses it to bind a coached user to their coach's own aeviva store when that
coach is also an active GCN premier partner (`silver_store`/`gold_store`/`platinum_store`), which
was previously only ever created by a first confirmed retail order. Nothing else in nano changed,
and nano remains the sole owner of the coaching relationship itself (`users.coach_id`) — GCN only
reads it. **Deployed to nano dev and prod** (2026-08-27) — see the prod note above. GCN side, including
the backfill script and the conflict policy: GCN's `CLAUDE.md` §"Coach-Client Store Binding".

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

### Delivery is now two-channel (fixed 2026-08-22)

`GET /api/notifications` is a **destructive read** — `handleGetNotifications` flips rows to
`'sent'` inside the same `UPDATE ... RETURNING` that returns them, with no ack from the client. So
one poll response the miniapp never receives (app backgrounded mid-request — `onHide` also clears
the poll timer — a network blip, a request timeout) permanently consumes the only copy of the
reply, and the user sits on the typing indicator until the client's own wait bound gives up.
Confirmed live on dev: a health-advice reply written to `chat_messages` **and** `notifications` 81s
after the request never reached the device.

Two things now backstop it, and both must stay:

1. **`chat_messages` replay.** `handleGetChatHistory`'s `since_id` poll takes a `roles` param
   (default `'coach'`, so every other caller is unchanged). While a turn is pending — and only
   then, gated on `_chatWaitStartedAt` in `pages/main/main.js`'s `_poll` — the miniapp asks for
   `roles=coach,ai`, and any AI row written since the last tick is rendered from there.
   `chat_messages` is not destructive, so this recovers the lost-notification case within one 3s
   tick. Cross-channel de-dup is keyed on normalised text (`_aiKey`/`_markRenderedAi`) and scoped
   to `AI_ECHO_TYPES` — notification types that genuinely also write a `chat_messages` row.
   `coach_reminder` is deliberately excluded: it has no chat row, and two identical reminders are
   two real messages, not a duplicate.
2. **A 250s watchdog in `handleChatGenerateEvent`** (`DELIVER_DEADLINE_MS`). `runAgenticTurn`'s own
   200s `TURN_DEADLINE_MS` plus `finalizeChatReply`'s grounding retry (one more ~60s LLM call) can
   legitimately reach ~270s against the worker's hard 300s FC ceiling — and a platform kill runs no
   JS at all, so nothing in that function's `catch` can rescue it. The work is raced against the
   watchdog; whoever gets there first (real reply, error fallback, or watchdog) delivers exactly
   one terminal message via `_deliverTerminalMessage` (both `chat_messages` and `notifications`),
   guarded by a single-use `claimDelivery()`.

`DELIVER_DEADLINE_MS` reads `CHAT_DELIVER_DEADLINE_MS` so the watchdog is testable without a 250s
wall clock (`tests/chat-async-delivery.test.js`); nothing sets it in `s.yaml`.

The failure text is localised by `user.language` (`_asyncFailureMessage`) — it was hardcoded
English and shown verbatim to zh-only Viva users. The client's last-resort message at 285s now says
the turn didn't finish rather than "还在处理中", because by then both channels and the server
watchdog have all had their turn.

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

## 28b. Formulate-Dots Proposes a 28-Day Plan (2026-08-28)

The chat toolbox's **Formulate Dots** (`handlePostFormulaDots` → `_handleFormulaDotsAgentic` →
`finalizeFormulaDotsGenerate`) writes a **`'proposed'`** `nutrition_plans` row and renders the whole
28-day cycle in the chat bubble as a `:::formula` card.

Between 2026-08-25 and 2026-08-28 this tool was evaluation-only and wrote nothing, on the reasoning
that the 28-day formula a user receives comes from Viva AG's `dots_formulation` job (§35/§36). That
left it with no route to the store: GCN's custom-formulation checkout prices a recipe out of a
`nutrition_plans` row, and there was no longer a row to price. It now proposes.

### A BioAge is a precondition, not an input (2026-09-08)

`handlePostFormulaDots` **refuses to formulate at all** when `data.bioage_profile.BioAge` is null,
and asks the user for a Kino scan instead. No plan row, no LLM call, no card. The gate sits before
`getEssentialBlock`/`getCurrentSolarTerm` so it short-circuits the work, and a test pins that it
precedes `_handleFormulaDotsAgentic`.

Every dose here is scaled by how far a sub-age sits above chronological age — `_doseFromRanking`,
`_fallbackCountForDot`, and the severity ranking the prompt asks the model to produce. With no
BioAge there is nothing to scale against, so what shipped instead was a formula derived from age
and BMI alone, narrated by a model that had been handed no biology to explain it with. Prod,
2026-09-08: a full 28-day card with the entire narrative above it replaced by
**目前没有足够信息支持这个判断。** — a card the user is invited to order, under a sentence saying it
could not be reasoned about.

**A `lab_import` panel does not qualify.** The biomarker query is `kino_chip`-only, as it is at all
13 of its call sites, so a user with 21 lab rows and no scan lands here too. Widening that is a
product decision about whether an imported panel is a Kino test, and it is not made here.

The refusal is delivered as a normal AI bubble on **both** channels (`chat_messages` plus a
`formulation_proposal` notification — a type already in the client's `AI_ECHO_TYPES`) and the
handler returns `processing: true`. **Deliberately no client change:** `runFormulaDs` prints its
canned 配方已生成 for any non-`processing` success, so a plain `{success:true}` would put "generated"
beside the refusal, and `{success:false}` would show a generic error rather than the explanation.

The other half of that prod bug was the guardrail itself, and it is **not** specific to
formulation — see §26's note on the essential block. It used to hand the model a quoted,
ready-made refusal (`直接说："目前没有足够信息支持这个判断。"`), which is the cheapest thing in a
prompt to emit: 25 replies in 30 days reached for it, either as the whole reply or as a refusal
followed by paragraphs of the advice it had just declined. The clause now says to name the missing
data and continue with what the available data supports, and bans both shapes outright.
`migration_knowledge_refusal_wording.sql` plus the three hardcoded copies — **change all four
together**, per §26/§37.

### `'proposed'` is a fourth status, and none of the other three would do

`migration_nutrition_plans_proposed.sql`. `'pending'` means an async formulation is mid-flight and
may never land. `'approved'` means a nutrition expert signed the recipe off and a batch is being
compounded — conflating the two would let unreviewed model output reach the compounding queue.
`'active'` means the user physically has the capsules. A proposal is none of those: a real,
purchasable recipe for capsules that do not exist yet.

- **No `nutrition_schedules` rows**, same as `'approved'`. The recipe lives in
  `nutrition_plans.proposed_recipe` (`{morning:{}, evening:{}}`) — a proposal has no schedules to
  read it back out of.
- **It never supersedes the `'active'` plan.** Only a previous proposal is superseded, so a user
  mid-cycle on a box they already have keeps taking it. `uniq_nutrition_plans_proposed` enforces
  one live proposal per user.
- `handleGetNutritionPlan` filters `status = 'active'`, so a proposal is invisible to the Dots
  subtab with no code change — which is also why the card carries the numbers itself and there is
  still **no "view plan" button**: it would open the *previous* plan.

### Day numbers are relative, and that is the product, not a limitation

The capsules must be compounded and shipped, so the card says `Day 1–9 · 12–28`, never a date.
`_activateProposedPlan` (called from `handlePostBoxClaim` when a batch carries `plan_id` and no
`ag_formulation_id`) is where "Day 1" stops being relative: `start_date` becomes that day and the
56 capsules are written. Same shape as the AG flow's `_commitAgFormulation`, one status earlier.

### `_expandPlanDay` is the single expansion rule set

The N7 isolation override, the pulse window and the `MAX_DOTS_PER_CAPSULE` cap are applied in
exactly one place, shared by **three** consumers that must never disagree about what a user is
actually taking: `_commitNutritionPlan` (nano's own formulator writing schedules),
`_activateProposedPlan` (the box scan) and `_planDayGroups` (the card).
`tests/formula-28day-proposal.test.js` asserts the dateless preview matches what the scan writes,
day for day. Don't reintroduce a second copy of these rules.

**`_isPulseActiveDate` cannot be evaluated without a date** — it is anchored to a fixed calendar
epoch — so `_expandPlanDay(i, ctx, null)` leaves pulse dots in every day. Exact today (`DOT-N7` is
the only pulse dot and is routed through isolation, never through that gate), but a second pulse
dot would make a proposal over-state the days it appears on until the scan anchors the cycle. Fix
that by resolving the window at scan time, **not** by inventing a start date for a proposal.

### The card

`_buildFormulaChartBlock` (`handlers/dots.js`) builds it **server-side from the already validated
recipe** — the model never writes it, so the bars can never disagree with the numbers they draw.
Days whose two capsules are identical are collapsed into one group, so a 28-day plan is normally
two groups (the everyday dose, and the two `DOT-N7` reset days) rather than 28 near-identical rows.

Dot rows are still `key|name|color|am|pm`. Meta lines are **`'#'`-prefixed and all optional**, which
no dot key can start with, so a card written before this change still renders as one unlabelled
group — **keep them optional**:

- `#cycle|<days>|<capsules>` — footer
- `#plan|<id>` — the proposed row; enables the order CTA, and is digits-validated in the renderer
  before it reaches a `data-` attribute
- `#day|<ranges>|<kind>` — starts a group. Ranges are **bare numbers**; the localised day word is
  the page's (`t.formulaDayWord`), because `utils/markdown.js` has no language context.

Bar widths normalise against the largest capsule across **all** groups, so a reset day reads as the
smaller capsule it genuinely is instead of self-normalising to look full.

### Checkout needed no GCN change

`handleGetFormulationCheckoutSnapshot` now accepts `'proposed'` as well as `'active'`, deriving
day 0 from `proposed_recipe` through `_expandPlanDay` (day index 0 is never an isolation day, so it
yields exactly the steady-state capsules that endpoint already promised). GCN's checkout reads
`snapshot.valid` and the dot breakdown and never inspects plan status, so nothing changed there.
The tap-through reuses the existing `webview_tokens.context` bridge with
`{intent:'buy_custom_formulation', nutrition_plan_id}` (§31), which GCN's `dashboard.html` already
routes into `openCustomFormulationCheckout`.

**Nano does not price this, and must not start.** GCN sums the dot breakdown against its own
`custom_formulation_dot_prices` and, since 2026-08-28, takes the buyer's own aeviva partner tier
off that subtotal (`silver_store`/`gold_store`/`platinum_store`, `migration_0082` there) — a
premier partner tapping this CTA had been paying the plain consumer price because every
formulation sku is intercepted before GCN's wholesale machinery runs. The card carries no price
for exactly this reason: the number the user is charged is settled on GCN's side at order time,
after nano's snapshot is validated. Detail: GCN's `CLAUDE.md` §"Premier-partner pricing on
formulation products".

### The daily budget: rebalance, then reduce, then drop (2026-08-30)

Every dot has a `target_dots_min`, and those floors sum past the `2 × MAX_DOTS_PER_CAPSULE` a day
holds. A full formulary therefore **cannot** keep every dot, and `_fitRecipeToDailyBudget` is where
that is resolved — on daily totals, before anything is split into capsules.

`_capRecipeTotal` used to resolve it instead, by scaling every dot down proportionally, which put
most of them under their own minimum. `lib/agFormulation.js` calls that `dose_below_min` and
refuses the formula. It went unnoticed because nothing validated nano's own output until the
fast-track path (which no expert reviews) started sending it to GCN.

**A sub-therapeutic dot is worse than an absent one** — it occupies capsule space a real dose could
have used. The validator agrees: an absent dot is legal, an underdosed one is not. That is the
invariant, and it is why the give-back below stops at each dot's own floor.

It gives in three stages, cheapest sacrifice first. The first two were added 2026-08-30; before
that the function went straight to dropping, so it destroyed whole interventions to buy room that
was already lying unused inside the survivors — a midpoint allocation kept 8 of 17 dots where it
can now keep 16.

1. **Rebalance.** A flexible dot in an over-full capsule moves to the other one before anything is
   reduced or removed. Costs nothing: the daily dose is unchanged, taken at the other end of the
   day. Two passes — the first keeps the majority of a dot's count in its own slot (the rule
   `systemFormulaGenerate.js` and the AG contract both state), the second drops that preference,
   because a capsule that does not physically close is not a trade-off.
2. **Reduce toward each dot's floor**, proportionally to how much it asked for above that floor, so
   a dot pushed to its ceiling keeps more of that emphasis. It **only ever takes away** — never
   raises a dot toward its floor or above what was asked for.
3. **Drop whole dots**, and only once even the floors of everything don't fit. **A dropped dot
   leaves both slots** — half a daily dose is the underdose this exists to prevent.

**Which dot goes** is read from the formulator's own emphasis: lowest relative position in its own
min–max range first (the same scale `_fallbackCountForDot` writes on). Ties break toward the larger
**floor**, because by the time a drop is considered every survivor is at its floor and the floor is
what actually relieves the constraint. A product judgement, worth revisiting with the clinical side.

A **non-flexible** dot cannot leave its own capsule, so its slot's floors must fit that one capsule
on their own — checked before the day-wide budget, and the reason the split at the end is always
feasible.

`_capRecipeTotal` still runs inside `_expandPlanDay`, but on a recipe that already fits it is a
no-op safety net rather than the thing deciding doses. **Don't move the budget decision back into
it** — it works per capsule and the floors are per day, so it structurally cannot enforce them.

A recipe that already fits both capsules is returned **untouched**, not re-derived: the caller's own
AM/PM split is a real decision and there is nothing to fix.

### Levelling the two capsules (2026-09-08)

Full pipeline, twin to capsules: [docs/architecture/dots-formulation.md](docs/architecture/dots-formulation.md).

Fitting the budget is not the same question as which capsule a dose is taken in, and nothing was
answering the second one. `_splitDotTiming` decides one dot at a time and cannot see the day, so a
real dev proposal came out **71 in the morning against 31 in the evening** simply because four of
its six dots default to Morning — under the cap, so `_fitRecipeToDailyBudget` correctly ignored it.

**`_balanceCapsules` runs after the budget is settled**, at all three points a recipe is built: the
agentic path, the deterministic fallback, and **per week** inside `_planExpansionContext`. Per week
matters — a week that rotates an evening dot out is lopsided in a way the stored recipe cannot
anticipate, and it is the expansion the card, the checkout snapshot, the fast-track submission and
the box scan's schedules all read.

1. **Timing-locked dots first**, whole, into their own capsule (`timing_flexible = false` — today
   `DOT-N3` evening, `DOT-N4` and `DOT-N12` morning). Nothing afterwards may move them, so a day
   whose morning is mostly locked stays a heavier morning. They are the only thing that can leave
   a day uneven.
2. **Flexible dots hand dose from the heavier capsule to the lighter one**, largest first, until
   they meet. A flexible dot may end up **wholly** in its non-default capsule.

It only ever moves dose between capsules: daily totals, formula membership and what a tier counts
are all untouched, and the move is bounded by half the gap so a capsule can never overshoot the
other. That is what makes it safe to run on a recipe every downstream reader has already agreed on.

**`slot_minority` was removed from `validateAgFormulation` to allow this** (2026-09-08). It failed
a flexible dot with more of its dose in the other capsule than its own — a rule already implied by
nothing: `timing_flexible` means 早晚皆可，可自由拆分 (the column's own words, rendered verbatim
into the prompt), and `timing_flexible = false` is what exists to express a genuine diurnal
requirement. It also contradicted §8 of `worker/docs/viva-ag-api.md`, whose enforcement summary
lists only "non-flexible dots confined to their own slot". **If a dot must not be taken mostly at
the other end of the day, mark it `timing_flexible = false`** — do not reintroduce a majority rule.
`slot_violation` is untouched and still the hard gate for locked dots.

### The label QR: one code from formula to box to activation

`nutrition_plans.label_code` (`WVB` + 12 hex, `migration_nutrition_plans_label_code.sql`) is minted
by `lib/labelCode.js` **when the formula is generated** — not at box-batch time, which is far too
late to show anyone. It is the QR the user views in chat, the label printed on the box, and the
code the Mini Program scans to activate the plan.

```
_commitProposedPlan  → label_code minted
chat card            → #label|https://aeviva.gcn.net/formulation-label.html?c=WVB…
box batch for a plan → the FIRST box reuses that code as its box_code
user scans the box   → /WVB[0-9A-Fa-f]{12}/ reads it out of that URL → plan goes active
```

- **One code space, two tables.** `generateLabelCode()` checks `boxes.box_code` **and**
  `nutrition_plans.label_code`. A collision means a scan resolving to someone else's capsules.
- **The `WVB` + 12-hex shape is load-bearing.** It is what lets one QR be both a human-readable
  page (phone camera) and a claim token (Mini Program) — `handlePostBoxClaim` regex-extracts it
  from a bare code, nano's old `/api/box/{code}` URL, or the GCN aeviva URL alike. Old printed
  labels therefore keep working; physical objects already shipped cannot be re-printed.
- **Minting a code does NOT make anything claimable.** A scan still resolves through
  `boxes`/`box_batches`, which exist only once a batch is compounded — so scanning the QR of a
  formulation nobody manufactured returns `box_not_found`, not an activated plan for capsules the
  user does not have. **Don't "simplify" claim to resolve straight off `label_code`.**

### A label outlives the formulation it describes

The QR is printed on a physical box, so it must keep resolving after the plan behind it stops being
current. Day 0 therefore falls back to `proposed_recipe` whenever a plan has **no schedules**,
regardless of status — **not** gated on `status === 'proposed'`, which is what made a superseded
proposal's label fail with `plan_has_no_schedule` the moment its owner formulated again.

`status` is what tells the reader where they stand (`proposed` / `approved` / `active` /
`superseded`), and the page renders a 已被新配方替代 badge plus a hint that scanning it activates
nothing. **`handleGetFormulationCheckoutSnapshot` stays gated on `active`/`proposed`** — a replaced
formulation may be read, never bought.

An unresolvable code says the label has expired and was likely replaced, rather than "not found":
a mistyped code and a deleted one are indistinguishable from the server, and "not found" reads to a
customer as "your box is counterfeit".

### `GET /api/formulation-label?c=` is PUBLIC, and that constrains it

Routed before the bearer gate, like `/api/box/{code}`, because the code is printed on a physical
object — whoever holds the box can read it. So it returns **no user identity of any kind** (no
user_id, openid, nickname, phone, or biomarker value) and truncates the order reference. A test
asserts the user id is absent from the payload. **Never enrich this response with anything
user-identifying**, on either side of the proxy.

GCN's `formulation-label.html` reads it through `GET /api/mall/aeviva/formulation-label` — a
server-side proxy, not a browser fetch, for the two reasons `handleNanoFocusTemplates` documents:
nano's routes all require some bearer, and nano's custom domain emits a duplicate
`Access-Control-Allow-Origin` header that browsers reject outright.

`AEVIVA_SITE_BASE_URL` (`s.yaml` / `s-prod.yaml`) is the public aeviva site — distinct from
`GCN_API_BASE_URL`, which is the server-to-server API edge. It is a verified WeChat business
domain, which is why `<web-view>` can load it and why the miniapp opens the label rather than
drawing a QR natively: the user should see the exact page that prints on the box.

### Two purchase orderings, and the card is where they differ

A custom-dots order can be placed either way round, and the chat card adapts:

```
formulate → buy    chat tool → 'proposed' plan → GCN prices THAT recipe per-dot
buy → formulate    GCN parks the order at 'awaiting_formulation' → chat tool fills it in
```

`_resolveOrderMode()` asks GCN (`fetchFormulationOrderStatus`, `lib/gcnClient.js`) which case this
is, and the answer becomes the card's `#order` mode: `buy`, `submit` (a paid **fast-track**
package is waiting) or `ag` (a paid **premium** package is waiting — Viva AG owns it, no CTA).

- **Pulled at delivery time, never cached on the user row.** An order can be refunded, cancelled,
  or fulfilled by an AG run in between. Resolved when the card is built rather than when the
  request was made, because the turn is async and may be minutes old.
- **Any non-answer degrades to `buy`** — the safe direction. A buy button someone already paid
  past is ignorable; a submit button with no order behind it fails on tap.

### Fast track: `POST /formulation-submit`

The user confirming that a proposal is the formula to compound for a package they already bought.
**No expert reviews it** (that is what the premium AG package's higher price buys), which makes
`validateAgFormulation` the only thing between a generated allocation and capsules a person
swallows. It **refuses** on any violation and repairs nothing — §36's rule, same reasoning. The
expansion is rule-conformant by construction (`_expandProposalToCapsules` → `_expandPlanDay`), so
a violation means the expansion regressed.

The AM/PM split is what keeps it valid: `_splitDotTiming` forces a non-`timing_flexible` dot
(`DOT-N3`, `DOT-N4`, `DOT-N12` today) wholly into its own slot, and the validator's
`slot_violation` rule rejects anything else. **Never assemble a recipe without it** — a test pins
both halves of that.

Submission is idempotent via `nutrition_plans.gcn_order_id`, so a double tap can never send two
formulas for one purchase.

### On GCN's side: no new branch flag

Three existing SKU columns express the fast-track product (`migration_0081`):

| column | meaning here |
|---|---|
| `is_ag_formulation_bundle = TRUE` | the **order shape** — flat-priced, no recipe at checkout, parks at `awaiting_formulation`. The "AG" is historical (0078 shipped it first); read it as "buy-first formulation bundle". |
| `requires_expert_review = FALSE` | the **fulfilment** — reported to nano as `fulfillment: 'fast_track'`. This one flag is the entire difference between the two packages. |
| `viva_subscription_plan_key = NULL` | the **entitlement** — none. A NULL key means the purchase grants nothing, and the insert is skipped rather than defaulted. |

A future third package is therefore a configuration change, not a code change.
`handleFormulationFastTrack` **refuses** an order whose SKU requires review rather than quietly
downgrading it; nano surfaces that to the user as "that package is formulated by Viva AG".

### Nothing creates a plan on a timer (removed 2026-08-28)

The dispatcher's nutrition top-up scan is **gone**, along with the worker's `nutrition.topup` route,
`handleNutritionTopupEvent`, and `_commitNutritionPlan` (whose only caller it was).

It ran every minute with no plan requirement — a LEFT JOIN over `users` counting *schedules* — so
it did not top anything up: it manufactured an `active` plan, via an LLM call, for anyone who did
not have one, including every user who had never ordered a box. Dev had accumulated 1,133 plans
across 676 users with **zero boxes ever produced**.

**A plan now means "this person physically has these capsules."** Exactly two things may create
one, and both require a scanned box:

| | |
|---|---|
| `_activateProposedPlan` | a chat-tool proposal, activated by `handlePostBoxClaim` |
| `_commitAgFormulation`  | a Viva AG formula, same scan |

Do not reintroduce a timer that creates a plan. If a genuine top-up need appears, it must **extend
a plan the user is already on** and must never match a user who has none.

**`handleGetNutritionPlan` has a second, non-obvious source.** Its `plan` field is the content of
the user's most recent `nutrition_plan` **notification**, not the `nutrition_plans` table — a
legacy prose fallback. Clearing the table alone leaves the Plans tab showing stale text; the
notification rows are what actually populate it.

Which is why a Formulate-Dots proposal delivers as **`formulation_proposal`**, never
`nutrition_plan`. Delivering it under the latter made the tab report `hasPlan: true` off the card's
own text even though the plan row was correctly `'proposed'` and invisible to the structured query
— the proposal repopulating the tab it exists to stay out of. Found in the simulator; the DB and
the API each looked correct on their own.

## 28c. The 营养定制 Tool Sells a Tiered Package (2026-08-30)

The formula card's `#order|buy` CTA opens **原粒 · 定制营养素 · 28天** — a buy-first package with
three tiers — instead of the per-dot `定制原粒方案` it opened before. GCN `migration_0085`.

```
chat card  #order|buy  → GCN package picker → pay → order parks 'awaiting_formulation'
GCN → nano  /formulation-purchase-confirmed  → 'formulation_order_paid' chat message
user runs 营养定制 again → card is now #order|submit → confirm → fast track (§28b)
```

Nothing here is a new order shape. §28b's fast-track SKU flags already expressed a flat-priced,
no-expert-review, buy-first package; this product just *is* one, at a real price, with a tier.

### The tier is a WEEKLY width, and that is why a recipe has weeks at all

`skus.metadata.max_distinct_dots` (6 / 8 / 10 种原粒) is the only difference between the three
prices, so honouring it is not optional. GCN **reports** it on the waiting order
(`handleNanoFormulationOrderStatus`) and enforces nothing: the rule needs the dots formulary and a
product judgement about what a tier counts, and neither belongs on the far side of the wire.

**It caps one week, not the cycle.** A 6种 buyer may take six dots this week and a partly different
six next week; what they bought is the width of any single week. So a 28-day formula can genuinely
use more than six dots — it just may never run more than six at once.

That is the whole reason `_expandPlanDay` is week-aware. A recipe may carry an **optional** `weeks`
map alongside its `dots` counts:

```js
{ dots: { 'DOT-N3': 7 }, weeks: { 'DOT-N3': [1, 2] } }   // taken in weeks 1-2 only
```

**A key that names no weeks is in every week**, which is what makes this backward compatible in
both directions with no migration and no shape check: a proposal stored before weeks existed, a
completion from a stale cached prompt, and the deterministic fallback formulator all expand to
`PLAN_WEEKS` identical weeks — exactly the old behaviour. `_planExpansionContext` therefore
budget-fits **once per week**, because a week running five of a formula's twelve dots has capsule
room the others do not.

**The model owns the rotation, not the server.** Whether a dot can be paused for a week is a
clinical judgement — continuous sleep support and a seasonal accent are not interchangeable — so
the prompt asks for a per-dot `weeks` field and says continuous dots stay in all four. The server
only enforces the width.

**`_capDistinctDots` runs ONCE, on the recipe, before it is stored**, and removes a dot **from an
over-full week** rather than from the formula: a dot cut from week 3 keeps weeks 1-2, and only a
dot left with no weeks disappears. Everything downstream expands `proposed_recipe` through
`_expandPlanDay` — the card, the box scan writing 56 capsules, the fast-track submission — so they
cannot disagree. Apply it inside the expansion instead and the box scan, which knows nothing about
the order, would expand a different recipe than the card the user was shown.

**`DOT-N7` is not counted.** It is the system reset dot, dosed alone on 2 of the 28 days in every
plan regardless of tier (`_planExpansionContext` lifts it out of the everyday recipe entirely), so
counting it would silently cost a 6种 buyer one of the six dots they paid for. A product judgement,
and the reason the tier is described to the user as the width of their weekly formula rather than
as the number of labels on the box. `_countDistinctDots` is the one definition of that count — the
**widest week**, never the cycle's distinct total.

Ranking reuses **`_emphasisPosition`**, now shared with `_fitRecipeToDailyBudget`'s stage 3 — a dot
dropped for capsule space and a dot dropped for the tier are the same judgement about the same
recipe.

`handlePostFormulationSubmit` **refuses** a plan over the tier rather than trimming it — a plan
proposed before the package was bought was capped by nothing, and re-running 营养定制 produces a
better formula than that one minus a dot. Same reject-never-repair rule as §36.

**Open, and now user-visible if a rotation ever ships:** `_getCommittedPlanDay0Breakdown` reads day
0, which under rotation is week 1 rather than the cycle. Its two callers both want the cycle-wide
union — GCN's per-dot checkout snapshot (changing it changes what a customer is charged) and the
printed box label (which would under-list a box that physically holds all four weeks). Give them
one when someone owns the pricing question; do not quietly redefine day 0.

### Buying a package attaches the formulation the buyer was looking at

The chat card's order CTA is tapped while a specific proposal is on screen, so GCN carries its id
into the order as **`order_item_custom_formulations.intended_nano_plan_id`** (`migration_0086`) and
payment confirmation asks nano to attach it. Without this the buyer taps "order this formulation"
and gets an order referencing no formulation at all — which is exactly how this was first reported.

**Advisory, and a separate column on purpose.** `nano_nutrition_plan_id` is the audit record of what
will be compounded and is what `formulation_reviews` resolves against; the intent may never be
compounded. Collapsing them would make an unpaid, unvalidated intention indistinguishable from a
committed formula.

`_settleFastTrackPackage` (`handlers/users.js`) runs the attempt, and it is **only ever an attempt**:
`handlePostFormulationSubmit` re-checks ownership, `'proposed'` status, that an order is waiting,
the weekly width, and the validator. Every refusal falls through to the nudge — the behaviour this
flow had before an id was carried — so nothing can leave a buyer worse off. The one refusal with its
own message is an over-tier plan, because a generic "go formulate it" would have them regenerate the
same too-wide formula and fail the same way.

**GCN's `dashboard.html` is what routes the miniapp's `buy_custom_formulation` intent**, so a
production miniapp reaches whatever checkout the web function was last deployed with. That is how a
card still reading 按此方案定制下单 ended up opening a package picker. When changing where that
intent lands, the miniapp card copy has to ship with it or it will promise the wrong thing.

### 查看配方 is not 我的激活码

`openOrderCodes` serves three item kinds and its heading was hardcoded to the activation-code one,
so a buyer tapping 查看配方 was told they were looking at activation codes. It now titles itself
from its contents.

A buy-first package is paid **before** anything is formulated, so that modal routinely has no
recipe. It used to render an empty shell with `配方主打方向: —`; it now drops the focus line when
there is no focus and says whose move it is. That answer is per-product, which is why
`is_ag_formulation_bundle` / `requires_expert_review` ride on the order item — at
`awaiting_formulation` a fast-track package waits on the buyer running 营养定制, a premium one waits
on Viva AG. `order.status` cannot tell them apart, and getting it backwards either strands the order
or sends someone somewhere that cannot fulfil it.

### A paid package says so in chat

An order at `awaiting_formulation` is waiting on something only this app can produce, and the store
never said so. `/formulation-purchase-confirmed` now carries the package, and delivers a
`formulation_order_paid` message (**in `AI_ECHO_TYPES`** — it writes both channels). An
expert-review package sends none: Viva AG owns that one and the user has nothing to do.

`handlers/users.js` requires `./chat` **at call time**. Not a cycle — nothing in the chat graph
requires users.js — just keeping a cold path off every warm container's module load.

### No sku id in the client, ever again

The picker reads `GET /api/mall/aeviva/formulation-packages`. A tier added, repriced or retired in
the admin panel takes effect with no web deploy, and a stale client-side formulation sku constant
is exactly what broke both checkouts in the sandbox on 2026-08-22. An empty response falls back to
the per-dot product rather than dead-ending a CTA the user already tapped.

Seller and fulfiller stay separate without the client knowing either: the order carries the
**buyer's own bound store** as `store_partner_id`, and `handleAgFormulationBundleOrderCreate`
stamps the processing centre onto the order *item*.

**Resolved 2026-09-01 (GCN `migration_0089`).** That handler used to hardcode
`PROCESSING_CENTER_PARTNER_ID` (`…a3`) while the AI 精准营养素 product sat on `42f7307f`, so the
28天 packages, `AI精准营养素` and every redeem-code order were all addressed to a compounding centre
that does not make them, while the per-dot product independently used its own *seller*. GCN now
carries `products.processing_center_partner_id` and both order paths resolve
`COALESCE(processing_center_partner_id, supplier_partner_id)` — see GCN's `CLAUDE.md`
§"Selling a product and compounding it are different partners". Nothing in nano changed.

Still open: neither processing centre has a `payment_qr_urls`. Not on this path (the customer pays
the store, and a redeemed code charges nothing), so it only bites if a processing centre is ever
made a *seller*.

## 28d. The Dots Subtab Is Order-Aware (2026-09-01)

Plans ▸ Dots lists **one row per dots package**, merged from two systems that each know only half
of a journey: GCN owns the order (`pending_payment → paid → awaiting_formulation → expert_review →
compounding → shipped`) and nano owns the formula (`proposed → approved → active`). Before this,
nano's entire record that an order existed was `users.custom_formulation_purchased_at` — one
timestamp, no id, no status — so the only way to learn where your capsules were was the GCN store
webview.

### Nothing is mirrored, and that is the point

The order half is read live through `fetchFormulationOrders` (`lib/gcnClient.js`) on every request
and **never written to a nano table**. A cached status has nothing to reconcile itself against: an
order can be refunded, cancelled, or filled from another device between two reads. Same reasoning
that already governs why "is a package waiting" is pulled rather than stamped on the user row.
**No migration, either repo** — every field already existed.

`_fetchFormulationPackages` is awaited inside `handleGetNutritionPlan`'s existing `Promise.all`, so
a slow GCN costs `max(db, gcn)` rather than the sum, and it degrades to `[]` on any failure. The
Dots subtab must still render the user's active plan when the order half is unavailable.

> **`packages` is a SIBLING of `plan` / `structured_plan` / `schedules`, never a source for them.**
> Those keep meaning "the plan you are physically on" and stay `status='active'`-only. §28b records
> the live bug where a proposal repopulated this tab and made it report a plan the user did not
> have.

### The stage is derived from both halves, and is neither system's status column

`PACKAGE_STAGES` (12 values) is the vocabulary; the miniapp keys its copy off the string
(`t['pkgStage_' + stage]`), so **a new stage needs a line in both `T.zh` and `T.en`** — WXML has no
compile-time key checking and a missing key renders empty.

- `awaiting_formulation` vs `awaiting_ag` are **one GCN status split by which package was bought**.
  A fast-track package waits on the buyer; a premium one is Viva AG's to fulfil and asks nothing of
  them. Offering a submit CTA on the latter sends someone somewhere that cannot fulfil their order.
- An **active plan outranks the order** — the user scanned the box, which is a truer statement than
  an order still sitting at `shipped` because nobody closed it out on the commerce side.
- `completed` becomes `delivered`, not "done": for a physical box the journey ends at the scan, and
  that scan is a nano-side event GCN never hears about.
- `day_index` is null for anything but `active`. A proposal's `start_date` is a placeholder and an
  approved plan's is provisional until the box is scanned, so counting from either would claim the
  user is taking capsules that do not exist.

### Offered, not matched

A waiting package carries **`submit_plan_id`** — the user's single un-submitted proposal
(`uniq_nutrition_plans_proposed`) — which is deliberately *not* `plan_id`. Buying writes no plan and
formulating writes no order; the two are bound only by `handlePostFormulationSubmit`. The
standalone proposal row is suppressed once offered, because the same formula listed twice (once to
buy, once to fill) reads as two formulas.

**`intended_nano_plan_id` is never a link.** It is advisory — what the buyer was looking at, possibly
a formula since superseded (GCN's `migration_0086`) — and joining on it would report a package as
carrying a recipe nothing is going to make.

**A proposal is also suppressed while an order is waiting for a recipe** (`AWAITING_FORMULA_STAGES`
= `pending_payment` / `paid` / `awaiting_formulation` / `awaiting_ag`, with no plan attached). The
plan is not attached until payment confirms, so at `pending_payment` one journey is genuinely two
rows — and the standalone one was still offering 按此配方下单 for a package already ordered.

The stage is what this keys on, **not `intended_nano_plan_id`**, per the rule directly above: at
most one un-submitted proposal exists per user, so "an order is waiting" already identifies it
without trusting an advisory link. Keep the set narrow — a package at `compounding` or `shipped`
already has its formula, so a proposal made afterwards is a real next-cycle formula and must stay
orderable; `cancelled`/`refunded` release it. Only `'proposed'` rows are suppressed, never an
`active` plan.

### Selecting which package a formula fills

Both halves of the handoff were hardcoded `ORDER BY o.created_at ASC LIMIT 1`, so "oldest wins" was
silently deciding. **Two waiting packages is reachable**: GCN's `formulation_already_in_progress`
guard runs at order *creation*, so two checkouts started while both were `pending_payment` can both
be confirmed.

`_attachRecipeToAwaitingOrder` (GCN) now takes an optional `orderId`. **Ownership stays enforced by
the `ocf.nano_user_id` predicate**, not by the caller having supplied a plausible id — keep it that
way; it is the only thing between a client-chosen id and another buyer's order.

- **Chat card** — `handleFormulaSubmit` resolves the list at **tap** time via
  `GET /api/formulation-orders`, not from the card. The turn is async, so a card can be minutes old.
  One waiting package behaves exactly as before; several open an action sheet.
- **Dots subtab** — tapping a package row *is* the choice; the row already names its order.
- Both go through one `_submitFormulation`, so the two surfaces cannot drift on what a reason code
  means.

**`_awaitingOrders` re-sorts oldest-first.** GCN returns newest-first for display but attaches
oldest-first, so anything that must agree with what GCN will actually do has to re-sort. Not doing
this is how a picker and a submission end up naming two different packages.

### GCN side

New `GET /api/mall/nano/formulation-orders` (`requireNanoService`, always 200, `{orders: []}` on any
failure). It shares `FORMULATION_ORDER_FROM` with the older single-row status probe — a row visible
to one and not the other would show a package the submit path cannot find. It returns **no buyer
identity and no money**: the response travels back out to a Mini Program, and what someone paid is
the store's to show.

`handleNanoFormulationOrderStatus` is kept but **has no caller** — nano and GCN deploy separately,
and leaving it means neither deploy order breaks the chat card. **Deploy GCN first.** Retire it once
nano prod is confirmed on the new endpoint.

### The order card leads with the tool, not the store (2026-09-01)

The Dots subtab has **one** order card and it only ever runs 营养定制 in the chat tab
(`handleGoFormulate`), gated on `!hasProposedFormula` — derived from `packages`, not from
`hasPlan`.

Buying without a formula is a real flow (§28c) but a worse one: the order parks at
`awaiting_formulation` and hands the buyer back the same job one screen later. And once a formula
*does* exist, the package row above already carries 按此配方下单, which passes the plan id so GCN
prices that exact recipe. A second card next to it opening `buy_custom_formulation` with no plan
id is a strictly worse route to the same product — which is why the old `handleOrderDots` and its
`orderDots*` strings were **removed**, not kept as a fallback. Don't reintroduce a store link
here; the package row is the buy path.

**The Neo dispenser entry point is off behind `neoAvailable: false`.** The hardware is not
shipping, so the bind card offered something nobody could act on. Gated rather than deleted:
nothing about the dispenser changed, and this is its only entry point. `neoBound` is still
permanently false and still gates the cartridge grid, the Dispense button and the order card's own
`!neoBound` — don't collapse the two flags into one.

## 28e. A Dots Package Is Bought With a Redeem Code (2026-09-01)

The direct checkout is retired. A store buys codes wholesale, resells them, and the holder redeems
one for the 28-day package it stands for — **with no payment step at redemption**.

Direct checkout was the wrong shape for how these are sold: the buyer is an end user, but the money
is owed to the **root supplier** that compounds the capsules while the order is attributed to the
buyer's bound store. That split is where the self-approved payment, the payee override and the
per-order 确认收款 all came from. Making it a wholesale order was rejected on GCN's side, because
`wholesale_transfer_out` would book stock of capsules compounded from one person's biomarkers. A
code has none of those problems — it is fungible, non-perishable and transferable, so stocking codes
is a genuine 补货订单 and the money moves once, in bulk.

**The mechanics live in GCN** (`migration_0088`, `handleFormulationCodeRedeem`, `skus.redeems_for_sku_id`,
`skus.wholesale_only`, `sku_activation_codes.holder_partner_id`). See its `CLAUDE.md`
§"Custom Dots sold as prepaid redeem codes" before changing anything about the flow.

### Why nano barely changed, and must not grow its own code table

Every "is a package waiting for me?" answer here comes from **one** source, `fetchFormulationOrders`
(`lib/gcnClient.js`), read live at three call sites:

| Call site | Breaks without a real GCN order |
|---|---|
| `_resolveOrderContext` (`handlers/dots.js`) | the chat card's `#order` mode never becomes `submit` |
| `handlePostFormulationSubmit` | refuses `no_awaiting_order` — the formula can never be submitted |
| `_fetchFormulationPackages` | no package row, so no stage, no tracking, no scan CTA |

Redemption produces a real `orders` row exactly as a purchase did, so **none of those changed**. A
nano-local `formulation_codes` table (mirroring `viva_subscription_codes`) would mean merging a
second source into all three *and* would still leave the capsules with no order to be compounded and
shipped against. `viva_subscription_codes` stays where it belongs: a subscription is a pure
entitlement with nothing to ship, so a nano-local code is right there and wrong here.

### What did change

`handleFormulaOrder` sends `intent: 'redeem_formulation_code'` through the existing
`webview_tokens.context` bridge, and `t.formulaOrderCta` / `t.pkgOrderBtn` name a code rather than a
purchase. The plan id is still carried, and is **advisory only** — a code is not priced against a
recipe; nano attaches whatever formula the user has when they submit it. It is still sent because
the GCN page deploys independently of this miniapp and older builds of it read one.

GCN routes the old `buy_custom_formulation` intent to the same redeem screen, so a miniapp build
already in the wild keeps working. **Deploy GCN's `mall` and `web` together** — the redeem route and
the redeem screen are two halves of one flow.

**Verified end to end on dev** (2026-09-01), including the two halves nano owns: the 使用兑换码 CTA
carries `redeem_formulation_code` plus the plan id through the webview token, and a code-created
order is indistinguishable downstream — `_resolveOrderContext` reads `max_distinct_dots: 8` off it,
`handlePostFormulationSubmit` correctly refuses a 17-dot proposal made before any package existed,
and a re-run of 营养定制 caps to 8 (+`DOT-N7`, which is never counted) and submits to `compounding`.

The order card in Plans ▸ Dots is unchanged and still runs 营养定制: formulate first, then redeem.
Where a code comes from is answered on the redeem screen ("your store provides this code"), which is
the only surface that can say it truthfully.

## 28f. 营养定制 Proposes Three Nested Formulas (2026-09-07)

With **nothing waiting**, the chat tool now proposes the essential **6-dot** formula and shows what
a further **+2** and **+2** would add — the three purchasable widths (§28c). With a package already
waiting the card is unchanged: that tier is settled, and a second CTA beside the one the user must
tap risks stalling the order they already paid for.

Before this the tier was invisible at the one moment it was being chosen. The tool formulated
against no ceiling, so a proposal was routinely wider than any package sold — prod's `c40d46a4`
held a 17-dot one — and unpurchasable the moment a code was spent on it.

### `proposed_recipe` gained an optional `tiers`, and the base is the NARROWEST

```json
{ "morning": {…}, "evening": {…},
  "tiers": [ {"max_distinct_dots": 6, "morning": {…}, "evening": {…}}, {"…": 8}, {"…": 10} ] }
```

**`morning`/`evening` are the narrowest variant.** That is what lets every reader that predates the
key — `_activateProposedPlan`, `handleGetFormulationCheckoutSnapshot`,
`_getCommittedPlanDay0Breakdown` (the printed label), `_packageRow.distinct_dots` — keep working
untouched while seeing a recipe that fits any tier. No migration; the column already existed.

`handlePostFormulationSubmit` picks the widest variant the redeemed code covers
(`_selectTierVariant`) and, in the same write that binds `gcn_order_id`, **collapses the row** to
that variant and drops `tiers`. After submission the plan is single-recipe again, so the box scan,
the label and the snapshot all read what is actually being compounded. §28c's over-tier refusal is
untouched and still fires — for a plan with no `tiers`, which was capped by nothing.

### A width is PER WEEK, and every variant carries its own rotation

§28c's rule is untouched here: a 6种 formula may run six dots this week and a partly different six
next week, so its four weeks together can contain well more than six distinct dots. Each variant is
therefore built by **`_capDistinctDots`** — the same cap that already binds a purchased package —
which caps each week independently and returns that variant's own `weeks` map. A width means
exactly the same thing on the card as it does at submission, and `_countDistinctDots` (the widest
week) is what both compare against.

**Nesting follows from that**, not from a separate mechanism: `_capDistinctDots` ranks the same
full allocation on every call and keeps the top `width` of each week, and a week's top 6 are always
inside its top 8. Do not re-rank per variant — ranking each variant's own set independently can
drop from the wide variant a dot the narrow one kept, i.e. an upgrade that takes something away.

The tier tag rides into that ranking (`_capDistinctDots`'s optional `tierByKey`): tag first, then
emphasis, with untagged dots sorting as the most optional. So a mis-tagged tier needs no
correcting, and a completion with no tags at all still ladders.

**A rung's additions are computed week by week** (`_ladderAdditions`), because under rotation an
upgrade can be two more dots every week *or* the same dot running two more weeks — a cycle-wide set
comparison sees only the first. Each rung row carries the weeks it adds when they aren't all four.

`_applyTierLadder` is the single fork — ladder when `orderContext.mode === 'buy'`, else the existing
`_capDistinctDots` trim — shared by the agentic delivery and the deterministic fallback. **The
fallback must ladder too**; a proposal with no `tiers` and no cap is one a wider code cannot be
spent on.

### Two things live testing forced, both non-obvious

**The upgrade slots are server-filled.** GENERATE doses the whole formulary when asked in isolation
but *curates* inside the agentic loop — live dev runs returned six dots where a single-shot
completion of the same prompt gave seventeen. Six is the narrowest tier, so the wider variants
collapse as duplicates and no ladder appears at all. `_padCandidatesFor` offers dots targeting the
user's own elevated dimensions first, dosed by `_fallbackCountForDot`. It **never reaches the
core**: padding runs only once the model has filled the narrowest tier itself, and a padded dot is
untagged so it sorts behind everything the model chose.

**A pitch that names a dot outside its own rung is dropped** (`_rungPitch`). The model writes the
copy but the server decides membership, and the first real run had them disagree — a pitch reading
"加配肠道焕新与脉络畅流" above a rung holding two different dots, and another naming a dot the
formulation did not contain. The prompt now asks for copy that names no dots (the card lists them
on the next line); this is the backstop, and it drops rather than repairs.

**JUDGE and PLAN both had to be told the narrowness is intended.** JUDGE rejected a deliberately
6-dot core as `plan_drift` — "must reflect the full set of clinically indicated dots" — and the
forced REVISE stripped the upgrade copy. A dot missing from a formulation is never an omission:
the number of dots is a product constraint the model does not get to widen.

### The widths come from GCN, and no rung is a CTA

`GET /api/mall/nano/formulation-packages` (`requireNanoService`, always 200): fast-track tiers only
— a premium package is Viva AG's to formulate, so offering it advertises an upgrade this tool
cannot fulfil — and **no price**, because nano does not price this product and there is no payment
at redemption. It travels in `llmContext.formulation_tiers` rather than being re-fetched at
delivery: the variants must be built against the widths the model was told to aim at.

The card carries `#rung|<label>|<width>|<pitch>` blocks after the day groups, rows in the same
`key|name|color|am|pm` shape plus an optional 6th field — the weeks that dot is added in, absent
when it runs all four. **One CTA, at the bottom, for all of them**: which tier a user gets is
decided by whichever redeem code they hold, and a code cannot be bought in-app (§28e), so a
per-rung button would offer a choice that does not exist.

### The guardrail was narrowed, in three places

Aspirational upgrade copy collides with the always-injected essential block, which reads every
claim as a clinical one. The new clause is a **permission plus a restatement of the hard bans** —
no onset window, improvement magnitude, numeric forecast, guarantee, invented mechanism, or price;
dot names still verbatim — scoped by name to the `"upgrades"` field alone.

Per §37's precedent it lives in `knowledge_entries` (`migration_knowledge_upgrade_copy.sql`),
`lib/knowledgeBase.js`'s `FALLBACK_ESSENTIAL_BLOCK`, and `prompts/chat/factConstraint.js` —
**change all three together**, or a transient DB error silently returns the model to refusing to
write a rung at all. `planTemplate.js` and `judgeTemplate.js` were taught the tail for the reason
§27 and §37 both record: an unrecognised action tail is graded as an unsupported claim and burns
REVISE rounds.

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
| 3 | `医疗记录` | `Medical Records` | `health_reports`; `health_events(category='lab_result')`; `health_documents`; `health_twin.latest_lab_data / latest_lab_date` |
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

## 35. Viva AG — External Deep-Analysis Agent (2026-08-23)

**Viva AG (Advanced Generation)** is an *external* agent that spends minutes-to-hours analyzing a
user's full digital twin, including uploaded hospital-record PDFs. Nano owns a job queue; the
agent **pulls** from it, reads a twin bundle, and posts a result back, which lands in the user's
chat. Nothing in §21-§29 applies here — that machinery is for work nano performs itself.

### Entitlement: an add-on column, not a third persona

`users.viva_ag_expires_at` (migration `migration_users_viva_ag_expiry.sql`), gated by
`hasActiveVivaAgAccess()` in `lib/persona.js`. **The regular chatbox stays powered by Viva; AG is
only active inside the health tab's AG subtab.** Deliberately not a `persona_override_type` value
— `resolveEffectivePersona()` must keep returning `'nano'|'viva'` only, or every prompt-routing
site, `chat_messages.persona_type` and the dispatcher's inlined SQL copy would need a third branch
they have no prompts for.

Every server-side gate goes through `requireVivaAgAccess()` (`lib/vivaAgAccess.js`), which is a
**composite**: effective persona is `viva` **and** `hasActiveVivaAccess()` **and**
`hasActiveVivaAgAccess()`. Conditions 1-2 mirror `handlePostChat`'s paywall exactly, so AG can
never be more permissive than the chatbox. Grants/revokes are admin-only for v1
(`handlePostAdminUserVivaAg` / `handleDeleteAdminUserVivaAg` in `handlers/persona_subscriptions.js`,
routed at `/admin/users/{uid}/viva-ag-subscription`) and audit into the existing
`persona_subscription_grants` with `persona_type='viva_ag'`. The one-migration path to redeem
codes / GCN checkout is written into the migration comment.

### No EventBridge, no cron — and why

§22's CloudEvent machinery exists for exactly one reason: FC cancels an invocation the moment the
HTTP client disconnects, so nano-side work taking minutes must leave the request cycle. **Viva AG
has no nano-side long work** — enqueue is one INSERT, the long work is entirely inside the external
agent, and delivery is two INSERTs inside the agent's own `POST /result` request. Publishing a
CloudEvent would add shared dev/prod bus leak risk and a dedupe table for zero benefit.

Lease expiry is swept **lazily** at the top of the claim handler and the user's job list
(`_sweepExpiredLeases()`). Residual limitation, accepted: if the agent stops polling *and* no user
opens the AG subtab, an expired lease sits until someone touches the queue. The fix, if it ever
bites, is a fourth scan in `dispatcher/index.js`'s existing tick — not new infrastructure.

### The fencing token is the whole concurrency story

`viva_ag_jobs.result_token` is regenerated on **every** claim. It is simultaneously the
result-submission credential and the idempotency key: a worker whose lease expired and was
re-claimed holds a stale token and is rejected, so two workers can never both write a result and
no separate idempotency key exists. The claim itself is a single
`UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1)` — **do not** rewrite it as a
SELECT followed by an UPDATE; SKIP LOCKED is what gives two concurrent pollers two different jobs.
`uniq_viva_ag_jobs_active` caps one in-flight job per user at the DB level, plus a 3/day cap in the
enqueue handler.

### External API — `VIVA_AG_API_TOKEN`

Same shape as the GCN credential (§19): a scoped token branch in `worker/index.js` with a local
`VIVA_AG_ALLOWED_PATHS` Set, 403 on anything else. Three constraints, all load-bearing:

1. **It must precede the `ch.` branch** — that one matches on prefix and would swallow a token
   starting `ch.`. Issue tokens as `vag_` + 32 hex.
2. **Exact match only, no path params** — every parameter travels in the query string or body.
3. **Distinct tokens per environment** (`VIVA_AG_API_TOKEN` / `VIVA_AG_API_TOKEN_PROD`), or a
   dev-configured agent could claim and answer real prod users' jobs.

The per-job fencing token rides in an `X-Viva-Ag-Job-Token` header on GET and in the body on POST
— never a query param, because query strings land in FC/SLS access logs and it gates a medical
record. **No `/viva-ag/*` response ever returns a `user_id`, openid or nickname**: `job_uid` is
the only handle, and there is deliberately no "fetch the twin for an arbitrary openid" endpoint,
so a leaked token can drain the queue but cannot enumerate users.

**The API documents itself**: `GET /viva-ag/docs` (Markdown) and `GET /viva-ag/openapi.json`,
read at module load from `src/functions/worker/docs/viva-ag-api.md` / `viva-ag-openapi.json`.
`s.yaml`'s worker uses `code: ./src/functions/worker`, so those files deploy with the function and
cannot drift from the code. **Keep them in step with any endpoint change** — the spec's paths and
`VIVA_AG_ALLOWED_PATHS` should agree in both directions.

### Large files never pass through Function Compute

The response envelope base64-encodes binary bodies, so proxying a large PDF would inflate it ~33%,
buffer it entirely in the 512 MB worker, and hit FC's response ceiling. Every download is a
**direct-from-OSS presigned GET**; nano only hands out a signature. This also makes HTTP `Range`
(chunked and resumable transfer) work for free, and means download size is effectively unbounded
— the 20 MB cap is a miniapp *upload* constraint (`readFile` loads into the JS heap), not a
download one.

**This bucket refuses a `response-content-type` override** — `400 InvalidRequest`, "Can not
override response header on content-type" (confirmed live; the signed URL fails outright, it does
not degrade). Content-Type is therefore fixed at **upload** time: `generatePresignedPutUrl` takes
an optional real content type, and callers must PUT with exactly the `put_content_type` the
presign returned or OSS returns `SignatureDoesNotMatch`. `generatePresignedGetUrl` gained an
optional `filename` that sets an RFC 5987 `Content-Disposition` (these filenames are routinely
Chinese) — but **no** content-type override; don't re-add one.

### Report files: `pdf` / `md` / `txt` only, and markdown renders in-app

A job carries up to 5 artifacts in `viva_ag_jobs.result_files` (migration
`migration_viva_ag_result_files.sql`) — typically a rendered PDF plus its `.md` source.
`result_oss_key` is **kept and still written** (the first file, PDF preferred) so legacy rows and
the single-file shape keep working; `result_files` is the source of truth.

The allowed set is narrow because the miniapp is the only consumer and has exactly two ways to
present a file — and **`wx.openDocument` cannot open markdown** (its `fileType` list is
`doc/docx/xls/xlsx/ppt/pptx/pdf`), so an `.md` handed to it fails in the user's hands. Hence
`md`/`txt` are downloaded and rendered **in-app**, and `/viva-ag/result-upload-url` rejects
anything else with `unsupported_file_type` *before* the agent spends the upload.

At submission every key is prefix-confined to `viva-ag-results/{job_uid}/`, type-checked, and
`headObject`-verified (a key minted but never PUT would become a download button that fails);
any failure refuses the whole submission so nothing half-committed is delivered. The client
addresses files by **index** — `oss_key` never leaves the server.

**Rendering the `.md` is a trust boundary.** `mdToHtml()` (new export in `utils/markdown.js`)
deliberately does not interpret `:::` display-card directives the way `mdToSegments()` does — same
reason summaries are stripped of them. And `_neutralizeLinks()` rewrites `[text](href)` to plain
text, because mp-html's `linkTap` calls `wx.navigateTo` for any scheme-less href, which would let
an external report push the user into an arbitrary page of this miniapp.

### `dots_formulation` (原粒定制) is a contract, and the contract lives in the API doc

The fourth preset asks the external agent for a **28-day / 56-capsule Dots formula** as an `.md`
file in a fixed, machine-readable format — §8 of `worker/docs/viva-ag-api.md`. Every rule in it is
mirrored from `handlers/dots.js` (`PLAN_DAYS = 28`, `MAX_DOTS_PER_CAPSULE = 72`, per-dot
`target_dots_min`/`max` applied to the **daily** total, pulse windows, and `DOT-N7` isolation on
`N7_ISOLATION_DAY_INDEXES = [9, 10]` where both capsules are `DOT-N7` alone). **Change any of those
constants and you must change that doc**, or the agent builds against rules nano no longer uses.

**Superseded 2026-08-25 by §36.** Nano originally did **not** parse or validate this file, and the
formula was an artifact that never touched `nutrition_plans`. Both are now false: `lib/agFormulation.js`
validates every rule above on submission and rejects a non-conforming formula outright, and an
expert-approved formula becomes a real plan. The constants-coupling warning in the paragraph above
still stands, and now binds a third consumer — see §36.

### `health_documents`, not `health_reports`

`health_reports` means "a parsed lab report": mandatory `report_date`, `raw_data` observations,
`health_events.report_id` children. A discharge PDF has none of those. `health_documents` is
**twin layer 3, Medical Records** (§34) and is declared as such in
`docs/architecture/digital-twin.md`.

Delete is a **soft** delete: a running job can hold a 6-hour URL and snapshots document ids in
`viva_ag_jobs.document_ids`, so hard-deleting either would break it mid-run. Cost is orphaned OSS
objects; a purge job is an open follow-up.

**Documents are never routed through `/oss/presign`.** That endpoint performs zero authorization
on `action=get&key=…` and will hand a signed URL for *any* OSS key to any caller holding the app
token — a live pre-existing hole this feature must not widen. Instead: keys are minted server-side
under `health-documents/<user_id>/`, registration rejects any key outside the caller's own prefix,
`oss_key` is never returned to the client (documents are referenced by id), and user-facing URLs
expire in 300s.

**The endpoints are no longer AG-gated (2026-09-08).** They are twin data, so any logged-in user
can build an archive — see §38. Be clear-eyed about what changed: the AG check was an
*entitlement* gate, never an access-control one, and it never stopped one AG user from passing
another user's openid. The four protections in the paragraph above are the ones that actually
guard the object, and they are untouched.

### Result delivery

`deliverTerminalMessage` (exported from `handlers/chat.js`) writes **both** `chat_messages` and a
`notifications` row — the two-channel model §22 requires. Saved under `persona_type = 'viva'`,
**never** `'viva_ag'`: chat history is persona-scoped, so a bubble under a persona the chat tab
never queries would flash once and vanish on reload (§25's "second real bug"). `saveChatMessage`
and `_deliverTerminalMessage` now return their inserted ids for correlation; every pre-existing
caller ignores the return.

AG replies are attributed to **"Viva AG"** in the chat via `chat_messages.source = 'viva_ag'`
(migration `migration_chat_messages_source.sql`), rendered as a label above the bubble like the
existing `Coach` one. It has to be its own column: `persona_type` would make the row invisible to
the persona-scoped history query (§25's bug again), and `notification_type` is not durable because
notifications are read destructively. `handleGetChatHistory`'s three queries all select `source` —
missing one makes the label vanish on that load path only.

`'viva_ag_result'` and `'viva_ag_failed'` **must stay in `AI_ECHO_TYPES`** (`pages/main/main.js`)
— both write to `chat_messages` and `notifications`, and a type missing from that Set renders the
bubble twice.

`result_summary` is **sanitized on ingest**: `:::` display-card fences are stripped, because that
syntax is interpreted by the miniapp renderer and an external system emitting it could render
arbitrary UI in the user's chat. Never feed `viva_ag_jobs.result` into a later LLM prompt without
treating it as untrusted content.

### `lib/twinBundle.js` is AG-only, on purpose

Its fetchers duplicate SQL that also lives in `lib/agenticTools.js` and the four `llmContext`
builders. Adopting them there is the natural next pass and would be a real improvement — but those
builders construct the contract 20+ prompt templates, JUDGE grounding and `extractToolGroundTruth`
consume, and §21/§27 record user-visible regressions from touching exactly that. The duplication
is a decision, not an oversight.

Conventions the module carries over and must keep: fetchers never throw (a dead source degrades
that section to `null`/`[]` rather than failing the bundle), biomarkers always from
`data.validated` (§17), every timestamp through `formatToShanghai()`, and **`DATE` columns cast
`::text` in SQL** — node-postgres parses a DATE at local midnight, which serializes to a UTC
instant, so `scheduled_date` for 2026-08-16 shipped as `"2026-08-15T16:00:00.000Z"`, the wrong day
to any consumer.

### Miniapp

The subtab strip lives **inside** `components/user-health/` (three small WXML edits plus
component-local `.uh-tab-*` classes — component style isolation means the page's `.inner-tab-*`
rules are unreachable). The panel body is its own component, `components/viva-ag-panel/`, which is
what keeps an already-1000-line template from absorbing another feature. Self view only; the coach
app never passes `viva-ag-enabled`, so it defaults false.

Upload offers two sources via an action sheet, because they have different prerequisites:

- **`wx.chooseMessageFile`** is the only way to obtain a PDF in a Mini Program, and it reads from
  a WeChat *conversation*, not the device filesystem — the user must forward the file to
  文件传输助手 first, which the empty state has to say.
- **`wx.chooseMedia`** (photo of a paper record) uses the album/camera scope the chat tab's image
  upload already relies on, so it needs no additional declaration and works today.

**Platform prerequisite for the PDF path (2026-08-23):** `chooseMessageFile` requires the
「选中的文件」 scope to be declared in the miniapp's **用户隐私保护指引** in the MP console
(小程序后台 → 设置 → 服务内容声明). Without it WeChat rejects the call outright —
`chooseMessageFile:fail api scope is not declared in the privacy agreement`, errno 112 — and
**no runtime consent flow can rescue it**: `app.js`'s `onNeedPrivacyAuthorization` handler never
fires, because the failure is a missing *declaration*, not a missing *consent*. It is not a
`requiredPrivateInfos` entry either (that list only accepts location-family APIs plus
`chooseAddress`). The only fix is the console declaration.

`_choosePdf()` therefore distinguishes three outcomes, following `fetchWechatAddress`'s precedent
in `pages/main/main.js`: silent on cancel/deny, an explanatory modal pointing at the photo path
on a privacy/scope error, a generic toast otherwise. **Never re-add a bare `fail: () => {}`** —
that is what made the button look dead when this first shipped.

Neither picker can be driven by `miniprogram-automator` (both open native pickers), so automate
`_uploadDocument` directly with a file staged into `wx.env.USER_DATA_PATH` and do the real pick
manually once.

Job polling is a 15s timer inside the panel, running only while a job is in flight — deliberately
not hooked into `main.js`'s 3s notification poll, which is tuned for chat delivery.

### Clarifying questionnaires — the agent can ask the user (2026-08-27)

The agent can **park** a claimed job and push back a short questionnaire instead of guessing, then
resume once the user answers. New status **`awaiting_input`**; new endpoint
`POST /viva-ag/jobs/questionnaire`.

Almost nothing was built. Nano already had a server-defined questionnaire system — four tables,
five input widgets, a chat-tab renderer, a `questionnaire_ready` client trigger, and a precedent
for a runtime-generated form (`type='dynamic'`, Viva's own `ask_questions`). Crucially
`twinBundle.js` **already** merged completed answers into every bundle, so the return path existed
before the outbound one did. Only the asking, the parking and the resume trigger are new.

Things that are load-bearing:

- **`uniq_viva_ag_jobs_active` must include `awaiting_input`** — a parked job still owns the
  user's one in-flight slot. `viva_ag_jobs.status` has no CHECK constraint (the value set is a
  comment), so the migration's real work is that index. Verify the predicate on a live DB: a
  `DROP`/`CREATE` pair that no-ops fails silently.
- **The lease is released, not held.** No lease length covers a person answering a form, so any
  worker re-claims it fresh. Workers stay stateless — the answers travel in the bundle. After a
  successful park the caller has lost its lease and must stop working on the job.
- **The attempt is refunded.** Asking is progress, not a failed delivery. Rounds (2 per job) bound
  the loop, not `attempts`.
- **`lib/agQuestionnaire.js` is a security boundary, not a formatting check.**
  `questionnaire_questions` is a write path into user data — `save_target` writes
  `users.<save_field>`, merges `bio_data`, or **inserts a biomarkers row**, and `completion_check`
  makes a question auto-skip (so a form could self-complete and resume the job having asked
  nothing). Those four are **never sourced from the payload**; `createDynamicQuestionnaire` writes
  them `NULL`/`'{}'`. Same rule strips `config.other_key` and rejects an option keyed `other`.
  Treat any change that starts reading them from the agent as a regression.
- **`viva_ag_questionnaire` must stay in `AI_ECHO_TYPES`** (`pages/main/main.js`) — it writes both
  `chat_messages` and `notifications`, so a type missing from that Set renders the bubble twice.
  The paired `questionnaire_ready` row is what makes the chat tab fetch the form, and `main.js`
  already suppresses its own bubble for that type.
- **The resume hook is injected from `index.js`**, like `saveChatMessage`, so
  `handlers/questionnaires.js` never requires `handlers/viva_ag.js` — and it is **awaited**, per
  the comment already beside it (FC 3.0 freezes the context on return; an un-awaited promise there
  was confirmed live never to complete).
- The user answers in the **chat tab**, reusing the one renderer every questionnaire in the app
  uses. The panel only hands off (`gotochat` → `handleAgGoToChat`).

`bundle_version` is now **2**: additive `job_questionnaires` (job-scoped rounds + answers,
`answer: null` = asked-but-unanswered), distinct from `questionnaire_context`'s whole-user merge.
AG answers deliberately feed normal chat too.

### Files

New: `src/schemas/migration_viva_ag_questionnaire.sql`, `worker/lib/agQuestionnaire.js`.
Modified for this pass: `worker/handlers/{viva_ag,questionnaires}.js`, `worker/lib/twinBundle.js`,
`worker/index.js`, `worker/docs/viva-ag-{api.md,openapi.json}` (§7b),
`nano-miniapp/components/{viva-ag-panel,user-health}/*`, `nano-miniapp/pages/main/main.{js,wxml}`.

Originally (2026-08-23):
New: `src/schemas/migration_{users_viva_ag_expiry,health_documents,viva_ag_jobs,viva_ag_result_files}.sql`;
`worker/handlers/{viva_ag,viva_ag_docs,health_documents}.js`;
`worker/lib/{twinBundle,vivaAgAccess}.js`; `worker/docs/viva-ag-{api.md,openapi.json}`;
`nano-miniapp/components/viva-ag-panel/`. Modified: `worker/index.js` (token branch + routes),
`worker/lib/{persona,oss}.js`, `worker/handlers/{chat,viva_subscription,persona_subscriptions}.js`,
`s.yaml`/`s-prod.yaml`, `admin-panel/src/tabs/UsersTab.jsx`,
`nano-miniapp/components/user-health/*`, `nano-miniapp/pages/main/main.{js,wxml}`,
`nano-miniapp/utils/markdown.js` (`mdToHtml`), `utils/config.js` (VERSION).

Full detail: [docs/architecture/viva-ag.md](docs/architecture/viva-ag.md).


## 36. AI 精准营养素 — the AG Dots Ordering Flow (2026-08-25)

One purchase in GCN's Aeviva store drives a chain that crosses both repos:

```
GCN store   buy 'AI 精准营养素'                  → order: pending_payment
GCN         payment confirmed                    → order: awaiting_formulation   [new status]
GCN → nano  /viva-subscription-checkout-confirmed → grants viva + viva_ag
nano        AG subtab: upload records, submit dots_formulation      (§35, unchanged)
AG agent    POST /viva-ag/jobs/result
nano        parse + validate → viva_ag_formulations 'valid'
nano → GCN  POST /api/mall/aeviva/formulation-ready
GCN         opens formulation_reviews, notifies experts → order: expert_review
GCN expert  claims, reads the nano snapshot, approves  → order: compounding
GCN → nano  POST /ag-formulation-approved         → nutrition_plans row, status 'approved'
GCN         compounds, ships
nano        user scans the box → POST /box-claim   → 56 schedules, plan 'active', day 1 = today
```

Most of this is pre-existing machinery on both sides (§35's job queue; GCN's `formulation_reviews`,
`nutrition_expert` role and processing centre from its migrations 0060-0076). Four things were
genuinely missing, and they are what this section is about.

### Nano now parses and validates the formula — §35 said it never would

That was correct while the formula was a read-only artifact. It stopped being correct the moment an
approved formula gets compounded into physical capsules, because then `lib/agFormulation.js` is the
**only** thing between an LLM-authored table and something a person swallows.

Two properties it must keep:

1. **Reject, never repair.** A count outside a dot's `target_dots_min…max` is refused, not clamped;
   a bad `total_dots` is refused, not recomputed. Either repair would ship a formula nobody
   authored. Violations are collected and returned in full, and the user is asked to re-run.
2. **No DB, no I/O.** Every rule is a pure function over `(parsed, dotsFormulary)`, so the whole
   rule set is testable without a database.

`result.formulation` (the JSON mirror) is now the contract; the `.md` is a documented fallback. The
job still succeeds either way — the agent's analysis and report reach the user regardless — and the
response carries `formulation_accepted` plus the violations. **`worker/docs/viva-ag-api.md` §8 was
rewritten to say all of this**; it ships inside the function, so it cannot drift, but only if it is
edited alongside the rules.

The product-model constants moved to **`lib/dotsProductModel.js`** so `handlers/dots.js` and the
validator share one definition. §35's warning now binds three consumers, not two: change
`PLAN_DAYS`, `MAX_DOTS_PER_CAPSULE`, `N7_KEY` or `N7_ISOLATION_DAY_INDEXES` and you must change
§8 of the API doc in the same commit.

### The plan is created on approval and activated on scan

Expert approval inserts a `nutrition_plans` row at the new **`'approved'`** status with **zero**
`nutrition_schedules`. The 56 schedule rows are written when the user scans the box, which is also
when `start_date` is rewritten to that day — so the cycle starts when the capsules are in hand, not
while they are being compounded and shipped.

`'approved'` is deliberately not a reuse of `'pending'`: that value means "an async formulation is
mid-flight and may never land" and is written and read by `_handleFormulaDotsAgentic`'s own flow.
`handleGetNutritionPlan` filters `status = 'active'`, so an approved-not-yet-scanned plan is
invisible to the Dots subtab for free — the user keeps seeing their previous plan until the box
arrives.

**`_commitAgFormulation` is a deliberate sibling of `_commitNutritionPlan`, not a reuse of it.**
That function takes a *steady-state* AM/PM recipe and EXPANDS it across the cycle, applying
`_applyPulseSchedule`, `_capRecipeTotal` and the `DOT-N7` isolation override day by day. An AG
formula already encodes all 56 capsules explicitly — pulse days, isolation days and all — so
running it through that expansion applies every rule a second time and flattens the per-day
variation the agent produced. The capsules are written verbatim; the fill cap is re-applied
defensively only. Do not "simplify" these two into one.

### The box scan (`POST /box-claim`)

`boxes` previously existed only to back a public ingredient page. It now carries
`claimed_by_user_id` / `claimed_at` / `nutrition_plan_id`, and `box_batches.ag_formulation_id` lets
a batch be snapshotted from an approved formulation rather than the user's *active* plan — which
for this flow would be the previous formula.

Three behaviours that are load-bearing:

- **Idempotent.** A second scan returns the plan the first made. A user double-tapping must not get
  two overlapping 28-day cycles.
- **Non-transferable.** `not_your_box` if the batch belongs to someone else. These capsules are
  compounded from one person's biomarkers; taking someone else's is a real safety issue, not a
  permissions nicety.
- **A second box from the same batch joins the existing plan** rather than regenerating the
  schedule.

Both a bare `WVB…` code and the public page's URL are accepted, because a WeChat scan returns
either depending on what was encoded.

### Entitlement: `product_type` on the subscription catalog

Exactly the upgrade path `migration_users_viva_ag_expiry.sql`'s comment prescribed — one column on
`viva_subscription_plans` and `viva_subscription_codes`, snapshotted at mint like `duration_days`,
plus a branch in `_extendUserSubscription`. No new endpoint and no new `GCN_ALLOWED_PATHS` entry;
`/viva-subscription-checkout-confirmed` already takes `plan_key`.

**A `viva_ag` plan grants BOTH windows.** `requireVivaAgAccess()` is a composite of
effective-persona-is-viva AND a live Viva grant AND a live AG grant, so granting only
`viva_ag_expires_at` leaves a paying buyer locked out of the subtab they just bought. Two
`persona_subscription_grants` audit rows are written so the admin history shows it.

### The review stays in GCN

Nano exposes `GET /ag-formulation-review-snapshot?formulationId=&openid=` (GCN-allowlisted, same
`{valid, reason}` always-200 contract as its siblings). The twin half of both review snapshots is
now one shared **`_buildReviewTwinContext`** in `dots.js` — two endpoints showing reviewers
different evidence would be the worst failure mode available here.

**An expert's adjustment is re-validated by nano** through the same validator. The reviewer UI can
be wrong too, and this recipe is about to become physical capsules; "a human approved it" is not a
reason to skip the only check there is. In GCN's expert dashboard `DOT-N7` is read-only (its dosing
is system-controlled), and the table edits **daily** counts — what a dot's min/max actually compares
against — then rebuilds the 56 capsules preserving each dot's AM/PM split.

### Why the order needs a waiting state

The sequence is **inverted** relative to GCN's existing custom-formulation product. There the recipe
existed first and checkout priced it per-dot from nano's committed plan. Here the buyer pays first
and the recipe arrives days later. Consequences, all of them forced:

- the bundle is **flat-priced** — there is no recipe to price at checkout;
- `order_item_custom_formulations.nano_nutrition_plan_id` / `recipe_snapshot` had to become
  **nullable**;
- the order waits in **`awaiting_formulation`**, a new status before `expert_review`. Not a reuse of
  `'paid'`, which `handleOrderShip` accepts — an order parked there could ship before any formula
  existed.
- `recipe_snapshot` stays **write-once** (GCN's own migration 0076 depends on it; the printed label
  QR resolves against it). An expert's edit goes to `adjusted_recipe`, never there.

Cross-repo notifies are **fire-and-forget in both directions**, matching the rest of this
integration: the formula is safely recorded before GCN hears about it, and the expert's decision is
committed before nano hears about it. A `valid` formulation with a NULL `gcn_order_id` is the query
that finds the ones that didn't land — there is no retry job.

### Files

**nano** — new: `src/schemas/migration_{subscription_product_type,viva_ag_formulations,nutrition_plans_ag_status,boxes_claim}.sql`,
`worker/lib/{agFormulation,dotsProductModel}.js`, `worker/handlers/ag_formulation.js`.
Modified: `handlers/{viva_subscription,viva_ag,dots,boxes}.js`, `worker/index.js`,
`worker/docs/viva-ag-{api.md,openapi.json}`, `nano-miniapp/pages/main/*`,
`components/viva-ag-panel/*`, `utils/config.js` (VERSION).

**GCN** — new: `migration_0078_aeviva_ai_precision_nutrition.sql`, `handleFormulationReady` +
`openFormulationReview` + `handleAgFormulationBundleOrderCreate` in `mall/index.js`.
Modified: `mall/formulation-reviews.js`, `site/aeviva/dashboard-expert.html`, `s.yaml`/`s-prod.yaml`
(`NANO_SERVICE_TOKEN` for the mall function).

Full detail: [docs/architecture/ag-dots-ordering.md](docs/architecture/ag-dots-ordering.md).

## 37. AI Store-Product Recommendation (aeviva-china, 2026-08-25)

Viva can suggest the Aeviva GCN storefront's **non-Dots** products (supplements, skincare,
wellness devices) inside a health conversation. Reactive only: it never volunteers one.

### The blocker was an instruction, not a gap

`llmContext` had no commerce field and `AGENTIC_TOOL_DEFS` no commerce tool, but neither mattered
— the always-injected `fact-constraint-core` block (§26) said every ingredient suggestion must
come from the Dots formulary and that **no purchase channel may ever be named**. Catalog data in
the prompt would have been refused.

That rule is **narrowed, not removed**: recommend from the Dots formulary **or** a catalog
explicitly provided in this prompt, never from training-data memory. It lives in **three places
that must change together** — the `knowledge_entries` rows (both personas,
`migration_knowledge_store_products.sql`), `lib/knowledgeBase.js`'s `FALLBACK_ESSENTIAL_BLOCK`,
and `prompts/chat/factConstraint.js`. If the two fallbacks drift back, a transient DB error
silently returns Viva to refusing to discuss any product at all.

The company-business-info ban (prices, stock, delivery, promotions) is **untouched and still
absolute** — see "the model picks, the server writes" below for why it did not need loosening.

### AI profiles are authored in GCN, and are not the marketing copy

`products.description` already carries `zh`/`highlights_zh`/`details_zh`. **Never feed it to the
model.** It is written to convert a shopper already looking at the item; handed to a health LLM it
becomes personalized medical advice assembled out of unvetted promotional claims.

`product_ai_profiles` (GCN `migration_0079`) is the separate, reviewed record: `summary_zh`,
`indications_zh`, `key_actives_zh`, `cautions_zh`, `allergens_zh`, `evidence_level`, and
**`sub_age_targets`** using this file's §11 canonical keys. That last field is what earns the
table — it makes "which products fit this user's elevated dimension" a code filter, exactly as
`dots.sub_age_target` already does. Values are validated app-side against the fixed four.

`ai_recommendable` is **admin-only** and is rejected without a `reviewed_by` — the gate
`knowledge_entries` enforces before an entry may go active, and the precedent of
`skus.grants_partner_type` (migration_0053), the one SKU field that rejects its owning supplier.
A supplier's write omits the flag entirely rather than defaulting it false, so routine copy edits
can never silently un-approve a cleared product.

### Reactive-only is structural, not an instruction

`prompts/chat/intentClassifier.js`'s `required_data` enum gained **`store_products`**, so the
catalog is fetched only when the classifier saw the user themselves ask what they could obtain.
Every *other* pre-fetch in that bundle is unconditional precisely so a classifier miss can't blind
the model — **here a miss is the desired failure mode.** With no catalog,
`getProductRecommendBlock` returns `''`, the model is never taught the vocabulary, and the
essential block's parenthetical collapses the rule back to Dots-only. Also gated on a GCN-linked
channel (`GCN_LINKED_CHANNEL_KEYS` in `handlers/chat.js`, mirroring `handlers/login.js`'s copy).

### The model picks, the server writes

The `recommend_product` action tail carries a `sku_id` and one sentence of reasoning and **nothing
else**. `_validateProductRecommendations` resolves each id against the snapshot the prompt was
built from — unknown ids are dropped silently, never repaired — and `_buildProductCardBlock`
(`handlers/dots.js`, beside `_buildFormulaChartBlock`) renders the `:::product` card from that
same snapshot. Same rule as `:::formula`: the card cannot disagree with what checkout will charge.

**Prices are deliberately never shown to the model** (`getProductRecommendBlock` omits them) — a
number it was never given is a number it cannot leak. This is why the price/stock ban above needed
no loosening.

### Allergies are a code filter, not a prompt rule

`_filterProductsByUserFacts` (`handlers/chat.js`) drops any product whose `allergens_zh`/
`cautions_zh` collide with an active `user_memory_facts` row of category `allergy` or
`dietary_restriction` (§27) **before the catalog is rendered into the prompt**, so there is nothing
left for the model to get wrong. Matching is bidirectional substring containment and deliberately
biased toward over-suppression.

### PLAN and JUDGE both had to be taught the tail

Otherwise they reject it as an unsupported claim and burn REVISE rounds — the exact failure
`remember_fact` hit in §27. `judgeTemplate.js` now states that the tail is a control action
verified in code against `store_products`, and that the draft's **absence** of a price is correct
rather than an omission; `planTemplate.js` states that choosing a product is a merchandising
decision needing no evidence-level backing (a health claim *about* it still does).
`detectFakeStoreProduct` (`lib/factCheck.js`) covers the remaining gap — a product named in prose
but never actually picked, which never becomes a card but reads to the user exactly like one.
`detectAllRisks`'s signature widened to `(reply, dotsFormulary, storeProducts)`; both call sites
pass it.

### Tap-through reuses everything

`handleProductCardTap` → `_openAevivaStoreGated({intent:'view_product', sku_id})` → the existing
`webview_tokens.context` bridge → GCN's `dashboard.html`, which routes it into its **existing**
`?sku=` opener (`gcn_deep_link_sku`/`maybeOpenSharedSku`), silent no-op included when the item
isn't listed in that buyer's own bound store. It `await loadMall()` rather than calling the opener
directly: the page's own `loadMall()` is fired un-awaited, so the opener would otherwise race an
empty catalog.

A native tap handler is **mandatory, not stylistic** — `_onMdLinkTap` can only offer to *copy* an
http(s) URL, because a WeChat miniapp cannot open an arbitrary external link from chat prose.

### Catalog is per-user and store-scoped

`GET /api/mall/nano/ai-catalog` (GCN, `requireNanoService`) resolves the user's bound store via
`partner_bindings` (`binding_type='consumer_store'` — **not** the superseded
`consumer_store_bindings`) and delegates listing to `handleStoreItems` rather than reimplementing
it, so VMI/MDC cascade availability stays consistent with what the storefront actually shows.
Recommending an item the user's bound store doesn't list would dead-end them on an empty grid.
**Always returns 200** — unbound, unlinked, or failing all yield `{items: []}`, following
`handleNanoFocusTemplates`' contract. `fetchAiCatalog` (`lib/gcnClient.js`) never throws either and
self-limits to 4s.

Every SKU with its own dedicated purchase flow is excluded (`is_custom_formulation`,
`is_ag_formulation_bundle`, `viva_subscription_plan_key`, `grants_partner_type`, `package_only`,
`is_parent`) — surfacing one as "here's something for your sleep" would route a shopper into a
flow they have no business entering from a chat reply.

### Files

**nano** — new: `src/schemas/migration_knowledge_store_products.sql`,
`worker/prompts/chat/productRecommendBlock.js`, `tests/store-product-recommendation.test.js`.
Modified: `worker/lib/{gcnClient,knowledgeBase,factCheck,agenticChat}.js`,
`worker/prompts/chat/{intentClassifier,factConstraint,planTemplate}.js`,
`worker/prompts/viva/judgeTemplate.js`, `worker/prompts/{nano,viva}/chat/nutrition.js`,
`worker/handlers/{chat,dots}.js`, `nano-miniapp/utils/markdown.js`,
`nano-miniapp/pages/main/main.{js,wxml,wxss}`, `utils/config.js` (VERSION).

**GCN** — new: `migration_0079_product_ai_profiles.sql`; `handleProductAiProfileGet`/`Update` +
`handleNanoAiCatalog` in `mall/index.js`. Modified:
`site/aeviva/ext-catalog-editor.js` (the AI 推荐资料 section), `site/aeviva/dashboard.html`.

## 38. 健康文档 Is Twin Data, Not an AG Feature (2026-09-08)

Uploading a health record — a clinic note, a 体检报告 PDF, a photo of a paper printout — used to
be reachable from exactly one place, the **Viva AG** subtab, and all five
`/api/health-documents` endpoints required the AG entitlement. But `health_documents` is **twin
layer 3, Medical Records** (§34), not an AG artifact. The 数字孪生 subtab — the one every user
sees — now ends with the same 健康文档 section, and the endpoints ask only who the caller is.

### One component, two hosts

`components/health-documents/` is the whole manager (list, upload, open, delete), extracted from
`viva-ag-panel` rather than copied into `user-health`. Two copies would be two upload paths
drifting apart against one backend, and `user-health` is already 3800 lines — the same reason its
own comment gives for keeping the AG body out of it.

No `variant` property was needed: `.ag-section` and `.health-section` are byte-identical, and
`.ag-section-title` differs from `.section-title` only by 4rpx of bottom margin, so one set of
section chrome reads as native in both hosts. `--fs-*` and the colour vars come from `app.wxss`
and inherit through the component boundary; the `.theme-light` **class** does not, which is why
the component carries its own root theme hook.

Both hosts sit behind a `wx:if`, so an AG holder toggling subtabs gets a fresh mount and a fresh
fetch — there is no cross-instance refresh to build. A user with **no** AG subtab mounts it once
per app launch (the health tab is `display:none`, never unmounted), which is why it has a `lang`
observer that `viva-ag-panel` lacks: without it a language switch leaves the section in the old
language, and `typeLabel` is baked into each row at fetch time so the rows are relabelled too.

### A coach reads, and never writes

`can-upload="{{mode === 'self'}}"` hides the upload button **and** the per-row delete, and
`deleteDocument` re-checks it — a WXML gate is one edit from gone. `coach-id` travels to the
server, where `_resolveOwner` runs the same coarse ownership check `handleGetUserFacts` and
`handleGetCoachUserChat` already use (`SELECT 1 FROM users WHERE user_id=$1 AND coach_id=$2`),
**only when the caller supplies one** — the admin panel and the user's own miniapp omit it and
address themselves.

`this._coachId` in `pages/coach/coach.js` lives **outside `data`**, so WXML cannot read it. It is
mirrored into `data.coachId` at **both** sites it is assigned (`onLoad` and
`_repairCoachSession`); miss the second and a repaired session reads unscoped.

`_refuseCoach` makes presign/register/delete reject a `coach_id` outright. That is a statement of
intent, **not enforcement** — a caller can always omit the param and send a bare `openid`, the
same as any caller of any endpoint here. Do not mistake it for a barrier.

### What the entitlement drop did and did not change

Nothing but Viva AG reads `health_documents` (`lib/twinBundle.js` and `handlers/viva_ag.js`), so
for a user without the add-on this is an archive that pays off the moment they buy one. The
section's footnote says as much without naming a product they may not have.

The AG check was an **entitlement** gate, never access control: it never stopped one AG user from
passing another user's openid. What protects the object is unchanged — server-minted keys under
`health-documents/<user_id>/`, `oss_key` never returned to the client, 300s URLs, and never
routing through `/oss/presign`. `health_documents.js`'s security header says this in place of the
claim that is no longer true; keep it honest if the gate ever changes again.

### Files

New: `src/mini/nano-miniapp/components/health-documents/`, `tests/health-documents-access.test.js`.
Modified: `worker/handlers/health_documents.js` (`_resolveOwner`/`_refuseCoach` replacing
`requireVivaAgAccess`; **no route changes** — `coach_id` already arrives in `query`/`parsedBody`),
`components/viva-ag-panel/*` (section replaced by the component; `_sizeLabel` and
`DOC_EXTENSIONS` kept, the job/report viewer still needs them), `components/user-health/*`
(`coachId` property + the section, last in the twin body), `pages/coach/{coach.js,coach.wxml}`,
`utils/config.js` (VERSION).
