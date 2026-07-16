'use strict'

// V8 smart band BLE constants, command builders, and response parsers.
// Ported from the vendor SDK source dropped into ./temp/V8_SDK/ (package
// com.jstyle.blesdkv8, class ResolveUtil.java / BleSDK.java / DeviceConst.java).
//
// UNVALIDATED AGAINST REAL HARDWARE. This is a first pass ported directly from
// the Java source's byte arithmetic. See tools/halo/README.md for what to
// check once a real V8 band is available.
//
// IMPORTANT reassembly difference vs. Halo: the vendor SDK parses each GATT
// notification independently (see ResolveUtil's `length % recordSize` math,
// and BaseActivity.java calling DataParsingWithData() once per raw
// characteristic-changed event, with zero cross-notification byte
// concatenation). Because V8 negotiates a large MTU (~244 bytes seen in
// sample data), a single notification packs multiple stacked records
// back-to-back; a long history sync spans multiple *independent* notifications,
// each of which is itself a complete multi-record chunk. This is different
// from Halo, where each notification is exactly one record. v8.js's streaming
// helper therefore accumulates *parsed records* across notifications, not raw
// bytes — see parseXChunk() functions below, each of which parses ONE
// notification's buffer and returns { records, done }.

const SERVICE_UUID = '0000fff000001000800000805f9b34fb'
const WRITE_UUID   = '0000fff600001000800000805f9b34fb'
const NOTIFY_UUID  = '0000fff700001000800000805f9b34fb'

// Confirmed directly against real hardware (not documented anywhere in the SDK).
const V8_NAME_PREFIXES = ['JCV8B']

// --- Low-level frame primitives (identical to Halo's: 16-byte frame, byte0 =
// command, byte1..14 = payload, byte15 = additive-sum checksum mod 256) ---

function calculateChecksum(buf) {
  let sum = 0
  for (let i = 0; i < buf.length - 1; i++) sum += buf[i]
  return sum & 0xff
}

function buildCommand(cmdId, payload) {
  const buf = new Uint8Array(16)
  buf[0] = cmdId
  if (payload) {
    for (let i = 0; i < payload.length && i < 14; i++) buf[1 + i] = payload[i]
  }
  buf[15] = calculateChecksum(buf)
  return buf
}

// Decimal to BCD: e.g. 26 -> 0x26 (ResolveUtil.getTimeValue)
function decToBcd(val) {
  return parseInt(val.toString(10), 16)
}

// BCD byte to 2-char string: e.g. 0x26 -> "26" (ResolveUtil.bcd2String).
// Vendor code also decodes date fields via ByteToHexString(byte) -- for a
// BCD-encoded byte this produces the identical 2-char result (0x26's hex
// representation IS the string "26"), so a single helper covers both paths.
function bcdToString(byte) {
  return `${(byte & 0xf0) >> 4}${byte & 0x0f}`
}

// Parse 6 consecutive BCD bytes at `offset` into a "YYYY-MM-DD HH:MM:SS" string
function parseBcdDate(data, offset, hasSeconds) {
  const year  = bcdToString(data[offset])
  const month = bcdToString(data[offset + 1])
  const day   = bcdToString(data[offset + 2])
  const hour  = bcdToString(data[offset + 3])
  const min   = bcdToString(data[offset + 4])
  const base  = `20${year}-${month}-${day} ${hour}:${min}`
  if (hasSeconds) {
    const sec = bcdToString(data[offset + 5])
    return `${base}:${sec}`
  }
  return base
}

// Little-endian multi-byte integer reader (ResolveUtil.getValue(b, count) summed)
function readLEInt(buffer, offset, bytesCount) {
  let val = 0
  for (let i = 0; i < bytesCount; i++) val += buffer[offset + i] * Math.pow(256, i)
  return val
}

