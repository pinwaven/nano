'use strict';

const fs = require('fs');
const path = require('path');
const { BLETransport, scanDevices } = require('./ble');
const proto = require('./protocol');

const APPID_FILE = path.join(__dirname, '..', '.aizo_appid');

// A stable 32-hex app id persisted across runs so the ring doesn't have to be
// re-bound (re-paired) on every connection.
function loadAppId() {
  try {
    const s = fs.readFileSync(APPID_FILE, 'utf8').trim();
    if (s.length === 32) return s;
  } catch (_) { /* no file yet */ }
  const id = proto.randomAppId();
  try { fs.writeFileSync(APPID_FILE, id); } catch (_) { /* best-effort */ }
  return id;
}

// Frames can span multiple BLE notify packets (each MTU-sized, up to 244
// bytes); a frame's declared length tells us when we have a complete one.
class Reassembler {
  constructor(onFrame) {
    this.buf = Buffer.alloc(0);
    this.onFrame = onFrame;
  }

  push(chunk) {
    this.buf = Buffer.concat([this.buf, Buffer.from(chunk)]);
    while (this.buf.length >= 8) {
      const declaredLen = (this.buf[0] << 8) | this.buf[1];
      const total = 6 + declaredLen; // len(2)+ctrl(2)+sn(2) + payload+crc
      if (declaredLen <= 0 || declaredLen > 4096) { this.buf = Buffer.alloc(0); return; } // resync
      if (this.buf.length < total) return; // wait for more chunks
      const frame = this.buf.subarray(0, total);
      this.buf = this.buf.subarray(total);
      this.onFrame(frame);
    }
  }
}

class AizoRingClient {
  constructor(address, opts = {}) {
    this.address = address;
    this.compId = opts.compId || 'waven';
    this.skipBind = Boolean(opts.skipBind);
    this.debug = Boolean(opts.debug);
    this._ble = new BLETransport(address, opts);
    this._sn = 0;
    this._waiters = [];
    this._reasm = new Reassembler((frame) => this._onFrame(frame));
    this.auth = null;
  }

  static scan(timeoutMs) {
    return scanDevices(timeoutMs || 8000, proto.NAME_PREFIXES);
  }

  _log(...args) {
    if (this.debug) console.error('[debug]', ...args);
  }

