'use strict';

// High-level V8 smart band client for Node, built on noble instead of the
// wx.* BLE APIs. Reuses the generic BLE transport (tools/halo/src/ble.js) --
// unmodified, since it's already protocol-agnostic -- wired to the V8-specific
// packet builders/parsers in ./v8-protocol.js.
//
// V8 has no home in the miniapp source tree (unlike Halo): this is a CLI-only
// validation phase. If/when V8 support is promoted into the miniapp, this
// file becomes the porting reference, the same relationship the original
// Halo debugging script had to today's utils/wearable/halo/.
//
// UNVALIDATED AGAINST REAL HARDWARE -- see tools/halo/README.md.

const { BLETransport, scanDevices } = require('./ble');
const protocol = require('./v8-protocol');

const {
  SERVICE_UUID, WRITE_UUID, NOTIFY_UUID, V8_NAME_PREFIXES,
  getTimePacket, setTimePacket, getUserInfoPacket, setUserInfoPacket,
  getBatteryPacket, getMacPacket, getVersionPacket,
  setAutoMonitoringPacket, getAutoMonitoringPacket,
  getTotalStepDataPacket, getDetailActivityDataPacket, getSleepDataPacket,
  getDynamicHrDataPacket, getStaticHrDataPacket,
  getHrvTestDataPacket, getTemperatureHistoryPacket, getOxygenDataPacket,
  parseDeviceTime, parseUserInfo, parseBattery, parseMac, parseVersion, parseAutoMonitoring,
  parseTotalStepChunk, parseDetailActivityChunk, parseSleepChunk,
  parseDynamicHrChunk, parseStaticHrChunk, parseHrvChunk,
  parseTemperatureChunk, parseOxygenChunk,
  setMeasurementPacket, setEcgRealtimePacket, parseEcgChunk, parseMeasurementResult,
  ppgModePacket, parsePpgChunk,
} = protocol;

class V8Client {
  constructor(address, opts = {}) {
    this.address = address;
    this._ble = new BLETransport(address, opts);
  }

