'use strict';

// High-level Halo ring client for Node, built on noble instead of the wx.* BLE
// APIs. Reuses the production protocol (packet builders + BCD/byte parsers)
// from src/mini/nano-miniapp/utils/wearable/halo/ so decoding stays identical
// to what the Mini Program does — only the BLE transport differs.

const { BLETransport, scanDevices } = require('./ble');

const protocol = require('../../../src/mini/nano-miniapp/utils/wearable/halo/protocol.js');
const HaloRing = require('../../../src/mini/nano-miniapp/utils/wearable/halo/index.js');
const parsers = HaloRing.parsers;

const {
  SERVICE_UUID, WRITE_UUID, NOTIFY_UUID, HALO_NAME_PREFIXES,
  getBatteryPacket, getTimePacket, setTimePacket,
  getMacPacket, getVersionPacket,
  getDailyActivitySummaryPacket, getDetailActivityPacket,
  getSleepHistoryPacket,
  getContinuousHeartRateHistoryPacket, getStaticHeartRateHistoryPacket,
  getHrvHistoryPacket, getSpo2DetailHistoryPacket, getAutoSpo2HistoryPacket,
  getSleepHrvHistoryPacket, getTemperatureHistoryPacket,
  getExerciseSessionsPacket, getOxygenVariationPacket, getSleepApneaPacket,
  getSleepTemperatureHistoryPacket,
  setAutoMonitoringPacket, getAutoMonitoringPacket,
  parseBcdDate, bcdToString, readLEInt,
} = protocol;

