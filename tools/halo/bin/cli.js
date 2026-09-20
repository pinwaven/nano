#!/usr/bin/env node
'use strict';

const { Command } = require('commander');
const { HaloClient } = require('../src/halo');
const { V8Client } = require('../src/v8');
const printReport = require('../src/print-report');

const program = new Command();

program
  .name('halo')
  .description('CLI tool for the Halo smart ring / V8 smart band over BLE. Run with no arguments to fetch and print all stored data.')
  .option('--address <address>', 'bluetooth address/UUID of the device (skips scanning)')
  .option('--device <type>', 'device type: halo or v8', 'halo')
  .option('--name <prefix>', 'name prefix to scan for (default: X3/X6/X9/V4 for halo, JCV8B for v8 — the hardware\'s BLE-advertised name)')
  .option('--scan-timeout <ms>', 'scan duration in milliseconds', '8000')
  .option('--debug', 'enable debug logging', false)
  .option('--json', 'print raw JSON instead of a formatted report', false);

const DEVICE_TYPES = {
  halo: { Client: HaloClient, label: 'Halo ring' },
  v8: { Client: V8Client, label: 'V8 band' },
};

function getDeviceType(opts) {
  const type = DEVICE_TYPES[opts.device];
  if (!type) {
    console.error(`Unknown --device "${opts.device}". Expected one of: ${Object.keys(DEVICE_TYPES).join(', ')}`);
    process.exit(1);
  }
  return type;
}

function deviceId(peripheral) {
  return peripheral.address && peripheral.address !== 'unknown' ? peripheral.address : peripheral.uuid;
}

async function resolveAddress(opts) {
  if (opts.address) return opts.address;

  const { Client, label } = getDeviceType(opts);
  const prefixes = opts.name ? [opts.name] : undefined;
  console.error(`Scanning for ${label}...`);
  const found = await Client.scan(parseInt(opts.scanTimeout, 10));
  const matches = prefixes
    ? found.filter((p) => prefixes.some((pre) =>
        ((p.advertisement && p.advertisement.localName) || '').toLowerCase().startsWith(pre.toLowerCase())))
    : found;

  if (!matches.length) {
    console.error(`No ${label} found. Make sure it is powered on and nearby, or pass --address.`);
    process.exit(1);
  }
  if (matches.length > 1) {
    console.error(`Found ${matches.length} devices, using the first. Pass --address to pick a specific one:`);
    for (const p of matches) {
      console.error(`  ${deviceId(p)}  ${(p.advertisement && p.advertisement.localName) || '(unnamed)'}  rssi=${p.rssi}`);
    }
  }
  return deviceId(matches[0]);
}

async function makeClient(opts) {
  const { Client } = getDeviceType(opts);
  const address = await resolveAddress(opts);
  console.error(`Connecting to ${address}...`);
  return new Client(address, { debug: opts.debug });
}

