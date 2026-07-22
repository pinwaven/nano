'use strict'

const { WearableDevice } = require('../index.js')
const { BLEManager } = require('../ble-manager.js')
const proto = require('./protocol.js')
const {
  BLE_SERVICE_UUID, WRITE_UUID, NOTIFY_UUID, AIZO_NAME_PREFIXES, MEASURE_TYPE,
} = proto

const NOTIFY_MAP = {
  [BLE_SERVICE_UUID]: { txCharUUID: NOTIFY_UUID, rxCharUUID: WRITE_UUID },
}

const APPID_STORAGE_KEY = 'aizo_app_id'

// A stable 32-hex app id persisted across sessions so the ring doesn't need to
// be re-bound (re-paired) on every connection.
function loadAppId() {
  try {
    const s = wx.getStorageSync(APPID_STORAGE_KEY)
    if (s && s.length === 32) return s
  } catch (_) { /* no value yet */ }
  const id = proto.randomAppId()
  try { wx.setStorageSync(APPID_STORAGE_KEY, id) } catch (_) { /* best-effort */ }
  return id
}

// Frames can span multiple BLE notify packets (each MTU-sized); a frame's
// declared length tells us when we have a complete one.
class Reassembler {
  constructor(onFrame) {
    this.buf = new Uint8Array(0)
    this.onFrame = onFrame
  }
  push(chunk) {
    this.buf = proto.concatBytes(this.buf, chunk)
    while (this.buf.length >= 8) {
      const declaredLen = (this.buf[0] << 8) | this.buf[1]
      const total = 6 + declaredLen
      if (declaredLen <= 0 || declaredLen > 4096) { this.buf = new Uint8Array(0); return } // resync
      if (this.buf.length < total) return // wait for more chunks
      const frame = this.buf.subarray(0, total)
      this.buf = this.buf.subarray(total)
      this.onFrame(frame)
    }
  }
}

