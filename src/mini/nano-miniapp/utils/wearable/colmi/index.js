'use strict'

const { WearableDevice } = require('../index.js')
const { BLEManager } = require('../ble-manager.js')
const {
  UART_SERVICE_UUID, UART_RX_CHAR_UUID, UART_TX_CHAR_UUID,
  BIG_DATA_SERVICE_UUID, BIG_DATA_RX_CHAR_UUID, BIG_DATA_TX_CHAR_UUID,
  CMD_START_REAL_TIME, COLMI_NAME_PREFIXES,
} = require('./protocol.js')
const { BATTERY_PACKET, parseBattery } = require('./parsers/battery.js')
const { readHeartRatePacket, HeartRateLogParser } = require('./parsers/heart-rate.js')
const { readStepsPacket, SportDetailParser } = require('./parsers/steps.js')
const { readSleepPacket, parseSleepResponse, bigDataExpectedLength, NoData: SleepNoData } = require('./parsers/sleep.js')
const { getStartPacket, getContinuePacket, getStopPacket, REAL_TIME_MAPPING } = require('./parsers/realtime.js')
const { setTimePacket } = require('./parsers/time.js')

const NOTIFY_MAP = {
  [UART_SERVICE_UUID]: {
    txCharUUID: UART_TX_CHAR_UUID,
    rxCharUUID: UART_RX_CHAR_UUID,
  },
  [BIG_DATA_SERVICE_UUID]: {
    txCharUUID: BIG_DATA_TX_CHAR_UUID,
    rxCharUUID: BIG_DATA_RX_CHAR_UUID,
  },
}

// Regular UART response is complete when we receive a 16-byte packet whose
// command byte matches and the subType indicates it's the final packet.
// For simplicity: each single UART packet is exactly 16 bytes and is self-contained
// (the parser handles multi-packet reassembly at the application level).
function _uartIsDone(buf) {
  return buf.length >= 16
}

class ColmiRing extends WearableDevice {
  constructor() {
    super()
    this._ble = new BLEManager()
    this._deviceId = null
    this._deviceName = ''
    this._uartRxCharUUID = UART_RX_CHAR_UUID
    this._uartTxCharUUID = UART_TX_CHAR_UUID
    this._bigDataRxCharUUID = BIG_DATA_RX_CHAR_UUID
    this._bigDataTxCharUUID = BIG_DATA_TX_CHAR_UUID
    this._hasBigData = false
    this._r20CachedStress = null  // captured from 73-12 burst at start of any R20 measurement
  }

  // Scan for Colmi rings nearby. Returns [{ deviceId, name, rssi }].
  static async scan(timeoutMs) {
    const mgr = new BLEManager()
    await mgr.openAdapter()
    try {
      return await mgr.scan(COLMI_NAME_PREFIXES, timeoutMs || 8000)
    } finally {
      await mgr.closeAdapter()
    }
  }

  async connect(deviceId, { syncTime = false, name = '' } = {}) {
    this._deviceId = deviceId
    this._deviceName = name
    await this._ble.openAdapter()
    await this._ble.connect(deviceId, NOTIFY_MAP)
    if (syncTime) {
      try { await this.setTime(new Date()) } catch (_) {}
    }
  }

  async disconnect() {
    await this._ble.disconnect()
    this._deviceId = null
  }

  async getBattery() {
    const response = await this._sendUART(BATTERY_PACKET)
    return parseBattery(response)
  }

  async getDeviceInfo() {
    // Basic info from device name; detailed HW/FW requires GATT Device Info service
    return { name: '', model: 'Colmi Ring', firmware: 'unknown', hardware: 'unknown' }
  }

  async setTime(date) {
    await this._sendUART(setTimePacket(date || new Date()))
  }

  async getHeartRateLog(date) {
    const target = date || _startOfDay(new Date())
    const packet = readHeartRatePacket(target)
    const parser = new HeartRateLogParser()
    // Heart rate log may arrive in multiple 16-byte packets; collect until parser yields a result
    const result = await this._collectUARTMulti(packet, (p) => parser.parse(p))
    if (!result || result.constructor.name === 'NoData') return []
    return result.heartRatesWithTimes()
  }

