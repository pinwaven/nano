# Digital Twin

The **Digital Twin** is the umbrella term for a user's entire health model — never any single
data source. This file is the canonical definition of that vocabulary; the miniapp's `t.layer*`
i18n keys, the prompt section headers, and the table below must change together (CLAUDE.md §34).

## The four layers

| # | ZH | EN | Backing tables | Miniapp section | Prompt header |
|---|---|---|---|---|---|
| 1 | 精准检测 | Precision Testing | `biomarkers(test_type='kino_chip')`; `health_twin.latest_bio_age / latest_sub_ages / latest_kino_scan_at` | `t.layerPrecision` + the BioAge summary card | `DIGITAL TWIN · PRECISION TESTING` |
| 2 | 日常监测 | Daily Monitoring | `health_events(sleep\|activity\|vitals\|body_composition)`; `health_twin.avg_* / latest_weight_kg / latest_bmi / latest_body_fat_pct / trend_data` | `t.layerDaily` | `DIGITAL TWIN · DAILY MONITORING` |
| 3 | 医疗记录 | Medical Records | `health_reports`; `health_documents`; `health_events(category='lab_result')`; `health_twin.latest_lab_data / latest_lab_date` | `t.layerMedical` | (rendered as the lab snapshot) |
| 4 | 个人档案 | Personal Profile | `users.bio_data`; `questionnaire_responses`; `user_memory_facts` | `t.layerProfile` | `DIGITAL TWIN · PERSONAL PROFILE` |

Per-layer deep dives: [kino-system.md](kino-system.md) · [wearable-system.md](wearable-system.md) /
[halo-smart-ring.md](halo-smart-ring.md) · [lab-integration.md](lab-integration.md) /
[photo-health-tracking.md](photo-health-tracking.md) · [questionnaire-system.md](questionnaire-system.md)

**Interventions are deliberately not a layer.** `health_plans` and `nutrition_plans` are what the
user *does*, not what they *are*, and they own the Plans tab. Folding them in would make "twin"
mean "everything," which is exactly how the term lost its meaning before this taxonomy existed.

### Storage layers (not the same as the four layers above)

Separate axis, same word — worth stating explicitly because the collision caused real confusion:

| Storage layer | Table | Purpose |
|---|---|---|
| **Raw event log** | `health_events` | Append-only, source-of-truth for all time-series health data |
| **Materialized summary** | `health_twin` | One row per user; 7-day rolling averages + latest values; what the AI reads |

Note `health_twin` spans three of the four *user-facing* layers (it carries the latest lab panel
and the denormalized BioAge alongside the ring averages) — it is **not** a wearable-only row,
despite the `avg_*` columns dominating it visually.

---

## Data Categories

Every event belongs to one of five categories. The `data` JSONB column shape is fixed per category.

### `sleep`

```json
{
  "duration_minutes": 420,
  "sleep_score": 78,
  "stages": {
    "awake_minutes": 15,
    "light_minutes": 180,
    "deep_minutes": 90,
    "rem_minutes": 135
  },
  "hrv_avg_ms": 52,
  "resting_hr": 58,
  "spo2_avg": 97.2,
  "bedtime": "23:15",
  "wake_time": "06:15"
}
```

### `activity`

```json
{
  "activity_type": "running",
  "duration_minutes": 45,
  "distance_km": 7.2,
  "calories": 380,
  "avg_hr": 145,
  "max_hr": 172,
  "hr_zones": { "zone1": 5, "zone2": 15, "zone3": 20, "zone4": 5 },
  "steps": 9500,
  "elevation_gain_m": 120
}
```

### `vitals`

Multiple rows per day are allowed — each measurement source writes its own row with a distinct `external_id`. The `data` shape varies by source:

**Wearable ring sync** (`source: smart_ring`) — two rows per day:
```json
{ "resting_hr": 62, "hr_slots": [...] }
```
```json
{ "hrv_ms": 54, "stress": 38, "spo2": 97.5 }
```

**Photo-captured readings** (`source: manual_photo`) — one row per photo, timestamp-keyed `external_id` so multiple readings per day accumulate:
```json
{ "bp_systolic": 118, "bp_diastolic": 76, "bp_pulse": 72 }
```
```json
{ "glucose_mmol": 5.2, "glucose_context": "fasting" }
```

