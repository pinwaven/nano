# Halo Smart Ring — BLE Protocol & Integration Reference

> **Support status:** as of 2026-07, Halo — the underlying hardware/protocol family is X3/X6/X9 (rings) and V4 (band); BLE-advertised names literally start with those prefixes, the manufacturer's own model designations — is the **only actively supported ring family**. Colmi and Aizo adapters remain in the codebase for existing bound users but are not being extended — see CLAUDE.md §18. All new wearable work targets this document's protocol.

This document covers the full BLE protocol of the X3/X6/X9/V4 hardware family (product name: Halo) and its integration in `src/mini/nano-miniapp/utils/wearable/halo/`. Source material: reverse-engineered Android SDK in `temp/x3/` (X3/X6) — protocol confirmed identical for X9 and the V4 band; no separate SDK dump exists for those yet.

> **Related device:** V8, a smart band from the same hardware team, is a close protocol relative (same GATT UUIDs, same frame format, ~20 shared opcodes) but is CLI-only so far — no miniapp adapter yet. See [`v8-smart-band.md`](v8-smart-band.md), particularly its §1 for exactly where the two protocols diverge.

---

## 1. BLE GATT Structure

The ring exposes a single custom service with two characteristics.

| Role | Full UUID | Short |
|---|---|---|
| **Service** | `0000fff0-0000-1000-8000-00805f9b34fb` | `FFF0` |
| **Write (host → ring)** | `0000fff6-0000-1000-8000-00805f9b34fb` | `FFF6` |
| **Notify (ring → host)** | `0000fff7-0000-1000-8000-00805f9b34fb` | `FFF7` |

> **WeChat BLE UUID normalization:** WeChat returns service/characteristic UUIDs in full 128-bit form with dashes (e.g. `0000FFF0-0000-1000-8000-00805F9B34FB`). The `BLEManager._normalizeUUID()` helper strips dashes and lowercases, but does **not** expand short UUIDs. Always define X3 UUIDs in their normalized full form (no dashes, lowercase) as done in `halo/protocol.js` — never as the short 4-character alias.

Advertisement names begin with `X3` (covering X3B, X3C, X3D, …), `X6` (X6F, X6E, X6B, …), `X9`, or `V4` (the band form factor) — stored in `HALO_NAME_PREFIXES = ['X3', 'X6', 'X9', 'V4']`. All four hardware lines use the identical BLE GATT structure and command set; no protocol differences have been observed across them. All are handled by the same `HaloRing` adapter.

---

## 2. Command Frame Format

Every write to FFF6 is exactly **16 bytes**.

```
Byte 0   : Command ID
Bytes 1–14: Payload parameters (zero-padded)
Byte 15  : Checksum — sum of bytes 0–14, masked to 8 bits (& 0xFF)
```

### BCD Encoding

Dates and times in both commands and responses use Binary Coded Decimal. Each decimal digit occupies 4 bits: `26` → `0x26`, `09` → `0x09`. The helper `decToBcd(val)` in `protocol.js` converts decimal to BCD. `bcdToString(byte)` converts a BCD byte back to a 2-character string.

### History Sync Mode Byte (`value[1]`)

All history read commands (`0x51`–`0x66`) share the same mode convention:

| Value | Meaning |
|---|---|
| `0x00` | Read latest (up to ~50 records) |
| `0x01` | Read from a specific BCD date (`value[4..9]`) |
| `0x02` | Continue from last read position |
| `0x99` | Delete all historical data for this type |

The BCD date filter occupies bytes 4–9: `Year, Month, Day, Hour, Min, Sec`.

---

## 3. Commands (Host → Ring)

### 3.1 Set Time (`0x01`)
Syncs the ring clock to the host's current time.

```
value[0] = 0x01
value[1] = Year  (BCD, 2-digit: 2026 → 0x26)
value[2] = Month (BCD)
value[3] = Day   (BCD)
value[4] = Hour  (BCD)
value[5] = Minute(BCD)
value[6] = Second(BCD)
value[8] = Timezone:
           GMT+X → X + 0x80  (GMT+8 = 0x88)
           GMT-X → X          (GMT-5 = 0x05)
```

Response: `0x01` — acknowledgement only, no data.

### 3.2 Get Time (`0x41`)
Returns the ring's current clock. Response includes the timestamp as a string.

### 3.3 Set Personal Profile (`0x02`)
```
value[1] = Gender (1=Male, 0=Female)
value[2] = Age    (years)
value[3] = Height (cm)
value[4] = Weight (kg)
value[5] = Stride length (cm)
```

### 3.4 Get Battery (`0x13`)
No payload. Response:
```
value[1] = Battery level (0–100 %)
value[2] = Charging state (1 = charging, 0 = not charging)
```

### 3.5 Get MAC Address (`0x22`)
No payload. Response contains 6-byte MAC.

### 3.6 Get Firmware Version (`0x27`)
No payload. Response contains version string bytes.

### 3.7 Factory Reset (`0x12`) / MCU Soft Reset (`0x2E`)
No payload. Both return acknowledgement.

