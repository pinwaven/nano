'use strict'

const { makePacket } = require('../packet.js')
const { CMD_READ_HEART_RATE } = require('../protocol.js')

function readHeartRatePacket(target) {
  const ts = Math.floor(target.getTime() / 1000)
  const data = [ts & 0xff, (ts >> 8) & 0xff, (ts >> 16) & 0xff, (ts >> 24) & 0xff]
  return makePacket(CMD_READ_HEART_RATE, data)
}

class HeartRateLog {
  constructor(heartRates, timestamp, size, index, range) {
    this.heartRates = heartRates
    this.timestamp = timestamp
    this.size = size
    this.index = index
    this.range = range
  }

  // Returns [{ value, timestamp }] pairs — one per 5-min interval across the day
  heartRatesWithTimes() {
    if (this.heartRates.length !== 288) throw new Error('Need exactly 288 points at 5-min intervals')
    const midnight = Date.UTC(
      this.timestamp.getUTCFullYear(),
      this.timestamp.getUTCMonth(),
      this.timestamp.getUTCDate(),
    )
    return this.heartRates.map((value, i) => ({
      value,
      timestamp: new Date(midnight + i * 5 * 60 * 1000),
    }))
  }
}

class NoData {}

function _minutesSoFar(d) {
  return d.getUTCHours() * 60 + d.getUTCMinutes()
}

function _isToday(d) {
  if (!d) return false
  const now = new Date()
  return (
    d.getUTCFullYear() === now.getUTCFullYear() &&
    d.getUTCMonth() === now.getUTCMonth() &&
    d.getUTCDate() === now.getUTCDate()
  )
}

class HeartRateLogParser {
  constructor() { this.reset() }

  reset() {
    this._rawHeartRates = []
    this.timestamp = null
    this.size = 0
    this.index = 0
    this.range = 5
  }

  get heartRates() {
    let hr = this._rawHeartRates.slice()
    if (hr.length > 288) hr = hr.slice(0, 288)
    else if (hr.length < 288) hr = hr.concat(new Array(288 - hr.length).fill(0))
    if (_isToday(this.timestamp)) {
      const m = Math.floor(_minutesSoFar(new Date()) / 5)
      for (let i = m; i < hr.length; i++) hr[i] = 0
    }
    return hr
  }

  parse(packet) {
    const subType = packet[1]

    if (subType === 255) { this.reset(); return new NoData() }

    if (_isToday(this.timestamp) && subType === 23) {
      const result = new HeartRateLog(this.heartRates, this.timestamp, this.size, this.index, this.range)
      this.reset()
      return result
    }

    if (subType === 0) {
      this.size  = packet[2]
      this.range = packet[3]
      this._rawHeartRates = new Array(this.size * 13).fill(-1)
      return null
    }

    if (subType === 1) {
      // 4-byte LE timestamp starting at byte 2
      const ts = packet[2] | (packet[3] << 8) | (packet[4] << 16) | (packet[5] << 24)
      this.timestamp = new Date(ts * 1000)
      for (let i = 0; i < 9; i++) this._rawHeartRates[i] = packet[6 + i]
      this.index = 9
      return null
    }

    // subType >= 2: data packets (13 readings each)
    for (let i = 0; i < 13; i++) this._rawHeartRates[this.index + i] = packet[2 + i]
    this.index += 13

    if (subType === this.size - 1) {
      const result = new HeartRateLog(this.heartRates, this.timestamp, this.size, this.index, this.range)
      this.reset()
      return result
    }

    return null
  }
}

module.exports = { CMD_READ_HEART_RATE, readHeartRatePacket, HeartRateLog, NoData, HeartRateLogParser }
