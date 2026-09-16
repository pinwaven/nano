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
- `/tests/`: `node:test` suites (`*.test.js`), all offline — DB and GCN are stubbed through `require.cache`, never a live Postgres. `tests/agent-test.js` is a CLI script, not a test; `tests/worker-endpoints.test.js` is a legacy live-HTTP smoke that is skipped unless `RUN_ENDPOINT_TESTS=1`.
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
- **Command:** `npm test` runs every `tests/*.test.js` offline (`node --test`); a single file with `node --test tests/<name>.test.js`. Same shape in the GCN sibling repo. There is no CI — run it before every deploy.
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

### A dot is referenced by `key_name`, never by `dots.id`

Same class of coupling rule as the sub-age keys above, and it has already been violated once.
`dots.id` is a row number. `migration_dots_new_lineup.sql` (2026-07-25) replaced the whole
formulary and **reused the ids**, so anything persisting an id silently began pointing at a
different dot — no error, no filter-out, every lookup succeeding.

`health_plan_templates.recommended_dot_ids` was the casualty
(`migration_health_plan_recommended_dot_keys.sql`): six seeded focus lists spent six weeks
recommending macular and skin dots for a weight-loss plan, and omitting the only sleep dot from
the sleep plan. That column now stores `key_name` strings; its name is historical.

**Any new column, JSONB field, event payload or API response that names a dot uses `key_name`.**
Integers may be read for backward compatibility, and an entry that resolves to nothing must be
**dropped, not guessed** — a loud, countable gap is the entire point of the stable identity.

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

The platform supports multiple AI personas, routed at the **channel level** via `channels.config.persona_type` (JSONB field). **Unset inherits from the parent chain**: `effective_persona_type(channel_id)` (`migration_channel_persona_inheritance.sql`) walks up to the nearest ancestor that sets it and returns `'nano'` only at a root with none — so a sub-channel of `aeviva-china` is Viva without any config of its own. Server code reads the function, never `config->>'persona_type'` directly. `sub_age_display_names`, `admin_tabs` and `locale` inherit likewise through `effective_channel_config(channel_id, key)` (`migration_channel_config_inheritance.sql`; NULL/`{}`/`[]`/`""` = unset).

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

An in-repo refactor ("Nano adopted Viva's core," commit `e81b344`) genericized what §21/§22/§24/§28 below (and the since-deleted §25) originally described as Viva-only mechanisms — the agentic PLAN→GENERATE→JUDGE→REVISE loop, its async CloudEvent delivery, the Health Advice tool's agentic path, and Formulate Dots' agentic generation — so **all of them are now gated on intent/feature, not on `personaType === 'viva'`**, and apply equally to Nano. Each affected section below has been corrected to reflect this; where a section's title or body still says "(Viva...)" in a way that reads as a persona gate, treat it as historical framing from when the feature first shipped, not current behavior. Two genuine, still-live asymmetries remain (not doc drift — actual gaps): `_regenerateIfFabricationRisk` (the older, non-agentic-path fabrication retry) is still gated `personaType === 'viva' && !useAgenticLoop`, so Nano's `casual_chat`/`emotional_support` intents get no equivalent retry; and `knowledge_entries` (§26) has zero `persona_type = 'nano'` rows seeded, so Nano's PLAN/JUDGE always falls back to the hardcoded default block. Full detail: `docs/ai-persona/09-known-issues.md`.

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

**Paying a store order from the miniapp (2026-09-15).** GCN's checkout shows the store's uploaded
收款码 image inside `pages/appview`'s `<web-view>`, which cannot save an image — so its "save it and
open it from your album" instruction described something the surface could not do.
`dashboard.html`'s `renderPaymentScreen` therefore, when `window.__wxjs_environment === 'miniprogram'`,
hands the signed OSS URL to the native `pages/pay-qr/` via `wx.miniProgram.navigateTo` (jweixin
loaded for that call only, no `wx.config`), whose one job is 保存到相册; the buyer then scans it from
the album in WeChat or Alipay. **That scan step is the floor.** Measured on dev (order `df25055b`):
a Mini Program's `wx.previewImage` long-press menu recognises only 小程序码/公众号/群/名片 codes —
the store's `wxp://` 收款码 decodes fine locally, but WeChat offers no 识别图中二维码 for it — and
Alipay cannot be launched from inside WeChat (`alipays://`/alipay.com are blocked). Don't reintroduce
previewImage as a "pay directly" path; the only thing that removes the scan is a `wx.requestPayment`
merchant integration (商户号 + settlement to stores), a business change. The signed URL is decoded
**once, and only if still encoded** — decoding the Signature's `%2B`/`%3D` twice makes OSS refuse it.
The GCN OSS host must be in the miniapp's downloadFile 合法域名.

**Custom-formulation purchase flow (in-flight, see §31):** a separate, newer cross-repo addition — GCN can now validate and confirm purchases of a user's actual committed Dot formulation (`GET /formulation-checkout-snapshot`, `POST /formulation-purchase-confirmed`, both in `GCN_ALLOWED_PATHS`), and `webview_tokens.context` carries a `{intent, nutrition_plan_id}` payload through the SSO handoff so GCN's checkout knows which formulation to price. Unrelated to the partner/commission consolidation above — this is nano's own Dots product (§14), not aeviva's wholesale inventory.

## 20. Avatar Gallery System

Users pick a profile avatar from a gallery of 40 pregenerated characters (`components/avatar-picker/`) instead of uploading a real photo — WeChat's native `chooseAvatar` upload flow was removed entirely. Each character has 4 mood variants (engaged/relaxed/restored/stressed); `users.avatar_character` (migration `migration_avatar_character.sql`) records which character was picked, while `avatar_url` keeps storing a single resolved image URL exactly as before (now the character's `relaxed` variant) so every other read site is unaffected. In the health tab's self view only, `utils/mood.js`'s `computeMood()` derives a live mood client-side from already-synced wearable data and swaps the displayed image — purely client-rendered, never written back to the server. Gallery images live on the `waven-nano` OSS bucket; regenerate via `temp/upload-avatar-gallery.js` (rewrites `utils/avatar-gallery.js`). Full details: `docs/architecture/avatar-gallery.md`.

## 21. Agentic Plan→Generate→Judge→Revise Loop — Rules

`runAgenticTurn()` (`lib/agenticChat.js`) runs for every intent in `HIGH_RISK_INTENTS`
(`biomarker_question`, `nutrition_question`, `longevity_science`, `record_action`) — gated on
intent, **not** persona (§16); `casual_chat`/`emotional_support` take the classic path for both
personas. Full record: [docs/ai-persona/03-agentic-chat-loop.md](docs/ai-persona/03-agentic-chat-loop.md).

- **Budget per turn:** PLAN 1 · GENERATE ≤3 (`GENERATE_MAX_ITERS`) · JUDGE 1 · REVISE ≤2
  (`REVISE_MAX_ROUNDS`) · re-JUDGE ≤2. Logged as `turn_budget_used`. Never loop past it.
- **GENERATE uses only the typed read tools** in `lib/agenticTools.js` — never raw model-authored
  SQL; biomarker-shaped data always from `data.validated` (§17). `health_events` is deliberately
  unexposed (`health_twin` summarizes it). Forced tools (`buildForcedToolQueue`) are capped at
  `GENERATE_MAX_ITERS - 1`, deterministic triggers first, and the final iteration pins
  `tool_choice:'none'` (§28).
- **JUDGE must see everything GENERATE saw**: the full pre-fetched `llmContext` (with
  `biomarkers`/`dots` re-fetched fresh), `tool_calls_made` with real results, the **current user
  message** (a `remember_fact` of something just said is self-evidently grounded), the curated KB
  matches, and `detectAllRisks`. Each of those was added after a live regression where a correct
  answer was stripped as "unsupported"; don't narrow JUDGE's inputs.
- `runJudge()` downgrades REJECT → PASS when every violation's `correction_hint` is empty (a JSON
  self-consistency failure, not a real violation). The REVISE prompt forbids a bare-JSON-only
  rewrite.
- **Every action tail must be taught to PLAN and JUDGE** (`planTemplate.js`,
  `judgeTemplate.js`) or it is graded as an unsupported claim and burns REVISE rounds —
  `remember_fact`, `formulate_dots`, `recommend_product` all hit this. Keep JUDGE's
  DELIBERATELY NARROW clauses.
- `verifyBiomarkerGrounding` runs afterward for every intent, receiving `extraValidDates`/
  `extraValidValues` from `extractToolGroundTruth()` — so tool results must be **flat arrays**
  (a wrapper object harvests nothing) and dates **date-only** (§28).
- `_regenerateIfFabricationRisk` is superseded on this branch (`!useAgenticLoop`) and remains
  gated `personaType === 'viva'` on the classic path — a real open asymmetry, not drift.
