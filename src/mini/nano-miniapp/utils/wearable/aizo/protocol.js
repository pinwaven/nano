'use strict'

// WeChat-compatible port of the verified Aizo/Infinity ring protocol
// (~/waven/aizoring/src/aizo_protocol.js, mirrored at nano/tools/aizoring/src/protocol.js).
// This REPLACES the previous port, which was based on an earlier, fundamentally
// wrong frame format (a fake `[0x02,seq][cmdId]` header instead of the real
// `len(2BE)·ctrl(2)·sn(2BE)` framing) and lacked health/sleep/sport history sync
// entirely. See docs/protocol_spec.md (copied alongside this file) §9 for the
// full list of corrections, and the ground-truth class references throughout.
//
// All Buffer usage from the Node reference implementation is replaced with
// Uint8Array + small helpers, matching the convention used by halo/protocol.js.

const BLE_SERVICE_UUID = '0000fe02-0000-1000-8000-00805f9b34fb'
const WRITE_UUID       = '00000101-0000-1000-8000-00805f9b34fb'
const NOTIFY_UUID      = '0000010a-0000-1000-8000-00805f9b34fb' // this hardware notifies on 010a, not 010b as the vendor SDK documents
const AIZO_NAME_PREFIXES = ['infinity']
const BLE_VER = 3

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
  const clean = String(hex || '').replace(/^0x/i, '').replace(/\s+/g, '')
  const arr = new Uint8Array(Math.floor(clean.length / 2))
  for (let i = 0; i < arr.length; i++) arr[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return arr
}

// Protocol strings (bind footer, auth response) are ASCII-safe.
function strToBytes(str) {
  const arr = new Uint8Array(str.length)
  for (let i = 0; i < str.length; i++) arr[i] = str.charCodeAt(i) & 0xFF
  return arr
}

function bytesToAscii(arr) {
  let s = ''
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i])
  return s
}

function readU16BE(arr, off) {
  return ((arr[off] << 8) | arr[off + 1]) & 0xFFFF
}

// A cryptographically-unimportant random 32-hex-char id (the ring only needs a
// stable identifier to bind against, not a secure one). `crypto.randomBytes`
// isn't reliably available in the WeChat sandbox, so Math.random suffices.
function randomAppId() {
  let s = ''
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16)
  return s
}

// --- CRC16 (custom variant, init 0xFFFF, big-endian) ---

function crc16(data) {
  let crc = 0xFFFF
  for (let i = 0; i < data.length; i++) {
    const x = (((crc >>> 8) | (crc << 8)) & 0xFFFF) ^ (data[i] & 0xFF)
    const y = x ^ ((x & 0xFF) >>> 4)
    const z = y ^ ((y << 12) & 0xFFFF)
    crc = z ^ (((z & 0xFF) << 5) & 0xFFFF)
  }
  return crc & 0xFFFF
}
function crc16Bytes(data) {
  const c = crc16(data)
  return new Uint8Array([(c >> 8) & 0xFF, c & 0xFF])
}

// --- Frame control field — 16-bit bit-packed word (BtPackage.tEU) ---
//   bits[0:2] sender (APP=2)  bits[2:4] terminal (0)  bits[4:8] bleVer (3)
//   bits[8:10] type (1=normal)  bit[10] ack  bits[11:13] pkgType  bits[13:16] rfu
const SENDER_APP = 2
const PKG = { SINGLE: 0, MULTIPLE: 1, ACK: 2, HEART: 3 }

function buildControl(opts) {
  opts = opts || {}
  const sender   = opts.sender   != null ? opts.sender   : SENDER_APP
  const terminal = opts.terminal != null ? opts.terminal : 0
  const bleVer   = opts.bleVer   != null ? opts.bleVer   : BLE_VER
  const type     = opts.type     != null ? opts.type     : 1
  const ack      = opts.ack      != null ? opts.ack      : 0
  const pkgType  = opts.pkgType  != null ? opts.pkgType  : PKG.SINGLE
  const rfu      = opts.rfu      != null ? opts.rfu      : 0
  const word =
    ((sender   & 0x3)  << 14) |
    ((terminal & 0x3)  << 12) |
    ((bleVer   & 0xF)  <<  8) |
    ((type     & 0x3)  <<  6) |
    ((ack      & 0x1)  <<  5) |
    ((pkgType  & 0x3)  <<  3) |
    ( rfu      & 0x7)
  return new Uint8Array([(word >> 8) & 0xFF, word & 0xFF])
}