// --- default: fetch everything ---
program
  .command('fetch-all', { isDefault: true })
  .description('Connect to the ring and dump every stored data type (default when run with no arguments)')
  .action(async () => {
    const opts = program.opts();
    const client = await makeClient(opts);

    const HALO_TASKS = [
      ['battery', (c) => c.getBattery()],
      ['deviceTime', (c) => c.getDeviceTime()],
      ['mac', (c) => c.getMac()],
      ['firmwareVersion', (c) => c.getFirmwareVersion()],
      ['autoMonitoring', (c) => c.getAutoMonitoringAll()],
      ['steps', (c) => c.getSteps()],
      ['sleepHistory', (c) => c.getSleepHistory()],
      ['heartRateLog', (c) => c.getHeartRateLog()],
      ['heartRateHistory', (c) => c.getHeartRateHistory()],
      ['hrvHistory', (c) => c.getHrvHistory()],
      ['autoSpo2History', (c) => c.getAutoSpo2History()],
      ['spo2History', (c) => c.getSpo2History()],
      ['sleepHrv', (c) => c.getSleepHrv()],
      ['temperatureHistory', (c) => c.getTemperatureHistory()],
      ['sleepTemperatureLog', (c) => c.getSleepTemperatureLog()],
      ['exerciseSessions', (c) => c.getExerciseSessions()],
      ['sleepApneaRisk', (c) => c.getSleepApneaRisk()],
      ['oxygenVariation', (c) => c.getOxygenVariation()],
    ];

    // V8's task list only covers stored history (see tools/halo/README.md) --
    // blood glucose, alarms, PPI, and OTA are follow-ups. ECG is a live
    // measurement, not a history type: `node bin/cli.js ecg --device v8`.
    const V8_TASKS = [
      ['battery', (c) => c.getBattery()],
      ['deviceTime', (c) => c.getDeviceTime()],
      ['userInfo', (c) => c.getUserInfo()],
      ['mac', (c) => c.getMac()],
      ['firmwareVersion', (c) => c.getFirmwareVersion()],
      ['autoMonitoring', (c) => c.getAutoMonitoringAll()],
      ['steps', (c) => c.getSteps()],
      ['sleepHistory', (c) => c.getSleepHistory()],
      ['heartRateLog', (c) => c.getHeartRateLog()],
      ['heartRateHistory', (c) => c.getHeartRateHistory()],
      ['hrvHistory', (c) => c.getHrvHistory()],
      ['temperatureHistory', (c) => c.getTemperatureHistory()],
      ['spo2History', (c) => c.getSpo2History()],
    ];

    const tasks = opts.device === 'v8' ? V8_TASKS : HALO_TASKS;

    const data = {};
    await client.run(async (c) => {
      for (const [key, fn] of tasks) {
        console.error(`Fetching ${key}...`);
        try {
          data[key] = await fn(c);
        } catch (err) {
          data[key] = { error: err.message };
        }
      }
    });

    if (opts.json) {
      console.log(JSON.stringify(data, null, 2));
    } else {
      printReport(data);
    }
    process.exit(0);
  });

// --- history: incremental-sync (mode 0x01) validation ---
// See docs/architecture/halo-smart-ring.md §9 and tools/halo/README.md.
// Usage pattern to validate the "since last sync" design before it's wired
// into the Mini Program:
//   1. node bin/cli.js history --type hrv --json         (baseline, mode 0x00)
//   2. (let a new auto-monitor sample land, or trigger one)
//   3. node bin/cli.js history --type hrv --since <max timestamp from step 1> --json
//   4. Compare: step 3 should return strictly fewer records than step 1,
//      all with timestamps on the correct side of --since.
const HISTORY_TYPES = {
  halo: {
    hr:   (c, since) => c.getHeartRateLog(undefined, since),
    hrv:  (c, since) => c.getHrvHistory(since),
    spo2: (c, since) => c.getAutoSpo2History(since),
    temp: (c, since) => c.getTemperatureHistory(since),
  },
  v8: {
    hr:   (c, since) => c.getHeartRateLog(since),
    hrv:  (c, since) => c.getHrvHistory(since),
    spo2: (c, since) => c.getSpo2History(since),
    temp: (c, since) => c.getTemperatureHistory(since),
  },
};

// Records use different key fields across type/device: Halo's hr uses a Date
// object at `.timestamp`; Halo's hrv/spo2 use a string `.timestamp`; every
// other combination (Halo temp, all of V8) uses a string `.date`.
function recordKey(rec) {
  const v = rec.timestamp != null ? rec.timestamp : rec.date;
  return v instanceof Date ? v.toISOString() : v;
}