- **Known systemic over-strictness:** JUDGE rejects on cosmetic differences ("41.0岁" vs "41岁").
  Not fixed; revisit if REVISE churn becomes user-visible.

## 22. Async Chat Delivery — Rules

FC **cancels an invocation the instant the HTTP client disconnects** (confirmed live), so any
turn that can outlive `wx.request`'s timeout must leave the request cycle. Full record:
[docs/ai-persona/06-chat-pipeline.md](docs/ai-persona/06-chat-pipeline.md).

- For `useAgenticLoop` on **real (non-sandbox) traffic**, `handlePostChat` publishes a
  `chat.generate` CloudEvent (`lib/chatEventBridge.js`) and returns `{processing:true}`; the
  worker's `eb-trigger` (`acs.chat` source) runs `handleChatGenerateEvent` on a separate
  invocation. `sandbox:true` and the non-agentic intents never take this branch. On publish
  failure it **fails open** and runs inline.
- **One tail, not two:** `finalizeChatReply()` is the shared grounding/action/save+notify tail for
  the sync callers and the event handler. `handleChatGenerateEvent` branches on `kind`
  (`formula_dots_generate` → `finalizeFormulaDotsGenerate`).
- **Dedupe:** EventBridge is at-least-once; `chat_generate_events` is claimed via
  `INSERT … ON CONFLICT DO NOTHING RETURNING` before any real work.
- **Credentials:** HTTP-triggered `context` is an empty object — use the env-injected STS vars
  (`ALIBABA_CLOUD_ACCESS_KEY_ID`/`_SECRET`/`_SECURITY_TOKEN`, `FC_REGION`), not
  `context.credentials` (`fc3-handler-reference` skill).
- **Delivery is two-channel and both must stay.** `GET /api/notifications` is a destructive read
  with no ack, so one lost poll response consumes the only copy. (1) `handleGetChatHistory`'s
  `since_id` poll takes `roles=coach,ai` while a turn is pending (`_chatWaitStartedAt`), de-duped
  on normalized text (`_aiKey`) and scoped to `AI_ECHO_TYPES` — types that also write a
  `chat_messages` row; `coach_reminder` is deliberately excluded. (2) A 250s watchdog
  (`DELIVER_DEADLINE_MS`, env `CHAT_DELIVER_DEADLINE_MS` for tests) races the work; exactly one
  terminal message via `_deliverTerminalMessage` + single-use `claimDelivery()`.
- **Every client wait goes through `_beginChatWait`** (`CHAT_WAIT_SYNC_MS` 30s for sync turns,
  285s for async) so a budget can never be left over from a turn of the other kind. Status
  captions (`notification_type:'chat_status'`) come from `runAgenticTurn`'s `onStatus` callback
  via `makeStatusNotifier()`. Failure text is localized by `user.language`.

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

## 24. Health Advice Tool — Rules

`handlePostHealthAdvice` (`chat.js`) runs the same agentic loop **unconditionally for both
personas**, reshaping its fetches into the same `llmContext` contract `handlePostChat` produces
(`plan`/`questionnaire_context`/`sub_age_display_names` left `null`, not faked), so it reuses
`publishChatGenerateEvent`/`handleChatGenerateEvent`/`finalizeChatReply` with no new event type.
Record: [docs/ai-persona/06-chat-pipeline.md](docs/ai-persona/06-chat-pipeline.md).

- **`pages/main/main.js` and the web user-app's `chat/useChat.js` are wired async** (`opts.async:true`) —
  both run the two-channel poll (`hooks/useNotificationPoll.js` on the web). `pages/coach/coach.js`
  has no polling and stays synchronous; `coach.js`'s `_req` takes a `timeoutMs` and
  `runHealthAdvice` requests 180s (the loop measured ~167s).
- The synchronous tail is `finalizeHealthAdviceReply()` — same grounding-with-one-retry, returns
  `{success, message}` inline instead of writing `notifications`.
- `/health-advice` is exempt from `index.js`'s sandbox short-circuit alongside `/chat`; without
  it the toolbox button never worked in admin preview.

## 26. Knowledge Base — `knowledge_entries` — Rules

Viva's always-injected guardrail block and the keyword-matched curated KB both live in one table,
`knowledge_entries` (`tier` = `essential` | `optional`, `persona_type`), editable from the admin
panel's Content ▸ Knowledge sub-tab (superadmin). Record:
[docs/ai-persona/05-knowledge-base.md](docs/ai-persona/05-knowledge-base.md).

- `lib/knowledgeBase.js`: `getEssentialBlock(personaType)` (active essential rows, ordered by
  `sort_order, id`) and `findRelevantEntries(personaType, text, limit)` — the same in-process
  substring/tag match as before, **no RAG/embeddings**, no caching (tiny table).
- **On any DB error or zero rows, `FALLBACK_ESSENTIAL_BLOCK` ships** — a hardcoded copy kept so a
  transient error never sends a reply with no guardrails. That is why every essential-block
  wording change is a **three-site change**: the `knowledge_entries` row(s), `FALLBACK_ESSENTIAL_BLOCK`,
  and `prompts/chat/factConstraint.js`'s fallback. Instances so far: store-product narrowing
  (§37), refusal wording and tier-copy permission (§28). Drift here silently restores old
  behaviour only when the DB blips.
- **Fetched once per request, not per template**: handlers `await getEssentialBlock()` where they
  resolve `personaType` and thread it as `llmContext.essential_knowledge`;
  `getFactConstraintBlock(preloaded)` returns `preloaded || FALLBACK_ESSENTIAL_BLOCK`. The async
  event path needs no re-fetch — it travels in the event payload.
- An entry cannot be `status='active'` without `reviewed_by` (enforced in
  `handlers/knowledge.js`). Zero KB matches is not a failure signal.
- **Nano has zero `persona_type='nano'` rows seeded** — its PLAN/JUDGE always fall back to the
  default block (§16, `docs/ai-persona/09-known-issues.md`).

## 27. Personal Memory Facts — `user_memory_facts` — Rules

Durable per-user facts ("I don't eat pork") — distinct from `users.bio_data` (onboarding
checklist) and from `knowledge_entries` (general science). Record:
[docs/ai-persona/04-fact-checking-and-memory.md](docs/ai-persona/04-fact-checking-and-memory.md).

- **Not persona-scoped** (an allergy is true for both personas). `category` is a fixed enum
  (`dietary_restriction`/`allergy`/`preference`/`goal`/`other`, plus `condition` from §39),
  validated against a `Set` in `finalizeChatReply()` — never trusted from the LLM. Partial unique
  index on `(user_id, category, fact_zh) WHERE status='active'` powers the `ON CONFLICT` upsert;
  no fuzzy dedup or contradiction resolution by design.
- Written via the `remember_fact` action tail (same mechanism as `record_weight`/`set_reminder`);
  `stripActionJson()` and the final `.replace()` chain both know the pattern. A reply that strips
  to nothing falls back to `好的，已记录：<fact>` — never ships blank.
- **Recall is always-fetched**, not intent-gated (`fetches.user_facts` in `handlePostChat`,
  `handlePostHealthAdvice`, `handlePostFormulaDots`), rendered by `getFactMemoryBlock()` as a
  flat **uncapped** bullet list into ~14 templates — which is why `fact_zh` must stay short (§40's
  dot-deletion hazard). Extraction is wired into 5 chat templates + 3 report templates, not
  `science.js`/`reminder.js`.
- Consumers with teeth: `formulationQuality`'s `allergy_conflict` removes dots (§28/§40);
  `_filterProductsByUserFacts` suppresses store products (§37). A wrong fact is sharper than a
  wrong lab value.
- CRUD: `handlers/userFacts.js` at `/api/user-facts[?openid=/coach_id=]`, coach-scoped by the
  same `users.coach_id` ownership check as `handleGetCoachUserChat`; admin panel Facts tab and
  coach-app Facts tab.
- **`chat/nutrition.js` carries the "answer what was actually asked" rule** `chat/biomarker.js`
  has — JUDGE checks facts, not relevance, so a correct-but-generic status recap passes clean.

## 28. Dots Formulation, Packages & Orders (营养定制) — Rules

Two docs hold the full record and every "why"; this section is only the rules that must hold.

| | |
|---|---|
| Ranking → doses → budget → capsule levelling → expansion | [docs/architecture/dots-formulation.md](docs/architecture/dots-formulation.md) |
| Plan statuses, label QR, packages, redeem codes, orders, the Dots subtab, the chat tool (historical §28–§28g, moved 2026-09-15) | [docs/architecture/dots-formulation-lifecycle.md](docs/architecture/dots-formulation-lifecycle.md) |

Product constants (`PLAN_DAYS`, `MAX_DOTS_PER_CAPSULE`, `N7_KEY`, `N7_ISOLATION_DAY_INDEXES`) live
in `worker/lib/dotsProductModel.js` and bind three consumers — `lib/formulation.js` (with
`handlers/dots.js` behind it), `lib/agFormulation.js`, and §8 of `worker/docs/viva-ag-api.md`.
Change all three together.