function parseControl(buf) {
  const word = (buf[0] << 8) | buf[1]
  return {
    sender:   (word >> 14) & 0x3,
    terminal: (word >> 12) & 0x3,
    bleVer:   (word >>  8) & 0xF,
    type:     (word >>  6) & 0x3,
    ack:      (word >>  5) & 0x1,
    pkgType:  (word >>  3) & 0x3,
    rfu:       word        & 0x7,
  }
}

// --- Frame:  [len:2 BE][ctrl:2][sn:2 BE][payload][crc:2 BE] ---
//   len = payload.length + 2 (crc). Does NOT cover ctrl/sn.

function buildFrame(payload, sn, controlOpts) {
  const p = payload instanceof Uint8Array ? payload : new Uint8Array(payload)
  const crc = crc16Bytes(p)
  const len = new Uint8Array([((p.length + 2) >> 8) & 0xFF, (p.length + 2) & 0xFF])
  const ctrl = buildControl(controlOpts)
  sn = sn || 0
  const snB = new Uint8Array([(sn >> 8) & 0xFF, sn & 0xFF])
  return concatBytes(len, ctrl, snB, p, crc)
}

// Parse a fully-reassembled frame. Returns null if incomplete, throws on CRC fail.
function parseFrame(buf) {
  if (buf.length < 8) return null
  const declaredLen = (buf[0] << 8) | buf[1]
  const total = 6 + declaredLen
  if (buf.length < total) return null
  const ctrl = parseControl(buf.subarray(2, 4))
  const sn = (buf[4] << 8) | buf[5]
  const body = buf.subarray(6, total)
  const payload = body.subarray(0, body.length - 2)
  const rxCrc = body.subarray(body.length - 2)
  const calc = crc16Bytes(payload)
  if (rxCrc[0] !== calc[0] || rxCrc[1] !== calc[1]) {
    throw new Error(`Aizo CRC mismatch: got ${toHex(rxCrc)} calc ${toHex(calc)}`)
  }
  return Object.assign({ sn, payload, cmd: payload.length >= 2 ? readU16BE(payload, 0) : null }, ctrl)
}

// MTU chunking. BLE_MTU=247 -> writeMaxMTU = 247-3 = 244.
function chunk(frame, mtu) {
  mtu = mtu || 244
  const out = []
  for (let i = 0; i < frame.length; i += mtu) out.push(frame.subarray(i, i + mtu))
  return out
}

// --- Time bytes (AizoComUtil.getTimeByte): [yy, MM, dd, HH, mm, ss], local time ---

function timeBytes(date) {
  const d = date || new Date()
  return new Uint8Array([
    d.getFullYear() % 100,
    d.getMonth() + 1,
    d.getDate(),
    d.getHours(),
    d.getMinutes(),
    d.getSeconds(),
  ])
}
// 6 time bytes -> epoch ms (local)
function timeLong(b) {
  if (b.length < 6) return 0
  return new Date(2000 + b[0], b[1] - 1, b[2], b[3], b[4], b[5], 0).getTime()
}
function cleanDayMs(ms) {
  const d = new Date(ms != null ? ms : Date.now())
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}
function startOfTodayMs() { return cleanDayMs() }

// --- Request payload builders (AizoComHelp) ---

function cmd(...prefix) {
  return concatBytes(new Uint8Array(prefix), timeBytes())
}

