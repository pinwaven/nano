'use strict'

const { WearableDevice } = require('../index.js')
const { BLEManager } = require('../ble-manager.js')
const {
  SERVICE_UUID, WRITE_UUID, NOTIFY_UUID, NOTIFY_MAP, X3_NAME_PREFIXES,
  getBatteryPacket, setTimePacket, getTimePacket,
  setPersonalProfilePacket, getPersonalProfilePacket,
  getMacPacket, getVersionPacket,
  setFactoryResetPacket, setMcuResetPacket,
  setBasicParametersPacket, getBasicParametersPacket,
  setAutoMonitoringPacket, getAutoMonitoringPacket,
  setRealTimeControlPacket,
  getDailyActivitySummaryPacket, getDetailActivityPacket,
  getSleepHistoryPacket,
  getContinuousHeartRateHistoryPacket, getStaticHeartRateHistoryPacket,
  getHrvHistoryPacket,
  getSpo2DetailHistoryPacket, getAutoSpo2HistoryPacket,
  getSleepHrvHistoryPacket, getTemperatureHistoryPacket,
  getExerciseSessionsPacket, getOxygenVariationPacket, getSleepApneaPacket,
  getSleepTemperatureHistoryPacket,
  setMeasurementWithTypePacket,
  ppgControlPacket, setPpgStreamPacket,
  enterActivityModePacket, queryActivityModePacket, sendActivityHeartbeatPacket,
  parseBcdDate, bcdToString, readLEInt, readFloat32LE,
} = require('./protocol.js')

class X3Ring extends WearableDevice {
  constructor() {
    super()
    this._ble = new BLEManager()
    this._deviceId = null
    this._cachedHrvResult = null  // { hrv?, stress? } — arrive together in 0x28 response
    this._ppgSamples = []         // accumulates raw PPG samples during a glucose session
  }

  // Scan for X3 rings nearby. Returns [{ deviceId, name, rssi }].
  static async scan(timeoutMs) {
    const mgr = new BLEManager()
    await mgr.openAdapter()
    try {
      return await mgr.scan(X3_NAME_PREFIXES, timeoutMs || 8000)
    } finally {
      await mgr.closeAdapter()
    }
  }

  async connect(deviceId, { syncTime = false } = {}) {
    this._deviceId = deviceId
    await this._ble.openAdapter()
    await this._ble.connect(deviceId, NOTIFY_MAP)
    if (syncTime) {
      try { await this.setTime(new Date()) } catch (_) {}
    }
  }

  async disconnect() {
    await this._ble.disconnect()
    this._deviceId = null
    this._cachedHrvResult = null
  }

  // --- Device info ---

  async getBattery() {
    const r = await this._send(getBatteryPacket(), 0x13)
    return { level: r[1], charging: r[2] === 1 }
  }

  async getDeviceInfo() {
    return { name: 'X3 Smart Ring', model: 'X3', firmware: 'unknown', hardware: 'unknown' }
  }