**File map (split 2026-09-16; the two docs above predate it and say `handlers/dots.js` for all of
these).** `handlers/dots.js` — the I/O: `handlePostFormulaDots`/`_handleFormulaDotsAgentic`,
`_runDeterministicFormulation`, the plan writes (`_commitProposedPlan`, `_activateProposedPlan`,
`_commitAgFormulation`), `handleGetNutritionPlan`, the checkout/label/review snapshots, dots CRUD.
`lib/formulation.js` — the arithmetic, pure and DB-free: `_expandPlanDay`, `_planExpansionContext`,
`_fitRecipeToDailyBudget`, `_balanceCapsules`, `_capDistinctDots`, `_equalizeToTarget`, the tier
ladder, `_doseFromRanking`, `_fallbackCountForDot`, `_resolveCandidateDotKeys`. `lib/chatCards.js` —
`_buildFormulaChartBlock`, `_buildProductCardBlock`, `_tierPitch`. `handlers/formulation_orders.js`
— `PACKAGE_STAGES`/`PACKAGE_STAGE_NARRATION`, `_mergeFormulationPackages`,
`_fetchFormulationPackages`, `_resolveOrderContext`, `handlePostFormulationSubmit`,
`handlePostFormulationRedeem`. `handlers/store.js` — the whole in-app store: item/SKU CRUD and order listings (already
there) plus the storefront read, channel inventory, order placement and Neo cartridges (moved in). Nothing changed behaviour; every test that exercised the
pure functions now requires `lib/formulation.js` directly.

### Formulating

- Both personas run the agentic path (`_handleFormulaDotsAgentic`, async via `chat.generate`
  `kind:'formula_dots_generate'`); `_runDeterministicFormulation` is the shared fallback on any
  failure, never Nano's primary path.
- **A BioAge is a precondition.** `handlePostFormulaDots` refuses with no
  `bioage_profile.BioAge` and asks for a Kino scan — no plan row, no LLM call. A `lab_import` panel
  does not qualify (the query is `kino_chip`-only at all its call sites; widening it is a product
  decision). The refusal is delivered on both channels and returns `processing:true` so the
  client's canned 配方已生成 never prints beside it.
- **The model ranks; the server partitions and doses.** The tail is
  `{"action":"formulate_dots","ranking":[{dot_key, why}…]}` — no tier tags, counts or `weeks`
  from the model (nine measured qwen-plus runs never produced the partition). Every key is
  validated against the formulary; a missing/unparseable tail falls back deterministically.
- **`_expandPlanDay` is the single expansion rule set** (N7 isolation, pulse gate, cap, budget,
  balance) for four consumers that must never disagree: the `:::formula` card, the checkout
  snapshot, the fast-track submission, and the 56 schedules written on box scan. Never a second
  copy.
- Budget on **daily** totals: rebalance → reduce toward each dot's own floor → drop whole dots
  (from both slots). A dot is at a real dose or absent, never sub-therapeutic. `_capRecipeTotal` is
  a no-op safety net, not the budget decision. A recipe that already fits is returned untouched.
- `_balanceCapsules` levels AM/PM **per week**. Locked dots (`timing_flexible=false`: `DOT-N3`
  evening, `DOT-N4`/`DOT-N12` morning) are immovable and the only thing that can leave a day
  uneven. **No majority rule** — `slot_minority` was removed; if a dot must not be taken mostly at
  the other end of the day, lock it.
- Tier width (`max_distinct_dots`) caps **one week**, not the cycle. `_capDistinctDots` runs once,
  on the recipe, before storage, removing a dot from an over-full week rather than the formula.
  `DOT-N7` is never counted. `_countDistinctDots` = the widest week.
  `proposed_recipe.morning/evening` is always the **narrowest** variant; `weeks`/`tiers` are
  optional and a key naming no weeks is in every week.
- `_equalizeToTarget` only ever adds, never past `target_dots_max`, never a locked dot out of its
  capsule; the widest variant is the ceiling and is returned untouched. A package landing short is
  at an authored limit — don't "fix" it. Membership nests because the same ranking is used at
  every width; never re-rank per variant. `_recommendedWidth` is measured before padding.
- **No internal dot code in prose** (`D-N9`/`DOT-N9`). `humanizeDotCodes()` (`lib/dotNames.js`)
  runs once per delivery on the assembled string, never inside `:::` fences (a card row is keyed
  on the code) and never inside `saveChatMessage`/the notification insert (a token's difference
  between the two rows defeats `_aiKey` de-dup and renders the bubble twice). Package pitches are
  humanized in `lib/tierCopy.js` before placement. An unmapped code is left for `factCheck.js`.

### Plan statuses

`pending` (async formulation in flight) · `proposed` (a purchasable recipe with **no**
`nutrition_schedules`, stored in `proposed_recipe`; never supersedes the `active` plan; one per
user via `uniq_nutrition_plans_proposed`) · `approved` (AG expert-signed, §36) · `active` (the
user physically has the capsules) · `superseded`.

- `handleGetNutritionPlan` is `active`-only, so a proposal is invisible to the Dots subtab — and
  its `plan` prose also comes from the latest **`nutrition_plan` notification**, so a proposal
  must deliver as `formulation_proposal`, never `nutrition_plan`.
- **Nothing creates a plan on a timer.** The `nutrition.topup` dispatcher scan and handler are
  gone. Only `_activateProposedPlan` and `_commitAgFormulation` create an active plan, both from
  `handlePostBoxClaim`. A future top-up must extend an existing plan and never match a user with
  none.
- Day numbers on a proposal are relative; `start_date` becomes real at scan. Pulse windows
  cannot be evaluated dateless (`_isPulseActiveDate` is calendar-anchored) — resolve at scan time,
  never invent a start date.

### The label code

- `nutrition_plans.label_code` (`WVB` + 12 hex, `lib/labelCode.js`) is minted **at generation**,
  unique across `boxes.box_code` **and** `nutrition_plans.label_code`. The first box of a batch
  reuses it. The shape is load-bearing: `handlePostBoxClaim` regex-extracts it from a bare code,
  nano's old `/api/box/{code}` URL, or the GCN aeviva URL.
- **A code does not make anything claimable.** Claim still resolves through
  `boxes`/`box_batches`; never "simplify" it to resolve off `label_code`.
- Sent to GCN as a **code, never a URL** (`handlePostFormulationSubmit`; GCN prints it from
  `formulation-label.html?c=`). Not shown on the chat card (a proposal is not a purchase).
- `GET /api/formulation-label?c=` is **public** (routed before the bearer gate): no user identity
  of any kind, truncated order ref, a test asserts it. Day 0 falls back to `proposed_recipe` for
  any plan with no schedules regardless of status, so a superseded label still renders (with a
  badge); `handleGetFormulationCheckoutSnapshot` stays gated on `active`/`proposed`.

### Packages, orders, redeem codes

- **Nano never prices this product.** GCN sums the dot breakdown and applies the buyer's tier.
  The card carries no price; the model is never given one.
- A package = GCN sku with `is_ag_formulation_bundle=TRUE`, `requires_expert_review=FALSE`,
  `viva_subscription_plan_key=NULL`; a third package is configuration, not code.
  `max_distinct_dots` is the contract — **never parse a width out of `tier_label`**. The tier
  name is merchandising.
- **Bought with a redeem code**, no payment at redemption. Every "is a package waiting?" answer
  comes from one live source, `fetchFormulationOrders` (`lib/gcnClient.js`), at three call sites
  (`_resolveOrderContext`, `handlePostFormulationSubmit`, `_fetchFormulationPackages`). **Never
  mirror orders into a nano table and never add a nano-local formulation-code table.**
- Order mode is resolved **at delivery time** (`buy` / `submit` / `ag`), never cached on the user
  row; any non-answer degrades to `buy`.
- Fast track (`POST /formulation-submit`): `validateAgFormulation` **refuses, never repairs**; an
  over-tier plan is refused, not trimmed; idempotent via `nutrition_plans.gcn_order_id`.
  `_selectTierVariant` picks the widest variant the code covers. Ownership is enforced by GCN's
  `ocf.nano_user_id` predicate, not by the client-supplied order id.
- `intended_nano_plan_id` is **advisory, never a join**. `_settleFastTrackPackage` is only ever an
  attempt; every refusal falls through to the nudge.
- **No sku id in the client, ever.** Address packages by width; GCN resolves width → sku
  (`openFormulationPackageByWidth`).
- `_awaitingOrders` re-sorts oldest-first to agree with what GCN attaches. Both submit surfaces
  go through one `_submitFormulation`.
- GCN's `dashboard.html` routes the miniapp's intents, so card copy must ship with any change to
  where an intent lands. Deploy GCN first.

### The Dots subtab