const REQ = {
  heartRate:     () => cmd(0x31, 0x31), // -> resp 7171 (rt) / 7161 (hist)
  bloodOxygen:   () => cmd(0x32, 0x32), // -> resp 7272 / 7262
  pressure:      () => cmd(0x31, 0x32), // HRV/stress -> resp 7172 / 7162
  bloodPressure: () => cmd(0x31, 0x33),
  temperature:   () => cmd(0x31, 0x35),
  step:          () => cmd(0x33, 0x33), // -> resp 7373
  sleep:         () => cmd(0x35, 0x35), // -> resp 7575 (legacy; use getSleepData/getSleepDetail instead)
  sport:         () => cmd(0x36, 0x36),
  watchInfo:     (infoType) => cmd(0x38, 0x38, infoType != null ? infoType : 2),
  battery:       () => cmd(0x38, 0x38, 0x02),

  // Health-history sync (serversdk getHealthData): the REAL way to retrieve
  // stored HR/SpO2/HRV/stress/temperature records — the legacy [0x31,0x31]
  // request above does NOT return this data on current firmware.
  getHealthData: (dateMs) => concatBytes(new Uint8Array([0xCC, 0x61]), timeBytes(new Date(dateMs != null ? dateMs : startOfTodayMs()))),

  // Sleep sync (serversdk getSleepData/Total = CC81, getSleepDetail = CC71).
  getSleepData: (dateMs) => concatBytes(new Uint8Array([0xCC, 0x81]), timeBytes(new Date(dateMs != null ? dateMs : startOfTodayMs()))),
  getSleepDetail: (dateMs) => concatBytes(new Uint8Array([0xCC, 0x71]), timeBytes(new Date(dateMs != null ? dateMs : startOfTodayMs()))),

  getWatchDials: () => new Uint8Array([0x10, 0x27]),

  // On-demand ("instant") measurement (serversdk ServiceSdkCommandV2.instantMeasurement).
  // type: 1=HeartRate 2=SpO2 3=Stress 4=BodyComposition 6=Temperature; op: 1=start 2=stop.
  // Stress does NOT return from spot-measure on this firmware — rely on the
  // stress auto-monitor schedule (setStressInterval) instead.
  instantMeasure: (type, op) => new Uint8Array([0x31, 0x51, (type != null ? type : 1) & 0xFF, (op != null ? op : 1) & 0xFF]),

  // --- Auto-monitoring intervals ---
  getMeasureInterval: () => new Uint8Array([0x22, 0x10]),                          // -> resp 0x2110
  setMeasureInterval: (minutes) => new Uint8Array([0x22, 0x11, minutes & 0xFF]),   // -> resp 0x2111
  getStressInterval: () => new Uint8Array([0x22, 0x20, 0x0C]),                     // -> resp 0x2120
  setStressInterval: (minutes) => {
    const s = Math.max(0, Math.round(minutes * 60)) & 0xFFFF
    return new Uint8Array([0x22, 0x21, 0x0C, (s >> 8) & 0xFF, s & 0xFF])           // -> resp 0x2121
  },

  // --- Sport / workout records (serversdk SportHelp/SportManager, 0x96 family) ---
  getSportStatus: () => new Uint8Array([0x96, 0x10]),                              // -> resp 0x9620
  sportStart:  (sportType, sportId) => concatBytes(new Uint8Array([0x96, 0x11]), timeBytes(new Date(sportId)), new Uint8Array([sportType & 0xFF])),
  sportPause:  (sportType, sportId) => concatBytes(new Uint8Array([0x96, 0x12]), timeBytes(new Date(sportId)), new Uint8Array([sportType & 0xFF])),
  sportResume: (sportType, sportId) => concatBytes(new Uint8Array([0x96, 0x13]), timeBytes(new Date(sportId)), new Uint8Array([sportType & 0xFF])),
  sportStop:   (sportType, sportId) => concatBytes(new Uint8Array([0x96, 0x14]), timeBytes(new Date(sportId)), new Uint8Array([sportType & 0xFF])),
  sportAbort:  (sportType, sportId) => concatBytes(new Uint8Array([0x96, 0x15]), timeBytes(new Date(sportId)), new Uint8Array([sportType & 0xFF])),
  getSportLiveData: (sportType, sportId) => concatBytes(new Uint8Array([0x96, 0x36]), timeBytes(new Date(sportId)), new Uint8Array([sportType & 0xFF])),
  getSportRecord: () => new Uint8Array([0x96, 0x31]),                              // -> ring pushes 0x9641 total (+ pattern-inferred detail/end)
}

const MEASURE_TYPE = { HeartRate: 1, Spo2: 2, Stress: 3, BodyComposition: 4, Temperature: 6 }

