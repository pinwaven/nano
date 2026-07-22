#!/usr/bin/env node
'use strict';

const { Command } = require('commander');
const { AizoRingClient } = require('../src/client');
const printReport = require('../src/report');

const program = new Command();

program
  .name('aizoring')
  .description('CLI tool for the Aizo/Infinity smart ring over BLE. Run with no arguments to fetch and print all stored data.')
  .option('--address <address>', 'bluetooth address/UUID of the device (skips scanning)')
  .option('--comp-id <id>', 'company id used for the bind/auth handshake', 'waven')
  .option('--scan-timeout <ms>', 'scan duration in milliseconds', '8000')
  .option('--debug', 'enable debug logging (raw frame hex)', false)
  .option('--json', 'print raw JSON instead of a formatted report', false);

function deviceId(peripheral) {
  return peripheral.address && peripheral.address !== 'unknown' ? peripheral.address : peripheral.uuid;
}

async function resolveAddress(opts) {
  if (opts.address) return opts.address;
  console.error('Scanning for Infinity ring...');
  const found = await AizoRingClient.scan(parseInt(opts.scanTimeout, 10));
  if (!found.length) {
    console.error('No ring found. Make sure it is powered on, nearby, and not already bonded to this Mac');
    console.error('(System Settings → Bluetooth → "Forget This Device" if it shows as Connected), or pass --address.');
    process.exit(1);
  }
  if (found.length > 1) {
    console.error(`Found ${found.length} devices, using the first. Pass --address to pick a specific one:`);
    for (const p of found) console.error(`  ${deviceId(p)}  ${(p.advertisement && p.advertisement.localName) || '(unnamed)'}  rssi=${p.rssi}`);
  }
  return deviceId(found[0]);
}

async function makeClient(opts) {
  const address = await resolveAddress(opts);
  console.error(`Connecting to ${address}...`);
  return new AizoRingClient(address, { debug: opts.debug, compId: opts.compId });
}

const dayMs = 86400000;

// --- default: fetch everything ---
program
  .command('fetch-all', { isDefault: true })
  .description('Connect, bind, and dump every stored data type (default when run with no arguments)')
  .option('--days <n>', 'how many days back of health/sleep history to include', '2')
  .action(async (cmdOpts) => {
    const opts = program.opts();
    const client = await makeClient(opts);
    const days = parseInt(cmdOpts.days, 10);

    const data = {};
    await client.run(async (c) => {
      const tasks = [
        ['battery', () => c.getBattery()],
        ['steps', () => c.getSteps()],
        ['measureInterval', () => c.getMeasureInterval()],
        ['stressInterval', () => c.getStressInterval()],
        ['sportStatus', () => c.getSportStatus()],
        ['sportRecords', () => c.syncSportRecords({ windowMs: 4000 })],
        ['sleepSummary', () => c.getSleepSummary()],
        ['sleepDetail', () => c.getSleepDetail()],
      ];
      for (let i = 0; i <= days; i++) {
        const label = i === 0 ? 'healthHistory' : `healthHistory_${i}dago`;
        const d = Date.now() - i * dayMs;
        tasks.push([label, () => c.getHealthHistory(d)]);
      }

      const merged = { healthHistory: [] };
      for (const [key, fn] of tasks) {
        console.error(`Fetching ${key}...`);
        try {
          const result = await fn();
          if (key.startsWith('healthHistory')) merged.healthHistory.push(...result);
          else merged[key] = result;
        } catch (err) {
          merged[key] = { error: err.message };
        }
      }
      Object.assign(data, merged);
    });

    if (opts.json) console.log(JSON.stringify(data, null, 2));
    else printReport(data);
    process.exit(0);
  });

// --- scan ---
program
  .command('scan')
  .description('Scan for nearby Infinity/Aizo rings')
  .action(async () => {
    const opts = program.opts();
    const timeout = parseInt(opts.scanTimeout, 10);
    console.error(`Scanning for ${timeout}ms...`);
    const found = await AizoRingClient.scan(timeout);
    if (!found.length) console.log('No devices found.');
    else for (const p of found) console.log(`${deviceId(p)}  ${(p.advertisement && p.advertisement.localName) || '(unnamed)'}  rssi=${p.rssi}`);
    process.exit(0);
  });

// --- measure ---
program
  .command('measure <type>')
  .description('Trigger an on-demand measurement: hr, spo2, temp (stress does not spot-measure — use monitor instead)')
  .action(async (type) => {
    const opts = program.opts();
    const TYPES = { hr: 1, heartrate: 1, spo2: 2, stress: 3, temp: 6, temperature: 6 };
    const t = TYPES[type.toLowerCase()];
    if (!t) { console.error(`Unknown type "${type}". Expected one of: ${Object.keys(TYPES).join(', ')}`); process.exit(1); }
    const client = await makeClient(opts);
    const result = await client.run((c) => c.measure(t));
    if (opts.json) console.log(JSON.stringify(result, null, 2));
    else console.log(result.valid ? `${type} = ${result.value ?? result.bodyTemp}` : `${type}: no valid reading`);
    process.exit(0);
  });

