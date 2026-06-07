'use strict';

const noble = require('@abandonware/noble');
const battery = require('./battery');
const blinkTwice = require('./blinkTwice');
const dateUtils = require('./dateUtils');
const hr = require('./hr');
const hrSettings = require('./hrSettings');
const packet = require('./packet');
const reboot = require('./reboot');
const realTime = require('./realTime');
const setTime = require('./setTime');
const sleep = require('./sleep');
const steps = require('./steps');

const UART_SERVICE_UUID = '6e40fff0b5a3f393e0a9e50e24dcca9e';
const UART_RX_CHAR_UUID = '6e400002b5a3f393e0a9e50e24dcca9e';
const UART_TX_CHAR_UUID = '6e400003b5a3f393e0a9e50e24dcca9e';
const DEVICE_INFO_UUID = '0000180a00001000800000805f9b34fb';
const DEVICE_HW_UUID = '00002a2700001000800000805f9b34fb';
const DEVICE_FW_UUID = '00002a2600001000800000805f9b34fb';

// Big Data V2 service — used for sleep and other bulk data
const BIG_DATA_SERVICE_UUID = 'de5bf728d7114e47af2665e3012a5dc7';
const BIG_DATA_RX_CHAR_UUID = 'de5bf72ad7114e47af2665e3012a5dc7';
const BIG_DATA_TX_CHAR_UUID = 'de5bf729d7114e47af2665e3012a5dc7';

function normalizeUUID(uuid) {
  return uuid.replace(/-/g, '').toLowerCase();
}

class AsyncQueue {
  constructor() {
    this._items = [];
    this._waiters = [];
  }

  put(item) {
    if (this._waiters.length > 0) {
      const waiter = this._waiters.shift();
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.resolve(item);
    } else {
      this._items.push(item);
    }
  }

  get(timeoutMs = null) {
    if (this._items.length > 0) return Promise.resolve(this._items.shift());
    return new Promise((resolve, reject) => {
      const waiter = { resolve, timer: null };
      if (timeoutMs !== null) {
        waiter.timer = setTimeout(() => {
          const idx = this._waiters.indexOf(waiter);
          if (idx !== -1) this._waiters.splice(idx, 1);
          reject(new Error('Queue get timed out'));
        }, timeoutMs);
      }
      this._waiters.push(waiter);
    });
  }
}