program
  .command('history')
  .description('Fetch one history stream (hr/hrv/spo2/temp) with an optional --since date filter, to validate the incremental-sync (mode 0x01) design against real hardware')
  .requiredOption('--type <type>', 'hr, hrv, spo2, or temp')
  .option('--since <iso>', 'ISO date filter — request mode 0x01 from this date instead of the default mode 0x00 (latest/full)')
  .action(async (cmdOpts) => {
    const opts = program.opts();
    const fns = HISTORY_TYPES[opts.device];
    const fn = fns && fns[cmdOpts.type];
    if (!fn) {
      console.error(`Unknown --type "${cmdOpts.type}" for --device "${opts.device}". Expected one of: ${Object.keys(fns || {}).join(', ')}`);
      process.exit(1);
    }
    const sinceDate = cmdOpts.since ? new Date(cmdOpts.since) : undefined;
    const client = await makeClient(opts);
    console.error(sinceDate
      ? `Fetching ${cmdOpts.type} (mode 0x01, since ${sinceDate.toISOString()})...`
      : `Fetching ${cmdOpts.type} (mode 0x00, latest/full)...`);
    const records = await client.run((c) => fn(c, sinceDate));
    const keys = records.map(recordKey).filter(Boolean).sort();

    if (opts.json) {
      console.log(JSON.stringify({ mode: sinceDate ? '0x01' : '0x00', since: sinceDate ? sinceDate.toISOString() : null, count: records.length, first: keys[0] || null, last: keys[keys.length - 1] || null, records }, null, 2));
    } else {
      console.log(`type=${cmdOpts.type}  mode=${sinceDate ? '0x01' : '0x00'}  count=${records.length}  first=${keys[0] || '-'}  last=${keys[keys.length - 1] || '-'}`);
    }
    process.exit(0);
  });

// --- scan ---
program
  .command('scan')
  .description('Scan for nearby devices (--device halo|v8)')
  .action(async () => {
    const opts = program.opts();
    const { Client, label } = getDeviceType(opts);
    const timeout = parseInt(opts.scanTimeout, 10);
    console.error(`Scanning for ${label} for ${timeout}ms...`);
    const found = await Client.scan(timeout);
    if (!found.length) {
      console.log('No devices found.');
    } else {
      for (const p of found) {
        console.log(`${deviceId(p)}  ${(p.advertisement && p.advertisement.localName) || '(unnamed)'}  rssi=${p.rssi}`);
      }
    }
    process.exit(0);
  });

// --- set-time ---
program
  .command('set-time')
  .description("Sync the ring's clock to the current (or given) time")
  .option('--when <datetime>', 'datetime to set (ISO format, defaults to now)')
  .action(async (cmdOpts) => {
    const opts = program.opts();
    const when = cmdOpts.when ? new Date(cmdOpts.when) : new Date();
    const client = await makeClient(opts);
    await client.run(async (c) => {
      await c.setTime(when);
    });
    console.log('Time set successfully.');
    process.exit(0);
  });

// --- get-auto-monitoring ---
program
  .command('get-auto-monitoring')
  .description('Read the background measurement schedule (HR/SpO2/Temperature/HRV work mode, window, interval)')
  .action(async () => {
    const opts = program.opts();
    const client = await makeClient(opts);
    const schedule = await client.run(async (c) => c.getAutoMonitoringAll());
    if (opts.json) {
      console.log(JSON.stringify(schedule, null, 2));
    } else {
      const workModes = { 0: 'off', 1: 'continuous', 2: 'scheduled' };
      const labels = { heartRate: 'Heart Rate', spo2: 'SpO2', temperature: 'Temperature', hrv: 'HRV' };
      for (const key of Object.keys(labels)) {
        const s = schedule[key];
        const mode = workModes[s.workMode] || `unknown(${s.workMode})`;
        console.log(`${labels[key].padEnd(11)} mode=${mode.padEnd(10)} window=${s.startTime}-${s.endTime}  weekdays=0x${s.weekdays.toString(16)}  interval=${s.intervalMinutes}min`);
      }
    }
    process.exit(0);
  });

