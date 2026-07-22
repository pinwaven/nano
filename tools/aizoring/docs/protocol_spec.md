# Aizo / "Infinity" Smart Ring — BLE Protocol (v2, corrected)

Reverse-engineered from `libs/aizo_sdk_release_v2.1.2.aar` (package `com.eiot.aizo.*`)
by decompiling with jadx. This supersedes the earlier spec, which had a
**fundamentally wrong frame format**. See §9 for the list of corrections.

Reference implementation: `src/aizo_protocol.js` (+ `src/connect_ring.js`).
Ground-truth classes are cited inline.

> **Verified on hardware** (an `infinity ring`, MAC `d0:9f:d9:d8:66:74`, macOS +
> `@abandonware/noble`): connect → bind/auth → battery + steps all decode with
> valid CRCs, reproducibly across reconnects. Hardware-confirmed facts are marked
> ✓ below. Practical notes that only surfaced on-device:
> - This unit **notifies on `010a`** (there is no `010b` characteristic).
> - Commands must be written to `0101` with **write-with-response** — a
>   write-without-response is silently dropped (this was the one real blocker).
> - **macOS HID auto-bond gotcha:** the ring also advertises a HID service
>   (`1812`), so macOS auto-pairs it as a system accessory. A *bonded/connected*
>   BLE peripheral does **not advertise**, so noble/CoreBluetooth can never
>   discover it. If the ring shows as "Connected" in System Settings → Bluetooth,
>   **Forget This Device** first; then it advertises and the connector can grab it.
> - HR/SpO2/pressure/sleep **history returns nothing when the ring has recorded
>   nothing** — an empty log is silence, not an error. Steps and battery are
>   always available.

---

## 1. GATT services & characteristics  (`AizoBeConfig`)

| Role | UUID |
| :--- | :--- |
| Main service | `0000fe02-0000-1000-8000-00805f9b34fb` |
| **Command write** (host→ring) | `00000101-0000-1000-8000-00805f9b34fb` (HEX_WRITE) |
| **Data notify** (ring→host) + host ACK writes | `0000010b-0000-1000-8000-00805f9b34fb` (ACK_WRITE_NOTITY) |
| Alt write char (some units) | `0000010a-0000-1000-8000-00805f9b34fb` |
| CCCD (enable notify) | `00002902-0000-1000-8000-00805f9b34fb` |
| ECG write / notify | `00000131…` / `0000013a…` |
| SPP (classic) service | `fe010000-1334-5678-abcd-00805f9b34fb` |

Connection: MTU is negotiated to **247**, so `writeMaxMTU = 247 − 3 = 244`.
Frames longer than 244 bytes are split into 244-byte GATT writes and reassembled
on the receiver by accumulating until the declared length is satisfied
(`BtPackage`, `ByteArrayExtKt.split(bytes, mtu)`).

The ring advertises with a **name prefix `infinity`**.

---

## 2. Frame format  (`BtPackage.tEU` / `BtPackage.XuubWYBWu(uuid,data)`)

Every framed packet — in **both** directions — is:

```
+--------+--------+--------+-----------------+---------+
| len(2) | ctrl(2)| sn(2)  |  payload (N)    | crc(2)  |
+--------+--------+--------+-----------------+---------+
   BE      packed    BE                          BE
```

* **len** — big-endian; equals `payload.length + 2` (payload + CRC). It does **not**
  cover the `ctrl` or `sn` fields. Total frame length = `6 + len`.
* **ctrl** — a 16-bit big-endian **bit-packed** control word (§3).
* **sn** — big-endian sequence number (host increments per request; wraps at
  `0xC7C7` in the SDK, any 16-bit value works).
* **payload** — command bytes; `payload[0..1]` is the command/response code.
* **crc** — CRC16 over the payload only, big-endian (§4).

> There is **no separate "command id" field and no `0x02` prefix byte** — the
> command lives in the first payload bytes, and the `0x02` that a naïve reading
> might see is actually the top of the packed `ctrl` word.

