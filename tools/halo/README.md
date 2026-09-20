# halo

CLI tool for reading data from the Halo smart ring, or the V8 smart band,
over BLE (macOS, via `noble`). Defaults to Halo; pass `--device v8` to target
a V8 band instead.

## Halo

Halo is our supported ring product line; the hardware/protocol underneath is
the X3/X6/X9/V4 family (X3/X6/X9 are rings, V4 is a wrist band — all four
confirmed to share the identical BLE protocol). BLE-advertised names
literally start with those prefixes — the manufacturer's own model
designations, not something we control.

It reuses the production Halo protocol (packet builders, BCD/byte parsers) from
`src/mini/nano-miniapp/utils/wearable/halo/` — only the BLE transport differs
(this uses `noble`/Node instead of the Mini Program's `wx.*` APIs). If the
protocol changes in the miniapp, this tool picks it up automatically.

## V8

V8 is a smart band from the same hardware team as Halo, whose vendor SDK
(`./temp/V8_SDK/`) was ported into `src/v8-protocol.js` (packet builders +
parsers) and `src/v8.js` (`V8Client`). Unlike Halo, V8 has no home in the
miniapp source tree yet — this CLI is the first place it's wired up, so it
can be validated against real hardware before any miniapp work starts. If V8
support gets promoted into the miniapp later, these two files are the
porting reference (the same relationship the original Halo debugging script
had to today's `utils/wearable/halo/`).

The protocol is a close relative of Halo's — same GATT service/characteristic
UUIDs (`0xFFF0`/`0xFFF6`/`0xFFF7`), same 16-byte frame with an additive
checksum, and about 20 shared opcodes — ported from the vendor's Java source
(`ResolveUtil.java`/`BleSDK.java`/`DeviceConst.java`).

**Validated against a real band (2026-07-16, firmware `0.0.8.8`)**: battery,
device time, user profile, MAC (its last 3 bytes matched the advertised name
suffix — a strong independent check), firmware version, auto-monitoring
schedule (all 4 types), step totals + per-minute detail, one night of sleep
staging, continuous + static heart rate, HRV (including the highBP/lowBP
fields — their realistic ~120/70-range values confirmed the field positions,
despite the vendor source's local variable names at those offsets not
matching), skin temperature, and SpO2 all decoded to physiologically sane
values across hundreds of real history records. The per-notification
reassembly model (see the comment at the top of `src/v8-protocol.js`) is
confirmed correct: every history notification from this device was exactly
240 bytes (MTU-packed, multiple stacked records per notification), not one
record per notification like Halo.

Known rough edges from that run:
- `getBattery()`'s `voltage` field is a raw ADC count (~22800), not
  calibrated millivolts — no conversion formula was in the vendor SDK.
- `getHeartRateHistory()` (continuous HR, `0x54`) can have enough history
  that it doesn't hit its `0xFF` terminator inside the timeout — same
  "large history exceeds timeout" situation Halo's own docs describe.
  Handled the same way: falls back to partial results rather than blocking.
- Only the single-record (130-byte) sleep-parsing path has been exercised;
  the multi-record 34-byte path, `mode=0x02` (continue) and `mode=0x99`
  (delete), and `setTime()`/`setUserInfo()` writes are still unverified.
- Only a first-pass command set is implemented: device time, user profile,
  battery, MAC, firmware version, auto-monitoring schedule, steps, sleep,
  heart rate (log + history), HRV, temperature, and SpO2, plus the live ECG
  stream (see below). Alarms/clock, the sedentary reminder, device name,
  PPI, blood glucose, SOS, and OTA/DFU are out of scope for this pass.

The advertised BLE name prefix is `JCV8B` (confirmed directly by hand — the
vendor demo apps don't filter by name at all).

## Install

```bash
cd tools/halo
npm install
```

## Usage

```bash
# Fetch and print every stored data type from the ring (default command)
node bin/cli.js

# Same, but for a V8 band instead of a Halo ring
node bin/cli.js --device v8

# Scan for a specific device name and dump raw JSON
node bin/cli.js --name X3 --json
node bin/cli.js --device v8 --name JCV8B --json

# Connect to a known device directly (skips scanning)
node bin/cli.js --address <uuid>
node bin/cli.js --device v8 --address <uuid>

# Just list nearby devices
node bin/cli.js scan
node bin/cli.js scan --device v8

# Sync the device's clock to the current time
node bin/cli.js set-time
node bin/cli.js set-time --device v8

# Read the background measurement schedule (HR/SpO2/Temperature/HRV)
node bin/cli.js get-auto-monitoring
node bin/cli.js get-auto-monitoring --device v8

# Fetch one history stream (hr/hrv/spo2/temp), optionally with a --since
# date filter — used to validate the incremental-sync design, see below
node bin/cli.js history --type hrv --json
node bin/cli.js history --type hrv --since 2026-07-30T10:00:00 --json

# V8 only: run an on-demand ECG and capture the raw sample stream for 30s
node bin/cli.js ecg --device v8
node bin/cli.js ecg --device v8 --capture 60 --out ecg.csv

# V8 / Halo: stream the raw 50 Hz PPG channel for 60s (wrist on V8, finger on the ring)
node bin/cli.js ppg --device v8 --capture 60 --out ppg.json
node bin/cli.js ppg --device halo --path glucose --capture 60 --out ppg.json
```

With no arguments, `halo` scans for a nearby X3/X6/X9/V4 device, connects, and
dumps: battery, device time, MAC, firmware, auto-monitoring schedule, steps,
sleep history, heart rate (log + continuous history), HRV history, SpO2
(auto + detailed), sleep HRV, temperature (surface + sleep), exercise
sessions, sleep apnea risk, and elevated oxygen variation. `--device v8`
scans for `JCV8B` instead and dumps the narrower first-pass task list
described above.

## ECG (V8 only)

The band's ECG is a **live measurement**, not a history type — there is no
"fetch stored ECGs" opcode, and the vendor SDK ships no analysis library
(the `ECGHrValue`/`ECGQualityValue`/… keys in `DeviceKey.java` have no
producer). The only ECG output is a stream of raw 24-bit ADC samples on
opcode `0x07` while a measurement is running, so everything the CLI prints
beyond the samples themselves is derived here. Halo has no ECG at all; the
command refuses `--device halo`.

`node bin/cli.js ecg --device v8` sends the vendor demo's sequence
(`ECGActivity.java`) — `0x28 type=ECG open=1 duration=<capture seconds>`,
`0x07 open=1`, listen, then the same two with `open=0` — with one
deliberate difference: the duration is the capture length rather than the
demo's `50*1000`, because that is what actually ends the measurement (see
"The stop is the duration" below). Ctrl-C stops listening early; the band
then runs on to the end of its duration and buffers, which the next run
reports as a backlog. Each `0x07` notification is
`packetId (uint8, wraps) + N × 3-byte LE samples`; 16-byte frames on that
opcode are the enable ack, not data (the SDK gates on `length > 16`, and so
does `parseEcgChunk`).

Output: any backlog flushed from a previous measurement (see below),
packet/sample counts, lost packets (from `packetId` gaps), the effective
sample rate measured on this run (≈255 Hz on real hardware — the vendor
documents none), min/max/mean, a heart-rate estimate derived here from
R-peak detection (`estimateHeartRate`, validated against the band's own
optical HR), and whatever the band echoes on `0x28`.
`--out file.csv` writes `index,packetId,value`; any other extension writes
JSON with the per-packet arrival times. `--json` prints the flat sample array.

### Live findings (2026-09-19, two units, both firmware `0.0.8.8`)

**It works on both units** (`JCV8B 9525CA`, `JCV8B DBE34D`), and the rules
below account for every run of the day — including a long stretch that
looked like a firmware wedge and was electrode contact all along.

Stream: continuous, **≈255 Hz** (3 packets × 80 samples per second, a 4th
every ~5 s), 0 lost packets over a minute, clean QRS with T-waves (plots
and captures under `temp/v8-ecg/`). Derived heart rate (`estimateHeartRate`)
matched the band's own optical HR log for the same minutes (108–110 vs
105–113 bpm). `packetId` restarts at 0 on each new measurement.

**Contact owns the measurement.** The band needs the wrist contact *and* a
finger from the other hand on the electrode:

- No contact at start → the measurement aborts within ~3 s. `DBE34D` emits
  ~11 start-up packets first (a settling ramp, then a 5-packet burst);
  `9525CA` emits **nothing at all**. A start that returns zero packets is a
  contact miss, not a protocol failure — every "wedged" run of the day
  (through stop variants, a charger dock, an MCU reboot, a clock sync and
  `0x78` PPG stop/quit, all of which did nothing) was this.
- Contact lost while running → the measurement ends within ~2 s (the
  buffer tail shows the sample value jumping to ~3.8M at the moment the
  finger leaves).
- After a measurement ends by **duration expiry** the engine is "done" and
  will not start again until the finger is **lifted and re-placed** (like
  any consumer ECG's "measurement complete, remove finger"). A measurement
  ended by contact loss is already re-armed. Reproduced three times.
- Skin contact does not gate the *data*: a poor contact still streams, with
  heavy baseline wander (compare the two `9525CA` captures).

**`duration` is seconds, counted from the `0x28` start command.** A fresh
`duration=30` measurement stopped at 33 s after a start at 3.7 s (first
packet at 9 s — start-up latency counts against it). `30`, `300` and
`50000` all start identically. A `0x28` start sent **onto a running
measurement re-times it**: `50000` extends it (the backlog run below),
a value already elapsed ends it at once and leaves the engine in "done".
That, not a wedge, is what a `duration=30` sent onto a running measurement
did. The CLI's default is the capture length (below).

**The SDK's stop pair does not stop anything.** After `0x28 open=0` +
`0x07 off` the band keeps sampling while contact holds and **buffers
~150–200 packets (the last ~50–60 s)**, flushing them at ~33 packets/s the
moment `0x07` reopens — minutes later, on a fresh BLE connection — before
resuming live. `summarizeEcg` splits that flush off as `backlogPackets`
(everything before the first >500 ms gap when it holds more than a normal
start's 3 packets) and computes rate/HR on the live part only; the CLI
prints the count. Any future adapter must expect up to a minute of stale
samples on tap-open.

Confirmed frame behaviour: `0x28 type=ECG` is acked `28 04 00 00…` for
both start and stop (byte 2 is a status, not the open flag; the SDK has no
branch for it — `parseMeasurementResult` surfaces it raw); `0x07` acks by
echoing the flag in byte 2 (`07 00 01` on, `07 00 00` off); order of the
pair doesn't matter; `0x07` alone with no measurement streams nothing;
`0x28 type=HRV` with the tap open streams no ECG (the "During HRV" in the
SDK method name is misleading).

**The stop is the duration.** Since the SDK pair stops nothing, the CLI
asks the band for a measurement exactly as long as the capture
(`--duration` defaults to `--capture`, in seconds): the band ends it itself
at the end of the capture, so nothing is left running to pollute the next
run with a backlog. Verified end-to-end: a `--capture 20` run streamed 59
packets at 256.5 Hz with no backlog, and a tap-open probe straight after
found no buffered and no live packets. The demo's stop pair is still sent
afterwards (harmless). **Do not try to stop a running measurement by
re-sending `0x28` with a short duration**: `duration=1` onto a running one
paused sampling with the packet counter intact and `0x07 on` resumed it;
`duration=30` onto an older one killed it; and after the `duration=1`
experiment the next fresh start returned nothing until the finger had been
off for a full 5 s. The one reliable rule for a zero-packet start remains:
lift the finger, re-place it, run again.

Battery: the 1% runs on `DBE34D` were all contact misses in hindsight; no
battery effect was demonstrated.

Offline tests for the packet builders/parsers and the capture loop (using
the vendor's published sample packet) live in `test/` — `npm test`.

## PPG (V8 and Halo)

```
node bin/cli.js --device v8 ppg --capture 60 --out ppg.json
node bin/cli.js --device halo ppg --capture 40 --path glucose --out ppg-x3.json
```

The raw optical channel, which the vendor SDK only exposes as the "blood
glucose" collection (`BleSDK.ppgWithMode` — the band streams five minutes of
PPG for a server to grade). Probed live 2026-09-20 on `DBE34D` and `9525CA`:

- **Command `0x78 [mode, status]`**: mode 1 start, 3 stop, 5 quit (2 = send a
  result to the band, 4 = progress % for its display — neither is needed for
  the stream). The band echoes every one back as `78 00 <mode>`.
- **Data `0x3a`**: 203-byte frames = `3a 00 <seq>` + **50 × 4-byte big-endian
  samples** (top byte always 0 → 24-bit counts, ~3–6 M on-wrist). One frame
  per second, contiguous (junction steps equal within-frame steps), so the
  stream is **50 Hz**. The SDK's other branch (153-byte frames, 3-byte samples)
  was never seen. No gain, LED or channel is documented; the SDK's own
  sample frame shows the same slow, smooth trace.
- **The pulse is small.** The AC swing is a few % of the DC level and the
  band re-ranges its gain on motion (a 5.2 M → 0.6 M step in one frame);
  low-frequency wander dominates unless the arm rests still. High-passed at
  0.5 s the plethysmogram is clear — 0.7 s peak spacing, fast upstroke,
  dicrotic shoulder — and a 60 s still capture gave PPI median 680 ms
  (88 bpm) with 51/77 intervals accepted, sd 70 ms. Good enough for heart
  rate; not for beat-level HRV without a better detector and a snug strap.
- No finger, no electrode: unlike ECG this runs from the wrist alone, and
  starts within ~3 s of the command.

`--out` keeps every frame raw (hex) plus the BE and LE decodes; the CLI
derives nothing from the samples.

**Halo** (`--device halo`, probed 2026-09-20 on `X3B 69526`) has the same
`0x78`/`0x3a` path and streams the **identical** 203-byte, 50 Hz frames —
`--path glucose`. On a finger the pulse is much cleaner than the V8's wrist
signal (AC ≈ 0.5 % of DC but a constant 1.35 Hz peak, dicrotic wave visible;
PPI median 720 ms, 38/50 accepted, sd 51 ms over 40 s still). The ring also
pushes `0xaa …` after start and `0xab …` after stop (not in the SDK; ignored).
The SDK's second, Halo-only path `0x11` (`--path stream`) is **acked but sends
no data** on this ring — recorded as unverified in `halo-smart-ring.md` §3.13.
`--path both` (the default for halo) runs stream then glucose back to back.

## Incremental sync validation

The Mini Program used to re-fetch full history (protocol mode `0x00`) for
static HR, HRV, SpO2, and temperature on every sync, even though the protocol
supports mode `0x01` ("read from a given BCD date") — see
`docs/architecture/halo-smart-ring.md` §9, now implemented. That mode is
wired into `HaloClient`/`V8Client` here (`getHeartRateLog`/`getHrvHistory`/
`getAutoSpo2History`(Halo)/`getSpo2History`(V8)/`getTemperatureHistory`, all
taking an optional trailing `sinceDate`) — originally added to validate
against real hardware before the Mini Program relied on it, still useful for
re-validating after any protocol change.

**Confirmed live 2026-07-30 against a real V8 band, and load-bearing for
anyone re-testing this**: mode `0x01` only returns a filtered result when
`since` *exactly* matches one of the device's own stored record timestamps
(to the second, inclusive of that record). Any other value — even one
second off, in either direction — makes the device silently fall back to
returning its **entire** history, indistinguishable from mode `0x00`. A
naive "N minutes/hours ago" test value will almost never hit this exactly
and will misleadingly look like `0x01` "doesn't work." See
`docs/architecture/v8-smart-band.md` §"History sync mode byte" for the full
test matrix (HRV, SpO2, and temperature all confirmed working under this
constraint; static HR inconclusive — no data on the test unit to filter).

Validation procedure (repeat once for Halo, once for V8 — substitute
`--type hr|spo2|temp` for `hrv` below):

```bash
# 1. Baseline — mode 0x00, note the exact `last` timestamp
node bin/cli.js history --type hrv --json

# 2. Re-request using that EXACT timestamp as --since (copy it verbatim —
#    do not compute your own "N minutes ago" offset, it will not match):
node bin/cli.js history --type hrv --since <baseline's exact "last" value> --json
# Expect: count=1, matching just that one record (inclusive boundary) — this
# is the "nothing new since last sync" case and is the correct/expected
# result, not a failure.

# 3. Let a new auto-monitor sample land (or trigger one), then repeat step 2
#    with the SAME --since value from step 1:
# Expect: count > 1 now — the original record plus the new one(s).

# 4. Sanity-check the exact-match requirement by deliberately using a
#    mismatched --since (e.g. the step 1 timestamp shifted by 1 second):
# Expect: the full baseline count comes back — confirms this device/command
# needs an exact match, not a >= range filter.
```

## Notes

- Requires macOS Bluetooth permission for the terminal/Node process.
- If more than one matching device is found, the first is used — pass
  `--address` to target a specific one.
