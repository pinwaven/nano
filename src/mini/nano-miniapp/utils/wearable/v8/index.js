'use strict'

// V8 Smart Band adapter. See docs/architecture/v8-smart-band.md for the full
// protocol reference — read it before changing anything here, particularly
// §3 (per-notification reassembly, which is NOT the same model as Halo's
// _stream()) and §6 (known gaps this file deliberately leaves unfilled
// rather than guessing).
//
// Confirmed against real hardware (firmware 0.0.8.8) via tools/halo
// --device v8. This is a first pass: battery/time/MAC/firmware/auto-
// monitoring/steps/heart-rate/HRV/SpO2/temperature. Sleep stage codes
// (1,2,3,4,6,10 observed) do not match Halo's 0-3 enum and have not been
// confirmed against vendor docs — see getSleepHistory() below.

const { WearableDevice } = require('../index.js')
const { BLEManager } = require('../ble-manager.js')
const {
  SERVICE_UUID, WRITE_UUID, NOTIFY_UUID, NOTIFY_MAP,
  getBatteryPacket, setTimePacket, getTimePacket,
  setUserInfoPacket, getUserInfoPacket,
  getMacPacket, getVersionPacket,
  setFactoryResetPacket, setMcuResetPacket,
  setAutoMonitoringPacket, getAutoMonitoringPacket,
  getTotalStepDataPacket, getDetailActivityDataPacket,
  getSleepDataPacket,
  getDynamicHrDataPacket, getStaticHrDataPacket,
  getHrvTestDataPacket, getTemperatureHistoryPacket, getOxygenDataPacket,
  parseBcdDate, bcdToString, readLEInt,
} = require('./protocol.js')

class V8Band extends WearableDevice {
  constructor() {
    super()
    this._ble = new BLEManager()
    this._deviceId = null
  }

  async connect(deviceId, { syncTime = false } = {}) {
    this._deviceId = deviceId
    await this._ble.openAdapter()
    await this._ble.connect(deviceId, NOTIFY_MAP)
    if (syncTime) {
      try {
        const bandTime = await this.getDeviceTime()
        if (!bandTime || Math.abs(Date.now() - bandTime.getTime()) > 60000) {
          await this.setTime(new Date())
        }
      } catch (_) {}
    }
  }

  async disconnect() {
    await this._ble.disconnect()
    this._deviceId = null
  }

  // --- Device info ---

  async getBattery() {
    const r = await this._send(getBatteryPacket(), 0x13)
    return { level: r[1], charging: r[2] === 1 }
  }

  async getDeviceInfo() {
    let firmware = 'unknown'
    try { firmware = await this.getFirmwareVersion() } catch (_) {}
    return { name: 'V8 Smart Band', model: 'V8', firmware, hardware: 'unknown' }
  }

  async getDeviceTime() {
    const r = await this._send(getTimePacket(), 0x41)
    try {
      const dateStr = parseBcdDate(r, 1, true)
      return new Date(dateStr.replace(' ', 'T') + '+08:00')
    } catch (_) { return null }
  }

  async getMac() {
    const r = await this._send(getMacPacket(), 0x22)
    return Array.from(r.slice(1, 7)).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(':')
  }

  async getFirmwareVersion() {
    const r = await this._send(getVersionPacket(), 0x27)
    return [r[1], r[2], r[3], r[4]].map(b => b.toString(16).toUpperCase()).join('.')
  }

  async setTime(date) {
    await this._send(setTimePacket(date || new Date()), 0x01)
  }

  // profile: { gender: 'male'|'female', age, height (cm), weight (kg), stride (cm) }
  async setPersonalProfile(profile) {
    await this._send(setUserInfoPacket(profile), 0x02)
  }

  async getPersonalProfile() {
    const r = await this._send(getUserInfoPacket(), 0x42)
    return { gender: r[1] === 1 ? 'male' : 'female', age: r[2], height: r[3], weight: r[4], stride: r[5] }
  }

  // --- Auto-monitoring — confirmed identical layout to Halo via a live
  // write + read-back round trip (see docs/architecture/v8-smart-band.md §4) ---

