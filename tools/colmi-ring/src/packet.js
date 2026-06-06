'use strict';

function checksum(packet) {
  let sum = 0;
  for (let i = 0; i < packet.length; i++) sum += packet[i];
  return sum & 0xff;
}

function makePacket(command, subData = null) {
  if (command < 0 || command > 255) throw new Error('Invalid command, must be between 0 and 255');
  const packet = Buffer.alloc(16, 0);
  packet[0] = command;
  if (subData && subData.length > 0) {
    if (subData.length > 14) throw new Error('Sub data must be at most 14 bytes');
    subData.copy(packet, 1, 0, subData.length);
  }
  packet[15] = checksum(packet);
  return packet;
}

module.exports = { makePacket, checksum };
