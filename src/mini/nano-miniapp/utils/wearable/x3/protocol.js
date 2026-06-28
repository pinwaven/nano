'use strict'

// X3 Smart Ring BLE constants and command builders.

const SERVICE_UUID = '0000fff000001000800000805f9b34fb'
const WRITE_UUID   = '0000fff600001000800000805f9b34fb'
const NOTIFY_UUID  = '0000fff700001000800000805f9b34fb'

const NOTIFY_MAP = {
  [SERVICE_UUID]: { txCharUUID: NOTIFY_UUID, rxCharUUID: WRITE_UUID },
}

const X3_NAME_PREFIXES = ['X3', 'X6']

// --- Low-level frame primitives ---

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

// Decimal to BCD: e.g. 26 → 0x26
function decToBcd(val) {
  return parseInt(val.toString(10), 16)
}

// BCD byte to 2-char string: e.g. 0x26 → "26"
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

// Little-endian multi-byte integer reader
function readLEInt(buffer, offset, bytesCount) {
  let val = 0
  for (let i = 0; i < bytesCount; i++) val += buffer[offset + i] * Math.pow(256, i)
  return val
}

// 4-byte little-endian IEEE 754 float (used in exercise session records)
function readFloat32LE(buf, offset) {
  const tmp = new Uint8Array([buf[offset], buf[offset + 1], buf[offset + 2], buf[offset + 3]])
  return new DataView(tmp.buffer).getFloat32(0, true)
}

// History sync payload: mode byte + optional BCD date at frame bytes 4–9
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

// --- Command builders ---

// 0x01 — Sync ring clock to host time
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

// 0x41 — Read ring's current clock
function getTimePacket() { return buildCommand(0x41) }

// 0x02 — Write user profile (gender, age, height cm, weight kg, stride cm)
function setPersonalProfilePacket(p) {
  return buildCommand(0x02, [
    (p.gender === 'male' || p.gender === 1) ? 1 : 0,
    p.age    || 0,
    p.height || 0,
    p.weight || 0,
    p.stride || 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
  ])
}

// 0x42 — Read user profile from ring
function getPersonalProfilePacket() { return buildCommand(0x42) }

// 0x13 — Battery level and charging state
function getBatteryPacket() { return buildCommand(0x13) }

// 0x22 — MAC address
function getMacPacket() { return buildCommand(0x22) }

// 0x27 — Firmware version string
function getVersionPacket() { return buildCommand(0x27) }

// 0x12 — Factory reset
function setFactoryResetPacket() { return buildCommand(0x12) }

// 0x2E — MCU soft reset
function setMcuResetPacket() { return buildCommand(0x2E) }

// 0x03 — Write hand placement and auto-motion detection flag
// SDK confirmed: rightHand at value[3], autoMotion at value[4], using 0x81/0x80 (not 1/0)
function setBasicParametersPacket(rightHand, autoMotion) {
  return buildCommand(0x03, [
    0, 0,
    rightHand  ? 0x81 : 0x80,
    autoMotion ? 0x81 : 0x80,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ])
}

// 0x04 — Read basic ring parameters (hand, auto-motion, EOV)
function getBasicParametersPacket() { return buildCommand(0x04) }

// 0x2A — Set background measurement schedule
// workMode: 0=off, 1=continuous, 2=scheduled
// type: 1=HR, 2=SpO2, 3=Temperature, 4=HRV
// weekdays: bitmask bit0=Mon…bit6=Sun (0x7F = all)
function setAutoMonitoringPacket(s) {
  const interval = s.intervalMinutes || 5
  return buildCommand(0x2A, [
    s.workMode  !== undefined ? s.workMode  : 1,
    decToBcd(s.startHour   !== undefined ? s.startHour   : 0),
    decToBcd(s.startMinute !== undefined ? s.startMinute : 0),
    decToBcd(s.endHour     !== undefined ? s.endHour     : 23),
    decToBcd(s.endMinute   !== undefined ? s.endMinute   : 59),
    s.weekdays  !== undefined ? s.weekdays  : 0x7F,
    interval & 0xFF,
    (interval >> 8) & 0xFF,
    s.type || 1,
    0, 0, 0, 0, 0,
  ])
}