  // settings: { workMode, startHour, startMinute, endHour, endMinute, weekdays, intervalMinutes, type }
  // type: 1=HR, 2=SpO2, 3=Temperature, 4=HRV
  async setAutoMonitoring(settings) {
    await this._send(setAutoMonitoringPacket(settings), 0x2A)
  }

  async getAutoMonitoring(type) {
    const r = await this._send(getAutoMonitoringPacket(type || 1), 0x2B)
    const pad = n => String(parseInt(bcdToString(n), 10)).padStart(2, '0')
    return {
      workMode:        r[1],
      startTime:       `${pad(r[2])}:${pad(r[3])}`,
      endTime:         `${pad(r[4])}:${pad(r[5])}`,
      weekdays:        r[6],
      intervalMinutes: readLEInt(r, 7, 2),
      type:            type || 1,   // not echoed by the device — pass through the request
    }
  }

  // --- Maintenance ---

  async factoryReset() {
    await this._send(setFactoryResetPacket(), 0x12)
  }

  async mcuReset() {
    await this._send(setMcuResetPacket(), 0x2E)
  }

  // --- History ---

  // Returns { steps, calories, distance (metres), slots: [{ t, steps, cal, dist }] }
  // for the given date (defaults to today). Combines the daily-totals (0x51)
  // and per-minute-detail (0x52) streams, matching HaloRing.getSteps()'s shape.
  async getSteps(date) {
    const todayStr = _isoDateStr(date || new Date())
    const totals = await this._streamRecords(getTotalStepDataPacket(), 0x51, _parseTotalStepChunk, 8000)
    const detail = await this._streamRecords(getDetailActivityDataPacket(), 0x52, _parseDetailActivityChunk, 8000).catch(() => [])
    const today = totals.find(r => r.date === todayStr)
    const slots = detail
      .filter(r => r.date.startsWith(todayStr) && r.step > 0)
      .map(r => ({ t: r.date.replace(' ', 'T') + '+08:00', steps: r.step, cal: r.calories, dist: r.distance * 1000 }))
    return {
      steps:    today ? today.step : 0,
      calories: today ? today.calories : 0,
      distance: today ? today.distance * 1000 : 0,   // km -> metres, matching Halo's snapshot convention
      slots,
    }
  }

  // Returns [{ value: bpm, timestamp: Date }] for the given date (defaults to today).
  async getHeartRateLog(date) {
    const todayStr = _isoDateStr(date || new Date())
    const records = await this._streamRecords(getStaticHrDataPacket(), 0x55, _parseStaticHrChunk, 8000)
    return records
      .filter(r => r.date.startsWith(todayStr) && r.heartRate > 0 && r.heartRate !== 0xFF)
      .map(r => ({ value: r.heartRate, timestamp: new Date(r.date.replace(' ', 'T') + '+08:00') }))
  }

  // Continuous HR: [{ date, hrSamples: [bpm, …] }] — not yet wired into the
  // sync flow (matching Halo's own "available but not called yet" methods).
  // Confirmed live to have a lot of history — pass a generous timeout.
  async getHeartRateHistory() {
    const records = await this._streamRecords(getDynamicHrDataPacket(), 0x54, _parseDynamicHrChunk, 25000)
    return records
      .map(r => ({ date: r.date, hrSamples: r.samples.filter(v => v > 0 && v !== 0xFF) }))
      .filter(r => r.hrSamples.length > 0)
  }

  // Returns all HRV records across cached days as
  // [{ timestamp, hrv, heartRate, stress, highBP, lowBP, vascularAging }],
  // sorted oldest-first. NOTE: `vascularAging` is not currently mapped to
  // any health_events field by sync.js (it has no `breath` equivalent for
  // V8 — the byte position Halo uses for breath rate carries a different
  // metric on V8) — exposed for completeness, not synced to the backend yet.
  async getHrvHistory() {
    const records = await this._streamRecords(getHrvTestDataPacket(), 0x56, _parseHrvChunk, 8000)
    return records.map(r => ({
      timestamp:     r.date,
      hrv:           r.hrv || null,
      vascularAging: r.vascularAging || null,
      heartRate:     r.heartRate || null,
      stress:        r.stress || null,
      highBP:        r.highBP || null,
      lowBP:         r.lowBP || null,
    }))
  }

