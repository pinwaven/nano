# Wearable System

Connects Bluetooth smart rings (starting with Colmi) to the WeChat Mini Program and syncs health data to the backend.

## Directory layout

```
src/mini/nano-miniapp/utils/wearable/
  index.js          ← WearableDevice base class + createWearable() factory
  ble-manager.js    ← WeChat wx.* BLE abstraction (scan, connect, notify, write)
  sync.js           ← Brand-agnostic server sync (POST /api/health-events/sync)
  colmi/
    index.js        ← ColmiRing — implements WearableDevice
    protocol.js     ← BLE UUIDs, command bytes, RealTimeReading enum, name prefixes
    packet.js       ← makePacket() / checksum() helpers
    parsers/
      battery.js    ← parseBattery()
      heart-rate.js ← HeartRateLogParser, HeartRateLog
      steps.js      ← SportDetailParser, SportDetail
      sleep.js      ← parseSleepResponse, SleepDay, SleepPeriod
      realtime.js   ← getStartPacket, getContinuePacket, getStopPacket
      time.js       ← setTimePacket
```

## Interface — `WearableDevice`

All brand adapters extend this base class in `utils/wearable/index.js`:

| Method | Returns | Notes |
|---|---|---|
| `connect(deviceId)` | `Promise<void>` | Opens BLE, discovers services, subscribes to notifications, syncs clock |
| `disconnect()` | `Promise<void>` | Closes BLE connection |
| `getBattery()` | `{ level: 0–100, charging: bool }` | |
| `getDeviceInfo()` | `{ name, model, firmware, hardware }` | |
| `getHeartRateLog(date?)` | `[{ value, timestamp }]` | Defaults to today |
| `getSteps(date?)` | `{ steps, calories, distance }` | Defaults to today |
| `getSleep()` | `{ totalMinutes, deep, light, rem, awake, periods }` | Most recent night |
| `getRealtime(type, timeoutMs?)` | `number \| null` | See realtime types below |
| `setTime(date?)` | `Promise<void>` | Defaults to now; called automatically on `connect()` |

### Realtime measurement types

Passed as the first argument to `getRealtime()`:

| Key | Meaning |
|---|---|
| `'heart-rate'` | Instantaneous heart rate (bpm) |
| `'spo2'` | Blood oxygen (%) |
| `'hrv'` | Heart rate variability (ms, RMSSD) — allow 45 s |
| `'pressure'` | Stress score (0–100) — allow 30 s |
| `'blood-pressure'` | Systolic / diastolic |
| `'blood-sugar'` | Blood glucose |
| `'ecg'` | ECG reading |
| `'fatigue'` | Fatigue index |

`timeoutMs` defaults to 30 000 ms. HRV needs at least 45 000 ms.

### Factory

```js
const { createWearable } = require('./utils/wearable/index.js')
const ring = createWearable('colmi')
await ring.connect(deviceId)
```

## Colmi Ring adapter

### BLE transport

Colmi uses two BLE services:

| Service | Purpose | UUID prefix |
|---|---|---|
| UART | Commands + most readings | `6e40fff0…` |
| Big Data | Sleep (bulk transfer) | `de5bf728…` |

Each service has an RX characteristic (write commands to the ring) and a TX characteristic (notifications from the ring).

**UART protocol**: fixed 16-byte packets. Command byte is `packet[0]`. Responses have the same command byte with the high bit possibly set; the adapter masks with `& 0x7f` when matching.

**Big Data protocol**: variable-length multi-chunk stream. The first 4 bytes of the assembled buffer encode the expected total length.

### UUID format quirk

iOS returns BLE UUIDs in uppercase hyphenated format (e.g. `6E40FFF0-B5A3-F393-E0A9-E50E24DCCA9E`). `BLEManager` stores the WeChat-discovered UUID format during `connect()` and resolves it automatically in `write()` — protocol-format (lowercase, no hyphens) strings are safe to use everywhere else.

### Realtime measurement protocol

```
Miniapp → START packet (CMD=0x69, data=[type, 1])
Ring    → many packets (data[2]=0, data[3]=0) while measuring — ignore zeros
Ring    → final packet  (data[2]=0, data[3]=result_value) when done
Miniapp → STOP packet   (CMD=0x6A, data=[type, 0, 0])
```

Response filter: accept packets where `(data[0] & 0x7f) === 0x69`, `data[1] === readingCode`, `data[2] === 0`, `data[3] !== 0`.

**HRV is special**: type=10 streams individual RR intervals in `data[6:7]` (16-bit LE, ms) during measurement. The final RMSSD score appears in `data[3]` of the last packet only (~90-105 s total). All other types complete in ≤30 s.

