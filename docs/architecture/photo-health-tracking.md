# Photo-Based Health Tracking

Users can photograph their health devices — weight scales, blood pressure monitors, and blood glucose meters — directly in the miniapp chat tab. The AI reads the displayed value, validates it against history, saves it to the health record, and replies in chat with a contextual summary.

No new UI is needed. This reuses the existing **Upload Image** flow in the chat toolbox.

---

## How it works

```
User taps Upload Image in chat toolbox
  → wx.chooseImage (camera or album)
  → presign: GET /api/oss/presign
  → upload: PUT to OSS presigned URL
  → POST /api/analyze-image { openid, oss_key }
      → vision model reads device display
      → value saved to health_events (BP, glucose) or biomarkers (weight)
      → chat reply with recorded value + context
  → user sees result in chat and in Health tab trend charts
```

---

## Supported device types

| Device | content_type | Extracted fields | Storage |
|---|---|---|---|
| Weight scale | `scale_reading` | `body_weight_kg`, `scale_unit` | `biomarkers` (test_type `body_composition`) + `users.bio_data.weight_kg` |
| Blood pressure monitor | `bp_reading` | `bp_systolic`, `bp_diastolic`, `bp_pulse` | `health_events` (category `vitals`) |
| Blood glucose meter | `glucose_reading` | `glucose_value`, `glucose_unit` | `health_events` (category `vitals`) |

---

## Backend

### Vision model

All image analysis uses `qwen-vl-plus` via the Aliyun DashScope API.

Handler: `handlePostAnalyzeImage` in `src/functions/worker/index.js`

### Prompt

`src/functions/worker/prompts/nano/systemHealthReport.js`

The prompt classifies uploaded images into seven content types:

| Type | content_type |
|---|---|
| A — Formal health report (lab, CBC, etc.) | `health_report` |
| B — General health photo | `health_photo` |
| C — Food photo | `food_photo` |
| D — Waven DOTS | `waven_dots` |
| E — Weight scale | `scale_reading` |
| F — Blood pressure monitor | `bp_reading` |
| G — Blood glucose meter | `glucose_reading` |

The AI always outputs a structured JSON block first, then a narrative paragraph. Device-reading types (E, F, G) output a focused JSON with measurement fields and no free-text narrative — the narrative is built server-side from reference ranges instead.

### JSON output schema

```json
{
  "content_type": "scale_reading | bp_reading | glucose_reading | ...",
  "body_weight_kg": null,
  "scale_unit": "kg | lb | null",
  "bp_systolic": null,
  "bp_diastolic": null,
  "bp_pulse": null,
  "glucose_value": null,
  "glucose_unit": "mmol/L | mg/dL | null",
  "report_date": null,
  "extracted": {},
  "abnormal_items": []
}
```

### Unit conversion

Handled in `handlePostAnalyzeImage` before any storage:

| Device | Trigger | Conversion |
|---|---|---|
| Weight scale | `scale_unit === 'lb'` | `kg = round(lb × 0.453592, 1)` |
| Glucose meter | `glucose_unit === 'mg/dL'` | `mmol/L = round(mg/dL ÷ 18.02, 1)` |

### Data storage

**Weight (`scale_reading`)**

Stored in `biomarkers` with `test_type = 'body_composition'`:
```json
{
  "oss_key": "...",
  "content_type": "scale_reading",
  "actual": { "weight": 72.5 },
  "weight_kg": 72.5
}
```
`users.bio_data.weight_kg` is also updated.

**Blood pressure (`bp_reading`)**

Stored in `health_events`:
```
category:   vitals
source:     manual_photo
data_date:  today (UTC)
external_id: photo_bp_<ISO timestamp, colons/dots stripped>
data: { "bp_systolic": 118, "bp_diastolic": 76, "bp_pulse": 72 }
```

The timestamp-based `external_id` means multiple readings per day are stored as separate rows (valid — BP is typically measured morning and evening).

**Blood glucose (`glucose_reading`)**

Stored in `health_events`:
```
category:   vitals
source:     manual_photo
data_date:  today (UTC)
external_id: photo_glucose_<ISO timestamp, colons/dots stripped>
data: { "glucose_mmol": 5.2, "glucose_context": "fasting | postmeal | null" }
```

### Chat narrative helpers

Server-side functions replace the LLM's free-text reply for device readings.

**`buildWeightNarrative(isZh, weightKg, historicalAvg, isPlausible)`**

Compares new weight against the average of the last 5 body_composition records.
- Plausibility threshold: ±20 kg from historical average (or 20–300 kg range if no history).
- If implausible, the reply flags the discrepancy and asks the user to verify.
- If plausible with history, shows the delta vs. average (e.g. `↓ 0.3 kg`).

**`buildBpNarrative(isZh, systolic, diastolic, pulse)`**

| Condition | Category (zh / en) |
|---|---|
| sys < 120 AND dia < 80 | 正常 / Normal |
| sys 120–129 AND dia < 80 | 血压偏高 / Elevated |
| sys 130–139 OR dia 80–89 | 高血压 I 级 / Stage 1 Hypertension |
| sys ≥ 140 OR dia ≥ 90 | 高血压 II 级 / Stage 2 Hypertension |
| sys > 180 OR dia > 120 | 危急 / Crisis — advises emergency care |