// History sync payload: mode byte + optional BCD date at frame bytes 4-9.
// Confirmed identical to Halo's layout via BleSDK.insertDateValue(), which
// writes Y/M/D/H/M/S at value[4..9] -- same offsets as buf[4..9] here.
function buildHistorySyncPayload(mode, dateFilter) {
  const payload = new Array(14).fill(0)
  payload[0] = mode
  if (dateFilter instanceof Date) {
    payload[3] = decToBcd(dateFilter.getFullYear() % 100)
    payload[4] = decToBcd(dateFilter.getMonth() + 1)
    payload[5] = decToBcd(dateFilter.getDate())
    payload[6] = decToBcd(dateFilter.getHours())
    payload[7] = decToBcd(dateFilter.getMinutes())
    payload[8] = decToBcd(dateFilter.getSeconds())
  }
  return payload
}

// --- Command builders (opcodes from DeviceConst.java) ---

// 0x01 -- Sync band clock to host time (BleSDK.SetDeviceTime)
function setTimePacket(date) {
  const d = date || new Date()
  const tzOffsetHours = -Math.floor(d.getTimezoneOffset() / 60)
  const zoneValue = tzOffsetHours < 0 ? Math.abs(tzOffsetHours) : (tzOffsetHours + 0x80)
  return buildCommand(0x01, [
    decToBcd(d.getFullYear() % 100),
    decToBcd(d.getMonth() + 1),
    decToBcd(d.getDate()),
    decToBcd(d.getHours()),
    decToBcd(d.getMinutes()),
    decToBcd(d.getSeconds()),
    0,
    zoneValue,
    0, 0, 0, 0, 0, 0,
  ])
}

// 0x41 -- Read band's current clock
function getTimePacket() { return buildCommand(0x41) }

// 0x02 -- Write user profile (gender, age, height cm, weight kg, stride cm)
// (BleSDK.SetPersonalInfo -- same field order as Halo's 0x02)
function setUserInfoPacket(p) {
  return buildCommand(0x02, [
    (p.gender === 'male' || p.gender === 1) ? 1 : 0,
    p.age    || 0,
    p.height || 0,
    p.weight || 0,
    p.stride || 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
  ])
}

// 0x42 -- Read user profile from band
function getUserInfoPacket() { return buildCommand(0x42) }

// 0x13 -- Battery level, charging state, raw voltage
function getBatteryPacket() { return buildCommand(0x13) }

// 0x22 -- MAC address
function getMacPacket() { return buildCommand(0x22) }

// 0x27 -- Firmware version
function getVersionPacket() { return buildCommand(0x27) }

// 0x12 -- Factory reset
function setFactoryResetPacket() { return buildCommand(0x12) }

// 0x2e -- MCU soft reset
function setMcuResetPacket() { return buildCommand(0x2E) }

// 0x2a -- Set background measurement schedule (BleSDK.SetAutomaticHRMonitoring)
// workMode: device-defined open/enable flag (see getAutoMonitoring() below)
// type: 1=HR, 2=SpO2, 3=Temperature, 4=HRV
// weekdays: bitmask, same convention as Halo (bit0=Mon...bit6=Sun)
function setAutoMonitoringPacket(s) {
  const interval = s.intervalMinutes || 5
  return buildCommand(0x2A, [
    s.workMode !== undefined ? s.workMode : 1,
    decToBcd(s.startHour   !== undefined ? s.startHour   : 0),
    decToBcd(s.startMinute !== undefined ? s.startMinute : 0),
    decToBcd(s.endHour     !== undefined ? s.endHour     : 23),
    decToBcd(s.endMinute   !== undefined ? s.endMinute   : 59),
    s.weekdays !== undefined ? s.weekdays : 0x7F,
    interval & 0xFF,
    (interval >> 8) & 0xFF,
    s.type || 1,
    0, 0, 0, 0, 0,
  ])
}

