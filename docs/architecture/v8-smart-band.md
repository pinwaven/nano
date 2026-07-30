# V8 Smart Band — BLE Protocol Reference

> **Status (2026-07-16):** V8 is a smart band from the same hardware team as
> Halo (§CLAUDE.md §18). Protocol validated against real hardware via the
> `tools/halo --device v8` CLI (firmware `0.0.8.8`, advertised name
> `JCV8B DBE34D`), then ported into the miniapp as a full `WearableDevice`
> adapter — `src/mini/nano-miniapp/utils/wearable/v8/` (`protocol.js` +
> `index.js`), registered as brand `'v8'` in
> `utils/wearable/index.js`'s `createWearable()` factory and wired into
> `components/user-health/user-health.js`'s bind/scan/sync/interval-settings
> flow the same way Halo is. The CLI code at `tools/halo/src/v8-protocol.js` /
> `src/v8.js` remains the standalone debugging tool (`node bin/cli.js
> --device v8`) — it now has a sibling in production rather than being the
> only home for this protocol. See §7 for what did and didn't carry over
> exactly.

Source material: vendor Android SDK dropped at `temp/V8_SDK/` (package
`com.jstyle.blesdkv8`; readable Java source under
`v8test/blesdk_2301/src/main/java/com/jstyle/blesdkv8/`). Despite the folder
name, `V8_SDK/V8.xlsx`'s own title page says "Model: V5" — this looks like a
reused OEM template doc, not V8-specific; UUIDs/checksum/opcodes below come
from the Java source, cross-checked against real hardware, not the xlsx.

---

## 1. Relationship to Halo

V8 and Halo (X3/X6/X9/V4) are close protocol relatives — almost certainly
built from the same OEM BLE reference design — but **not** interchangeable
firmware:

| | Halo | V8 |
|---|---|---|
| GATT service/write/notify UUIDs | `0xFFF0`/`0xFFF6`/`0xFFF7` | **identical** |
| Frame format | 16 bytes, additive checksum | **identical algorithm** |
| BCD date/time encoding | yes | **identical** |
| History mode byte (`0x00`/`0x02`/`0x99`) | yes | **identical**, same offsets |
| ~20 opcodes (time, battery, MAC, steps, sleep, HR, HRV, temp, auto-monitoring, …) | | **same opcode values**, same payload field offsets |
| Opcode `0x57` | Detailed SpO2 history | **Clock/alarm read** — reused for something else entirely |
| Notification reassembly | one record per BLE notification | **one notification can hold multiple stacked records** (see §3) |
| Alarms, sedentary reminder, device name, ECG, PPI, blood glucose, SOS, OTA/DFU | not present | present in the vendor SDK, **not ported** (out of scope — see §6) |
| Advertised name | `X3`/`X6`/`X9`/`V4` | `JCV8B` |

The practical upshot: most of Halo's protocol knowledge transfers directly,
but don't assume payload-byte-for-byte identity without checking — `0x57` is
a concrete example of the two vendor tables diverging.

---

## 2. BLE GATT Structure

Identical to Halo (§1 of `halo-smart-ring.md`):

| Role | Full UUID | Short |
|---|---|---|
| **Service** | `0000fff0-0000-1000-8000-00805f9b34fb` | `FFF0` |
| **Write (host → band)** | `0000fff6-0000-1000-8000-00805f9b34fb` | `FFF6` |
| **Notify (band → host)** | `0000fff7-0000-1000-8000-00805f9b34fb` | `FFF7` |

Advertised name: **`JCV8B`** (seen in full as `JCV8B DBE34D` — the suffix is
device-specific; its bytes match the tail of the device's MAC address, see
§4). Not documented anywhere in the vendor SDK — confirmed by hand against a
real band. `V8_NAME_PREFIXES = ['JCV8B']` in `v8-protocol.js`.

The vendor demo apps negotiate MTU up to ~244 bytes
(`gatt.requestMtu(153)` on the failure path; the device itself reports its
negotiated MTU back in the `0x41` Get Time response — `244` observed live).
This large MTU is why a single notification can carry many stacked history
records (§3).

