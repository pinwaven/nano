# Digital Twin Health Profile

The **Digital Twin** is a continuously updated model of a user's health state drawn from multiple data streams: Kino biomarker scans, wearable devices, manual self-reports, annual lab records, and activity data. It has two layers:

| Layer | Table | Purpose |
|---|---|---|
| **Raw event log** | `health_events` | Append-only, source-of-truth for all time-series health data |
| **Materialized summary** | `health_twin` | One row per user; 7-day rolling averages + latest values; what the AI reads |

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

### `vitals` (daily wearable summary)

```json
{
  "resting_hr": 62,
  "hrv_sdnn_ms": 48,
  "spo2": 97.5,
  "skin_temp_celsius": 36.8,
  "steps": 8432,
  "active_calories": 320,
  "total_calories": 1890
}
```

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

The digital twin feeds the AI at two entry points.

### Chat (`handlePostChat`)

`health_twin` is **always fetched** alongside questionnaire responses, regardless of intent. It is passed as `health_twin` in `llmContext` and consumed by the intent-specific prompts that benefit from lifestyle context:

| Prompt | How it uses `health_twin` |
|---|---|
| `chat/biomarker.js` | Displays 7-day vitals/sleep alongside Kino numbers; instructs AI to cross-reference both |
| `chat/nutrition.js` | Shows sleep and HRV as one-line context |
| `chat/emotional.js` | Gently surfaces sleep/HRV data when user expresses fatigue or low mood |

### Health Advice (`handlePostHealthAdvice`)

`health_twin` is fetched in the same `Promise.all` as biomarkers, dots, and plans. It is passed into `systemHealthAdvice.js` as `health_twin` and renders as a **DIGITAL TWIN** section in the prompt. The AI task instructions include a "Lifestyle Connection" step that asks the model to cross-reference wearable data with Kino biomarkers (e.g. poor sleep → elevated CRP → higher Resilience Age).

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

## Miniapp UI — Health Tab Digital Twin Section

The Digital Twin section appears at the **bottom of the health tab** (`components/user-health/`) and loads concurrently with biomarker data via a fire-and-forget `_loadHealthTwin()` call. When data is present it renders four visual blocks:

### 1. Health Score Card

A composite 0–100 score derived by averaging four domain scores. Displayed inside a circular ring whose border and number color shift with the grade:

| Score | Grade (zh/en) | Color |
|---|---|---|
| ≥ 80 | 优秀 / Optimal | Green `#10b981` |
| ≥ 65 | 良好 / Good | Indigo `#6375EC` |
| ≥ 50 | 一般 / Fair | Orange `#f97316` |
| < 50 | 偏低 / Low | Red `#ef4444` |

To the right: compact horizontal bars for each domain (Recovery, Cardio, Activity, Body) with their individual scores.

### 2. Vital Gauge Rows

Each available metric is a row containing:
- **Label** + **colored value** + optional **trend arrow** (↑ / → / ↓)
- A **zone track** — a 12rpx bar divided into colored segments representing clinical ranges (red/orange/green/blue)
- A **floating dot marker** positioned absolutely at `markerPct`% along the track, matching the metric color
- A **sublabel** showing the optimal range

| Metric | Scale | Zones (left → right) |
|---|---|---|
| Sleep | 0–12 h | Red (0–6h), Orange (6–7h), Green (7–9h), Orange (9–10h), Red (10–12h) |
| HRV | 0–100 ms | Red (0–20), Orange (20–40), Green (40–70), Blue (70–100) |
| Resting HR | 40–120 bpm | Blue (40–52), Green (52–75), Orange (75–90), Red (90–120) |
| SpO₂ | 90–100 % | Red (90–95), Orange (95–97), Green (97–98), Blue (98–100) |
| Daily Steps | 0–12 000 | Red (0–5k), Orange (5–7.5k), Green (7.5–10k), Blue (10k+) |

### 3. Body Composition Bar

Shown when `latest_body_fat_pct` is available. A horizontal segmented bar splits body weight into lean mass (green gradient) and fat (orange gradient) with a legend showing exact percentages. The numeric stats (weight, BMI, fat %) appear as header text above the bar.

### 4. Source Coverage Chips

Chip row showing which data categories have data and their last sync date. Active sources (`.twin-source-active`) have a green dot and colored border; inactive sources are dimmed.

---

## Health Score Computation

**File:** `src/mini/nano-miniapp/components/user-health/user-health.js`

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

## Relationship to Existing Health Data

The digital twin **complements** rather than replaces the existing `biomarkers` table:

| Source | Table | What it captures |
|---|---|---|
| Kino chip scan | `biomarkers` (`test_type = 'kino_chip'`) | Precision blood biomarkers → BioAge sub-scores |
| Body weight log | `biomarkers` (`test_type = 'body_composition'`) | Weight snapshots from the miniapp (legacy path) |
| Wearable sync | `health_events` | Continuous HRV, sleep, steps, SpO₂ |
| Annual labs | `health_events` (`category = 'lab_result'`) | Full blood panel not captured by Kino |
| Manual lifestyle | `health_events` (`source = 'manual'`) | User-entered sleep, workouts, etc. |

`health_twin.latest_bio_age` and `latest_sub_ages` are denormalized from `biomarkers` by `updateHealthTwin()` so the AI can read the entire user state from a single row.