- `packages` is a **sibling** of `plan`/`structured_plan`/`schedules`, never a source for them.
- Stage is derived from both halves (`PACKAGE_STAGES`); `awaiting_formulation` vs `awaiting_ag`
  split one GCN status by package type; an active plan outranks the order; `day_index` is null
  unless `active`. **A new stage needs `pkgStage_<stage>` in both `T.zh` and `T.en`.**
- `submit_plan_id` is offered, not matched. A proposal is suppressed while an order is in
  `AWAITING_FORMULA_STAGES` — keyed on stage, never on `intended_nano_plan_id`. Keep that set
  narrow.
- `pkgTitle` = `package_name` + **bare** `tier_label` (one definition, three surfaces). The
  package rows and submit picker still print `最多 N 种原粒`; the card does not — retire together.
- The order card runs 营养定制, never a store link; `neoAvailable`/`neoBound` stay separate flags.

### The card

- Meta lines are `#`-prefixed and **all optional**: `#cycle`, `#plan` (digits-validated),
  `#day|<ranges>|<kind>` (bare numbers, day word is the page's), `#tier|<label>|<width>|<rec>`,
  `#note`, `#pitch`. `#label` and `#rung` are retired but **still parsed** (chat history is
  permanent). No `#tier` → one unnamed open package. Nothing renders `<width>`.
- Server-built from the validated recipe (`_buildFormulaChartBlock`); bars normalise across all
  groups of all packages.
- The whole collapsed package is the tap target (`bindtap` on a bare `<text>` does not fire);
  `handleFormulaTierToggle` is a radio. The CTA follows the **open** package (`_formulaCtaFor`,
  `seg.cta`): unpaid check first, **exact** width match, addressed by width; recomputed on build,
  open, and `_refreshFormulaCtas`.
- Tier copy: the store's line from GCN verbatim; the per-user pitch from `lib/tierCopy.js`,
  dropped (never repaired) if it names a dot the package lacks.

### The chat tool — `get_formulation_packages`

- `messageAsksAboutFormulationPackage` force-queues it and promotes `casual_chat`/
  `formulate_dots` → `nutrition_question`. Anchor on purchase vocabulary; it **must never match
  the Formulate-Dots trigger message**. A test pins both halves.
- **The stage vocabulary lives in exactly two places** — `PACKAGE_STAGES` +
  `PACKAGE_STAGE_NARRATION` (`handlers/formulation_orders.js`) and `pkgStage_*` in `main.js` — **never in a
  prompt**. The raw `stage` enum and `plan_status` are not sent; the server writes
  `stage_meaning`/`next_step`/`formula_status` sentences.
- A **flat array**, never a wrapper (`extractToolGroundTruth` harvests nothing from one). Dates
  **date-only** (`formatToShanghai` + `addDate` double-applies +8 otherwise). All three sources
  empty at once → `{ok:false}` — degraded is not empty.
- Not given: `order_id`, `plan_id`, `sku_id`, `label_code`, the redeem code string, any price,
  tier widths.
- `get_dot_inventory` is gone; **removing a tool means removing every prompt that names it** (a
  test scans prompts for `\bget_[a-z_]+`). `buildForcedToolQueue` caps at
  `GENERATE_MAX_ITERS - 1` and the final iteration pins `tool_choice:'none'` (verified live on
  qwen-plus; re-probe before changing).

### Guardrail couplings (per §26/§37)

The refusal wording (`migration_knowledge_refusal_wording.sql`) and the package-copy permission
(`migration_knowledge_tier_copy.sql`) each live in `knowledge_entries`,
`lib/knowledgeBase.js`'s `FALLBACK_ESSENTIAL_BLOCK`, and `prompts/chat/factConstraint.js` —
**change all three together**. `planTemplate.js`/`judgeTemplate.js` are taught the
`formulate_dots` tail; keep JUDGE's DELIBERATELY NARROW clause. If a `shipped` order still gets the
canned 联系客服 line, narrow the logistics ban at the same three sites.

### Known open items

- `_getCommittedPlanDay0Breakdown` reads day 0, which under a `weeks` rotation is week 1, not the
  cycle union — affects the checkout snapshot and the printed label. Don't quietly redefine day 0.
- `formulationQuality._ingredientNames` maps JSONB to `"[object Object]"`, so the allergen check
  only compares dot names (see §40).
- Neither GCN processing centre has `payment_qr_urls`; only bites if one becomes a seller.

## 29. Viva Proactive Daily Check-Ins — Rules

Viva initiates up to three in-app messages a day (`morning_checkin` 05–10h, `midday_checkin`
11–16h, `evening_checkin` 17–23h Shanghai; none 00–04h), triggered by the user's **own first
app-open within a period** (`last_active_at` via `/api/heartbeat`), not a clock slot. In-app only
— no WeChat push exists in this codebase. Record:
[docs/ai-persona/07-proactive-messaging.md](docs/ai-persona/07-proactive-messaging.md).

- Dispatcher "Scan 0" (`getCheckinPeriod()`, `dispatchToWorker()`) selects Viva-channel users
  with an `active` plan whose schedules for today are **scoped to that plan** (`s.plan_id = np.id`
  — superseded plans share dates), honours `users.preferences->>'daily_checkin_enabled'`, and
  dispatches `checkin.daily` CloudEvents to the **worker**, never the legacy `agent` function
  (which hardcodes "You are Nano"). Same-tick dedupe against the `user_online` scan via
  `checkinUserIds`.
- **The slot is claimed atomically before any slow work.** `migration_checkin_dedup.sql` adds
  `notifications.checkin_date` + a partial unique index on
  `(user_id, notification_type, checkin_date)`; `handleDailyCheckinEvent` opens with
  `INSERT … ON CONFLICT DO NOTHING RETURNING id` and returns if it loses. Without this, repeated
  foregrounding produced 2–3 duplicate messages per period (live bug, 2026-07-31).
- The claim row starts `status='claiming'`, **not `'pending'`** — the 3s poll would surface an
  empty pending row as a blank bubble and burn the slot. It flips to `'pending'` with content on
  success, `'failed'` on error.
- Content is a **single lightweight `qwen-plus` completion** (`prompts/viva/systemDailyCheckin.js`,
  one template parameterized by `period`), no agentic loop, no action parsing, no JUDGE. The
  most-elevated sub-age is picked **in code**, from `bioage_profile.SubAges` (never
  `data.actual`). Saved via `saveChatMessage(…, 'viva')` + a `notifications` row. No frontend
  changes.

## 30. Deploy DNS Workaround — `scripts/dns-override.js`

Ported 2026-08-08 from the sibling GCN repo (`/Users/pin/waven/gcn/scripts/dns-override.js`), which hit and fixed the identical issue for its own Aliyun FC deploys.

`s <fn> deploy` can fail with `getaddrinfo ENOTFOUND resourcemanager.aliyuncs.com` (or another `*.aliyuncs.com` host Serverless Devs resolves during deploy) — confirmed 2026-08-08: the system DNS resolver returned nothing for `resourcemanager.aliyuncs.com` while `nslookup resourcemanager.aliyuncs.com 8.8.8.8` resolved it fine. This is local/ISP DNS resolver flakiness, not an actual outage or a code/config problem — safe to reach for whenever this specific error shows up, no need to diagnose further first.

`scripts/dns-override.js` works around this **without touching any system/network settings** — it's a `--require`-loaded Node module that monkey-patches `dns.lookup` in that one process only, using `dns.Resolver` (Node's own c-ares client, independent of the OS resolver) pointed at `8.8.8.8`. Nothing persists after the command exits.

```bash
source .env && NODE_OPTIONS="--require ./scripts/dns-override.js" s worker deploy -t s-prod.yaml -y
```

Substitute the function name / `-t s-prod.yaml` as needed for other functions or the dev target.

## 31. Health-Plan-Focus-Linked Formulation & the GCN Custom-Formulation Bridge — Rules

A user's active health-plan **focus** (`health_plans`) biases which Dots their formulation
emphasizes, a committed formulation links back to the focus that shaped it, and a webview
`context` payload carries purchase intent through the GCN SSO handoff. Record (with its
superseded parts marked): [docs/architecture/health-plan-system.md](docs/architecture/health-plan-system.md).

- **Weighting is soft, never exclusionary.** `_resolveCandidateDotKeys(activeHealthPlans,
  dotsFormulary)` unions `health_plan_templates.recommended_dot_ids` (stores `key_name` strings
  — §11) across active focuses, or `null` for "no narrowing". `_fallbackCountForDot(dot,
  isRecommended)` lifts a recommended dot to 75% of its own range, 25% when a focus is active
  but the dot is off-list, midpoint with no focus — **never zeroes a non-recommended dot**. The
  agentic prompts say the same (`focusWeightingSection`). §40's food-sensitivity gut-axis dots
  ride this same additive channel — union, never replace.