  // Returns all auto-SpO2 records across cached days as [{ timestamp, spo2 }], oldest-first.
  async getAutoSpo2History() {
    const records = await this._streamRecords(getOxygenDataPacket(), 0x66, _parseOxygenChunk, 8000)
    return records
      .filter(r => r.spo2 > 0 && r.spo2 !== 0xFF)
      .map(r => ({ timestamp: r.date, spo2: r.spo2 }))
  }

  // Returns all cached temperature records as [{ date, estimatedBodyTemp, skinTemp, status }].
  // NOTE: V8's 0x62 record is a single combined temperature reading, not
  // Halo's 3-sensor NTC breakdown — there is no ambient/shell delta to
  // compute a status level from, so `status` is always null here (Halo's
  // _estimateBodyTemp() algorithm genuinely does not apply).
  async getTemperatureHistory() {
    const records = await this._streamRecords(getTemperatureHistoryPacket(), 0x62, _parseTemperatureChunk, 8000)
    return records.map(r => ({
      date: r.date,
      estimatedBodyTemp: r.temperature,
      skinTemp: r.temperature,
      status: null,
    }))
  }

  // Returns [{ date, onset, totalMinutes, deep: null, light: null, rem: null,
  //   awake: null, sleepStart, sleepEnd, periods: [] }], sorted oldest-first,
  // one entry per sleep session (same session-splitting rule as Halo:
  // a gap > 90 min between blocks starts a new session).
  //
  // deep/light/rem/awake breakdown is deliberately NOT computed: V8's raw
  // per-minute stage codes (1,2,3,4,6,10 observed live) don't match Halo's
  // confirmed 0=awake/1=deep/2=light/3=rem enum, and there's no vendor doc
  // confirming what V8's codes mean. Guessing the mapping would silently
  // mislabel real sleep-stage data — worse than leaving it null. Only
  // totalMinutes/onset/timing (pure arithmetic on block count, no semantic
  // assumption about individual stage values) are computed.
  async getSleepHistory() {
    const chunks = await this._streamSleepChunks(15000)
    const blocks = []
    for (const buf of chunks) blocks.push(..._parseSleepBlocks(buf))
    if (!blocks.length) return []

    const nightMap = {}
    for (const rec of blocks) {
      const key = _nightKey(rec.dateStr)
      ;(nightMap[key] = nightMap[key] || []).push(rec)
    }
    const nights = []
    for (const date of Object.keys(nightMap).sort()) {
      const recs = nightMap[date].sort((a, b) => (a.dateStr < b.dateStr ? -1 : 1))
      const sessions = [[recs[0]]]
      for (let i = 1; i < recs.length; i++) {
        const prev = recs[i - 1]
        const curr = recs[i]
        const prevEnd = _dateStrToAbsMins(prev.dateStr) + prev.stages.length * prev.unitMin
        const gap = _dateStrToAbsMins(curr.dateStr) - prevEnd
        if (gap > SPLIT_GAP_MINS) sessions.push([curr])
        else sessions[sessions.length - 1].push(curr)
      }
      for (const session of sessions) nights.push(_summariseNightDurationOnly(date, session))
    }
    return nights.sort((a, b) => (a.onset < b.onset ? -1 : 1))
  }

  async getSleep() {
    const history = await this.getSleepHistory()
    if (!history.length) {
      return { totalMinutes: 0, deep: null, light: null, rem: null, awake: null, periods: [], sleepStart: null, sleepEnd: null }
    }
    return history[history.length - 1]
  }

  // --- Internal helpers ---

