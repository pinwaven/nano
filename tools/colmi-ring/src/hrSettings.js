'use strict';

const { makePacket } = require('./packet');

const CMD_HEART_RATE_LOG_SETTINGS = 22; // 0x16
const READ_HEART_RATE_LOG_SETTINGS_PACKET = makePacket(CMD_HEART_RATE_LOG_SETTINGS, Buffer.from([0x01]));

function parseHeartRateLogSettings(packet) {
  const rawEnabled = packet[2];
  const enabled = rawEnabled === 1 ? true : false;
  return { enabled, interval: packet[3] };
}

function hrLogSettingsPacket(settings) {
  if (settings.interval <= 0 || settings.interval > 255) {
    throw new Error('Interval must be between 1 and 255');
  }
  const enabled = settings.enabled ? 1 : 2;
  return makePacket(CMD_HEART_RATE_LOG_SETTINGS, Buffer.from([2, enabled, settings.interval]));
}

module.exports = {
  CMD_HEART_RATE_LOG_SETTINGS,
  READ_HEART_RATE_LOG_SETTINGS_PACKET,
  parseHeartRateLogSettings,
  hrLogSettingsPacket,
};
