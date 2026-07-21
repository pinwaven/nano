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

    // V8's task list only covers what v8-protocol.js implements so far
    // (see tools/halo/README.md) -- ECG, blood glucose, alarms, PPI, and OTA
    // are follow-ups once this core path is confirmed against real hardware.
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

program.parseAsync(process.argv).catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
