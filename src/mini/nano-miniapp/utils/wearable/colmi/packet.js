'use strict'

// Colmi ring packet builder.
// All packets are fixed 16 bytes: [command, ...payload (max 14 bytes), checksum]

function checksum(packet) {
  let sum = 0
  for (let i = 0; i < packet.length; i++) sum += packet[i]
  return sum & 0xff
}

// command: 0-255
// subData: Uint8Array or plain Array (max 14 bytes), or null
function makePacket(command, subData) {
  if (command < 0 || command > 255) throw new Error('Invalid command, must be 0-255')
  const packet = new Uint8Array(16)
  packet[0] = command
  if (subData && subData.length > 0) {
    if (subData.length > 14) throw new Error('subData must be at most 14 bytes')
    for (let i = 0; i < subData.length; i++) packet[1 + i] = subData[i]
  }
  packet[15] = checksum(packet)
  return packet
}

module.exports = { makePacket, checksum }
