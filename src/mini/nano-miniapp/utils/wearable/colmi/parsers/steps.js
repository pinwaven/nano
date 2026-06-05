'use strict'

const { makePacket } = require('../packet.js')
const { CMD_GET_STEP_SOMEDAY } = require('../protocol.js')

function readStepsPacket(dayOffset) {
  return makePacket(CMD_GET_STEP_SOMEDAY, [dayOffset || 0, 0x0f, 0x00, 0x5f, 0x01])
}

function bcdToDecimal(b) {
  return (((b >> 4) & 15) * 10) + (b & 15)
}

class SportDetail {
  constructor(year, month, day, timeIndex, calories, steps, distance) {
    this.year = year
    this.month = month
    this.day = day
    this.timeIndex = timeIndex
    this.calories = calories
    this.steps = steps
    this.distance = distance
  }

  get timestamp() {
    return new Date(Date.UTC(
      this.year, this.month - 1, this.day,
      Math.floor(this.timeIndex / 4),
      (this.timeIndex % 4) * 15,
    ))
  }

  toObject() {
    return {
      year: this.year, month: this.month, day: this.day,
      timeIndex: this.timeIndex, calories: this.calories,
      steps: this.steps, distance: this.distance,
    }
  }
}

class NoData {}

class SportDetailParser {
  constructor() { this.reset() }

  reset() {
    this.newCalorieProtocol = false
    this.index = 0
    this.details = []
  }

  parse(packet) {
    if (packet.length !== 16) throw new Error('Packet must be 16 bytes')
    if (packet[0] !== CMD_GET_STEP_SOMEDAY) throw new Error('Wrong command byte')

    if (this.index === 0 && packet[1] === 255) { this.reset(); return new NoData() }
    if (this.index === 0 && packet[1] === 240) {
      if (packet[3] === 1) this.newCalorieProtocol = true
      this.index += 1
      return null
    }

    const year  = bcdToDecimal(packet[1]) + 2000
    const month = bcdToDecimal(packet[2])
    const day   = bcdToDecimal(packet[3])
    const timeIndex = packet[4]
    let calories = packet[7] | (packet[8] << 8)
    if (this.newCalorieProtocol) calories *= 10
    const steps    = packet[9]  | (packet[10] << 8)
    const distance = packet[11] | (packet[12] << 8)

    this.details.push(new SportDetail(year, month, day, timeIndex, calories, steps, distance))

    if (packet[5] === packet[6] - 1) {
      const result = this.details.slice()
      this.reset()
      return result
    }

    this.index += 1
    return null
  }
}

module.exports = { CMD_GET_STEP_SOMEDAY, readStepsPacket, bcdToDecimal, SportDetail, NoData, SportDetailParser }