### 3.8 Set/Get Basic Ring Parameters (`0x03` / `0x04`)
```
Set (0x03):
  value[1] = Hand: 0=Left, 1=Right
  value[2] = Auto-motion detection: 0=Off, 1=On

Get (0x04) response:
  value[3] = 0x80=Left, 0x81=Right
  value[4] = 0x80=Disabled, 0x81=Enabled
  value[10] = EOV detection status
```

### 3.9 Set Auto-Monitoring (`0x2A`) / Get Auto-Monitoring Settings (`0x2B`)
Configure or query the ring's background measurement schedule.

```
Set (0x2A):
  value[1] = Work mode: 0=Off, 1=Continuous, 2=Scheduled
  value[2] = Start hour   (BCD)
  value[3] = Start minute (BCD)
  value[4] = End hour     (BCD)
  value[5] = End minute   (BCD)
  value[6] = Weekday bitmask (bit0=Mon … bit6=Sun; 0x7F = all days)
  value[7] = Interval minutes (low byte)
  value[8] = Interval minutes (high byte)
  value[9] = Type: 1=HeartRate, 2=SpO2, 3=Temperature, 4=HRV

Get (0x2B):
  value[1] = Type to query (same codes as above)
```

Get response mirrors the Set payload layout.

### 3.10 Real-time Step / Temperature Streaming (`0x09`)
```
value[1] = 1=Start steps, 0=Stop
value[2] = 1=Start temperature, 0=Stop
```

While active, the ring broadcasts 25-byte `0x09` packets every second (see §4.1).

### 3.11 Trigger Manual Health Measurement (`0x28`)
```
value[1] = Type: 1=HRV, 2=HeartRate, 3=SpO2
value[2] = State: 1=Start, 0=Stop
value[4] = Duration in seconds (min 30)
```

The ring sends a start-ACK immediately, then a result packet when measurement completes (see §4.8). HRV, heart rate, SpO2, and stress all arrive in the same result packet.

### 3.12 Blood Glucose PPG Capture (`0x78`)
5-minute PPG collection for server-side glucose estimation:

| `value[1]` | Meaning |
|---|---|
| `1` | Start PPG data collection |
| `2` | Send result to ring (`value[2]`: 0=Fail, 1=Low, 2=Normal, 3=High) |
| `3` | Stop PPG collection |
| `4` | Send timing progress (`value[2]`: 0–100%) |
| `5` | Exit PPG mode |

Raw PPG data streams on CMD `0x3A` as 153- or 203-byte packets.

### 3.13 Real-time PPG / PPI Streaming (`0x11`)
```
value[1] = 1=Start, 0=Stop
```

Streams raw PPG waveform points (32-bit Big-Endian) for signal analysis.

---

## 4. History Sync Commands & Response Formats

All history commands stream multi-packet responses terminated by `0xFF` in the last byte (or the pattern `[…, cmdId, 0xFF]` for sleep). Responses are accumulated in a `Uint8Array` buffer.

### 4.1 Daily Activity Summary (`0x51` → 26 or 27-byte records)
```
value[2..4]   = Date BCD (Year, Month, Day)
value[5..8]   = Steps          (4-byte LE int)
value[9..12]  = Exercise time  (4-byte LE int, minutes)
value[13..16] = Distance       (4-byte LE int ÷ 100 = km)
value[17..20] = Calories       (4-byte LE int ÷ 100 = kcal)
```

Record size is 26 or 27 bytes — detect by checking `buf.length % 26 === 0`.

### 4.2 Detailed Activity Logs (`0x52` → 25-byte records, 10-minute blocks)
```
value[0]    = 0x52
value[3..8] = BCD timestamp (start of 10-minute block)
value[9..10]  = Total steps   (2-byte LE)
value[11..12] = Calories      (2-byte LE ÷ 100)
value[13..14] = Distance      (2-byte LE × 10 = metres)
value[15..24] = Per-minute step counts (10 × 1-byte)
```

### 4.3 Sleep History (`0x53`)
Two modes based on packet size:

**1-minute mode** (130-byte single record):
```
value[3..8]  = BCD base timestamp
value[9]     = sleepLength (number of stages)
value[10..N] = Stage bytes (1 per minute)
```

**5-minute mode** (34-byte records):
```
value[0]     = 0x53
value[3..8]  = BCD base timestamp
value[9]     = sleepLength
value[10..N] = Stage bytes (1 per 5 minutes)
```

Stream ends when the last two bytes are `[0x53, 0xFF]`.

**Sleep stage values:**
| Byte | Stage |
|---|---|
| `1` | Deep Sleep |
| `2` | Light Sleep |
| `3` | REM Sleep |
| `0` | Awake |

### 4.4 Static Heart Rate (`0x55` → 10-byte records)
```
value[0]    = 0x55
value[3..8] = BCD timestamp (with seconds)
value[9]    = Heart rate (bpm); skip if 0 or 0xFF
```

### 4.5 HRV History (`0x56` → 15-byte records)
```
value[0]    = 0x56
value[3..8] = BCD timestamp
value[9]    = HRV index      (ms)
value[10]   = Breath rate proxy (breaths/min)
value[11]   = Heart rate     (bpm)
value[12]   = Stress / tiredness index (0–100)
value[13]   = Systolic BP proxy (mmHg)
value[14]   = Diastolic BP proxy (mmHg)
```

