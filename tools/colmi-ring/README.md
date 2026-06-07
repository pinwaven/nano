# Colmi Ring CLI — macOS Troubleshooting Tool

Node.js CLI for inspecting, testing, and debugging Colmi smart rings (R10, R02, and compatible) directly over BLE on macOS. Used in the Waven Nano project to diagnose miniapp sync issues, validate ring firmware responses, and capture raw BLE packets.

## Setup

```bash
cd tools/colmi-ring
npm install
```

**macOS Bluetooth permission**: On first run macOS will prompt for Bluetooth access — click Allow. If the prompt never appears, go to System Settings → Privacy & Security → Bluetooth and add your terminal app (Terminal or iTerm2) manually.

**Only one connection at a time**: The ring maintains a single BLE connection. Disconnect from the miniapp or phone before using the CLI, or the connection will be refused.

---

## Step 1 — Find your ring's address

```bash
node bin/util.js scan
```

```
Found device(s)
                Name  | Address
--------------------------------------------
        COLMI R10_D606  |  4dd20ec90c43ddf59d1c630dfd17d865
```

The address (a CoreBluetooth UUID on macOS — no colons, lowercase) is passed as `--address` in every command. The ring only advertises when not connected to another device.

---

## Commands

All commands:
- `--address <uuid>` — required (from scan above)
- `--debug` — print every sent/received BLE packet as hex, useful for comparing against miniapp behavior

### Set ring clock

```bash
node bin/cli.js --address <uuid> set-time
```

Syncs the ring clock to the computer's current **local time**. The ring stores all data (steps, sleep, HR) indexed by local date. If the clock is set to UTC instead of local time, China (UTC+8) users will see today's steps as 0 because they were stored 8 hours behind.

> The miniapp calls this automatically on first bind (`syncTime: true`). Run it manually if the ring has been reset, or to verify clock behavior.

There is no "get time" command — the clock can only be set, not read back.

---

### Battery / device info

```bash
node bin/cli.js --address <uuid> info
```

---

### Steps

```bash
# Today
node bin/cli.js --address <uuid> get-steps

# Specific date
node bin/cli.js --address <uuid> get-steps --when 2026-06-06

# CSV (per-5-minute buckets)
node bin/cli.js --address <uuid> get-steps --when 2026-06-06 --as-csv
```

If today returns 0, run `set-time` first — the wrong clock date is the most common cause.

---

### Heart rate log

```bash
node bin/cli.js --address <uuid> get-heart-rate-log --target 2026-06-06
```

Returns the automatic background HR readings (one per logging interval, default 60 min). The minimum reading across the day is used as resting HR by the miniapp.

---

### Heart rate log settings

```bash
node bin/cli.js --address <uuid> get-heart-rate-log-settings
node bin/cli.js --address <uuid> set-heart-rate-log-settings --interval 10
node bin/cli.js --address <uuid> set-heart-rate-log-settings --disable
```

Interval is in minutes (1–255).

---

### Sleep

```bash
node bin/cli.js --address <uuid> get-sleep
```

Returns last night's sleep: total duration, deep/light/REM/awake, and stage timeline. The ring must have been worn overnight and the clock set correctly beforehand.

```
--- Last night ---
  Sleep:  23:12 – 07:31
  Total:  379 min
  Deep:   88 min
  Light:  221 min
  REM:    52 min
  Awake:  18 min
```

Sleep data disappears if the ring clock is reset — setting the clock shifts the date key used to store sleep records.

---

### Real-time measurements

The ring must be worn on the finger during measurement.

```bash
node bin/cli.js --address <uuid> get-real-time <type>
```

| Type | Typical duration | Normal range | Notes |
|---|---|---|---|
| `heart-rate` | ~10 s | 50–100 bpm | Quick spot check |
| `spo2` | ~50 s | 95–100 % | Blood oxygen |
| `pressure` | ~30 s | 0–100 | Stress score |
| `hrv` | **~90–105 s** | 20–100 ms | See HRV notes below |
| `blood-pressure` | ~30 s | — | Requires calibration on ring |

```bash
# SpO2 example — returns 6 consecutive readings
node bin/cli.js --address <uuid> get-real-time spo2
# → [ 97, 97, 96, 96, 99, 99 ]

# HRV — wait ~2 minutes with ring still on finger
node bin/cli.js --address <uuid> get-real-time hrv
# → [ 42 ]   (RMSSD in ms)

# Stress
node bin/cli.js --address <uuid> get-real-time pressure
# → [ 38, 40, 39, 40, 41, 39 ]
```

#### HRV protocol (R10-specific)

HRV is fundamentally different from all other real-time types:

1. **~30 s warmup**: ring sends continuous zero-value packets (`data[3]=0`) — do not interrupt
2. **~60 s streaming**: ring sends individual RR intervals (heartbeat timings) in `data[6:7]` as 16-bit little-endian ms values. Example: `0x0322 = 802 ms ≈ 75 bpm`
3. **Final packet**: ring sends one packet with `data[3] = RMSSD_value` (e.g. 42 ms) — this is the result

**Total time: ~90–105 seconds.** If you interrupt before this final packet, you get null.

To see the raw RR streaming:
```bash
node bin/cli.js --address <uuid> --debug get-real-time hrv
# Shows: [69 0a 00 00 00 00 22 03 ...] → RR=802ms
#        [69 0a 00 00 00 00 c3 02 ...] → RR=707ms
#        ...
#        [69 0a 00 2a 00 00 7c 02 ...] → RMSSD=42ms (final)
```

