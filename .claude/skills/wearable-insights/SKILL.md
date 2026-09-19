---
name: wearable-insights
description: Rules for wearable insights over synced ring data (lib/wearableAnalysis.js) and 心电节律 ECG rhythm strips from the V8 band (POST /api/ecg, components/ecg-record). Load when touching ring analysis, readiness/HRV, or ECG.
---

Moved verbatim from `CLAUDE.md` on 2026-09-19 (section numbers kept; `§N` references point at `CLAUDE.md`).

## 44. Wearable Insights — analysis over synced ring data — Rules

`lib/wearableAnalysis.js` turns the last 30 days of `health_events` ring data into a
codes-and-numbers `insights` object (personal HRV baseline/band, z-scores, readiness, sleep
debt/regularity, stress balance, anomaly flags), stored on `health_twin.wearable_insights` at
every sync and recomputed fresh by `GET /api/wearable-insights`. Twin layer 2 (§34). Record:
[docs/architecture/wearable-insights.md](docs/architecture/wearable-insights.md).

- **Everything is relative to the user's own history, never an absolute cut.** Halo/V8 give a
  vendor HRV *index* (no RR intervals — §18), so "80ms = good" means nothing; "12% below your
  30-day mean" does. z-scores exclude the day being judged. Under 3 HRV days: nothing but
  sleep; under 7: no flags; under 14: `provisional: true`, readiness still shown.
- **`strain_watch` needs all three signals** (HRV z ≤ −1, resting HR z ≥ +1, skin temp
  ≥ +0.3 °C) and is worded 负荷 / strain at every surface — a rest nudge, never illness. Stress
  `balance` requires HRV to agree with the stress byte (the byte was inverted once, §18); a
  "high-stress reading" is above the user's own p75, never a fixed value.
- **Copy lives in two places only**: the miniapp's `insight*` `T` keys (both languages) and
  `describeWearableInsights()` / `summarizeInsightsLine()` in the lib — the `PACKAGE_STAGES`
  split from §28. The object carries no prose; the prompt block states no threshold (a test
  greps for it). A new driver/flag code needs `insightDriver_*` / `insightFlag_*` in both `T`
  blocks and in `DRIVER_TEXT` / `FLAG_TEXT`.
- The lib is pure: no DB, no `data.actual`, no date formatting — `today` is supplied by the
  caller as a Shanghai `YYYY-MM-DD`. Per-reading input comes from `fetchHrvReadings()`, whose
  measurement time is the 14-digit tail of the `_hrv_` external_id, never `recorded_at` first.
- Chat reads the **stored** copy (`llmContext.wearable_insights`, rendered by
  `wearableDailyBlock.js`; `contextDates()` allow-lists its dates); the health tab reads the
  **fresh** endpoint ("today" moves at midnight). `updateHealthTwin` computes it in its own
  try/catch and never COALESCEs it. **Deploy order: migrate, then the worker** — the twin
  upsert, the check-in SELECT and `twinBundle` all name the column.
- Not synced yet: nightly RMSSD (`HaloRing.getSleepHrv()`, 0x60). When it is, attach it to the
  per-night sleep event, Halo only, and leave V8 `null` (§18).

## 45. 心电节律 — ECG Rhythm Strips from the V8 Band — Rules

V8 only (§18; Halo has no ECG opcode). A 30 s single-lead strip recorded by
`components/ecg-record/` through `V8Band.recordEcg()`, analysed and stored by `POST /api/ecg`
(`handlers/ecg.js`, `lib/ecgAnalysis.js`), surfaced as the 心电节律 card in the health tab's
日常监测 section. Twin layer 2 (§34): the summary is a `health_events` row, category `ecg`; the
waveform is 24-bit packed in OSS under `ecg/<user_id>/…`, never returned as a key. Firmware
record and every "why": `tools/halo/README.md` "ECG", `docs/architecture/v8-smart-band.md` §6.

- **It is rhythm, not a diagnosis.** The band gives dimensionless counts with no voltage scale
  and ships no analysis. Every surface says 节律记录 / rhythm strip; nothing may say 心电图诊断
  or name a condition. A test greps the copy.
- **Contact owns the measurement.** Wrist + a finger from the other hand on the electrode, or the
  band aborts within ~3 s — `9525CA`-class units emit nothing at all. A zero-packet or
  noise-only capture is explained as "lift the finger, place it again", never as an error.
- **`duration` is seconds from the `0x28` command and is the only stop.** The adapter asks for
  the capture length; the SDK's `open=0` pair stops nothing (the band buffers ~50–60 s while the
  tap is closed and flushes it on the next tap open — `analyzeEcg` splits that backlog off).
  Never re-send `0x28` onto a running measurement to stop it.
- **The server refuses, never repairs**: fewer than `ECG_MIN_ACCEPTED_BEATS` (10) clean beats or
  `peak_snr` under 3.5 → `poor_contact`, nothing stored. Quality stays visible on every stored
  summary (`peak_snr`, `rr_sd_ms`, `rejected_intervals`).
- Ownership is the health-documents pattern (`_resolveOwner`; a coach reads, never writes).
  `oss_key` never leaves the server. No chat tool yet — adding one is a §21/§28 change (PLAN and
  JUDGE must be taught it).
- The web user-app shows the card read-only (recording needs BLE).