---

## 3. Command Frame Format & Reassembly Model

Every write to `0xFFF6` is exactly **16 bytes**, identical to Halo:

```
Byte 0    : Command ID
Bytes 1–14: Payload parameters (zero-padded)
Byte 15   : Checksum — sum of bytes 0–14, masked to 8 bits (& 0xFF)
```

`ResolveUtil.crcValue()` in the vendor source is byte-for-byte the same
algorithm as Halo's `calculateChecksum()` — not a real CRC, no encryption
anywhere in the protocol.

### BCD encoding

Same as Halo: `decToBcd(26) → 0x26`, `bcdToString(0x26) → "26"`. The vendor
source's `getDeviceTime`/history parsers decode dates via
`Integer.toHexString(byteValue)` (`ByteToHexString`) rather than a named BCD
helper, but for a BCD-encoded byte this produces the identical result —
confirmed by tracing both code paths, not just by assumption.

### History sync mode byte (`value[1]`)

Identical convention and offsets to Halo (confirmed in `BleSDK.java`'s
`insertDateValue()`, which writes the BCD date filter at `value[4..9]` —
the same offsets as Halo's `buildHistorySyncPayload`):

| Value | Meaning |
|---|---|
| `0x00` | Read latest |
| `0x01` | Read from a specific BCD date filter (`value[4..9]`) — **exact match required, see below** |
| `0x02` | Continue from last read position |
| `0x99` | Delete all historical data for this type |

`mode = 0x01` was not found as a distinct branch in the vendor Java dispatch
code — only `0x99` is checked explicitly (`(byte)0x99 == mode`); everything
else, including `0x01`, falls through to the same "read" path as `0x00` in
that source. That static-analysis finding turned out to be an incomplete
predictor of real firmware behavior — **confirmed live 2026-07-30** via
`tools/halo --device v8 history --type <hr|hrv|spo2|temp> --since <iso>`
(firmware `0.0.8.8`, same unit as the original §7 validation run) against a
409-record HRV history, an 813-record SpO2 history, and a 1100+-record
temperature history spanning ~19 days:

**`mode = 0x01` is honored by HRV (`0x56`), SpO2 (`0x66`), and temperature
(`0x62`) — but only when `since` exactly matches one of the device's own
stored record timestamps, to the second.** The matched record itself is
included (inclusive boundary) along with everything newer. Any `since` value
that doesn't exactly match an existing record — even by one second, in
either direction, past or future — makes the device silently fall back to
returning its entire history for that command, identical to `mode = 0x00`.
This was missed on the first pass through this data: an initial "24h ago"
test on SpO2 happened to use a timestamp that didn't line up with that
command's actual record cadence, was misread as "SpO2 doesn't support
`0x01` at all," and was corrected once exact-timestamp tests were run
against all three commands with consistent results. Confirmed on all three:

| Test | HRV | SpO2 | Temperature |
|---|---|---|---|
| `since` = exact latest record timestamp | 1 record returned (itself) | 1 record returned (itself) | 1 record returned (itself) |
| `since` = exact record from 1h/24h earlier | correct window (2 / 25 records) | — | — |
| `since` = latest record ± 1 second (no exact match) | full history (409) | full history (813) | full history (1100+, and re-triggers the stream timeout this feature exists to avoid) |
| `since` = far out of range (year 2020) | full history (409) | — | — |

Static HR (`0x55`) was inconclusive — the test unit had zero static-HR
records in either mode, so filtering couldn't be exercised; re-test against
a device with data before trusting it.

**Practical implication:** a client can only get real incremental-sync value
out of `mode = 0x01` by requesting the exact last-known timestamp for each
type (no "safety margin" offset — any offset guarantees a mismatch and
triggers the full-history fallback, actively defeating the optimization).
`src/mini/nano-miniapp/components/user-health/user-health.js`'s
`_deriveSinceDate()` does exactly this (see
`docs/architecture/halo-smart-ring.md` §9). `src/mini/nano-miniapp/utils/
wearable/v8/index.js`'s incremental-sync getters gate per-command, not per
brand: HRV, SpO2, and temperature request `mode 0x01` when a cursor exists;
static HR stays on `mode 0x00` pending a proper re-test.

### Reassembly: per-notification, not concatenated (key difference from Halo)

**This is the one architecturally significant difference from Halo.** Traced
through the vendor source (`BleService.onCharacteristicChanged` →
`BaseActivity.subscribe()` → `BleSDK.DataParsingWithData(value, listener)`):
each raw GATT notification is parsed **independently**, with zero
byte-concatenation across notifications at any layer. Because the record
size (`24`–`27` bytes depending on type) is much smaller than the negotiated
MTU (~244 bytes), **one notification packs several stacked records**
back-to-back, and a long history sync is a sequence of independent
multi-record notifications, not one giant reassembled buffer.

Confirmed live: every `0x54` (continuous HR) notification during a real sync
was **exactly 240 bytes** = 10 stacked 24-byte records, for 50+ consecutive
notifications, all decoding cleanly with no offset drift.

`V8Client._streamRecords()` in `tools/halo/src/v8.js` reflects this: it runs
`parseXChunk(notificationBytes) → { records, done }` per notification and
accumulates **parsed records**, not raw bytes — the opposite of Halo's
`_stream()`, which concatenates raw bytes into one buffer and parses that as
a whole. Do not reuse Halo's `_stream()` pattern for V8.

---

## 4. Commands (Host → Band)

Opcodes from `DeviceConst.java`. **Bold** = implemented in `v8-protocol.js`
and confirmed against real hardware. Plain = present in the vendor SDK but
out of scope for this pass (see §6).

| Opcode | Vendor name | Purpose | Status |
|---|---|---|---|
| `0x01` | `CMD_SET_TIME` | Set band clock | **implemented, confirmed** |
| `0x41` | `CMD_GET_TIME` | Get band clock (+ week, MTU, GPS date) | **implemented, confirmed** |
| `0x02` | `CMD_Set_UseInfo` | Set user profile | implemented, write path unverified |
| `0x42` | `CMD_GET_USERINFO` | Get user profile | **implemented, confirmed** |
| `0x05` | `CMD_Set_DeviceID` | Write a 6-char device/owner ID string | not implemented |
| `0x09` | `CMD_Enable_Activity` | Real-time step/temp/HR/SpO2 broadcast toggle | not implemented |
| `0x13` | `CMD_Get_BatteryLevel` | Battery %, charging state, raw voltage | **implemented, confirmed** (voltage is raw ADC, uncalibrated — see §6) |
| `0x22` | `CMD_Get_Address` | MAC address | **implemented, confirmed** |
| `0x27` | `CMD_Get_Version` | Firmware version | **implemented, confirmed** |
| `0x12` | `CMD_Reset` | Factory reset | implemented, unverified live |
| `0x2e` | `CMD_Mcu_Reset` | MCU soft reset | implemented, unverified live |
| `0x2a` | `CMD_Set_Auto` | Set auto-monitoring schedule | **implemented, confirmed** (write + read-back round-trip tested live) |
| `0x2b` | `CMD_Get_Auto` | Get auto-monitoring schedule | **implemented, confirmed** |
| `0x51` | `CMD_Get_TotalData` | Daily activity totals | **implemented, confirmed** |
| `0x52` | `CMD_Get_DetailData` | Per-minute activity detail | **implemented, confirmed** |
| `0x53` | `CMD_Get_SleepData` | Sleep history | **implemented, confirmed** (single-record 1-min path only — see §6) |
| `0x54` | `CMD_Get_HeartData` | Continuous/dynamic HR history | **implemented, confirmed** |
| `0x55` | `CMD_Get_OnceHeartData` | Static/single-shot HR history | **implemented**, returned 0 records live (plausibly no manual readings triggered) |
| `0x56` | `CMD_Get_HrvTestData` | HRV + stress + BP history | **implemented, confirmed** |
| `0x62` | `ReadTempHisrory` | Skin/body temperature history | **implemented, confirmed** |
| `0x66` | `Oxygen_data` | Auto SpO2 history | **implemented, confirmed** |
| `0x28` | `MeasurementWithType` | Trigger on-demand HRV/HR/SpO2/ECG measurement | not implemented |
| `0x19` | `CMD_Start_EXERCISE` | Enter/exit/query exercise mode | not implemented |
| `0x17` | `CMD_heart_package` | Sport-session heartbeat (host→band) | not implemented |
| `0x18` | `CMD_HeartPackageFromDevice` | Sport-session HR push (band→host) | not implemented |
| `0x3d`/`0x3e` | `CMD_Set_Name`/`CMD_Get_Name` | Device display name | not implemented |
| `0x5C` | `CMD_Get_SPORTData` | Exercise session logs | not implemented |
| `0x78`/`0x3a` | `CMD_Get_Bloodsugar`/`Bloodsugar_data` | Blood glucose PPG session (server-interpreted) | not implemented |
| `0x6B` | `Obtain_detailed_sleep_data` | Combined detailed sleep + activity | not implemented |
| `0x14` | `Temperature_3NTC` | Real-time 3-sensor temperature | not implemented |
| `0x03`/`0x04` | `SetBasic_parameters_of_equipment`/`Get...` | Sports-mode LED flash settings | not implemented |
| `0x07` | `PPG` | Enable ECG/PPG-during-HRV streaming | not implemented |
| `0x23` | `CMD_Set_Clock` | Set alarms | not implemented |
| `0x57` | `CMD_Get_Clock` / `deleteAllClock` | Get/delete alarms — **reuses Halo's SpO2-detail opcode** | not implemented |
| `0x25`/`0x26` | `CMD_Set_ActivityAlarm`/`Get...` | Sedentary reminder | not implemented |
| `0x63` | `ppi` | Pulse-to-pulse interval history | not implemented |
| `0xFE` | `SOS` | Device-initiated SOS button push | not implemented |
| `0x47` | (undocumented in `DeviceConst.java`, referenced directly in `BleService.kt`) | Enter OTA/DFU bootloader mode (Nordic DFU) | not implemented |

---

## 5. Response Record Formats (Confirmed Types Only)

All parsers live in `tools/halo/src/v8-protocol.js` as `parseXChunk(buf)` —
each takes **one raw notification buffer** (not a concatenated stream, see
§3) and returns `{ records, done }`.

### `0x41` — Device time
```
value[1..6]  = Y/M/D/H/Min/Sec (BCD)
value[7]     = weekday
value[8]     = negotiated MTU
value[9..11] = GPS date (rarely populated — "00.00.00" with no GPS fix)
```

### `0x42` — User profile
```
value[1] = gender (1=male, 0=female)
value[2] = age
value[3] = height (cm)
value[4] = weight (kg)
value[5] = stride (cm)
value[6..11] = device/owner ID chars (ASCII, 0-padded)
```

### `0x13` — Battery
```
value[1]   = level (0-100%)
value[2]   = charging state
value[3..4] = voltage, 2-byte LE — RAW ADC COUNT (~22800 seen), not
              calibrated mV. No conversion formula found in the vendor SDK.
```

### `0x2b` — Auto-monitoring schedule (get)
```
value[1]   = workMode
value[2..3] = start hour/minute (BCD)
value[4..5] = end hour/minute (BCD)
value[6]   = weekday bitmask (0xFF = all days seen live, not 0x7F)
value[7..8] = interval minutes, 2-byte LE
```
`type` is not echoed by the device — the caller must track what it asked
for. Set (`0x2a`) uses the identical byte layout; confirmed live via a
write + read-back round trip (HR interval set to 15 min with a 07:00–22:00
window, read back exactly as sent).

### `0x51` — Daily activity totals (per-notification chunk)
```
count = 26 or 27 bytes/record (see getStepRecordSize() in v8-protocol.js)
per record, base = i * count:
  date            @ [2+base..4+base]   (BCD Y/M/D)
  step            @ [5+base..8+base]   (4-byte LE)
  exerciseMinutes @ [9+base..12+base]  (4-byte LE)
  distance        @ [13+base..16+base] (4-byte LE ÷ 100 = km)
  calories        @ [17+base..20+base] (4-byte LE ÷ 100 = kcal)
  goal            @ [21+base]  (1 byte if count=26) or LE 2-byte if count=27
  activeMinutes   @ [count-4+base..count-1+base] (4-byte LE)
```
The `+2` base offset (vs`+1` for a bare cmd-byte header) is ported as-is
from the vendor source's arithmetic; confirmed correct live (7 days of
plausible step/calorie/distance totals in clean reverse-chronological
order).