The R10 does NOT require periodic CONTINUE packets — sending them resets the measurement.

### Scanning

`ColmiRing.scan(timeoutMs?)` scans for 8 s by default and returns `[{ deviceId, name, rssi }]`. It matches devices by name prefix against the list in `protocol.js` (`COLMI_NAME_PREFIXES`), which covers R01–R10, COLMI, and a number of OEM variants.

## Server sync — `sync.js`

`syncWearableData(openid, snapshot)` converts a `WearableSnapshot` into up to 3 `health_events` and POSTs them to `POST /api/health-events/sync`.

### WearableSnapshot shape

```js
{
  source: 'smart_ring',   // brand key — drives deduplication
  steps, calories,
  distance,               // metres
  sleepMinutes, sleepDeep, sleepLight, sleepRem, sleepAwake,
  restingHr,              // bpm
  hrv,                    // ms (RMSSD)
  stress,                 // 0–100
  spo2,                   // % blood oxygen
  syncedAt,               // Date.now()
}
```

### Event mapping

| Fields | category | data_date | external_id |
|---|---|---|---|
| steps, calories, distance | `activity` | today UTC | `smart_ring_activity_YYYY-MM-DD` |
| sleep* | `sleep` | yesterday UTC | `smart_ring_sleep_YYYY-MM-DD` |
| restingHr, hrv, stress, spo2 | `vitals` | today UTC | `smart_ring_vitals_YYYY-MM-DD` |

Sleep is mapped to yesterday because it is overnight data. The `external_id` pattern gives one row per source per category per day; re-syncing the same day updates (`DO UPDATE`) the existing row rather than inserting a duplicate.

### Adding a new wearable brand

1. Create `utils/wearable/<brand>/index.js` extending `WearableDevice`
2. Implement all interface methods
3. Register in `createWearable()` in `utils/wearable/index.js`
4. Call `syncWearableData(openid, { source: '<brand>', ...snapshot })` — no backend changes needed

## Sleep parser — known protocol behaviour

### NODATA periods map to AWAKE

The ring emits `SleepType.NO_DATA (0)` when it cannot classify a sleep stage — typically when the user is lying awake and still, or when the PPG sensor loses contact. These periods are encoded in the raw packet exactly like any other stage (`type=0, minutes=N`) but were historically discarded by earlier parsers.

**Both parsers now map `NODATA → AWAKE` instead of discarding:**
- `src/mini/nano-miniapp/utils/wearable/colmi/parsers/sleep.js`
- `tools/colmi-ring/src/sleep.js`

**Why this matters:** A real capture showed a `NODATA, 178` entry (178 min) between two sleep blocks — a 03:36–06:34 awake window that was completely invisible before the fix. Discarding it made `totalMinutes` inconsistent with the `sleepStart`/`sleepEnd` window stored in the packet.

### Sleep anchor timestamps

The ring stores `sleepStart` and major transition events (wake onset, sleep end) as **absolute timestamps** (minutes after midnight). Stage durations are fitted within those anchors. This is why two rings worn simultaneously agree on sleep-start and awake-onset to the minute even when individual stage classifications differ.

---

## OEM readiness

This section documents what is fully implemented, what gaps remain, and what to negotiate in an OEM deal with Colmi (or a compatible ODM).

### Fully implemented — carries over to any Colmi-compatible OEM ring

| Feature | Miniapp | CLI tool |
|---|---|---|
| BLE scan (name-prefix filter) | ✓ | ✓ |
| Connect / disconnect | ✓ | ✓ |
| Clock sync (set-time + capability flags) | ✓ | ✓ |
| Battery level + charging state | ✓ | ✓ |
| Heart rate log (historical, 5-min slots, multi-packet) | ✓ | ✓ |
| Heart rate log settings (interval, enable/disable) | — | ✓ |
| Steps (daily total + 15-min slots, BCD dates, new calorie protocol) | ✓ | ✓ |
| Sleep (all nights, stage parsing, NODATA→AWAKE fix) | ✓ | ✓ |
| Real-time heart rate | ✓ | ✓ |
| Real-time SpO2 | ✓ | ✓ |
| Real-time HRV (RMSSD, ~90 s measurement) | ✓ | ✓ |
| Real-time stress / pressure (0–100) | ✓ | ✓ |
| Real-time blood pressure | ✓ | ✓ |
| Real-time blood sugar | ✓ | ✓ |
| Real-time ECG | ✓ | ✓ |
| Real-time fatigue | ✓ | ✓ |
| Full sync to SQLite (for debugging / data export) | — | ✓ |
| Raw packet capture + debug mode | — | ✓ |
| Reboot | — | ✓ |
| Server sync (WearableSnapshot → /api/health-events/sync) | ✓ | — |
| Brand-agnostic adapter pattern (WearableDevice + createWearable) | ✓ | — |