## 3. Control word bit layout

16 bits, MSB first (built by concatenating binary strings in `BtPackage.tEU`,
parsed by substring in `BtPackage.XuubWYBWu(uuid,data)`):

| bits | field | value (host→ring command) |
| :--- | :--- | :--- |
| `[0:2]` | sender | `2` = APP (`1` = SERVER) |
| `[2:4]` | terminal/receiver | `0` |
| `[4:8]` | bleVer | `3` |
| `[8:10]`| type | `1` for normal command payloads |
| `[10]`  | ack | `0`, or `1` when the sender wants an ACK |
| `[11:13]`| pkgType | `0` SINGLE, `1` MULTIPLE, `2` ACK, `3` HEARTBEAT |
| `[13:16]`| rfu | `0` |

For a normal single command this word is **`0x8340`**. (Verified in
`aizo_protocol.js` self-test.)

## 4. CRC16  (`CRC16.kt`)

CRC16/CCITT variant, init `0xFFFF`, returned big-endian:

```js
let crc = 0xFFFF;
for (const b of data) {
  const x = (((crc >>> 8) | (crc << 8)) & 0xFFFF) ^ (b & 0xFF);
  const y = x ^ ((x & 0xFF) >>> 4);
  const z = y ^ ((y << 12) & 0xFFFF);
  crc = z ^ (((z & 0xFF) << 5) & 0xFFFF);
}
// bytes: [(crc>>8)&0xFF, crc&0xFF]
```

## 5. ACK & reassembly

When a **received** frame's `ctrl.ack == 1`, the host must reply with an ACK
frame: `pkgType = ACK(2)`, same `sn`, payload = one byte
`0`=ok / `1`=crc-error / `2`=resend (`writeAckSuccess/CrcError/Resend`).
Long log responses arrive as multiple frames; ACK them to keep the stream
flowing. Multi-part payloads use `pkgType = MULTIPLE(1)` and are reassembled by
the receiver keyed on characteristic.

---

## 6. Requests  (`AizoComHelp`)

Most requests are `getCommod(...prefix)` = `prefix bytes + 6 time bytes`, wrapped
in a frame. Time bytes (`AizoComUtil.getTimeByte`, **local** time):
`[year%100, month(1-12), day, hour(24h), minute, second]`.

| Request | payload prefix | realtime resp | history resp |
| :--- | :--- | :--- | :--- |
| Heart rate | `31 31` | `7171` | `7161` |
| Blood oxygen | `32 32` | `7272` | `7262` |
| Pressure / HRV / stress | `31 32` | `7172` | `7162` |
| Blood pressure | `31 33` | — | — |
| Body temperature | `31 35` | — | — |
| Steps / activity | `33 33` | — | `7373` |
| Sleep | `35 35` | — | `7575` |
| Sport / workout | `36 36` | — | — |
| Device status / battery | `38 38 <infoType>` | `38 38 …` | — |
| Get watch dials | `10 27` (no time) | `2027` | |
| Switch dial | `10 31` + dialId(utf8) | | |

Response code rule: `respByte0 = reqByte0 + 0x40`; `respByte1 = reqByte1 + 0x40`
(real-time) or `+ 0x30` (history).

### 6.0 On-demand ("instant") measurement — the way to get LIVE values ✓
From the **serversdk** (`ServiceSdkCommandV2.instantMeasurement`); not in the base
`aizo_sdk`. This is what the app's "measure" button sends.

*   **Request payload:** `31 51 <type> <operation>`
    *   `type`: `1`=HeartRate, `2`=SpO2, `3`=Stress, `4`=BodyComposition, `6`=Temperature
    *   `operation`: `1`=start, `2`=stop
