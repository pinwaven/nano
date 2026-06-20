'use strict'

// WeChat-compatible port of temp/aizo/src/aizo_protocol.js.
// All Buffer usage is replaced with Uint8Array + DataView helpers.

const BLE_SERVICE_UUID  = '0000fe02-0000-1000-8000-00805f9b34fb'
const WRITE_UUID        = '00000101-0000-1000-8000-00805f9b34fb'
const NOTIFY_UUID       = '0000010a-0000-1000-8000-00805f9b34fb'
const AIZO_NAME_PREFIXES = ['infinity']

// --- Uint8Array helpers (replace Node.js Buffer) ---

function concatBytes(...arrays) {
  const total = arrays.reduce((s, a) => s + a.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const a of arrays) { out.set(a, off); off += a.length }
  return out
}

function toHex(arr) {
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(hex) {
  const arr = new Uint8Array(hex.length / 2)
  for (let i = 0; i < arr.length; i++) arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return arr
}

// Encode ASCII string to bytes (protocol strings are ASCII-safe)
function strToBytes(str) {
  const arr = new Uint8Array(str.length)
  for (let i = 0; i < str.length; i++) arr[i] = str.charCodeAt(i) & 0xFF
  return arr
}

function readU16BE(arr, off) {
  return ((arr[off] << 8) | arr[off + 1]) & 0xFFFF
}

function readU32BE(arr, off) {
  return (((arr[off] << 24) | (arr[off + 1] << 16) | (arr[off + 2] << 8) | arr[off + 3]) >>> 0)
}

function writeU16BE(arr, val, off) {
  arr[off]     = (val >> 8) & 0xFF
  arr[off + 1] = val & 0xFF
}

function writeU32BE(arr, val, off) {
  arr[off]     = (val >>> 24) & 0xFF
  arr[off + 1] = (val >>> 16) & 0xFF
  arr[off + 2] = (val >>> 8)  & 0xFF
  arr[off + 3] = val & 0xFF
}

// --- CRC16-CCITT ---

function calculateCrc16(data) {
  let crc = 0xFFFF
  for (let i = 0; i < data.length; i++) {
    const b = data[i]
    const x = (((crc >> 8) | (crc << 8)) & 0xFFFF) ^ b
    const y = x ^ ((x & 0xFF) >> 4)
    const z = y ^ ((y << 12) & 0xFFFF)
    crc = z ^ ((z << 5) & 0xFFFF)
  }
  return crc & 0xFFFF
}

// --- Nibble-packed header bytes ---

function makeNibbleBytes(arg4, arg3, constVal) {
  constVal = constVal || 0
  const hexStr =
    (arg4 & 0xF).toString(16) +
    (arg3 & 0xFF).toString(16).padStart(2, '0') +
    (constVal & 0xFFF).toString(16).padStart(3, '0')
  return hexToBytes(hexStr)
}

// --- Frame builder / parser ---

function buildFrame(cmdId, payload, arg3, arg4, seq) {
  payload = payload || new Uint8Array(0)
  arg3 = arg3 || 0
  arg4 = arg4 || 0
  seq  = seq  || 0

  const prefix  = new Uint8Array([0x02, seq & 0xFF])
  const version = new Uint8Array([0x00, 0x03])
  const cmd     = new Uint8Array([cmdId & 0xFF])
  const nibbles = makeNibbleBytes(arg4, arg3, 0)
  const header  = concatBytes(prefix, version, cmd, nibbles)

  const payloadLen = new Uint8Array(2)
  writeU16BE(payloadLen, payload.length, 0)

  const crcVal  = calculateCrc16(payload)
  const crcBytes = new Uint8Array(2)
  writeU16BE(crcBytes, crcVal, 0)

  const innerLen = payloadLen.length + payload.length + crcBytes.length
  const totalLen = new Uint8Array(2)
  writeU16BE(totalLen, innerLen, 0)

  return concatBytes(totalLen, header, payloadLen, payload, crcBytes)
}

function parseFrame(data) {
  if (data.length < 12) return null

  const totalLen = readU16BE(data, 0)
  if (data.length < 2 + 8 + totalLen) return null

  const payloadLen = readU16BE(data, 10)
  const payload    = data.subarray(12, 12 + payloadLen)
  const crcReceived = readU16BE(data, 12 + payloadLen)
  const crcCalc    = calculateCrc16(payload)
  if (crcReceived !== crcCalc) throw new Error('Aizo CRC mismatch')

  const prefixVal = readU16BE(data, 2)
  const binStr    = prefixVal.toString(2).padStart(16, '0')

  const cmdId = data[6]

  return {
    to:         parseInt(binStr.slice(14, 16), 2),
    ack:        parseInt(binStr.slice(12, 14), 2),
    seq:        parseInt(binStr.slice(8, 12), 2),
    sender:     parseInt(binStr.slice(6, 8), 2),
    bleVersion: parseInt(binStr[5], 2),
    type:       parseInt(binStr.slice(3, 5), 2),
    cmdId,
    payload,
  }
}

// --- Timestamp ---

function getTimeBytes(timestamp) {
  const d = timestamp ? new Date(timestamp * 1000) : new Date()
  return new Uint8Array([
    d.getFullYear() % 100,
    d.getMonth() + 1,
    d.getDate(),
    d.getHours(),
    d.getMinutes(),
    d.getSeconds(),
  ])
}

// Replicates Java String.hashCode() (signed 32-bit)
function javaHashcode(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = ((31 * h) + str.charCodeAt(i)) | 0
  return h
}

// --- Command builders ---

function getBindRequest(compId, appName, language, rom, encrypt) {
  appName  = appName  || 'AizoRingApp'
  language = language || 1
  rom      = rom      || 1
  encrypt  = encrypt  || 0

  const cmdPrefix  = new Uint8Array([0x30, 0x30, encrypt ? 1 : 0])
  const timeBytes  = getTimeBytes()
  const tzOffset   = -new Date().getTimezoneOffset()
  const tzIndex    = Math.floor(tzOffset / 60)
  const tzBytes    = new Uint8Array([tzIndex & 0xFF])
  const langBytes  = new Uint8Array([language & 0xFF])
  const romBytes   = new Uint8Array([rom & 0xFF])

  const mockDevId  = '5324628795130'
  const devHash    = javaHashcode(mockDevId)
  const appHash    = javaHashcode(appName)

  const uuidBuf    = new Uint8Array(16)
  writeU32BE(uuidBuf, devHash >>> 0, 0)
  writeU16BE(uuidBuf, appHash & 0xFFFF, 4)
  writeU16BE(uuidBuf, (appHash >> 16) & 0xFFFF, 6)

  const appIdBytes = strToBytes(toHex(uuidBuf))
  const footBytes  = strToBytes(`;2.1.2;${compId};`)

  const payload = concatBytes(cmdPrefix, timeBytes, tzBytes, langBytes, romBytes, appIdBytes, footBytes)
  return buildFrame(0x30, payload)
}

function getStepInfoRequest() {
  return buildFrame(0x33, concatBytes(new Uint8Array([0x33, 0x33]), getTimeBytes()))
}

function getSleepInfoRequest() {
  return buildFrame(0x35, concatBytes(new Uint8Array([0x35, 0x35]), getTimeBytes()))
}

function getPressureRequest() {
  return buildFrame(0x31, concatBytes(new Uint8Array([0x31, 0x32]), getTimeBytes()))
}

function getWatchInfoRequest(infoType) {
  infoType = infoType != null ? infoType : 2
  return buildFrame(0x38, concatBytes(new Uint8Array([0x38, 0x38, infoType & 0xFF]), getTimeBytes()))
}

function getHeartRateRequest() {
  return buildFrame(0x31, concatBytes(new Uint8Array([0x31, 0x31]), getTimeBytes()))
}

function getSpO2Request() {
  return buildFrame(0x32, concatBytes(new Uint8Array([0x32, 0x32]), getTimeBytes()))
}

// --- Response parsers ---

function parseDeviceStatus(payload) {
  if (payload.length < 5) throw new Error('Invalid status payload')
  return {
    batteryPercent: payload[3],
    workingMode:    payload[4],
  }
}

function splitBytes(data, segmentSizes) {
  const segments = []
  let off = 0
  for (const size of segmentSizes) {
    segments.push(data.subarray(off, off + size))
    off += size
  }
  if (off < data.length) segments.push(data.subarray(off))
  return segments
}

function parseStepInfo(payload) {
  const segs = splitBytes(payload, [2, 6, 4, 4, 4])
  if (segs.length < 5) throw new Error('Invalid step payload')
  const t = segs[1]
  const pad = n => String(n).padStart(2, '0')
  return {
    timestamp: `${t[0] + 2000}-${pad(t[1])}-${pad(t[2])} ${pad(t[3])}:${pad(t[4])}:${pad(t[5])}`,
    steps:    readU32BE(segs[2], 0),
    calories: readU32BE(segs[3], 0) * 100,
    distance: readU32BE(segs[4], 0) / 100.0,
  }
}

function parseSleepDetail(payload) {
  if (payload.length < 8) throw new Error('Invalid sleep payload')
  const b0 = readU32BE(payload, 0)
  const b1 = readU32BE(payload, 4)
  const bin0 = b0.toString(2).padStart(32, '0')
  const bin1 = b1.toString(2).padStart(32, '0')

  const year  = parseInt(bin0.slice(1, 7),  2) + 2000
  const month = parseInt(bin0.slice(7, 11), 2)
  const day   = parseInt(bin0.slice(11, 16), 2)

  const offsetMinutes = parseInt(bin1.slice(0, 16), 2)
  const flag  = parseInt(bin1.slice(27, 28), 2)
  const mode  = parseInt(bin1.slice(28, 32), 2)

  const h = Math.floor(offsetMinutes / 60)
  const m = offsetMinutes % 60
  const pad = n => String(n).padStart(2, '0')
  return {
    timestamp:     `${year}-${pad(month)}-${pad(day)} ${pad(h)}:${pad(m)}:00`,
    offsetMinutes,
    sleepFlag:     flag,
    sleepMode:     mode,  // 0=Awake 1=Light 2=Deep 3=REM
  }
}

function parsePressure(payload) {
  if (payload.length < 2) throw new Error('Invalid pressure payload')
  const header = toHex(payload.subarray(0, 2))
  const rest   = payload.subarray(2)
  const pad = n => String(n).padStart(2, '0')

  if (header === '7172') {
    if (rest.length < 7) throw new Error('Invalid realtime pressure payload')
    const year  = rest[0] + 2000
    const ts    = `${year}-${pad(rest[1])}-${pad(rest[2])} ${pad(rest[3])}:${pad(rest[4])}:${pad(rest[5])}`
    return { type: 'realtime', timestamp: ts, value: rest[6] }
  }

  if (header === '7162') {
    if (rest.length % 4 !== 0) throw new Error('Invalid history pressure payload')
    const now      = new Date()
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime()
    const records  = []
    for (let i = 0; i < rest.length; i += 4) {
      const flag          = rest[i]
      const minutesOffset = readU16BE(rest, i + 1) * 30
      const value         = rest[i + 3]
      const ts            = new Date(midnight + minutesOffset * 60 * 1000)
      records.push({
        flag,
        offsetMinutes: minutesOffset,
        timestamp: `${ts.getFullYear()}-${pad(ts.getMonth() + 1)}-${pad(ts.getDate())} ${pad(ts.getHours())}:${pad(ts.getMinutes())}:${pad(ts.getSeconds())}`,
        value,
      })
    }
    return { type: 'history', records }
  }

  throw new Error(`Unknown pressure header: ${header}`)
}

module.exports = {
  BLE_SERVICE_UUID, WRITE_UUID, NOTIFY_UUID, AIZO_NAME_PREFIXES,
  calculateCrc16,
  buildFrame, parseFrame,
  getTimeBytes,
  getBindRequest,
  getStepInfoRequest, getSleepInfoRequest, getPressureRequest,
  getWatchInfoRequest, getHeartRateRequest, getSpO2Request,
  parseDeviceStatus, parseStepInfo, parseSleepDetail, parsePressure,
}