function pad2(n) { return String(n).padStart(2, '0') }
// epoch ms -> "YYYY-MM-DD HH:MM:SS" (local wall-clock), matching the string-
// timestamp convention used throughout the halo/colmi adapters.
function tsStr(ms) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}
// "YYYY-MM-DD HH:MM:SS" -> the noon-cutoff "night" bucket date (matches
// halo/index.js's _nightKey so sleep sessions group the same way downstream).
function nightKey(dateStr) {
  const [dp, tp] = dateStr.split(' ')
  const hour = parseInt(tp.slice(0, 2), 10)
  if (hour >= 12) return dp
  const [y, mo, d] = dp.split('-').map(Number)
  const dt = new Date(y, mo - 1, d - 1)
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`
}

class AizoRing extends WearableDevice {
  constructor() {
    super()
    this._ble = new BLEManager()
    this._deviceId = null
    this._name = null
    this._sn = 0
    this._waiters = []
    this._reasm = new Reassembler((frame) => this._onFrame(frame))
    this._healthCache = new Map() // dayKey(YYYY-MM-DD) -> health history records for that day
    this._txQueue = Promise.resolve() // serializes request/response cycles — see _enqueue()
    this.auth = null
  }

  // Scan for Aizo/Infinity rings. Returns [{ deviceId, name, rssi }].
  static async scan(timeoutMs) {
    const mgr = new BLEManager()
    await mgr.openAdapter()
    try {
      return await mgr.scan(AIZO_NAME_PREFIXES, timeoutMs || 8000)
    } finally {
      await mgr.closeAdapter()
    }
  }

  // opts: string (name) or { name, syncTime } — matches other adapters' call
  // convention. `syncTime` is a no-op here: bind() always sends the current
  // time, so the ring's clock is synced on every connect regardless.
  async connect(deviceId, opts) {
    if (typeof opts === 'string') opts = { name: opts }
    opts = opts || {}
    this._deviceId = deviceId
    this._name = opts.name || 'Aizo Ring'
    await this._ble.openAdapter()
    await this._ble.connect(deviceId, NOTIFY_MAP)
    this._ble.onNotify(NOTIFY_UUID, (data) => this._reasm.push(data))
    await this.bind()
  }

  async disconnect() {
    await this._ble.disconnect()
    this._deviceId = null
    this._name = null
    this._healthCache.clear()
  }

  _nextSn() {
    this._sn = (this._sn + 1) & 0xFFFF
    return this._sn
  }

  async _writeRawFrame(frameBytes) {
    for (const c of proto.chunk(frameBytes)) {
      await this._ble.write(this._deviceId, BLE_SERVICE_UUID, WRITE_UUID, c)
    }
  }

  async _writeFrame(payload, frameOpts) {
    const frame = proto.buildFrame(payload, this._nextSn(), frameOpts)
    await this._writeRawFrame(frame)
    return frame
  }

  _onFrame(rawFrame) {
    let f
    try {
      f = proto.parseFrame(rawFrame)
    } catch (_) {
      return // bad CRC — drop
    }
    if (!f) return

    if (f.ack === 1) {
      this._writeRawFrame(proto.ackFrame(f.sn, 0)).catch(() => {})
    }

    const r = proto.decodeResponse(f.payload)
    for (const w of this._waiters.slice()) {
      if (!w.predicate(r, f)) continue
      const val = w.select(r, f)
      if (w.collect) {
        w.results.push(val)
        if (!w.isDone || w.isDone(val, w.results)) this._settle(w, w.results)
      } else {
        this._settle(w, val)
      }
    }
  }

  _settle(waiter, value) {
    clearTimeout(waiter.timer)
    this._waiters = this._waiters.filter((w) => w !== waiter)
    waiter.resolve(value)
  }

  // Generic response-waiter (see nano/tools/aizoring/src/client.js for the
  // same design used by the standalone CLI). Non-collecting mode resolves as
  // soon as one frame matches `predicate`. Collecting mode accumulates every
  // match and resolves early via `isDone`, or after `timeoutMs` with whatever
  // was collected (never rejects when `allowEmpty` — used for "a day that
  // might have zero records" style requests).
  _wait(predicate, opts) {
    opts = opts || {}
    const timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : 8000
    const collect = Boolean(opts.collect)
    const isDone = opts.isDone || null
    const select = opts.select || ((r) => r)
    const allowEmpty = Boolean(opts.allowEmpty)
    return new Promise((resolve, reject) => {
      const waiter = { predicate, collect, isDone, select, results: [], resolve, reject }
      waiter.timer = setTimeout(() => {
        this._waiters = this._waiters.filter((w) => w !== waiter)
        if (collect) {
          if (waiter.results.length || allowEmpty) resolve(waiter.results)
          else reject(new Error('Aizo ring: timed out waiting for a response'))
        } else {
          reject(new Error('Aizo ring: timed out waiting for a response'))
        }
      }, timeoutMs)
      this._waiters.push(waiter)
    })
  }

  // This is a single request/response BLE channel — the ring only ever has
  // one command in flight. `syncAll()` fires several getters concurrently via
  // Promise.all for caller convenience, but without serializing here, two
  // overlapping requests of the same response `kind` (e.g. health-history for
  // "today" and "yesterday", both awaited independently) can cross-talk: a
  // response meant for one request satisfies whichever waiter's predicate
  // matches first, since predicates don't know which physical request
  // triggered which response. _enqueue makes every request/response cycle
  // atomic relative to every other one, regardless of caller.
  _enqueue(fn) {
    const run = () => Promise.resolve().then(fn)
    const result = this._txQueue.then(run, run)
    this._txQueue = result.then(() => {}, () => {})
    return result
  }

  // Common case: send `payload`, wait for one response matching `predicate`,
  // as a single serialized transaction.
  _request(predicate, payload, opts) {
    return this._enqueue(async () => {
      const p = this._wait(predicate, opts)
      await this._writeFrame(payload)
      return p
    })
  }

  // --- Bind / auth ---

  async bind() {
    const auth = await this._enqueue(async () => {
      const waitAuth = this._wait(
        (r, f) => f.payload[0] === 0x30 || f.cmd === 0x3039 || f.cmd === 0x7070,
        { timeoutMs: 8000, select: (r, f) => proto.parseAuth(f.payload) },
      )
      await this._writeFrame(proto.bindRequest('waven', { appId: loadAppId() }))
      return waitAuth
    })
    if (!auth || !auth.mac) throw new Error('Aizo ring: bind/auth failed (no MAC in response)')
    this.auth = auth
    return auth
  }

  // --- WearableDevice contract ---

  async getBattery() {
    const s = await this._request((r) => r.kind === 'status', proto.REQ.battery(), { select: (r) => r.data })
    return { level: s.battery, charging: false }
  }

  async getDeviceInfo() {
    return { name: this._name || 'Aizo Ring', model: 'aizo', firmware: 'unknown', hardware: 'unknown' }
  }

  // The protocol has no separate "set time" command distinct from bind — the
  // bind request always carries the current wall-clock time, so re-binding is
  // how the ring's clock gets (re)synced.
  async setTime(_date) {
    await this.bind()
  }

  // Returns { steps, calories, distance (metres) } for today — the ring only
  // exposes the current day's tally, not a `date`-addressable history.
  async getSteps(_date) {
    const s = await this._request((r) => r.kind === 'step', proto.REQ.step(), { select: (r) => r.data })
    if (!s) return { steps: 0, calories: 0, distance: 0 }
    return { steps: s.steps, calories: s.calories, distance: s.distanceMeters }
  }

  // Returns [{ value: bpm, timestamp }] for the given date (default: today),
  // derived from the health-history sync (the only source of stored HR).
  async getHeartRateLog(date) {
    const dayStr = _isoDateStr(date || new Date())
    const records = await this._getHealthHistoryCached(_dayMsFor(dayStr))
    return records.filter((r) => r.hr > 0).map((r) => ({ value: r.hr, timestamp: tsStr(r.timestamp) }))
  }

  // All cached HRV/stress readings across the last few days, oldest first —
  // same shape as halo's getHrvHistory(): [{ timestamp, hrv, stress, breath,
  // heartRate, highBP, lowBP }]. Aizo doesn't measure breath rate or blood
  // pressure, so those are always null.
  async getHrvHistory(daysBack) {
    const records = await this._getHealthHistoryRange(daysBack != null ? daysBack : 2)
    return records
      .filter((r) => r.hrv > 0 || r.stress > 0)
      .map((r) => ({ timestamp: tsStr(r.timestamp), hrv: r.hrv || null, stress: r.stress || null, breath: null, heartRate: r.hr || null, highBP: null, lowBP: null }))
  }

  // [{ timestamp, spo2 }], same convention as halo's getAutoSpo2History().
  async getAutoSpo2History(daysBack) {
    const records = await this._getHealthHistoryRange(daysBack != null ? daysBack : 2)
    return records.filter((r) => r.spo2 > 0).map((r) => ({ timestamp: tsStr(r.timestamp), spo2: r.spo2 }))
  }

  // [{ timestamp, estimatedBodyTemp, skinTemp, status }], same convention as
  // halo's getTemperatureHistory() (skinTemp mapped from the ring's ambient/
  // environment sensor since Aizo doesn't distinguish skin vs. shell temp).
  async getTemperatureHistory(daysBack) {
    const records = await this._getHealthHistoryRange(daysBack != null ? daysBack : 2)
    return records
      .filter((r) => r.bodyTemp != null)
      .map((r) => ({ timestamp: tsStr(r.timestamp), estimatedBodyTemp: r.bodyTemp, skinTemp: r.envTemp, status: null }))
  }

  // Raw health-history records for one day: [{ timestamp(ms), hr, hrv, spo2,
  // stress, bodyTemp, envTemp, step, sos }]. Exposed directly since it carries
  // more per-sample detail than any single WearableDevice contract method.
  async getHealthHistory(dateMs) {
    return this._getHealthHistoryCached(dateMs != null ? dateMs : proto.startOfTodayMs())
  }

  async _getHealthHistoryCached(dateMs) {
    const dayStr = _isoDateStr(new Date(dateMs))
    if (this._healthCache.has(dayStr)) return this._healthCache.get(dayStr)
    const records = await this._request((r) => r.kind === 'healthHistory', proto.REQ.getHealthData(dateMs), { select: (r) => r.data || [] })
    this._healthCache.set(dayStr, records)
    return records
  }

  async _getHealthHistoryRange(daysBack) {
    const dayMs = 86400000
    const out = []
    for (let i = 0; i <= daysBack; i++) {
      out.push(...await this._getHealthHistoryCached(Date.now() - i * dayMs))
    }
    return out.sort((a, b) => a.timestamp - b.timestamp)
  }

  // Sleep summary + stage detail for one day (default: today — the ring
  // returns whatever session most recently ended, usually last night's).
  // Returns null if nothing was recorded.
  async getSleepSummary(dateMs) {
    return this._request((r) => r.kind === 'sleepSummary', proto.REQ.getSleepData(dateMs != null ? dateMs : proto.startOfTodayMs()), { select: (r) => r.data })
  }

  async getSleepDetail(dateMs) {
    return this._request((r) => r.kind === 'sleepDetail', proto.REQ.getSleepDetail(dateMs != null ? dateMs : proto.startOfTodayMs()), { select: (r) => r.data || [] })
  }

  // [{ date, onset, totalMinutes, deep, light, rem, awake, sleepStart,
  //   sleepEnd, periods }], oldest first — same shape as halo's
  // getSleepHistory() elements. Queries today + yesterday since a session
  // that started before midnight is only returned by querying its start day.
  async getSleepHistory() {
    const dayMs = 86400000
    const sessions = []
    for (const dateMs of [Date.now(), Date.now() - dayMs]) {
      const summary = await this.getSleepSummary(dateMs).catch(() => null)
      if (!summary || !summary.totalMin) continue
      const detail = await this.getSleepDetail(dateMs).catch(() => [])
      const onset = tsStr(summary.start)
      // sleepStart/sleepEnd are minutes-after-midnight of the actual start/end
      // wall-clock times. Derived directly from summary.start/end rather than
      // sleepStart + totalMinutes — Aizo's totalMin is deep+light+rem *only*
      // (excludes awake), so that arithmetic would silently lose the awake
      // minutes from the wake-up time (wall-clock span = total + awake).
      const startOfDay = new Date(summary.start); startOfDay.setHours(0, 0, 0, 0)
      const sleepStart = Math.round((summary.start - startOfDay.getTime()) / 60000)
      const sleepEnd = Math.round((summary.end - startOfDay.getTime()) / 60000)
      // Stage-detail offsets are absolute minutes-from-midnight too (not
      // relative to sleepStart), so the last period's duration needs the
      // absolute end offset, not the deep+light+rem-only totalMin.
      const periods = _detailToPeriods(detail, sleepEnd)
      sessions.push({
        date: nightKey(onset),
        onset,
        totalMinutes: summary.totalMin,
        deep: summary.deepMin, light: summary.lightMin, rem: summary.remMin, awake: summary.awakeMin,
        sleepStart, sleepEnd,
        periods,
      })
    }
    // De-dupe (querying today/yesterday can return the same session twice)
    // and sort oldest first, matching halo's convention (caller uses .last).
    const seen = new Set()
    return sessions
      .filter((s) => (seen.has(s.onset) ? false : (seen.add(s.onset), true)))
      .sort((a, b) => (a.onset < b.onset ? -1 : 1))
  }

  // Returns the most recent night's summary (same shape as one
  // getSleepHistory() element).
  async getSleep() {
    const history = await this.getSleepHistory()
    if (!history.length) return { totalMinutes: 0, deep: 0, light: 0, rem: 0, awake: 0, periods: [], sleepStart: null, sleepEnd: null }
    return history[history.length - 1]
  }

  // type: 'heart-rate' | 'spo2' | 'hrv' | 'blood-pressure' | 'pressure' | 'blood-sugar' | 'temperature'
  // Only heart-rate/spo2/temperature spot-measure on this firmware — hrv/
  // pressure/blood-pressure/blood-sugar aren't supported (stress specifically
  // needs a sustained window and never returns from a spot request), so those
  // resolve to null immediately rather than waiting out a timeout.
  async getRealtime(type, timeoutMs) {
    const TYPE_MAP = { 'heart-rate': MEASURE_TYPE.HeartRate, spo2: MEASURE_TYPE.Spo2, temperature: MEASURE_TYPE.Temperature }
    const measureType = TYPE_MAP[type]
    if (!measureType) return null
    try {
      const r = await this.measure(measureType, { timeoutMs: timeoutMs || 35000 })
      if (!r.valid) return null
      return type === 'temperature' ? r.bodyTemp : r.value
    } catch (_) {
      return null
    }
  }

  // Lower-level on-demand measurement (spec §6.0). type: MEASURE_TYPE.*.
  async measure(type, opts) {
    opts = opts || {}
    const timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : 35000
    const REALTIME_KIND = { 1: 'heartRate', 2: 'bloodOxygen', 3: 'pressure', 6: 'temperature' }
    const kind = REALTIME_KIND[type]
    if (!kind) throw new Error(`Unknown measure type ${type}`)

    return this._enqueue(async () => {
      const ackWait = this._wait((r) => r.kind === 'measureAck', { timeoutMs: 5000, select: (r) => r.data })
      await this._writeFrame(proto.REQ.instantMeasure(type, 1))
      const ack = await ackWait
      if (!ack.started) throw new Error('Aizo ring: measurement did not start')

      const result = await this._wait(
        (r) => (r.kind === kind && r.mode === 'realtime') || (r.kind === 'measureDone' && r.data.type === type),
        { timeoutMs },
      )
      if (result.kind === 'measureDone') return { valid: result.data.valid, value: null }
      return { valid: result.valid !== false, value: result.data.value, timestamp: result.data.timestamp, bodyTemp: result.data.bodyTemp, envTemp: result.data.envTemp }
    })
  }

  // --- Auto-monitoring intervals (spec §6.0.1) ---

  async getMeasureInterval() {
    return this._request((r) => r.kind === 'measureInterval', proto.REQ.getMeasureInterval(), { select: (r) => r.data })
  }

  async setMeasureInterval(minutes) {
    await this._request((r) => r.kind === 'measureIntervalSet', proto.REQ.setMeasureInterval(minutes), { select: () => true })
    return this.getMeasureInterval()
  }

  async getStressInterval() {
    return this._request((r) => r.kind === 'stressInterval', proto.REQ.getStressInterval(), { select: (r) => r.data })
  }

  async setStressInterval(minutes) {
    await this._request((r) => r.kind === 'stressIntervalSet', proto.REQ.setStressInterval(minutes), { select: () => true })
    return this.getStressInterval()
  }

  // --- Sport / workout status (spec §7.8.3) ---

  async getSportStatus() {
    return this._request((r) => r.kind === 'sportStatus', proto.REQ.getSportStatus(), { select: (r) => r.data })
  }

  // --- Collect all data and build a WearableSnapshot (matches sync.js shape) ---

  async syncAll() {
    const [steps, sleepHistory, hrLog, hrvSlots, spo2Slots, tempSlots] = await Promise.all([
      this.getSteps().catch(() => ({ steps: 0, calories: 0, distance: 0 })),
      this.getSleepHistory().catch(() => []),
      this.getHeartRateLog().catch(() => []),
      this.getHrvHistory().catch(() => []),
      this.getAutoSpo2History().catch(() => []),
      this.getTemperatureHistory().catch(() => []),
    ])

    const sleep = sleepHistory.length ? sleepHistory[sleepHistory.length - 1] : null
    const hrEntries = hrLog.filter((r) => r.value > 0)
    const restingHr = hrEntries.length ? Math.min(...hrEntries.map((r) => r.value)) : null
    const latestHrv = hrvSlots.length ? hrvSlots[hrvSlots.length - 1] : {}
    const latestSpo2 = spo2Slots.length ? spo2Slots[spo2Slots.length - 1] : {}

    return {
      source: 'smart_ring',
      steps: steps.steps ?? null,
      calories: steps.calories ?? null,
      distance: steps.distance ?? null,
      stepSlots: null,
      sleepMinutes: sleep?.totalMinutes ?? null,
      sleepDeep: sleep?.deep ?? null,
      sleepLight: sleep?.light ?? null,
      sleepRem: sleep?.rem ?? null,
      sleepAwake: sleep?.awake ?? null,
      sleepStart: sleep?.sleepStart ?? null,
      sleepEnd: sleep?.sleepEnd ?? null,
      sleepSlots: sleep?.periods?.map((p) => ({ type: p.typeName, min: p.minutes })) ?? null,
      sleepHistory,
      hrSlots: hrEntries.map((r) => ({ t: r.timestamp, bpm: r.value })),
      restingHr,
      hrv: latestHrv.hrv ?? null,
      stress: latestHrv.stress ?? null,
      spo2: latestSpo2.spo2 ?? null,
      breathRate: null,
      heartRateFromHrv: latestHrv.heartRate ?? null,
      systolicBP: null,
      diastolicBP: null,
      hrvMeasuredAt: latestHrv.timestamp ?? null,
      hrvSlots: hrvSlots.length ? hrvSlots : null,
      spo2Slots: spo2Slots.length ? spo2Slots : null,
      tempSlots: tempSlots.length ? tempSlots : null,
      syncedAt: Date.now(),
    }
  }
}

// --- Private helpers ---

function _isoDateStr(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}
// "YYYY-MM-DD" -> epoch ms at local midnight (for re-querying a specific day).
function _dayMsFor(dayStr) {
  const [y, mo, d] = dayStr.split('-').map(Number)
  return new Date(y, mo - 1, d).getTime()
}

// Sleep-detail stage transitions -> [{ type, typeName, minutes }] consecutive
// periods, matching halo's period shape. `type` uses the same 0=Awake/1=Light/
// 2=Deep/3=REM numbering the rest of this codebase's sleep code expects
// (Aizo's own stage codes are 1=Deep/2=Light/3=Awake/4=NotWorn/5=REM — remapped
// here rather than downstream).
const STAGE_TO_TYPE = { 1: 2, 2: 1, 3: 0, 4: 0, 5: 3 }
const TYPE_NAME = { 0: 'awake', 1: 'light', 2: 'deep', 3: 'rem' }
// `endOffsetMin`: absolute minutes-from-midnight when the session ended
// (matches `detail[i].offsetMin`'s own frame of reference — both are absolute,
// NOT relative to sleep onset), used to size the final period.
function _detailToPeriods(detail, endOffsetMin) {
  if (!detail || !detail.length) return []
  const sorted = [...detail].sort((a, b) => a.offsetMin - b.offsetMin)
  const periods = []
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i]
    const next = sorted[i + 1]
    const minutes = next ? (next.offsetMin - cur.offsetMin) : Math.max(0, endOffsetMin - cur.offsetMin)
    const type = STAGE_TO_TYPE[cur.stage]
    if (type == null || minutes <= 0) continue
    periods.push({ type, typeName: TYPE_NAME[type], minutes })
  }
  return periods
}

module.exports = AizoRing