  static scan(timeoutMs) {
    return scanDevices(timeoutMs || 8000, V8_NAME_PREFIXES);
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

  // Single-packet request/response (device info, set/get commands).
  _send(packet, expectedCmdId, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._ble.onNotify(null);
        reject(new Error(`V8 response timeout (cmd 0x${expectedCmdId.toString(16)})`));
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

  // Multi-notification history sync. Unlike Halo, the vendor SDK parses each
  // notification independently -- a single notification can hold several
  // stacked records thanks to the negotiated MTU (~244 bytes seen in sample
  // data). `parseChunk(data) => { records, done }` runs per-notification;
  // this accumulates the *parsed records* across notifications rather than
  // raw bytes. On timeout, resolves with whatever records have accumulated
  // so far instead of rejecting (mirrors Halo's partial-result behavior) --
  // only rejects if nothing at all came back.
  _streamRecords(packet, expectedCmdId, parseChunk, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      let records = [];
      let gotAny = false;

      const timer = setTimeout(() => {
        this._ble.onNotify(null);
        if (!gotAny) {
          reject(new Error(`V8 stream timeout (cmd 0x${expectedCmdId.toString(16)}), no data received`));
          return;
        }
        console.error(`[warn] V8 stream (cmd 0x${expectedCmdId.toString(16)}) timed out after ${records.length} record(s) without a terminator -- returning partial data`);
        resolve(records);
      }, timeoutMs);

      this._ble.onNotify((data) => {
        if (data[0] !== expectedCmdId) return;
        gotAny = true;
        const { records: chunkRecords, done } = parseChunk(data);
        records = records.concat(chunkRecords);
        if (done) {
          clearTimeout(timer);
          this._ble.onNotify(null);
          resolve(records);
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
    return parseBattery(r);
  }

  async getDeviceTime() {
    const r = await this._send(getTimePacket(), 0x41);
    return parseDeviceTime(r);
  }

  async setTime(date) {
    await this._send(setTimePacket(date || new Date()), 0x01);
  }

  async getUserInfo() {
    const r = await this._send(getUserInfoPacket(), 0x42);
    return parseUserInfo(r);
  }

  async setUserInfo(profile) {
    await this._send(setUserInfoPacket(profile), 0x02);
  }

  async getMac() {
    const r = await this._send(getMacPacket(), 0x22);
    return parseMac(r);
  }

  async getFirmwareVersion() {
    const r = await this._send(getVersionPacket(), 0x27);
    return parseVersion(r);
  }

  // settings: { workMode, startHour, startMinute, endHour, endMinute, weekdays, intervalMinutes, type }
  // type: 1=HR, 2=SpO2, 3=Temperature, 4=HRV
  // Confirmed against real hardware: same opcode (0x2A) and field layout as
  // Halo's setAutoMonitoring (BleSDK.SetAutomaticHRMonitoring uses identical
  // byte offsets), and the device acks by echoing cmd 0x2A.
  async setAutoMonitoring(settings) {
    await this._send(setAutoMonitoringPacket(settings), 0x2A);
  }

  // type: 1=HR, 2=SpO2, 3=Temperature, 4=HRV
  async getAutoMonitoring(type) {
    const r = await this._send(getAutoMonitoringPacket(type), 0x2B);
    return parseAutoMonitoring(r, type);
  }

  // Sequential, not parallel -- only one BLE command/response in flight at a time.
  async getAutoMonitoringAll() {
    return {
      heartRate: await this.getAutoMonitoring(1),
      spo2: await this.getAutoMonitoring(2),
      temperature: await this.getAutoMonitoring(3),
      hrv: await this.getAutoMonitoring(4),
    };
  }

  // --- History ---

  async getSteps() {
    const totals = await this._streamRecords(getTotalStepDataPacket(), 0x51, parseTotalStepChunk, 8000);
    const detail = await this._streamRecords(getDetailActivityDataPacket(), 0x52, parseDetailActivityChunk, 8000).catch(() => []);
    return { totals, detail };
  }

  async getSleepHistory() {
    return this._streamRecords(getSleepDataPacket(), 0x53, parseSleepChunk, 15000);
  }

  // Confirmed against real hardware: this device's continuous HR log
  // regularly exceeds 500 records (50+ notifications) without hitting the
  // 0xFF terminator inside 10s -- same "large history exceeds timeout"
  // situation as Halo's docs describe. Longer timeout, still falls back to
  // partial results rather than blocking indefinitely.
  async getHeartRateHistory() {
    return this._streamRecords(getDynamicHrDataPacket(), 0x54, parseDynamicHrChunk, 25000);
  }

  // sinceDate (optional): validates the incremental-sync design (mode 0x01 +
  // BCD date filter) — see tools/halo/README.md's "Incremental sync
  // validation" section. Omit for the normal mode 0x00 (latest) fetch.
  // V8's mode 0x01 support is UNCONFIRMED (docs/architecture/v8-smart-band.md
  // §6-7's vendor-source trace found no distinct 0x01 branch) — this exists
  // so that fact can actually be tested against real hardware.
  async getHeartRateLog(sinceDate) {
    return this._streamRecords(getStaticHrDataPacket(sinceDate ? 0x01 : 0, sinceDate || null), 0x55, parseStaticHrChunk, 8000);
  }

  async getHrvHistory(sinceDate) {
    return this._streamRecords(getHrvTestDataPacket(sinceDate ? 0x01 : 0, sinceDate || null), 0x56, parseHrvChunk, 8000);
  }

  async getTemperatureHistory(sinceDate) {
    return this._streamRecords(getTemperatureHistoryPacket(sinceDate ? 0x01 : 0, sinceDate || null), 0x62, parseTemperatureChunk, 8000);
  }

  async getSpo2History(sinceDate) {
    return this._streamRecords(getOxygenDataPacket(sinceDate ? 0x01 : 0, sinceDate || null), 0x66, parseOxygenChunk, 8000);
  }
  // --- ECG (live stream, not history) ---

  // Runs one on-demand ECG measurement and collects the raw sample stream.
  // See v8-protocol.js "ECG" for the vendor sequence this mirrors.
  //
  //   opts.duration   value for the 0x28 duration field (default: the demo's
  //                   50000 -- see the protocol note on seconds vs ms)
  //   opts.captureMs  how long to listen before sending stop (default 30s).
  //                   The band never signals "done" on 0x07, so this is the
  //                   only terminator; the CLI stops early on SIGINT too.
  //   opts.onPacket   optional ({ packetId, samples, receivedAt }) => void,
  //                   called per notification for live display.
  //   opts.onAck      optional (parsedMeasurementResult) => void, for whatever
  //                   the band echoes on 0x28 (undocumented for the ECG type).
  //
  // Resolves { packets, samples, firstPacketAt, lastPacketAt, acks }.
  // Always sends the stop pair, even on error, so the band isn't left
  // streaming after we disconnect.
  async recordEcg(opts = {}) {
    const captureMs = opts.captureMs == null ? 30000 : opts.captureMs;
    const packets = [];
    const acks = [];
    let firstPacketAt = null;
    let lastPacketAt = null;
    let stopEarly = null;
    const stopPromise = new Promise((resolve) => { stopEarly = resolve; });
    if (typeof opts.onStopSignal === 'function') opts.onStopSignal(() => stopEarly());

    this._ble.onNotify((data) => {
      if (data[0] === 0x28) {
        const ack = parseMeasurementResult(data);
        acks.push(ack);
        if (opts.onAck) opts.onAck(ack);
        return;
      }
      if (data[0] !== 0x07) return;
      const chunk = parseEcgChunk(data);
      if (!chunk) { acks.push({ type: 'ecg_realtime_ack', raw: Array.from(data) }); return; }
      const receivedAt = Date.now();
      if (firstPacketAt == null) firstPacketAt = receivedAt;
      lastPacketAt = receivedAt;
      const rec = { packetId: chunk.packetId, samples: chunk.samples, receivedAt };
      packets.push(rec);
      if (opts.onPacket) opts.onPacket(rec);
    });

    try {
      // Same order as the vendor demo: start the measurement, then open the tap.
      await this._ble.write(setMeasurementPacket('ecg', true, opts.duration));
      await this._ble.write(setEcgRealtimePacket(true));
      await Promise.race([
        new Promise((resolve) => setTimeout(resolve, captureMs)),
        stopPromise,
      ]);
    } finally {
      try {
        await this._ble.write(setMeasurementPacket('ecg', false, opts.duration));
        await this._ble.write(setEcgRealtimePacket(false));
      } catch (err) {
        console.error(`[warn] failed to send ECG stop: ${err.message}`);
      }
      this._ble.onNotify(null);
    }

    const samples = [];
    for (const p of packets) for (const v of p.samples) samples.push(v);
    return { packets, samples, firstPacketAt, lastPacketAt, acks };
  }

  // Probe the PPG stream (0x78 start / 0x3a data). Everything the band sends on either
  // opcode is kept raw; nothing about the samples is assumed. `progress: true` mirrors
  // the vendor demo's mode=4 percentage ticks in case the band expects them.
  async recordPpg(opts = {}) {
    const captureMs = opts.captureMs == null ? 30000 : opts.captureMs;
    const packets = [];
    const acks = [];
    let firstPacketAt = null, lastPacketAt = null;
    let stopEarly = null;
    const stopPromise = new Promise((resolve) => { stopEarly = resolve; });
    if (typeof opts.onStopSignal === 'function') opts.onStopSignal(() => stopEarly());

    this._ble.onNotify((data) => {
      const receivedAt = Date.now();
      if (data[0] === 0x78) {
        const ack = { status: data[1], raw: Buffer.from(data).toString('hex'), receivedAt };
        acks.push(ack);
        if (opts.onAck) opts.onAck(ack);
        return;
      }
      if (data[0] !== 0x3a) {
        const other = { opcode: data[0], raw: Buffer.from(data).toString('hex'), receivedAt };
        acks.push(other);
        if (opts.onAck) opts.onAck(other);
        return;
      }
      const chunk = parsePpgChunk(data);
      if (firstPacketAt == null) firstPacketAt = receivedAt;
      lastPacketAt = receivedAt;
      const rec = { ...chunk, length: data.length, receivedAt };
      packets.push(rec);
      if (opts.onPacket) opts.onPacket(rec);
    });

    let progressTimer = null;
    try {
      await this._ble.write(ppgModePacket('start'));
      if (opts.progress) {
        const t0 = Date.now();
        let last = -1;
        progressTimer = setInterval(() => {
          const pct = Math.min(100, Math.floor((Date.now() - t0) / captureMs * 100));
          if (pct !== last) { last = pct; this._ble.write(ppgModePacket('progress', pct)).catch(() => {}); }
        }, 1000);
      }
      await Promise.race([
        new Promise((resolve) => setTimeout(resolve, captureMs)),
        stopPromise,
      ]);
    } finally {
      if (progressTimer) clearInterval(progressTimer);
      try {
        await this._ble.write(ppgModePacket('stop'));
        await new Promise((resolve) => setTimeout(resolve, 500));
        await this._ble.write(ppgModePacket('quit'));
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (err) {
        console.error(`[warn] failed to send PPG stop/quit: ${err.message}`);
      }
      this._ble.onNotify(null);
    }
    return { packets, firstPacketAt, lastPacketAt, acks };
  }
}

module.exports = { V8Client };
