'use strict';

const { makePacket } = require('./packet');
const dateUtils = require('./dateUtils');

const CMD_READ_HEART_RATE = 21; // 0x15

function readHeartRatePacket(target) {
  const data = Buffer.alloc(4);
  data.writeUInt32LE(Math.floor(target.getTime() / 1000));
  return makePacket(CMD_READ_HEART_RATE, data);
}

class HeartRateLog {
  constructor(heartRates, timestamp, size, index, range) {
    this.heartRates = heartRates;
    this.timestamp = timestamp;
    this.size = size;
    this.index = index;
    this.range = range;
  }

  heartRatesWithTimes() {
    if (this.heartRates.length !== 288) throw new Error('Need exactly 288 points at 5 minute intervals');
    const result = [];
    const midnight = Date.UTC(
      this.timestamp.getUTCFullYear(),
      this.timestamp.getUTCMonth(),
      this.timestamp.getUTCDate()
    );
    for (let i = 0; i < 288; i++) {
      result.push([this.heartRates[i], new Date(midnight + i * 5 * 60 * 1000)]);
    }
    return result;
  }
}

class NoData {}

class HeartRateLogParser {
  constructor() {
    this.reset();
  }

  reset() {
    this._rawHeartRates = [];
    this.timestamp = null;
    this.size = 0;
    this.index = 0;
    this.end = false;
    this.range = 5;
  }

  isToday() {
    return this.timestamp !== null && dateUtils.isToday(this.timestamp);
  }

  get heartRates() {
    let hr = this._rawHeartRates.slice();
    if (hr.length > 288) {
      hr = hr.slice(0, 288);
    } else if (hr.length < 288) {
      hr = hr.concat(new Array(288 - hr.length).fill(0));
    }
    if (this.isToday()) {
      const m = Math.floor(dateUtils.minutesSoFar(new Date()) / 5);
      for (let i = m; i < hr.length; i++) hr[i] = 0;
    }
    return hr;
  }

  parse(packet) {
    const subType = packet[1];

    if (subType === 255) {
      this.reset();
      return new NoData();
    }

    if (this.isToday() && subType === 23) {
      const result = new HeartRateLog(this.heartRates, this.timestamp, this.size, this.index, this.range);
      this.reset();
      return result;
    }

    if (subType === 0) {
      this.end = false;
      this.size = packet[2];
      this.range = packet[3];
      this._rawHeartRates = new Array(this.size * 13).fill(-1);
      return null;
    }

    if (subType === 1) {
      const ts = packet.readInt32LE(2);
      this.timestamp = new Date(ts * 1000);
      // 9 readings starting at packet[6], ending before last byte (CRC)
      for (let i = 0; i < 9; i++) {
        this._rawHeartRates[i] = packet[6 + i];
      }
      this.index = 9;
      return null;
    }

    // subType >= 2: data packets
    for (let i = 0; i < 13; i++) {
      this._rawHeartRates[this.index + i] = packet[2 + i];
    }
    this.index += 13;

    if (subType === this.size - 1) {
      const result = new HeartRateLog(this.heartRates, this.timestamp, this.size, this.index, this.range);
      this.reset();
      return result;
    }

    return null;
  }
}

module.exports = { CMD_READ_HEART_RATE, readHeartRatePacket, HeartRateLog, NoData, HeartRateLogParser };