  // Returns the ring's current clock as a Date (or null on failure)
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
    return `${r[1]}.${r[2]}.${r[3]}.${r[4]}`
  }

  async setTime(date) {
    await this._send(setTimePacket(date || new Date()), 0x01)
  }

  // --- Ring configuration ---

  // rightHand: boolean, autoMotion: boolean
  async setBasicParameters(rightHand, autoMotion) {
    await this._send(setBasicParametersPacket(rightHand, autoMotion), 0x03)
  }

  // Returns { rightHand: bool, autoMotion: bool, eov: number }
  async getBasicParameters() {
    const r = await this._send(getBasicParametersPacket(), 0x04)
    return {
      rightHand:  r[3] === 0x81,
      autoMotion: r[4] === 0x81,
      eov:        r[10],
    }
  }

  // profile: { gender: 'male'|'female', age, height (cm), weight (kg), stride (cm) }
  async setPersonalProfile(profile) {
    await this._send(setPersonalProfilePacket(profile), 0x02)
  }

  // Returns { gender: 'male'|'female', age, height, weight, stride }
  async getPersonalProfile() {
    const r = await this._send(getPersonalProfilePacket(), 0x42)
    return {
      gender: r[1] === 1 ? 'male' : 'female',
      age:    r[2],
      height: r[3],
      weight: r[4],
      stride: r[5],
    }
  }

  // settings: { workMode, startHour, startMinute, endHour, endMinute, weekdays, intervalMinutes, type }
  // type: 1=HR, 2=SpO2, 3=Temperature, 4=HRV
  async setAutoMonitoring(settings) {
    await this._send(setAutoMonitoringPacket(settings), 0x2A)
  }

  // type: 1=HR, 2=SpO2, 3=Temperature, 4=HRV
  // Returns { workMode, startTime, endTime, weekdays, intervalMinutes, type }
  async getAutoMonitoring(type) {
    const r = await this._send(getAutoMonitoringPacket(type || 1), 0x2B)
    const pad = n => String(parseInt(bcdToString(n), 10)).padStart(2, '0')
    return {
      workMode:        r[1],
      startTime:       `${pad(r[2])}:${pad(r[3])}`,
      endTime:         `${pad(r[4])}:${pad(r[5])}`,
      weekdays:        r[6],
      intervalMinutes: readLEInt(r, 7, 2),
      type:            r[9],
    }
  }

  // --- Maintenance ---

  async factoryReset() {
    await this._send(setFactoryResetPacket(), 0x12)
  }

  async mcuReset() {
    await this._send(setMcuResetPacket(), 0x2E)
  }

  // --- History: already-implemented data types ---

  // Returns [{ value: bpm, timestamp: Date }] for today (or the given date)
  async getHeartRateLog(date) {
    const todayStr = _isoDateStr(date || new Date())
    const buf = await this._stream(
      getStaticHeartRateHistoryPacket(),
      0x55,
      (acc) => acc.length > 0 && acc[acc.length - 1] === 0xFF,
      8000,
    )
    return _parseHrLog55(buf, todayStr)
  }

  // Returns { hrv, stress } from today's most recent HRV history record
  async getHrvLog(date) {
    const todayStr = _isoDateStr(date || new Date())
    const buf = await this._stream(
      getHrvHistoryPacket(),
      0x56,
      (acc) => acc.length > 0 && acc[acc.length - 1] === 0xFF,
      8000,
    )
    return _parseHrvLog56(buf, todayStr)
  }

  // Returns today's most recent SpO2 value (%) from auto-SpO2 history
  async getSpo2Log(date) {
    const todayStr = _isoDateStr(date || new Date())
    const buf = await this._stream(
      getAutoSpo2HistoryPacket(),
      0x66,
      (acc) => acc.length > 0 && acc[acc.length - 1] === 0xFF,
      8000,
    )
    return _parseSpo2Log66(buf, todayStr)
  }

  // Returns { steps, calories, distance (metres), slots: [{ t, steps, cal, dist }] }
  async getSteps(date) {
    const todayStr = _isoDateStr(date || new Date())
    const buf51 = await this._stream(
      getDailyActivitySummaryPacket(),
      0x51,
      (acc) => acc.length > 0 && acc[acc.length - 1] === 0xFF,
      8000,
    )
    const buf52 = await this._stream(
      getDetailActivityPacket(),
      0x52,
      (acc) => acc.length > 0 && acc[acc.length - 1] === 0xFF,
      8000,
    ).catch(() => null)
    return _parseSteps(buf51, buf52, todayStr)
  }

  // Returns { totalMinutes, deep, light, rem, awake, periods, sleepStart, sleepEnd }
  async getSleep() {
    const buf = await this._stream(
      getSleepHistoryPacket(),
      0x53,
      (acc) => {
        const n = acc.length
        return n >= 2 && acc[n - 2] === 0x53 && acc[n - 1] === 0xFF
      },
      12000,
    )
    return _parseSleep53(buf)
  }

  // --- History: new data types ---

  // Continuous (dynamic) HR: [{ date, hrSamples: [bpm, …] }] — 15 samples per ~15-minute window
  async getHeartRateHistory(date) {
    const todayStr = _isoDateStr(date || new Date())
    const buf = await this._stream(
      getContinuousHeartRateHistoryPacket(),
      0x54,
      (acc) => acc.length > 0 && acc[acc.length - 1] === 0xFF,
      10000,
    )
    return _parseHrHistory54(buf, todayStr)
  }

  // Detailed SpO2: [{ date, samples: [%, …] }] — 20 values × 30 s per record
  async getSpo2History(date) {
    const todayStr = _isoDateStr(date || new Date())
    const buf = await this._stream(
      getSpo2DetailHistoryPacket(),
      0x57,
      (acc) => acc.length > 0 && acc[acc.length - 1] === 0xFF,
      8000,
    )
    return _parseSpo2History57(buf, todayStr)
  }

  // Sleep HRV/RMSSD: [{ date, rmssd: [ms, …] }] — 30 per-period samples per night
  async getSleepHrv(date) {
    const todayStr = _isoDateStr(date || new Date())
    const buf = await this._stream(
      getSleepHrvHistoryPacket(),
      0x60,
      (acc) => acc.length > 0 && acc[acc.length - 1] === 0xFF,
      10000,
    )
    return _parseSleepHrv60(buf, todayStr)
  }

  // Skin/body temperature: [{ date, skinTemp, ambientTemp, shellTemp, estimatedBodyTemp, status }]
  async getTemperatureLog(date) {
    const todayStr = _isoDateStr(date || new Date())
    const buf = await this._stream(
      getTemperatureHistoryPacket(),
      0x62,
      (acc) => acc.length > 0 && acc[acc.length - 1] === 0xFF,
      8000,
    )
    return _parseTempLog62(buf, todayStr)
  }

  // Exercise sessions: [{ date, sportMode, avgHeartRate, durationSec, steps, paceMin, paceSec, calories, distanceKm }]
  async getExerciseSessions(date) {
    const todayStr = _isoDateStr(date || new Date())
    const buf = await this._stream(
      getExerciseSessionsPacket(),
      0x5C,
      (acc) => acc.length > 0 && acc[acc.length - 1] === 0xFF,
      10000,
    )
    return _parseExercise5C(buf, todayStr)
  }

  // Sleep apnea risk: [{ date, riskLevel }]  riskLevel: 16=no result, 0/1=low, 2=mild, 3=severe
  async getSleepApneaRisk(date) {
    const todayStr = _isoDateStr(date || new Date())
    const buf = await this._stream(
      getSleepApneaPacket(),
      0x5F,
      (acc) => acc.length > 0 && acc[acc.length - 1] === 0xFF,
      8000,
    )
    return _parseSleepApnea5F(buf, todayStr)
  }

  // Sleep body temperature: [{ date, samples: [{ skinTemp, ambientTemp, shellTemp, estimatedBodyTemp, status }] }]
  // 69-byte records, 10 NTC-triples per record (each triple = 3 × 2-byte LE ÷ 10 = °C)
  async getSleepTemperatureLog(date) {
    const todayStr = _isoDateStr(date || new Date())
    const buf = await this._stream(
      getSleepTemperatureHistoryPacket(),
      0x69,
      (acc) => acc.length > 0 && acc[acc.length - 1] === 0xFF,
      10000,
    )
    return _parseSleepTempLog69(buf, todayStr)
  }

  // --- Sport / activity mode (0x19 + 0x17) ---
  //
  // sportType: 0=Run 1=Cycling 2=Badminton 3=Football 4=Tennis 5=Yoga
  //            6=Meditation 7=Dance 8=Basketball 9=Walk 10=Workout
  //            11=Cricket 12=Hiking 13=Aerobics 14=Ping-Pong 15=Rope Jump 16=Sit-ups
  async startSportMode(sportType) {
    await this._send(enterActivityModePacket(1, sportType || 0), 0x19)
  }

  async stopSportMode() {
    await this._send(enterActivityModePacket(4, 0), 0x19)
  }

  // Returns { status } where status: 1=active, 2=paused, 3=resuming, 4=ended
  async querySportMode() {
    const r = await this._send(queryActivityModePacket(), 0x19)
    return { status: r[1], sportType: r[2] }
  }

  // Send live telemetry to the ring every ~1 s while sport mode is active.
  // distanceKm: cumulative distance | paceSeconds: current pace (total s, e.g. 330 = 5:30/km)
  // rssi: phone GPS signal strength (0–100 or raw dBm magnitude)
  async sendSportHeartbeat(distanceKm, paceSeconds, rssi) {
    await this._ble.write(
      this._deviceId, SERVICE_UUID, WRITE_UUID,
      sendActivityHeartbeatPacket(distanceKm || 0, paceSeconds || 0, rssi || 0),
    )
  }

  // Elevated Oxygen Variation: [{ date, riskCount, variationList }]
  async getOxygenVariation(date) {
    const todayStr = _isoDateStr(date || new Date())
    const buf = await this._stream(
      getOxygenVariationPacket(),
      0x5D,
      (acc) => acc.length > 0 && acc[acc.length - 1] === 0xFF,
      8000,
    )
    return _parseOxygenVariation5D(buf, todayStr)
  }

  // --- Real-time streaming (0x09) ---

  // Starts continuous step/temp broadcast. cb receives live snapshot every ~1 s.
  // Call stopRealtimeStream() to end. Do not mix with other BLE commands while active.
  // cb: ({ steps, calories, distanceKm, exerciseMinutes, heartRate, tempC, spo2 }) => void
  async startRealtimeStream(cb, { steps = true, temp = true } = {}) {
    this._ble.onNotify(NOTIFY_UUID, (data) => {
      if (data[0] !== 0x09 || data.length < 25) return
      cb(_parseRealtimeActivity9(data))
    })
    await this._ble.write(this._deviceId, SERVICE_UUID, WRITE_UUID, setRealTimeControlPacket(steps, temp))
  }

  async stopRealtimeStream() {
    this._ble.onNotify(NOTIFY_UUID, null)
    await this._ble.write(this._deviceId, SERVICE_UUID, WRITE_UUID, setRealTimeControlPacket(false, false))
      .catch(() => {})
  }

  // --- On-demand health measurement (0x28) ---

  // type: 'heart-rate' | 'spo2' | 'hrv' | 'pressure'
  async getRealtime(type, timeoutMs) {
    timeoutMs = timeoutMs || 30000

    if (type === 'hrv' && this._cachedHrvResult && this._cachedHrvResult.hrv != null) {
      const val = this._cachedHrvResult.hrv
      this._cachedHrvResult = null
      return val
    }
    if (type === 'pressure' && this._cachedHrvResult && this._cachedHrvResult.stress != null) {
      const val = this._cachedHrvResult.stress
      this._cachedHrvResult = null
      return val
    }

    const x3TypeMap = { 'heart-rate': 2, 'spo2': 3, 'hrv': 1, 'pressure': 1 }
    const x3Type = x3TypeMap[type]
    if (!x3Type) throw new Error(`Unknown realtime type for X3: ${type}`)

    const startPkt = setMeasurementWithTypePacket(x3Type, 30, true)
    const stopPkt  = setMeasurementWithTypePacket(x3Type, 0, false)

    const result = await new Promise((resolve) => {
      const cleanup = (value) => {
        this._ble.onNotify(NOTIFY_UUID, null)
        resolve(value)
      }
      const end = setTimeout(() => cleanup(null), timeoutMs)

      this._ble.onNotify(NOTIFY_UUID, (data) => {
        if (data.length < 8 || data[0] !== 0x28) return
        if (data[1] !== x3Type) return
        if (data[2] === 0 && data[3] === 0 && data[4] === 0 && data[5] === 0) return

        let value = null
        if (type === 'heart-rate' && data[2] !== 0) {
          value = data[2]
        } else if (type === 'spo2' && data[3] !== 0) {
          value = data[3]
        } else if (type === 'hrv' && data[4] !== 0) {
          value = data[4]
          if (data[5] !== 0) this._cachedHrvResult = { stress: data[5] }
        } else if (type === 'pressure' && data[5] !== 0) {
          value = data[5]
          if (data[4] !== 0) this._cachedHrvResult = { hrv: data[4] }
        }

        if (value !== null) {
          clearTimeout(end)
          cleanup(value)
        }
      })

      this._ble.write(this._deviceId, SERVICE_UUID, WRITE_UUID, startPkt)
        .catch(() => { clearTimeout(end); cleanup(null) })
    })

    await this._ble.write(this._deviceId, SERVICE_UUID, WRITE_UUID, stopPkt).catch(() => {})
    return result
  }

  // --- Blood glucose PPG session (0x78 + 0x3A stream) ---
  //
  // Flow:
  //   1. startBloodGlucose(onData)  — begins 5-minute PPG capture
  //   2. Call sendBloodGlucoseProgress(pct) periodically (e.g. every 30 s)
  //   3. stopBloodGlucose()         — returns all raw samples for server upload
  //   4. sendBloodGlucoseResult(status) after server responds (0=fail,1=low,2=normal,3=high)
  //   5. exitBloodGlucose()         — closes the session
  //
  // onData: ({ samples: number[], total: number[] }) => void
  // Raw samples are 24-bit big-endian integers representing PPG reflection intensity.

  async startBloodGlucose(onData) {
    this._ppgSamples = []
    this._ble.onNotify(NOTIFY_UUID, (data) => {
      if (data[0] !== 0x3A) return
      const samples = _parsePpgPacket3A(data)
      this._ppgSamples.push(...samples)
      if (onData) onData({ samples, total: this._ppgSamples })
    })
    await this._ble.write(this._deviceId, SERVICE_UUID, WRITE_UUID, ppgControlPacket(1, 0))
  }

  async sendBloodGlucoseProgress(pct) {
    await this._ble.write(this._deviceId, SERVICE_UUID, WRITE_UUID,
      ppgControlPacket(4, Math.min(100, Math.max(0, Math.round(pct)))))
  }

  // Stops PPG collection and returns all collected samples for server upload.
  async stopBloodGlucose() {
    await this._ble.write(this._deviceId, SERVICE_UUID, WRITE_UUID, ppgControlPacket(3, 0))
    return this._ppgSamples.slice()
  }

  // status: 0=fail, 1=low, 2=normal, 3=high
  async sendBloodGlucoseResult(status) {
    await this._ble.write(this._deviceId, SERVICE_UUID, WRITE_UUID, ppgControlPacket(2, status || 0))
  }

  async exitBloodGlucose() {
    this._ble.onNotify(NOTIFY_UUID, null)
    this._ppgSamples = []
    await this._ble.write(this._deviceId, SERVICE_UUID, WRITE_UUID, ppgControlPacket(5, 0))
      .catch(() => {})
  }

  // --- Raw PPG waveform streaming (0x11) ---
  //
  // Streams high-frequency raw sensor values for signal analysis.
  // cb: ({ points: number[] }) => void  — each point is a 32-bit BE PPG intensity value
  async startPpgStream(cb) {
    this._ble.onNotify(NOTIFY_UUID, (data) => {
      if (data[0] !== 0x11 || data.length < 3) return
      const points = _parsePpgStream11(data)
      if (points.length > 0 && cb) cb({ points })
    })
    await this._ble.write(this._deviceId, SERVICE_UUID, WRITE_UUID, setPpgStreamPacket(true))
  }

  async stopPpgStream() {
    this._ble.onNotify(NOTIFY_UUID, null)
    await this._ble.write(this._deviceId, SERVICE_UUID, WRITE_UUID, setPpgStreamPacket(false))
      .catch(() => {})
  }

  // --- Internal helpers ---

  _send(packet, expectedCmdId, timeoutMs) {
    timeoutMs = timeoutMs || 3000
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._ble.onNotify(NOTIFY_UUID, null)
        reject(new Error(`X3 response timeout (cmd 0x${expectedCmdId.toString(16)})`))
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

  _stream(packet, expectedCmdId, isDone, timeoutMs) {
    timeoutMs = timeoutMs || 8000
    return new Promise((resolve, reject) => {
      const chunks = []
      let totalLen = 0

      const timer = setTimeout(() => {
        this._ble.onNotify(NOTIFY_UUID, null)
        reject(new Error(`X3 stream timeout (cmd 0x${expectedCmdId.toString(16)})`))
      }, timeoutMs)

      this._ble.onNotify(NOTIFY_UUID, (data) => {
        if (data[0] !== expectedCmdId) return
        chunks.push(data)
        totalLen += data.length
        const acc = _concat(chunks, totalLen)
        if (isDone(acc)) {
          clearTimeout(timer)
          this._ble.onNotify(NOTIFY_UUID, null)
          resolve(acc)
        }
      })

      this._ble.write(this._deviceId, SERVICE_UUID, WRITE_UUID, packet)
        .catch((err) => { clearTimeout(timer); this._ble.onNotify(NOTIFY_UUID, null); reject(err) })
    })
  }
}