*   **Ack:** `71 51 <type> <started>` — `started(byte3)==1` means the ring began measuring.
*   **Live values then stream** as realtime frames while the sensor reads:
    `7171` HR, `7272` SpO2, `7172` stress, **`7175` temperature** — layout
    `[hdr(2), time(6), bodyTemp(2 BE ÷10), envTemp(2 BE ÷10; 0xffff=invalid)]`.
    (`7979` is a *separate* history/paging temperature stream, not the instant one.)
*   **Completion:** `71 52 <type> <valid>` — `valid(byte3)==1` means a good reading
    was produced, `0` means none (e.g. poor skin contact); advance on this instead of
    waiting out the window.
*   HR/SpO2/temperature yield a value in ~20-35 s when worn snugly. **Stress does not**
    return from a quick spot-measure — HRV needs a sustained window; use the stress
    auto-monitor schedule (§6.0.1) instead.
*   ✓ Verified live (ring worn): HR `91 bpm`, SpO2 `97 %`, temperature `36.2 °C`.
*   Send `start` **once** — re-sending restarts the measurement. Keep the ring worn
    and still; a reading takes ~20-30 s.

✓ Verified on hardware: `31 51 01 01` → ack `71 51 01 01` → `7171 … 84` (**84 BPM live**)
→ `7152 01 01`.

For continuous streaming (raw PPG + samples) there is also a `0xAC` command family
(`ContinuousMeasureManager`): `AC13 + measureType(2) wearMode(1) measureMode(1)
timeSecs(2) gender(1) age(1) height(1) weight(1)` → ack `AC14`; status `AC11`/`AC12`;
stop `AC15`. The instant command above is simpler for a single reading.

### 6.0.1 Auto-monitoring intervals ✓ (serversdk `HeartRateIntervalManager` / `EmotionIntervalHelper`)
The ring records HR/health (and stress) on a timer, writing to the history logs
(§7.2). Uses the `0x22` config-write family.

*   **HR / health interval**
    *   GET `22 10` → resp `21 10 <current> <default> <rfu> <allowed…>` — one byte each;
        `<allowed…>` is the list of interval values (minutes) the ring accepts.
    *   SET `22 11 <minutes>` → ack `21 11 <ok>`; `minutes=0` disables.
    ✓ Verified on hardware: read `current=30, default=20, allowed=[10,20,30]`;
    sent `22 11 0A` → ack `21 11 01`; read-back `current=10`. (Also explains sparse
    HR history — it only logs a sample when the ring is actually worn at each tick.)
*   **Stress / emotion interval** — separate from HR, its own schedule.
    *   GET `22 20 0C` → resp `21 20 0C <current-BE16> <default-BE16>` — the value is a
        16-bit count of **seconds** (not minutes). SET `22 21 0C <seconds-BE16>` → ack `21 21 …`.
    *   Range: 1..65535 s (≈ up to 1092 min). ✓ Verified: default `1800 s` (30 min);
        set `22 21 0C 0E10` (3600 s) → read-back `current = 3600 s = 60 min`.
    *   `REQ.setStressInterval(minutes)` takes minutes and converts (×60) internally.

**These two are the only schedulable auto-measurements the ring exposes.** There is
no separate SpO2 / temperature / blood-pressure interval command in either SDK — those
are on-demand only (§6.0). The per-sensor `*Monitoring` fields in the device config
(§7.6) are read-only status, not writable per-sensor. So "all available metrics" =
`hr` + `stress`.

Client helpers: `REQ.getMeasureInterval/setMeasureInterval(min)` and
`REQ.getStressInterval/setStressInterval(min)`; connector mode:
```
node connect_ring.js AizoRingCompany monitor              # read-only: current + allowed values
node connect_ring.js AizoRingCompany monitor hr=10 stress=60
node connect_ring.js AizoRingCompany monitor 20 45        # positional: hr stress
node connect_ring.js AizoRingCompany monitor hr=0         # 0 disables that metric
```
The connector reads first, validates `hr` against the ring's allowed set, applies, and
reads back to confirm. ✓ Verified: set `hr=20, stress=45` → read-back `hr=20min,
stress=2700s (45min)`.

