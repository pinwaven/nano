# Aizo / Infinity Ring BLE CLI

CLI tool for the Aizo "Infinity" smart ring over Bluetooth LE — no Android SDK
and no WeChat miniprogram required. Replaces the earlier `tools/infinity`,
which implemented an incomplete/incorrect subset of the protocol (see
`docs/protocol_spec.md` §9 for what was wrong there).

The protocol was reverse-engineered by decompiling the vendor's Android AAR
libraries and verified live against a physical ring. Full derivation and
byte-level layouts: [`docs/protocol_spec.md`](docs/protocol_spec.md).

## Install

```bash
cd tools/aizoring
npm install
```

## Usage

```bash
# fetch and print everything (battery, steps, health/sleep/sport history, intervals)
node bin/cli.js
node bin/cli.js --json

# scan only
node bin/cli.js scan

# connect to a specific device (skip scanning)
node bin/cli.js --address <bluetooth-address-or-uuid>

# on-demand live measurement (hr, spo2, temp — stress does not spot-measure)
node bin/cli.js measure hr

# read/set auto-monitoring intervals
node bin/cli.js monitor
node bin/cli.js monitor --hr 20 --stress 45

# stored history
node bin/cli.js health --days 3
node bin/cli.js sleep
node bin/cli.js sport

# raw protocol exploration
node bin/cli.js raw 3838   # watch-info/battery request
```

## What's implemented

- Bind/auth handshake, frame reassembly (chunked + ACK'd frames), auto-reconnect
- Device status/battery, steps
- Stored history sync: health (HR/SpO2/HRV/stress/temperature), sleep
  (summary + per-stage detail), sport/workout records
- On-demand measurement: HR, SpO2, temperature (stress needs the auto-monitor
  schedule — spot measurement isn't supported by this firmware)
- Auto-monitoring interval read/set (HR and stress)

Sport-record detail/end opcodes (`0x9642`/`0x9644`) are pattern-inferred, not
yet observed live — this ring has no stored workouts to trigger them. Any
unrecognized `0x96xx` frame surfaces as `sportRaw` so it can be pinned down
once one exists; use `raw` for further protocol exploration.

## Troubleshooting

If the ring shows as "Connected" under System Settings → Bluetooth but the CLI
can't find it, **Forget This Device** first — the ring also advertises a HID
service, so macOS auto-bonds it as an accessory, and a bonded/connected BLE
peripheral doesn't advertise (noble/CoreBluetooth can never discover it while
bonded).

If `Bluetooth adapter did not become poweredOn` appears, Node/noble can't
access Bluetooth from the current shell — run from a normal Terminal session
with Bluetooth permission granted.

## Layout

| Path | What |
|---|---|
| `bin/cli.js` | Commander-based CLI entry point |
| `src/protocol.js` | Frame build/parse, CRC16, request builders, response decoders |
| `src/client.js` | `AizoRingClient` — bind/auth, request/response matching, high-level API |
| `src/ble.js` | noble BLE transport (scan/connect/write/notify) |
| `src/report.js` | Pretty-printer for the default `fetch-all` report |
| `docs/protocol_spec.md` | Full protocol spec and verification notes |