// --- Private parsing helpers ---

// 0x55 — static HR: 10-byte records [cmd][?][?][y][mo][d][h][mi][s][bpm]
function _parseHrLog55(buf, todayStr) {
  if (!buf || buf.length < 10) return []
  const size = Math.floor(buf.length / 10)
  const results = []
  for (let i = 0; i < size; i++) {
    const off = i * 10
    if (buf[off] !== 0x55) continue
    const dateStr = parseBcdDate(buf, 3 + off, true)
    const hr = buf[9 + off]
    if (hr === 0 || hr === 0xFF) continue
    if (todayStr && !dateStr.startsWith(todayStr)) continue
    results.push({ value: hr, timestamp: new Date(dateStr.replace(' ', 'T') + '+08:00') })
  }
  return results
}

// 0x54 — continuous HR: 24-byte records [cmd][?][?][y][mo][d][h][mi][s][bpm×15]
function _parseHrHistory54(buf, todayStr) {
  if (!buf || buf.length < 24) return []
  const recSize = 24
  const size = Math.floor(buf.length / recSize)
  const results = []
  for (let i = 0; i < size; i++) {
    const off = i * recSize
    if (buf[off] !== 0x54) continue
    const dateStr = parseBcdDate(buf, 3 + off, true)
    if (todayStr && !dateStr.startsWith(todayStr)) continue
    const hrSamples = []
    for (let s = 0; s < 15; s++) {
      const bpm = buf[9 + off + s]
      if (bpm > 0 && bpm !== 0xFF) hrSamples.push(bpm)
    }
    if (hrSamples.length > 0) results.push({ date: dateStr, hrSamples })
  }
  return results
}