### 6.1 Bind / authentication  (`AizoComHelp.getBindRequest`)

Sent first, right after subscribing to notifications. Payload:

```
30 30 <enc>            enc = 1 if compId (uppercased) ends with 'E', else 0
<time(6)>             local time bytes
<tzIndex(1)>         timezone offset / 15 min  (UTC+8 => 32)  — TimeZoneManager
<language(1)>        0 = zh/HK/TW, 1 = en (default), 2 = ru        — AizoUtil.getLanguage
<rom(1)>             0 default, 1 huawei, 2 xiaomi, 3 oppo, 4 vivo — AizoUtil.getRom
<appId(32 ASCII)>    32 hex chars, UTF-8 encoded (= 32 bytes)
";2.1.2;" + compId + ";"   (UTF-8)
```

The **appId** is normally a UUID derived from Android `Build.*` fingerprints
(`u7Bh…ON.tEU`: `new UUID(devIdShort.hashCode(), appName.hashCode())`, dashes
stripped) and cached (`LocalSaveInfo`). For an independent client, **any stable
32-hex string works** for a fresh bind — persist one and reuse it. `connect_ring.js`
stores it in `src/.aizo_appid`.

### 6.2 Bind / auth response  (`BleResultExtKt.authBean`)

```
payload = [70 70, status, <UTF-8 "MAC;PASSWORD;DEVICETYPE;NAME;">]
```
✓ Confirmed on-device: response opcode is **`0x7070`** (`0x3030 + 0x4040`, the
same +0x40 rule as the data commands). `status = payload[2]`; the UTF-8 string
splits on `;` into MAC, PASSWORD (uppercased), DEVICETYPE (int), and the device
NAME. Example reply: `7070 23 "d0:9f:d9:d8:66:74;123456;1;infinity ring;"`
(status `0x23`, password `123456`, type `1`).

---

## 7. Response decoders  (`BeSendData$operateHexData$1`, `BleResultExtKt`)

Validity gates (`BtSendUtil`): heart-rate `1..220`, SpO2 `1..100`, pressure `1..99`.
`getDeviation(min) = midnight(today) + min*60000`.

### 7.1 Real-time sample — `7171` HR, `7172` pressure, `7272` SpO2
`split [2,6,1]` → `header(2)`, `time(6)`→epoch, `value(1)`.

### 7.2 History records — `7161` HR, `7162` pressure, `7262` SpO2
`[header(2)]` then `N × 4-byte` records, each `split [1,2,1]`:

| off | size | meaning |
| :-- | :-- | :-- |
| 0 | 1 | **value** (HR / SpO2 / pressure) |
| 1 | 2 | time offset (BE). Minutes for HR/SpO2; **×30** for pressure |
| 3 | 1 | flag |

`timestamp = midnight(today) + offsetMinutes*60000`.
**(The earlier spec had value and flag swapped — value is byte 0, not byte 3.)**

### 7.3 Steps — `7373`  (`BleResultExtKt.stepInfo`) ✓ (corrected)
`split [2,6,4,4,4]`: `time(6)`, `steps(BE)`, `calories(BE)`, `distance(BE)`.
The original spec had calorie/distance scaling wrong by 1000×. ✓ Verified live
(1575 steps, raw calorie=699, raw distance=110250): calorie raw is **deci-kcal**
(÷10 = 69.9 kcal — plausible for the step count, not the `×100` = 69900 kcal
the old formula gave); distance raw is **centimeters** (÷100 = 1102.5 m, which
matches `steps × ~0.7m` stride almost exactly — not `÷100` **km**, which the
old formula mislabeled while also being 1000× too large).