// --- set-auto-monitoring ---
program
  .command('set-auto-monitoring')
  .description('Write the background measurement schedule for one type (HR/SpO2/Temperature/HRV)')
  .requiredOption('--type <type>', 'hr, spo2, temperature, or hrv')
  .option('--work-mode <n>', '0=off, 1=continuous, 2=scheduled', '1')
  .option('--interval <minutes>', 'sampling interval in minutes', '10')
  .option('--start <HH:MM>', 'schedule window start (scheduled mode only)', '00:00')
  .option('--end <HH:MM>', 'schedule window end (scheduled mode only)', '23:59')
  .option('--weekdays <hex>', 'weekday bitmask, e.g. 0x7f or 0xff (all days)', '0x7f')
  .action(async (cmdOpts) => {
    const opts = program.opts();
    const TYPES = { hr: 1, spo2: 2, temperature: 3, hrv: 4 };
    const type = TYPES[cmdOpts.type.toLowerCase()];
    if (!type) {
      console.error(`Unknown --type "${cmdOpts.type}". Expected one of: ${Object.keys(TYPES).join(', ')}`);
      process.exit(1);
    }
    const [startHour, startMinute] = cmdOpts.start.split(':').map((n) => parseInt(n, 10));
    const [endHour, endMinute] = cmdOpts.end.split(':').map((n) => parseInt(n, 10));
    const settings = {
      type,
      workMode: parseInt(cmdOpts.workMode, 10),
      intervalMinutes: parseInt(cmdOpts.interval, 10),
      startHour, startMinute, endHour, endMinute,
      weekdays: parseInt(cmdOpts.weekdays, 16) || parseInt(cmdOpts.weekdays, 10),
    };

    const client = await makeClient(opts);
    await client.run(async (c) => {
      await c.setAutoMonitoring(settings);
      const readBack = await c.getAutoMonitoring(type);
      console.log('Set successfully. Read back:', JSON.stringify(readBack, null, 2));
    });
    process.exit(0);
  });

// --- ecg (V8 only) ---
// Live raw-ADC stream; the band has no ECG history and no analysis library
// (see src/v8-protocol.js "ECG"). Everything printed is derived here from the
// raw samples, so treat the effective sample rate as a measurement of this
// run, not a spec -- the vendor documents no rate.
const { summarizeEcg, ecgSamplesToCsv } = require('../src/ecg-summary');

