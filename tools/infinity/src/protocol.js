'use strict';

const BLE_SERVICE_UUID = '0000fe02-0000-1000-8000-00805f9b34fb';
const WRITE_UUID = '00000101-0000-1000-8000-00805f9b34fb';
const NOTIFY_UUID = '0000010a-0000-1000-8000-00805f9b34fb';
const INFINITY_NAME_PREFIXES = ['infinity'];

function concatBytes(...arrays) {
  const total = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    out.set(arr, offset);
    offset += arr.length;
  }
  return out;
}

function toHex(arr) {
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const clean = String(hex || '').replace(/^0x/i, '').replace(/\s+/g, '');
  if (clean.length % 2 !== 0) throw new Error(`Hex string has odd length: ${hex}`);
  const arr = new Uint8Array(clean.length / 2);
  for (let i = 0; i < arr.length; i += 1) {
    arr[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return arr;
}

function strToBytes(str) {
  const arr = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i += 1) arr[i] = str.charCodeAt(i) & 0xff;
  return arr;
}

function readU16BE(arr, off) {
  return ((arr[off] << 8) | arr[off + 1]) & 0xffff;
}

function readU32BE(arr, off) {
  return (((arr[off] << 24) | (arr[off + 1] << 16) | (arr[off + 2] << 8) | arr[off + 3]) >>> 0);
}

function writeU16BE(arr, val, off) {
  arr[off] = (val >> 8) & 0xff;
  arr[off + 1] = val & 0xff;
}

function writeU32BE(arr, val, off) {
  arr[off] = (val >>> 24) & 0xff;
  arr[off + 1] = (val >>> 16) & 0xff;
  arr[off + 2] = (val >>> 8) & 0xff;
  arr[off + 3] = val & 0xff;
}

function calculateCrc16(data) {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i += 1) {
    const x = (((crc >> 8) | (crc << 8)) & 0xffff) ^ data[i];
    const y = x ^ ((x & 0xff) >> 4);
    const z = y ^ ((y << 12) & 0xffff);
    crc = z ^ ((z << 5) & 0xffff);
  }
  return crc & 0xffff;
}

function makeNibbleBytes(arg4, arg3, constVal = 0) {
  const hexStr =
    (arg4 & 0xf).toString(16) +
    (arg3 & 0xff).toString(16).padStart(2, '0') +
    (constVal & 0xfff).toString(16).padStart(3, '0');
  return hexToBytes(hexStr);
}

function buildFrame(cmdId, payload = new Uint8Array(0), arg3 = 0, arg4 = 0, seq = 0) {
  const prefix = new Uint8Array([0x02, seq & 0xff]);
  const version = new Uint8Array([0x00, 0x03]);
  const cmd = new Uint8Array([cmdId & 0xff]);
  const nibbles = makeNibbleBytes(arg4, arg3, 0);
  const header = concatBytes(prefix, version, cmd, nibbles);

  const payloadLen = new Uint8Array(2);
  writeU16BE(payloadLen, payload.length, 0);

  const crcBytes = new Uint8Array(2);
  writeU16BE(crcBytes, calculateCrc16(payload), 0);

  const totalLen = new Uint8Array(2);
  writeU16BE(totalLen, payloadLen.length + payload.length + crcBytes.length, 0);

  return concatBytes(totalLen, header, payloadLen, payload, crcBytes);
}

function parseFrame(data) {
  if (!data || data.length < 12) return null;
  const totalLen = readU16BE(data, 0);
  if (data.length < 2 + 8 + totalLen) return null;

  const payloadLen = readU16BE(data, 10);
  const payload = data.subarray(12, 12 + payloadLen);
  const crcReceived = readU16BE(data, 12 + payloadLen);
  const crcCalc = calculateCrc16(payload);
  if (crcReceived !== crcCalc) throw new Error(`Infinity CRC mismatch: got 0x${crcReceived.toString(16)}, expected 0x${crcCalc.toString(16)}`);

  const prefixVal = readU16BE(data, 2);
  const binStr = prefixVal.toString(2).padStart(16, '0');

  return {
    to: parseInt(binStr.slice(14, 16), 2),
    ack: parseInt(binStr.slice(12, 14), 2),
    seq: parseInt(binStr.slice(8, 12), 2),
    sender: parseInt(binStr.slice(6, 8), 2),
    bleVersion: parseInt(binStr[5], 2),
    type: parseInt(binStr.slice(3, 5), 2),
    cmdId: data[6],
    payload,
    raw: data,
  };
}