// 0x56 — HRV: 15-byte records [cmd][?][?][y][mo][d][h][mi][s][hrv][breath][hr][stress][highBP][lowBP]
function _parseHrvLog56(buf, todayStr) {
  const result = { hrv: null, stress: null, breath: null, heartRate: null, highBP: null, lowBP: null }
  if (!buf || buf.length < 15) return result
  const size = Math.floor(buf.length / 15)
  for (let i = 0; i < size; i++) {
    const off = i * 15
    if (buf[off] !== 0x56) continue
    const dateStr = parseBcdDate(buf, 3 + off, true)
    if (!dateStr.startsWith(todayStr)) continue
    const hrv       = buf[9  + off]
    const breath    = buf[10 + off]
    const heartRate = buf[11 + off]
    const stress    = buf[12 + off]
    const highBP    = buf[13 + off]
    const lowBP     = buf[14 + off]
    if (hrv       > 0 && hrv       !== 0xFF) result.hrv       = hrv
    if (breath    > 0 && breath    !== 0xFF) result.breath    = breath
    if (heartRate > 0 && heartRate !== 0xFF) result.heartRate = heartRate
    if (stress    > 0 && stress    !== 0xFF) result.stress    = stress
    if (highBP    > 0 && highBP    !== 0xFF) result.highBP    = highBP
    if (lowBP     > 0 && lowBP     !== 0xFF) result.lowBP     = lowBP
  }
  return result
}