  async connect() {
    await this._ble.connect(proto.UUID.SERVICE);
    this._ble.onNotify((d) => this._reasm.push(d));
    if (!this.skipBind) await this.bind();
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

  _nextSn() {
    this._sn = (this._sn + 1) & 0xffff;
    return this._sn;
  }

  async _writeRawFrame(frameBytes) {
    for (const c of proto.chunk(frameBytes)) await this._ble.write(c);
  }

  async _writeFrame(payload, frameOpts) {
    const frame = proto.buildFrame(payload, this._nextSn(), frameOpts);
    this._log('>>', frame.toString('hex'));
    await this._writeRawFrame(frame);
    return frame;
  }

  _onFrame(rawFrame) {
    let f;
    try {
      f = proto.parseFrame(rawFrame);
    } catch (err) {
      this._log('bad crc', rawFrame.toString('hex'), err.message);
      return;
    }
    if (!f) return;
    this._log('<<', rawFrame.toString('hex'));

    if (f.ack === 1) {
      this._writeRawFrame(proto.ackFrame(f.sn, 0)).catch((err) => this._log('ack write failed', err.message));
    }

    const r = proto.decodeResponse(f.payload);
    for (const w of [...this._waiters]) {
      if (!w.predicate(r, f)) continue;
      const val = w.select(r, f);
      if (w.collect) {
        w.results.push(val);
        if (!w.isDone || w.isDone(val, w.results)) this._settle(w, w.results);
      } else {
        this._settle(w, val);
      }
    }
  }

  _settle(waiter, value) {
    clearTimeout(waiter.timer);
    this._waiters = this._waiters.filter((w) => w !== waiter);
    waiter.resolve(value);
  }

  // Generic response-waiter. Non-collecting mode resolves as soon as one frame
  // matches `predicate`. Collecting mode (collect:true) accumulates every match
  // into an array and resolves early if `isDone` says so, or after `timeoutMs`
  // with whatever was collected (never rejects when allowEmpty is set — used
  // for "read a day that might have zero records" style requests).
  _wait(predicate, { timeoutMs = 8000, collect = false, isDone = null, select = (r) => r, allowEmpty = false } = {}) {
    return new Promise((resolve, reject) => {
      const waiter = { predicate, collect, isDone, select, results: [], resolve, reject };
      waiter.timer = setTimeout(() => {
        this._waiters = this._waiters.filter((w) => w !== waiter);
        if (collect) {
          if (waiter.results.length || allowEmpty) resolve(waiter.results);
          else reject(new Error('Aizo ring: timed out waiting for a response'));
        } else {
          reject(new Error('Aizo ring: timed out waiting for a response'));
        }
      }, timeoutMs);
      this._waiters.push(waiter);
    });
  }

  // --- Bind / auth ---

  async bind() {
    const waitAuth = this._wait(
      (r, f) => f.payload[0] === 0x30 || f.cmd === 0x3039 || f.cmd === 0x7070,
      { timeoutMs: 8000, select: (r, f) => proto.parseAuth(f.payload) },
    );
    await this._writeFrame(proto.bindRequest(this.compId, { appId: loadAppId() }));
    const auth = await waitAuth;
    if (!auth || !auth.mac) throw new Error('Aizo ring: bind/auth failed (no MAC in response)');
    this.auth = auth;
    return auth;
  }

  // --- Device info / activity ---

  async getBattery() {
    const p = this._wait((r) => r.kind === 'status', { select: (r) => r.data });
    await this._writeFrame(proto.REQ.battery());
    return p;
  }

  async getSteps() {
    const p = this._wait((r) => r.kind === 'step', { select: (r) => r.data });
    await this._writeFrame(proto.REQ.step());
    return p;
  }

  async getWatchDials() {
    const p = this._wait((r, f) => f.cmd === 0x1027 || f.payload[0] === 0x10, { timeoutMs: 5000, select: (r, f) => f.payload.toString('hex') });
    await this._writeFrame(proto.REQ.getWatchDials());
    return p;
  }

  // --- Stored history sync (0xCC family, spec §7.8.1/7.8.2) ---

  // Resolves to an array of records (possibly empty — the ring only logs a
  // metric when worn at each auto-monitor tick, so an empty day is normal).
  async getHealthHistory(dateMs) {
    const p = this._wait((r) => r.kind === 'healthHistory', { select: (r) => r.data || [] });
    await this._writeFrame(proto.REQ.getHealthData(dateMs));
    return p;
  }

  // Resolves to a summary object, or null if no sleep was recorded that day.
  async getSleepSummary(dateMs) {
    const p = this._wait((r) => r.kind === 'sleepSummary', { select: (r) => r.data });
    await this._writeFrame(proto.REQ.getSleepData(dateMs));
    return p;
  }

  async getSleepDetail(dateMs) {
    const p = this._wait((r) => r.kind === 'sleepDetail', { select: (r) => r.data || [] });
    await this._writeFrame(proto.REQ.getSleepDetail(dateMs));
    return p;
  }

  // --- Sport / workout records (0x96 family, spec §7.8.3) ---

  async getSportStatus() {
    const p = this._wait((r) => r.kind === 'sportStatus', { select: (r) => r.data });
    await this._writeFrame(proto.REQ.getSportStatus());
    return p;
  }

  async getSportLiveData(sportType, sportId) {
    const p = this._wait((r) => r.kind === 'sportLive', { select: (r) => r.data });
    await this._writeFrame(proto.REQ.getSportLiveData(sportType, sportId));
    return p;
  }

  async _sportAction(reqBuf) {
    const p = this._wait((r) => r.kind === 'sportAck', { select: (r) => r.data });
    await this._writeFrame(reqBuf);
    return p;
  }

  sportStart(sportType, sportId) { return this._sportAction(proto.REQ.sportStart(sportType, sportId)); }
  sportPause(sportType, sportId) { return this._sportAction(proto.REQ.sportPause(sportType, sportId)); }
  sportResume(sportType, sportId) { return this._sportAction(proto.REQ.sportResume(sportType, sportId)); }
  sportStop(sportType, sportId) { return this._sportAction(proto.REQ.sportStop(sportType, sportId)); }
  sportAbort(sportType, sportId) { return this._sportAction(proto.REQ.sportAbort(sportType, sportId)); }

  // Triggers a sync of stored/finished sessions and collects whatever comes
  // back for `windowMs`. `sportTotal` is confirmed live (opcode 0x9641);
  // `sportDetail`/`sportEnd` are pattern-inferred and any frame that doesn't
  // match a known opcode surfaces as `sportRaw` (see protocol.js/decodeResponse).
  async syncSportRecords({ windowMs = 6000 } = {}) {
    const p = this._wait(
      (r) => r.kind === 'sportTotal' || r.kind === 'sportDetail' || r.kind === 'sportEnd' || r.kind === 'sportRaw',
      { timeoutMs: windowMs, collect: true, allowEmpty: true, select: (r) => r },
    );
    await this._writeFrame(proto.REQ.getSportRecord());
    return p;
  }

  // --- Auto-monitoring intervals (spec §6.0.1) ---

  async getMeasureInterval() {
    const p = this._wait((r) => r.kind === 'measureInterval', { select: (r) => r.data });
    await this._writeFrame(proto.REQ.getMeasureInterval());
    return p;
  }

  async setMeasureInterval(minutes) {
    const p = this._wait((r) => r.kind === 'measureIntervalSet', { select: () => true });
    await this._writeFrame(proto.REQ.setMeasureInterval(minutes));
    await p;
    return this.getMeasureInterval();
  }

  async getStressInterval() {
    const p = this._wait((r) => r.kind === 'stressInterval', { select: (r) => r.data });
    await this._writeFrame(proto.REQ.getStressInterval());
    return p;
  }

  async setStressInterval(minutes) {
    const p = this._wait((r) => r.kind === 'stressIntervalSet', { select: () => true });
    await this._writeFrame(proto.REQ.setStressInterval(minutes));
    await p;
    return this.getStressInterval();
  }

  // --- On-demand ("instant") measurement (spec §6.0) ---
  // type: 1=HeartRate 2=SpO2 3=Stress 6=Temperature. Stress does NOT return a
  // spot reading on this firmware (needs a sustained window) — rely on the
  // stress auto-monitor schedule instead; measure() will time out for type 3.

  async measure(type, { timeoutMs = 35000 } = {}) {
    const REALTIME_KIND = { 1: 'heartRate', 2: 'bloodOxygen', 3: 'pressure', 6: 'temperature' };
    const kind = REALTIME_KIND[type];
    if (!kind) throw new Error(`Unknown measure type ${type}`);

    const ackWait = this._wait((r) => r.kind === 'measureAck', { timeoutMs: 5000, select: (r) => r.data });
    await this._writeFrame(proto.REQ.instantMeasure(type, 1));
    const ack = await ackWait;
    if (!ack.started) throw new Error('Aizo ring: measurement did not start');

    const result = await this._wait(
      (r) => (r.kind === kind && r.mode === 'realtime') || (r.kind === 'measureDone' && r.data.type === type),
      { timeoutMs, select: (r) => r },
    );
    if (result.kind === 'measureDone') return { valid: result.data.valid, value: null };
    return {
      valid: result.valid !== false,
      value: result.data.value,
      timestamp: result.data.timestamp,
      bodyTemp: result.data.bodyTemp,
      envTemp: result.data.envTemp,
    };
  }

  // --- Raw exploration ---
  // Sends an arbitrary hex payload (already framed at the payload level, e.g.
  // "3838" for watch-info) and collects every frame received for `windowMs`.
  // Useful for probing opcodes not yet wired up as a named method (see
  // docs/protocol_spec.md §9 for what's still pattern-inferred).
  async sendRaw(payloadHex, { windowMs = 5000 } = {}) {
    const payload = Buffer.from(String(payloadHex).replace(/^0x/i, '').replace(/\s+/g, ''), 'hex');
    const p = this._wait(() => true, {
      timeoutMs: windowMs,
      collect: true,
      allowEmpty: true,
      select: (r, f) => ({ cmd: f.cmd != null ? f.cmd.toString(16).padStart(4, '0') : null, kind: r.kind, data: r.data }),
    });
    await this._writeFrame(payload);
    return p;
  }
}

module.exports = { AizoRingClient, Reassembler, loadAppId };