  _send(packet, expectedCmdId, timeoutMs) {
    timeoutMs = timeoutMs || 3000
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._ble.onNotify(NOTIFY_UUID, null)
        reject(new Error(`V8 response timeout (cmd 0x${expectedCmdId.toString(16)})`))
      }, timeoutMs)

      this._ble.onNotify(NOTIFY_UUID, (data) => {
        if (data[0] === expectedCmdId) {
          clearTimeout(timer)
          this._ble.onNotify(NOTIFY_UUID, null)
          resolve(data)
        }
      })

      this._ble.write(this._deviceId, SERVICE_UUID, WRITE_UUID, packet)
        .catch((err) => { clearTimeout(timer); this._ble.onNotify(NOTIFY_UUID, null); reject(err) })
    })
  }

  // Unlike Halo's _stream() (which concatenates raw notification bytes into
  // one buffer), V8 parses each notification independently — a single
  // notification can hold several stacked records thanks to the negotiated
  // MTU (~244 bytes, confirmed live). `parseChunk(data) => { records, done }`
  // runs per-notification; this accumulates the *parsed records*, not raw
  // bytes. On timeout, resolves with whatever accumulated instead of
  // rejecting (same partial-result philosophy as Halo) — only rejects if
  // nothing came back at all. See docs/architecture/v8-smart-band.md §3.
  _streamRecords(packet, expectedCmdId, parseChunk, timeoutMs) {
    timeoutMs = timeoutMs || 8000
    return new Promise((resolve, reject) => {
      let records = []
      let gotAny = false

      const timer = setTimeout(() => {
        this._ble.onNotify(NOTIFY_UUID, null)
        if (!gotAny) {
          reject(new Error(`V8 stream timeout (cmd 0x${expectedCmdId.toString(16)}), no data received`))
          return
        }
        console.log(JSON.stringify({ level: 'WARN', msg: 'V8 stream timed out, returning partial data', cmd: `0x${expectedCmdId.toString(16)}`, records: records.length }))
        resolve(records)
      }, timeoutMs)

      this._ble.onNotify(NOTIFY_UUID, (data) => {
        if (data[0] !== expectedCmdId) return
        gotAny = true
        const { records: chunkRecords, done } = parseChunk(data)
        records = records.concat(chunkRecords)
        if (done) {
          clearTimeout(timer)
          this._ble.onNotify(NOTIFY_UUID, null)
          resolve(records)
        }
      })

      this._ble.write(this._deviceId, SERVICE_UUID, WRITE_UUID, packet)
        .catch((err) => { clearTimeout(timer); this._ble.onNotify(NOTIFY_UUID, null); reject(err) })
    })
  }

  // Sleep needs the raw per-notification buffers (not pre-parsed records)
  // because block extraction depends on whether a notification is the
  // single 130-byte 1-min-record shape or stacked 34-byte 5-min records —
  // see _parseSleepBlocks(). Terminator: last 2 bytes of a notification are
  // [0x53, 0xFF] (same convention as Halo).
  _streamSleepChunks(timeoutMs) {
    return new Promise((resolve, reject) => {
      const chunks = []

      const timer = setTimeout(() => {
        this._ble.onNotify(NOTIFY_UUID, null)
        if (!chunks.length) {
          reject(new Error('V8 sleep stream timeout, no data received'))
          return
        }
        resolve(chunks)
      }, timeoutMs)

      this._ble.onNotify(NOTIFY_UUID, (data) => {
        if (data[0] !== 0x53) return
        chunks.push(data)
        const n = data.length
        const done = n >= 2 && data[n - 2] === 0x53 && data[n - 1] === 0xFF
        if (done) {
          clearTimeout(timer)
          this._ble.onNotify(NOTIFY_UUID, null)
          resolve(chunks)
        }
      })

      this._ble.write(this._deviceId, SERVICE_UUID, WRITE_UUID, getSleepDataPacket())
        .catch((err) => { clearTimeout(timer); this._ble.onNotify(NOTIFY_UUID, null); reject(err) })
    })
  }
}

// --- Private parsing helpers (one raw notification buffer -> { records, done }) ---

