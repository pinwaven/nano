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
  heart rate (log + history), HRV, temperature, and SpO2. Alarms/clock, the
  sedentary reminder, device name, ECG, PPI, blood glucose, SOS, and
  OTA/DFU are out of scope for this pass.

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
```

With no arguments, `halo` scans for a nearby X3/X6/X9/V4 device, connects, and
dumps: battery, device time, MAC, firmware, auto-monitoring schedule, steps,
sleep history, heart rate (log + continuous history), HRV history, SpO2
(auto + detailed), sleep HRV, temperature (surface + sleep), exercise
sessions, sleep apnea risk, and elevated oxygen variation. `--device v8`
scans for `JCV8B` instead and dumps the narrower first-pass task list
described above.

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