### 7.4 Device status / battery — request `38 38 <infoType>`, response `78 78 …`
✓ Confirmed on-device. Request `38 38 02` → response
`78 78 <infoType> <battery> <mode> <time(6)>`; `payload[3]` = battery %,
`payload[4]` = working mode (`WorkMode`). (`BleResultExtKt.status` reads
`payload[3]`/`[4]`.) Observed: `7878 02 38 01 …` → battery `0x38` = **56 %**, mode 1.

### 7.5 Sleep detail record (8 bytes) — `BleResultExtKt.sleepDetail`
Two 4-byte big-endian words, read as bit strings:
* word0: `[1:7]` year−2000, `[7:11]` month, `[11:16]` day.
* word1: `[0:16]` minute offset from midnight, `[27:28]` flag, `[28:32]` **mode**.
* **mode**: `1=Deep, 2=Light, 3=Awake, 4=NotWorn, 5=REM` (from plugin typings).
  *(The earlier spec's `0=Awake,1=Light,2=Deep` mapping was wrong.)*

### 7.6 Watch feature config (44 bytes) — `BleResultExtKt.config`
Booleans / small ints per byte index 3..43 (alarm, sedentary, drink, medicine,
call, notify, findWatch/Phone, ota, dial…, and monitoring modes for
heart/sleep/pressure/spo2/bloodSugar/bloodPressure/temperature/ecg/menstrual/
breathe). See `parseWatchConfig`.

### 7.7 Sleep summary — `7575`
27-byte form `split [2,1,2,2,2,1,2,2,2,2,3,6]`, else `[…,3,3,4]`; carries deep/
light/awake/rem durations, awake count and start/end offsets. Left as raw bytes
in the reference decoder (`decodeResponse` returns `kind:'sleep'` + payload) —
flesh out from `BeSendData$operateHexData$1` case `7575` when needed.

### 7.8 Full response-code map (`BeSendData$operateHexData$1`)

Response code = `payload[0..1]`. Realtime/history codes follow the +0x40 rule
from the request prefix.

| code | meaning |
| :-- | :-- |
| `7171` / `7161` | heart rate — realtime / history |
| `7272` / `7262` | blood oxygen — realtime / history |
| `7172` / `7162` | pressure(HRV) — realtime / history |
| `7373` | steps ✓ |
| `7575` | sleep **summary** (see §7.7) |
| `9595` / `9596` | sleep **detail** stage records (8-byte each) / end-marker |
| `7979` | body-temperature stream: split `[2,1,6,1,2,2]` → value(1), time(6); ring re-requests `39 39 <val>` to page |
| `7672`–`7676` | sport / workout data |
| `7878` | device status; `infoType==2` → battery ✓ (`payload[3]`), other infoTypes → about/settings/feature |
| `2027` | watch dials list (18-byte `allDialsBean` records) |
| `2001` | find-phone toggle; `100A`/`2009` → reset+disconnect |
| `3101`–`3111` | ring requests weather push |
| `AA01` | handshake; host replies `AA 02` |

Other decoders present in the SDK: alarms (`alarmClock`, 38-byte records),
reminders (`sitRemind`/`drinkWater`/`medicationRemind`), watch feature/monitoring
config (`config`, §7.6), weather uploads (`BleRequestExtKt`).

---

## 7.8.1 Health history — the REAL way (`getHealthData`, `0xCC` sync) ✓

**The legacy `[0x31,0x31]`/`7161` request returns nothing on this firmware.** Stored
HR/SpO2/HRV/stress/temperature history is retrieved per-day via the serversdk
`getHealthData` command (family `0xCC`):

*   **Request:** `CC 61 + <6 time bytes for the target day>` (`getHealthData(dateMs)`).
*   **Response:** `CC 62 + N × 16-byte records`, or `CC 64` = no data for that day.
*   **16-byte record** (`BeDataReceive.zUthBDGWITqvQukd`):
    | bytes | field |
    | :-- | :-- |
    | `[0:4]` | bit-packed timestamp: `year[0:6]+2000, month[6:10]-1, day[10:15], hour[15:20], min[20:26], sec[26:32]` |
    | `[4]` | heart rate (bpm) |
    | `[5]` | HRV |
    | `[6]` | SpO2 (%) — 0 = not sampled that tick |
    | `[7]` | stress |
    | `[8:16]` | bit-packed: `step=bits[23:41]`, `envTemp=bits[41:52]÷10`, `bodyTemp=bits[52:63]÷10` (2047=invalid), `sos=bit[63]` |
    Distance/calories are **computed** from steps (not stored).
*   Records are ~one per auto-monitor tick; all-zero and all-`0xFF` records are padding.
*   ✓ Verified live: `getHealthData(2026-07-21)` → `CC 62` with 9 records, e.g.
    `20:29 HR 87 temp 36.5°C`, `22:00 HR 88 HRV 31 SpO2 98`, … HR range 77–100 bpm.

A heavier paged variant exists for raw/bulk transfer (`CC 21` start / `CC 23` ack /
`CC 25` end, per `dataType`), but `CC 61` is the direct per-day health-record sync.
Client: `REQ.getHealthData(dateMs)`; connector probe:
`node connect_ring.js AizoRingCompany health [daysBack]`.

## 7.8.2 Sleep records (`getSleepData` / `getSleepDetail`, `0xCC` sync) ✓

Same `0xCC` family, per day:

*   **Summary** — request `CC 81 + time(day)` → `CC 82 + record` (all-zero = no sleep).
    Record `split [2,1,2,2,2,1,2,2,6,6,rest]` (`BeSleepDataTwoUtil`): `[2]`sleepType,
    `[3:5]`deepMin, `[5:7]`lightMin, `[7:9]`awakeMin, `[9]`awakeTimes, `[10:12]`remMin,
    `[12:14]`totalMin, `[14:20]`start(6-byte cal), `[20:26]`end. Note total = deep+light+rem
    and wall-clock = total+awake. ✓ Verified: `4h07 total (deep 42 / light 93 / REM 112 /
    awake 22 ×1), 20:46→01:15`.
*   **Stage detail** — request `CC 71 + time(day)` → `CC 72 + <4-byte day header> + N×8-byte
    records` (`CC 74` = none). Each record: `[0:2]`marker, `[2:4]`avg HR (BE), `[4:6]`offset
    minutes from midnight (BE), `[6]`segment, `[7]`stage (`1`Deep `2`Light `3`Awake `4`NotWorn
    `5`REM). ✓ Verified: 18 transitions, e.g. `20:46 Deep HR87 · 21:06 REM HR85 · 21:28 Awake …`.

Client: `REQ.getSleepData(dateMs)` / `REQ.getSleepDetail(dateMs)`; connector probe
`node connect_ring.js AizoRingCompany sleep [daysBack]`.

## 7.8.3 Sport / workout records (`0x96` family, serversdk `SportHelp`/`SportManager`/`BeSportDataUtil`)

A separate command family (prefix `0x96`, not `0xCC`) for workout sessions. Every
paired command in this family follows **request `96 xx` → response `96 (xx+0x10)`**
(confirmed on 3 independent pairs live: `9610→9620`, `9631→9641`, and by source for
`9611..9615→9621..9625`, `9636→9646`).

*   **Status of an in-progress session** — `96 10` → `96 20 + active(1) + sportType(1)
    + sportId(6, 0=none)`. ✓ Verified live: no active session.
*   **Start/pause/resume/stop/abort** — `96 11/12/13/14/15 + time(6, sportId) +
    sportType(1)` → `96 21/22/23/24/25 + sportId(6) + result(1)` (`1`=ok, `3`=already
    in that state for pause/resume/stop, else fail/unsupported).
*   **Live in-progress metrics** — `96 36 + time(6, sportId) + sportType(1)` →
    `96 46 + sportId(6) + rfu(1) + state(1) + N×16-byte samples` (`state==3` means
    the ring already ended the session).
*   **Sync stored (finished) sessions** — `96 31` (no args) → ring pushes an
    unsolicited sequence:
    *   **Total/summary** — `96 41 + record` (26 bytes total, all-zero = none
        stored). ✓ Verified live (`9631→9641`, empty ring → all-zero). Record:
        `[2:8]`sportId=startTime(6-byte cal), `[8]`sportType, `[10:12]`duration(BE,
        seconds), `[12:14]`calorie(BE÷10), `[14:18]`steps(BE), `[18:20]`distance
        (BE×10), `[22]`avgHr.
    *   **Detail** — inferred `96 42` (not yet observed — this ring has no stored
        workouts). Per `BeSportDataUtil.processSportDetailData`: `[hdr(2)]
        [sportId(6)] [sportType(1)] [rfu(9)] [N×16-byte records]`. Each 16-byte
        record (`parseSportDetailBytes`): `[0:2]`time-offset-from-start(sec, BE),
        `[2:4]`calorie(BE÷10), `[4:8]`step(BE), `[8:10]`dist(BE×10), `[12]`hr,
        `[14:16]`pace(BE). App acks each chunk with `96 33 + sportId(6)` and
        requests more with `96 32 + sportId(6)`.
    *   **End** — inferred `96 44` (not yet observed): `[hdr(2)] [sportId(6)]`.
        App acks with `96 34 + sportId(6)`, then assembles the final record from
        the accumulated total + detail.

Client: `REQ.getSportStatus/sportStart/sportPause/sportResume/sportStop/sportAbort/
getSportLiveData/getSportRecord/getSportDetailData/sportDetailDataAck/
sportDataEndAck`; connector probe `node connect_ring.js AizoRingCompany sport`
(checks status, triggers a record sync, and logs whatever comes back — including
any unclassified `96xx` frame as `sportRaw`, for locking down the detail/end
opcodes once the ring actually has a recorded workout).

## 7.9 Reading everything (client)

`node connect_ring.js` (no extra args) runs a full sweep — it requests battery/
status, HR/SpO2/stress/blood-pressure/temperature history, steps, sleep, sport,
dials, device info, and both auto-monitor intervals, then prints an organized
report. Empty histories print as "none stored" (the ring only logs a metric when
worn at each auto-monitor tick — for live values use `measure` mode, §6.0).
Example on a not-recently-worn ring: battery 55 %, steps 85, HR-auto 20 min,
stress-auto 45 min, all health histories empty.

## 8. Connection sequence (client)

1. Scan; match name prefix `infinity` or service `fe02`.
2. Connect; negotiate MTU 247; discover service `fe02`.
3. Subscribe to notify on `010b` (write CCCD `2902`). Write commands to `0101`.
4. Send **bind** (§6.1); await auth response (§6.2).
5. Send data requests (§6); reassemble frames; ACK any frame with `ack=1`;
   decode with `decodeResponse`.

---

## 9. Corrections vs the earlier spec / `aizo_protocol.legacy.js`

1. **Frame format was wrong.** The real frame is `len(2) · ctrl(2) · sn(2) ·
   payload · crc(2)` with a bit-packed `ctrl` word (`0x8340` for commands). The
   old code emitted `len · [0x02,seq] · [cmdId] · payload · crc` — a cmdId field
   that does not exist, and a `0x02` that isn't real. Frames would be rejected.
2. **History record layout was inverted** — value is byte 0 (not byte 3); flag is
   byte 3.
3. **Sleep mode enum was wrong** — correct: `1=Deep,2=Light,3=Awake,4=NotWorn,5=REM`.
4. **Notify/write characteristics clarified** — write `0101`, notify `010b`
   (SDK), with `010a` as an observed alternative.
5. **ACK protocol documented** (`pkgType=ACK`, payload `0/1/2`).
6. CRC16 and the 6-byte time format were already correct and are retained.
