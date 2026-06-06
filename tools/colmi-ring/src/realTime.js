'use strict';

const { makePacket } = require('./packet');

const Action = { START: 1, PAUSE: 2, CONTINUE: 3, STOP: 4 };

const RealTimeReading = {
  HEART_RATE: 1,
  BLOOD_PRESSURE: 2,
  SPO2: 3,
  FATIGUE: 4,
  HEALTH_CHECK: 5,
  ECG: 7,
  PRESSURE: 8,
  BLOOD_SUGAR: 9,
  HRV: 10,
};

const REAL_TIME_MAPPING = {
  'heart-rate': RealTimeReading.HEART_RATE,
  'blood-pressure': RealTimeReading.BLOOD_PRESSURE,
  'spo2': RealTimeReading.SPO2,
  'fatigue': RealTimeReading.FATIGUE,
  'health-check': RealTimeReading.HEALTH_CHECK,
  'ecg': RealTimeReading.ECG,
  'pressure': RealTimeReading.PRESSURE,
  'blood-sugar': RealTimeReading.BLOOD_SUGAR,
  'hrv': RealTimeReading.HRV,
};

const CMD_START_REAL_TIME = 105;
const CMD_STOP_REAL_TIME = 106;
const CMD_REAL_TIME_HEART_RATE = 30;
const CONTINUE_HEART_RATE_PACKET = makePacket(CMD_REAL_TIME_HEART_RATE, Buffer.from('3'));

function getStartPacket(readingType) {
  return makePacket(CMD_START_REAL_TIME, Buffer.from([readingType, Action.START]));
}

function getContinuePacket(readingType) {
  return makePacket(CMD_START_REAL_TIME, Buffer.from([readingType, Action.CONTINUE]));
}

function getStopPacket(readingType) {
  return makePacket(CMD_STOP_REAL_TIME, Buffer.from([readingType, 0, 0]));
}

function parseRealTimeReading(packet) {
  const kind = packet[1];
  const errorCode = packet[2];
  if (errorCode !== 0) {
    return { type: 'error', kind, code: errorCode };
  }
  return { type: 'reading', kind, value: packet[3] };
}

module.exports = {
  Action,
  RealTimeReading,
  REAL_TIME_MAPPING,
  CMD_START_REAL_TIME,
  CMD_STOP_REAL_TIME,
  CMD_REAL_TIME_HEART_RATE,
  CONTINUE_HEART_RATE_PACKET,
  getStartPacket,
  getContinuePacket,
  getStopPacket,
  parseRealTimeReading,
};