// Bind / authentication request (AizoComHelp.getBindRequest).
// Payload = [0x30,0x30, encFlag] + time(6) + tzIndex(1) + lang(1) + rom(1)
//           + appId(32 ASCII hex) + ";2.1.2;{compId};"
function bindRequest(compId, opts) {
  opts = opts || {}
  const enc = compId.toUpperCase().endsWith('E') ? 1 : 0
  const appId = opts.appId || randomAppId()
  if (appId.length !== 32) throw new Error('appId must be 32 hex chars')
  const tz = opts.tzQuarterHours != null
    ? opts.tzQuarterHours
    : Math.trunc(-new Date().getTimezoneOffset() / 15)
  const language = opts.language != null ? opts.language : 1
  const rom = opts.rom != null ? opts.rom : 0
  return concatBytes(
    new Uint8Array([0x30, 0x30, enc]),
    timeBytes(),
    new Uint8Array([tz & 0xFF]),
    new Uint8Array([language & 0xFF]),
    new Uint8Array([rom & 0xFF]),
    strToBytes(appId),
    strToBytes(`;2.1.2;${compId};`),
  )
}

// Bind/auth response body -> { status, mac, password, deviceType }
// payload = [cmd0, cmd1, status, ...ASCII "MAC;PASSWORD;DEVICETYPE"]
function parseAuth(payload) {
  if (!payload || payload.length < 3) return null
  const status = payload[2]
  const parts = bytesToAscii(payload.subarray(3)).split(';')
  return {
    status,
    mac: parts[0],
    password: (parts[1] || '').toUpperCase(),
    deviceType: parseInt(parts[2], 10),
    raw: toHex(payload),
  }
}

// ACK frame the host writes back when a received packet had ack=1.
function ackFrame(sn, code) {
  return buildFrame(new Uint8Array([(code || 0) & 0xFF]), sn, { type: 0, pkgType: PKG.ACK })
}

// --- Byte helpers ---

function toIntBig(b) { let v = 0; for (let i = 0; i < b.length; i++) v = (v << 8) | (b[i] & 0xFF); return v >>> 0 }
function split(buf, sizes) {
  const out = []; let o = 0
  for (const s of sizes) { out.push(buf.subarray(o, o + s)); o += s }
  if (o < buf.length) out.push(buf.subarray(o))
  return out
}

// --- Response decoders (mirrors BeSendData$operateHexData$1) ---

const validHr = (v) => v >= 1 && v < 221
const validBo = (v) => v >= 1 && v < 101
const validPre = (v) => v >= 1 && v < 100

// Real-time single sample: split [2,6,1] -> header, time(6), value(1)
function parseRealtime(payload) {
  const s = split(payload, [2, 6, 1])
  return { timestamp: timeLong(s[1]), value: s[2][0] }
}

// History records: [2 header, N*4]; each record split [1,2,1] -> value, offset, flag.
function parseHistory(payload, offsetScale) {
  offsetScale = offsetScale || 1
  const body = payload.subarray(2)
  const midnight = cleanDayMs()
  const out = []
  for (let i = 0; i + 4 <= body.length; i += 4) {
    const value = body[i]
    const offset = ((body[i + 1] << 8) | body[i + 2]) * offsetScale
    const flag = body[i + 3]
    out.push({ timestamp: midnight + offset * 60000, offsetMinutes: offset, value, flag })
  }
  return out
}

// Step info: split [2,6,4,4,4]. Verified live (1575 steps -> raw calorie=699,
// raw distance=110250): calorie raw is deci-kcal (÷10); distance raw is
// centimeters (÷100 = metres, matches steps×~0.7m stride almost exactly).
function parseStep(payload) {
  const s = split(payload, [2, 6, 4, 4, 4])
  if (s.length < 5) return null
  return {
    timestamp: timeLong(s[1]),
    steps: toIntBig(s[2]),
    calories: toIntBig(s[3]) / 10, // kcal
    distanceMeters: toIntBig(s[4]) / 100,
    distance: toIntBig(s[4]) / 100000, // km
  }
}

// 4-byte bit-packed date/time (TimeUtil.byteToTime): year[0:6]+2000, month[6:10]-1,
// day[10:15], hour[15:20], minute[20:26], second[26:32].
function parseBitTime(buf4) {
  const bin = Array.from(buf4).map(b => b.toString(2).padStart(8, '0')).join('')
  const v = (a, b) => parseInt(bin.slice(a, b), 2)
  return new Date(2000 + v(0, 6), v(6, 10) - 1, v(10, 15), v(15, 20), v(20, 26), v(26, 32), 0).getTime()
}