function getStepRecordSize(length) {
  if (length === 2) return 27
  if (length % 26 === 0) return 26
  if (length % 27 === 0) return 27
  if ((length - 2) % 26 === 0) return 26
  if ((length - 2) % 27 === 0) return 27
  return 27
}

// 0x51 — daily activity totals
function _parseTotalStepChunk(buf) {
  const length = buf.length
  const count = getStepRecordSize(length)
  const size = Math.floor(length / count)
  const records = []
  let done = false
  for (let i = 0; i < size; i++) {
    const base = i * count
    const flag = 1 + (i + 1) * count
    if (flag < length && buf[flag] === 0xff) done = true
    const date = `20${bcdToString(buf[2 + base])}-${bcdToString(buf[3 + base])}-${bcdToString(buf[4 + base])}`
    const step = readLEInt(buf, 5 + base, 4)
    const exerciseMinutes = readLEInt(buf, 9 + base, 4)
    const distance = readLEInt(buf, 13 + base, 4)
    const calories = readLEInt(buf, 17 + base, 4)
    records.push({ date, step, exerciseMinutes, distance: distance / 100, calories: calories / 100 })
  }
  if (size === 0) done = true
  return { records, done }
}

// 0x52 — per-minute activity detail
function _parseDetailActivityChunk(buf) {
  const length = buf.length
  const count = 25
  const size = Math.floor(length / count)
  const records = []
  const done = size === 0 || buf[length - 1] === 0xff
  for (let i = 0; i < size; i++) {
    const base = i * count
    const date = parseBcdDate(buf, 3 + base, true)
    const step = readLEInt(buf, 9 + base, 2)
    const calories = readLEInt(buf, 11 + base, 2)
    const distance = readLEInt(buf, 13 + base, 2)
    records.push({ date, step, calories: calories / 100, distance: distance / 100 })
  }
  return { records, done }
}

// 0x54 — continuous HR
function _parseDynamicHrChunk(buf) {
  const length = buf.length
  const count = 24
  const size = Math.floor(length / count)
  const records = []
  const done = size === 0 || buf[length - 1] === 0xff
  for (let i = 0; i < size; i++) {
    const base = i * count
    const date = parseBcdDate(buf, 3 + base, true)
    const samples = []
    for (let j = 0; j < 15; j++) samples.push(buf[9 + j + base])
    records.push({ date, samples })
  }
  return { records, done }
}

// 0x55 — static HR
function _parseStaticHrChunk(buf) {
  const length = buf.length
  const count = 10
  const size = Math.floor(length / count)
  const records = []
  const done = size === 0 || buf[length - 1] === 0xff
  for (let i = 0; i < size; i++) {
    const base = i * count
    const date = parseBcdDate(buf, 3 + base, true)
    records.push({ date, heartRate: buf[9 + base] })
  }
  return { records, done }
}

// 0x56 — HRV + stress + BP. Field positions confirmed live: highBP/lowBP
// decode to realistic paired BP values (~120-129/70-72).
function _parseHrvChunk(buf) {
  const length = buf.length
  const count = 15
  const size = Math.floor(length / count)
  const records = []
  const done = size === 0 || buf[length - 1] === 0xff
  for (let i = 0; i < size; i++) {
    const base = i * count
    const date = parseBcdDate(buf, 3 + base, true)
    records.push({
      date,
      hrv: buf[9 + base],
      vascularAging: buf[10 + base],
      heartRate: buf[11 + base],
      stress: buf[12 + base],
      highBP: buf[13 + base],
      lowBP: buf[14 + base],
    })
  }
  return { records, done }
}

// 0x62 — temperature (single combined value, not 3-sensor NTC like Halo)
function _parseTemperatureChunk(buf) {
  const length = buf.length
  const count = 11
  const size = Math.floor(length / count)
  const records = []
  const done = size === 0 || buf[length - 1] === 0xff
  for (let i = 0; i < size; i++) {
    const base = i * count
    const date = parseBcdDate(buf, 3 + base, true)
    const tempRaw = readLEInt(buf, 9 + base, 2)
    records.push({ date, temperature: tempRaw / 10 })
  }
  return { records, done }
}