- `nutrition_plans.primary_health_plan_id`/`secondary_health_plan_id` (nullable FKs,
  `ON DELETE SET NULL`) record the focus at formulation time; `handleGetHealthPlanDetail`
  returns a `formulation` field (day-0 dot breakdown of the plan linking back to *this* focus)
  or `null`, which the plan-detail overlay renders as chips or a "run Formulate Dots" hint.
- `users.custom_formulation_purchased_at` is nano's **entire** signal that a user ever bought a
  custom formulation, set by GCN via `POST /formulation-purchase-confirmed` (plain UPDATE). Since
  §28d the live order list comes from `fetchFormulationOrders`; don't build on this timestamp
  for anything order-shaped.
- **`webview_tokens.context` (JSONB)** carries an arbitrary intent
  (`{intent:'buy_custom_formulation', nutrition_plan_id}`, `'view_product'`,
  `'redeem_formulation_code'`, …) from the miniapp's `openUserApp(path, context)` →
  `POST /webview-token` → `POST /exchange-webview-token` → GCN's `dashboard.html` verbatim. **A
  new intent is a new `context` shape, not a new endpoint.**
- `GET /formulation-checkout-snapshot?planId=&openid=` (`GCN_ALLOWED_PATHS`) validates a purchase
  against the buyer's real recipe — `openid` is what GCN resolved from its own SSO session, never
  trusted client input. Always 200 with `{valid, reason}`; callers branch on `valid`. Day 0 is
  read because it is never an N7 isolation day.
- **Superseded, do not resurrect:** `handleNutritionTopupEvent` and `_commitNutritionPlan` were
  removed 2026-08-28 (§28 — nothing creates a plan on a timer); nothing on the server emits
  `formulation_reorder_ready` any more (the client still lists it in `AI_ECHO_TYPES`, harmless).
  `/health-plan-templates` is **not** in `GCN_ALLOWED_PATHS` today.

## 32. Shared PolarDB Cluster with GCN — Rules

**Cluster `pc-uf6ttj5kse63r270k` is not nano-exclusive**: it hosts `nano_db`/`nano_db_dev`/
`nano_db_test` **and** GCN's `gcn_db`/`gcn_db_dev` (same public endpoint, different database
name). Either side's connection behaviour can take the other down — on 2026-08-16 nano's
unbounded pools (181 of 227 backends) locked GCN prod out. Incident record:
[docs/deployment.md](docs/deployment.md) (appendix).

- **Every `new Pool({...})` in all five `db.js` copies** (`worker`, `dispatcher`, `agent`,
  `lab`, `kino`, both the `DATABASE_URL` and discrete `DB_HOST` branches) carries
  `max: 5, idleTimeoutMillis: 10000`. Never add a pool without it. `worker/lib/estimator/db.js`
  is Tablestore, not Postgres. The MCP function uses `max: 2` (§41).
- PolarDB Serverless scales on **CPU% only** (`ScaleMax: 4`, threshold 85); a pile of idle open
  connections is invisible to it. The per-container cap lowers but does not remove the ceiling
  (~200 connections at 1 PCU); no FC concurrency cap was added.
- **If connections fail again, first run `pg_stat_activity` grouped by `usename`/`datname`** on
  this cluster — nano and GCN are neighbours on shared infra.

## 33. Multi-Phone & Email Identity — Rules

A user can hold several verified phones (`user_phones`) and, on Waven-root channels, several
verified emails (`user_emails`), and log in with **any** of them. Full detail:
[docs/architecture/multi-phone-system.md](docs/architecture/multi-phone-system.md) (§6 for email).

- **`users.phone`/`phone_verified_at` are a denormalized cache of the primary row**, never a
  second source of truth — every phone-changing path calls `syncPrimaryPhone`
  (`handlers/users.js`, `phone-otp.js`, `login.js`).
- **Login matches through `user_phones`, not `users.phone`** (`handlePhoneOtpVerify`) — any
  verified phone resolves to the same account, including an admin-added unverified one once a
  real OTP succeeds (known cosmetic gap: that row's `verified_at` is not set retroactively).
- `POST /admin-phone-add` attaches a number with no OTP proof, so it is gated by
  `requireAdminTab(adminCtx, 'users')`, **not** under `/phone-otp/`'s bearer exemption. The
  pencil-icon `UserModal` is read-only for phones; the Phones tab in `UserDetailModal` mutates.
- **GCN's `handleNanoSSO` resolves by `nano_user_id` first**, phone only as fallback, and mirrors
  nano's **full** phone list into GCN's `user_phones`, reconciled exactly; `partners.phone` is
  synced via `syncPartnerPhoneFromUser` from every phone-changing call site.
- **Email** (2026-09-15): `handlers/email-otp.js` mirrors `phone-otp.js`; DirectMail
  (`lib/email.js`, sender `DM_ACCOUNT_NAME` — empty logs the code instead of sending) only
  delivers; nano owns the code lifecycle (`lib/email-otp.js`, `email_otp_codes`). Allowed by the
  channel **root** (`resolveRootChannelKey`), deliberately not `GCN_LINKED_CHANNEL_KEYS`. No
  backfill of legacy `users.email`. `WEBVIEW_USER_SELECT` now returns `email_verified`, `emails[]`
  and `channel.root_key_name` — the last **arms GCN's channel/sector guard**, so verify an
  `aeviva-china` user still enters `aeviva.gcn.net` after deploying it.
- **GCN linkage is resolved through the channel tree** (`lib/channels.js` `resolveGcnSector`,
  `GCN_SECTOR_FOR_ROOT_CHANNEL = {aeviva, waven}`; admin panel `gcnSectorForChannel`; miniapp
  `GCN_STORE_HOST_FOR_CHANNEL`). The six `GCN_LINKED_CHANNEL_KEYS` copies are gone; don't
  reintroduce a leaf-key set. `fetchFormulationTiers(sector)` carries the sector.

## 34. Digital Twin Terminology & Layer Taxonomy — Rules

"Digital Twin / 数字孪生" is the umbrella for a user's **entire** health model — never a single
data source. Canonical definition: [docs/architecture/digital-twin.md](docs/architecture/digital-twin.md).

| # | ZH | EN | Backing |
|---|---|---|---|
| 1 | `精准检测` | `Precision Testing` | `biomarkers(kino_chip)`; `health_twin.latest_bio_age/latest_sub_ages` |
| 2 | `日常监测` | `Daily Monitoring` | `health_events(sleep\|activity\|vitals\|body_composition)`; `health_twin.avg_*`, weight/BMI/body-fat, `trend_data` |
| 3 | `医疗记录` | `Medical Records` | `health_reports`; `health_events(lab_result)`; `health_documents`; `health_twin.latest_lab_data` |
| 4 | `个人档案` | `Personal Profile` | `users.bio_data`; `questionnaire_responses`; `user_memory_facts` |

- **Interventions are deliberately not a layer** (`health_plans`/`nutrition_plans` own the Plans
  tab). **Any new health data surface must declare its layer**; if it fits none, question the
  surface rather than add a fifth.
- **Coupling rule** — these names change in four places together: `TWIN_LAYER_LABELS` + the
  `t.layer*` keys in both language blocks of `components/user-health/user-health.js` (WXML has no
  key checking — a renamed key renders empty), `prompts/chat/twinVocabulary.js`'s
  `getTwinVocabBlock()`, `src/web/user-app/src/i18n/health.js` (generated — `npm run sync:i18n`), and the layer table in
  `digital-twin.md`. The miniapp keeps the `KINO` brand in the layer-1 label.
- Ring/BP/weight data must render **ungated** by `subAgeList.length` — a bound ring with no Kino
  scan previously showed none of the user's own data.

## 35. Viva AG — External Deep-Analysis Agent — Rules

An *external* agent spends minutes-to-hours on a user's full digital twin (including uploaded
records), pulling jobs from a nano-owned queue and posting results back into chat. Full record,
design and the verbatim historical §35: [docs/architecture/viva-ag.md](docs/architecture/viva-ag.md).
Nothing in §21–§29 applies — that machinery is for work nano performs itself.

- **Entitlement is an add-on column, not a persona.** `users.viva_ag_expires_at`, gated by
  `requireVivaAgAccess()` (`lib/vivaAgAccess.js`) — a composite of effective-persona-is-viva
  **and** a live Viva grant **and** a live AG grant, so AG can never be more permissive than the
  chatbox. `resolveEffectivePersona()` must keep returning `'nano'|'viva'` only. A `viva_ag`
  subscription plan grants **both** windows (§36). Grants audit into
  `persona_subscription_grants` with `persona_type='viva_ag'`.
