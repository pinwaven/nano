'use strict'

const { WearableDevice } = require('../index.js')
const { BLEManager }     = require('../ble-manager.js')
const {
  BLE_SERVICE_UUID, WRITE_UUID, NOTIFY_UUID,
  buildFrame, parseFrame,
  getBindRequest, getWatchInfoRequest,
  getStepInfoRequest, getSleepInfoRequest,
  getPressureRequest, getHeartRateRequest,
  parseDeviceStatus, parseStepInfo, parseSleepDetail, parsePressure,
} = require('./protocol.js')

const NOTIFY_MAP = {
  [BLE_SERVICE_UUID]: { txCharUUID: NOTIFY_UUID, rxCharUUID: WRITE_UUID },
}

class AizoRing extends WearableDevice {
  constructor() {
    super()
    this._ble      = new BLEManager()
    this._deviceId = null
    this._name     = null
  }

  // Scan for Aizo rings by service UUID. Returns [{ deviceId, name, rssi }].
  static async scan(timeoutMs) {
    const mgr = new BLEManager()
    await mgr.openAdapter()
    try {
      return await mgr.scan(null, timeoutMs || 8000, [BLE_SERVICE_UUID])
    } finally {
      await mgr.closeAdapter()
    }
  }

  // opts: string (name) or { name, syncTime } — matches x3 call convention
  async connect(deviceId, opts) {
    if (typeof opts === 'string') opts = { name: opts }
    opts = opts || {}
    this._deviceId = deviceId
    this._name     = opts.name || 'Aizo Ring'
    await this._ble.openAdapter()
    await this._ble.connect(deviceId, NOTIFY_MAP)
    // Bind/auth handshake required before querying data
    await this._send(getBindRequest('waven'), 0x30, 6000)
  }

  async disconnect() {
    await this._ble.disconnect()
    this._deviceId = null
    this._name     = null
  }

  async getBattery() {
    const frame = await this._send(getWatchInfoRequest(2), 0x38)
    try {
      const s = parseDeviceStatus(frame.payload)
      return { level: s.batteryPercent, charging: false }
    } catch (_) { return { level: 0, charging: false } }
  }

  async getDeviceInfo() {
    return { name: this._name || 'Aizo Ring', model: 'aizo', firmware: 'unknown', hardware: 'unknown' }
  }

  async setTime(_date) {
    // Re-issue bind request — it always sends current time
    try { await this._send(getBindRequest('waven'), 0x30, 6000) } catch (_) {}
  }

  async getSteps(_date) {
    const frame = await this._send(getStepInfoRequest(), 0x33)
    try {
      const r = parseStepInfo(frame.payload)
      return { steps: r.steps, calories: r.calories, distance: Math.round(r.distance * 1000) }
    } catch (_) { return { steps: 0, calories: 0, distance: 0 } }
  }

  // Returns one night's aggregated sleep summary
  async getSleep() {
    const frames = await this._streamFrames(getSleepInfoRequest(), 0x35, 8000)
    return _aggregateSleep(frames)
  }

  // Returns [{ timestamp, stress (0-99) }] from history pressure response
  async getHrvHistory() {
    try {
      const frame = await this._send(getPressureRequest(), 0x31, 8000)
      const r = parsePressure(frame.payload)
      if (r.type === 'history') {
        return r.records.map(rec => ({ timestamp: rec.timestamp, stress: rec.value }))
      }
      if (r.type === 'realtime') {
        return [{ timestamp: r.timestamp, stress: r.value }]
      }
    } catch (_) {}
    return []
  }

  // Returns [{ value: bpm, timestamp: string }]
  async getHeartRateLog(_date) {
    try {
      const frame = await this._send(getHeartRateRequest(), 0x31, 8000)
      return _parseHrResponse(frame.payload)
    } catch (_) { return [] }
  }

  async getRealtime(_type) {
    // Real-time on-demand measurements not specified in current SDK docs
    return null
  }

  // Collect all data and build a WearableSnapshot (matches sync.js shape)
  async syncAll(_date) {
    const [battery, steps, sleep, hrv] = await Promise.allSettled([
      this.getBattery(),
      this.getSteps(),
      this.getSleep(),
      this.getHrvHistory(),
    ])

    const stepsData = steps.status === 'fulfilled' ? steps.value   : {}
    const sleepData = sleep.status === 'fulfilled' ? sleep.value   : {}
    const hrvList   = hrv.status   === 'fulfilled' ? hrv.value     : []

    const lastHrv = hrvList.length ? hrvList[hrvList.length - 1] : null

    return {
      source:           'smart_ring',
      steps:            stepsData.steps     ?? null,
      calories:         stepsData.calories  ?? null,
      distance:         stepsData.distance  ?? null,
      stepSlots:        [],
      sleepMinutes:     sleepData.totalMinutes ?? null,
      sleepDeep:        sleepData.deep         ?? null,
      sleepLight:       sleepData.light        ?? null,
      sleepRem:         sleepData.rem          ?? null,
      sleepAwake:       sleepData.awake        ?? null,
      sleepStart:       sleepData.sleepStart   ?? null,
      sleepEnd:         sleepData.sleepEnd     ?? null,
      sleepSlots:       sleepData.periods      ?? null,
      hrSlots:          [],
      restingHr:        null,
      hrv:              null,
      stress:           lastHrv?.stress        ?? null,
      spo2:             null,
      breathRate:       null,
      heartRateFromHrv: null,
      systolicBP:       null,
      diastolicBP:      null,
      hrvMeasuredAt:    lastHrv?.timestamp     ?? null,
      hrvSlots:         null,
      spo2Slots:        null,
      syncedAt:         Date.now(),
    }
  }

