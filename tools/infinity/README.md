# Infinity Ring BLE CLI

Standalone Node CLI for probing an Infinity/Aizo ring over Bluetooth LE.

The WeChat demo in `temp/aizoring_sdk_demo` does not include the raw Bluetooth
protocol implementation. It lazy-loads a closed mini program plugin:

- plugin name: `RingPlug`
- provider: `wxfd42c6749120cf46`
- version in the demo: `1.0.2`

This tool therefore uses the protocol constants and packet shapes already
captured in this repo's older Aizo/Infinity adapter, but keeps them copied under
`tools/infinity` so no miniapp code is changed.

## Install

```bash
cd tools/infinity
npm install
```

If `tools/halo/node_modules` is already installed, the CLI can also reuse that
local noble dependency as a fallback.

## Usage

```bash
# scan
node bin/cli.js scan

# fetch all supported data
node bin/cli.js --json

# connect to a specific device
node bin/cli.js --address <bluetooth-address-or-uuid> --json

# individual reads
node bin/cli.js battery
node bin/cli.js steps
node bin/cli.js sleep --json
node bin/cli.js stress --json
node bin/cli.js heart-rate --json
node bin/cli.js spo2 --json
```

## Raw Exploration

Use `raw` to send a framed command while exploring gaps between the closed
plugin and the currently known protocol.

```bash
# Equivalent shape to watch-info type 2:
node bin/cli.js raw --cmd 0x38 --payload 383802 --expect 0x38

# Stream multiple sleep frames:
node bin/cli.js raw --cmd 0x35 --payload 3535$(date +%y%m%d%H%M%S) --expect 0x35 --stream
```

Known UUIDs:

- service: `0000fe02-0000-1000-8000-00805f9b34fb`
- write: `00000101-0000-1000-8000-00805f9b34fb`
- notify: `0000010a-0000-1000-8000-00805f9b34fb`

Known reads currently implemented:

- bind/auth handshake
- battery/status via watch-info type `2`
- steps
- sleep detail frames with stage aggregation
- pressure/stress
- heart-rate and SpO2 best-effort timestamp/value parsing

## Troubleshooting

If the CLI prints `Bluetooth adapter did not become poweredOn ... state=unsupported`,
Node/noble cannot access Bluetooth from the current shell environment. Try a
normal local Terminal session on the Mac with Bluetooth enabled and grant
Bluetooth permission if macOS prompts for it.
