# Waven Nano AI Backend

# Project Rules

## 1. Project Context

- **Name:** Waven Nano AI (Precision Health Ecosystem)
- **Tech Stack:** Node.js (Latest LTS), PostgreSQL 14 (Aliyun PolarDB Serverless)
- **Architecture:** Serverless Event-Driven (Aliyun FC 3.0 + EventBridge)
- **Infrastructure:** All production code must respect Aliyun FC 3.0 constraints (max 24h runtime, stateless execution).

## 2. Core Technical Constraints

- **Database:** Use the `pg` library for raw SQL. **STRICTLY PROHIBITED:** No ORMs (like Prisma or TypeORM) to minimize cold-start latency and overhead.
- **SQL Standards:** PostgreSQL 14 compatible syntax. Use `ON CONFLICT` for upserts.
- **Messaging:** Follow **CloudEvents 1.0** standards for all event payloads.
- **AI Logic:** The AI Worker must decouple prompt engineering from execution. Prompts should be stored in `/prompts` as template files.

## 3. Directory Structure & Naming

- `/src/functions/dispatcher/`: FC 3.0 code for user scanning (Cron-triggered).
- `/src/functions/worker/`: FC 3.0 code for AI processing and WeChat notifications.
- `/src/lib/`: Shared logic (Database clients, WeChat API helpers).
- `/src/schemas/`: JSON Schema files for event validation.
- `/src/mini/nano-miniapp/`: WeChat Mini Program frontend (WXML/WXSS/JS, no build pipeline).
  - The **Kino Simulator** is implemented as a native WXML overlay inside `pages/main/` — it is not an iframe or externally loaded resource. All UI, state, and logic live in `main.wxml`, `main.wxss`, and `main.js`. Only the biomarker result data is fetched remotely (`/api/biomarkers`).
  - The simulator iframes in `/src/web/admin-panel` (`/admin/sim/kino/`) are a **separate** web-only thing and unrelated to the miniapp simulator.
- `/tests/mocks/`: Local EventBridge and MNS simulation scripts.
- `/src/web/admin-panel`: **Web Admin Panel** — React (Vite) SPA served by the FC worker. Full superadmin control: users, coaches, dots, store, channels, invites, simulators. Built with `npm run build` inside that directory; output goes to `src/functions/admin-panel/dist/`. Referred to as the **"web admin panel"**.
- `/src/mini/nano-miniapp/pages/admin/`: **Miniapp Admin Panel** — WeChat Mini Program page for channel-scoped admins. Manages users, coaches, store items, and invite codes within a single channel. No build step (native WXML/WXSS/JS). Referred to as the **"miniapp admin panel"**.
- `/src/mini/nano-miniapp/pages/superadmin/`: **Miniapp Superadmin Panel** — WeChat Mini Program page for superadmins. Global view of channels, users, coaches, dots (with full ingredient editing), and invites. Referred to as the **"miniapp superadmin panel"**.
- **File Naming:** kebab-case (e.g., `user-repository.js`).

## 4. Coding Standards (Node.js)

- **Style:** Modern ES Modules (`import/export`).
- **Error Handling:** Every async operation MUST be wrapped in a `try/catch` block.
- **Logging:** Use `console.log` for Aliyun CloudWatch integration, but format as JSON: `console.log(JSON.stringify({level: 'INFO', msg: '...', data: {}}))`.
- **Latency:** Keep the `lib/db.js` client outside the handler to leverage Aliyun container reuse.

## 5. Local Development & Testing

- Use `.env` for local variables. Never hardcode the PolarDB endpoint.
- **Command:** Run `npm run test:local` to trigger the `local-bus.js` harness.
- **Git:** Commit after every successful modular feature build. Do not bundle multiple components into one commit.

## 6. AI Interaction Rules

- Before suggesting a change, check `src/schemas/` to ensure you aren't breaking the event contract.
- If writing a new Aliyun FC handler, always provide the `s.yaml` (Serverless Devs) configuration snippet.
- Prioritize **token efficiency**: Don't rewrite entire files if only one function needs a fix.

## 8. Changelog for code changes

- CHANGELOG.md

## 9. Role System

- 4 roles: `user`, `coach`, `admin`, `superadmin` — stored as `TEXT[]` on `users.roles`.
- A single WeChat openid can hold multiple roles simultaneously.
- Channel scoping is implicit via `users.channel_id`; no separate role-junction table.
- Coach role is auto-managed when `coaches.user_id` FK is set/unset.
- Full details: `docs/architecture/role-system.md`

## 10. The Four Sub Bio Ages

Waven Nano measures biological age across four independent dimensions. Each dimension produces a **sub-age** (in years) that contributes equally to the combined `BioAge`. The calculator lives in `src/lib/bioage/BioAgeCalculator.js`.

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

## 11. Aliyun Function Compute 3.0 (FC 3.0) Runtime Behavior

When writing or modifying FC handler code, use these facts. They were confirmed by live debugging against the deployed function.

### Handler invocation model

FC 3.0 invokes HTTP trigger functions as **event functions**, not as Node.js HTTP server functions. The handler receives:

```
exports.handler = async (req, resp, context) => { ... }
```

- `req` — a plain JS object (already parsed from the raw event Buffer). It is **not** a Node.js `http.IncomingMessage`.
- `resp` — the FC context object. It does **not** have `.send()`, `.setStatusCode()`, or `.setHeader()`. Do not test for `resp.send` to detect HTTP mode.
- Response is sent by **returning** a payload object (see below), not by calling `resp`.