Reference: ACC/AHA 2017 guidelines.

**`buildGlucoseNarrative(isZh, glucoseMmol, context)`**

Context is `'fasting'`, `'postmeal'`, or `null` (unknown). Thresholds differ by context:

| Context | Normal | Slightly elevated | High |
|---|---|---|---|
| Fasting | < 5.6 mmol/L | 5.6–7.0 | ≥ 7.0 |
| Post-meal | < 7.8 mmol/L | 7.8–11.1 | ≥ 11.1 |
| Unknown | < 5.6 mmol/L | 5.6–7.0 | ≥ 7.0 |

Readings below 3.9 mmol/L trigger a hypoglycaemia warning regardless of context.

---

## Miniapp — `user-health` component

### Data loading

`_loadMetricHistory()` is called on every `_loadHealth()`. It fetches the last 60 health events (`GET /api/health-events?openid=...&limit=60`) and extracts per-day histories for six metrics, each deduplicated independently by date:

| History array | Source field | Dedup key |
|---|---|---|
| `stepsHistory` | `activity.steps` | date + seenSteps |
| `hrvHistory` | `vitals.hrv_ms` | date + seenHrv |
| `stressHistory` | `vitals.stress` | date + seenStress |
| `bpHistory` | `vitals.bp_systolic` + `bp_diastolic` | date + seenBp |
| `glucoseHistory` | `vitals.glucose_mmol` | date + seenGlucose |

BMI history is derived client-side from `weightHistory` × `rawHeight` — no extra fetch.

**Why independent deduplication matters for vitals:** The Colmi ring sync writes two `vitals` rows per day — one for resting HR (no HRV/stress) and one for realtime measurements (HRV, stress, SpO₂). A single shared `seen` set would mark the date as processed on whichever row arrived first, silently dropping data from the other. Each metric tracks its own seen-dates.

### Metric strip

The existing metric strip (weight / BMI / steps / HRV / stress) gains tap handlers when history data is available. A `›` hint appears below the label.

Blood pressure and glucose appear in a **secondary strip** below, separated by a subtle border. This row is only rendered when at least one photo reading exists (`wx:if="{{latestBp || latestGlucose}}"`), so it is invisible for users who have never submitted a device photo.

| Value displayed | Source |
|---|---|
| Weight | `rawWeight` from latest body_composition biomarker |
| BMI | Derived from `rawWeight` / `rawHeight²` |
| Steps | `ringData.stepsStr` from today's ring sync |
| HRV | `ringData.hrv` from today's ring sync |
| Stress | `ringData.stress` from today's ring sync |
| Blood pressure | `latestBp.systolic` / `latestBp.diastolic` from latest health_event |
| Blood glucose | `latestGlucose.glucose` from latest health_event |

### Trend charts

All charts open in a bottom-sheet modal (`.wchart-overlay` → `.wchart-sheet`) and draw on a `<canvas>` element using `wx.createCanvasContext`.

| Metric | Canvas ID | Draw function | Color |
|---|---|---|---|
| Weight | `uh-weight-chart-full` | `_drawWeightFullChart()` | `#6375EC` |
| BMI | `uh-bmi-chart` | `_drawGenericChart()` | `#6375EC` |
| Steps | `uh-steps-chart` | `_drawGenericChart()` | `#0ea5e9` |
| HRV | `uh-hrv-chart` | `_drawGenericChart()` | `#10b981` |
| Stress | `uh-stress-chart` | `_drawGenericChart()` | `#f97316` |
| Blood pressure | `uh-bp-chart` | `_drawBpChart()` | SYS `#ef4444` / DIA `#6375EC` |
| Blood glucose | `uh-glucose-chart` | `_drawGenericChart()` | `#a855f7` |

**`_drawGenericChart(canvasId, history, valKey, unit, color)`** — shared implementation. Renders a filled area chart with grid lines, Y-axis labels, date labels on the X-axis (MM-DD), and filled dot markers. Used by BMI, steps, HRV, stress, and glucose.

**`_drawBpChart(W)`** — dedicated implementation for blood pressure. Draws two separate lines on the same canvas: systolic (red) and diastolic (purple). The Y-axis range spans the combined min/max of both series. A SYS/DIA legend is shown above the canvas in the modal header.

---

## Adding a new device type

1. **Prompt** (`systemHealthReport.js`) — add a new Type paragraph (zh + en) describing what to read from the device display. Add the new `content_type` string to the JSON schema block. Add any new fields to the JSON schema.

2. **Handler** (`index.js`, `handlePostAnalyzeImage`) — extract the new fields from `parsed`. Add a unit conversion block if needed. Add a new `else if (contentType === '...')` branch after the glucose block: insert into `health_events` (or `biomarkers`), build a narrative.

3. **Narrative helper** — add a `buildXxxNarrative(isZh, ...)` function near `buildWeightNarrative`. Keep it focused: record the value, classify against a reference range, give one sentence of guidance.

4. **Miniapp** — add the field to `_loadMetricHistory` parsing. Add state vars (`xxxHistory`, `xxxChartOpen`, `xxxChartW`, `latestXxx`). Add display in the metric strip or secondary strip. Add an open/close method and a chart modal with canvas. Use `_drawGenericChart` if it's a single-line metric.