// --- monitor (read/set auto-monitoring intervals) ---
program
  .command('monitor')
  .description('Read (and optionally set) the HR/stress auto-monitoring intervals')
  .option('--hr <minutes>', 'set HR interval in minutes (0=off; must be one of the allowed values reported back)')
  .option('--stress <minutes>', 'set stress interval in minutes')
  .action(async (cmdOpts) => {
    const opts = program.opts();
    const client = await makeClient(opts);
    const result = await client.run(async (c) => {
      if (cmdOpts.hr != null) await c.setMeasureInterval(parseInt(cmdOpts.hr, 10));
      if (cmdOpts.stress != null) await c.setStressInterval(parseInt(cmdOpts.stress, 10));
      const hr = await c.getMeasureInterval();
      const stress = await c.getStressInterval();
      return { hr, stress };
    });
    if (opts.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`HR:     current=${result.hr.currentMinutes}min default=${result.hr.defaultMinutes}min allowed=[${result.hr.allowedMinutes.join(',')}]`);
      console.log(`Stress: current=${result.stress.currentMinutes}min default=${result.stress.defaultMinutes}min`);
    }
    process.exit(0);
  });

// --- health (history probe) ---
program
  .command('health')
  .description('Read stored health history (HR/SpO2/HRV/stress/temperature) for the last N days')
  .option('--days <n>', 'days back to fetch', '2')
  .action(async (cmdOpts) => {
    const opts = program.opts();
    const client = await makeClient(opts);
    const days = parseInt(cmdOpts.days, 10);
    const records = await client.run(async (c) => {
      const out = [];
      for (let i = 0; i <= days; i++) out.push(...await c.getHealthHistory(Date.now() - i * dayMs));
      return out;
    });
    if (opts.json) console.log(JSON.stringify(records, null, 2));
    else if (!records.length) console.log('No health history stored.');
    else for (const x of records.sort((a, b) => a.timestamp - b.timestamp)) {
      const t = new Date(x.timestamp);
      console.log(`${t.toISOString().slice(0, 16).replace('T', ' ')}  HR=${x.hr}bpm HRV=${x.hrv} SpO2=${x.spo2}% stress=${x.stress} temp=${x.bodyTemp != null ? x.bodyTemp + '°C' : '-'} steps=${x.step}`);
    }
    process.exit(0);
  });

// --- sleep ---
program
  .command('sleep')
  .description("Read last night's sleep summary and per-stage detail")
  .action(async () => {
    const opts = program.opts();
    const client = await makeClient(opts);
    const result = await client.run(async (c) => ({
      summary: await c.getSleepSummary(),
      detail: await c.getSleepDetail(),
    }));
    if (opts.json) console.log(JSON.stringify(result, null, 2));
    else if (!result.summary) console.log('No sleep recorded.');
    else {
      const f = (ms) => new Date(ms).toISOString().slice(11, 16);
      const d = result.summary;
      console.log(`${Math.floor(d.totalMin / 60)}h${String(d.totalMin % 60).padStart(2, '0')} total  ${f(d.start)} → ${f(d.end)}`);
      console.log(`deep=${d.deepMin}m light=${d.lightMin}m REM=${d.remMin}m awake=${d.awakeMin}m×${d.awakeTimes}`);
      for (const x of result.detail) console.log(`  ${f(x.timestamp)}  ${x.mode.padEnd(7)} HR=${x.hr}`);
    }
    process.exit(0);
  });

// --- sport ---
program
  .command('sport')
  .description('Check for an active workout and sync any stored/finished sport records')
  .action(async () => {
    const opts = program.opts();
    const client = await makeClient(opts);
    const result = await client.run(async (c) => ({
      status: await c.getSportStatus(),
      records: await c.syncSportRecords(),
    }));
    if (opts.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(result.status.active ? `Active session: type=${result.status.sportType} id=${result.status.sportId}` : 'No active session.');
      if (!result.records.length) console.log('No stored sessions synced.');
      else for (const r of result.records) console.log(`  [${r.kind}]`, JSON.stringify(r.data));
    }
    process.exit(0);
  });

// --- raw exploration ---
program
  .command('raw <payloadHex>')
  .description('Send a raw hex payload (e.g. "3838" for watch-info) and print whatever comes back, for protocol exploration')
  .option('--window <ms>', 'how long to collect responses for', '5000')
  .action(async (payloadHex, cmdOpts) => {
    const opts = program.opts();
    const client = await makeClient(opts);
    const frames = await client.run((c) => c.sendRaw(payloadHex, { windowMs: parseInt(cmdOpts.window, 10) }));
    console.log(JSON.stringify(frames, null, 2));
    process.exit(0);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