// 0x66 — auto SpO2: 10-byte records [cmd][?][?][y][mo][d][h][mi][s][spo2]
function _parseSpo2Log66(buf, todayStr) {
  if (!buf || buf.length < 10) return null
  const size = Math.floor(buf.length / 10)
  let latest = null
  for (let i = 0; i < size; i++) {
    const off = i * 10
    if (buf[off] !== 0x66) continue
    const dateStr = parseBcdDate(buf, 3 + off, true)
    if (!dateStr.startsWith(todayStr)) continue
    const val = buf[9 + off]
    if (val !== 0 && val !== 0xFF) latest = val
  }
  return latest
}

// 0x57 — detailed SpO2: 30-byte records, 20 samples × 30 s
// [cmd][?][?][y][mo][d][h][mi][s][?][spo2×20]
function _parseSpo2History57(buf, todayStr) {
  if (!buf || buf.length < 30) return []
  const recSize = 30
  const size = Math.floor(buf.length / recSize)
  const results = []
  for (let i = 0; i < size; i++) {
    const off = i * recSize
    if (buf[off] !== 0x57) continue
    const dateStr = parseBcdDate(buf, 3 + off, true)
    if (todayStr && !dateStr.startsWith(todayStr)) continue
    const samples = []
    for (let s = 0; s < 20; s++) {
      const v = buf[10 + off + s]
      if (v > 0 && v !== 0xFF) samples.push(v)
    }
    if (samples.length > 0) results.push({ date: dateStr, samples })
  }
  return results
}

