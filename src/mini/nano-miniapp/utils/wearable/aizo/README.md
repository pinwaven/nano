# Aizo / Infinity Ring — WeChat Miniapp Adapter

`AizoRing` (in `index.js`) is the WeChat-miniapp `WearableDevice` implementation
for the Aizo "Infinity" smart ring, used by `components/user-health/user-health.js`
via `createWearable('aizo')` (`../index.js`).

This is one of three copies of the same verified protocol in this codebase —
keep them in sync when the wire protocol itself changes:

| Copy | Transport | Purpose |
|---|---|---|
| `~/waven/aizoring/src/aizo_protocol.js` | `@abandonware/noble` (Node) | Original reverse-engineering + standalone CLI (`connect_ring.js`) |
| `nano/tools/aizoring/src/protocol.js` | `@abandonware/noble` (Node) | Same CLI, vendored into the monorepo (replaced the old, incomplete `tools/infinity`) |
| `nano/src/mini/nano-miniapp/utils/wearable/aizo/protocol.js` (this file's sibling) | `wx.*` BLE APIs (WeChat) | Production miniapp integration |

Protocol-level facts (frame format, CRC16, command opcodes, record layouts) are
documented in `nano/tools/aizoring/docs/protocol_spec.md` — that's the
canonical spec; nothing protocol-specific is duplicated here. This README only
covers what's specific to the **miniapp integration**: the `AizoRing` API
surface and the bugs that only showed up in this environment.

## This replaced an earlier, broken port

The previous `protocol.js`/`index.js` here were a port of `temp/aizo/src/aizo_protocol.js`
— the *pre-correction* frame format (a fake `[0x02,seq][cmdId]` header instead
of the real `len(2BE)·ctrl(2)·sn(2BE)` framing), with no health/sleep/sport
history sync at all. Both files were rewritten from the verified protocol.

## API surface (`AizoRing`)

Implements the `WearableDevice` contract (`connect`, `disconnect`, `getBattery`,
`getDeviceInfo`, `setTime`, `getSteps`, `getSleep`, `getHeartRateLog`,
`getRealtime`) plus Aizo-specific extras mirroring Halo's richer getters so the
two brands sync with comparable detail in `user-health.js`:

- `getHrvHistory(daysBack=2)` → `[{timestamp, hrv, stress, breath, heartRate, highBP, lowBP}]`
- `getAutoSpo2History(daysBack=2)` → `[{timestamp, spo2}]`
- `getTemperatureHistory(daysBack=2)` → `[{timestamp, estimatedBodyTemp, skinTemp, status}]`
- `getSleepHistory()` → `[{date, onset, totalMinutes, deep, light, rem, awake, sleepStart, sleepEnd, periods}]`
- `getHealthHistory(dateMs)` → raw per-sample records (the source all of the above are derived from)
- `measure(type)` / `getMeasureInterval()` / `setMeasureInterval()` / `getStressInterval()` / `setStressInterval()`
- `syncAll()` → a full `WearableSnapshot`-shaped object (see `../sync.js`)

All of `getHrvHistory`/`getAutoSpo2History`/`getTemperatureHistory`/
`getHeartRateLog` are derived from the **same** underlying `0xCC61`
health-history sync — a single request returns HR+HRV+SpO2+stress+temperature
together per sample, unlike Halo which needs a separate BLE request per metric
type. `_getHealthHistoryCached` memoizes per-day within a connection so calling
several of these getters back-to-back (as `syncAll()` does) doesn't re-fetch
the same day repeatedly.

Timestamps throughout are `"YYYY-MM-DD HH:MM:SS"` strings (local wall-clock),
matching the convention used by the rest of this codebase's non-Halo timestamp
handling — not `Date` objects.

## Bugs found only in this environment

These were specific to the WeChat/live-phone environment and didn't show up
when the same protocol logic was tested against captured hardware frames in
plain Node (see [[nano-tools-aizoring]] memory for the porting-time bugs found
that way — bad step/calorie scaling, sleep-end/period math, a request
cross-talk race). Two more surfaced only once this ran on a real device:

1. **Bind timeout — missing BLE MTU negotiation.** The shared `../ble-manager.js`
   never called `wx.setBLEMTU`, so writes were capped at the ~20-byte default
   unnegotiated ATT MTU. This never mattered for Halo (its packets are always
   exactly 16 bytes) or Colmi, but Aizo's bind request is ~65 bytes — it was
   silently failing or arriving truncated, so the ring never sent back an auth
   response and `bind()` timed out every time. Fixed in `../ble-manager.js`'s
   `connect()`: `wx.setBLEMTU({ deviceId, mtu: 247 })` right after
   `createBLEConnection`, best-effort (Android needs it; iOS negotiates MTU on
   its own and doesn't support the call, so a `fail` there is expected and
   harmless). This fix is in the *shared* transport, so it benefits every
   brand, not just Aizo.

2. **"Current stress" showing `—` despite a populated stress trend chart.**
   HR and stress are on independent auto-monitor schedules on this ring (HR
   ticks ~every 20 min, stress ~every 45 min — see protocol spec §6.0.1), so a
   single health-history sample frequently has one field populated and the
   other `0`/null. The trend chart aggregates across *all* samples (so it
   always finds a stress value if one exists that day), but the "current"
   single-value display was picking the **chronologically last** sample and
   reading `.stress` off it — if that last sample happened to be an HR-only
   tick, `.stress` was null even though an earlier same-day sample had a real
   reading. Halo's equivalent code doesn't have this problem because its
   single HRV measurement always returns hrv+stress+breath+bp together in one
   record. Fixed in both `syncAll()` (this file) and the `user-health.js` aizo
   sync branch: scan backward **per field** (`hrv`, `stress` independently)
   for the last sample that actually has that value, instead of taking the
   last array element and reading both fields off it.

## Known gaps

- Sport/workout detail (`0x9642`) and end-of-upload (`0x9644`) opcodes are
  pattern-inferred, not yet observed live (no recorded workouts to trigger
  them) — not wired into this adapter at all yet, only into the CLI's `sport`
  probe mode.
- `getRealtime('hrv' | 'blood-pressure' | 'pressure' | 'blood-sugar')` always
  returns `null` — this firmware doesn't support spot-measuring stress/HRV
  (it needs a sustained window), and Aizo has no blood pressure or blood sugar
  sensor at all.