See [Photo-Based Health Tracking](photo-health-tracking.md) for the full flow.

### `lab_result` (annual blood panel / physical exam)

```json
{
  "provider": "Hospital / Lab name",
  "panel_type": "comprehensive",
  "results": {
    "glucose_fasting": { "value": 92, "unit": "mg/dL", "ref_low": 70, "ref_high": 100 },
    "hba1c":          { "value": 5.4, "unit": "%", "ref_high": 5.7 },
    "ldl":            { "value": 115, "unit": "mg/dL", "ref_high": 100 },
    "hdl":            { "value": 58,  "unit": "mg/dL", "ref_low": 40 },
    "vitamin_d":      { "value": 42,  "unit": "ng/mL", "ref_low": 30 }
  }
}
```

### `body_composition`

```json
{ "weight_kg": 72.5, "bmi": 23.1, "body_fat_pct": 22.4, "muscle_mass_kg": 54.2 }
```

---

## Data Sources

| Source key | Description |
|---|---|
| `apple_health` | Apple Health / HealthKit export |
| `garmin` | Garmin Connect API |
| `fitbit` | Fitbit API |
| `manual` | User-entered from the miniapp |
| `manual_photo` | AI-extracted from a device photo (scale, BP monitor, glucose meter) |
| `annual_lab` | Coach- or admin-uploaded lab result |
| `hospital` | Imported from a hospital record |

---

## Database Schema

Migration files: `src/schemas/migration_health_events.sql`, `src/schemas/migration_health_twin.sql`

### `health_events`

| Column | Type | Description |
|---|---|---|
| `id` | BIGSERIAL | Primary key |
| `user_id` | TEXT FK | Owner |
| `source` | TEXT | Data source (see table above) |
| `category` | TEXT | One of the five categories |
| `data_date` | DATE | The date the measurement belongs to (not ingestion time) |
| `recorded_at` | TIMESTAMPTZ | Precise timestamp of the measurement |
| `data` | JSONB | Category-specific payload |
| `external_id` | TEXT | Source system's own ID — used for deduplication |
| `ingested_at` | TIMESTAMPTZ | Server ingestion time (auto) |

**Indexes:**
- `(user_id, data_date DESC)` — time-series queries
- `(user_id, category, data_date DESC)` — per-category queries
- `UNIQUE (user_id, source, external_id) WHERE external_id IS NOT NULL` — deduplication

### `health_twin`

One row per user. Updated in real time after every `health_events` insert via `updateHealthTwin()`.

| Column | Type | Description |
|---|---|---|
| `user_id` | TEXT PK | One row per user |
| `avg_hrv_ms` | FLOAT | 7-day avg HRV (ms) |
| `avg_resting_hr` | FLOAT | 7-day avg resting heart rate (bpm) |
| `avg_spo2` | FLOAT | 7-day avg blood oxygen (%) |
| `avg_sleep_hours` | FLOAT | 7-day avg sleep duration (hours) |
| `avg_sleep_score` | FLOAT | 7-day avg sleep score (0–100) |
| `avg_deep_sleep_pct` | FLOAT | 7-day avg (deep + REM) / total sleep % |
| `avg_daily_steps` | INTEGER | 7-day avg daily steps |
| `avg_active_minutes` | INTEGER | 7-day avg active minutes per day |
| `latest_weight_kg` | FLOAT | Most recent body composition weight |
| `latest_bmi` | FLOAT | Most recent BMI |
| `latest_body_fat_pct` | FLOAT | Most recent body fat % |
| `latest_lab_data` | JSONB | Full payload of the most recent `lab_result` event |
| `latest_lab_date` | DATE | Date of the most recent lab result |
| `latest_bio_age` | FLOAT | From `biomarkers` table — most recent Kino scan |
| `latest_sub_ages` | JSONB | `{ CellularAge, MetabolicAge, MicroVascularAge, ResilienceAge }` from Kino |
| `latest_kino_scan_at` | TIMESTAMPTZ | Timestamp of the most recent Kino scan |
| `trend_data` | JSONB | 30-day trend signals: `{ hrv_trend, sleep_trend, weight_trend_kg }` |
| `data_coverage` | JSONB | Last `data_date` per category: `{ sleep, activity, vitals, lab_result, body_composition }` |
| `last_updated_at` | TIMESTAMPTZ | When this row was last recomputed |

