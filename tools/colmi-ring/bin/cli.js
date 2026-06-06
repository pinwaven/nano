#!/usr/bin/env node
'use strict';

const { Command, Option } = require('commander');
const { Client, scanDevices } = require('../src/client');
const { REAL_TIME_MAPPING } = require('../src/realTime');
const hr = require('../src/hr');
const sleep = require('../src/sleep');
const steps = require('../src/steps');
const prettyPrint = require('../src/prettyPrint');
const db = require('../src/db');
const dateUtils = require('../src/dateUtils');

const program = new Command();

program
  .name('colmi_r02_client')
  .description('Colmi R02 smart ring client')
  .option('--debug', 'enable debug logging', false)
  .option('--record', 'write received packets to captures/ directory', false)
  .option('--address <address>', 'bluetooth address of the ring (preferred)')
  .option('--name <name>', 'bluetooth name of the device (slower, scans first)');

async function makeClient(opts) {
  let { address, name, debug } = opts;
  if (!address && !name) {
    console.error('Error: provide --address or --name');
    process.exit(1);
  }
  if (address && name) {
    console.error('Error: provide --address or --name, not both');
    process.exit(1);
  }
  if (name) {
    console.error(`Scanning for device named "${name}"...`);
    const devices = await scanDevices(8000);
    const found = devices.find(
      (d) => d.advertisement && d.advertisement.localName === name
    );
    if (!found) {
      console.error(`No device found with name "${name}"`);
      process.exit(1);
    }
    address = found.uuid;
  }
  return new Client(address, { debug });
}

// --- info ---
program
  .command('info')
  .description('Get device info and battery level')
  .action(async () => {
    const client = await makeClient(program.opts());
    await client.run(async (c) => {
      console.log('device info:', await c.getDeviceInfo());
      console.log('battery:', await c.getBattery());
    });
    process.exit(0);
  });

// --- get-heart-rate-log ---
program
  .command('get-heart-rate-log')
  .description('Get heart rate log for a given date')
  .requiredOption('--target <date>', 'date to fetch logs for (YYYY-MM-DD)')
  .action(async (opts) => {
    const target = new Date(opts.target);
    if (isNaN(target)) { console.error('Invalid date'); process.exit(1); }
    const client = await makeClient(program.opts());
    await client.run(async (c) => {
      const log = await c.getHeartRateLog(target);
      console.log('Data:', log);
      if (log instanceof hr.HeartRateLog) {
        for (const [reading, ts] of log.heartRatesWithTimes()) {
          if (reading !== 0) {
            const hh = String(ts.getUTCHours()).padStart(2, '0');
            const mm = String(ts.getUTCMinutes()).padStart(2, '0');
            console.log(`${hh}:${mm}, ${reading}`);
          }
        }
      }
    });
    process.exit(0);
  });

// --- set-time ---
program
  .command('set-time')
  .description('Set the ring\'s clock (required for accurate data logging)')
  .option('--when <datetime>', 'datetime to set (ISO format, defaults to now)')
  .action(async (opts) => {
    const when = opts.when ? new Date(opts.when) : dateUtils.now();
    const client = await makeClient(program.opts());
    await client.run(async (c) => {
      await c.setTime(when);
    });
    console.log('Time set successfully');
    console.log('Please ignore any unexpected packet warning.');
    process.exit(0);
  });

// --- get-heart-rate-log-settings ---
program
  .command('get-heart-rate-log-settings')
  .description('Get heart rate log settings')
  .action(async () => {
    const client = await makeClient(program.opts());
    await client.run(async (c) => {
      const s = await c.getHeartRateLogSettings();
      console.log('heart rate log settings:', s);
    });
    process.exit(0);
  });

// --- set-heart-rate-log-settings ---
program
  .command('set-heart-rate-log-settings')
  .description('Configure heart rate logging')
  .addOption(new Option('--enable', 'enable logging').default(true).conflicts('disable'))
  .option('--disable', 'disable logging')
  .option('--interval <minutes>', 'measurement interval in minutes (1-255)', '60')
  .action(async (opts) => {
    const enabled = !opts.disable;
    const interval = parseInt(opts.interval, 10);
    const client = await makeClient(program.opts());
    await client.run(async (c) => {
      console.log('Changing heart rate log settings');
      await c.setHeartRateLogSettings(enabled, interval);
      console.log(await c.getHeartRateLogSettings());
      console.log('Done');
    });
    process.exit(0);
  });

// --- get-real-time ---
const validReadings = Object.keys(REAL_TIME_MAPPING);
program
  .command('get-real-time <reading>')
  .description(`Get a real-time measurement. reading: ${validReadings.join(', ')}`)
  .action(async (reading) => {
    if (!validReadings.includes(reading)) {
      console.error(`Invalid reading "${reading}". Choose from: ${validReadings.join(', ')}`);
      process.exit(1);
    }
    const client = await makeClient(program.opts());
    await client.run(async (c) => {
      console.log('Starting reading, please wait.');
      const readingType = REAL_TIME_MAPPING[reading];
      const result = await c.getRealtimeReading(readingType);
      if (result) {
        console.log(result);
      } else {
        console.log(`Error, no ${reading.replace(/-/g, ' ')} detected. Is the ring being worn?`);
      }
    });
    process.exit(0);
  });