class FullData {
  constructor(address, heartRates, sportDetails) {
    this.address = address;
    this.heartRates = heartRates;
    this.sportDetails = sportDetails;
  }
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

async function scanDevices(timeoutMs = 5000) {
  await waitForNobleReady();
  return new Promise((resolve) => {
    const found = new Map();
    const onDiscover = (peripheral) => {
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

class Client {
  constructor(address, options = {}) {
    this.address = address;
    this.debug = options.debug || false;
    this._peripheral = null;
    this._rxChar = null;
    this._bigDataRxChar = null;
    this._bigDataBuffer = null;
    this._bigDataExpectedSize = 0;
    this._bigDataQueue = new AsyncQueue();

    const hrParser = new hr.HeartRateLogParser();
    const stepsParser = new steps.SportDetailParser();

    this._commandHandlers = {
      [battery.CMD_BATTERY]: (p) => battery.parseBattery(p),
      [realTime.CMD_START_REAL_TIME]: (p) => realTime.parseRealTimeReading(p),
      [realTime.CMD_STOP_REAL_TIME]: () => null,
      [steps.CMD_GET_STEP_SOMEDAY]: (p) => stepsParser.parse(p),
      [hr.CMD_READ_HEART_RATE]: (p) => hrParser.parse(p),
      [setTime.CMD_SET_TIME]: () => null,
      [hrSettings.CMD_HEART_RATE_LOG_SETTINGS]: (p) => hrSettings.parseHeartRateLogSettings(p),
    };

    this._queues = {};
    for (const cmd of Object.keys(this._commandHandlers)) {
      this._queues[parseInt(cmd)] = new AsyncQueue();
    }
  }

  _log(...args) {
    if (this.debug) console.error('[debug]', ...args);
  }

  async connect() {
    this._log(`Connecting to ${this.address}`);
    const peripheral = await this._findPeripheral();
    this._peripheral = peripheral;

    await new Promise((resolve, reject) => {
      peripheral.connect((err) => (err ? reject(err) : resolve()));
    });
    this._log('Connected, discovering services...');

    const services = await new Promise((resolve, reject) => {
      peripheral.discoverServices(
        [UART_SERVICE_UUID, DEVICE_INFO_UUID, BIG_DATA_SERVICE_UUID],
        (err, svcs) => (err ? reject(err) : resolve(svcs))
      );
    });

    const uartService = services.find((s) => s.uuid === UART_SERVICE_UUID);
    if (!uartService) throw new Error('UART service not found');

    const uartChars = await new Promise((resolve, reject) => {
      uartService.discoverCharacteristics(
        [UART_RX_CHAR_UUID, UART_TX_CHAR_UUID],
        (err, chars) => (err ? reject(err) : resolve(chars))
      );
    });

    this._rxChar = uartChars.find((c) => c.uuid === UART_RX_CHAR_UUID);
    const txChar = uartChars.find((c) => c.uuid === UART_TX_CHAR_UUID);
    if (!this._rxChar || !txChar) throw new Error('UART characteristics not found');

    await new Promise((resolve, reject) => {
      txChar.subscribe((err) => (err ? reject(err) : resolve()));
    });
    txChar.on('data', (data) => this._handleTx(data));

    // Big Data V2 service (sleep and other bulk data) — optional
    const bigDataService = services.find((s) => s.uuid === BIG_DATA_SERVICE_UUID);
    if (bigDataService) {
      const bdChars = await new Promise((resolve, reject) => {
        bigDataService.discoverCharacteristics(
          [BIG_DATA_RX_CHAR_UUID, BIG_DATA_TX_CHAR_UUID],
          (err, chars) => (err ? reject(err) : resolve(chars))
        );
      });
      this._bigDataRxChar = bdChars.find((c) => c.uuid === BIG_DATA_RX_CHAR_UUID) || null;
      const bdTxChar = bdChars.find((c) => c.uuid === BIG_DATA_TX_CHAR_UUID);
      if (bdTxChar) {
        await new Promise((resolve, reject) => {
          bdTxChar.subscribe((err) => (err ? reject(err) : resolve()));
        });
        bdTxChar.on('data', (data) => this._handleBigData(data));
        this._log('Big Data V2 service connected (sleep available)');
      }
    } else {
      this._log('Big Data V2 service not found (sleep unavailable)');
    }

    // Discover device info service too, for getDeviceInfo()
    this._deviceInfoService = services.find((s) => s.uuid === DEVICE_INFO_UUID) || null;
    this._log('Ready');
  }

  async _findPeripheral() {
    await waitForNobleReady();
    const target = normalizeUUID(this.address);

    // Return cached peripheral immediately if noble already knows about it
    if (noble._peripherals[target]) {
      return noble._peripherals[target];
    }

    // Pre-create the Peripheral so noble.onConnect can find it after connect().
    // Noble's native macOS code calls CoreBluetooth's retrievePeripheralsWithIdentifiers
    // inside connect(), so the device doesn't need to be actively advertising —
    // this mirrors exactly what Python bleak does on macOS.
    const Peripheral = require('@abandonware/noble/lib/peripheral');
    const peripheral = new Peripheral(noble, target, 'unknown', 'unknown', true, {}, 0, false);
    noble._peripherals[target] = peripheral;
    noble._services[target] = {};
    noble._characteristics[target] = {};
    noble._descriptors[target] = {};

    // Scan briefly in parallel: if the device happens to be advertising, noble
    // will update the peripheral entry with real advertisement data.
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

  _handleTx(data) {
    this._log('Received packet', data);
    if (data.length !== 16) {
      console.error(`Unexpected packet length: ${data.length}`);
      return;
    }
    const packetType = data[0] & 0x7f; // strip error bit
    const hasError = data[0] >= 128;
    if (hasError) this._log(`Error bit set on packet type ${packetType}`);
    if (packetType in this._commandHandlers) {
      const result = this._commandHandlers[packetType](data);
      if (result !== null && result !== undefined) {
        this._queues[packetType].put(result);
      }
    } else if (this._probeQueues && this._probeQueues[packetType]) {
      this._probeQueues[packetType].put(Buffer.from(data));
    } else {
      this._log(`Unexpected packet type: ${packetType}`);
    }
  }

  _handleBigData(data) {
    this._log('Received Big Data packet', data);

    // Buffer packets until we have the full message (dataLen + 6 header bytes)
    if (this._bigDataBuffer !== null) {
      this._bigDataBuffer = Buffer.concat([this._bigDataBuffer, data]);
    } else {
      if (data.length < 6) return;
      const dataLen = data.readUInt16LE(2);
      if (data.length >= dataLen + 6) {
        // Complete in one packet
        this._bigDataBuffer = null;
        const result = sleep.parseSleepResponse(data);
        if (result !== null) this._bigDataQueue.put(result);
        return;
      }
      // Start buffering
      this._bigDataBuffer = Buffer.from(data);
      this._bigDataExpectedSize = dataLen;
      return;
    }

    if (this._bigDataBuffer.length >= this._bigDataExpectedSize + 6) {
      const complete = this._bigDataBuffer;
      this._bigDataBuffer = null;
      this._bigDataExpectedSize = 0;
      const result = sleep.parseSleepResponse(complete);
      if (result !== null) this._bigDataQueue.put(result);
    }
  }

  async getSleep() {
    if (!this._bigDataRxChar) {
      throw new Error('Big Data V2 service not available — ring may not support sleep data retrieval');
    }
    await new Promise((resolve, reject) => {
      this._bigDataRxChar.write(sleep.readSleepPacket(), true, (err) => (err ? reject(err) : resolve()));
    });
    return this._bigDataQueue.get(5000);
  }

  async disconnect() {
    if (this._peripheral) {
      await new Promise((resolve) => this._peripheral.disconnect(resolve));
    }
  }

  async [Symbol.asyncDispose]() {
    await this.disconnect();
  }

  async sendPacket(pkt) {
    this._log('Sending packet', pkt);
    await new Promise((resolve, reject) => {
      this._rxChar.write(pkt, true, (err) => (err ? reject(err) : resolve()));
    });
  }

  async getBattery() {
    await this.sendPacket(battery.BATTERY_PACKET);
    return this._queues[battery.CMD_BATTERY].get(2000);
  }

  async getDeviceInfo() {
    if (!this._deviceInfoService) throw new Error('Device info service not found');
    const chars = await new Promise((resolve, reject) => {
      this._deviceInfoService.discoverCharacteristics(
        [DEVICE_HW_UUID, DEVICE_FW_UUID],
        (err, c) => (err ? reject(err) : resolve(c))
      );
    });
    const hwChar = chars.find((c) => c.uuid === DEVICE_HW_UUID);
    const fwChar = chars.find((c) => c.uuid === DEVICE_FW_UUID);
    const readChar = (c) => new Promise((resolve, reject) => {
      c.read((err, data) => (err ? reject(err) : resolve(data.toString('utf8'))));
    });
    return {
      hw_version: hwChar ? await readChar(hwChar) : 'unknown',
      fw_version: fwChar ? await readChar(fwChar) : 'unknown',
    };
  }

  async setTime(ts = null) {
    const t = ts || dateUtils.now();
    await this.sendPacket(setTime.setTimePacket(t));
  }

  async blinkTwice() {
    await this.sendPacket(blinkTwice.BLINK_TWICE_PACKET);
  }

  async reboot() {
    await this.sendPacket(reboot.REBOOT_PACKET);
  }

  async getHeartRateLog(target = null) {
    const t = target || dateUtils.startOfDay(dateUtils.now());
    await this.sendPacket(hr.readHeartRatePacket(t));
    return this._queues[hr.CMD_READ_HEART_RATE].get(2000);
  }

  async getHeartRateLogSettings() {
    await this.sendPacket(hrSettings.READ_HEART_RATE_LOG_SETTINGS_PACKET);
    return this._queues[hrSettings.CMD_HEART_RATE_LOG_SETTINGS].get(2000);
  }

  async setHeartRateLogSettings(enabled, interval) {
    await this.sendPacket(hrSettings.hrLogSettingsPacket({ enabled, interval }));
    // consume and discard the response
    await this._queues[hrSettings.CMD_HEART_RATE_LOG_SETTINGS].get(2000);
  }

  async getSteps(target, today = null) {
    const ref = today || dateUtils.now();
    const targetMs = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());
    const refMs = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate());
    const days = Math.round((refMs - targetMs) / (24 * 60 * 60 * 1000));
    this._log(`Looking back ${days} day(s)`);
    await this.sendPacket(steps.readStepsPacket(days));
    return this._queues[steps.CMD_GET_STEP_SOMEDAY].get(2000);
  }

  async getRealtimeReading(readingType) {
    const startPkt = realTime.getStartPacket(readingType);
    const stopPkt = realTime.getStopPacket(readingType);

    await this.sendPacket(startPkt);

    // HRV (type 10) streams raw RR intervals and delivers the final RMSSD in a
    // single packet after ~90-105 s of measurement.  All other types settle in
    // under 30 s.  Use a per-type timeout so HRV has enough budget.
    const IS_HRV = readingType === realTime.RealTimeReading.HRV;
    const deadlineMs = IS_HRV ? 120000 : 40000;
    const deadline = Date.now() + deadlineMs;

    const validReadings = [];
    let error = false;

    while (validReadings.length < 6 && Date.now() < deadline) {
      const remaining = deadline - Date.now();
      try {
        const data = await this._queues[realTime.CMD_START_REAL_TIME].get(Math.min(2000, remaining));
        if (data.type === 'error') {
          error = true;
          break;
        }
        if (data.value !== 0) validReadings.push(data.value);
      } catch {
        // queue.get timed out — keep looping until deadline
      }
    }

    await this.sendPacket(stopPkt);
    return error ? null : validReadings;
  }

  async raw(command, subdata = Buffer.alloc(0), replies = 0) {
    const pkt = packet.makePacket(command, subdata);

    // For unknown commands, set up a temporary probe queue
    const isKnown = command in this._commandHandlers;
    if (!isKnown && replies > 0) {
      if (!this._probeQueues) this._probeQueues = {};
      this._probeQueues[command] = new AsyncQueue();
    }

    await this.sendPacket(pkt);

    const results = [];
    const queue = isKnown ? this._queues[command] : (this._probeQueues && this._probeQueues[command]);
    if (queue) {
      for (let i = 0; i < replies; i++) {
        try {
          results.push(await queue.get(2000));
        } catch {
          break; // timeout — no more packets
        }
      }
    }

    if (!isKnown && this._probeQueues) delete this._probeQueues[command];
    return results;
  }

  async getFullData(start, end) {
    const heartRateLogs = [];
    const sportDetailLogs = [];
    for (const d of dateUtils.datesBetween(start, end)) {
      heartRateLogs.push(await this.getHeartRateLog(d));
      sportDetailLogs.push(await this.getSteps(d));
    }
    return new FullData(this.address, heartRateLogs, sportDetailLogs);
  }

  async run(fn) {
    await this.connect();
    try {
      return await fn(this);
    } finally {
      await this.disconnect();
    }
  }
}

module.exports = { Client, FullData, scanDevices };