### Not yet implemented

| Feature | Notes |
|---|---|
| Historical stress log (command 55) | Only real-time; ring stores a daily log but parser not built |
| Historical HRV log (command 57) | Only real-time; same situation |
| Historical SpO2 log (Big Data ID 42) | Protocol documented in `bigdata.md`; parser not built |
| Temperature (if device supports) | `mSupportTemperature` flag exists in `parseSetTimePacket`; no parser |
| Continuous overnight SpO2 | Requires dual PPG (green + red/IR) — current R02/R10 do not support |
| Sleep apnea detection | Depends on overnight SpO2; not possible on current hardware |
| Second-hand device firmware version | Neither ring exposes the GATT Device Info service (0x180A) |

### Architecture strengths for OEM transition

The miniapp BLE layer is already brand-agnostic:

- **`WearableDevice` base class** — adding a new brand means implementing one class with defined method signatures. The rest of the miniapp is unaffected.
- **`createWearable(brand)` factory** — callers never import Colmi directly; switching hardware = add one entry to the factory.
- **`syncWearableData`** — normalised `WearableSnapshot` is brand-neutral; no backend changes needed when adding a new ring brand.
- **Modular parsers** — each protocol feature is an isolated file. Updating for a new firmware version or different OEM variant = edit one parser, not the whole adapter.

### What to negotiate in an OEM deal

1. **Written BLE protocol documentation** — the current implementation is reverse-engineered from packet captures. At production scale, undocumented protocol changes in firmware updates can silently break data collection. A documented protocol is a contract.

2. **Firmware version stability** — the R02 and R10 differ significantly in sleep algorithm behaviour (R02 detected REM throughout; R10 classified the same periods as Light). Firmware updates can change this without notice. Pin the firmware version or require change notification.

3. **Dual PPG (green + red/IR)** — required for continuous overnight SpO2 and sleep apnea detection. Specify this as a hardware requirement, not an optional feature.

4. **White-label firmware** — remove Colmi branding from the ring's own UI (step count display, notification text, etc.) so the device presents as a Waven product.

5. **Protocol access for new models** — if the OEM releases new hardware (e.g. R20), protocol documentation for new commands should be covered in the agreement before the device ships.

6. **`COLMI_NAME_PREFIXES` in `protocol.js`** — the scan filter currently lists known Colmi advertisement name prefixes. Under OEM, the ring will advertise under a custom name (e.g. `WAVEN R1`). Update this list before shipping.

### Adding a second ring brand

If evaluating RingConn or another ODM in parallel:

1. Reverse-engineer (or obtain) BLE protocol documentation
2. Create `utils/wearable/ringconn/index.js` extending `WearableDevice`
3. Add `'ringconn'` to `createWearable()` in `utils/wearable/index.js`
4. No backend, sync, or UI changes required

---

## UI — `user-health` component

The wearable section lives inside the **Real-time Health Data** block of the Health tab (`user-health.wxml`).

### State

| Data key | Type | Purpose |
|---|---|---|
| `wearableId` | string | BLE deviceId of bound ring ('' = none) |
| `wearableName` | string | Display name |
| `wearableConnected` | bool | Set true after a successful sync |
| `wearableBattery` | number | Last known battery % |
| `wearableBusy` | bool | Guards against concurrent syncs |
| `ringData` | object | Processed display data from `_buildRingDisplayData()` |

### Lifecycle

- `attached()` → `_loadWearableFromStorage()` restores bound device and last ring snapshot; rebuilds visuals immediately from local storage so the section is populated before any network call completes.
- `handleBindWearable()` — scans for nearby Colmi rings, shows a picker, connects, saves to `wx.setStorageSync('wearable_device', { deviceId, name })`.
- `handleSyncWearable()` — connects, collects battery / steps / sleep / HR log / HRV / stress, stores raw data to `wx.setStorageSync('wearable_ring_data', raw)`, fires `syncWearableData()` to server (fire-and-forget), then calls `_loadHealthTwin()` to refresh server-backed aggregates.
- `handleUnbindWearable()` — clears both storage keys and resets all wearable state.

### Local storage keys

| Key | Content |
|---|---|
| `wearable_device` | `{ deviceId, name }` — bound device |
| `wearable_ring_data` | Raw last-sync snapshot (WearableSnapshot shape) |
