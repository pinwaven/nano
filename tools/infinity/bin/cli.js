#!/usr/bin/env node
'use strict';

const { InfinityClient, protocol } = require('../src/client');
const printReport = require('../src/report');

const COMMANDS = new Set(['fetch-all', 'scan', 'battery', 'watch-info', 'steps', 'sleep', 'stress', 'heart-rate', 'spo2', 'raw', 'help']);

function main(argv) {
  const parsed = parseArgs(argv);
  if (parsed.command === 'help' || parsed.options.help) {
    printHelp();
    return Promise.resolve();
  }

  if (parsed.command === 'scan') return scan(parsed.options);

  return withClient(parsed.options, async (client) => {
    switch (parsed.command) {
      case 'fetch-all': return fetchAll(client, parsed.options);
      case 'battery': return output(await client.getBattery(), parsed.options);
      case 'watch-info': return output(await client.getWatchInfo(numberOpt(parsed.options.infoType, 2)), parsed.options);
      case 'steps': return output(await client.getSteps(), parsed.options);
      case 'sleep': return output(await client.getSleep(), parsed.options);
      case 'stress': return output(await client.getStress(), parsed.options);
      case 'heart-rate': return output(await client.getHeartRate(), parsed.options);
      case 'spo2': return output(await client.getSpO2(), parsed.options);
      case 'raw': return raw(client, parsed.options);
      default:
        printHelp();
        process.exitCode = 1;
        return null;
    }
  });
}

async function scan(opts) {
  const timeout = numberOpt(opts.scanTimeout, 8000);
  const prefixes = opts.name ? [opts.name] : protocol.INFINITY_NAME_PREFIXES;
  console.error(`Scanning for Infinity rings for ${timeout}ms...`);
  const found = await InfinityClient.scan(timeout, prefixes);
  if (!found.length) {
    console.log('No devices found.');
    return;
  }
  for (const p of found) {
    console.log(`${deviceId(p)}  ${(p.advertisement && p.advertisement.localName) || '(unnamed)'}  rssi=${p.rssi}`);
  }
}

async function withClient(opts, fn) {
  const address = await resolveAddress(opts);
  console.error(`Connecting to ${address}...`);
  const client = new InfinityClient(address, {
    debug: Boolean(opts.debug),
    compId: opts.compId || 'waven',
    skipBind: Boolean(opts.noBind),
  });
  return client.run(fn);
}

async function resolveAddress(opts) {
  if (opts.address) return opts.address;
  const timeout = numberOpt(opts.scanTimeout, 8000);
  const prefixes = opts.name ? [opts.name] : protocol.INFINITY_NAME_PREFIXES;
  console.error('Scanning for Infinity ring...');
  const found = await InfinityClient.scan(timeout, prefixes);
  if (!found.length) {
    throw new Error('No Infinity ring found. Make sure it is nearby/advertising, or pass --address.');
  }
  if (found.length > 1) {
    console.error(`Found ${found.length} devices, using the first. Pass --address to choose one:`);
    for (const p of found) {
      console.error(`  ${deviceId(p)}  ${(p.advertisement && p.advertisement.localName) || '(unnamed)'}  rssi=${p.rssi}`);
    }
  }
  return deviceId(found[0]);
}

async function fetchAll(client, opts) {
  const tasks = [
    ['battery', (c) => c.getBattery()],
    ['watchInfo', (c) => c.getWatchInfo(numberOpt(opts.infoType, 2))],
    ['steps', (c) => c.getSteps()],
    ['sleep', (c) => c.getSleep()],
    ['stress', (c) => c.getStress()],
    ['heartRate', (c) => c.getHeartRate()],
    ['spo2', (c) => c.getSpO2()],
  ];

  const data = {};
  for (const [key, task] of tasks) {
    console.error(`Fetching ${key}...`);
    try {
      data[key] = await task(client);
    } catch (err) {
      data[key] = { error: err.message };
    }
  }

  if (opts.json) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    printReport(data);
  }
}

async function raw(client, opts) {
  if (opts.cmd == null) throw new Error('raw requires --cmd <hex>');
  const cmdId = parseNumber(opts.cmd);
  const result = await client.sendRawFrame(cmdId, opts.payload || '', {
    expect: opts.expect == null ? undefined : parseNumber(opts.expect),
    arg3: numberOpt(opts.arg3, 0),
    arg4: numberOpt(opts.arg4, 0),
    seq: numberOpt(opts.seq, 0),
    stream: Boolean(opts.stream),
    timeoutMs: numberOpt(opts.timeout, 7000),
    silenceMs: numberOpt(opts.silence, 1800),
  });
  output(result, { json: true });
}

function output(value, opts) {
  if (opts.json) {
    console.log(JSON.stringify(value, null, 2));
  } else {
    console.log(JSON.stringify(value, null, 2));
  }
}

function parseArgs(argv) {
  const options = {};
  let command = 'fetch-all';
  const args = [...argv];
  if (args[0] && COMMANDS.has(args[0])) {
    command = args.shift();
  }

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const eq = arg.indexOf('=');
    const key = camel(eq >= 0 ? arg.slice(2, eq) : arg.slice(2));
    if (['debug', 'json', 'noBind', 'stream', 'help'].includes(key)) {
      options[key] = true;
      if (eq >= 0) options[key] = arg.slice(eq + 1) !== 'false';
      continue;
    }
    const value = eq >= 0 ? arg.slice(eq + 1) : args[i + 1];
    if (value == null || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    options[key] = value;
    if (eq < 0) i += 1;
  }

  return { command, options };
}

function camel(key) {
  return key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function numberOpt(value, fallback) {
  if (value == null) return fallback;
  return parseNumber(value);
}

function parseNumber(value) {
  if (typeof value === 'number') return value;
  const text = String(value);
  return text.toLowerCase().startsWith('0x') ? parseInt(text, 16) : parseInt(text, 10);
}

function deviceId(peripheral) {
  return peripheral.address && peripheral.address !== 'unknown' ? peripheral.address : peripheral.uuid;
}

function printHelp() {
  console.log(`Infinity ring BLE CLI

Usage:
  node bin/cli.js [command] [options]

Commands:
  fetch-all       Fetch battery, watch info, steps, sleep, stress, heart rate, and SpO2 (default)
  scan            Scan for nearby Infinity rings
  battery         Read battery/status
  watch-info      Read raw watch-info payload
  steps           Read step summary
  sleep           Read sleep frames and aggregate stages
  stress          Read pressure/stress data
  heart-rate      Read heart-rate data with best-effort parser
  spo2            Read SpO2 data with best-effort parser
  raw             Send a custom framed command

Options:
  --address <id>          BLE address/UUID. If omitted, the CLI scans first.
  --name <prefix>         BLE name prefix to scan for. Default: infinity
  --scan-timeout <ms>     Scan duration. Default: 8000
  --comp-id <id>          Bind handshake company/client id. Default: waven
  --no-bind               Skip the initial bind/auth handshake
  --info-type <n>         Watch-info type for fetch-all/watch-info. Default: 2
  --json                  Print JSON
  --debug                 Print BLE debug logs

Raw command options:
  --cmd <hex|int>         Command id for the Infinity frame
  --payload <hex>         Payload bytes, without frame header/CRC
  --expect <hex|int>      Expected response command id. Defaults to --cmd
  --stream                Collect multiple frames until silence/timeout
  --timeout <ms>          Response timeout
  --silence <ms>          Stream silence window
  --arg3 <n> --arg4 <n> --seq <n>
`);
}

main(process.argv.slice(2)).catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
