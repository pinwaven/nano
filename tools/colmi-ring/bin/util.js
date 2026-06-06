#!/usr/bin/env node
'use strict';

const { Command } = require('commander');
const { scanDevices } = require('../src/client');

const DEVICE_NAME_PREFIXES = [
  'R01', 'R02', 'R03', 'R04', 'R05', 'R06', 'R07', 'R09', 'R10',
  'COLMI', 'VK-5098', 'MERLIN', 'Hello Ring', 'RING1', 'boAtring',
  'TR-R02', 'SE', 'EVOLVEO', 'GL-SR2', 'Blaupunkt', 'KSIX RING',
];

const program = new Command();

program
  .name('colmi_r02_util')
  .description('Colmi R02 utilities (no address required)');

program
  .command('scan')
  .description('Scan for nearby Colmi rings and print their addresses')
  .option('--all', 'show all BLE devices, not just known ring names', false)
  .action(async (opts) => {
    const devices = await scanDevices(5000);
    if (devices.length === 0) {
      console.log('No devices found. Try moving the ring closer to your computer.');
      process.exit(0);
    }

    console.log('Found device(s)');
    console.log(`${'Name'.padStart(20)}  | Address`);
    console.log('-'.repeat(44));

    for (const d of devices) {
      const name = (d.advertisement && d.advertisement.localName) || 'N/A';
      const address = d.uuid;
      const isRing = DEVICE_NAME_PREFIXES.some((p) => name.startsWith(p));
      if (opts.all || isRing) {
        console.log(`${name.padStart(20)}  |  ${address}`);
      }
    }
    process.exit(0);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
