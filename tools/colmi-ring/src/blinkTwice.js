'use strict';

const { makePacket } = require('./packet');

const CMD_BLINK_TWICE = 16;
const BLINK_TWICE_PACKET = makePacket(CMD_BLINK_TWICE);

module.exports = { CMD_BLINK_TWICE, BLINK_TWICE_PACKET };