### `0x52` — Detailed per-minute activity (25-byte records)
```
date @ [3+base..8+base]   (BCD, with seconds)
step @ [9+base..10+base]  (2-byte LE)
cal  @ [11+base..12+base] (2-byte LE ÷ 100)
dist @ [13+base..14+base] (2-byte LE ÷ 100)
perMinuteSteps @ [15+base..24+base] (10 × 1-byte)
```

### `0x53` — Sleep (only the single-record path confirmed)
```
130-byte notification (1-minute granularity, single record):
  date @ [3..8] (BCD)
  sleepLength @ [9]
  levels @ [10..10+sleepLength-1] (1 byte/minute)
Terminator: last 2 bytes of the notification are [0x53, 0xFF]
```
Live: one night, 107 minute-level samples, values clustered in `{1,2,3}`
with rare `{4,6,10}` outliers at sleep onset — consistent with genuine
sleep-stage output, exact stage-code meanings not confirmed against vendor
docs. The alternate 34-byte multi-record-per-notification path (5-minute
granularity, same shape as Halo's) is ported but **not exercised live**.

### `0x54` — Continuous HR (24-byte records)
```
date    @ [3+base..8+base]  (BCD, with seconds)
samples @ [9+base..23+base] (15 × 1-byte bpm)
```
Live: 500+ records across 50+ notifications (240 bytes each = 10 records),
values in a normal 79-115 bpm range throughout, no terminator reached within
25s on this particular band (it simply has a lot of history) — handled via
partial-result-on-timeout, same as Halo's documented behavior for oversized
logs.

### `0x55` — Static HR (10-byte records)
```
date      @ [3+base..8+base]
heartRate @ [9+base]
```
Returned 0 records live — plausibly this band has no manual/static
readings logged, not necessarily a parsing bug.

### `0x56` — HRV + stress + BP (15-byte records)
```
date          @ [3+base..8+base]
hrv           @ [9+base]
vascularAging @ [10+base]
heartRate     @ [11+base]  (0 in most live records — plausibly not always populated)
stress        @ [12+base]
highBP        @ [13+base]
lowBP         @ [14+base]
```
Live: 124 records, HRV 40-99, highBP/lowBP consistently ~120-129/70-72 —
realistic paired blood-pressure values, which is what confirmed these two
field positions are correct despite the vendor source's local Java variable
names at those offsets (`moodValue`/`breathRate`) not matching what they're
actually used for.

### `0x62` — Skin temperature (11-byte records)
```
date @ [3+base..8+base]
tempRaw @ [9+base..10+base] (2-byte LE ÷ 10 = °C)
```
Live: 747 records, 29.9-31.6°C — plausible skin temperature range.

### `0x66` — Auto SpO2 (10-byte records)
```
date @ [3+base..8+base]
spo2 @ [9+base]
```
Live: 248 records, 95-98% — plausible SpO2 range.

All the record types above end when `buf[buf.length-1] === 0xFF` (checked
per-notification, per §3), except `0x53` which uses the 2-byte
`[0x53, 0xFF]` tail like Halo.

---

## 6. Known Gaps / Unvalidated Areas

- **`getBattery().voltage`** is a raw ADC count, not millivolts — no
  calibration formula exists in the vendor SDK.
- **`getHeartRateHistory()` (`0x54`)** can exceed the stream timeout on a
  band with a lot of history (confirmed: 500+ records, still going after
  50 notifications). Currently 25s with graceful partial-result fallback;
  bump further or implement `mode=0x02` continuation if a full backfill is
  needed.
- **`setTime()` / `setUserInfo()` writes**: builders are ported and the ack
  opcode matches Halo's convention, but neither was round-trip tested live
  (only `setAutoMonitoring()` was).
- **Sleep multi-record (34-byte) path, `mode=0x02` continue, `mode=0x99`
  delete**: ported from the vendor source but not exercised against real
  hardware.
- **Everything in §4 marked "not implemented"**: alarms/clock, sedentary
  reminder, device name, on-demand measurement (`0x28`), exercise mode,
  ECG, PPI, blood glucose, SOS, OTA/DFU. `0x57` in particular needs care —
  it means something completely different on V8 than on Halo.

---

## 7. Miniapp Integration

Ported from the CLI-validated `tools/halo/src/v8-protocol.js` / `src/v8.js`
into `src/mini/nano-miniapp/utils/wearable/v8/`:

- `protocol.js` — builders + BCD/checksum helpers only, mirroring
  `utils/wearable/halo/protocol.js`'s shape exactly (parsers moved out, per
  Halo's own convention of keeping protocol.js low-level).
- `index.js` — `V8Band extends WearableDevice`, with all response parsing as
  private `_parseXXX` helpers (mirroring `HaloRing`'s structure). Uses its
  own `_streamRecords()` / `_streamSleepChunks()` — **not** a copy of
  `HaloRing._stream()`, because of the per-notification reassembly
  difference in §3.
- Registered as brand `'v8'` in `utils/wearable/index.js`'s
  `createWearable()` factory.
- Wired into `components/user-health/user-health.js`: `V8_NAME_PREFIXES`
  added to brand-detection scanning, default auto-monitoring setup on first
  bind, and the single-phase sync branch (previously gated on
  `brand === 'halo'`, now on a shared `_hasIntervalSettings(brand)` helper
  covering both — their sync shapes are identical, so this reuses Halo's
  existing sync/interval-settings code paths rather than duplicating them).
  Same treatment in `user-health.wxml`'s interval-settings panel condition.

**What did NOT carry over 1:1 from the CLI phase** — these are the same
gaps as §6, restated in terms of what the miniapp adapter actually returns
to `syncWearableData()`:

- `getHrvHistory()` omits a `breath` field entirely (V8's byte position for
  it is `vascularAging`, a different metric — see §6). `sync.js`'s
  `breath_rate` will be `null` for V8 users; the raw value is still exposed
  as `vascularAging` on each record for future use, just not synced yet.
- `getTemperatureHistory()` sets `status: null` always — V8's 0x62 record is
  a single value, not Halo's 3-sensor NTC delta that `_estimateBodyTemp()`
  needs.
- `getSleepHistory()` returns `deep/light/rem/awake: null` and empty
  `periods` for every session — **deliberately**, not a bug. V8's raw
  per-minute stage codes (`1,2,3,4,6,10` observed live) don't match Halo's
  confirmed `0=awake/1=deep/2=light/3=rem` enum, and guessing the mapping
  risks silently mislabeling real sleep data, which is worse than a gap.
  `totalMinutes`/`onset`/`sleepStart`/`sleepEnd` are still computed (pure
  arithmetic on block/timestamp data, no semantic assumption about
  individual stage values) and do sync correctly.
- Everything listed "not implemented" in §4 (alarms, ECG, blood glucose,
  OTA, etc.) still isn't — `V8Band` only implements what §4 marks
  "implemented, confirmed".

---

## 8. CLI Reference (`tools/halo`)

```bash
cd tools/halo && npm install

node bin/cli.js scan --device v8
node bin/cli.js --device v8                          # fetch-all (implemented types only)
node bin/cli.js --device v8 --address <uuid> --json
node bin/cli.js set-time --device v8
node bin/cli.js get-auto-monitoring --device v8
node bin/cli.js set-auto-monitoring --device v8 --type hr --interval 15 --start 07:00 --end 22:00
```

`--type` for `set-auto-monitoring`: `hr` · `spo2` · `temperature` · `hrv`.
See `tools/halo/README.md` for the full flag reference (shared with Halo).
