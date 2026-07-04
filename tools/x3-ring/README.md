# x3-ring

CLI tool for reading data from the X3 smart ring over BLE (macOS, via `noble`).

It reuses the production X3 protocol (packet builders, BCD/byte parsers) from
`src/mini/nano-miniapp/utils/wearable/x3/` — only the BLE transport differs
(this uses `noble`/Node instead of the Mini Program's `wx.*` APIs). If the
X3 protocol changes in the miniapp, this tool picks it up automatically.

## Install

```bash
cd tools/x3-ring
npm install
```

## Usage

```bash
# Fetch and print every stored data type from the ring (default command)
node bin/cli.js

# Same, but scan for a specific ring name and dump raw JSON
node bin/cli.js --name X3 --json

# Connect to a known device directly (skips scanning)
node bin/cli.js --address <uuid>

# Just list nearby X3/X6 rings
node bin/cli.js scan

# Sync the ring's clock to the current time
node bin/cli.js set-time

# Read the background measurement schedule (HR/SpO2/Temperature/HRV)
node bin/cli.js get-auto-monitoring
```

With no arguments, `x3_ring` scans for a nearby X3/X6 ring, connects, and
dumps: battery, device time, MAC, firmware, auto-monitoring schedule, steps,
sleep history, heart rate (log + continuous history), HRV history, SpO2
(auto + detailed), sleep HRV, temperature (surface + sleep), exercise
sessions, sleep apnea risk, and elevated oxygen variation.

## Notes

- Requires macOS Bluetooth permission for the terminal/Node process.
- If more than one matching ring is found, the first is used — pass
  `--address` to target a specific one.