// Daily health-history records (getHealthData 0xCC61 -> 0xCC62), 16 bytes each:
//   [0:4] bit-packed timestamp  [4]hr [5]hrv [6]spo2 [7]stress
//   [8:16] bit-packed: step=bits[23:41], envTemp=bits[41:52]/10, bodyTemp=bits[52:63]/10 (2047=invalid), sos=bit[63]
function parseHealthRecords(payload) {
  const body = payload.subarray(2)
  const out = []
  for (let i = 0; i + 16 <= body.length; i += 16) {
    const rec = body.subarray(i, i + 16)
    let allZero = true, allFF = true
    for (let k = 0; k < rec.length; k++) { if (rec[k] !== 0) allZero = false; if (rec[k] !== 0xFF) allFF = false }
    if (allZero || allFF) continue
    const ts = parseBitTime(rec.subarray(0, 4))
    const bin = Array.from(rec.subarray(8, 16)).map(b => b.toString(2).padStart(8, '0')).join('')
    const bits = (a, b) => parseInt(bin.slice(a, b), 2)
    const envRaw = bits(41, 52), tempRaw = bits(52, 63)
    out.push({
      timestamp: ts,
      hr: rec[4], hrv: rec[5], spo2: rec[6], stress: rec[7],
      step: bits(23, 41),
      bodyTemp: tempRaw === 2047 ? null : tempRaw / 10,
      envTemp: envRaw === 2047 ? null : envRaw / 10,
      sos: bits(63, 64) === 1,
    })
  }
  return out
}

// Sleep summary (getSleepData 0xCC81 -> 0xCC82). Durations in minutes;
// total = deep+light+rem.
function parseSleepSummary(payload) {
  if (payload.length < 26) return null
  let allZero = true
  for (let i = 2; i < 26; i++) if (payload[i] !== 0) { allZero = false; break }
  if (allZero) return null
  const u16 = (o) => readU16BE(payload, o)
  const tt = (o) => timeLong(payload.subarray(o, o + 6))
  return {
    sleepType: payload[2], // 1=night 2=nap
    deepMin: u16(3), lightMin: u16(5), awakeMin: u16(7),
    awakeTimes: payload[9], remMin: u16(10), totalMin: u16(12),
    start: tt(14), end: tt(20),
  }
}

// Sleep detail stages (getSleepDetail 0xCC71 -> 0xCC72). After the 2-byte code
// and a 4-byte bit-packed day header, N × 8-byte stage records:
//   [0:2] marker  [2:4] avg HR (BE)  [4:6] offset minutes from midnight (BE)
//   [6] segment  [7] stage: 1=Deep 2=Light 3=Awake 4=NotWorn 5=REM
const SLEEP_MODE = { 1: 'Deep', 2: 'Light', 3: 'Awake', 4: 'NotWorn', 5: 'REM' }
function parseSleepDetail2(payload) {
  const midnight = cleanDayMs(parseBitTime(payload.subarray(2, 6)))
  const body = payload.subarray(6)
  const out = []
  for (let i = 0; i + 8 <= body.length; i += 8) {
    const r = body.subarray(i, i + 8)
    const offMin = readU16BE(r, 4)
    out.push({
      timestamp: midnight + offMin * 60000,
      offsetMin: offMin,
      hr: readU16BE(r, 2),
      stage: r[7],
      mode: SLEEP_MODE[r[7]] || String(r[7]),
    })
  }
  return out
}

// --- Sport / workout records (0x96 family) ---

function parseSportStatus(payload) {
  const s = split(payload, [2, 1, 1])
  const rest = s[3] || new Uint8Array(0)
  let allZero = rest.length === 0
  if (!allZero) { allZero = true; for (let i = 0; i < rest.length; i++) if (rest[i] !== 0) { allZero = false; break } }
  return { active: s[1][0] === 1, sportType: s[2][0], sportId: allZero ? null : timeLong(rest) }
}

function parseSportAck(payload) {
  if (payload.length < 9) return { ok: false, result: null, raw: toHex(payload) }
  const result = payload[8]
  return { ok: result === 1, result, raw: toHex(payload) }
}