// 0x2B — Read background schedule for a given type
function getAutoMonitoringPacket(type) {
  return buildCommand(0x2B, [type || 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
}

// 0x09 — Toggle real-time step + temperature broadcast (25-byte packets every second)
function setRealTimeControlPacket(stepsOn, tempOn) {
  return buildCommand(0x09, [stepsOn ? 1 : 0, tempOn ? 1 : 0])
}

// History sync packets ---

// 0x51 — Daily activity summary (26/27-byte records)
function getDailyActivitySummaryPacket(mode, dateFilter) {
  return buildCommand(0x51, buildHistorySyncPayload(mode || 0, dateFilter || null))
}

// 0x52 — Detailed step logs, 10-minute blocks (25-byte records)
function getDetailActivityPacket(mode, dateFilter) {
  return buildCommand(0x52, buildHistorySyncPayload(mode || 0, dateFilter || null))
}

// 0x53 — Sleep stages (34-byte 5-min records or 130-byte 1-min record)
function getSleepHistoryPacket(mode, dateFilter) {
  return buildCommand(0x53, buildHistorySyncPayload(mode || 0, dateFilter || null))
}

// 0x54 — Continuous HR history (24-byte records, 15 samples each)
function getContinuousHeartRateHistoryPacket(mode, dateFilter) {
  return buildCommand(0x54, buildHistorySyncPayload(mode || 0, dateFilter || null))
}

// 0x55 — Static (interval) HR history (10-byte records, 1 sample each)
function getStaticHeartRateHistoryPacket(mode, dateFilter) {
  return buildCommand(0x55, buildHistorySyncPayload(mode || 0, dateFilter || null))
}

// 0x56 — HRV history (15-byte records: hrv, breath, hr, stress, mood, breathRate)
function getHrvHistoryPacket(mode, dateFilter) {
  return buildCommand(0x56, buildHistorySyncPayload(mode || 0, dateFilter || null))
}

// 0x57 — Detailed SpO2 history (30-byte records, 20 samples × 30 s)
function getSpo2DetailHistoryPacket(mode, dateFilter) {
  return buildCommand(0x57, buildHistorySyncPayload(mode || 0, dateFilter || null))
}

// 0x60 — Sleep HRV / RMSSD per-night log (69-byte records, 30 samples)
function getSleepHrvHistoryPacket(mode, dateFilter) {
  return buildCommand(0x60, buildHistorySyncPayload(mode || 0, dateFilter || null))
}

// 0x62 — Skin / body temperature log (15-byte records, 3 NTC sensors)
function getTemperatureHistoryPacket(mode, dateFilter) {
  return buildCommand(0x62, buildHistorySyncPayload(mode || 0, dateFilter || null))
}

// 0x66 — Auto SpO2 history (10-byte records, 1 sample each)
function getAutoSpo2HistoryPacket(mode, dateFilter) {
  return buildCommand(0x66, buildHistorySyncPayload(mode || 0, dateFilter || null))
}

// 0x5C — Exercise session logs (25-byte records)
function getExerciseSessionsPacket(mode, dateFilter) {
  return buildCommand(0x5C, buildHistorySyncPayload(mode || 0, dateFilter || null))
}

// 0x5D — Elevated Oxygen Variation (variable-length records)
function getOxygenVariationPacket(mode, dateFilter) {
  return buildCommand(0x5D, buildHistorySyncPayload(mode || 0, dateFilter || null))
}

// 0x5F — Sleep Apnea / OSA risk (10-byte records)
function getSleepApneaPacket(mode, dateFilter) {
  return buildCommand(0x5F, buildHistorySyncPayload(mode || 0, dateFilter || null))
}

// 0x69 — Sleep body temperature log (69-byte records, 3-NTC sensors, 10 samples per record)
function getSleepTemperatureHistoryPacket(mode, dateFilter) {
  return buildCommand(0x69, buildHistorySyncPayload(mode || 0, dateFilter || null))
}

// 0x19 — Sport/activity mode control
// action: 1=start, 4=end
// sportType: 0=Run, 1=Cycling, 2=Badminton, 3=Football, 4=Tennis, 5=Yoga,
//            6=Meditation, 7=Dance, 8=Basketball, 9=Walk, 10=Workout,
//            11=Cricket, 12=Hiking, 13=Aerobics, 14=Ping-Pong, 15=Rope Jump, 16=Sit-ups
function enterActivityModePacket(action, sportType) {
  return buildCommand(0x19, [
    0,
    sportType || 0,
    0,
    action || 1,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ])
}

// 0x19 query — ask ring for current activity mode status
function queryActivityModePacket() {
  return buildCommand(0x19, [5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
}

// 0x17 — Sport session heartbeat (must be sent every ~1 s while activity mode is active)
// distanceKm: cumulative distance in km (float)
// paceSeconds: current pace as total seconds (e.g. 5 min 30 s = 330)
// rssi: phone GPS/satellite signal strength
function sendActivityHeartbeatPacket(distanceKm, paceSeconds, rssi) {
  const distBytes = _floatToLE(distanceKm || 0)
  const paceMin = Math.floor((paceSeconds || 0) / 60)
  const paceSec = (paceSeconds || 0) % 60
  return buildCommand(0x17, [
    distBytes[0], distBytes[1], distBytes[2], distBytes[3],
    paceMin & 0xFF,
    paceSec & 0xFF,
    (rssi || 0) & 0xFF,
    0, 0, 0, 0, 0, 0, 0,
  ])
}

function _floatToLE(f) {
  const tmp = new Uint8Array(4)
  new DataView(tmp.buffer).setFloat32(0, f, true)
  return tmp
}

// 0x28 — On-demand health measurement (type: 1=HRV, 2=HR, 3=SpO2)
function setMeasurementWithTypePacket(type, durationSeconds, open) {
  return buildCommand(0x28, [
    type,
    open ? 0x01 : 0x00,
    0,
    (durationSeconds || 0) & 0xff,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ])
}

// 0x78 — Blood glucose PPG session control
// ppgMode: 1=start, 2=send result, 3=stop, 4=progress, 5=exit
// ppgStatus (mode 2): 0=fail 1=low 2=normal 3=high | (mode 4): 0–100 progress %
function ppgControlPacket(ppgMode, ppgStatus) {
  return buildCommand(0x78, [ppgMode || 1, ppgStatus || 0])
}

// 0x11 — Raw PPG / PPI waveform streaming toggle
function setPpgStreamPacket(open) {
  return buildCommand(0x11, [open ? 0x01 : 0x00])
}

module.exports = {
  SERVICE_UUID, WRITE_UUID, NOTIFY_UUID, NOTIFY_MAP, X3_NAME_PREFIXES,
  calculateChecksum, buildCommand, decToBcd, bcdToString,
  parseBcdDate, readLEInt, readFloat32LE,
  setTimePacket, getTimePacket,
  setPersonalProfilePacket, getPersonalProfilePacket,
  getBatteryPacket, getMacPacket, getVersionPacket,
  setFactoryResetPacket, setMcuResetPacket,
  setBasicParametersPacket, getBasicParametersPacket,
  setAutoMonitoringPacket, getAutoMonitoringPacket,
  setRealTimeControlPacket,
  getDailyActivitySummaryPacket, getDetailActivityPacket,
  getSleepHistoryPacket,
  getContinuousHeartRateHistoryPacket, getStaticHeartRateHistoryPacket,
  getHrvHistoryPacket,
  getSpo2DetailHistoryPacket, getAutoSpo2HistoryPacket,
  getSleepHrvHistoryPacket, getTemperatureHistoryPacket,
  getSleepTemperatureHistoryPacket,
  getExerciseSessionsPacket, getOxygenVariationPacket, getSleepApneaPacket,
  setMeasurementWithTypePacket,
  ppgControlPacket, setPpgStreamPacket,
  enterActivityModePacket, queryActivityModePacket, sendActivityHeartbeatPacket,
}