**Trend values:** `'improving'`, `'declining'`, `'stable'`, `'unknown'` — computed by comparing the current 7-day average to the average over the 7-day window ending 30 days ago.

---

## Real-Time Update

**File:** `src/functions/worker/lib/healthTwinUpdater.js`

`updateHealthTwin(userId, pool)` is called after every successful `health_events` INSERT (both single-event and batch endpoints). It runs:

1. A single aggregation query over the last 7 days of `health_events` for all categories
2. A `SELECT` on `health_events` for the latest `body_composition`, `lab_result`
3. A `SELECT` on `biomarkers` for the latest `kino_chip` scan
4. A 30-day look-back for trend computation
5. A `SELECT GROUP BY category` for `data_coverage`
6. An `INSERT … ON CONFLICT DO UPDATE` into `health_twin`

The function is **non-fatal** — if it fails, the error is logged and the caller's HTTP response still succeeds. This prevents a twin computation glitch from blocking data ingestion.

---

## API Endpoints

All endpoints use the existing Bearer token auth.

### `POST /health-events`

Single event ingestion (miniapp manual entry).

**Body:**
```json
{
  "openid": "user_or_external_id",
  "category": "sleep",
  "source": "manual",
  "data_date": "2025-05-13",
  "recorded_at": "2025-05-13T07:00:00Z",
  "data": { "duration_minutes": 420, "sleep_score": 78, ... },
  "external_id": "optional-source-id"
}
```

**Response:** `{ success: true, id: 123, inserted: true }` — `inserted: false` means a dedup collision; the event was silently ignored.

### `POST /health-events/sync`

Batch ingestion for wearable API sync. Max 500 events per call.

**Body:**
```json
{
  "openid": "user_or_external_id",
  "events": [{ "category": "vitals", "source": "garmin", "external_id": "g-12345", ... }]
}
```

**Response:** `{ success: true, inserted: 7, skipped: 3 }` — `skipped` counts dedup collisions.

### `GET /health-events`

Query the event log for a user.

**Query params:** `openid`, `category` (optional), `from_date` (optional), `to_date` (optional), `limit` (default 30, max 200)

**Response:** `{ success: true, events: [...] }`

### `GET /health-twin`

Returns the full digital twin summary for a user.

**Query params:** `openid`

**Response:** `{ success: true, twin: { avg_hrv_ms, avg_sleep_hours, ..., trend_data, data_coverage } }` — `twin` is `null` if the user has no health events yet.

---

## AI Integration

### Shared vocabulary block

`prompts/chat/twinVocabulary.js` — `getTwinVocabBlock(isZh)`. Persona-agnostic, same pattern as
`currentDateBlock.js` / `factConstraint.js` / `factMemoryBlock.js`. Names the umbrella and the four
layers using the exact strings the UI shows, and forbids equating "Digital Twin" with "wearable
data." Injected by the six heavyweight prompts: `{nano,viva}/systemHealthAdvice.js`,
`{nano,viva}/systemFormulaGenerate.js`, `{nano,viva}/chat/biomarker.js`. The light prompts
(`chat/nutrition.js`, `chat/emotional.js`, `systemDailyCheckin.js`) carry an inline
`TWIN · DAILY MONITORING` prefix instead — a full taxonomy block is disproportionate for a
one-line context injection.

The digital twin feeds the AI at two entry points.

### Chat (`handlePostChat`)

`health_twin` is **always fetched** alongside questionnaire responses, regardless of intent. It is passed as `health_twin` in `llmContext` and consumed by the intent-specific prompts that benefit from lifestyle context:

| Prompt | How it uses `health_twin` |
|---|---|
| `chat/biomarker.js` | Displays 7-day vitals/sleep alongside Kino numbers; instructs AI to cross-reference both |
| `chat/nutrition.js` | Shows sleep and HRV as one-line context |
| `chat/emotional.js` | Gently surfaces sleep/HRV data when user expresses fatigue or low mood |

### Health Advice (`handlePostHealthAdvice`)

`health_twin` is fetched in the same `Promise.all` as biomarkers, dots, and plans. It is passed
into `systemHealthAdvice.js` as `health_twin`. That prompt's sections are named for the layers
they carry:

