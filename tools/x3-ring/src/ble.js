'use strict';

// Node/noble BLE transport for the X3 ring. Mirrors the interface of the
// miniapp's wx.*-based ble-manager.js so the X3 protocol logic can stay identical.

const noble = require('@abandonware/noble');

// Expands short-form UUIDs (16-bit "fff0" or 32-bit) to the full 128-bit
// Bluetooth base form, matching protocol.js's full-length UUID constants.
// noble reports service/characteristic UUIDs in short form when available.
function normalizeUUID(uuid) {
  let clean = uuid.replace(/-/g, '').toLowerCase();
  if (clean.length === 4) {
    clean = '0000' + clean + '00001000800000805f9b34fb';
  } else if (clean.length === 8) {
    clean = clean + '00001000800000805f9b34fb';
  }
  return clean;
}

function waitForNobleReady() {
  if (noble.state === 'poweredOn') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onState = (state) => {
      if (state === 'poweredOn') {
        noble.removeListener('stateChange', onState);
        resolve();
      } else if (state === 'poweredOff' || state === 'unauthorized') {
        noble.removeListener('stateChange', onState);
        reject(new Error(`Bluetooth unavailable: ${state}`));
      }
    };
    noble.on('stateChange', onState);
  });
}

async function scanDevices(timeoutMs = 8000, namePrefixes = null) {
  await waitForNobleReady();
  return new Promise((resolve) => {
    const found = new Map();
    const onDiscover = (peripheral) => {
      const name = (peripheral.advertisement && peripheral.advertisement.localName) || '';
      if (namePrefixes && !namePrefixes.some((p) => name.toLowerCase().startsWith(p.toLowerCase()))) return;
      found.set(peripheral.uuid, peripheral);
    };
    noble.on('discover', onDiscover);
    noble.startScanning([], false);
    setTimeout(() => {
      noble.stopScanning();
      noble.removeListener('discover', onDiscover);
      resolve(Array.from(found.values()));
    }, timeoutMs);
  });
}

class BLETransport {
  constructor(address, { debug = false } = {}) {
    this.address = address;
    this.debug = debug;
    this._peripheral = null;
    this._writeChar = null;
    this._notifyHandler = null;
  }

  _log(...args) {
    if (this.debug) console.error('[debug]', ...args);
  }

  async connect(serviceUUID, writeUUID, notifyUUID) {
    const peripheral = await this._findPeripheral();
    this._peripheral = peripheral;

    await new Promise((resolve, reject) => {
      peripheral.connect((err) => (err ? reject(err) : resolve()));
    });
    this._log('Connected, discovering services...');

    const services = await new Promise((resolve, reject) => {
      peripheral.discoverServices([serviceUUID], (err, svcs) => (err ? reject(err) : resolve(svcs)));
    });
    const svc = services.find((s) => normalizeUUID(s.uuid) === normalizeUUID(serviceUUID));
    if (!svc) throw new Error(`X3 service ${serviceUUID} not found`);

    const chars = await new Promise((resolve, reject) => {
      svc.discoverCharacteristics([], (err, cs) => (err ? reject(err) : resolve(cs)));
    });

    this._writeChar = chars.find((c) => normalizeUUID(c.uuid) === normalizeUUID(writeUUID));
    const notifyChar = chars.find((c) => normalizeUUID(c.uuid) === normalizeUUID(notifyUUID));
    if (!this._writeChar || !notifyChar) throw new Error('X3 write/notify characteristics not found');

    await new Promise((resolve, reject) => {
      notifyChar.subscribe((err) => (err ? reject(err) : resolve()));
    });
    notifyChar.on('data', (data) => {
      if (this._notifyHandler) this._notifyHandler(new Uint8Array(data));
    });
  }

  async _findPeripheral() {
    await waitForNobleReady();
    const target = normalizeUUID(this.address);

    if (noble._peripherals[target]) {
      return noble._peripherals[target];
    }

    // Pre-create the Peripheral so noble.onConnect can find it after connect(),
    // mirroring what CoreBluetooth's retrievePeripheralsWithIdentifiers allows —
    // the device doesn't need to be actively advertising at connect time.
    const Peripheral = require('@abandonware/noble/lib/peripheral');
    const peripheral = new Peripheral(noble, target, 'unknown', 'unknown', true, {}, 0, false);
    noble._peripherals[target] = peripheral;
    noble._services[target] = {};
    noble._characteristics[target] = {};
    noble._descriptors[target] = {};

    await new Promise((resolve) => {
      const stop = setTimeout(() => { noble.stopScanning(); resolve(); }, 3000);
      noble.on('discover', function onDiscover(p) {
        if (p.uuid === target) {
          clearTimeout(stop);
          noble.stopScanning();
          noble.removeListener('discover', onDiscover);
          resolve();
        }
      });
      noble.startScanning([], false);
    });

    return noble._peripherals[target];
  }

  onNotify(fn) {
    this._notifyHandler = fn;
  }

  write(packet) {
    return new Promise((resolve, reject) => {
      const buf = Buffer.from(packet);
      const withoutResponse = this._writeChar.properties.includes('writeWithoutResponse');
      this._writeChar.write(buf, withoutResponse, (err) => (err ? reject(err) : resolve()));
    });
  }

  async disconnect() {
    if (this._peripheral) {
      await new Promise((resolve) => this._peripheral.disconnect(resolve));
    }
  }
}

module.exports = { BLETransport, scanDevices, waitForNobleReady };