  async getSteps(date) {
    const ref = new Date()
    const target = date || ref
    const targetMs = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate())
    const refMs    = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate())
    const days = Math.round((refMs - targetMs) / (24 * 60 * 60 * 1000))
    const parser = new SportDetailParser()
    const result = await this._collectUARTMulti(readStepsPacket(days), (p) => parser.parse(p))
    if (!result || result.constructor.name === 'NoData') return { steps: 0, calories: 0, distance: 0, slots: [] }
    const details = Array.isArray(result) ? result : [result]
    const totals = details.reduce(
      (acc, d) => ({ steps: acc.steps + d.steps, calories: acc.calories + d.calories, distance: acc.distance + d.distance }),
      { steps: 0, calories: 0, distance: 0 },
    )
    const slots = details
      .filter(d => d.steps > 0)
      .map(d => ({ t: d.timestamp.toISOString(), steps: d.steps, cal: d.calories, dist: d.distance }))
    return { ...totals, slots }
  }

  async getSleep() {
    const packet = readSleepPacket()
    let expectedLen = Infinity
    const chunks = []
    let totalLen = 0

    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._ble.onNotify(this._bigDataTxCharUUID, null)
        reject(new Error('getSleep timed out'))
      }, 8000)

      this._ble.onNotify(this._bigDataTxCharUUID, (data) => {
        chunks.push(data)
        totalLen += data.length
        if (expectedLen === Infinity && totalLen >= 4) {
          const combined = _concat(chunks, totalLen)
          expectedLen = bigDataExpectedLength(combined)
        }
        if (totalLen >= expectedLen) {
          clearTimeout(timer)
          this._ble.onNotify(this._bigDataTxCharUUID, null)
          const buf = _concat(chunks, totalLen)
          resolve(parseSleepResponse(buf))
        }
      })

      this._ble.write(this._deviceId, BIG_DATA_SERVICE_UUID, this._bigDataRxCharUUID, packet)
        .catch((err) => { clearTimeout(timer); this._ble.onNotify(this._bigDataTxCharUUID, null); reject(err) })
    })

    if (!result || result instanceof SleepNoData) {
      return { totalMinutes: 0, deep: 0, light: 0, rem: 0, awake: 0, periods: [], sleepStart: null, sleepEnd: null }
    }
    // Return most recent night (daysAgo === 0)
    const latest = Array.isArray(result) ? (result.find((d) => d.daysAgo === 0) || result[0]) : result
    return {
      totalMinutes: latest.totalMinutes,
      deep:  latest.deepMinutes,
      light: latest.lightMinutes,
      rem:   latest.remMinutes,
      awake: latest.awakeMinutes,
      periods: latest.periods,
      sleepStart: latest.sleepStart,
      sleepEnd:   latest.sleepEnd,
    }
  }

  // timeoutMs: total measurement budget (HRV ~45 s, stress ~30 s, SpO2 ~20 s).
  // Resolves with the first non-zero value or null on timeout/error.
  // No CONTINUE pings are sent on this path — R10 and R20 both reset/break when they receive them.
  // R02 completes without them. R20 SpO2 is handled separately in _getR20Spo2() which has its own pings.
  async getRealtime(type, timeoutMs = 30000) {
    if (this._deviceName.startsWith('R20')) {
      if (type === 'spo2')     return this._getR20Spo2(timeoutMs)
      if (type === 'pressure') return this._getR20Stress()
    }

    const readingCode = REAL_TIME_MAPPING[type]
    if (!readingCode) throw new Error(`Unknown realtime reading type: ${type}`)
    const startPkt    = getStartPacket(readingCode)
    const stopPkt     = getStopPacket(readingCode)
    const expectedCmd = CMD_START_REAL_TIME & 0x7f

    const result = await new Promise((resolve) => {
      const cleanup = (value) => {
        this._ble.onNotify(this._uartTxCharUUID, null)
        resolve(value)
      }

      const end = setTimeout(() => cleanup(null), timeoutMs)

      this._ble.onNotify(this._uartTxCharUUID, (data) => {
        if (data.length < 16 || (data[0] & 0x7f) !== expectedCmd) return
        if (data[1] !== readingCode) return  // ignore packets for other reading types
        // data[2] = 0 → reading ready; non-zero = measuring in progress or error
        if (data[2] !== 0) return
        const value = data[3]
        if (value !== 0) {
          clearTimeout(end)
          cleanup(value)
        }
      })

      // Register handler FIRST, then send START so no early responses are missed
      this._ble.write(this._deviceId, UART_SERVICE_UUID, this._uartRxCharUUID, startPkt)
        .catch(() => { clearTimeout(end); cleanup(null) })
    })

    await this._ble.write(this._deviceId, UART_SERVICE_UUID, this._uartRxCharUUID, stopPkt).catch(() => {})
    return result
  }

  // R20 SpO2: trigger a health-check (type 5) measurement and wait for the 0x73 result packet.
  // The ring streams raw PPG samples via 69-05 packets while measuring, then fires a single
  // 73-0c-<spo2>-00... packet (~18-25 s after START). Confirmed by live BLE capture on R20_EA3B.
  // Also captures any 73-12 stress/BP cache dump that may appear at the start of the session.
  async _getR20Spo2(timeoutMs) {
    const HEALTH_CHECK      = 5
    const CMD_HEALTH_RESULT = 0x73
    const SPO2_KIND         = 0x0c
    const STRESS_KIND       = 0x12
    const startPkt    = getStartPacket(HEALTH_CHECK)
    const continuePkt = getContinuePacket(HEALTH_CHECK)
    const stopPkt     = getStopPacket(HEALTH_CHECK)

    this._r20CachedStress = null  // reset before new measurement

    const result = await new Promise((resolve) => {
      let pingInterval = null

      const cleanup = (value) => {
        if (pingInterval) { clearInterval(pingInterval); pingInterval = null }
        this._ble.onNotify(this._uartTxCharUUID, null)
        resolve(value)
      }

      const end = setTimeout(() => cleanup(null), timeoutMs)

      this._ble.onNotify(this._uartTxCharUUID, (data) => {
        if (data.length < 3) return
        const cmd = data[0] & 0x7f
        if (cmd !== CMD_HEALTH_RESULT) return
        if (data[1] === STRESS_KIND && data.length >= 5 && data[4] !== 0) {
          // 73-12 cached stress/BP dump — save it for _getR20Stress() to consume
          this._r20CachedStress = data[4]
        }
        if (data[1] === SPO2_KIND && data[2] !== 0) {
          clearTimeout(end)
          cleanup(data[2])
        }
      })

      this._ble.write(this._deviceId, UART_SERVICE_UUID, this._uartRxCharUUID, startPkt)
        .then(() => {
          pingInterval = setInterval(() => {
            this._ble.write(this._deviceId, UART_SERVICE_UUID, this._uartRxCharUUID, continuePkt).catch(() => {})
          }, 2000)
        })
        .catch(() => { clearTimeout(end); cleanup(null) })
    })

    await this._ble.write(this._deviceId, UART_SERVICE_UUID, this._uartRxCharUUID, stopPkt).catch(() => {})
    return result
  }

  // R20 stress: returns cached stress data from _r20CachedStress if captured during _getR20Spo2().
  // The ring dumps 73-12 packets at the start of any measurement when it has stored BP/stress readings.
  // If no cached data was captured, falls back to a fresh pressure START and waits up to 5 s.
  async _getR20Stress() {
    if (this._r20CachedStress != null) {
      const val = this._r20CachedStress
      this._r20CachedStress = null
      return val
    }

    const readingCode = REAL_TIME_MAPPING['pressure']
    const startPkt = getStartPacket(readingCode)
    const stopPkt  = getStopPacket(readingCode)
    const CMD_STRESS_RESULT = 0x73
    const STRESS_KIND       = 0x12

    const result = await new Promise((resolve) => {
      const cleanup = (value) => {
        this._ble.onNotify(this._uartTxCharUUID, null)
        resolve(value)
      }

      const end = setTimeout(() => cleanup(null), 5000)

      this._ble.onNotify(this._uartTxCharUUID, (data) => {
        if (data.length < 5) return
        if ((data[0] & 0x7f) === CMD_STRESS_RESULT && data[1] === STRESS_KIND) {
          const val = data[4]
          if (val !== 0) {
            clearTimeout(end)
            cleanup(val)
          }
        }
      })

      this._ble.write(this._deviceId, UART_SERVICE_UUID, this._uartRxCharUUID, startPkt)
        .catch(() => { clearTimeout(end); cleanup(null) })
    })

    await this._ble.write(this._deviceId, UART_SERVICE_UUID, this._uartRxCharUUID, stopPkt).catch(() => {})
    return result
  }

  // --- internal helpers ---

  // Send a UART packet and wait for a single 16-byte response matching the sent command
  _sendUART(packet) {
    const expectedCmd = packet[0] & 0x7f
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._ble.onNotify(this._uartTxCharUUID, null)
        reject(new Error('UART response timed out'))
      }, 3000)

      this._ble.onNotify(this._uartTxCharUUID, (data) => {
        if (data.length >= 16 && (data[0] & 0x7f) === expectedCmd) {
          clearTimeout(timer)
          this._ble.onNotify(this._uartTxCharUUID, null)
          resolve(data)
        }
      })

      this._ble.write(this._deviceId, UART_SERVICE_UUID, this._uartRxCharUUID, packet)
        .catch((err) => { clearTimeout(timer); this._ble.onNotify(this._uartTxCharUUID, null); reject(err) })
    })
  }

  // Wait for a UART notification matching a given command byte
  _waitForUART(expectedCmd, timeoutMs) {
    return new Promise((resolve, reject) => {
      const prev = this._ble._notifyHandlers[_normalizeUUID(this._uartTxCharUUID)]
      const timer = setTimeout(() => {
        this._ble.onNotify(this._uartTxCharUUID, prev || null)
        reject(new Error('UART wait timed out'))
      }, timeoutMs)

      this._ble.onNotify(this._uartTxCharUUID, (data) => {
        if (data.length >= 16 && (data[0] & 0x7f) === expectedCmd) {
          clearTimeout(timer)
          this._ble.onNotify(this._uartTxCharUUID, prev || null)
          resolve(data)
        }
      })
    })
  }

  // Send a packet and collect multiple 16-byte UART responses until the parser returns a non-null result
  _collectUARTMulti(packet, parserFn, timeoutMs) {
    const expectedCmd = packet[0] & 0x7f
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._ble.onNotify(this._uartTxCharUUID, null)
        reject(new Error('collectUARTMulti timed out'))
      }, timeoutMs || 5000)

      this._ble.onNotify(this._uartTxCharUUID, (data) => {
        if (data.length < 16 || (data[0] & 0x7f) !== expectedCmd) return
        try {
          const result = parserFn(data)
          if (result !== null && result !== undefined) {
            clearTimeout(timer)
            this._ble.onNotify(this._uartTxCharUUID, null)
            resolve(result)
          }
        } catch (e) {
          clearTimeout(timer)
          this._ble.onNotify(this._uartTxCharUUID, null)
          reject(e)
        }
      })

      this._ble.write(this._deviceId, UART_SERVICE_UUID, this._uartRxCharUUID, packet)
        .catch((err) => { clearTimeout(timer); this._ble.onNotify(this._uartTxCharUUID, null); reject(err) })
    })
  }
}

function _startOfDay(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

function _concat(arrays, totalLen) {
  const out = new Uint8Array(totalLen)
  let offset = 0
  for (const arr of arrays) { out.set(arr, offset); offset += arr.length }
  return out
}

function _normalizeUUID(uuid) {
  return uuid.replace(/-/g, '').toLowerCase()
}

module.exports = ColmiRing
