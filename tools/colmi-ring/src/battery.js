'use strict';

const { makePacket } = require('./packet');

const CMD_BATTERY = 3;
const BATTERY_PACKET = makePacket(CMD_BATTERY);

function parseBattery(packet) {
  return { batteryLevel: packet[1], charging: packet[2] === 1 };
}

module.exports = { CMD_BATTERY, BATTERY_PACKET, parseBattery };
