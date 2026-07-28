'use strict';

// Node/noble BLE transport for the Aizo/Infinity ring. Mirrors the interface of
// tools/halo/src/ble.js; kept separate because characteristic discovery here is
// more permissive (this hardware notifies on 010a, not the 010b the vendor SDK
// documents) and because the write-type choice below matters for this ring
// specifically (see write()).

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
  if (clean.length === 4) clean = `0000${clean}00001000800000805f9b34fb`;
  else if (clean.length === 8) clean = `${clean}00001000800000805f9b34fb`;
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
  return new Promise((resolve) => {
    const found = new Map();
    function onDiscover(peripheral) {
      const name = (peripheral.advertisement && peripheral.advertisement.localName) || '';
      const svcs = ((peripheral.advertisement && peripheral.advertisement.serviceUuids) || []).map(normalizeUUID);
      const matchesName = namePrefixes && namePrefixes.some((p) => name.toLowerCase().startsWith(p.toLowerCase()));
      const matchesService = svcs.some((u) => u.includes('fe02'));
      if (namePrefixes && !matchesName && !matchesService) return;
      found.set(peripheral.uuid, peripheral);
    }
    noble.on('discover', onDiscover);
    noble.startScanning([], true);
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
    this._notifyChar = null;
    this._notifyHandler = null;
  }

  _log(...args) {
    if (this.debug) console.error('[debug]', ...args);
  }

  // serviceUUID: the fe02 GATT service. Write/notify characteristics are
  // discovered by property + UUID-suffix preference rather than a fixed pair,
  // because different units expose the write/notify pair on different handles
  // (this hardware: write=0101, notify=010a — not 010b as the SDK docs it).
  async connect(serviceUUID) {
    const peripheral = await this._findPeripheral();
    this._peripheral = peripheral;

    await new Promise((resolve, reject) => {
      peripheral.connect((err) => (err ? reject(err) : resolve()));
    });
    this._log('Connected, discovering services...');

    const { characteristics: allChars } = await new Promise((resolve, reject) => {
      peripheral.discoverAllServicesAndCharacteristics((err, services, characteristics) =>
        err ? reject(err) : resolve({ services, characteristics }));
    });
    const inService = (c) => normalizeUUID(c._serviceUuid || '').includes(normalizeUUID(serviceUUID).slice(4, 8));
    const pool = allChars.filter(inService).length ? allChars.filter(inService) : allChars;

    const has = (c, p) => (c.properties || []).includes(p);
    const canWrite = (c) => has(c, 'write') || has(c, 'writeWithoutResponse');

    this._writeChar =
      pool.find((c) => normalizeUUID(c.uuid).endsWith('0101') && canWrite(c)) ||
      pool.find((c) => canWrite(c));
    const notifyChar =
      pool.find((c) => normalizeUUID(c.uuid).endsWith('010a') && has(c, 'notify')) ||
      pool.find((c) => normalizeUUID(c.uuid).endsWith('010b') && has(c, 'notify')) ||
      pool.find((c) => normalizeUUID(c.uuid).endsWith('013a') && has(c, 'notify')) ||
      pool.find((c) => has(c, 'notify'));

    if (!this._writeChar || !notifyChar) {
      const available = allChars.map((c) => c.uuid).join(', ');
      throw new Error(`Infinity write/notify characteristics not found. Available: ${available}`);
    }
    this._log(`write=${this._writeChar.uuid} notify=${notifyChar.uuid}`);
    this._notifyChar = notifyChar;

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

    if (noble._peripherals[target]) return noble._peripherals[target];

    await new Promise((resolve) => {
      const stop = setTimeout(() => {
        noble.stopScanning();
        noble.removeListener('discover', onDiscover);
        resolve();
      }, 5000);

      function onDiscover(peripheral) {
        const ids = [peripheral.uuid, peripheral.address].filter(Boolean).map(normalizeUUID);
        if (!ids.includes(target)) return;
        clearTimeout(stop);
        noble.stopScanning();
        noble.removeListener('discover', onDiscover);
        resolve();
      }

      noble.on('discover', onDiscover);
      noble.startScanning([], true);
    });

    if (noble._peripherals[target]) return noble._peripherals[target];
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

  // Writes exactly one raw chunk (caller is responsible for MTU-sized chunking
  // of larger framed packets — see client.js's _writeFrame). Prefers
  // write-WITH-response: on this hardware the 0101 characteristic advertises
  // BOTH write and writeWithoutResponse, but a without-response write is
  // silently dropped by the ring — write-with-response is the only one that
  // actually lands. Only fall back to without-response if that's the sole
  // property the characteristic supports.
  write(packet) {
    return new Promise((resolve, reject) => {
      const props = this._writeChar.properties || [];
      const withoutResponse = props.includes('writeWithoutResponse') && !props.includes('write');
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
