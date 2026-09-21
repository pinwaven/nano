'use strict'

// V8 Smart Band BLE constants and command builders.
// Ported from vendor SDK source (temp/V8_SDK/, package com.jstyle.blesdkv8) —
// see docs/architecture/v8-smart-band.md for the full protocol reference and
// exactly where this diverges from Halo (same UUIDs/frame format, but NOT the
// same opcode table in every case — e.g. 0x57 means something different).
// Confirmed against real hardware (firmware 0.0.8.8) via tools/halo --device v8;
// this file mirrors that CLI's src/v8-protocol.js builders.

const SERVICE_UUID = '0000fff000001000800000805f9b34fb'
const WRITE_UUID   = '0000fff600001000800000805f9b34fb'
const NOTIFY_UUID  = '0000fff700001000800000805f9b34fb'

const NOTIFY_MAP = {
  [SERVICE_UUID]: { txCharUUID: NOTIFY_UUID, rxCharUUID: WRITE_UUID },
}

// Confirmed directly against real hardware — not documented anywhere in the
// vendor SDK (its demo apps list every nearby device with no name filter).
const V8_NAME_PREFIXES = ['JCV8B']

// --- Low-level frame primitives (identical to Halo's) ---

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

// Decimal to BCD: e.g. 26 -> 0x26
function decToBcd(val) {
  return parseInt(val.toString(10), 16)
}

// BCD byte to 2-char string: e.g. 0x26 -> "26"
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

// History sync payload: mode byte + optional BCD date at frame bytes 4-9.
// Confirmed identical offsets to Halo via BleSDK.insertDateValue().
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

// 0x01 — Sync band clock to host time
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

// 0x41 — Read band's current clock
function getTimePacket() { return buildCommand(0x41) }

// 0x02 — Write user profile (gender, age, height cm, weight kg, stride cm)
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

// 0x42 — Read user profile from band
function getUserInfoPacket() { return buildCommand(0x42) }

// 0x13 — Battery level, charging state, raw voltage
function getBatteryPacket() { return buildCommand(0x13) }

// 0x22 — MAC address
function getMacPacket() { return buildCommand(0x22) }

// 0x27 — Firmware version
function getVersionPacket() { return buildCommand(0x27) }

// 0x12 — Factory reset
function setFactoryResetPacket() { return buildCommand(0x12) }

// 0x2e — MCU soft reset
function setMcuResetPacket() { return buildCommand(0x2E) }

// 0x2a — Set background measurement schedule.
// Confirmed byte-for-byte identical layout to Halo's 0x2A via live write +
// read-back round trip. type: 1=HR, 2=SpO2, 3=Temperature, 4=HRV
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