// 0x60 — sleep HRV/RMSSD: 69-byte records, 30 × 2-byte LE samples
// [cmd][?][?][y][mo][d][h][mi][s][rmssd×30 (2B each)]
function _parseSleepHrv60(buf, todayStr) {
  if (!buf || buf.length < 69) return []
  const recSize = 69
  const size = Math.floor(buf.length / recSize)
  const results = []
  for (let i = 0; i < size; i++) {
    const off = i * recSize
    if (buf[off] !== 0x60) continue
    const dateStr = parseBcdDate(buf, 3 + off, true)
    if (todayStr && !dateStr.startsWith(todayStr)) continue
    const rmssd = []
    for (let s = 0; s < 30; s++) {
      const val = readLEInt(buf, 9 + off + s * 2, 2)
      if (val > 0) rmssd.push(val)
    }
    if (rmssd.length > 0) results.push({ date: dateStr, rmssd })
  }
  return results
}

// 0x62 — temperature: 15-byte records, 3 NTC sensors (×0.1 °C each)
// [cmd][?][?][y][mo][d][h][mi][s][ntc1-lo][ntc1-hi][ntc2-lo][ntc2-hi][ntc3-lo][ntc3-hi]
function _parseTempLog62(buf, todayStr) {
  if (!buf || buf.length < 15) return []
  const recSize = 15
  const size = Math.floor(buf.length / recSize)
  const results = []
  for (let i = 0; i < size; i++) {
    const off = i * recSize
    if (buf[off] !== 0x62) continue
    const dateStr = parseBcdDate(buf, 3 + off, true)
    if (todayStr && !dateStr.startsWith(todayStr)) continue
    const skinTemp    = readLEInt(buf, 9 + off, 2) * 0.1
    const ambientTemp = readLEInt(buf, 11 + off, 2) * 0.1
    const shellTemp   = readLEInt(buf, 13 + off, 2) * 0.1
    const { estimatedBodyTemp, status } = _estimateBodyTemp(skinTemp, ambientTemp, shellTemp)
    results.push({ date: dateStr, skinTemp, ambientTemp, shellTemp, estimatedBodyTemp, status })
  }
  return results
}

// 0x69 — sleep body temperature: 69-byte records, 10 × 6-byte NTC samples per record
// [cmd][?][?][y][mo][d][h][mi][s][ntc1lo][ntc1hi][ntc2lo][ntc2hi][ntc3lo][ntc3hi] × 10
function _parseSleepTempLog69(buf, todayStr) {
  if (!buf || buf.length < 69) return []
  const recSize = 69
  const size = Math.floor(buf.length / recSize)
  const results = []
  for (let i = 0; i < size; i++) {
    const off = i * recSize
    if (buf[off] !== 0x69) continue
    const dateStr = parseBcdDate(buf, 3 + off, true)
    if (todayStr && !dateStr.startsWith(todayStr)) continue
    const samples = []
    for (let s = 0; s < 10; s++) {
      const base = 9 + off + s * 6
      const skinTemp    = readLEInt(buf, base,     2) * 0.1
      const ambientTemp = readLEInt(buf, base + 2, 2) * 0.1
      const shellTemp   = readLEInt(buf, base + 4, 2) * 0.1
      const { estimatedBodyTemp, status } = _estimateBodyTemp(skinTemp, ambientTemp, shellTemp)
      samples.push({ skinTemp, ambientTemp, shellTemp, estimatedBodyTemp, status })
    }
    if (samples.length > 0) results.push({ date: dateStr, samples })
  }
  return results
}

// 0x5C — exercise sessions: 25-byte records
// [cmd][?][?][y][mo][d][h][mi][s][mode][avgHR][dur-lo][dur-hi][steps-lo][steps-hi]
// [paceMin][paceSec][cal×4 float LE][dist×4 float LE]
function _parseExercise5C(buf, todayStr) {
  if (!buf || buf.length < 25) return []
  const recSize = 25
  const size = Math.floor(buf.length / recSize)
  const results = []
  for (let i = 0; i < size; i++) {
    const off = i * recSize
    if (buf[off] !== 0x5C) continue
    const dateStr = parseBcdDate(buf, 3 + off, true)
    if (todayStr && !dateStr.startsWith(todayStr)) continue
    results.push({
      date:        dateStr,
      sportMode:   buf[9 + off],
      avgHeartRate: buf[10 + off],
      durationSec: readLEInt(buf, 11 + off, 2),
      steps:       readLEInt(buf, 13 + off, 2),
      paceMin:     buf[15 + off],
      paceSec:     buf[16 + off],
      calories:    Math.round(readFloat32LE(buf, 17 + off) * 10) / 10,
      distanceKm:  Math.round(readFloat32LE(buf, 21 + off) * 100) / 100,
    })
  }
  return results
}

