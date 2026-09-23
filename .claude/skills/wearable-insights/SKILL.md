---
name: wearable-insights
description: Rules for wearable insights over synced ring data (lib/wearableAnalysis.js) and the 心电节律 ECG / 脉搏波 PPG strips from the V8 band and Halo ring (POST /api/ecg, POST /api/ppg, components/strip-record). Load when touching ring analysis, readiness/HRV, ECG or PPG.
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

## 45. 心电节律 / 脉搏波 — ECG and PPG Strips from the Wearables — Rules

Two raw strips, one overlay, one architecture. **ECG** is V8 only (§18; Halo has no electrode):
a 30 s single-lead strip through `V8Band.recordEcg()`, analysed and stored by `POST /api/ecg`
(`handlers/ecg.js`, `lib/ecgAnalysis.js`). **PPG** (脉搏波, 2026-09-20) streams from the V8 band
*and* the Halo ring: 60 s of the raw optical channel at 50 Hz through `recordPpg()` on both
adapters, analysed and stored by `POST /api/ppg` (`handlers/ppg.js`, `lib/ppgAnalysis.js`). Both
are recorded and viewed by `components/strip-record/` (`kind="ecg"|"ppg"`, one instance hosted by
`user-health`, switched by `data-kind`) and surfaced as the 心电节律 / 脉搏波 cards in the health
tab's 日常监测 section. Twin layer 2 (§34): each summary is a `health_events` row, category `ecg`
or `ppg`, `source` = the brand; the waveform is 24-bit packed in OSS under `ecg/<user_id>/…` or
`ppg/<user_id>/…`, never returned as a key. Firmware record and every "why":
`tools/halo/README.md` "ECG" / "PPG", `docs/architecture/v8-smart-band.md` §6,
`halo-smart-ring.md` §3.12–3.13.

- **PPG is the SDK's "blood glucose" tap and nothing more.** `0x78` start/stop/quit, `0x3a`
  frames of 50 × 4-byte BE samples, one per second; the vendor meant it to feed a grading server
  nano does not have. Every surface says 脉搏波 / pulse wave and states it is not an oxygen or
  glucose reading; a test greps the copy. Single channel, no documented LED/gain — no SpO₂ from
  it, ever.
- **The pulse is a few percent of the light level and the device re-ranges its gain on motion.**
  `analyzePpg` high-passes (0.5 s), blanks the 2 s settling ramp and ±(0.5 s, 1 s) around every
  >20 % single-sample step, detects systolic peaks with a **400 ms** refractory (longer than the
  ECG's 300 ms so the dicrotic wave is not a beat), and gates on **regularity** (≥ 60 % of
  accepted intervals within ±20 % of the median), **amplitude consistency** (CV ≤ 1.0) and ≥ 15
  beats. A peak/noise ratio and a spectral peak were tried and did not separate a loose wrist
  from a finger — the band's wander is itself quasi-periodic. A marginal wrist signal is refused
  as `poor_contact` and the UI asks for a snug strap and a still hand; never repaired.
- The Halo-only `0x11` "real-time PPG/PPI" path acks and streams nothing on `X3B 69526`;
  `HaloRing.startPpgStream()` is non-functional until a ring produces a frame.

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
- **The server refuses, never repairs** (both kinds): ECG with fewer than
  `ECG_MIN_ACCEPTED_BEATS` (10) clean beats or `peak_snr` under 3.5 → `poor_contact`, nothing
  stored. Quality stays visible on every stored summary (`peak_snr`, `rr_sd_ms`,
  `rejected_intervals`).
- Ownership is the health-documents pattern (`_resolveOwner`; a coach reads, never writes).
  `oss_key` never leaves the server. No chat tool yet — adding one is a §21/§28 change (PLAN and
  JUDGE must be taught it).
- The web user-app shows both cards read-only (recording needs BLE).
- Summary field names are shared between the two kinds (`bpm`, `accepted_beats`,
  `rr_median_ms`, `rr_sd_ms`, `rejected_intervals`, `sample_rate_hz`, `duration_seconds`) so one
  card and one overlay render both; PPG adds `regular_fraction`, `amplitude_cv`,
  `discontinuities`. The ECG rules above (contact, `duration`, backlog) are ECG-only.

## Sleep rows — two normalisations every reader relies on (2026-09-23)

`fetchWearableDaily` is the one place a day's sleep row is shaped for the model, `wearableAnalysis`
and the insights; keep both rules there rather than re-deriving them per reader.

- **An all-zero stage split is unknown, not zero.** V8 reports no stages (§18); until `0923-2` the
  miniapp summed those nulls into `0`s, and the prompt told a user their night had 0% deep+REM.
  `stagesKnown` nulls the four stage fields; `restorative_pct` and `avg_deep_sleep_pct` skip such
  nights. `avg_deep_sleep_pct` is deep+**REM** — label it that way.
- **Onset/wake come from the longest session** (`mainSleepSession`), never from the stored
  `sleep_start_min`, which is a min() over minute-of-day and let a 06:28 top-up beat a 21:25 night.
- **Say "not measured" in words, never as `null`.** The per-day line renders 「设备未测量睡眠分期」
  and `get_wearable_daily` swaps the four null stage fields for `sleep_stages`; a bare null read
  to the model as "no deep sleep recorded". Chat reads the *stored* twin, so a change to these
  rules needs `temp/recompute-health-twin-sleep.js` (or a ring sync) before it shows in replies.