> **Deduplication:** The ring sends the full batch twice in a single BLE response. `_parseHrvRecords56` deduplicates by timestamp using a `Set` before returning.

### 4.6 Auto SpO2 History (`0x66` → 10-byte records)
```
value[0]    = 0x66
value[3..8] = BCD timestamp
value[9]    = Blood oxygen %  (skip if 0 or 0xFF)
```

### 4.7 Detailed SpO2 (`0x57` → 30-byte records)
```
value[3..8]  = BCD base timestamp
value[10..29] = 20 SpO2 samples (1 byte each, 30-second intervals)
```

### 4.8 Skin Temperature (`0x62` → 15-byte records)
```
value[3..8]   = BCD timestamp
value[9..10]  = NTC 1 skin temp    (2-byte int × 0.1 = °C)
value[11..12] = NTC 2 ambient temp (2-byte int × 0.1 = °C)
value[13..14] = NTC 3 shell temp   (2-byte int × 0.1 = °C)
```

Estimated body temperature is derived by comparing the three NTC sensors (algorithm in `temp/x3/docs/smart_ring_x3_ble_protocol.md` §4.4).

### 4.9 Sleep HRV / RMSSD (`0x60` → 69-byte records)
```
value[3..8]  = BCD timestamp
value[9..68] = 30 RMSSD samples (2-byte LE each, in ms)
```

### 4.10 Exercise Sessions (`0x5C`)
```
value[3..8]   = BCD workout start timestamp
value[9]      = Sport mode ID (0=Run, 1=Cycling, …)
value[10]     = Avg heart rate (bpm)
value[11..12] = Active duration (seconds, 2-byte)
value[13..14] = Steps (2-byte)
value[17..20] = Calories (4-byte IEEE 754 float, kcal)
value[21..24] = Distance (4-byte IEEE 754 float, km)
```

### 4.11 Sleep Apnea Risk (`0x5F`)
```
value[3..8] = BCD timestamp
value[9]    = OSA risk: 16=no result, 0/1=low, 2=mild, 3=severe
```

### 4.12 Elevated Oxygen Variation (`0x5D`)
```
value[3..8]   = BCD timestamp
value[9]      = Risk event count
value[10]     = N (data length)
value[11..N+11] = Variation score bytes
```

---

## 5. Real-time Broadcast (`0x09`)

While step/temperature streaming is active, the ring sends 25-byte packets each second:
```
value[0]     = 0x09
value[1..4]  = Cumulative steps      (4-byte LE)
value[5..8]  = Calories              (4-byte LE ÷ 100 = kcal)
value[9..12] = Distance              (4-byte LE ÷ 100 = metres)
value[13..16]= Active duration       (4-byte LE, seconds)
value[17..20]= Total exercise time   (4-byte LE)
value[21]    = Heart rate            (bpm)
value[22..23]= Skin temperature      (2-byte LE × 0.1 = °C)
value[24]    = Blood oxygen SpO2     (%)
```

---

## 6. Manual Measurement Result (`0x28`)

Start-ACK packet: 16 bytes, `value[2] = 1`, all measurement bytes zero → in progress.

Final result packet (all measurements together):
```
value[1] = Measurement type (1=HRV, 2=HR, 3=SpO2)
value[2] = Heart rate        (bpm)
value[3] = Blood oxygen      (%)
value[4] = HRV index         (ms)
value[5] = Stress level
value[6] = Systolic BP proxy  (mmHg)
value[7] = Diastolic BP proxy (mmHg)
```

The `HaloRing.getRealtime()` implementation caches the paired metric: when requesting HRV (type `1`), the response also contains stress in `value[5]`, and vice versa. The cached value is returned on the next `getRealtime('pressure')` call without sending another command.

---

## 7. Current Mini Program Integration

**Files:**
- `src/mini/nano-miniapp/utils/wearable/halo/protocol.js` — UUID constants, checksum, `buildCommand`, BCD helpers, all packet builders
- `src/mini/nano-miniapp/utils/wearable/halo/index.js` — `HaloRing` class extending `WearableDevice`
- `src/mini/nano-miniapp/utils/wearable/index.js` — factory registers brand `'halo'` (accepts legacy `'x3'` as an alias)
- `src/mini/nano-miniapp/utils/wearable/sync.js` — `syncWearableData()` maps a `WearableSnapshot` to `health_events` and POSTs to `/api/health-events/sync`

**What the current sync pulls on each connection (`handleSyncWearable`):**

| Data | Method | Command | Sent to backend as |
|---|---|---|---|
| Battery level (local only) | `getBattery()` | `0x13` | not synced |
| Steps + 15-min slots | `getSteps()` | `0x51` + `0x52` | `activity` event |
| Last night's sleep | `getSleep()` | `0x53` | `sleep` event |
| Static HR log | `getHeartRateLog()` | `0x55` | `vitals` event (resting HR + `hr_slots`) |
| All-day HRV readings | `getHrvLog()` | `0x56` | one `vitals` event **per reading** (`external_id = smart_ring_hrv_<ts>`) |
| All-day SpO2 readings | `getSpo2Log()` | `0x66` | one `vitals` event **per reading** (`external_id = smart_ring_spo2_<ts>`) |

