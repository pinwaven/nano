'use strict'

const { makePacket } = require('../packet.js')
const { CMD_BATTERY } = require('../protocol.js')

const BATTERY_PACKET = makePacket(CMD_BATTERY)

// packet: Uint8Array — [cmd, level, charging, ...]
function parseBattery(packet) {
  return { level: packet[1], charging: packet[2] === 1 }
}

module.exports = { CMD_BATTERY, BATTERY_PACKET, parseBattery }
