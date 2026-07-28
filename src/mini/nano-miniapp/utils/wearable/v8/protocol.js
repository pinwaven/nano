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
}