Per-measurement storage means a typical daily sync produces ~24 `health_events` rows (15 HRV + 6 SpO2 + 1 activity + 1 sleep + 1 resting-HR vitals). Repeated syncs upsert the same rows via `ON CONFLICT (user_id, source, external_id)` — no duplicates accumulate.

**Not yet wired into `handleSyncWearable`** (available methods, not yet called):

| Method | Data |
|---|---|
| `getHeartRateHistory()` | Continuous HR — 15 samples per 15-min window (0x54) |
| `getSleepHistory()` | All cached nights (use instead of `getSleep()` for multi-night view) |
| `getSleepHrv()` | Per-period RMSSD during sleep (0x60) |
| `getTemperatureLog()` | Skin / body / ambient temperature (0x62) |
| `getSleepTemperatureLog()` | Temperature sampled during sleep (0x69) |
| `getExerciseSessions()` | Sport mode sessions with pace, HR, distance (0x5C) |
| `getSleepApneaRisk()` | OSA risk level per night (0x5F) |
| `getOxygenVariation()` | Elevated SpO2 variation events (0x5D) |

Wire these in when the health tab UI is ready to display the corresponding dimensions.

**Brand detection during scan:**
```js
const isHalo = HALO_NAME_PREFIXES.some((p) => nameLower.startsWith(p.toLowerCase()))
const brand = isAizo ? 'aizo' : (isHalo ? 'halo' : 'colmi')
```
X6/X9/V4 devices are all mapped to brand `'halo'` because they share the same protocol and `HaloRing` adapter — checked against `HALO_NAME_PREFIXES` directly rather than hardcoding each prefix, so adding a new model line only requires updating that one array.

**Halo sync is single-phase** (no real-time measurement step) — all data is historical log data read off the ring directly. Colmi requires a second phase for on-demand HRV/SpO2.

---

## 7a. BLE Concurrency Constraint

`HaloRing._send(packet, expectedCmdId)` registers a single `notifyHandler` slot on the FFF7 characteristic. Only one pending command can wait for a response at a time.

**Do not use `Promise.all` to issue multiple ring commands concurrently.** Each call to `_send` overwrites the shared `notifyHandler`. If you fire four commands in parallel, only the last-registered handler is active when the ring's first response arrives — the other three callers will timeout.

```js
// WRONG — 3 of 4 calls will timeout
const [s1, s2, s3, s4] = await Promise.all([
  ring.getAutoMonitoring(1),
  ring.getAutoMonitoring(2),
  ring.getAutoMonitoring(3),
  ring.getAutoMonitoring(4),
])

// CORRECT — sequential, each waits for its own response
const s1 = await ring.getAutoMonitoring(1)
const s2 = await ring.getAutoMonitoring(2)
const s3 = await ring.getAutoMonitoring(3)
const s4 = await ring.getAutoMonitoring(4)
```

**Always close the BLE connection in a `finally` block.** If a command throws (timeout, BLE error), execution jumps to `catch`, skipping any `ring.disconnect()` call placed inside `try`. A leaked connection prevents re-connection until the WeChat BLE adapter is reset. Pattern:

```js
const ring = createWearable('halo')
try {
  await ring.connect(deviceId)
  // ... sequential ring commands ...
} catch (e) {
  // handle error
} finally {
  ring.disconnect().catch(() => {})   // always runs, even on throw
}
```

---

## 7b. Ring Settings Panel (`toggleRingSettings` / `saveRingIntervals`)

The ⚙ button in the health tab opens a panel showing the four auto-monitoring intervals. Pressing it triggers `toggleRingSettings()` in `user-health.js`.

**Open flow:**
1. For non-Halo brands: opens immediately with no BLE call.
2. For Halo: connects, reads intervals for all four types **sequentially** (HR → SpO2 → Temp → HRV), disconnects in `finally`, then populates `haloIntervals` state. While reading, `ringSettingsBusy = true` shows a loading row.
3. On failure: silently falls back to locally cached intervals (last values saved to `halo_interval_settings`).

**Change detection:** `handleIntervalChange` sets `haloIntervalsChanged = true`. The Save button appears only when this is true.

**Save flow (`saveRingIntervals`):**
1. Connects to ring.
2. Calls `setAutoMonitoring` for each of the four types **sequentially** with `workMode: 1` (Continuous), 00:00–23:59 window, all weekdays (`0x7F`).
3. On success: persists `haloIntervals` to `wx.setStorageSync('halo_interval_settings', …)`, clears the change flag (Save button hides).
4. On failure: shows `wearableSyncFail` toast; logs error to console for DevTools inspection.
5. `ring.disconnect()` always runs in `finally`.

The Save path **does not** call `getAutoMonitoring` — it writes the current UI state directly to the ring.

---

## 7c. Realtime Readings Display (Halo vs Colmi)

The "readings" list beneath the ring card (`ringData.realtimeReadings`) works differently per brand.

**Colmi (on-demand, Phase 2):**  
After each manual measurement, `_commitRingData` appends `{ t, hrv, stress, spo2, … }` to `wearable_realtime_today` in local storage, keyed by today's date. On the next page load, `_getRealtimeReadings` retrieves today's accumulated list. This captures multiple on-demand readings taken throughout a single day.

