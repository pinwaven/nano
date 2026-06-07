'use strict'

const { makePacket } = require('../packet.js')
const { CMD_START_REAL_TIME, CMD_STOP_REAL_TIME, RealTimeReading, REAL_TIME_MAPPING } = require('../protocol.js')

const Action = { START: 1, PAUSE: 2, CONTINUE: 3, STOP: 4 }

function getStartPacket(readingType) {
  return makePacket(CMD_START_REAL_TIME, [readingType, Action.START])
}

function getContinuePacket(readingType) {
  return makePacket(CMD_START_REAL_TIME, [readingType, Action.CONTINUE])
}

function getStopPacket(readingType) {
  return makePacket(CMD_STOP_REAL_TIME, [readingType, 0, 0])
}

// Returns { type: 'reading', kind, value } or { type: 'error', kind, code }
function parseRealTimeReading(packet) {
  const kind = packet[1]
  const errorCode = packet[2]
  if (errorCode !== 0) return { type: 'error', kind, code: errorCode }
  return { type: 'reading', kind, value: packet[3] }
}

module.exports = {
  Action, RealTimeReading, REAL_TIME_MAPPING,
  CMD_START_REAL_TIME, CMD_STOP_REAL_TIME,
  getStartPacket, getContinuePacket, getStopPacket, parseRealTimeReading,
}