// 0x2b -- Read background schedule for a given type (1=HR, 2=SpO2, 3=Temp, 4=HRV)
function getAutoMonitoringPacket(type) {
  return buildCommand(0x2B, [type || 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
}

// --- History sync packets ---
// mode: 0x00 = read latest (up to ~50 records), 0x02 = continue from last
// read position, 0x99 = delete all data of this type. Same mode-byte
// convention and payload offsets as Halo (confirmed against
// BleSDK.DATA_READ_START/DATA_READ_CONTINUE and the 0x99 checks throughout).

// 0x51 -- Daily activity totals (26 or 27-byte records per notification, see getStepCount())
function getTotalStepDataPacket(mode, dateFilter) {
  return buildCommand(0x51, buildHistorySyncPayload(mode || 0, dateFilter || null))
}

// 0x52 -- Detailed per-minute activity logs (25-byte records)
function getDetailActivityDataPacket(mode, dateFilter) {
  return buildCommand(0x52, buildHistorySyncPayload(mode || 0, dateFilter || null))
}

// 0x53 -- Sleep history (130-byte single record @ 1-min granularity, or 34-byte records @ 5-min granularity)
function getSleepDataPacket(mode, dateFilter) {
  return buildCommand(0x53, buildHistorySyncPayload(mode || 0, dateFilter || null))
}

// 0x54 -- Continuous/dynamic HR history (24-byte records, 15 samples each)
function getDynamicHrDataPacket(mode, dateFilter) {
  return buildCommand(0x54, buildHistorySyncPayload(mode || 0, dateFilter || null))
}

// 0x55 -- Static/single-shot HR history (10-byte records, 1 sample each)
function getStaticHrDataPacket(mode, dateFilter) {
  return buildCommand(0x55, buildHistorySyncPayload(mode || 0, dateFilter || null))
}

// 0x56 -- HRV history (15-byte records: hrv, vascular-aging, hr, stress, highBP, lowBP)
function getHrvTestDataPacket(mode, dateFilter) {
  return buildCommand(0x56, buildHistorySyncPayload(mode || 0, dateFilter || null))
}

// 0x62 -- Skin/body temperature history (11-byte records)
function getTemperatureHistoryPacket(mode, dateFilter) {
  return buildCommand(0x62, buildHistorySyncPayload(mode || 0, dateFilter || null))
}

// 0x66 -- Auto SpO2 history (10-byte records, 1 sample each)
function getOxygenDataPacket(mode, dateFilter) {
  return buildCommand(0x66, buildHistorySyncPayload(mode || 0, dateFilter || null))
}

// --- Response parsers ---
// Each parseXChunk() takes ONE raw notification buffer (byte0 = echoed
// command id) and returns { records: [...], done }. Callers accumulate
// `records` across notifications until `done` is true -- see the file header
// comment for why this differs from Halo's raw-byte concatenation.

// 0x41 response (ResolveUtil.getDeviceTime)
function parseDeviceTime(r) {
  return {
    time: parseBcdDate(r, 1, true),
    week: r[7],
    mtu: r[8],
    gpsDate: `${bcdToString(r[9])}.${bcdToString(r[10])}.${bcdToString(r[11])}`,
  }
}

// 0x42 response (ResolveUtil.getUserInfo)
function parseUserInfo(r) {
  let deviceId = ''
  for (let i = 6; i < 12; i++) {
    if (r[i] === 0) continue
    deviceId += String.fromCharCode(r[i])
  }
  return { gender: r[1], age: r[2], height: r[3], weight: r[4], stride: r[5], deviceId }
}

// 0x13 response (ResolveUtil.getDeviceBattery). `level`/`chargingState`
// confirmed sane against real hardware (47%, not charging); `voltage` reads
// as a raw ADC count (~22800 seen), not calibrated millivolts -- no
// conversion formula was found in the vendor SDK, so it's exposed as-is.
function parseBattery(r) {
  return { level: r[1], chargingState: r[2], voltage: readLEInt(r, 3, 2) }
}

// 0x22 response (ResolveUtil.getDeviceAddress)
function parseMac(r) {
  return Array.from(r.slice(1, 7)).map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(':')
}

// 0x27 response (ResolveUtil.getDeviceVersion -- hex digits, NOT decimal, no zero-pad)
function parseVersion(r) {
  return [r[1], r[2], r[3], r[4]].map((b) => b.toString(16).toUpperCase()).join('.')
}

// 0x2b response (ResolveUtil.getAutoHeart). `type` is not echoed by the
// device -- pass through whatever was requested.
function parseAutoMonitoring(r, type) {
  return {
    workMode: r[1],
    startTime: `${bcdToString(r[2])}:${bcdToString(r[3])}`,
    endTime: `${bcdToString(r[4])}:${bcdToString(r[5])}`,
    weekdays: r[6],
    intervalMinutes: readLEInt(r, 7, 2),
    type,
  }
}

// 0x51 response chunk (ResolveUtil.getTotalStepData). Record size is 26 or
// 27 bytes; getStepCount() ported as-is even though the +2 base offset
// implies a 2-byte header this SDK export doesn't otherwise explain -- flag
// for verification against real hardware.
function getStepRecordSize(length) {
  if (length === 2) return 27
  if (length % 26 === 0) return 26
  if (length % 27 === 0) return 27
  if ((length - 2) % 26 === 0) return 26
  if ((length - 2) % 27 === 0) return 27
  return 27
}

function parseTotalStepChunk(buf) {
  const length = buf.length
  const count = getStepRecordSize(length)
  const size = Math.floor(length / count)
  const records = []
  let done = false
  for (let i = 0; i < size; i++) {
    const base = i * count
    const flag = 1 + (i + 1) * count
    if (flag < length && buf[flag] === 0xff) done = true
    const date = `20${bcdToString(buf[2 + base])}-${bcdToString(buf[3 + base])}-${bcdToString(buf[4 + base])}`
    const step = readLEInt(buf, 5 + base, 4)
    const exerciseMinutes = readLEInt(buf, 9 + base, 4)
    const distance = readLEInt(buf, 13 + base, 4)
    const calories = readLEInt(buf, 17 + base, 4)
    const goal = count === 26 ? buf[21 + base] : readLEInt(buf, 21 + base, 2)
    const activeMinutes = readLEInt(buf, count - 4 + base, 4)
    records.push({ date, step, exerciseMinutes, distance: distance / 100, calories: calories / 100, goal, activeMinutes })
  }
  if (size === 0) done = true
  return { records, done }
}

// 0x52 response chunk (ResolveUtil.getDetailData) -- 25-byte records
function parseDetailActivityChunk(buf) {
  const length = buf.length
  const count = 25
  const size = Math.floor(length / count)
  const records = []
  const done = size === 0 || buf[length - 1] === 0xff
  for (let i = 0; i < size; i++) {
    const base = i * count
    const date = parseBcdDate(buf, 3 + base, true)
    const step = readLEInt(buf, 9 + base, 2)
    const calories = readLEInt(buf, 11 + base, 2)
    const distance = readLEInt(buf, 13 + base, 2)
    const perMinuteSteps = []
    for (let j = 0; j < 10; j++) perMinuteSteps.push(buf[15 + j + base])
    records.push({ date, step, calories: calories / 100, distance: distance / 100, perMinuteSteps })
  }
  return { records, done }
}

// 0x53 response chunk (ResolveUtil.getSleepData) -- two record shapes:
// a single 130-byte 1-minute-granularity record, or stacked 34-byte
// 5-minute-granularity records. End is signaled by a 2-byte tail [0x53, 0xFF]
// (matching Halo's sleep terminator convention).
function parseSleepChunk(buf) {
  const length = buf.length
  const endMarker = length >= 2 && buf[length - 1] === 0xff && buf[length - 2] === 0x53
  const records = []

  if (length === 130 || (endMarker && length === 132)) {
    const date = parseBcdDate(buf, 3, true)
    const sleepLength = buf[9]
    const levels = []
    for (let j = 0; j < sleepLength; j++) levels.push(buf[10 + j])
    records.push({ date, levels, unitMinutes: 1 })
    return { records, done: true }
  }

  const count = 34
  const size = Math.floor(length / count)
  for (let i = 0; i < size; i++) {
    const base = i * count
    const date = parseBcdDate(buf, 3 + base, true)
    const sleepLength = buf[9 + base]
    const levels = []
    for (let j = 0; j < sleepLength; j++) levels.push(buf[10 + j + base])
    records.push({ date, levels, unitMinutes: 5 })
  }
  return { records, done: size === 0 || endMarker }
}

// 0x54 response chunk (ResolveUtil.getHeartData) -- 24-byte records, 15 samples each
function parseDynamicHrChunk(buf) {
  const length = buf.length
  const count = 24
  const size = Math.floor(length / count)
  const records = []
  const done = size === 0 || buf[length - 1] === 0xff
  for (let i = 0; i < size; i++) {
    const base = i * count
    const date = parseBcdDate(buf, 3 + base, true)
    const samples = []
    for (let j = 0; j < 15; j++) samples.push(buf[9 + j + base])
    records.push({ date, samples })
  }
  return { records, done }
}

// 0x55 response chunk (ResolveUtil.getOnceHeartData) -- 10-byte records, 1 sample each
function parseStaticHrChunk(buf) {
  const length = buf.length
  const count = 10
  const size = Math.floor(length / count)
  const records = []
  const done = size === 0 || buf[length - 1] === 0xff
  for (let i = 0; i < size; i++) {
    const base = i * count
    const date = parseBcdDate(buf, 3 + base, true)
    records.push({ date, heartRate: buf[9 + base] })
  }
  return { records, done }
}

// 0x56 response chunk (ResolveUtil.getHrvTestData) -- 15-byte records.
// Confirmed against real hardware: highBP/lowBP decode to realistic paired
// blood-pressure values (~120-129/70-72), so the field positions are correct
// despite the Java source's local variable names at those offsets
// ("moodValue"/"breathRate") not matching the DeviceKey labels they're
// actually stored under.
function parseHrvChunk(buf) {
  const length = buf.length
  const count = 15
  const size = Math.floor(length / count)
  const records = []
  const done = size === 0 || buf[length - 1] === 0xff
  for (let i = 0; i < size; i++) {
    const base = i * count
    const date = parseBcdDate(buf, 3 + base, true)
    records.push({
      date,
      hrv: buf[9 + base],
      vascularAging: buf[10 + base],
      heartRate: buf[11 + base],
      stress: buf[12 + base],
      highBP: buf[13 + base],
      lowBP: buf[14 + base],
    })
  }
  return { records, done }
}

// 0x62 response chunk (ResolveUtil.getTempData) -- 11-byte records
function parseTemperatureChunk(buf) {
  const length = buf.length
  const count = 11
  const size = Math.floor(length / count)
  const records = []
  const done = size === 0 || buf[length - 1] === 0xff
  for (let i = 0; i < size; i++) {
    const base = i * count
    const date = parseBcdDate(buf, 3 + base, true)
    const tempRaw = readLEInt(buf, 9 + base, 2)
    records.push({ date, temperature: tempRaw / 10 })
  }
  return { records, done }
}

// 0x66 response chunk (ResolveUtil.GetAutomaticSpo2Monitoring) -- 10-byte records
function parseOxygenChunk(buf) {
  const length = buf.length
  const count = 10
  const size = Math.floor(length / count)
  const records = []
  const done = size === 0 || buf[length - 1] === 0xff
  for (let i = 0; i < size; i++) {
    const base = i * count
    const date = parseBcdDate(buf, 3 + base, true)
    records.push({ date, spo2: buf[9 + base] })
  }
  return { records, done }
}

module.exports = {
  SERVICE_UUID, WRITE_UUID, NOTIFY_UUID, V8_NAME_PREFIXES,
  calculateChecksum, buildCommand, decToBcd, bcdToString, parseBcdDate, readLEInt,
  setTimePacket, getTimePacket,
  setUserInfoPacket, getUserInfoPacket,
  getBatteryPacket, getMacPacket, getVersionPacket,
  setFactoryResetPacket, setMcuResetPacket,
  setAutoMonitoringPacket, getAutoMonitoringPacket,
  getTotalStepDataPacket, getDetailActivityDataPacket,
  getSleepDataPacket,
  getDynamicHrDataPacket, getStaticHrDataPacket,
  getHrvTestDataPacket, getTemperatureHistoryPacket, getOxygenDataPacket,
  parseDeviceTime, parseUserInfo, parseBattery, parseMac, parseVersion, parseAutoMonitoring,
  parseTotalStepChunk, parseDetailActivityChunk, parseSleepChunk,
  parseDynamicHrChunk, parseStaticHrChunk, parseHrvChunk,
  parseTemperatureChunk, parseOxygenChunk,
}