**Halo (auto-monitoring, synced from ring buffer):**  
The ring's auto-monitoring already produces a full day of timed readings stored in `raw.hrvSlots` and `raw.spo2Slots`. Pushing `raw.hrv` (always the latest ring reading) into `wearable_realtime_today` on every sync would accumulate identical values with different sync timestamps — showing the same reading three times after three syncs.

Halo therefore **bypasses `wearable_realtime_today` entirely** and builds `realtimeReadings` from the slot arrays using `_slotsToReadings(hrvSlots, spo2Slots)`:

```
_slotsToReadings:
  merge HRV and SpO2 slots by timestamp
  convert ring timestamp strings ('2026-06-20 14:30:12', CST)
  to Unix ms via new Date(ts.replace(' ', 'T') + '+08:00').getTime()
  return sorted by timestamp, each record shaped for _fmtRealtimeReadings
```

This means the health tab for Halo users shows one entry per ring auto-measurement (e.g. one HRV reading every 60 min), not one entry per sync session.

The branch in `_commitRingData`:
```js
const rawReadings = raw.hrvSlots != null
  ? _slotsToReadings(raw.hrvSlots, raw.spo2Slots)  // Halo
  : _getRealtimeReadings(raw.syncedAt)              // Colmi
```

`_loadWearableFromStorage` (page-load restore from `wearable_ring_data`) applies the same branch.

---

## 8. Full API Reference (`HaloRing`)

All methods are `async` and throw on BLE error or timeout. `date` parameters default to today (CST) when omitted. Timestamps in returned objects are `'YYYY-MM-DD HH:MM:SS'` strings in CST; history arrays are sorted **oldest-first**.

### Device lifecycle

| Method | Command | Returns |
|---|---|---|
| `static scan(timeoutMs?)` | — | `[{ deviceId, name, rssi }]` |
| `connect(deviceId, { syncTime? })` | — | — |
| `disconnect()` | — | — |

### Device info

| Method | Command | Returns |
|---|---|---|
| `getBattery()` | `0x13` | `{ level: number, charging: boolean }` |
| `getDeviceTime()` | `0x41` | `Date` (CST) or `null` |
| `getMac()` | `0x22` | `'AA:BB:CC:DD:EE:FF'` |
| `getFirmwareVersion()` | `0x27` | `'1.2.3.4'` |
| `setTime(date?)` | `0x01` | — |

### Ring configuration

| Method | Command | Returns |
|---|---|---|
| `setBasicParameters(rightHand, autoMotion)` | `0x03` | — |
| `getBasicParameters()` | `0x04` | `{ rightHand: bool, autoMotion: bool, eov: number }` |
| `setPersonalProfile({ gender, age, height, weight, stride })` | `0x02` | — |
| `getPersonalProfile()` | `0x42` | `{ gender: 'male'\|'female', age, height, weight, stride }` |
| `setAutoMonitoring({ workMode, startHour, startMinute, endHour, endMinute, weekdays, intervalMinutes, type })` | `0x2A` | — |
| `getAutoMonitoring(type)` | `0x2B` | `{ workMode, startTime, endTime, weekdays, intervalMinutes, type }` |

`type`: `1`=HR · `2`=SpO2 · `3`=Temperature · `4`=HRV  
`workMode`: `0`=Off · `1`=Continuous · `2`=Scheduled

### Maintenance

| Method | Command |
|---|---|
| `factoryReset()` | `0x12` |
| `mcuReset()` | `0x2E` |

### Daily health history

All history methods accept an optional `date` (JS `Date`); default is today in CST.

#### Steps — `getSteps(date?)`  `0x51` + `0x52`
```
{ steps, calories, distance (metres), slots: [{ t, steps, cal, dist }] }
```
`slots` — one entry per 15-min window containing steps, calories (kcal), and distance (m) for that slot. `t` is an ISO 8601 string (`'2026-06-20T09:00:00+08:00'`).

#### Static heart rate — `getHeartRateLog(date?)`  `0x55`
```
[{ value: bpm, timestamp: Date }]
```
One entry per 5-min auto-monitoring reading. Filter `value === 0 || value === 0xFF` already done.

#### Continuous heart rate — `getHeartRateHistory(date?)`  `0x54`
```
[{ date: '2026-06-20 09:00:00', hrSamples: [bpm, …] }]
```
Each record covers a ~15-min window and contains 15 individual bpm samples.

#### HRV + stress + BP — `getHrvHistory()`  `0x56`
```
[{ timestamp, hrv, breath, heartRate, stress, highBP, lowBP }]
```
All cached days (~3), sorted oldest-first, duplicates removed. Nil fields (`0` or `0xFF` from ring) are returned as `null`.

#### `getHrvLog(date?)`  `0x56`
`getHrvHistory()` filtered to one date. Same record shape.

#### Stress log — `getStressLog(date?)`  `0x56`
```
[{ timestamp, stress }]
```
Derived from `getHrvHistory()` — one BLE fetch, filtered to records with a non-null stress value.