program
  .command('ppg')
  .description('V8 only: probe the raw PPG stream the SDK exposes as "blood sugar" (0x78 start, 0x3a data frames). Records every frame raw; decodes nothing beyond what BleSDK does.')
  .option('--capture <seconds>', 'how long to listen before sending stop + quit', '30')
  .option('--progress', 'also send the vendor demo\'s mode=4 percentage ticks', false)
  .option('--out <file>', 'write acks + every frame (raw hex, BE and LE decodes) as JSON')
  .option('--quiet', 'do not print a line per frame', false)
  .option('--path <which>', 'halo only: which raw path to probe -- stream (0x11), glucose (0x78/0x3a) or both, run one after the other', 'both')
  .action(async (cmdOpts) => {
    const opts = program.opts();
    const captureMs = Math.round(parseFloat(cmdOpts.capture) * 1000);
    const client = await makeClient(opts);
    let requestStop = null;
    process.once('SIGINT', () => { console.error('\nStopping early...'); if (requestStop) requestStop(); });
    if (opts.device !== 'v8') {
      const paths = cmdOpts.path === 'both' ? ['stream', 'glucose'] : [cmdOpts.path];
      const all = {};
      await client.run(async (c) => {
        for (const path of paths) {
          console.error(`\n== Halo PPG path "${path}" (${path === 'stream' ? '0x11' : '0x78 + 0x3a'}), listening for ${captureMs / 1000}s...`);
          const startedAt = Date.now();
          const r = await c.recordPpg({
            path, captureMs,
            onStopSignal: (fn) => { requestStop = fn; },
            onAck: (a) => console.error(`[${((a.receivedAt - startedAt) / 1000).toFixed(2)}s] opcode 0x${a.opcode.toString(16)} len=${a.length} raw=${a.raw}`),
            onPacket: cmdOpts.quiet ? null : (p) => {
              const t = ((p.receivedAt - startedAt) / 1000).toFixed(2);
              if (p.opcode === 0x3a) console.error(`[${t}s] 0x3a len=${p.length} hdr=${p.header.map((b) => b.toString(16).padStart(2, '0')).join(' ')} width=${p.width}${p.samples ? ` n=${p.samples.length} first=${p.samples[0]} last=${p.samples[p.samples.length - 1]}` : ''}`);
              else console.error(`[${t}s] 0x11 len=${p.length} hdr=${p.header.map((b) => b.toString(16).padStart(2, '0')).join(' ')} blocks=${p.blocks.length} first={head_le:${p.blocks[0]?.head_le} ppg_le:${p.blocks[0]?.ppg_le} ppg_be:${p.blocks[0]?.ppg_be}} raw=${p.raw.slice(0, 40)}…`);
            },
          });
          const n = r.frames.length, streamed = n > 1 ? (r.lastAt - r.firstAt) / 1000 : 0;
          const units = r.frames.reduce((a, f) => a + (f.samples ? f.samples.length : f.blocks ? f.blocks.length : 0), 0);
          console.log(`path=${path}  frames=${n}  units=${units}  streamed=${streamed.toFixed(1)}s  rate~${streamed > 0 ? (units / streamed).toFixed(1) : '-'}/s  acks=${r.acks.length}`);
          all[path] = r;
          requestStop = null;
        }
      });
      if (cmdOpts.out) { require('fs').writeFileSync(cmdOpts.out, JSON.stringify(all, null, 2)); console.error(`Wrote ${cmdOpts.out}`); }
      return;
    }
    console.error(`Starting PPG (0x78 mode=1), listening for ${captureMs / 1000}s...`);
    const startedAt = Date.now();
    const result = await client.run((c) => c.recordPpg({
      captureMs,
      progress: !!cmdOpts.progress,
      onStopSignal: (fn) => { requestStop = fn; },
      onAck: (a) => console.error(`[${((a.receivedAt - startedAt) / 1000).toFixed(2)}s] ${a.opcode != null ? `opcode 0x${a.opcode.toString(16)}` : `0x78 status=${a.status}`} raw=${a.raw}`),
      onPacket: cmdOpts.quiet ? null : (p) => {
        const t = ((p.receivedAt - startedAt) / 1000).toFixed(2);
        const s = p.samples;
        console.error(`[${t}s] 0x3a len=${p.length} hdr=${p.header.map((b) => b.toString(16).padStart(2, '0')).join(' ')} width=${p.width}${s ? `  n=${s.length} BE first=${s[0]} last=${s[s.length - 1]}  LE first=${p.samplesLE[0]}` : `  raw=${p.raw.slice(0, 64)}…`}`);
      },
    }));
    const n = result.packets.length;
    const streamed = n > 1 ? (result.lastPacketAt - result.firstPacketAt) / 1000 : 0;
    const widths = [...new Set(result.packets.map((p) => p.width))];
    const total = result.packets.reduce((a, p) => a + (p.samples ? p.samples.length : 0), 0);
    if (cmdOpts.out) {
      require('fs').writeFileSync(cmdOpts.out, JSON.stringify({ startedAt, acks: result.acks, packets: result.packets }, null, 2));
      console.error(`Wrote ${n} frames to ${cmdOpts.out}`);
    }
    console.log(`frames=${n}  widths=${widths.join('/') || '-'}  samples=${total}  streamed=${streamed.toFixed(1)}s  rate~${streamed > 0 ? (total / streamed).toFixed(1) : '-'}Hz  acks=${result.acks.length}`);
  });