function parseSportDetailRecord(buf16) {
  const s = split(buf16, [2, 2, 4, 2, 2, 1, 1, 2])
  return {
    timeOffsetSec: toIntBig(s[0]),
    calorie: toIntBig(s[1]) / 10,
    step: toIntBig(s[2]),
    dist: toIntBig(s[3]) * 10,
    hr: s[5][0],
    pace: toIntBig(s[7]),
  }
}

function parseSportLive(payload) {
  const s = split(payload, [2, 6, 1, 1])
  const state = s[3] ? s[3][0] : null
  if (state === 3) return { ended: true, records: [] }
  const body = s[4] || new Uint8Array(0)
  const records = []
  for (let i = 0; i + 16 <= body.length; i += 16) records.push(parseSportDetailRecord(body.subarray(i, i + 16)))
  return { ended: false, records }
}

function parseSportTotal(payload) {
  const s = split(payload, [2, 6, 1, 1, 2, 2, 4, 2, 2, 2, 2])
  if (s.length < 8) return null
  let allZero = true
  for (let i = 2; i < payload.length; i++) if (payload[i] !== 0) { allZero = false; break }
  if (allZero) return null
  const sportId = timeLong(s[1])
  const duration = toIntBig(s[4])
  return {
    sportId, sportType: s[2][0], startTime: sportId, endTime: sportId + duration * 1000,
    duration, calorie: toIntBig(s[5]) / 10, steps: toIntBig(s[6]), distance: toIntBig(s[7]) * 10,
    avgHr: s[9] ? s[9][0] : null,
  }
}

function parseSportDetailPush(payload) {
  const s = split(payload, [2, 6, 1, 9])
  const sportId = timeLong(s[1])
  const sportType = s[2][0]
  const body = s[4] || new Uint8Array(0)
  const records = []
  for (let i = 0; i + 16 <= body.length; i += 16) records.push(parseSportDetailRecord(body.subarray(i, i + 16)))
  return { sportId, sportType, records }
}

function parseSportEnd(payload) {
  const s = split(payload, [2])
  return { sportId: timeLong(s[1]) }
}

// Device status/battery: bytes[3]=battery%, bytes[4]=workingMode
function parseStatus(payload) {
  if (payload.length < 5) return null
  return { battery: payload[3], workingMode: payload[4] }
}

/**
 * High-level dispatcher: takes a decoded frame's payload and returns
 * { kind, data }. Unknown commands return { kind:'unknown' }.
 */