#### Auto SpO2 — `getAutoSpo2History()`  `0x66`
```
[{ timestamp, spo2 }]
```
All cached days (~3), sorted oldest-first, duplicates removed.

#### `getSpo2Log(date?)`  `0x66`
`getAutoSpo2History()` filtered to one date.

#### Detailed SpO2 — `getSpo2History(date?)`  `0x57`
```
[{ date: '2026-06-20 09:00:00', samples: [%, …] }]
```
Each record spans ~10 minutes with 20 SpO2 samples at 30-second intervals.

#### Temperature — `getTemperatureLog(date?)`  `0x62`
```
[{ date, skinTemp, ambientTemp, shellTemp, estimatedBodyTemp, status }]
```
All temps in °C. `status`: `1`=Cold · `2`=Normal · `3`=SlightlyElevated · `4`=Fever · `5`=HighFever · `6`=Error

#### Exercise sessions — `getExerciseSessions(date?)`  `0x5C`
```
[{ date, sportMode, avgHeartRate, durationSec, steps, paceMin, paceSec, calories, distanceKm }]
```
`sportMode` codes: `0`=Run · `1`=Cycling · `2`=Badminton · `3`=Football · `4`=Tennis · `5`=Yoga · `6`=Meditation · `7`=Dance · `8`=Basketball · `9`=Walk · `10`=Workout · `11`=Cricket · `12`=Hiking · `13`=Aerobics · `14`=Ping-Pong · `15`=Rope Jump · `16`=Sit-ups

#### Sleep apnea risk — `getSleepApneaRisk(date?)`  `0x5F`
```
[{ date, riskLevel }]
```
`riskLevel`: `16`=no result · `0`/`1`=low · `2`=mild · `3`=severe

#### Elevated oxygen variation — `getOxygenVariation(date?)`  `0x5D`
```
[{ date, riskCount, variationList: number[] }]
```

### Sleep history

#### `getSleepHistory()`  `0x53`
```
[{
  date,          // 'YYYY-MM-DD' — evening calendar date (night of Jun 19 → '2026-06-19')
  onset,         // 'YYYY-MM-DD HH:MM:SS' — actual sleep start timestamp (CST)
  totalMinutes,
  deep, light, rem, awake,       // minutes in each stage
  sleepStart,    // minutes after midnight (onset as number)
  sleepEnd,      // sleepStart + totalMinutes
  periods: [{ type: 0|1|2|3, typeName: 'awake'|'deep'|'light'|'rem', minutes }]
}]
```
Sorted oldest → newest. Up to ~3 nights cached on ring. Blocks before noon CST are mapped to the previous calendar night.

#### `getSleep()`  `0x53`
Last element of `getSleepHistory()`. Returns an empty summary `{ totalMinutes: 0, … }` if no data.

### Sleep diagnostics

#### Sleep HRV / RMSSD — `getSleepHrv(date?)`  `0x60`
```
[{ date: '2026-06-20 22:00:00', rmssd: [ms, …] }]
```
30 RMSSD samples per record (2-byte LE each), one record per sleep period.

#### Sleep body temperature — `getSleepTemperatureLog(date?)`  `0x69`
```
[{ date, samples: [{ skinTemp, ambientTemp, shellTemp, estimatedBodyTemp, status }] }]
```
10 NTC-triple samples per record.

### Real-time & streaming

#### On-demand measurement — `getRealtime(type, timeoutMs?)`  `0x28`
`type`: `'heart-rate'` · `'spo2'` · `'hrv'` · `'pressure'`  
Returns the measured value as a number (bpm / % / ms / 0–100), or `null` on timeout (default 30 s).

HRV and pressure (`stress`) arrive in the same ring response. Requesting either caches the other so the second call returns immediately without a second BLE round-trip.

#### Live step/temp stream — `startRealtimeStream(cb, { steps?, temp? })`  `0x09`
`cb` receives `{ steps, calories, distanceKm, exerciseMinutes, heartRate, tempC, spo2 }` every ~1 s. Call `stopRealtimeStream()` to end.

### Blood glucose PPG session

Five-step flow using command `0x78`:

```js
await ring.startBloodGlucose(({ samples, total }) => { /* live progress */ })
// every ~30 s:
await ring.sendBloodGlucoseProgress(pct)   // 0–100
// when server responds:
const rawSamples = await ring.stopBloodGlucose()   // upload these to server
await ring.sendBloodGlucoseResult(status)  // 0=fail 1=low 2=normal 3=high
await ring.exitBloodGlucose()
```

### Raw PPG waveform stream  `0x11`

```js
await ring.startPpgStream(({ points }) => { /* 32-bit BE intensity values */ })
await ring.stopPpgStream()
```

---

## 9. Incremental Sync

Implemented 2026-07-30 for HRV (`0x56`), SpO2 (`0x66`), and temperature
(`0x62`). Extended 2026-07-31 to steps detail (`0x52`) and sleep (`0x53`)
after a real end-to-end sync on a live ring still took ~30s post-fix — the
original assumption that steps/sleep were "cheap, a handful of records" was
wrong on real hardware; they were the actual remaining bottleneck once
HRV/SpO2/temp dropped to ~180ms combined. Static HR (`0x55`) enabled for
Halo the same day, after an initial "inconclusive/broken" misdiagnosis was
corrected — see the dedicated note at the end of this section.