  // --- BLE primitives ---

  // Send a packet and wait for one response frame with matching cmdId.
  _send(packet, expectedCmdId, timeoutMs) {
    timeoutMs = timeoutMs || 5000
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._ble.onNotify(NOTIFY_UUID, null)
        reject(new Error(`Aizo timeout (cmd 0x${expectedCmdId.toString(16)})`))
      }, timeoutMs)

      this._ble.onNotify(NOTIFY_UUID, (data) => {
        try {
          const frame = parseFrame(data)
          if (!frame) return
          if (frame.cmdId === expectedCmdId) {
            clearTimeout(timer)
            this._ble.onNotify(NOTIFY_UUID, null)
            resolve(frame)
          }
        } catch (_) {}
      })

      this._ble.write(this._deviceId, BLE_SERVICE_UUID, WRITE_UUID, packet)
        .catch((err) => { clearTimeout(timer); this._ble.onNotify(NOTIFY_UUID, null); reject(err) })
    })
  }

  // Send a packet and collect multiple response frames with matching cmdId.
  // Resolves after `silenceMs` of no new frames (default 2 s).
  _streamFrames(packet, expectedCmdId, timeoutMs, silenceMs) {
    timeoutMs = timeoutMs || 10000
    silenceMs = silenceMs || 2000
    return new Promise((resolve, reject) => {
      const frames = []
      let hardTimer   = null
      let silenceTimer = null

      const finish = () => {
        clearTimeout(hardTimer)
        clearTimeout(silenceTimer)
        this._ble.onNotify(NOTIFY_UUID, null)
        resolve(frames)
      }

      hardTimer = setTimeout(() => {
        this._ble.onNotify(NOTIFY_UUID, null)
        // Resolve with whatever we collected rather than rejecting
        clearTimeout(silenceTimer)
        resolve(frames)
      }, timeoutMs)

      const resetSilence = () => {
        clearTimeout(silenceTimer)
        silenceTimer = setTimeout(finish, silenceMs)
      }

      this._ble.onNotify(NOTIFY_UUID, (data) => {
        try {
          const frame = parseFrame(data)
          if (!frame || frame.cmdId !== expectedCmdId) return
          frames.push(frame)
          resetSilence()
        } catch (_) {}
      })

      this._ble.write(this._deviceId, BLE_SERVICE_UUID, WRITE_UUID, packet)
        .catch((err) => { clearTimeout(hardTimer); clearTimeout(silenceTimer); this._ble.onNotify(NOTIFY_UUID, null); reject(err) })
    })
  }
}

// --- Private helpers ---

// Group sleep event frames into one night summary.
// Aizo sleep modes: 0=Awake 1=Light 2=Deep 3=REM
function _aggregateSleep(frames) {
  const empty = { totalMinutes: 0, deep: 0, light: 0, rem: 0, awake: 0, sleepStart: null, sleepEnd: null, periods: [] }
  if (!frames.length) return empty

  // Parse and sort all sleep events by offsetMinutes
  const events = []
  for (const f of frames) {
    try {
      const r = parseSleepDetail(f.payload)
      events.push(r)
    } catch (_) {}
  }
  if (!events.length) return empty

  events.sort((a, b) => a.offsetMinutes - b.offsetMinutes)

  // Tally minutes per stage
  // Each event marks the start of a new stage; duration = next event offset - this offset
  let deep = 0, light = 0, rem = 0, awake = 0
  const periods = []
  const modeNames = { 0: 'awake', 1: 'light', 2: 'deep', 3: 'rem' }

  for (let i = 0; i < events.length; i++) {
    const e    = events[i]
    const next = events[i + 1]
    const dur  = next ? (next.offsetMinutes - e.offsetMinutes) : 30 // assume 30 min for last event
    if (e.sleepMode === 0) awake += dur
    if (e.sleepMode === 1) light += dur
    if (e.sleepMode === 2) deep  += dur
    if (e.sleepMode === 3) rem   += dur
    periods.push({ type: e.sleepMode, typeName: modeNames[e.sleepMode] || 'unknown', minutes: dur })
  }

  const totalMinutes = deep + light + rem + awake
  const sleepStart   = events[0].offsetMinutes
  const sleepEnd     = sleepStart + totalMinutes

  return { totalMinutes, deep, light, rem, awake, sleepStart, sleepEnd, periods }
}

// Parse a heart rate history response payload.
// Format is undocumented; best-effort: look for 6-byte timestamp + 1-byte bpm records.
function _parseHrResponse(payload) {
  if (!payload || payload.length < 7) return []
  const results = []
  const pad = n => String(n).padStart(2, '0')
  // Try 7-byte stride: [Y%100, Mo, D, H, Min, S, bpm]
  const stride = 7
  for (let off = 0; off + stride <= payload.length; off += stride) {
    const year = payload[off] + 2000
    const mon  = payload[off + 1]
    const day  = payload[off + 2]
    const hr   = payload[off + 3]
    const min  = payload[off + 4]
    const sec  = payload[off + 5]
    const bpm  = payload[off + 6]
    if (bpm < 30 || bpm > 220) continue  // sanity check
    results.push({
      value:     bpm,
      timestamp: `${year}-${pad(mon)}-${pad(day)} ${pad(hr)}:${pad(min)}:${pad(sec)}`,
    })
  }
  return results
}

module.exports = AizoRing