// 0x66 — auto SpO2
function _parseOxygenChunk(buf) {
  const length = buf.length
  const count = 10
  const size = Math.floor(length / count)
  const records = []
  const done = size === 0 || buf[length - 1] === 0xff
  for (let i = 0; i < size; i++) {
    const base = i * count
    const date = parseBcdDate(buf, 3 + base, true)
    records.push({ date, spo2: buf[9 + base] })
  }
  return { records, done }
}

// 0x53 — sleep. Handles both shapes seen in the vendor source: a single
// 130-byte 1-min-record notification, or stacked 34-byte 5-min records
// within one notification (analogous to Halo's two shapes, but per-
// notification rather than per-concatenated-stream — see file header).
function _parseSleepBlocks(buf) {
  const length = buf.length
  const endMarker = length >= 2 && buf[length - 1] === 0xff && buf[length - 2] === 0x53

  if (length === 130 || (endMarker && length === 132)) {
    const dateStr = parseBcdDate(buf, 3, true)
    const sleepLength = buf[9]
    const stages = Array.from(buf.slice(10, 10 + sleepLength))
    return stages.length ? [{ dateStr, unitMin: 1, stages }] : []
  }

  const count = 34
  const size = Math.floor(length / count)
  const blocks = []
  for (let i = 0; i < size; i++) {
    const base = i * count
    const dateStr = parseBcdDate(buf, 3 + base, true)
    const sleepLength = buf[9 + base]
    const stages = Array.from(buf.slice(10 + base, 10 + base + sleepLength))
    if (stages.length) blocks.push({ dateStr, unitMin: 5, stages })
  }
  return blocks
}

// Maps a block timestamp to its night label — before noon belongs to the
// previous calendar day (overnight tail). Identical rule to Halo's _nightKey.
const _DAYS_IN_MONTH = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
function _nightKey(dateStr) {
  const [dp, tp] = dateStr.split(' ')
  if (parseInt(tp, 10) >= 12) return dp
  const [y, mo, d] = dp.split('-').map(Number)
  let dd = d - 1, mm = mo, yy = y
  if (dd < 1) {
    if (--mm < 1) { mm = 12; yy-- }
    dd = (mm === 2 && (yy % 4 === 0 && (yy % 100 !== 0 || yy % 400 === 0))) ? 29 : _DAYS_IN_MONTH[mm]
  }
  return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
}

// "YYYY-MM-DD HH:MM:SS" -> absolute minutes via Date.UTC (timezone-safe).
function _dateStrToAbsMins(dateStr) {
  const [dp, tp] = dateStr.split(' ')
  const [y, mo, d] = dp.split('-').map(Number)
  const [h, m] = tp.split(':').map(Number)
  return Date.UTC(y, mo - 1, d, h, m) / 60000
}

// Blocks separated by more than this are treated as separate sleep sessions.
const SPLIT_GAP_MINS = 90

// Duration/timing only — no stage-type breakdown, see getSleepHistory()'s comment.
function _summariseNightDurationOnly(date, records) {
  const unitMin = records[0].unitMin
  const totalMinutes = records.reduce((s, r) => s + r.stages.length * unitMin, 0)
  const timePart = records[0].dateStr.slice(records[0].dateStr.indexOf(' ') + 1)
  const colonIdx = timePart.indexOf(':')
  const hh = parseInt(timePart.slice(0, colonIdx), 10)
  const mm = parseInt(timePart.slice(colonIdx + 1, colonIdx + 3), 10)
  const sleepStart = hh * 60 + mm
  const sleepEnd = sleepStart + totalMinutes
  return {
    date, onset: records[0].dateStr, totalMinutes,
    deep: null, light: null, rem: null, awake: null,
    sleepStart, sleepEnd, periods: [],
  }
}

function _isoDateStr(date) {
  const OFFSET_MS = 8 * 60 * 60 * 1000
  const d = new Date((date ? date.getTime() : Date.now()) + OFFSET_MS)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

module.exports = V8Band
