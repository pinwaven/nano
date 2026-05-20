# Lab Integration System

`nano-lab` is a dedicated Aliyun FC function that ingests clinical lab results from third-party laboratory systems. It supports both push (lab notifies Nano via webhook) and pull (Nano polls the lab's API on a timer). Both paths converge on the same normalization and storage pipeline, then trigger downstream BioAge recalculation via EventBridge.

---

## Architecture

```
── Push: Lab notifies Nano ──────────────────────────────────────────
Lab system → POST /lab/webhook/:labName
    1. Validate X-Lab-Signature (HMAC-SHA256)
    2. Load provider config from lab_providers table
    3. Call adapter.fetchOrder(order_id, config)        ← optional, if order_id present
    4. adapter.parseResponse(raw) → [{loinc_code, value, unit, data_date, lab_patient_id}]
    5. Group by lab_patient_id
    6. matchUser(labName, lab_patient_id) → Nano user_id
    7. normalizeObservations(obs) → catalog lookup (LOINC → key_name, nano_dimension, is_kino_core)
    8. INSERT health_reports (source='lab_api', status='parsed')
    9. INSERT health_events rows (category='lab_result', linked via report_id FK)
   10. If ≥1 is_kino_core result found:
       → publish CloudEvent(source='acs.lab', type='biomarker.lab_complete')
   11. Return 202 Accepted

── Pull: Nano polls lab API ──────────────────────────────────────────
Timer trigger (every 4 hours)
    1. SELECT * FROM lab_providers WHERE poll_enabled = TRUE AND is_active = TRUE
    2. For each provider: adapter.fetchNewResults(since=last_polled_at, config)
    3. adapter.parseResponse(raw) → same normalization pipeline as push
    4. UPDATE lab_providers SET last_polled_at = NOW()

── EventBridge → nano-worker ────────────────────────────────────────
Worker receives: { source: 'acs.lab', type: 'biomarker.lab_complete', data: { report_id, user_id } }
    1. Load Kino core health_events WHERE report_id = X AND is_kino_core = true
    2. Build partial biomarkers: { hsCRP: X, GA: X, ... }
    3. BiomarkerEstimator fills missing Kino core values (uses same tags/seed as chip scans)
    4. BioAgeCalculator.calculateBioAge(age, estimatedValues)
    5. INSERT biomarkers (test_type='lab_import', includes source_report_id)
    6. updateHealthTwin()
```

---

## Files

```
src/functions/lab/
  index.js                    — FC handler: timer → handlePoll(), POST → handleWebhook()
  lib/
    db.js                     — PG pool (same pattern as dispatcher)
    adapters/
      index.js                — adapter registry: getAdapter(labName)
      generic.js              — reference adapter (standard REST JSON API)
    userMatcher.js            — lab_patient_id → Nano user_id
    labNormalizer.js          — LOINC lookup via biomarker_catalog; caches catalog per container
  package.json
```

---

## Database Tables

### `biomarker_catalog`

Registry of all known biomarkers — both Kino core and the broader clinical panel.

| Column | Type | Description |
|---|---|---|
| `key_name` | TEXT UNIQUE | Internal code: `hsCRP`, `HbA1c`, `LDL`, etc. |
| `loinc_code` | TEXT UNIQUE | LOINC code (NULL for proprietary, e.g. CD38) |
| `display_name` | TEXT | English label |
| `display_name_zh` | TEXT | Chinese label |
| `unit` | TEXT | Canonical unit |
| `category` | TEXT | `inflammation` / `metabolic` / `renal` / `lipid` / `cbc` / `thyroid` / `liver` / `cellular` |
| `nano_dimension` | TEXT | Which sub-age this biomarker feeds (NULL = context-only) |
| `is_kino_core` | BOOLEAN | TRUE for the 6 Kino biomarkers that feed BioAgeCalculator directly |
| `ref_low` / `ref_high` | NUMERIC | Normal range bounds |
| `is_active` | BOOLEAN | Soft-delete; inactive entries are excluded from lookups |

**Kino core biomarkers** (`is_kino_core = TRUE`):

| key_name | LOINC | nano_dimension |
|---|---|---|
| `hsCRP` | 71426-1 | ResilienceAge |
| `IL6` | 26881-3 | ResilienceAge |
| `GDF15` | 96543-1 | CellularAge |
| `GA` | 13457-7 | MetabolicAge |
| `CystatinC` | 33863-2 | MicroVascularAge |
| `CD38` | — | CellularAge |

### `health_reports`

Document-level record for a complete lab result submission.

| Column | Type | Description |
|---|---|---|
| `id` | BIGSERIAL | Primary key |
| `user_id` | TEXT FK | Owner |
| `report_date` | DATE | Date of the test/collection |
| `source` | TEXT | `manual_upload` / `lab_api` / `fhir_import` |
| `institution` | TEXT | Hospital or lab name |
| `report_type` | TEXT | `annual_checkup` / `lab_panel` / `imaging` / `other` |
| `status` | TEXT | `pending` / `parsed` / `error` |
| `oss_key` | TEXT | Original file in OSS (PDF, image) |
| `raw_data` | JSONB | Parsed observation array |
| `created_at` | TIMESTAMPTZ | Ingestion time |

Individual observations are stored as `health_events` rows linked via `health_events.report_id`.

### `lab_user_mappings`

Maps a third-party lab's patient identifier to a Nano user.

| Column | Type | Description |
|---|---|---|
| `user_id` | TEXT FK | Nano user |
| `lab_name` | TEXT | Adapter key: `kingmed`, `fros`, etc. |
| `lab_patient_id` | TEXT | The lab's own patient identifier |

Unique constraint on `(lab_name, lab_patient_id)` — one lab patient maps to exactly one Nano user. Users can have multiple mappings (different labs or regional instances).

**Fallback:** if no mapping exists, `userMatcher.js` attempts a phone number match against `users.phone`.

### `lab_providers`

Per-lab instance credentials and polling state.

| Column | Type | Description |
|---|---|---|
| `lab_name` | TEXT | Adapter key — matches a file in `lib/adapters/` |
| `label` | TEXT | Human label: `KingMed Shanghai` |
| `api_base_url` | TEXT | Base URL for this lab's REST API |
| `api_key_enc` | TEXT | API key (AES-256 encrypted at rest) |
| `webhook_secret_enc` | TEXT | HMAC secret for webhook signature validation |
| `poll_enabled` | BOOLEAN | Whether the timer loop should poll this provider |
| `last_polled_at` | TIMESTAMPTZ | Updated after each successful pull cycle |
| `is_active` | BOOLEAN | Soft-delete |

Multiple rows with the same `lab_name` support regional instances of the same lab (e.g. KingMed Shanghai vs KingMed Guangzhou).

---

## Adding a New Lab

1. Create `src/functions/lab/lib/adapters/<labname>.js` implementing the four required methods:

```js
function validateWebhook(headers, rawBody, secret) { /* HMAC-SHA256 check */ }
async function fetchOrder(orderId, config)          { /* GET /orders/:id */ }
async function fetchNewResults(since, config)       { /* GET /results?since=... */ }
function parseResponse(raw)                        { /* → [{loinc_code, value, unit, data_date, lab_patient_id}] */ }

module.exports = { validateWebhook, fetchOrder, fetchNewResults, parseResponse };
```

2. Register the adapter in `lib/adapters/index.js`:

```js
const adapters = {
    generic:  require('./generic'),
    kingmed:  require('./kingmed'),   // ← add this line
};
```

3. Insert a row into `lab_providers` for the new lab instance.

4. Register lab patient IDs for users via `lab_user_mappings`.

5. Redeploy: `npm run deploy:lab`.

No structural changes to `nano-lab` are required. Adding a lab is one file + one DB row.

---

## Worker API Endpoints

These are served by `nano-worker` (not `nano-lab`).

### `POST /api/health-reports`

Store a manually uploaded health report with its observations.

**Request body:**

```json
{
  "openid": "wx_abc",
  "report_date": "2026-05-01",
  "source": "manual_upload",
  "institution": "Fuda Hospital",
  "report_type": "annual_checkup",
  "observations": [
    { "loinc_code": "71426-1", "value": 0.8, "unit": "mg/L", "data_date": "2026-05-01" },
    { "loinc_code": "2093-3",  "value": 4.9, "unit": "mmol/L" }
  ]
}
```

Or supply a `fhir_bundle` (FHIR R4 Bundle with Observation resources) instead of `observations`.

**Response:** `{ success: true, report_id: 42, has_kino_core: true }`

### `POST /api/health-events/fhir`

Thin alias for `POST /health-reports` with `source` forced to `fhir_import`. Accepts the same body.

### `GET /api/health-reports`

List reports for a user.

**Query:** `?openid=wx_abc` or `?user_id=abc123`

**Response:** `{ success: true, reports: [{ id, report_date, source, institution, status, ... }] }`

### `GET /api/health-reports/:id`

Fetch a single report and its linked health_events.

**Response:** `{ success: true, report: {...}, events: [{id, category, data_date, data}] }`

---

## FHIR Bundle Format

When importing from a FHIR R4 Bundle, each relevant entry must be an `Observation` resource with a LOINC coding:

```json
{
  "resourceType": "Bundle",
  "type": "collection",
  "entry": [
    {
      "resource": {
        "resourceType": "Observation",
        "code": {
          "coding": [{ "system": "http://loinc.org", "code": "71426-1" }]
        },
        "valueQuantity": { "value": 0.8, "unit": "mg/L" },
        "effectiveDateTime": "2026-05-01"
      }
    }
  ]
}
```

Observations without a `http://loinc.org` coding, or whose LOINC code is not in `biomarker_catalog`, are silently skipped. Only codes in the catalog are stored.

---

## Biomarker Catalog Coverage

The catalog is seeded at migration time and can be extended with `INSERT ... ON CONFLICT DO NOTHING`.

| Category | Biomarkers |
|---|---|
| Inflammation | hsCRP, IL6, CRP, VitaminD, WBC |
| Cellular | GDF15, CD38, Ferritin, Hemoglobin |
| Metabolic | GA, HbA1c, FPG, Triglycerides, ALT, AST, GGT, TSH |
| Renal | CystatinC, Creatinine, eGFR, BUN, UricAcid |
| Lipid/Vascular | TotalCholesterol, LDL, HDL |

---

## Deployment

```bash
# Dev
npm run deploy:lab

# Prod
npm run deploy:lab:prod
```

The function deploys as `nano-lab-dev` / `nano-lab-prod`. It runs in the same VPC as the other functions and shares the same PolarDB database.

**Required environment variables** (add to `.env` and `s.yaml`/`s-prod.yaml`):

| Variable | Description |
|---|---|
| `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASS` | PolarDB connection |
| `LAB_WEBHOOK_SECRET` | Default HMAC secret (per-provider secrets stored in DB) |
| `EVENTBRIDGE_ENDPOINT` | Aliyun EventBridge endpoint URL |
| `EVENTBRIDGE_TOPIC` | EventBridge topic/bus name |

---

## Relationship to Wearables

Wearable devices (Oura, Whoop, Garmin) are **not** handled by `nano-lab`. Wearables produce continuous time-series data that users actively sync; clinical labs produce discrete, institution-issued reports. They are ingested via different paths:

| Source | Function | Trigger | Mechanism |
|---|---|---|---|
| Clinical lab (KingMed, etc.) | `nano-lab` | Webhook or timer | Adapter pattern, LOINC mapping |
| Wearables (Oura, Garmin, etc.) | `nano-worker` | User-initiated | `POST /health-events/sync` |
