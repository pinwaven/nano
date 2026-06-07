'use strict'

const { makePacket } = require('../packet.js')
const { CMD_BIG_DATA } = require('../protocol.js')

const BIG_DATA_SLEEP = 39  // 0x27

const SleepType = { NO_DATA: 0, ERROR: 1, LIGHT: 2, DEEP: 3, REM: 4, AWAKE: 5 }
const SleepTypeNames = { 0: 'no_data', 1: 'error', 2: 'light', 3: 'deep', 4: 'rem', 5: 'awake' }

function readSleepPacket() {
  return makePacket(CMD_BIG_DATA, [BIG_DATA_SLEEP, 0x00, 0x00, 0xff, 0xff])
}

class SleepPeriod {
  constructor(type, minutes) {
    this.type = type
    this.typeName = SleepTypeNames[type] || `unknown(${type})`
    this.minutes = minutes
  }
}

class SleepDay {
  constructor(daysAgo, sleepStart, sleepEnd, periods) {
    this.daysAgo = daysAgo
    this.sleepStart = sleepStart  // minutes after midnight
    this.sleepEnd = sleepEnd
    this.periods = periods
  }

  get totalMinutes() { return this.periods.reduce((s, p) => s + p.minutes, 0) }
  get deepMinutes()  { return this.periods.filter((p) => p.type === SleepType.DEEP).reduce((s, p) => s + p.minutes, 0) }
  get lightMinutes() { return this.periods.filter((p) => p.type === SleepType.LIGHT).reduce((s, p) => s + p.minutes, 0) }
  get remMinutes()   { return this.periods.filter((p) => p.type === SleepType.REM).reduce((s, p) => s + p.minutes, 0) }
  get awakeMinutes() { return this.periods.filter((p) => p.type === SleepType.AWAKE).reduce((s, p) => s + p.minutes, 0) }
}

class NoData {}

// data: Uint8Array of the full assembled Big Data response
function parseSleepResponse(data) {
  if (data.length < 7) return null
  if (data[0] !== CMD_BIG_DATA || data[1] !== BIG_DATA_SLEEP) return null

  const dataLen = data[2] | (data[3] << 8)
  if (dataLen === 0) return new NoData()

  const sleepDays = data[6]
  if (sleepDays === 0) return new NoData()

  const days = []
  let idx = 7

  for (let d = 0; d < sleepDays; d++) {
    if (idx + 6 > data.length) break

    const daysAgo    = data[idx]
    const curDayBytes = data[idx + 1]
    const sleepStart = _readInt16LE(data, idx + 2)
    const sleepEnd   = _readInt16LE(data, idx + 4)

    const periods = []
    let periodIdx = idx + 6
    const periodEnd = idx + 1 + curDayBytes

    while (periodIdx + 1 < periodEnd && periodIdx + 1 < data.length) {
      const type    = data[periodIdx]
      const minutes = data[periodIdx + 1]
      if (type === SleepType.NO_DATA) {
        periods.push(new SleepPeriod(SleepType.AWAKE, minutes))
      } else if (type !== SleepType.ERROR) {
        periods.push(new SleepPeriod(type, minutes))
      }
      periodIdx += 2
    }

    days.push(new SleepDay(daysAgo, sleepStart, sleepEnd, periods))
    idx = periodEnd
  }

  return days.length > 0 ? days : new NoData()
}

// Total expected byte count for a Big Data response (for isDone check)
function bigDataExpectedLength(firstChunk) {
  if (firstChunk.length < 4) return Infinity
  const dataLen = firstChunk[2] | (firstChunk[3] << 8)
  return dataLen + 6
}

function _readInt16LE(arr, offset) {
  const v = arr[offset] | (arr[offset + 1] << 8)
  // interpret as signed 16-bit
  return v >= 0x8000 ? v - 0x10000 : v
}

module.exports = {
  CMD_BIG_DATA, BIG_DATA_SLEEP, SleepType, SleepTypeNames,
  SleepPeriod, SleepDay, NoData,
  readSleepPacket, parseSleepResponse, bigDataExpectedLength,
}