- **No EventBridge, no cron.** Enqueue is one INSERT; the slow work is inside the agent; delivery
  is two INSERTs inside the agent's own `POST /result`. Lease expiry is swept lazily
  (`_sweepExpiredLeases()` at claim and at the user's job list). If that ever bites, add a scan to
  the dispatcher tick — not new infrastructure.
- **The fencing token is the whole concurrency story.** `result_token` is regenerated on every
  claim and is both the submission credential and the idempotency key, checked **before** status.
  The claim is one `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1)` — never a
  SELECT then an UPDATE. `uniq_viva_ag_jobs_active` caps one in-flight job per user and **must
  include `awaiting_input`**; `viva_ag_jobs.status` has no CHECK, so that index is the migration's
  real work. Plus a 3/day cap in the enqueue handler.
- **`VIVA_AG_API_TOKEN`** (`vag_` + 32 hex, distinct per environment): its branch in
  `worker/index.js` **must precede the `ch.` branch** (prefix match); exact-path allowlist only,
  no path params. The per-job token rides in `X-Viva-Ag-Job-Token` on GET and the body on POST —
  **never a query param** (they land in access logs). No `/viva-ag/*` response ever returns a
  `user_id`, openid or nickname; `job_uid` is the only handle; there is deliberately no
  "twin for an arbitrary openid" endpoint. (Known overstatement: presigned document URLs embed
  `user_id` in the OSS key path — see §39.)
- **The API documents itself**: `GET /viva-ag/docs` + `/openapi.json` read from
  `worker/docs/viva-ag-{api.md,openapi.json}`, which deploy with the function. Keep the spec's
  paths and `VIVA_AG_ALLOWED_PATHS` in agreement in both directions.
- **Large files never pass through FC.** Every download is a direct presigned OSS GET. **This
  bucket refuses `response-content-type` overrides** (400, not a degrade) — Content-Type is fixed
  at upload; callers must PUT with exactly the `put_content_type` the presign returned.
  `generatePresignedGetUrl` sets `Content-Disposition` (RFC 5987) only; don't re-add a
  content-type override.
- **Report files: `pdf` / `md` / `txt` only.** `wx.openDocument` cannot open markdown, so `md`/
  `txt` render in-app via `mdToHtml()` — which deliberately does **not** interpret `:::` cards,
  and `_neutralizeLinks()` flattens `[text](href)` (mp-html's `linkTap` would `wx.navigateTo`).
  Every submitted key is prefix-confined to `viva-ag-results/{job_uid}/`, type-checked and
  `headObject`-verified; any failure refuses the whole submission. Client addresses files by
  index; `oss_key` never leaves the server. `result_oss_key` is still written for legacy readers;
  `result_files` is the source of truth.
- **`dots_formulation` is a contract** (§8 of `viva-ag-api.md`), mirrored from
  `lib/dotsProductModel.js`; since §36 nano validates it and rejects non-conforming formulas.
- **`health_documents`, not `health_reports`** — twin layer 3 (§34). Soft delete only (a running
  job may hold a URL). Never route documents through `/oss/presign` (it authorizes nothing).
  Keys are minted server-side under `health-documents/<user_id>/`, registration rejects keys
  outside the caller's prefix, `oss_key` is never returned, URLs expire in 300s. Endpoints are no
  longer AG-gated (§38) — that gate was entitlement, never access control.
- **Result delivery**: `deliverTerminalMessage` writes both `chat_messages` and `notifications`,
  saved under `persona_type='viva'` — **never `'viva_ag'`** (persona-scoped history would hide
  the bubble on reload). Attribution is `chat_messages.source='viva_ag'`, selected in all three
  `handleGetChatHistory` queries. `'viva_ag_result'`, `'viva_ag_failed'` and
  `'viva_ag_questionnaire'` **must stay in `AI_ECHO_TYPES`**. `result_summary` is sanitized on
  ingest (`:::` stripped, dot codes humanized); never feed `viva_ag_jobs.result` to a later prompt
  as trusted content.
- **`lib/twinBundle.js` is AG-only, on purpose** — its SQL duplicates `agenticTools.js` and the
  `llmContext` builders, and unifying them would touch the contract 20+ prompts and JUDGE consume.
  Conventions: fetchers never throw, biomarkers from `data.validated`, timestamps through
  `formatToShanghai()`, **`DATE` columns cast `::text`** (node-postgres parses a DATE at local
  midnight → wrong day). `bundle_version` is 3 (v2 added `job_questionnaires`, v3 added
  `layers.medical_records.food_sensitivity`).
- **Clarifying questionnaires** (`POST /viva-ag/jobs/questionnaire`, status `awaiting_input`):
  the lease is released, the attempt refunded, rounds capped at 2. `lib/agQuestionnaire.js` is a
  **security boundary** — `save_target`/`save_field`/`completion_check`/`config.other_key` are
  never sourced from the payload (they are write paths into user data). The resume hook is
  injected from `index.js` and **awaited**. The user answers in the chat tab.
- **Miniapp**: subtab strip inside `components/user-health/`, panel in
  `components/viva-ag-panel/`, self view only. `wx.chooseMessageFile` needs the 「选中的文件」
  scope declared in the MP console's 用户隐私保护指引 — no runtime consent flow can rescue a
  missing declaration; `_choosePdf()` distinguishes cancel / scope error / other. **Never re-add a
  bare `fail: () => {}`.** Neither picker is automatable; drive `_uploadDocument` directly. Job
  polling is a 15s timer inside the panel, not `main.js`'s 3s poll.

## 36. AI 精准营养素 — the AG Dots Ordering Flow — Rules

One GCN purchase → `awaiting_formulation` → grants viva + viva_ag → AG `dots_formulation` job →
nano validates → GCN expert review → `POST /ag-formulation-approved` → `nutrition_plans`
`'approved'` → user scans the box → 56 schedules, `'active'`. Record:
[docs/architecture/ag-dots-ordering.md](docs/architecture/ag-dots-ordering.md).

- **Nano parses and validates the AG formula** (`lib/agFormulation.js`) — reversing §35's
  original "never" — because approval turns it into capsules. **Reject, never repair**: no
  clamping, no recomputing `total_dots`. Pure functions over `(parsed, dotsFormulary)`, no I/O.
  `result.formulation` (JSON) is the contract; the `.md` is a fallback. The job still succeeds
  either way; the response carries `formulation_accepted` + violations.
  `worker/docs/viva-ag-api.md` §8 must be edited alongside the rules.
- **Constants live in `lib/dotsProductModel.js`** (`PLAN_DAYS`, `MAX_DOTS_PER_CAPSULE`, `N7_KEY`,
  `N7_ISOLATION_DAY_INDEXES`) and bind `lib/formulation.js`, the validator, and API doc §8.
- **`'approved'` is created on approval with zero schedules and activated on scan** — not a
  reuse of `'pending'`. `_commitAgFormulation` is a deliberate **sibling** of the expansion
  path, not a reuse: an AG formula encodes all 56 capsules explicitly, so running it through
  `_expandPlanDay` would apply every rule twice. Capsules are written verbatim; the fill cap is
  re-applied defensively only. Don't merge the two.
- **`POST /box-claim`**: idempotent (a second scan returns the first plan), non-transferable
  (`not_your_box`), a second box from the same batch joins the existing plan; accepts a bare
  `WVB…` code or the public page URL. `box_batches.ag_formulation_id` snapshots from the
  approved formulation, not the user's active plan.
- **A `viva_ag` subscription plan grants BOTH windows** (`requireVivaAgAccess` is a composite);
  two `persona_subscription_grants` rows. `product_type` on `viva_subscription_plans`/`_codes`,
  snapshotted at mint; no new endpoint.
- The review stays in GCN; nano exposes `GET /ag-formulation-review-snapshot`. Both review
  snapshots share `_buildReviewTwinContext`. **An expert's adjustment is re-validated by nano**
  through the same validator — "a human approved it" is not a reason to skip the only check.
- Order side (GCN): flat-priced bundle, nullable `nano_nutrition_plan_id`/`recipe_snapshot`,
  new `awaiting_formulation` status (not `'paid'`, which `handleOrderShip` accepts).
  `recipe_snapshot` stays **write-once**; expert edits go to `adjusted_recipe`. Cross-repo
  notifies are fire-and-forget both ways; a `valid` formulation with NULL `gcn_order_id` is the
  query for ones that didn't land — there is no retry job.

## 37. AI Store-Product Recommendation — Rules

Viva can suggest a GCN storefront's **non-Dots** products inside a health conversation. Reactive
only; it never volunteers one. Record:
[docs/architecture/store-product-recommendation.md](docs/architecture/store-product-recommendation.md).

- The essential block's "Dots formulary only / no purchase channel" rule is **narrowed, not
  removed**: formulary **or** a catalog explicitly provided in this prompt. Three sites change
  together (§26): `knowledge_entries` rows (`migration_knowledge_store_products.sql`),
  `FALLBACK_ESSENTIAL_BLOCK`, `factConstraint.js`. The company-business-info ban (prices,
  stock, delivery, promotions) is untouched.
- **Never feed `products.description` to the model.** The reviewed record is GCN's
  `product_ai_profiles` (`sub_age_targets` uses §11's canonical keys; `ai_recommendable` is
  admin-only and rejected without `reviewed_by`; a supplier write omits the flag rather than
  defaulting it false).
- **Reactive-only is structural**: the catalog is fetched only when the intent classifier's
  `required_data` includes `store_products` and the channel resolves to a GCN sector
  (`resolveGcnSector`). A classifier miss is the desired failure mode — no catalog, no
  vocabulary, rule collapses back to Dots-only.
- **The model picks, the server writes.** The `recommend_product` tail carries `sku_id` + one
  sentence; `_validateProductRecommendations` drops unknown ids silently;
  `_buildProductCardBlock` renders `:::product` from the same snapshot. **Prices are never shown
  to the model** — a number it was never given cannot leak.
- **Allergies are a code filter** (`_filterProductsByUserFacts`, before the catalog is rendered;
  bidirectional substring, biased toward over-suppression), not a prompt rule.
- PLAN and JUDGE are taught the tail; `detectFakeStoreProduct` covers a product named in prose
  but never picked. `detectAllRisks(reply, dotsFormulary, storeProducts)` — both call sites pass
  all three.
- Tap-through: `handleProductCardTap` → `_openAevivaStoreGated({intent:'view_product', sku_id})`
  → GCN's existing `?sku=` opener, which must `await loadMall()` first. A native handler is
  mandatory — chat prose cannot open an external link.
- Catalog is per-user and **store-scoped** (GCN `/api/mall/nano/ai-catalog`, via
  `partner_bindings` `consumer_store`, delegating to `handleStoreItems`); always 200, `{items:[]}`
  on any failure; `fetchAiCatalog` never throws, 4s limit. Every SKU with its own purchase flow
  (`is_custom_formulation`, `is_ag_formulation_bundle`, `viva_subscription_plan_key`,
  `grants_partner_type`, `package_only`, `is_parent`) is excluded.

## 38. 健康文档 — Health Documents Are Twin Data — Rules

`health_documents` is twin layer 3 (§34), not an AG artifact: the 数字孪生 subtab ends with the
same 健康文档 section the AG panel has, and the endpoints ask only who the caller is. Record:
[docs/architecture/health-documents.md](docs/architecture/health-documents.md).

- **One component, two hosts**: `components/health-documents/` is extracted from
  `viva-ag-panel`, not copied into `user-health`. No `variant` prop; it carries its own root
  theme hook (the `.theme-light` class doesn't cross the component boundary) and a `lang`
  observer (the health tab is never unmounted).
- **A coach reads, never writes**: `can-upload="{{mode === 'self'}}"` hides upload/delete and
  `deleteDocument` re-checks it; `coach-id` reaches the server, where `_resolveOwner` runs the
  same coarse `users.coach_id` ownership check as `handleGetUserFacts`, only when supplied.
  `this._coachId` in `coach.js` must be mirrored into `data.coachId` at **both** assignment
  sites (`onLoad`, `_repairCoachSession`). `_refuseCoach` is intent, not enforcement.
- **The AG gate was entitlement, never access control** — it never stopped one user passing
  another's openid. What protects the object is unchanged: server-minted keys under
  `health-documents/<user_id>/`, `oss_key` never returned, 300s URLs, never via `/oss/presign`.
  Keep `health_documents.js`'s security header honest if the gate changes again.

## 39. Document Extraction — a Second External-Agent Queue — Rules

An uploaded 健康文档 is read by an external agent (`DOC_EXTRACT_API_TOKEN`, separate service from
Viva AG) and turned into twin data. Full record and every bug behind each rule:
[docs/architecture/doc-extraction.md](docs/architecture/doc-extraction.md).

- **Separate queue from `viva_ag_jobs`**, not a `job_type`: no entitlement, one job per
  **document** (`uniq_doc_extraction_active`), seconds not hours. Everything structural is
  mirrored from `handlers/viva_ag.js` (SKIP LOCKED claim, rotated `result_token` checked before
  status, lazy sweep, no EventBridge). `dex_` + 32 hex, distinct per environment, branch **above
  the `ch.` branch**, exact-path allowlist, job token in `X-Doc-Extract-Job-Token`/body, never a
  query string.
- **Known pseudonymity gap** (found live 2026-09-09): presigned document URLs are
  `health-documents/<user_id>/…`, so the agent can link two documents to one person — on
  `/doc-extract/jobs/claim`, `/viva-ag/twin-bundle` and `/viva-ag/document-url` alike. Fixing it
  means opaque keys **and** replacing `handlePostHealthDocument`'s prefix-confinement check, which
  works precisely by requiring the user_id in the key. Not a one-liner; not attempted.
- **Reuses `handlePostHealthReport`** (`source:'document_extraction'`), then **calls
  `updateHealthTwin` itself, awaited** — without that the panel never reaches
  `health_twin.latest_lab_data`. **`compute_bioage:false` is load-bearing**: an OCR'd document
  must never manufacture a BioAge (it would stamp `NOW()` and let `BiomarkerEstimator` fabricate
  the absent Kino markers). A test pins it.
- **`lib/docExtraction.js` rejects, never repairs.** Pure, no DB; also backs
  `POST /doc-extract/validate`. Its rules exist because the path it feeds doesn't check them:
  finite value (bare `parseFloat` downstream), unit matches the catalog or a hand-authored
  conversion (the model's unit otherwise overrides the catalog's), 0.1x–100x plausibility against
  `ref_low`/`ref_high` (loose on purpose — several `ref_high` are risk thresholds), the date
  parses (`report_date` otherwise backfills to today). No readable date → metadata and summary
  only, **no observations**.
- **Findings go to `user_memory_facts` (`category='condition'`, `source='document_extracted'`),
  never `users.bio_data`** (shallow `||` merge would replace `health_conditions` wholesale).
  Higher confidence floor than observations; refused without one.
- **A re-run clears the previous extraction first** — `health_events` dedupes on
  `(user_id, source, external_id)` with `DO NOTHING`, so a correction would otherwise no-op.
  `DELETE /health-reports` deletes `health_events` children explicitly (`report_id` is
  `ON DELETE SET NULL`). `'rejected'` is terminal and distinct from `'failed'` — never recreate
  what the user threw away.
- **Contract self-documents**: `GET /doc-extract/{docs,openapi.json,catalog}` +
  `POST /doc-extract/validate`. `tests/doc-extraction-contract.test.js` asserts spec paths ↔
  allowlist both ways, that the worked example validates against the real catalog, and that
  units/limits/reason codes match code. **Change an endpoint, limit or reason code → change
  `worker/docs/doc-extract-{api.md,openapi.json}` in the same commit.** Anything outside the
  catalog belongs in `unmapped`, never mapped onto a neighbour.
- `'doc_extraction_result'` is in `AI_ECHO_TYPES` (a type missing there renders the bubble twice). **Deploy order: migrate, then
  the worker.**

## 40. 慢性食物过敏 — Food-Sensitivity Panels — Rules

A 120-item food IgG report arriving through §39 takes its own path: `food_catalog`,
`food_sensitivity_panels`, `food_sensitivity_results` → a deterministic guideline in
`user_memory_facts` → chat tool + formulation emphasis → a free Viva AG review. Full record:
[docs/architecture/doc-extraction.md](docs/architecture/doc-extraction.md) §40.

- **Never `health_events(lab_result)`.** `healthTwinUpdater` keeps only the single most recent
  lab date (a food panel would evict hsCRP/LDL/eGFR), `biomarker_catalog` ranges mean something
  else, and a food's payload is a substitute, not a number. `food_key` follows §11's `key_name`
  rule — an unresolved item is **dropped and counted**, never guessed onto a neighbour (`aliases`
  exists for OCR spelling variants).
- `<0.1` is `below_detection:true` with a NULL value, never 0.1. The class is **read**, not
  derived (only bands with results are printed); a printed band is a cross-check
  (`class_band_mismatch`). An absent class is refused — `Number(null)` is 0.
- **⚠ A food-named fact can silently delete a dot.** `formulationQuality._collides` is
  bidirectional substring containment and `allergy_conflict` removes the dot from both recipes
  (`玉米` matches `玉米黄质` → deletes DOT-N8). So a fact carrying `food_key` matches only
  `food_catalog.dot_conflict_keys`, which is **empty for every seeded row** by design. A fact
  without a `food_key` keeps the prose match. **Do not close this by widening the prose match.**
  Known, pre-existing: `_ingredientNames` maps JSONB via `v.map(String)` → `"[object Object]"`,
  so the check only ever compares dot *names* today; fixing it will start deleting dots that pass
  now — measure first, keep the `food_key` guard.
- **The guideline is derived in code, never submitted.** `CLASS_WINDOWS` in
  `lib/foodSensitivity.js` transcribes the report's own 戒断方案 page. Each class ≥ 1 food → one
  short canonical fact: `category='dietary_restriction'` (**never `allergy`** — IgG is not IgE),
  `fact_zh` stays short (`避免牛奶` — it is rendered uncapped into ~14 prompts and per the hazard
  above a long sentence swallows ingredient names), window/recheck/substitutes live on the panel
  and catalog, never inside `fact_zh`. Class-0 foods are never facts. `valid_until`/`severity`
  are nullable, so existing facts are unchanged.
- **Chat**: `get_food_sensitivity`, force-queued by `messageAsksAboutFoodSensitivity`, which also
  promotes `casual_chat`/`formulate_dots` → `nutrition_question` and **must never match the
  Formulate-Dots trigger message** (test pins both). Same three §28 chat-tool rules: flat array
  with `kind` per row, dates as bare `YYYY-MM-DD` via `::text`, and **the block names no class
  threshold and no window** (they reach the model as `severity_text`/`guidance` on the row; a
  test asserts no month figure in the rendered block). No degraded branch — these are nano's
  own tables.
- **Formulation**: a live panel unions `DOT-N13` and `DOT-N14` (`GUT_AXIS_DOT_KEYS`) into
  `recommended_dot_keys` — §31's purely additive channel, **union never replace**, only
  unexpired restrictions count. Both formulation prompts state that the 5R protocol's enzymes,
  betaine HCl, L-glutamine and EFAs exist in **no** dot.
- **Review**: preset `food_sensitivity_review` auto-queued on a successful panel write, on a
  free scoped grant that audits as such. The restrictions are written **before** the job exists,
  so a failed review costs an explanation, never the guideline. **It will not flip a nano user's
  persona** — a user not already effectively Viva simply gets no review.
- `lib/extractionPrimitives.js` holds the date/number coercions shared with `docExtraction.js`.
  **GCN: nothing.** Deploy order: migrate, then the worker.

## 41. MCP Server — Read-Only Data Access for the Analysis Workshop (2026-09-15)

`src/functions/mcp/` (`nano-mcp-dev`, `https://nano-dev.gcn.net/mcp`) exposes **both** dev
databases — `nano_db_dev` and `gcn_db_dev` — to MCP-compatible clients as five tools:
`waven_get_data_map`, `waven_list_tables`, `waven_describe_table`, `waven_search_columns` and
`waven_query` (one `SELECT`-shaped statement, row-capped). Bearer `MCP_API_TOKEN`. Deploy with
`npm run deploy:mcp`; run locally with `npm run mcp:local`. Full detail, including why the
Streamable HTTP transport is hand-rolled on FC's event-function model:
[docs/architecture/mcp-server.md](docs/architecture/mcp-server.md).

Three rules, each load-bearing:

- **Dev only, by construction.** `lib/db.js` refuses any database whose name does not end in
  `_dev`, and `s-prod.yaml` has no `mcp` block. Do not add an env switch to reach prod — that
  needs a read-only Postgres role and its own decision.
- **Every query runs inside `SET TRANSACTION READ ONLY`** (`withReadOnly()`), catalog lookups
  included. `lib/sql-guard.js` is the second layer (single statement, allowed leads, no
  `FOR UPDATE`/`pg_sleep`/`lo_*`/…); Postgres is the one that actually refuses writes.
- **Pools stay at `max: 2`.** Same cluster as GCN prod (§32).

**Scope is the whole of each dev database.** It connects as `nano_admin` / `gcn_admin` — the
application accounts — so every table, including `users.phone`, openids, chat text and GCN's
`ledger`, is readable; there is no allowlist and no masking. Narrowing it, if ever wanted, means a
read-only Postgres role with column-level `GRANT`s, not more regexes in the guard.

`lib/data-map.md` is what the model reads first — the cross-database join keys
(`gcn.users.nano_user_id` ↔ `nano.users.user_id`, `order_item_custom_formulations.nano_nutrition_plan_id`
↔ `nutrition_plans.id`, `partners.nano_partner_id`, `sectors.owner_nano_channel_id` ↔
`channels.key_name`) and the naming traps (§11's `key_name` rule, §17's `validated`-not-`actual`
rule, GCN's "no `stores` table"). Keep it current when a cross-repo key is added.

## 42. Check-in Programs (打卡计划) — Multi-day Curricula in the Chat Tab — Rules

A program is a per-day curriculum (Day N = an Academy lesson + a 打卡 questionnaire), worked
through sequentially, at most one day per Shanghai calendar day, entirely in the chat tab. Record:
[docs/architecture/programs.md](docs/architecture/programs.md).

- **A coach activates a program for a client they manage — no auto-enrollment.**
  `POST /programs/enroll {coach_id, openid, program_id}` (coach app → client → 方案 → 打卡计划)
  is the only thing that creates `program_enrollments`, stamped `activated_by_coach_id`, gated by
  the same `users.coach_id` ownership check as `handleGetUserFacts`; it delivers Day 1 inline.
  `program_channels` only scopes which coaches may offer a program (bound channel **or any
  sub-channel** via the recursive tree walk; no bindings = every channel). The dispatcher's
  Scan P reads `program_enrollments` only and never creates one.
- **New `program_*` tables, never `health_plans`.** A focus has the same three tasks every day,
  week semantics and two slots; a curriculum has none of those. Everything around it is reused:
  Academy for lessons (`POST /academy/progress` is the "watched" write, hooked by
  `lib/programs.js` `markLessonWatched`), the questionnaire engine for answers, the daily
  check-in's atomic claim for delivery, `:::` cards for the UI.
- **One program-day per Shanghai date**, three predicates in the dispatcher's Scan P and mirrored
  by `isDayOfferable()`: no open day (`completed_at IS NULL` — a missed day pauses, never skips),
  nothing offered or completed today, and the `(user, 'program_day', checkin_date)` notification
  claim. Every "today" is `(NOW() AT TIME ZONE 'Asia/Shanghai')::date` in SQL; DATE columns read
  `::text`; the client gets `today` from `/programs/my` and never computes it.
- **The 打卡 assignment is created lazily, on 开始打卡** (`POST /programs/day/start-checkin`) —
  never at offer time: `handleGetPendingQuestionnaires` has no type filter and the miniapp
  auto-starts every pending assignment on app open. And **no `questionnaire_ready` row** for it —
  the miniapp calls `_checkForPendingQuestionnaire()` itself; a poll-driven second call would
  start the same form twice.
- `:::lesson` / `:::checkin` are **server-written only** (`buildProgramDayCard`). The lesson row
  carries the Academy lesson id and nothing else; the URL is presigned per tap and the done-state
  is runtime (`_attachProgramState` ← `GET /programs/my`), so no signed URL or stale flag ever
  sits in `chat_messages`.
- `program_day`, `program_day_summary`, `program_day_comment` are dual-written and **must stay
  in `AI_ECHO_TYPES`** (`tests/static-invariants.test.js`). The recap is deterministic
  (`renderSummaryTemplate`, `{{key}}` / `{{key.before}}`, values sanitized); the comment is one
  `qwen-plus` completion, no agentic loop, no JUDGE, and its failure costs only the comment.
- `tryCompleteDay` is the **only** thing that closes a day and advances `current_day` — one
  guarded UPDATE, so the questionnaire completion and the lesson-ended hook cannot both win.
- `migration_programs.sql` **must keep its `@requires`** on the questionnaire migrations — it
  sorts before the files that re-add `questionnaires_type_check`. `program_day` is deliberately
  not in the admin panel's `ASSIGNABLE_TYPES`; a hand-assigned copy completes into nothing.
- `time_picker` is the sixth questionnaire input type (`"HH:mm"`); it is accepted by
  `lib/agQuestionnaire.js` too, so `worker/docs/viva-ag-{api.md,openapi.json}` list it.

## 43. Per-User Health Report — `health-report` skill (2026-09-16)

A 50+ page, chart-rich, Chinese PDF that fuses **everything** a user has — every uploaded
`health_documents` PDF read in full, Kino/lab biomarkers, BioAge, epigenetic clocks, genome,
microbiome, food IgG, wearables, memory facts, plans, chat — into findings, an anti-aging
interpretation, a Dots recipe, lifestyle/diet plans, a physician summary and a follow-up calendar.
Load the `health-report` skill for any "health report / 健康报告 / analyze user X's data" request;
it holds the extraction and build scripts, the page/chart framework and the reasoning rules. Two
rules it encodes that matter beyond it: the platform's document extractor sees almost nothing in
a genome/IgG/microbiome/glycan report, so **read the PDFs**; and `annual_lab` rows flagged
`legacy` are demo imports that can contradict real results (grade C, exclude, explain).

Published reports are completed `viva_ag_jobs` rows (`claimed_by='claude-code-analyst'`) and
surface on the 数字孪生 subtab's **综合报告 card** (`GET /api/twin-reports`,
`handlers/twin_reports.js` — ownership-gated, not AG-entitlement-gated, files by index) and in the
Viva AG panel.
