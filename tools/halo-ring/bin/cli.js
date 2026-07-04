#!/usr/bin/env node
'use strict';

const { Command } = require('commander');
const { HaloRingClient } = require('../src/halo-ring');
const printReport = require('../src/print-report');

const program = new Command();

program
  .name('halo_ring')
  .description('CLI tool for the Halo smart ring over BLE. Run with no arguments to fetch and print all stored data.')
  .option('--address <address>', 'bluetooth address/UUID of the ring (skips scanning)')
  .option('--name <prefix>', 'name prefix to scan for (default: X3, X6, X9, V4 — the hardware\'s BLE-advertised name)')
  .option('--scan-timeout <ms>', 'scan duration in milliseconds', '8000')
  .option('--debug', 'enable debug logging', false)
  .option('--json', 'print raw JSON instead of a formatted report', false);

function deviceId(peripheral) {
  return peripheral.address && peripheral.address !== 'unknown' ? peripheral.address : peripheral.uuid;
}

async function resolveAddress(opts) {
  if (opts.address) return opts.address;

  const prefixes = opts.name ? [opts.name] : undefined;
  console.error('Scanning for Halo ring...');
  const found = await HaloRingClient.scan(parseInt(opts.scanTimeout, 10));
  const matches = prefixes
    ? found.filter((p) => prefixes.some((pre) =>
        ((p.advertisement && p.advertisement.localName) || '').toLowerCase().startsWith(pre.toLowerCase())))
    : found;

  if (!matches.length) {
    console.error('No Halo ring found. Make sure it is powered on and nearby, or pass --address.');
    process.exit(1);
  }
  if (matches.length > 1) {
    console.error(`Found ${matches.length} rings, using the first. Pass --address to pick a specific one:`);
    for (const p of matches) {
      console.error(`  ${deviceId(p)}  ${(p.advertisement && p.advertisement.localName) || '(unnamed)'}  rssi=${p.rssi}`);
    }
  }
  return deviceId(matches[0]);
}

async function makeClient(opts) {
  const address = await resolveAddress(opts);
  console.error(`Connecting to ${address}...`);
  return new HaloRingClient(address, { debug: opts.debug });
}

// --- default: fetch everything ---
program
  .command('fetch-all', { isDefault: true })
  .description('Connect to the ring and dump every stored data type (default when run with no arguments)')
  .action(async () => {
    const opts = program.opts();
    const client = await makeClient(opts);

    const data = {};
    await client.run(async (c) => {
      const tasks = [
        ['battery', () => c.getBattery()],
        ['deviceTime', () => c.getDeviceTime()],
        ['mac', () => c.getMac()],
        ['firmwareVersion', () => c.getFirmwareVersion()],
        ['autoMonitoring', () => c.getAutoMonitoringAll()],
        ['steps', () => c.getSteps()],
        ['sleepHistory', () => c.getSleepHistory()],
        ['heartRateLog', () => c.getHeartRateLog()],
        ['heartRateHistory', () => c.getHeartRateHistory()],
        ['hrvHistory', () => c.getHrvHistory()],
        ['autoSpo2History', () => c.getAutoSpo2History()],
        ['spo2History', () => c.getSpo2History()],
        ['sleepHrv', () => c.getSleepHrv()],
        ['temperatureHistory', () => c.getTemperatureHistory()],
        ['sleepTemperatureLog', () => c.getSleepTemperatureLog()],
        ['exerciseSessions', () => c.getExerciseSessions()],
        ['sleepApneaRisk', () => c.getSleepApneaRisk()],
        ['oxygenVariation', () => c.getOxygenVariation()],
      ];

      for (const [key, fn] of tasks) {
        console.error(`Fetching ${key}...`);
        try {
          data[key] = await fn();
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
  .description('Scan for nearby Halo rings')
  .action(async () => {
    const opts = program.opts();
    const timeout = parseInt(opts.scanTimeout, 10);
    console.error(`Scanning for ${timeout}ms...`);
    const found = await HaloRingClient.scan(timeout);
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

program.parseAsync(process.argv).catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
