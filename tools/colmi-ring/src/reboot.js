'use strict';

const { makePacket } = require('./packet');

const CMD_REBOOT = 8;
const REBOOT_PACKET = makePacket(CMD_REBOOT, Buffer.from([0x01]));

module.exports = { CMD_REBOOT, REBOOT_PACKET };