// 0x2b — Read background schedule for a given type
function getAutoMonitoringPacket(type) {
  return buildCommand(0x2B, [type || 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
}

// --- History sync packets ---
// mode: 0x00 = read latest, 0x02 = continue from last read position,
// 0x99 = delete all data of this type. Same convention/offsets as Halo.

function getTotalStepDataPacket(mode, dateFilter) {
  return buildCommand(0x51, buildHistorySyncPayload(mode || 0, dateFilter || null))
}

function getDetailActivityDataPacket(mode, dateFilter) {
  return buildCommand(0x52, buildHistorySyncPayload(mode || 0, dateFilter || null))
}

function getSleepDataPacket(mode, dateFilter) {
  return buildCommand(0x53, buildHistorySyncPayload(mode || 0, dateFilter || null))
}

function getDynamicHrDataPacket(mode, dateFilter) {
  return buildCommand(0x54, buildHistorySyncPayload(mode || 0, dateFilter || null))
}

function getStaticHrDataPacket(mode, dateFilter) {
  return buildCommand(0x55, buildHistorySyncPayload(mode || 0, dateFilter || null))
}

function getHrvTestDataPacket(mode, dateFilter) {
  return buildCommand(0x56, buildHistorySyncPayload(mode || 0, dateFilter || null))
}

function getTemperatureHistoryPacket(mode, dateFilter) {
  return buildCommand(0x62, buildHistorySyncPayload(mode || 0, dateFilter || null))
}

function getOxygenDataPacket(mode, dateFilter) {
  return buildCommand(0x66, buildHistorySyncPayload(mode || 0, dateFilter || null))
}

// --- ECG (on-demand, streamed live -- NOT a history type) ---
//
// Ported verbatim from tools/halo/src/v8-protocol.js after the 2026-09-19 live sessions
// (docs/architecture/v8-smart-band.md §6 and tools/halo/README.md "ECG"). The band streams
// raw 24-bit ADC samples on opcode 0x07 while a measurement started by 0x28 (type 4) runs.
// What the firmware actually does, all confirmed on two units:
//   - the measurement needs wrist contact AND a finger from the other hand on the electrode;
//     without it the band aborts within ~3 s (this unit family may emit nothing at all);
//   - `duration` is SECONDS from the 0x28 command and is the only clean way to end a
//     measurement -- the SDK's open=0 "stop" ends nothing (the band keeps sampling and buffers
//     ~50-60 s while the tap is closed, flushing it on the next 0x07 on). Ask for exactly the
//     capture length; never re-send 0x28 onto a running measurement to stop it;
//   - after a measurement expires the finger must be lifted before another will start.

const MEASUREMENT_TYPES = { hrv: 0x01, hr: 0x02, spo2: 0x03, ecg: 0x04 }

// 0x28 -- start/stop an on-demand measurement (BleSDK.SetDeviceMeasurementWithType).
// duration goes to bytes 4-5 LE; the ECG type additionally sets byte 6 = 1 (vendor code).
function setMeasurementPacket(type, open, durationSeconds) {
  const typeByte = MEASUREMENT_TYPES[type]
  if (!typeByte) throw new Error(`Unknown measurement type "${type}"`)
  const d = Math.max(0, Math.min(0xffff, Math.round(durationSeconds || 0)))
  const payload = new Array(14).fill(0)
  payload[0] = typeByte
  payload[1] = open ? 0x01 : 0x00
  payload[3] = d & 0xff
  payload[4] = (d >> 8) & 0xff
  if (typeByte === MEASUREMENT_TYPES.ecg) payload[5] = 0x01
  return buildCommand(0x28, payload)
}

// 0x07 -- open/close the ECG realtime tap (BleSDK.setECGRealtimeDuringHRVEnabled)
function setEcgRealtimePacket(open) {
  return buildCommand(0x07, [open ? 0x01 : 0x00])
}

// 0x07 data notification (ResolveUtil.getECG): byte1 = packetId (uint8, wraps), then
// (length-2)/3 samples, each an unsigned 24-bit little-endian ADC count. A 16-byte frame on
// this opcode is the band's ack to the tap command, not data (the SDK gates on length > 16).
function parseEcgChunk(buf) {
  if (buf.length <= 16) return null
  const packetId = buf[1]
  const count = Math.floor((buf.length - 2) / 3)
  const samples = new Array(count)
  for (let i = 0; i < count; i++) samples[i] = readLEInt(buf, 2 + 3 * i, 3)
  return { packetId, samples }
}

// ---- PPG stream (the SDK's "blood glucose" collection) ------------------------------------
// BleSDK.ppgWithMode(mode, status) -> 0x78 [mode, status]: 1 start, 3 stop, 5 quit (2 = a
// result for the band's screen, 4 = progress %, neither needed). The band echoes each as
// `78 00 <mode>` and streams 0x3a frames: `3a 00 <seq>` then 50 samples, 4-byte big-endian
// (top byte always 0 -> 24-bit counts) in a 203-byte frame, 3-byte in a 153-byte one. One frame
// per second, contiguous -> 50 Hz. Confirmed live 2026-09-20 (tools/halo README "PPG"); byte-
// identical on the Halo ring. Needs the negotiated MTU (>= 203).
const PPG_MODES = { start: 1, result: 2, stop: 3, progress: 4, quit: 5 }

function ppgModePacket(mode, status) {
  const m = typeof mode === 'string' ? PPG_MODES[mode] : mode
  if (!m) throw new Error(`Unknown PPG mode "${mode}"`)
  const payload = [m]
  if (m !== PPG_MODES.start) payload.push(status | 0)
  return buildCommand(0x78, payload)
}

// 0x3a data frame -> { packetId (the seq byte), samples } or null for any other length.
function parsePpgChunk(buf) {
  const width = buf.length === 153 ? 3 : buf.length === 203 ? 4 : 0
  if (!width) return null
  const count = Math.floor((buf.length - 3) / width)
  const samples = new Array(count)
  for (let i = 0; i < count; i++) {
    let v = 0
    for (let k = 0; k < width; k++) v = v * 256 + buf[3 + width * i + k]
    samples[i] = v
  }
  return { packetId: buf[2], samples }
}

module.exports = {
  SERVICE_UUID, WRITE_UUID, NOTIFY_UUID, NOTIFY_MAP, V8_NAME_PREFIXES,
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
  MEASUREMENT_TYPES, setMeasurementPacket, setEcgRealtimePacket, parseEcgChunk,
  PPG_MODES, ppgModePacket, parsePpgChunk,
}
