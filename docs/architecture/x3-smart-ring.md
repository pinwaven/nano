# X3 Smart Ring — BLE Protocol & Integration Reference

This document covers the full BLE protocol of the X3 Smart Ring and its integration in `src/mini/nano-miniapp/utils/wearable/x3/`. Source material: reverse-engineered Android SDK in `temp/x3/`.

---

## 1. BLE GATT Structure

The ring exposes a single custom service with two characteristics.

| Role | Full UUID | Short |
|---|---|---|
| **Service** | `0000fff0-0000-1000-8000-00805f9b34fb` | `FFF0` |
| **Write (host → ring)** | `0000fff6-0000-1000-8000-00805f9b34fb` | `FFF6` |
| **Notify (ring → host)** | `0000fff7-0000-1000-8000-00805f9b34fb` | `FFF7` |

> **WeChat BLE UUID normalization:** WeChat returns service/characteristic UUIDs in full 128-bit form with dashes (e.g. `0000FFF0-0000-1000-8000-00805F9B34FB`). The `BLEManager._normalizeUUID()` helper strips dashes and lowercases, but does **not** expand short UUIDs. Always define X3 UUIDs in their normalized full form (no dashes, lowercase) as done in `x3/protocol.js` — never as the short 4-character alias.

Advertisement names begin with `X3` or `X3B` — used for scanning in `X3_NAME_PREFIXES`.

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
value[10]   = Breath proxy
value[11]   = Heart rate     (bpm)
value[12]   = Stress / tiredness index
value[13]   = Mood / systolic BP proxy
value[14]   = Breath rate / diastolic BP proxy
```

The most recent record for today is the one used for the daily sync.

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

The `X3Ring.getRealtime()` implementation caches the paired metric: when requesting HRV (type `1`), the response also contains stress in `value[5]`, and vice versa. The cached value is returned on the next `getRealtime('pressure')` call without sending another command.

---

## 7. Current Mini Program Integration

**Files:**
- `src/mini/nano-miniapp/utils/wearable/x3/protocol.js` — UUID constants, checksum, `buildCommand`, BCD helpers, all packet builders
- `src/mini/nano-miniapp/utils/wearable/x3/index.js` — `X3Ring` class extending `WearableDevice`
- `src/mini/nano-miniapp/utils/wearable/index.js` — factory registers brand `'x3'`

**What the current sync pulls on each connection (`handleSyncWearable`):**
| Data | Method | Command |
|---|---|---|
| Battery | `getBattery()` | `0x13` |
| Steps summary | `getSteps()` | `0x51` + `0x52` |
| Sleep | `getSleep()` | `0x53` |
| Static heart rate | `getHeartRateLog()` | `0x55` |
| HRV + stress | `getHrvLog()` | `0x56` |
| Auto SpO2 | `getSpo2Log()` | `0x66` |

The additional methods (`getTemperatureLog`, `getExerciseSessions`, `getSleepApneaRisk`, etc.) are available but not yet called from `handleSyncWearable` — wire them in when the health tab UI is ready to display those dimensions.

**Brand detection during scan:**
```js
const brand = chosen.name.startsWith('X3') ? 'x3' : 'colmi'
```

**X3 sync is single-phase** (no real-time measurement step) — all data is historical log data read off the ring directly. Colmi requires a second phase for on-demand HRV/SpO2.

---

## 8. Full Command Coverage

All X3 BLE commands are implemented in `x3/index.js`. The table below lists every public method:

| Method | Command | Returns |
|---|---|---|
| `getBattery()` | `0x13` | `{ level, charging }` |
| `setTime(date)` | `0x01` | ack |
| `getDeviceTime()` | `0x41` | `Date` |
| `getMac()` | `0x22` | MAC string |
| `getFirmwareVersion()` | `0x27` | version string |
| `factoryReset()` | `0x12` | ack |
| `mcuReset()` | `0x2E` | ack |
| `setBasicParameters(rHand, autoMo)` | `0x03` | ack |
| `getBasicParameters()` | `0x04` | `{ rightHand, autoMotion, eov }` |
| `setPersonalProfile(p)` | `0x02` | ack |
| `getPersonalProfile()` | `0x42` | `{ gender, age, height, weight, stride }` |
| `setAutoMonitoring(s)` | `0x2A` | ack |
| `getAutoMonitoring(type)` | `0x2B` | schedule object |
| `getSteps(date)` | `0x51` + `0x52` | `{ steps, calories, distance, slots }` |
| `getSleep()` | `0x53` | `{ totalMinutes, deep, light, rem, awake, periods, sleepStart, sleepEnd }` |
| `getHeartRateLog(date)` | `0x55` | `[{ value, timestamp }]` |
| `getHeartRateHistory(date)` | `0x54` | `[{ date, hrSamples }]` — 15 samples/record |
| `getHrvLog(date)` | `0x56` | `{ hrv, stress }` |
| `getSpo2Log(date)` | `0x66` | latest SpO2 % |
| `getSpo2History(date)` | `0x57` | `[{ date, samples }]` — 20 samples × 30 s |
| `getSleepHrv(date)` | `0x60` | `[{ date, rmssd }]` — 30-sample RMSSD/night |
| `getTemperatureLog(date)` | `0x62` | `[{ date, skinTemp, ambientTemp, shellTemp, estimatedBodyTemp, status }]` |
| `getExerciseSessions(date)` | `0x5C` | `[{ date, sportMode, avgHeartRate, durationSec, steps, paceMin, paceSec, calories, distanceKm }]` |
| `getSleepApneaRisk(date)` | `0x5F` | `[{ date, riskLevel }]` |
| `getOxygenVariation(date)` | `0x5D` | `[{ date, riskCount, variationList }]` |
| `getRealtime(type)` | `0x28` | number (HR bpm / SpO2 % / HRV ms / stress) |
| `startRealtimeStream(cb, opts)` | `0x09` | live broadcast every second |
| `stopRealtimeStream()` | `0x09` | stops broadcast |
| `startBloodGlucose(onData)` | `0x78` | starts 5-min PPG session |
| `sendBloodGlucoseProgress(pct)` | `0x78` | updates progress on ring display |
| `stopBloodGlucose()` | `0x78` | returns raw PPG samples for server upload |
| `sendBloodGlucoseResult(status)` | `0x78` | sends server result back to ring |
| `exitBloodGlucose()` | `0x78` | closes session |
| `startPpgStream(cb)` | `0x11` | streams raw 32-bit PPG waveform |
| `stopPpgStream()` | `0x11` | stops waveform stream |

---

## 9. Incremental Sync (Not Yet Implemented)

To avoid re-downloading all history on every connection, pass mode `0x01` with a BCD date filter:

```js
// buildHistorySyncPayload in protocol.js supports this:
// mode = 0x01, dateFilter = Date object
function getDailyActivitySummaryPacket(mode, dateFilter) {
  return buildCommand(0x51, buildHistorySyncPayload(mode || 0, dateFilter || null))
}

// Usage:
const lastSync = wx.getStorageSync('x3_last_sync')  // Date | null
const mode = lastSync ? 0x01 : 0x00
const packet = getDailyActivitySummaryPacket(mode, lastSync ? new Date(lastSync) : null)
```

After a successful sync, store the timestamp of the latest record as `x3_last_sync`.