`getHeartRateLog(date, sinceDate)`, `getHrvHistory(sinceDate)`,
`getAutoSpo2History(sinceDate)`, `getTemperatureHistory(sinceDate)`
(`utils/wearable/halo/index.js`) now accept an optional trailing `sinceDate`
— when given, the packet builder is called with `(0x01, sinceDate)` instead
of the default `()` (mode `0x00`):

```js
function getHrvHistoryPacket(mode, dateFilter) {
  return buildCommand(0x56, buildHistorySyncPayload(mode || 0, dateFilter || null))
}
async getHrvHistory(sinceDate) {
  const buf = await this._stream(getHrvHistoryPacket(sinceDate ? 0x01 : 0, sinceDate || null), 0x56, ...)
  return _parseHrvRecords56(buf)
}
```

No dedicated `halo_last_sync` storage key: `handleSyncWearable()`
(`components/user-health/user-health.js`) derives each type's cursor from
the max timestamp already present in the previously stored
`wearable_ring_data` slot array (`hrSlots[].t`, `hrvSlots[].timestamp`,
`spo2Slots[].timestamp`, `tempSlots[].date`), so the cursor's lifecycle
automatically matches the data's own (cleared on unbind, advanced only on a
successful commit). A cursor older than ~4 days or a fresh bind (no previous
data) skips the incremental attempt and falls back to full fetch (heuristic
only, not a correctness requirement — see below). Newly-fetched records are
merged into the previous snapshot (`_mergeRingSlots()`, keyed by each type's
natural timestamp field, new wins on collision) and trimmed to a 7-day local
retention window — this also fixes a latent bug where a failed or empty
per-type fetch used to overwrite the whole previous snapshot with `null`.

