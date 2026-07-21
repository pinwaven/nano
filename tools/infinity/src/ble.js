'use strict';

function loadNoble() {
  try {
    return require('@abandonware/noble');
  } catch (err) {
    try {
      return require('../../halo/node_modules/@abandonware/noble');
    } catch (_) {
      throw err;
    }
  }
}

function loadPeripheralClass() {
  try {
    return require('@abandonware/noble/lib/peripheral');
  } catch (err) {
    try {
      return require('../../halo/node_modules/@abandonware/noble/lib/peripheral');
    } catch (_) {
      throw err;
    }
  }
}

function normalizeUUID(uuid) {
  let clean = String(uuid || '').replace(/[-:]/g, '').toLowerCase();
  if (clean.length === 4) {
    clean = `0000${clean}00001000800000805f9b34fb`;
  } else if (clean.length === 8) {
    clean = `${clean}00001000800000805f9b34fb`;
  }
  return clean;
}

function waitForNobleReady(timeoutMs = 10000) {
  const noble = loadNoble();
  if (noble.state === 'poweredOn') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      noble.removeListener('stateChange', onState);
      reject(new Error(`Bluetooth adapter did not become poweredOn within ${timeoutMs}ms (state=${noble.state})`));
    }, timeoutMs);

    const onState = (state) => {
      if (state === 'poweredOn') {
        clearTimeout(timer);
        noble.removeListener('stateChange', onState);
        resolve();
      } else if (state === 'poweredOff' || state === 'unauthorized') {
        clearTimeout(timer);
        noble.removeListener('stateChange', onState);
        reject(new Error(`Bluetooth unavailable: ${state}`));
      }
    };
    noble.on('stateChange', onState);
  });
}

async function scanDevices(timeoutMs = 8000, namePrefixes = null) {
  const noble = loadNoble();
  await waitForNobleReady();
  return new Promise((resolve, reject) => {
    const found = new Map();
    const timer = setTimeout(() => {
      noble.stopScanning();
      noble.removeListener('discover', onDiscover);
      resolve(Array.from(found.values()));
    }, timeoutMs);

    function onDiscover(peripheral) {
      const name = (peripheral.advertisement && peripheral.advertisement.localName) || '';
      if (namePrefixes && !namePrefixes.some((p) => name.toLowerCase().startsWith(p.toLowerCase()))) return;
      found.set(peripheral.uuid, peripheral);
    }

    noble.on('discover', onDiscover);
    noble.startScanning([], false, (err) => {
      if (!err) return;
      clearTimeout(timer);
      noble.removeListener('discover', onDiscover);
      reject(err);
    });
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
    const service = services.find((svc) => normalizeUUID(svc.uuid) === normalizeUUID(serviceUUID));
    if (!service) throw new Error(`Infinity service ${serviceUUID} not found`);

    const chars = await new Promise((resolve, reject) => {
      service.discoverCharacteristics([], (err, cs) => (err ? reject(err) : resolve(cs)));
    });

    this._writeChar = chars.find((c) => normalizeUUID(c.uuid) === normalizeUUID(writeUUID));
    const notifyChar = chars.find((c) => normalizeUUID(c.uuid) === normalizeUUID(notifyUUID));
    if (!this._writeChar || !notifyChar) {
      const available = chars.map((c) => c.uuid).join(', ');
      throw new Error(`Infinity write/notify characteristics not found. Available: ${available}`);
    }

    await new Promise((resolve, reject) => {
      notifyChar.subscribe((err) => (err ? reject(err) : resolve()));
    });
    notifyChar.on('data', (data) => {
      if (this._notifyHandler) this._notifyHandler(new Uint8Array(data));
    });
  }

  async _findPeripheral() {
    const noble = loadNoble();
    await waitForNobleReady();
    const target = normalizeUUID(this.address);

    if (noble._peripherals[target]) {
      return noble._peripherals[target];
    }

    await new Promise((resolve) => {
      const stop = setTimeout(() => {
        noble.stopScanning();
        noble.removeListener('discover', onDiscover);
        resolve();
      }, 3000);

      function onDiscover(peripheral) {
        const ids = [peripheral.uuid, peripheral.address].filter(Boolean).map(normalizeUUID);
        if (!ids.includes(target)) return;
        clearTimeout(stop);
        noble.stopScanning();
        noble.removeListener('discover', onDiscover);
        resolve();
      }

      noble.on('discover', onDiscover);
      noble.startScanning([], false);
    });

    if (noble._peripherals[target]) {
      return noble._peripherals[target];
    }

    const match = Object.values(noble._peripherals).find((p) => {
      const ids = [p.uuid, p.address].filter(Boolean).map(normalizeUUID);
      return ids.includes(target);
    });
    if (match) return match;

    const Peripheral = loadPeripheralClass();
    const peripheral = new Peripheral(noble, target, 'unknown', 'unknown', true, {}, 0, false);
    noble._peripherals[target] = peripheral;
    noble._services[target] = {};
    noble._characteristics[target] = {};
    noble._descriptors[target] = {};
    return peripheral;
  }

  onNotify(fn) {
    this._notifyHandler = fn;
  }

  write(packet) {
    return new Promise((resolve, reject) => {
      const withoutResponse = this._writeChar.properties.includes('writeWithoutResponse');
      this._writeChar.write(Buffer.from(packet), withoutResponse, (err) => (err ? reject(err) : resolve()));
    });
  }

  async disconnect() {
    if (!this._peripheral) return;
    await new Promise((resolve) => this._peripheral.disconnect(resolve));
    this._peripheral = null;
  }
}

module.exports = { BLETransport, normalizeUUID, scanDevices, waitForNobleReady };
