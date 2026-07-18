'use strict';

const { BLETransport, scanDevices } = require('./ble');
const protocol = require('./protocol');

const {
  BLE_SERVICE_UUID,
  WRITE_UUID,
  NOTIFY_UUID,
  INFINITY_NAME_PREFIXES,
  getBindRequest,
  getStepInfoRequest,
  getSleepInfoRequest,
  getPressureRequest,
  getWatchInfoRequest,
  getHeartRateRequest,
  getSpO2Request,
  buildFrame,
  parseFrame,
  parseDeviceStatus,
  parseStepInfo,
  parseSleepDetail,
  parsePressure,
  parseTimestampValueRecords,
  hexToBytes,
  toHex,
} = protocol;

class InfinityClient {
  constructor(address, opts = {}) {
    this.address = address;
    this.compId = opts.compId || 'waven';
    this.skipBind = Boolean(opts.skipBind);
    this._ble = new BLETransport(address, opts);
  }

  static scan(timeoutMs, prefixes = INFINITY_NAME_PREFIXES) {
    return scanDevices(timeoutMs || 8000, prefixes);
  }

  async connect() {
    await this._ble.connect(BLE_SERVICE_UUID, WRITE_UUID, NOTIFY_UUID);
    if (!this.skipBind) {
      await this.bind();
    }
  }

  async disconnect() {
    await this._ble.disconnect();
  }

  async run(fn) {
    await this.connect();
    try {
      return await fn(this);
    } finally {
      await this.disconnect();
    }
  }

  async bind() {
    const frame = await this._send(getBindRequest(this.compId), 0x30, 7000);
    return frameToObject(frame);
  }

  async getBattery() {
    const frame = await this._send(getWatchInfoRequest(2), 0x38, 5000);
    const status = parseDeviceStatus(frame.payload);
    return {
      level: status.batteryPercent,
      charging: null,
      workingMode: status.workingMode,
      rawHex: status.rawHex,
    };
  }

  async getWatchInfo(infoType = 2) {
    const frame = await this._send(getWatchInfoRequest(infoType), 0x38, 5000);
    return frameToObject(frame);
  }

  async getSteps() {
    const frame = await this._send(getStepInfoRequest(), 0x33, 7000);
    return parseStepInfo(frame.payload);
  }

  async getSleep() {
    const frames = await this._streamFrames(getSleepInfoRequest(), 0x35, 12000, 1800);
    const details = [];
    for (const frame of frames) {
      try {
        details.push(parseSleepDetail(frame.payload));
      } catch (err) {
        details.push({ error: err.message, rawHex: toHex(frame.payload) });
      }
    }
    return { summary: summarizeSleep(details), details };
  }

  async getStress() {
    const frame = await this._send(getPressureRequest(), 0x31, 8000);
    return parsePressure(frame.payload);
  }

  async getHeartRate() {
    const frame = await this._send(getHeartRateRequest(), 0x31, 8000);
    return {
      records: parseTimestampValueRecords(frame.payload, { min: 30, max: 220, label: 'heartRate' }),
      rawHex: toHex(frame.payload),
    };
  }

  async getSpO2() {
    const frame = await this._send(getSpO2Request(), 0x32, 8000);
    return {
      records: parseTimestampValueRecords(frame.payload, { min: 50, max: 100, label: 'spo2' }),
      rawHex: toHex(frame.payload),
    };
  }

  async sendRawFrame(cmdId, payloadHex = '', opts = {}) {
    const packet = buildFrame(cmdId, hexToBytes(payloadHex), opts.arg3 || 0, opts.arg4 || 0, opts.seq || 0);
    if (opts.stream) {
      const frames = await this._streamFrames(packet, opts.expect ?? cmdId, opts.timeoutMs || 10000, opts.silenceMs || 1800);
      return frames.map(frameToObject);
    }
    const frame = await this._send(packet, opts.expect ?? cmdId, opts.timeoutMs || 7000);
    return frameToObject(frame);
  }

  _send(packet, expectedCmdId, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._ble.onNotify(null);
        reject(new Error(`Infinity response timeout (cmd 0x${expectedCmdId.toString(16)})`));
      }, timeoutMs);

      this._ble.onNotify((data) => {
        try {
          const frame = parseFrame(data);
          if (!frame || frame.cmdId !== expectedCmdId) return;
          clearTimeout(timer);
          this._ble.onNotify(null);
          resolve(frame);
        } catch (err) {
          clearTimeout(timer);
          this._ble.onNotify(null);
          reject(err);
        }
      });

      this._ble.write(packet).catch((err) => {
        clearTimeout(timer);
        this._ble.onNotify(null);
        reject(err);
      });
    });
  }

  _streamFrames(packet, expectedCmdId, timeoutMs = 10000, silenceMs = 1800) {
    return new Promise((resolve, reject) => {
      const frames = [];
      let hardTimer = null;
      let silenceTimer = null;

      const finish = () => {
        clearTimeout(hardTimer);
        clearTimeout(silenceTimer);
        this._ble.onNotify(null);
        resolve(frames);
      };

      const resetSilence = () => {
        clearTimeout(silenceTimer);
        silenceTimer = setTimeout(finish, silenceMs);
      };

      hardTimer = setTimeout(() => {
        if (frames.length === 0) {
          this._ble.onNotify(null);
          reject(new Error(`Infinity stream timeout (cmd 0x${expectedCmdId.toString(16)}), no data received`));
          return;
        }
        finish();
      }, timeoutMs);

      this._ble.onNotify((data) => {
        try {
          const frame = parseFrame(data);
          if (!frame || frame.cmdId !== expectedCmdId) return;
          frames.push(frame);
          resetSilence();
        } catch (err) {
          clearTimeout(hardTimer);
          clearTimeout(silenceTimer);
          this._ble.onNotify(null);
          reject(err);
        }
      });

      this._ble.write(packet).catch((err) => {
        clearTimeout(hardTimer);
        clearTimeout(silenceTimer);
        this._ble.onNotify(null);
        reject(err);
      });
    });
  }
}

function frameToObject(frame) {
  return {
    cmdId: frame.cmdId,
    seq: frame.seq,
    ack: frame.ack,
    type: frame.type,
    payloadHex: toHex(frame.payload),
    rawHex: toHex(frame.raw),
  };
}

function summarizeSleep(details) {
  const valid = details.filter((item) => !item.error).sort((a, b) => a.offsetMinutes - b.offsetMinutes);
  const summary = { totalMinutes: 0, deep: 0, light: 0, rem: 0, awake: 0, periods: [] };
  if (!valid.length) return summary;

  const buckets = { 0: 'awake', 1: 'light', 2: 'deep', 3: 'rem' };
  for (let i = 0; i < valid.length; i += 1) {
    const current = valid[i];
    const next = valid[i + 1];
    const minutes = next ? Math.max(0, next.offsetMinutes - current.offsetMinutes) : 30;
    const key = buckets[current.sleepMode] || 'unknown';
    if (key !== 'unknown') summary[key] += minutes;
    summary.totalMinutes += minutes;
    summary.periods.push({
      start: current.timestamp,
      mode: key,
      minutes,
    });
  }
  return summary;
}

module.exports = { InfinityClient, protocol };