### Event object shape (FC 3.0 HTTP trigger)

```js
{
  version: "v1",
  rawPath: "/notifications",          // ← URL path. NOT event.path
  headers: { "Host": "...", ... },
  queryParameters: { openid: "xxx" }, // ← query string. NOT queryStringParameters
  body: "",                           // base64-encoded if isBase64Encoded: true
  isBase64Encoded: true,
  requestContext: {
    accountId: "...",
    domainName: "...",
    http: {
      method: "GET",                  // ← HTTP method lives here
      ...
    },
    ...
  }
}
```

Key differences from AWS Lambda / FC 2.0 / Express conventions:

| Correct (FC 3.0)                     | Wrong (will be undefined)                                       |
| ------------------------------------ | --------------------------------------------------------------- |
| `event.rawPath`                    | `event.path`, `req.path`, `req.url`                       |
| `event.queryParameters`            | `event.queryStringParameters`, `req.queries`, `req.query` |
| `event.requestContext.http.method` | `event.httpMethod`, `event.method`, `req.method`          |
| `event.headers`                    | `req.headers`                                                 |

### Canonical way to extract path, method, query in a handler

```js
exports.handler = async (req, resp, context) => {
    const event = req; // req IS the event object in FC 3.0
 
    const path    = event.rawPath || '';
    const method  = event.requestContext?.http?.method || 'POST';
    const query   = event.queryParameters || {};
 
    let body = event.body || '';
    if (event.isBase64Encoded && body) {
        body = Buffer.from(body, 'base64').toString('utf8');
    }
    let parsedBody = {};
    if (body) {
        try { parsedBody = JSON.parse(body); } catch (e) {}
    }
 
    // ... routing logic ...
 
    // Send response by returning a payload object
    return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result),
        isBase64Encoded: false,
    };
};
```

### Response format

Return a plain object — do NOT call `resp.send()`:

```js
return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result),
    isBase64Encoded: false,
};
```

### Deployment

- **Always source `.env` before deploying** — `s.yaml` uses `${env(VAR)}` references for all secrets (DB_PASS, DASHSCOPE_API_KEY, WX_SECRET, API_BEARER_TOKEN, OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET). Without sourcing, those vars resolve to empty strings and the deployed function breaks.
- Preferred commands (handle sourcing automatically):
  - `npm run deploy:worker` — deploys only the worker
  - `npm run deploy:dispatcher` — deploys only the dispatcher
- Manual equivalent: `source .env && s worker deploy -y`
- `s deploy` — deploys all functions; prefix with `source .env &&` if used directly
- FC 3.0 does not hot-reload; each deploy takes ~15 s before changes are live

### Local dev vs FC 3.0 parity

`scripts/local-dev.js` bridges Express → FC handler format by wrapping `req.body` in a Buffer and providing a minimal `resp` shim (`setStatusCode`, `setHeader`, `send`). Keep this shim in sync with any response API changes in the worker handler.

## 12. Kino Hardware System

The Kino hardware ecosystem has two distinct physical components, managed separately.

### Kino Device (Reusable)

- Physical reader unit deployed at a clinic or partner location
- Table: `kino_devices` — serial number, name, coach/channel assignment, status (`active` / `inactive` / `maintenance`)
- Every biomarker record ingested via a device stores `kino_device_id` in `biomarkers.kino_device_id`
- Migration: `src/schemas/migration_kino_devices.sql`
- Admin Panel: **Kino** tab

### Kino Chip (Disposable, Single-Use)

- NFC test chip with biochemical reagent layer — one scan per chip
- Chips are issued in **batches**: each batch has a unique 8-digit code (`KNC{8digits}`) and a model (`K2` default, `S1`)
- **Chip code format:** `KNC{8-digit-batch}-{4-digit-sequence}` e.g. `KNC12345678-0001`
  - The chip code IS the QR code value scanned by the Mini Program
  - Max 9,999 chips per batch
- Tables: `kino_chip_batches` (prefix, model, quantity), `kino_chips` (chip_code, status)
- Chip status: `available` → `used` (after scan completed) or `damaged`
- Migration: `src/schemas/migration_kino_chips.sql`
- Admin Panel: **Chips** tab — add batches, view QR codes, download CSV, print

### Scan Flow

```
QR scan in Mini Program → POST /kino-scan (links chip to user)
  → POST /biomarkers (raw values → BioAge calculation)
  → POST /kino-result (marks scan completed, chip becomes "used")
```

Full details: `docs/architecture/kino-system.md`

## 13. Dots System

Waven Dots are 24 mg precision nutrition cartridges. Each cartridge delivers one or more active compounds in an exact dose, calibrated to the user's biomarker profile. The system targets four biological age dimensions measured by the Kino chip. The Dots can be mixed by AI at realtime according to the user's actual health data.

### Cartridge Format

- **Payload:** 24 mg per dot
- **Pack size:** 800 dots per cartridge
- **Timing:** Morning or Evening (fixed per dot — set by the `timing` column in the `dots` table)
- **Types:** Isolates (single active compound) and Blends (two or more actives)

## 14. TEMP Folder
- location: ./temp
- save one time scripts such as migration scripts in the temp folder