function getTimeBytes(timestamp) {
  const d = timestamp ? new Date(timestamp * 1000) : new Date();
  return new Uint8Array([
    d.getFullYear() % 100,
    d.getMonth() + 1,
    d.getDate(),
    d.getHours(),
    d.getMinutes(),
    d.getSeconds(),
  ]);
}

function javaHashcode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) h = ((31 * h) + str.charCodeAt(i)) | 0;
  return h;
}

function getBindRequest(compId = 'waven', appName = 'AizoRingApp', language = 1, rom = 1, encrypt = 0) {
  const cmdPrefix = new Uint8Array([0x30, 0x30, encrypt ? 1 : 0]);
  const timeBytes = getTimeBytes();
  const tzIndex = Math.floor((-new Date().getTimezoneOffset()) / 60);
  const meta = new Uint8Array([tzIndex & 0xff, language & 0xff, rom & 0xff]);

  const mockDevId = '5324628795130';
  const devHash = javaHashcode(mockDevId);
  const appHash = javaHashcode(appName);
  const uuidBuf = new Uint8Array(16);
  writeU32BE(uuidBuf, devHash >>> 0, 0);
  writeU16BE(uuidBuf, appHash & 0xffff, 4);
  writeU16BE(uuidBuf, (appHash >> 16) & 0xffff, 6);

  const payload = concatBytes(
    cmdPrefix,
    timeBytes,
    meta,
    strToBytes(toHex(uuidBuf)),
    strToBytes(`;2.1.2;${compId};`),
  );
  return buildFrame(0x30, payload);
}

function getStepInfoRequest() {
  return buildFrame(0x33, concatBytes(new Uint8Array([0x33, 0x33]), getTimeBytes()));
}

function getSleepInfoRequest() {
  return buildFrame(0x35, concatBytes(new Uint8Array([0x35, 0x35]), getTimeBytes()));
}

function getPressureRequest() {
  return buildFrame(0x31, concatBytes(new Uint8Array([0x31, 0x32]), getTimeBytes()));
}

function getWatchInfoRequest(infoType = 2) {
  return buildFrame(0x38, concatBytes(new Uint8Array([0x38, 0x38, infoType & 0xff]), getTimeBytes()));
}

function getHeartRateRequest() {
  return buildFrame(0x31, concatBytes(new Uint8Array([0x31, 0x31]), getTimeBytes()));
}

function getSpO2Request() {
  return buildFrame(0x32, concatBytes(new Uint8Array([0x32, 0x32]), getTimeBytes()));
}

function parseDeviceStatus(payload) {
  if (payload.length < 5) throw new Error('Invalid status payload');
  return {
    batteryPercent: payload[3],
    workingMode: payload[4],
    rawHex: toHex(payload),
  };
}

function splitBytes(data, segmentSizes) {
  const segments = [];
  let off = 0;
  for (const size of segmentSizes) {
    segments.push(data.subarray(off, off + size));
    off += size;
  }
  if (off < data.length) segments.push(data.subarray(off));
  return segments;
}

function parseStepInfo(payload) {
  const segs = splitBytes(payload, [2, 6, 4, 4, 4]);
  if (segs.length < 5) throw new Error('Invalid step payload');
  const t = segs[1];
  return {
    timestamp: formatTimestampParts(t[0] + 2000, t[1], t[2], t[3], t[4], t[5]),
    steps: readU32BE(segs[2], 0),
    calories: readU32BE(segs[3], 0) * 100,
    distanceMeters: readU32BE(segs[4], 0) / 100.0,
    rawHex: toHex(payload),
  };
}