// 0x5F — sleep apnea risk: 10-byte records [cmd][?][?][y][mo][d][h][mi][s][risk]
// risk: 16=no result, 0/1=low, 2=mild, 3=severe
function _parseSleepApnea5F(buf, todayStr) {
  if (!buf || buf.length < 10) return []
  const recSize = 10
  const size = Math.floor(buf.length / recSize)
  const results = []
  for (let i = 0; i < size; i++) {
    const off = i * recSize
    if (buf[off] !== 0x5F) continue
    const dateStr = parseBcdDate(buf, 3 + off, true)
    if (todayStr && !dateStr.startsWith(todayStr)) continue
    const riskLevel = buf[9 + off]
    if (riskLevel !== 0xFF) results.push({ date: dateStr, riskLevel })
  }
  return results
}

// 0x5D — elevated oxygen variation: variable-length records
// [cmd][?][?][y][mo][d][h][mi][s][riskCount][N][variation×N]
function _parseOxygenVariation5D(buf, todayStr) {
  if (!buf || buf.length < 11) return []
  const results = []
  let i = 0
  while (i < buf.length) {
    if (buf[i] !== 0x5D) { i++; continue }
    if (i + 11 > buf.length) break
    const dateStr  = parseBcdDate(buf, i + 3, true)
    const n        = buf[i + 10]
    if (i + 11 + n > buf.length) break
    if (!todayStr || dateStr.startsWith(todayStr)) {
      const riskCount     = buf[i + 9]
      const variationList = Array.from(buf.slice(i + 11, i + 11 + n))
      results.push({ date: dateStr, riskCount, variationList })
    }
    i += 11 + n
  }
  return results
}

// 0x51 + 0x52 — step summary and detail slots
function _parseSteps(buf51, buf52, todayStr) {
  const empty = { steps: 0, calories: 0, distance: 0, slots: [] }
  if (!buf51 || buf51.length < 26) return empty

  let recordLen = 27
  if (buf51.length !== 2 && (buf51.length % 26 === 0 || (buf51.length - 2) % 26 === 0)) recordLen = 26

  const size = Math.floor(buf51.length / recordLen)
  let steps = 0, calories = 0, distanceM = 0
  for (let i = 0; i < size; i++) {
    const off = i * recordLen
    const dateStr = '20' + bcdToString(buf51[2 + off]) + '-' + bcdToString(buf51[3 + off]) + '-' + bcdToString(buf51[4 + off])
    if (dateStr !== todayStr) continue
    steps     = readLEInt(buf51, 5 + off, 4)
    calories  = readLEInt(buf51, 17 + off, 4) / 100
    distanceM = readLEInt(buf51, 13 + off, 4) * 10
    break
  }

  const slots = []
  if (buf52 && buf52.length >= 25) {
    const detailSize = Math.floor(buf52.length / 25)
    for (let i = 0; i < detailSize; i++) {
      const off = i * 25
      if (buf52[off] !== 0x52) continue
      const dateStr = parseBcdDate(buf52, 3 + off, true)
      if (!dateStr.startsWith(todayStr)) continue
      const slotSteps = readLEInt(buf52, 9 + off, 2)
      if (slotSteps === 0) continue
      const slotCal   = readLEInt(buf52, 11 + off, 2) / 100
      const slotDistM = readLEInt(buf52, 13 + off, 2) * 10
      slots.push({ t: dateStr.replace(' ', 'T') + '+08:00', steps: slotSteps, cal: slotCal, dist: slotDistM })
    }
  }

  return { steps, calories, distance: distanceM, slots }
}

// 0x53 — sleep history (1-min or 5-min mode)
function _parseSleep53(buf) {
  const empty = { totalMinutes: 0, deep: 0, light: 0, rem: 0, awake: 0, periods: [], sleepStart: null, sleepEnd: null }
  if (!buf || buf.length < 12) return empty

  const isEnd = buf.length >= 2 && buf[buf.length - 2] === 0x53 && buf[buf.length - 1] === 0xFF
  let records = []

  if (buf.length === 130 || (isEnd && buf.length === 132)) {
    const dateStr = parseBcdDate(buf, 3, true)
    const sleepLength = buf[9]
    const stages = Array.from(buf.slice(10, 10 + sleepLength))
    records = [{ dateStr, unitMin: 1, stages }]
  } else {
    const recSize = 34
    const count = Math.floor(buf.length / recSize)
    for (let i = 0; i < count; i++) {
      const off = i * recSize
      if (buf[off] !== 0x53) continue
      const dateStr = parseBcdDate(buf, 3 + off, true)
      const sleepLength = buf[9 + off]
      const stages = Array.from(buf.slice(10 + off, 10 + off + sleepLength))
      records.push({ dateStr, unitMin: 5, stages })
    }
  }

  if (!records.length) return empty

  // Use first record's timestamp as sleep onset; accumulate stages from all records.
  // (For single-large-packet rings this is records[0] only; for multi-block BLE the
  // last record's timestamp is the tail interval, not the sleep start.)
  const first = records[0]
  const allStages = records.flatMap(r => r.stages)
  const periods = _stagesToPeriods(allStages, first.unitMin)
  const totalMinutes = allStages.length * first.unitMin
  const deep  = periods.filter((p) => p.type === 1).reduce((s, p) => s + p.minutes, 0)
  const light = periods.filter((p) => p.type === 2).reduce((s, p) => s + p.minutes, 0)
  const rem   = periods.filter((p) => p.type === 3).reduce((s, p) => s + p.minutes, 0)
  const awake = periods.filter((p) => p.type === 0).reduce((s, p) => s + p.minutes, 0)

  const timePart = first.dateStr.slice(first.dateStr.indexOf(' ') + 1)
  const colonIdx = timePart.indexOf(':')
  const hh = parseInt(timePart.slice(0, colonIdx), 10)
  const mm = parseInt(timePart.slice(colonIdx + 1, colonIdx + 3), 10)
  const sleepStart = hh * 60 + mm
  const sleepEnd   = sleepStart + totalMinutes

  return { totalMinutes, deep, light, rem, awake, periods, sleepStart, sleepEnd }
}