| Prompt section | Layer |
|---|---|
| `━━━ DIGITAL TWIN · PERSONAL PROFILE (SELF-REPORTED) ━━━` | 4 |
| `━━━ DIGITAL TWIN · PRECISION TESTING (KINO BIOMARKERS & BIOLOGICAL AGE) ━━━` | 1 |
| `━━━ DIGITAL TWIN · DAILY MONITORING (WEARABLE, SLEEP, ACTIVITY, BODY) ━━━` | 2 |

The task instructions include a "Daily-Monitoring Connection" step asking the model to
cross-reference daily-monitoring signals with Precision Testing biomarkers (e.g. poor sleep →
elevated CRP → higher Resilience Age).

**Known gap:** `health_twin.latest_lab_data` / `latest_lab_date` are present in the row this
prompt already receives, and the miniapp renders them as the lab snapshot, but
`systemHealthAdvice.js` does not show them to the model — so the AI cannot see the Medical
Records layer the user is looking at. Rendering it is a display of in-hand data, not a new
pipeline.

---

## Deduplication

When ingesting from a wearable API, pass the source system's record ID as `external_id`. The unique partial index on `(user_id, source, external_id) WHERE external_id IS NOT NULL` ensures that re-syncing the same time window does not create duplicate rows. Events without an `external_id` (e.g. manual entries) bypass the dedup check entirely.

---

## Data Flow Diagram

```
Wearable API / Manual Entry
        │
        ▼
POST /health-events        POST /health-events/sync
(single event)             (batch, max 500)
        │                          │
        └──────────┬───────────────┘
                   ▼
           health_events (insert)
           ON CONFLICT DO NOTHING
                   │
                   ▼
           updateHealthTwin()
           (aggregate last 7 days)
                   │
                   ▼
           health_twin (upsert)
           ┌──────────────────────┐
           │ 7-day rolling avgs   │  ◄── read by AI prompts
           │ latest body/lab/kino │
           │ 30-day trend signals │
           └──────────────────────┘
```

---

## Miniapp UI — the Health tab

`components/user-health/` (mounted at `pages/main/main.wxml` as `mode="self"` and at
`pages/coach/coach.wxml` as `mode="coach"`). One vertical scroll, laid out as the umbrella
followed by the four layers:

1. **Umbrella** (`.twin-umbrella`) — `{{t.digitalTwin}}` plus a completeness strip: one chip per
   layer, green with a last-updated date when that layer has data, dimmed otherwise. Derived by
   `_recomputeTwinLayers()`, which re-reads `this.data` after each loader finishes rather than
   fetching anything new. `data_coverage` alone can't back this — its five keys are all
   `health_events`-derived, so it knows nothing about Kino or the profile.
2. **Twin summary card** — body figure with four tappable sub-age zones + BioAge chip. Gated on
   `subAgeList.length > 0` (needs a Kino scan).
3. **Cross-layer strips** — health tags, weight/BMI/steps/HRV/stress, and photo-captured
   BP/glucose. Deliberately **ungated**: these mix layers, and gating them behind a Kino scan
   used to leave a ring-only user staring at an empty tab.
4. **Daily Monitoring** (`{{t.layerDaily}}`) — ring bind/sync UI, sync summary, per-slot charts
   (hourly steps/HR, 7-day HRV/SpO₂, weekly sleep timeline, sleep stages), body-composition bar.
5. **Precision Testing** (`{{t.layerPrecision}}`) — Kino history and trends.
6. **Medical Records** (`{{t.layerMedical}}`) — lab snapshot + report list → report detail sheet.
7. **Personal Profile** (`{{t.layerProfile}}`) — read-only `user_memory_facts` list, self view
   only (the coach app has its own Facts tab). Read-only by design: who owns an AI-extracted
   fact is a product question, not a labeling one.

---

## Health Score Computation — web user-app only

**File:** `src/web/user-app/src/utils.js` (`buildTwinVisuals`), rendered by `tabs/HealthTab.jsx`.

> The miniapp has a near-identical `_buildTwinVisuals()` in
> `components/user-health/user-health.js`, but its output is **computed and discarded** — no
> `.wxml` references `healthScore` / `healthDomains` / `vitalGauges`. The miniapp shows live
> ring charts instead. Don't delete the miniapp copy without checking it against the web
> version first; it is also called on a ring-derived `virtualTwin`.

