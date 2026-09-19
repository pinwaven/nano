# Wearable Insights — analysis over synced ring data

*2026-09-19.* Twin layer 2 (日常监测, [digital-twin.md](digital-twin.md)). This is the record; the rules
that must hold are CLAUDE.md §44.

## Why

The health tab rendered every ring number as an absolute with a hard-coded colour cut
(`hrv >= 80 ? blue : …`), and the server's whole wearable vocabulary was `health_twin.avg_hrv_ms`
plus a trend word. Halo/V8 expose a **vendor HRV index per reading** — a scalar, no RR intervals
([halo-smart-ring.md](halo-smart-ring.md) §4.5) — so an absolute cut is meaningless for it while
"12% below your own 30-day mean" is not. Everything here is relative to the user's own history.

## Shape

```
fetchWearableDaily(pool, user, 30)  ─┐
fetchHrvReadings(pool, user, 30)    ─┼─▶ analyzeWearable({daily, readings, today}) ─▶ insights
today (Shanghai date)               ─┘        lib/wearableAnalysis.js — pure, DB-free
```

- `lib/wearableDaily.js` already produced the per-day rows (2026-09-15); `fetchHrvReadings` is the
  one addition — per-reading `{date, hour, hrv_ms, stress, heart_rate}`, with the measurement
  time taken from the 14-digit tail of `sync.js`'s `${src}_hrv_${YYYYMMDDHHmmss}` external_id
  (the miniapp's `_tsFromExtId` reads the same thing; `recorded_at` only as a fallback).
- `insights` is **codes and numbers, no prose**: `data_quality`, `baseline` (7d/30d means, SD,
  CV, p10–p90 band, resting HR), `today` (z-scores, band position, skin-temp delta), `readiness`
  (score, level, components, driver codes), `sleep` (last night vs week, debt vs 7.5h target,
  bedtime SD over 14 days), `stress` (load share, balance, night/day ratio, peak hour,
  weekend delta), `anomaly.flags[]` (`hrv_drop` / `low_streak` / `strain_watch`, each with a
  `since` date and evidence).
- Copy lives in exactly two places: the miniapp's `T` blocks (`insight*` keys, both languages)
  and `describeWearableInsights()` / `summarizeInsightsLine()` in the lib — the
  `PACKAGE_STAGES` / `pkgStage_*` split from §28.

## Where it goes

| Consumer | Read | Note |
|---|---|---|
| `GET /api/wearable-insights?openid=&coach_id=` | recomputed fresh | "today" moves at midnight; coach access = the `users.coach_id` check from `handleGetUserFacts` |
| `health_twin.wearable_insights` (migration `migration_health_twin_wearable_insights.sql`) | written by `updateHealthTwin` on every sync, own try/catch, never COALESCEd | the cheap copy for prompts |
| chat (`llmContext.wearable_insights`) | stored copy | rendered under the per-day rows by `prompts/chat/wearableDailyBlock.js`; `contextDates()` allow-lists its dates for grounding |
| daily check-in (both personas) | stored copy | one sentence, `summarizeInsightsLine()` |
| Viva AG twin bundle | stored copy | `layers.daily_monitoring.health_twin.wearable_insights`, `bundle_version` 5 |
| miniapp 洞察 card (`components/user-health/`) | fresh endpoint | self + coach view; `_buildInsightsView()`; the 7-day HRV bars are recoloured against the band by `_applyBandToHrvBars()` |

## Rules encoded (tests: `tests/wearable-analysis.test.js`)

- z-scores against the user's **own** history, excluding the day being judged. Under 3 HRV
  days nothing but sleep; under 7 no flags; under 14 `provisional: true` (readiness still shown).
- Readiness = clamp(70 + 15·hrv_z − 8·rhr_z + 7·sleep_z, 0, 100); "your normal is ready".
  Missing component = 0, not a penalty. Levels 70 / 45.
- `strain_watch` needs **all three** (HRV z ≤ −1, resting HR z ≥ +1, skin temp ≥ +0.3 °C).
  It is worded as 负荷 / strain everywhere — a rest nudge, never illness.
- Stress `balance` requires HRV to move the same way as the stress byte (the byte was inverted
  once, §18); the byte alone is "balanced".
- A "high-stress reading" is one **above the user's own 30-day p75** (`stress.high_cut`,
  `high_cut_personal: true`), the fixed 60 only under 40 readings. Found live: a ring idling at
  50–58 all day gave `load_7d: 0` against a fixed 60 — the absolute-cut mistake, again.
- The prompt block leaks no threshold (a test greps for SD / z-score / ≥ 60).

## Verified live on dev (2026-09-19)

`GET /api/wearable-insights` for two Halo users with 25–27 HRV days; `health_twin.wearable_insights`
populated by a `POST /health-events/sync`; the 洞察 card rendered in both languages via the automator
(9 chips, none empty; band-relative bar colours); a 「我最近恢复得怎么样？压力大吗？」 turn cited the
+22%-vs-baseline HRV, resting HR vs 7-day mean, last night's restorative share and the stress load —
content that exists only in the insights block — unstripped by JUDGE. Noted, pre-existing: the model
invents weekday names for ISO dates (09-14 labelled 周四); nothing in the block supplies weekdays.

## Not done yet

- Nightly RMSSD (`HaloRing.getSleepHrv()`, 0x60) is parsed but never synced; the sleep-HRV
  trajectory metric waits on attaching `rmssd_samples` to the per-night sleep event. Halo only.
- Web user-app parity (`src/web/user-app/src/health/HealthTab.jsx`) and a readiness column in
  the coach roster.