program
  .command('ecg')
  .description('V8 only: run an on-demand ECG measurement and capture the raw sample stream (0x28 + 0x07). Ctrl-C stops early and still sends the stop command.')
  .option('--capture <seconds>', 'how long to listen for samples before stopping', '30')
  .option('--duration <seconds>', 'measurement length the band is asked for (0x28 duration, seconds from the start command). Defaults to --capture so the band ends the measurement itself when the capture ends -- the SDK stop pair does not stop anything')
  .option('--out <file>', 'write every sample to this file (.csv => index,packetId,value ; anything else => JSON)')
  .option('--quiet', 'do not print a line per packet', false)
  .action(async (cmdOpts) => {
    const opts = program.opts();
    if (opts.device !== 'v8') {
      console.error('ecg is only implemented for --device v8 (Halo has no ECG opcode).');
      process.exit(1);
    }
    const captureMs = Math.round(parseFloat(cmdOpts.capture) * 1000);
    const duration = cmdOpts.duration != null ? parseInt(cmdOpts.duration, 10) : Math.ceil(captureMs / 1000);
    const client = await makeClient(opts);

    let requestStop = null;
    process.once('SIGINT', () => {
      console.error('\nStopping early...');
      if (requestStop) requestStop();
    });

    console.error(`Starting ECG (0x28 duration=${duration}s), listening for ${captureMs / 1000}s... (finger on the electrode; a zero-packet result means lift it and re-place it)`);
    const startedAt = Date.now();
    const result = await client.run((c) => c.recordEcg({
      duration,
      captureMs,
      onStopSignal: (fn) => { requestStop = fn; },
      onAck: (ack) => console.error(`[ack] 0x28 type=${ack.type || ack.typeByte} raw=${ack.raw ? Buffer.from(ack.raw).toString('hex') : '-'}`),
      onPacket: cmdOpts.quiet ? null : (p) => {
        const t = ((p.receivedAt - startedAt) / 1000).toFixed(2);
        console.error(`[${t}s] packet ${p.packetId}  n=${p.samples.length}  first=${p.samples[0]}  last=${p.samples[p.samples.length - 1]}`);
      },
    }));

    const summary = summarizeEcg(result);

    if (cmdOpts.out) {
      const fs = require('fs');
      if (/\.csv$/i.test(cmdOpts.out)) {
        fs.writeFileSync(cmdOpts.out, ecgSamplesToCsv(result.packets));
      } else {
        fs.writeFileSync(cmdOpts.out, JSON.stringify({ summary, acks: result.acks, packets: result.packets }, null, 2));
      }
      console.error(`Wrote ${result.samples.length} samples to ${cmdOpts.out}`);
    }

    if (opts.json) {
      console.log(JSON.stringify({ summary, acks: result.acks, samples: result.samples }, null, 2));
    } else {
      if (summary.backlogPackets) {
        console.log(`backlog=${summary.backlogPackets} packets (${summary.backlogSamples} samples) flushed from the previous measurement -- excluded from the figures below`);
      }
      console.log(`packets=${summary.packetCount}  samples=${summary.sampleCount}  lostPackets=${summary.lostPackets}  streamed=${summary.streamSeconds}s  effectiveRate=${summary.effectiveSampleRateHz == null ? '-' : summary.effectiveSampleRateHz + 'Hz'}`);
      if (summary.sampleCount) {
        console.log(`samplesPerPacket=${summary.samplesPerPacket.join('/')}  min=${summary.min}  max=${summary.max}  mean=${summary.mean}`);
        const hr = summary.heartRate;
        console.log(hr
          ? `heartRate~${hr.bpmMedian}bpm (median RR ${hr.rrMedianMs}ms, sd ${hr.rrSdMs}ms, ${hr.beats} beats, ${hr.rejectedIntervals} rejected) -- derived here, not from the band`
          : 'heartRate: not enough clean beats to estimate (short capture, no electrode contact, or heavy motion)');
      } else {
        console.log('No ECG samples received. Is the band on the wrist with the electrode touched by the other hand? (The vendor UI requires a two-point contact for ECG.)');
      }
      if (result.acks.length) console.log(`acks=${result.acks.length} (see --json for raw bytes)`);
    }
    process.exit(0);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