**Critical, live-confirmed constraint — no safety margin, exact timestamp
only.** Validated 2026-07-30 against a real V8 band (`tools/halo --device v8
history`, see `docs/architecture/v8-smart-band.md` §"History sync mode
byte" for the full test matrix): mode `0x01` requires `since` to *exactly*
match one of the device's own stored record timestamps, to the second. The
matched record is included (inclusive boundary), but any other value —
including a deliberately "conservative" offset like 5 minutes earlier —
makes the device silently return its **entire** history instead, exactly
like mode `0x00`, defeating the optimization. `_deriveSinceDate()` therefore
passes the exact last-known timestamp with no margin; this is safe because
it's a real value the ring itself produced, not an independently-derived
"now" subject to clock drift. A stale/purged cursor degrades gracefully to
the same full-history fallback rather than losing data, which is why the
4-day staleness check above is only a "don't bother attempting" heuristic.

**Support is per-command, confirmed live on both a V8 band and a real Halo
X3 ring (2026-07-31, `tools/halo history` against unit `X3B 53687`).** HRV
(`0x56`), SpO2 (`0x66`), and temperature (`0x62`) all honor mode `0x01`
under the same exact-timestamp requirement described above — verified with
the same test matrix as the V8 run: `since` = the exact latest record
returns `count=1` (that record, inclusive); `since` = that same timestamp
minus one second falls back to full history every time (600 HRV / 1200 SpO2
/ 800 temp records on this unit — SpO2 and temperature's full fetches were
themselves hitting the 8s stream timeout, returning a truncated 50-packet
partial result, exactly the case this feature avoids by never requesting
the untruncated backlog); `since` = an exact record from 24h earlier
correctly returned a 23-record window. Static HR (`0x55`) was inconclusive
on this unit too (zero records in any mode) — both the Halo and V8 test
units happened to have no static HR log data, so this one command remains
unverified pending a unit that actually has some. To re-run this validation
against a different unit or after a protocol change:

```bash
node bin/cli.js history --type hrv --json                              # baseline, mode 0x00
node bin/cli.js history --type hrv --since <baseline's exact "last" value> --json  # mode 0x01, expect count=1
```

### Steps (`0x52`) — confirmed working, one open reliability question

`getSteps(date, sinceDate)` applies `sinceDate` to the `0x52` detail-block
stream only — `0x51` (the daily summary) always stays a full fresh read
since it's a small, continuously-updating running total for the day, not
append-only history. Same exact-match mechanism as HRV/SpO2/temp, confirmed
on the Halo X3 unit: a clean isolated request with the fresh exact cursor
returned in 36-64ms (vs. an 8s timeout on the 450-record full fetch).

**Not yet fully explained**: in one combined two-sync test (full baseline
sync immediately followed by an incremental sync using cursors derived from
that baseline), the `0x52` incremental request fell back to the full 8s
timeout despite using what should have been a valid exact-match cursor —
even though two separate isolated tests (fresh connection, cursor fetched
immediately beforehand) both succeeded cleanly. Two plausible causes,
neither confirmed: (a) BLE session/notification-handler strain carrying over
from the immediately-preceding heavy 5-command baseline sync (all five of
HRV/SpO2/temp/steps-detail/sleep hit their timeout ceilings in that same
baseline pass), or (b) `0x52`'s buffer may rotate/evict faster than
HRV/SpO2/temp's, so a cursor that was exactly correct at capture time could
already be stale by the time it's used, if a lot of new detail-block data
landed in between (steps/sleep testing round-trips on this unit routinely
took 30-45s+ end to end, plenty of time for this). This degrades gracefully
either way — worst case is identical to pre-fix behavior (full fetch, no
data loss) — but don't assume 0x52 incremental is as consistently fast as
HRV/SpO2/temp without more testing across a range of real sync intervals.

### Sleep (`0x53`) — confirmed working, refactored around raw blocks

Unlike the flat per-reading types, sleep's night/session-grouping algorithm
(gap-based session splitting, multi-block night reconstruction) needs the
*complete* set of a night's raw blocks to produce a correct summary — a
"only this sync's new blocks" fetch can't be summarized in isolation.
`_parseSleepHistory(buf)` was split into `_parseSleepBlocks(buf)` (already
existed) and a new `_summariseSleepBlocks(blocks)` (the extracted
grouping/session-split/summarize logic); `_parseSleepHistory` is now just
`_summariseSleepBlocks(_parseSleepBlocks(buf))`, unchanged behavior for
existing full-fetch callers. A new `getSleepBlocks(sinceDate)` returns raw
blocks only; `handleSyncWearable()` merges these with the previous sync's
raw blocks (`wearable_ring_data.sleepBlocks`, a new local-only field — never
sent to the server, `sync.js` only reads the existing summarized fields)
via the same generic `_mergeRingSlots()` used elsewhere (keyed by each
block's own `dateStr`), then re-derives night summaries from the merged set.

Confirmed on the Halo X3 unit: an isolated exact-match request returned in
64ms (132 bytes = one 130-byte block + terminator) vs. 15s (the full
timeout ceiling) for the baseline fetch. One flaky run produced a full
"zero data received" failure on both an exact-match and a mismatched
request in the same connection — traced to BLE session strain from stacking
three heavy `0x53` requests back-to-back (the app only ever issues one
`0x53` request per sync, so this specific failure mode shouldn't reproduce
in real usage), not a genuine protocol difference; a clean single request as
the first operation on a fresh connection worked correctly both for an
exact match and for a deliberate mismatch (correctly falling back to full
history), matching every other type's behavior.

**Extended to V8 on 2026-07-31.** V8's sleep reassembly model is
structurally different (per-notification parsed chunks, not Halo's
concatenated-raw-buffer model; see `docs/architecture/v8-smart-band.md` §3),
so `v8/index.js`'s existing inline grouping/session-split logic (previously
only reachable via the full-fetch `getSleepHistory()`) was split the same
way as Halo's: a new `getSleepBlocks(sinceDate)` returns raw blocks, and the
grouping logic was extracted into a static `V8Band.summariseSleepBlocks()`.
`handleSyncWearable()` picks whichever brand's summarizer function to call
at runtime; both feed the same shared `_mergeRingSlots()` merge. Validated
live via `tools/halo --device v8` (direct `getSleepDataPacket(0x01, ...)`
calls, not yet through the miniapp's own `wx.*`-based `v8/index.js`, which
can't run outside the Mini Program runtime): exact-match `since` → 62ms,
count=1, identical pattern to every other confirmed command.
`INCREMENTAL_SUPPORT.v8.sleep = true`.

### Static HR (`0x55`) — resolved 2026-07-31, was a test-timing artifact, not a real problem

Both the V8 and Halo X3 test units initially returned **zero static-HR
records in every test, including full mode-`0x00` fetches**, despite each
still costing the full 8s timeout — which looked at the time like the
terminator notification never arriving for an empty stream. **That
diagnosis was wrong.** Inspecting the *raw, unfiltered* bytes on a re-test
(bypassing `_parseHrLog55`'s day-scope filter) showed the Halo X3 unit
actually had **1200 real records with valid HR values, spanning 12 days,
streamed newest-first** — the same shape as every other confirmed type.
Both original "zero record" test rounds simply happened to run before the
ring had logged its first static-HR sample of the *current calendar day* —
`getHeartRateLog()`'s `todayStr` filter (matching its documented purpose:
return only today's readings) correctly zeroed out an otherwise-full
multi-day backlog every time, an artifact of *when* the test ran, unrelated
to the command, protocol, or timeout mechanism.

Re-tested with real same-day data present: exact-match `since` → 64ms,
`count=1` (inclusive boundary, identical to HRV/SpO2/temp/steps); a 1-second
mismatch → full 8s timeout, 1200-record fallback (same pattern as
everywhere else). **Enabled for Halo** (`INCREMENTAL_SUPPORT.halo.hr =
true`) — `_sinceHr` is only derived when the previous sync's `hrSlots` are
from *today* (same day-scoping the type already needed, per
`getHeartRateLog(date, sinceDate)`'s existing `date` param), consistent with
how `_parseHrLog55` only ever returns today's readings anyway. **V8 was not
re-tested this round** — its original "zero records" result is presumed to
be the same test-timing artifact given the identical underlying mechanism,
but that's an inference, not a confirmed result; `INCREMENTAL_SUPPORT.v8.hr`
stays `false` until it's actually re-checked with real hardware.