function isoDateStr(date) {
  const OFFSET_MS = 8 * 60 * 60 * 1000;
  const d = new Date((date ? date.getTime() : Date.now()) + OFFSET_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function concat(chunks, totalLen) {
  const out = new Uint8Array(totalLen);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out;
}

function endsFF(acc) {
  return acc.length > 0 && acc[acc.length - 1] === 0xFF;
}

class HaloClient {
  constructor(address, opts = {}) {
    this.address = address;
    this._ble = new BLETransport(address, opts);
  }

  static scan(timeoutMs) {
    return scanDevices(timeoutMs || 8000, HALO_NAME_PREFIXES);
  }

  async connect() {
    await this._ble.connect(SERVICE_UUID, WRITE_UUID, NOTIFY_UUID);
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

  _send(packet, expectedCmdId, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._ble.onNotify(null);
        reject(new Error(`Halo response timeout (cmd 0x${expectedCmdId.toString(16)})`));
      }, timeoutMs);

      this._ble.onNotify((data) => {
        if (data[0] === expectedCmdId) {
          clearTimeout(timer);
          this._ble.onNotify(null);
          resolve(data);
        }
      });

      this._ble.write(packet).catch((err) => {
        clearTimeout(timer);
        this._ble.onNotify(null);
        reject(err);
      });
    });
  }

  // On timeout, resolves with whatever has accumulated so far instead of
  // rejecting — matching temp/x3-connect.js's approach from the original live
  // debugging session. Each notification is one complete, self-contained
  // record, so a partial buffer (missing only the terminator, or older
  // backlog on a ring with a large unsynced history) still parses cleanly.
  // Only rejects if nothing at all came back, which usually means the write
  // itself failed or the BLE link dropped.
  _stream(packet, expectedCmdId, isDone, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let totalLen = 0;

      const timer = setTimeout(() => {
        this._ble.onNotify(null);
        if (chunks.length === 0) {
          reject(new Error(`Halo stream timeout (cmd 0x${expectedCmdId.toString(16)}), no data received`));
          return;
        }
        console.error(`[warn] Halo stream (cmd 0x${expectedCmdId.toString(16)}) timed out after ${chunks.length} packet(s) without a terminator — returning partial data`);
        resolve(concat(chunks, totalLen));
      }, timeoutMs);

      this._ble.onNotify((data) => {
        if (data[0] !== expectedCmdId) return;
        chunks.push(data);
        totalLen += data.length;
        const acc = concat(chunks, totalLen);
        if (isDone(acc)) {
          clearTimeout(timer);
          this._ble.onNotify(null);
          resolve(acc);
        }
      });

      this._ble.write(packet).catch((err) => {
        clearTimeout(timer);
        this._ble.onNotify(null);
        reject(err);
      });
    });
  }

  // --- Device info ---

  async getBattery() {
    const r = await this._send(getBatteryPacket(), 0x13);
    return { level: r[1], charging: r[2] === 1 };
  }

  async getDeviceTime() {
    const r = await this._send(getTimePacket(), 0x41);
    return parseBcdDate(r, 1, true);
  }

  async setTime(date) {
    await this._send(setTimePacket(date || new Date()), 0x01);
  }

  async getMac() {
    const r = await this._send(getMacPacket(), 0x22);
    return Array.from(r.slice(1, 7)).map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
  }

  async getFirmwareVersion() {
    const r = await this._send(getVersionPacket(), 0x27);
    return `${r[1]}.${r[2]}.${r[3]}.${r[4]}`;
  }

  // settings: { workMode, startHour, startMinute, endHour, endMinute, weekdays, intervalMinutes, type }
  // type: 1=HR, 2=SpO2, 3=Temperature, 4=HRV
  async setAutoMonitoring(settings) {
    await this._send(setAutoMonitoringPacket(settings), 0x2A);
  }

  // type: 1=HR, 2=SpO2, 3=Temperature, 4=HRV
  // Returns { workMode, startTime, endTime, weekdays, intervalMinutes, type }
  async getAutoMonitoring(type) {
    const r = await this._send(getAutoMonitoringPacket(type), 0x2B);
    const pad = (n) => String(parseInt(bcdToString(n), 10)).padStart(2, '0');
    return {
      workMode: r[1],
      startTime: `${pad(r[2])}:${pad(r[3])}`,
      endTime: `${pad(r[4])}:${pad(r[5])}`,
      weekdays: r[6],
      intervalMinutes: readLEInt(r, 7, 2),
      type: r[9],
    };
  }

  // Convenience: schedule for all four background measurement types.
  // Returns { heartRate, spo2, temperature, hrv }, each shaped like getAutoMonitoring()'s result.
  // Sequential, not parallel — the ring only has one BLE command/response in flight at a time.
  async getAutoMonitoringAll() {
    return {
      heartRate: await this.getAutoMonitoring(1),
      spo2: await this.getAutoMonitoring(2),
      temperature: await this.getAutoMonitoring(3),
      hrv: await this.getAutoMonitoring(4),
    };
  }

  // --- History ---

  async getSteps(date) {
    const todayStr = isoDateStr(date || new Date());
    const buf51 = await this._stream(getDailyActivitySummaryPacket(), 0x51, endsFF, 8000);
    const buf52 = await this._stream(getDetailActivityPacket(), 0x52, endsFF, 8000).catch(() => null);
    return parsers.parseSteps(buf51, buf52, todayStr);
  }

  async getSleepHistory() {
    const buf = await this._stream(
      getSleepHistoryPacket(),
      0x53,
      (acc) => {
        const n = acc.length;
        return n >= 2 && acc[n - 2] === 0x53 && acc[n - 1] === 0xFF;
      },
      15000,
    );
    return parsers.parseSleepHistory(buf);
  }

  // sinceDate (optional): validates the incremental-sync design (mode 0x01 +
  // BCD date filter) — see tools/halo/README.md's "Incremental sync
  // validation" section. Omit for the normal mode 0x00 (latest) fetch.
  async getHeartRateLog(date, sinceDate) {
    const todayStr = isoDateStr(date || new Date());
    const buf = await this._stream(getStaticHeartRateHistoryPacket(sinceDate ? 0x01 : 0, sinceDate || null), 0x55, endsFF, 8000);
    return parsers.parseHrLog55(buf, todayStr);
  }

  async getHeartRateHistory(date) {
    const todayStr = isoDateStr(date || new Date());
    const buf = await this._stream(getContinuousHeartRateHistoryPacket(), 0x54, endsFF, 10000);
    return parsers.parseHrHistory54(buf, todayStr);
  }

  async getHrvHistory(sinceDate) {
    const buf = await this._stream(getHrvHistoryPacket(sinceDate ? 0x01 : 0, sinceDate || null), 0x56, endsFF, 8000);
    return parsers.parseHrvRecords56(buf);
  }

  async getAutoSpo2History(sinceDate) {
    const buf = await this._stream(getAutoSpo2HistoryPacket(sinceDate ? 0x01 : 0, sinceDate || null), 0x66, endsFF, 8000);
    return parsers.parseSpo2Records66(buf);
  }

  async getSpo2History(date) {
    const todayStr = isoDateStr(date || new Date());
    const buf = await this._stream(getSpo2DetailHistoryPacket(), 0x57, endsFF, 8000);
    return parsers.parseSpo2History57(buf, todayStr);
  }

  async getSleepHrv(date) {
    const todayStr = isoDateStr(date || new Date());
    const buf = await this._stream(getSleepHrvHistoryPacket(), 0x60, endsFF, 10000);
    return parsers.parseSleepHrv60(buf, todayStr);
  }

  async getTemperatureHistory(sinceDate) {
    const buf = await this._stream(getTemperatureHistoryPacket(sinceDate ? 0x01 : 0, sinceDate || null), 0x62, endsFF, 8000);
    return parsers.parseTempLog62(buf, null);
  }

  async getSleepTemperatureLog(date) {
    const todayStr = isoDateStr(date || new Date());
    const buf = await this._stream(getSleepTemperatureHistoryPacket(), 0x69, endsFF, 10000);
    return parsers.parseSleepTempLog69(buf, todayStr);
  }

  async getExerciseSessions(date) {
    const todayStr = isoDateStr(date || new Date());
    const buf = await this._stream(getExerciseSessionsPacket(), 0x5C, endsFF, 10000);
    return parsers.parseExercise5C(buf, todayStr);
  }

  async getSleepApneaRisk(date) {
    const todayStr = isoDateStr(date || new Date());
    const buf = await this._stream(getSleepApneaPacket(), 0x5F, endsFF, 8000);
    return parsers.parseSleepApnea5F(buf, todayStr);
  }

  async getOxygenVariation(date) {
    const todayStr = isoDateStr(date || new Date());
    const buf = await this._stream(getOxygenVariationPacket(), 0x5D, endsFF, 8000);
    return parsers.parseOxygenVariation5D(buf, todayStr);
  }
}

module.exports = { HaloClient };