function parseSleepDetail(payload) {
  if (payload.length < 8) throw new Error('Invalid sleep payload');
  const b0 = readU32BE(payload, 0);
  const b1 = readU32BE(payload, 4);
  const bin0 = b0.toString(2).padStart(32, '0');
  const bin1 = b1.toString(2).padStart(32, '0');

  const year = parseInt(bin0.slice(1, 7), 2) + 2000;
  const month = parseInt(bin0.slice(7, 11), 2);
  const day = parseInt(bin0.slice(11, 16), 2);
  const offsetMinutes = parseInt(bin1.slice(0, 16), 2);
  const flag = parseInt(bin1.slice(27, 28), 2);
  const mode = parseInt(bin1.slice(28, 32), 2);
  const hour = Math.floor(offsetMinutes / 60);
  const minute = offsetMinutes % 60;

  return {
    timestamp: formatTimestampParts(year, month, day, hour, minute, 0),
    date: `${year}-${pad(month)}-${pad(day)}`,
    offsetMinutes,
    sleepFlag: flag,
    sleepMode: mode,
    sleepModeName: ({ 0: 'awake', 1: 'light', 2: 'deep', 3: 'rem' })[mode] || 'unknown',
    rawHex: toHex(payload),
  };
}

function parsePressure(payload) {
  if (payload.length < 2) throw new Error('Invalid pressure payload');
  const header = toHex(payload.subarray(0, 2));
  const rest = payload.subarray(2);

  if (header === '7172') {
    if (rest.length < 7) throw new Error('Invalid realtime pressure payload');
    return {
      type: 'realtime',
      timestamp: formatTimestampParts(rest[0] + 2000, rest[1], rest[2], rest[3], rest[4], rest[5]),
      value: rest[6],
      rawHex: toHex(payload),
    };
  }

  if (header === '7162') {
    if (rest.length % 4 !== 0) throw new Error('Invalid history pressure payload');
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
    const records = [];
    for (let i = 0; i < rest.length; i += 4) {
      const minutesOffset = readU16BE(rest, i + 1) * 30;
      const ts = new Date(midnight + minutesOffset * 60 * 1000);
      records.push({
        flag: rest[i],
        offsetMinutes: minutesOffset,
        timestamp: formatTimestampParts(ts.getFullYear(), ts.getMonth() + 1, ts.getDate(), ts.getHours(), ts.getMinutes(), ts.getSeconds()),
        value: rest[i + 3],
      });
    }
    return { type: 'history', records, rawHex: toHex(payload) };
  }

  throw new Error(`Unknown pressure header: ${header}`);
}

function parseTimestampValueRecords(payload, { min = 0, max = 255, label = 'value' } = {}) {
  const records = [];
  for (let off = 0; off + 7 <= payload.length; off += 7) {
    const year = payload[off] + 2000;
    const month = payload[off + 1];
    const day = payload[off + 2];
    const hour = payload[off + 3];
    const minute = payload[off + 4];
    const second = payload[off + 5];
    const value = payload[off + 6];
    if (!isPlausibleDateParts(year, month, day, hour, minute, second)) continue;
    if (value < min || value > max) continue;
    records.push({ timestamp: formatTimestampParts(year, month, day, hour, minute, second), [label]: value });
  }
  return records;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function formatTimestampParts(year, month, day, hour, minute, second) {
  return `${year}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

function isPlausibleDateParts(year, month, day, hour, minute, second) {
  return year >= 2020 && year <= 2099 &&
    month >= 1 && month <= 12 &&
    day >= 1 && day <= 31 &&
    hour >= 0 && hour <= 23 &&
    minute >= 0 && minute <= 59 &&
    second >= 0 && second <= 59;
}

module.exports = {
  BLE_SERVICE_UUID,
  WRITE_UUID,
  NOTIFY_UUID,
  INFINITY_NAME_PREFIXES,
  calculateCrc16,
  buildFrame,
  parseFrame,
  concatBytes,
  hexToBytes,
  toHex,
  getBindRequest,
  getStepInfoRequest,
  getSleepInfoRequest,
  getPressureRequest,
  getWatchInfoRequest,
  getHeartRateRequest,
  getSpO2Request,
  parseDeviceStatus,
  parseStepInfo,
  parseSleepDetail,
  parsePressure,
  parseTimestampValueRecords,
};
