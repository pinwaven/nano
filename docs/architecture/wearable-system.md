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
Miniapp → START packet (CMD=105, type, action=1)
Ring    → ACK packet    (data[2]=1: "measuring started") — ignore, keep waiting
Ring    → CONTINUE packets every few seconds while measuring
Miniapp → CONTINUE packet every 5 s (keeps session alive)
Ring    → RESULT packet  (data[2]=0: "complete", data[3]=value)
Miniapp → STOP packet    (CMD=106)
```

The key invariant: `data[2] !== 0` means still in progress — do not resolve early.

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
  hrv,                    // ms
  stress,                 // 0–100
  syncedAt,               // Date.now()
}
```

### Event mapping

| Fields | category | data_date | external_id |
|---|---|---|---|
| steps, calories, distance | `activity` | today UTC | `smart_ring_activity_YYYY-MM-DD` |
| sleep* | `sleep` | yesterday UTC | `smart_ring_sleep_YYYY-MM-DD` |
| restingHr, hrv, stress | `vitals` | today UTC | `smart_ring_vitals_YYYY-MM-DD` |

Sleep is mapped to yesterday because it is overnight data. The `external_id` pattern gives one row per source per category per day; re-syncing the same day updates (`DO UPDATE`) the existing row rather than inserting a duplicate.

### Adding a new wearable brand

1. Create `utils/wearable/<brand>/index.js` extending `WearableDevice`
2. Implement all interface methods
3. Register in `createWearable()` in `utils/wearable/index.js`
4. Call `syncWearableData(openid, { source: '<brand>', ...snapshot })` — no backend changes needed

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