// 0x09 — real-time activity broadcast (25 bytes)
// bytes[1..4]=steps, [5..8]=calories÷100, [9..12]=distanceKm÷100,
// [13..16]=exerciseDuration÷60(min), [17..20]=exerciseTime(raw s), [21]=HR, [22..23]=temp, [24]=SpO2
function _parseRealtimeActivity9(data) {
  return {
    steps:           readLEInt(data, 1, 4),
    calories:        readLEInt(data, 5, 4) / 100,
    distanceKm:      readLEInt(data, 9, 4) / 100,
    exerciseMinutes: readLEInt(data, 13, 4) / 60,
    activeSeconds:   readLEInt(data, 17, 4),
    heartRate:       data[21],
    tempC:           readLEInt(data, 22, 2) * 0.1,
    spo2:            data[24],
  }
}

// 0x3A — blood glucose PPG data packets (153 or 203 bytes)
function _parsePpgPacket3A(data) {
  const samples = []
  if (data.length === 153) {
    // 50 × 24-bit big-endian samples starting at offset 3
    for (let i = 0; i < 50; i++) {
      const off = 3 + i * 3
      samples.push(data[off] * 65536 + data[off + 1] * 256 + data[off + 2])
    }
  } else if (data.length === 203) {
    // 50 × 32-bit big-endian samples starting at offset 3
    for (let i = 0; i < 50; i++) {
      const off = 3 + i * 4
      samples.push(data[off] * 16777216 + data[off + 1] * 65536 + data[off + 2] * 256 + data[off + 3])
    }
  }
  return samples
}

// 0x11 — raw PPG waveform: 8-byte blocks, 32-bit BE intensity at bytes 4–7 of each block
function _parsePpgStream11(data) {
  const points = []
  const blockSize = 8
  const start = 2
  for (let off = start; off + blockSize <= data.length; off += blockSize) {
    points.push(data[off + 4] * 16777216 + data[off + 5] * 65536 + data[off + 6] * 256 + data[off + 7])
  }
  return points
}

// Body temperature estimation from 3 NTC sensors (SDK algorithm)
// status: 1=Cold, 2=Normal, 3=SlightlyElevated, 4=Fever, 5=HighFever, 6=Error
function _estimateBodyTemp(ntc1, ntc2, ntc3) {
  const maxVal = Math.max(ntc1, ntc2, ntc3)
  const diff   = maxVal - Math.min(ntc1, ntc2, ntc3)
  let est, status

  if (maxVal > 41.25) {
    est = Math.floor(maxVal + 0.2)
    status = 5
  } else if (maxVal > 37.05) {
    if (diff < 0.25)       { est = maxVal + 0.2; status = 4 }
    else if (diff < 0.85)  { est = maxVal + (diff + 0.2) / 2; status = est > 41.4 ? 5 : 4 }
    else if (diff < 1.85)  { est = maxVal + 0.5 + (diff - 0.8) / 4; status = est > 41.4 ? 5 : 4 }
    else                   { est = maxVal + 0.5; status = 6 }
  } else if (maxVal > 35.95) {
    if (diff < 0.45)       { est = maxVal + 0.2; status = 2 }
    else if (diff < 0.85)  { est = maxVal + diff / 2; status = est > 37.25 ? 4 : 3 }
    else if (diff < 2.05)  { est = maxVal + 0.3 + (diff - 0.8) / 4; status = est > 37.25 ? 4 : 3 }
    else                   { est = maxVal + 0.5; status = 1 }
  } else {
    est = maxVal
    status = 1
  }

  return { estimatedBodyTemp: Math.round(est * 10) / 10, status }
}

// Stage values: 0=Awake, 1=Deep, 2=Light, 3=REM
function _stagesToPeriods(stages, unitMin) {
  const typeNames = { 0: 'awake', 1: 'deep', 2: 'light', 3: 'rem' }
  const periods = []
  let i = 0
  while (i < stages.length) {
    const s = stages[i]
    let run = 1
    while (i + run < stages.length && stages[i + run] === s) run++
    periods.push({ type: s, typeName: typeNames[s] || 'unknown', minutes: run * unitMin })
    i += run
  }
  return periods
}

function _isoDateStr(date) {
  const OFFSET_MS = 8 * 60 * 60 * 1000
  const d = new Date((date ? date.getTime() : Date.now()) + OFFSET_MS)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function _concat(arrays, totalLen) {
  const out = new Uint8Array(totalLen)
  let offset = 0
  for (const arr of arrays) { out.set(arr, offset); offset += arr.length }
  return out
}

module.exports = X3Ring