---

### Raw packet debugging

Send any command byte and capture responses:

```bash
node bin/cli.js --address <uuid> --debug raw --command <byte> --subdata <hex> --replies <n>
```

Examples:
```bash
# Battery (CMD=3)
node bin/cli.js --address <uuid> --debug raw --command 3 --replies 1

# Start real-time HRV (CMD=0x69=105, type=10, action=1)
node bin/cli.js --address <uuid> --debug raw --command 105 --subdata 0a01 --replies 5
```

---

### Sync to SQLite

```bash
node bin/cli.js --address <uuid> sync --db ring.sqlite --start 2026-06-01 --end 2026-06-06
```

Saves HR logs and step data into a local SQLite file. Useful for bulk inspection or regression comparisons.

```sql
-- Daily step totals
SELECT date(timestamp) as day, SUM(steps) as steps
FROM sport_details GROUP BY day ORDER BY day;

-- Resting HR estimate (daily minimum)
SELECT date(timestamp) as day, MIN(reading) as resting_hr
FROM heart_rates GROUP BY day ORDER BY day;
```

---

### Reboot

```bash
node bin/cli.js --address <uuid> reboot
```

---

## Troubleshooting scenarios

### Steps show 0 after miniapp sync

1. Verify ring clock: `set-time` then sync again
2. Confirm with CLI: `get-steps` — if CLI also shows 0, data wasn't recorded (ring not worn, or steps below threshold)
3. If CLI shows correct steps but miniapp shows 0, it's a parser bug — run `--debug` and compare raw packets

### Sleep data is missing or disappeared

1. Confirm ring was worn overnight
2. `get-sleep` shows `daysAgo=0` for last night and `daysAgo=1` for the night before. Only 2 nights are stored.
3. If data was present and is now gone, the ring clock was likely reset. All data is indexed by local date — a clock reset shifts the date key.
4. Calling `set-time` during sync (not just bind) causes the ring to re-index, which can make sleep from the previous night disappear. The miniapp only calls `set-time` on bind, not on every sync.

### HRV is null after miniapp sync

HRV takes 90–105 s. The miniapp timeout is 110 s. If sync was started and the ring was worn, HRV should work. Check:
- Was the ring on the finger for the full ~2 minutes of the background phase?
- Did the app go to the background? WeChat may suspend JS execution when backgrounded.

Verify ring HRV works at all:
```bash
node bin/cli.js --address <uuid> get-real-time hrv
# Must stay on finger, wait ~2 min
```

### SpO2 shows wrong value (e.g. 38%)

The SpO2 result is in `data[3]` of the final response packet. A garbage value like 38% means the ring wasn't on the finger, or a stale response packet from the previous measurement (stress) bled into the SpO2 handler. The miniapp filter now checks `data[1] === readingType` to prevent this.

To verify:
```bash
node bin/cli.js --address <uuid> --debug get-real-time spo2
# Look for packets like: [69 03 00 61 01 ...] → data[3]=0x61=97%
```

### BLE connection refused or stuck

```bash
# Kill any stray CLI processes competing for the adapter
ps aux | grep cli.js | grep -v grep | awk '{print $2}' | xargs kill
```

Then verify no phone or other device is connected to the ring.

---

## Protocol reference

All UART packets are fixed 16 bytes: `[command, payload×14, checksum]`. Checksum = sum of bytes 0–14 mod 256.

On the R10, response packets have the **same command byte as the request** — the high bit (`cmd | 0x80`) is NOT set in responses (contrary to some documentation).

### Real-time reading response format (CMD=0x69)

| Byte | Meaning |
|---|---|
| `data[0]` | `0x69` (command, same as request) |
| `data[1]` | Reading type: 1=HR, 3=SpO2, 8=pressure/stress, 10=HRV |
| `data[2]` | `0` = reading available; non-zero = still measuring or error |
| `data[3]` | Result value when `data[2]=0`; `0` while measuring |
| `data[6:7]` | HRV only: current RR interval in ms (uint16 little-endian) during streaming phase |

**Filter rule**: accept only packets where `data[1] === expected_type` to prevent stale packets from a previous measurement being mistaken for the current one.

**CONTINUE packets reset the R10**: do not send CMD=0x69 with action=CONTINUE during an ongoing measurement. The R10 interprets it as restarting the measurement from scratch.

### BLE services

| Service | UUID |
|---|---|
| UART (steps, HR, real-time) | `6E40FFF0-B5A3-F393-E0A9-E50E24DCCA9E` |
| UART RX (write to ring) | `6E400002-B5A3-F393-E0A9-E50E24DCCA9E` |
| UART TX (notifications) | `6E400003-B5A3-F393-E0A9-E50E24DCCA9E` |
| Big Data V2 (sleep) | `DE5BF728-D711-4E47-AF26-65E3012A5DC7` |
| Big Data RX | `DE5BF72A-D711-4E47-AF26-65E3012A5DC7` |
| Big Data TX | `DE5BF729-D711-4E47-AF26-65E3012A5DC7` |

Sleep uses the Big Data V2 service (separate from UART). The request is command `0xBC` sent to the Big Data RX characteristic. Response is variable-length and may span multiple notification packets.