function decodeResponse(payload) {
  if (!payload || payload.length < 2) return { kind: 'empty' }
  const c = readU16BE(payload, 0)
  switch (c) {
    case 0x7171: { const r = parseRealtime(payload); return { kind: 'heartRate', mode: 'realtime', valid: validHr(r.value), data: r } }
    case 0x7161: return { kind: 'heartRate', mode: 'history', data: parseHistory(payload, 1).filter(r => validHr(r.value)) }
    case 0x7172: { const r = parseRealtime(payload); return { kind: 'pressure', mode: 'realtime', valid: validPre(r.value), data: r } }
    case 0x7162: return { kind: 'pressure', mode: 'history', data: parseHistory(payload, 30).filter(r => validPre(r.value)) }
    case 0x7272: { const r = parseRealtime(payload); return { kind: 'bloodOxygen', mode: 'realtime', valid: validBo(r.value), data: r } }
    case 0x7262: return { kind: 'bloodOxygen', mode: 'history', data: parseHistory(payload, 1).filter(r => validBo(r.value)) }
    case 0x7175: { // temperature realtime: [hdr(2), time(6), bodyTemp(2 BE ÷10), envTemp(2 BE ÷10; 0xffff=invalid)]
      const s = split(payload, [2, 6, 2, 2])
      const body = s[2] && s[2].length >= 2 ? readU16BE(s[2], 0) : null
      const env = s[3] && s[3].length >= 2 ? readU16BE(s[3], 0) : null
      return { kind: 'temperature', mode: 'realtime', data: { value: body == null ? null : body / 10, bodyTemp: body == null ? null : body / 10, envTemp: env == null || env === 0xFFFF ? null : env / 10, timestamp: timeLong(s[1]) } }
    }
    case 0x7373: return { kind: 'step', data: parseStep(payload) }
    case 0xcc62: return { kind: 'healthHistory', data: parseHealthRecords(payload) }
    case 0xcc64: return { kind: 'healthHistory', mode: 'end', data: [] }
    case 0xcc82: return { kind: 'sleepSummary', data: parseSleepSummary(payload) }
    case 0xcc84: return { kind: 'sleepSummary', mode: 'end', data: null }
    case 0xcc72: return { kind: 'sleepDetail', data: parseSleepDetail2(payload) }
    case 0xcc74: return { kind: 'sleepDetail', mode: 'end', data: [] }
    case 0x7878:
      if (payload[2] === 2) return { kind: 'status', data: parseStatus(payload) }
      return { kind: 'deviceInfo', infoType: payload[2], data: { infoType: payload[2], raw: toHex(payload) } }
    case 0x7151: return { kind: 'measureAck', data: { started: payload[3] === 1, raw: toHex(payload) } }
    case 0x7152: return { kind: 'measureDone', data: { type: payload[2], valid: payload[3] === 1, raw: toHex(payload) } }
    case 0x2110: {
      const s = split(payload, [2, 1, 1, 1])
      const list = s.length > 4 ? Array.from(s[4]) : []
      return { kind: 'measureInterval', data: { currentMinutes: payload[2], defaultMinutes: payload[3], allowedMinutes: list } }
    }
    case 0x2111: return { kind: 'measureIntervalSet', data: { ok: true, raw: toHex(payload) } }
    case 0x2120: {
      const curS = payload.length >= 5 ? readU16BE(payload, 3) : null
      const defS = payload.length >= 7 ? readU16BE(payload, 5) : null
      return { kind: 'stressInterval', data: { currentSeconds: curS, currentMinutes: curS == null ? null : curS / 60, defaultSeconds: defS, defaultMinutes: defS == null ? null : defS / 60 } }
    }
    case 0x2121: return { kind: 'stressIntervalSet', data: { ok: true, raw: toHex(payload) } }
    case 0x9620: return { kind: 'sportStatus', data: parseSportStatus(payload) }
    case 0x9621: return { kind: 'sportAck', action: 'start', data: parseSportAck(payload) }
    case 0x9622: return { kind: 'sportAck', action: 'pause', data: parseSportAck(payload) }
    case 0x9623: return { kind: 'sportAck', action: 'resume', data: parseSportAck(payload) }
    case 0x9624: return { kind: 'sportAck', action: 'stop', data: parseSportAck(payload) }
    case 0x9625: return { kind: 'sportAck', action: 'abort', data: parseSportAck(payload) }
    case 0x9646: return { kind: 'sportLive', data: parseSportLive(payload) }
    case 0x9641: return { kind: 'sportTotal', data: parseSportTotal(payload) }
    case 0x9642: return { kind: 'sportDetail', confirmed: false, data: parseSportDetailPush(payload) }
    case 0x9644: return { kind: 'sportEnd', confirmed: false, data: parseSportEnd(payload) }
    default: break
  }
  if (payload[0] === 0x38 && payload[1] === 0x38) return { kind: 'status', data: parseStatus(payload) }
  if (payload[0] === 0x96) return { kind: 'sportRaw', opcode: c.toString(16).padStart(4, '0'), data: toHex(payload) }
  return { kind: 'unknown', cmd: c.toString(16), data: toHex(payload) }
}

module.exports = {
  BLE_SERVICE_UUID, WRITE_UUID, NOTIFY_UUID, AIZO_NAME_PREFIXES, BLE_VER, PKG, MEASURE_TYPE,
  concatBytes, toHex, hexToBytes, strToBytes, bytesToAscii,
  crc16, crc16Bytes, buildControl, parseControl, buildFrame, parseFrame, chunk,
  timeBytes, timeLong, cleanDayMs, startOfTodayMs,
  cmd, REQ, bindRequest, randomAppId, parseAuth, ackFrame,
  toIntBig, split,
  parseRealtime, parseHistory, parseStep, parseStatus, parseHealthRecords, parseSleepSummary, parseSleepDetail2,
  parseSportStatus, parseSportAck, parseSportLive, parseSportTotal, parseSportDetailPush, parseSportEnd, parseSportDetailRecord,
  decodeResponse,
}