// --- get-steps ---
program
  .command('get-steps')
  .description('Get step data for a given day')
  .option('--when <date>', 'date to fetch steps for (YYYY-MM-DD, defaults to today)')
  .option('--as-csv', 'output as CSV', false)
  .action(async (opts) => {
    const when = opts.when ? new Date(opts.when) : dateUtils.now();
    const client = await makeClient(program.opts());
    await client.run(async (c) => {
      const result = await c.getSteps(when);
      if (result instanceof steps.NoData) {
        console.log('No results for day');
        return;
      }
      if (!opts.asCsv) {
        console.log(prettyPrint.printDataclasses(result));
      } else {
        const fields = ['year', 'month', 'day', 'timeIndex', 'calories', 'steps', 'distance'];
        console.log(fields.join(','));
        for (const r of result) {
          const obj = r.toObject();
          console.log(fields.map((f) => obj[f]).join(','));
        }
      }
    });
    process.exit(0);
  });

// --- reboot ---
program
  .command('reboot')
  .description('Reboot the ring')
  .action(async () => {
    const client = await makeClient(program.opts());
    await client.run(async (c) => {
      await c.reboot();
      console.log('Ring rebooted');
    });
    process.exit(0);
  });

// --- get-sleep ---
program
  .command('get-sleep')
  .description('Get sleep data (requires ring was worn overnight)')
  .action(async () => {
    const client = await makeClient(program.opts());
    await client.run(async (c) => {
      const result = await c.getSleep();
      if (result instanceof sleep.NoData) {
        console.log('No sleep data available. Wear the ring overnight to record sleep.');
        return;
      }
      for (const day of result) {
        console.log(`\n--- ${day.daysAgo === 0 ? 'Last night' : `${day.daysAgo} night(s) ago`} ---`);
        console.log(`  Sleep:  ${day.formatTime(day.sleepStart)} – ${day.formatTime(day.sleepEnd)}`);
        console.log(`  Total:  ${day.totalMinutes} min`);
        console.log(`  Deep:   ${day.deepMinutes} min`);
        console.log(`  Light:  ${day.lightMinutes} min`);
        console.log(`  REM:    ${day.remMinutes} min`);
        console.log(`  Awake:  ${day.awakeMinutes} min`);
        console.log('  Stages:');
        for (const p of day.periods) {
          console.log(`    ${p.typeName.padEnd(6)} ${p.minutes} min`);
        }
      }
    });
    process.exit(0);
  });

// --- raw ---
program
  .command('raw')
  .description('Send a raw command to the ring')
  .requiredOption('--command <int>', 'command byte (0-255)', parseInt)
  .option('--subdata <hex>', 'hex-encoded subdata bytes')
  .option('--replies <int>', 'number of reply packets to wait for', '0')
  .action(async (opts) => {
    const subdata = opts.subdata ? Buffer.from(opts.subdata, 'hex') : Buffer.alloc(0);
    const replies = parseInt(opts.replies, 10);
    const client = await makeClient(program.opts());
    await client.run(async (c) => {
      const results = await c.raw(opts.command, subdata, replies);
      console.log(results);
    });
    process.exit(0);
  });

// --- sync ---
program
  .command('sync')
  .description('Sync all data from the ring to SQLite')
  .option('--db <path>', 'path to SQLite database file (defaults to ./ring_data.sqlite)')
  .option('--start <date>', 'start date (YYYY-MM-DD)')
  .option('--end <date>', 'end date (YYYY-MM-DD)')
  .action(async (opts) => {
    const dbPath = opts.db || 'ring_data.sqlite';
    const database = db.getDb(dbPath);
    console.log(`Writing to ${dbPath}`);

    const globalOpts = program.opts();
    let start = opts.start
      ? new Date(opts.start)
      : null;
    let end = opts.end
      ? new Date(opts.end)
      : dateUtils.now();

    const client = await makeClient(globalOpts);

    if (!start) {
      start = db.getLastSync(database, client.address);
    }
    if (!start) {
      start = new Date(dateUtils.now().getTime() - 7 * 24 * 60 * 60 * 1000);
    }

    console.log(`Syncing from ${start.toISOString()} to ${end.toISOString()}`);

    await client.run(async (c) => {
      const fullData = await c.getFullData(start, end);
      db.fullSync(database, fullData);
      console.log('Ignore any unexpected packet warning');
      await c.setTime(dateUtils.now());
    });

    database.close();
    console.log('Done');
    process.exit(0);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