Six scoring functions map raw metric values to 0–100:

```js
_scoreSleep(hours)     // 7–9h = 80–100; <6h or >10h = red zone
_scoreHrv(ms)          // ≥80ms = 100; scales linearly from 0
_scoreRestHr(bpm)      // ≤52 = 100; degraded above 65; sharp drop >90
_scoreSpo2(pct)        // ≥98% = 100; <95% = below 70
_scoreSteps(steps)     // 10 000+ = 100; 7 500 = 75; 5 000 = 50
_scoreBmi(bmi)         // 18.5–24.9 = 100; degrades outside this range
```

Domain composites:
- **Recovery** = avg(sleepScore, hrvScore)
- **Cardio** = avg(restHrScore, spo2Score)
- **Activity** = avg(stepsScore)
- **Body** = avg(bmiScore)

**Overall Health Score** = avg of available domain scores. Domains with no data are excluded (not zeroed).

---

## Demo Seed Script

**File:** `temp/seed-pin-digital-twin.js`

Inserts 14 days of realistic health events across all five categories for user Pin (`37c8774e`) and calls `updateHealthTwin` to populate `health_twin`.

```bash
export DATABASE_URL="postgresql://nano_admin:...@.../nano_db_dev"
node temp/seed-pin-digital-twin.js
```

Expected output after seeding (Pin's twin):

| Field | Value |
|---|---|
| avg_hrv_ms | 55.6 ms |
| avg_resting_hr | 59.7 bpm |
| avg_spo2 | 97.6 % |
| avg_sleep_hours | 7.54 h (score 82) |
| avg_daily_steps | 7 807 |
| latest_weight_kg | 72.8 kg |
| latest_bmi | 23.2 |
| latest_body_fat_pct | 21 % |
| data_coverage | all 5 categories |

Health Score: **~88 (Optimal)**

---

## Every health table, by layer

`health_twin` is a *cache* across layers, not the twin itself. The full map:

| Layer | Source | Table | What it captures |
|---|---|---|---|
| 1 Precision Testing | Kino chip scan | `biomarkers` (`test_type='kino_chip'`) | Precision blood biomarkers → BioAge + 4 sub-ages |
| 2 Daily Monitoring | Wearable sync | `health_events` (`sleep`/`activity`/`vitals`) | Continuous HRV, sleep, steps, SpO₂ |
| 2 Daily Monitoring | Body weight log | `biomarkers` (`test_type='body_composition'`), `users.bio_data`, `health_events` (`body_composition`) | Weight snapshots — **stored in three places**, hand-synced by `_syncBodyCompositionTwin()` |
| 2 Daily Monitoring | Manual lifestyle | `health_events` (`source='manual'`) | User-entered sleep, workouts |
| 3 Medical Records | Report upload / lab API / FHIR | `health_reports`, `health_events` (`category='lab_result'`), `biomarkers` (`test_type='lab_import'`) | Full blood panels, checkups, imaging, doctor's notes |
| 3 Medical Records | Photo OCR | `POST /analyze-image` → `health_reports` on consent | Photographed lab reports, BP/glucose/scale readings |
| 3 Medical Records | Document upload (Viva AG subtab, see [viva-ag.md](viva-ag.md)) | `POST /health-documents` → `health_documents` (+ OSS) | Hospital records, discharge summaries, imaging and prescription PDFs, photos of paper records |
| 4 Personal Profile | Onboarding + edits | `users.bio_data`, `questionnaire_responses` | Height/weight, conditions, declared allergies & medications |
| 4 Personal Profile | Chat extraction | `user_memory_facts` | Dietary restrictions, allergies, preferences, goals |

`health_twin.latest_bio_age` / `latest_sub_ages` are denormalized from `biomarkers`, and
`latest_lab_data` from `health_events`, by `updateHealthTwin()` — so the AI can read across
layers from a single row.

**Known duplication (labelled, not yet resolved):** weight lives in three stores and allergies in
two (`user_memory_facts` is chat-extracted, `users.bio_data` is onboarding-declared —
semantically different, so the fix is a merge policy rather than a schema change).
