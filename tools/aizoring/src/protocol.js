/**
 * Aizo / "Infinity" Smart Ring — BLE protocol library
 * =====================================================
 * Reverse-engineered from `aizo_sdk_release_v2.1.2.aar` / `aizo_serversdk_release_v2_2.2.10.aar`
 * (com.eiot.aizo.* / com.eiot.ringsdk.*). See docs/protocol_spec.md for the full
 * derivation, byte-level layouts, and hardware verification notes.
 *
 * This replaces the older, incomplete `tools/infinity` implementation — see
 * docs/protocol_spec.md §9 for what was wrong there (frame format, sleep-mode
 * enum, and the lack of any health/sleep/sport history sync).
 *
 * Ground-truth classes:
 *   com.eiot.aizo.core.BtPackage          -> frame build/parse (tEU / XuubWYBWu)
 *   u7Bh...jmDYTQ... (CRC16.kt)           -> CRC16
 *   com.eiot.aizo.commend.AizoComHelp     -> request builders
 *   com.eiot.aizo.util.AizoComUtil        -> time bytes
 *   com.eiot.aizo.help.BeSendData$operateHexData$1 -> response dispatcher
 *   com.eiot.aizo.ext.BleResultExtKt      -> structural parsers
 *   com.eiot.aizo.base.AizoBeConfig       -> UUIDs, bleVer
 */

'use strict';

// ---------------------------------------------------------------------------
// GATT UUIDs (from AizoBeConfig)
// ---------------------------------------------------------------------------
const UUID = {
  SERVICE:         '0000fe02-0000-1000-8000-00805f9b34fb', // main service
  SPP_SERVICE:     'fe010000-1334-5678-abcd-00805f9b34fb',
  HEX_WRITE:       '00000101-0000-1000-8000-00805f9b34fb', // host -> ring : commands
  ACK_NOTIFY:      '0000010b-0000-1000-8000-00805f9b34fb', // ring -> host : data notify + host ACK writes
  BLE_WRITE:       '0000010a-0000-1000-8000-00805f9b34fb', // alt write char seen on some units
  HEX_WRITE_ECG:   '00000131-0000-1000-8000-00805f9b34fb',
  ACK_NOTIFY_ECG:  '0000013a-0000-1000-8000-00805f9b34fb',
  CCCD:            '00002902-0000-1000-8000-00805f9b34fb',
};

const BLE_VER = 3; // AizoBeConfig.bleVer
const NAME_PREFIXES = ['infinity']; // BLE advertised name prefix

// ---------------------------------------------------------------------------
// CRC16 (u7Bh...jmDYTQ... / CRC16.kt) — init 0xFFFF, returns big-endian 2 bytes
// ---------------------------------------------------------------------------
function crc16(data) {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    const x = (((crc >>> 8) | (crc << 8)) & 0xffff) ^ (data[i] & 0xff);
    const y = x ^ ((x & 0xff) >>> 4);
    const z = y ^ ((y << 12) & 0xffff);
    crc = z ^ (((z & 0xff) << 5) & 0xffff);
  }
  return crc & 0xffff;
}
function crc16Bytes(data) {
  const c = crc16(data);
  return Buffer.from([(c >> 8) & 0xff, c & 0xff]);
}

// ---------------------------------------------------------------------------
// Frame control field — a 16-bit big-endian bit-packed word (BtPackage.tEU)
//   bits[0:2]  sender   (APP = 2)
//   bits[2:4]  terminal (0)
//   bits[4:8]  bleVer   (3)
//   bits[8:10] type     (1 for normal command payloads)
//   bit [10]   ack      (0/1)
//   bits[11:13] pkgType (PKG_SINGLE=0, PKG_MULTIPLE=1, PKG_ACK=2, PKG_HEART=3)
//   bits[13:16] rfu     (0)
// ---------------------------------------------------------------------------
const SENDER_APP = 2;
const PKG = { SINGLE: 0, MULTIPLE: 1, ACK: 2, HEART: 3 };

function buildControl({ sender = SENDER_APP, terminal = 0, bleVer = BLE_VER,
                        type = 1, ack = 0, pkgType = PKG.SINGLE, rfu = 0 } = {}) {
  const word =
    ((sender   & 0x3)  << 14) |
    ((terminal & 0x3)  << 12) |
    ((bleVer   & 0xf)  <<  8) |
    ((type     & 0x3)  <<  6) |
    ((ack      & 0x1)  <<  5) |
    ((pkgType  & 0x3)  <<  3) |
    ( rfu      & 0x7);
  return Buffer.from([(word >> 8) & 0xff, word & 0xff]);
}

function parseControl(buf) {
  const word = (buf[0] << 8) | buf[1];
  return {
    sender:   (word >> 14) & 0x3,
    terminal: (word >> 12) & 0x3,
    bleVer:   (word >>  8) & 0xf,
    type:     (word >>  6) & 0x3,
    ack:      (word >>  5) & 0x1,
    pkgType:  (word >>  3) & 0x3,
    rfu:       word        & 0x7,
  };
}

// ---------------------------------------------------------------------------
// Frame:  [len:2 BE][ctrl:2][sn:2 BE][payload][crc:2 BE]
//   len = payload.length + 2 (crc). It does NOT cover ctrl/sn.
// ---------------------------------------------------------------------------
function buildFrame(payload, sn, controlOpts = {}) {
  const p = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const crc = crc16Bytes(p);
  const len = Buffer.from([((p.length + 2) >> 8) & 0xff, (p.length + 2) & 0xff]);
  const ctrl = buildControl(controlOpts);
  const snB = Buffer.from([(sn >> 8) & 0xff, sn & 0xff]);
  return Buffer.concat([len, ctrl, snB, p, crc]);
}

/**
 * Parse a fully-reassembled frame. Returns null if incomplete, throws on CRC fail.
 */
function parseFrame(buf) {
  if (buf.length < 8) return null;
  const declaredLen = (buf[0] << 8) | buf[1];      // payload + crc
  const total = 6 + declaredLen;                   // + len(2)+ctrl(2)+sn(2)
  if (buf.length < total) return null;
  const ctrl = parseControl(buf.subarray(2, 4));
  const sn = (buf[4] << 8) | buf[5];
  const body = buf.subarray(6, total);             // payload + crc
  const payload = body.subarray(0, body.length - 2);
  const rxCrc = body.subarray(body.length - 2);
  const calc = crc16Bytes(payload);
  if (!rxCrc.equals(calc)) {
    throw new Error(`CRC mismatch: got ${rxCrc.toString('hex')} calc ${calc.toString('hex')}`);
  }
  return { ...ctrl, sn, payload, cmd: payload.length >= 2 ? payload.readUInt16BE(0) : null };
}

// ---------------------------------------------------------------------------
// MTU chunking. BLE_MTU=247 -> writeMaxMTU = 247-3 = 244.
// ---------------------------------------------------------------------------
function chunk(frame, mtu = 244) {
  const out = [];
  for (let i = 0; i < frame.length; i += mtu) out.push(frame.subarray(i, i + mtu));
  return out;
}

// ---------------------------------------------------------------------------
// Time bytes (AizoComUtil.getTimeByte): [yy, MM, dd, HH, mm, ss], local time.
// ---------------------------------------------------------------------------
function timeBytes(date = new Date()) {
  return Buffer.from([
    date.getFullYear() % 100,
    date.getMonth() + 1,
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
  ]);
}
// getTimeLong: 6 time bytes -> epoch ms (local)
function timeLong(b) {
  if (b.length < 6) return 0;
  return new Date(2000 + b[0], b[1] - 1, b[2], b[3], b[4], b[5], 0).getTime();
}
function cleanDayMs(ms = Date.now()) {
  const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime();
}
function startOfTodayMs() { return cleanDayMs(); }

// ---------------------------------------------------------------------------
// Request payload builders (AizoComHelp). All "getCommod" requests append the
// 6 time bytes. The frame wrapper (buildFrame) is applied by the transport.
// ---------------------------------------------------------------------------
function cmd(...prefix) {
  return Buffer.concat([Buffer.from(prefix), timeBytes()]);
}

const REQ = {
  heartRate:     () => cmd(0x31, 0x31), // -> resp 7171 (rt) / 7161 (hist)
  bloodOxygen:   () => cmd(0x32, 0x32), // -> resp 7272 / 7262
  pressure:      () => cmd(0x31, 0x32), // HRV/stress -> resp 7172 / 7162
  bloodPressure: () => cmd(0x31, 0x33),
  temperature:   () => cmd(0x31, 0x35),
  step:          () => cmd(0x33, 0x33), // -> resp 7373
  sleep:         () => cmd(0x35, 0x35), // -> resp 7575
  sport:         () => cmd(0x36, 0x36),
  watchInfo:     (infoType = 2) => cmd(0x38, 0x38, infoType), // infoType 2 = battery/status
  battery:       () => cmd(0x38, 0x38, 0x02),
  // Health-history sync (serversdk getHealthData): [0xCC,0x61] + date time bytes.
  // This is how stored HR/SpO2/stress/temp records are actually retrieved — the
  // legacy [0x31,0x31] request does NOT return the modern health log.
  getHealthData: (dateMs = startOfTodayMs()) => Buffer.concat([Buffer.from([0xcc, 0x61]), timeBytes(new Date(dateMs))]),
  // Raw/health paged-sync control (BeRawDataUtil): start / ack / end.
  syncStart: (dataType, dateMs, ackFreq = 0, startPkt = 0) => Buffer.concat([Buffer.from([0xcc, 0x21]), timeBytes(new Date(dateMs)), Buffer.from([dataType & 0xff, ackFreq & 0xff, (startPkt >> 8) & 0xff, startPkt & 0xff, 0xff, 0xff, 0xff, 0xff])]),
  syncAck: (dataType, dateMs, ackPkt) => Buffer.concat([Buffer.from([0xcc, 0x23]), timeBytes(new Date(dateMs)), Buffer.from([dataType & 0xff, (ackPkt >> 8) & 0xff, ackPkt & 0xff])]),
  syncEnd: (dataType, dateMs, lastPkt, result = 1) => Buffer.concat([Buffer.from([0xcc, 0x25]), timeBytes(new Date(dateMs)), Buffer.from([dataType & 0xff, (lastPkt >> 8) & 0xff, lastPkt & 0xff, result & 0xff])]),
  // Sleep sync (serversdk getSleepData/Total = CC 81, getSleepDetail = CC 71), + date.
  getSleepData: (dateMs = startOfTodayMs()) => Buffer.concat([Buffer.from([0xcc, 0x81]), timeBytes(new Date(dateMs))]),
  getSleepDetail: (dateMs = startOfTodayMs()) => Buffer.concat([Buffer.from([0xcc, 0x71]), timeBytes(new Date(dateMs))]),
  getWatchDials: () => Buffer.from([0x10, 0x27]),
  switchWatchDial: (dialId) => Buffer.concat([Buffer.from([0x10, 0x31]), Buffer.from(dialId, 'utf8')]),
  // On-demand ("instant") measurement (serversdk ServiceSdkCommandV2.instantMeasurement).
  // type: 1=HeartRate 2=SpO2 3=Stress 4=BodyComposition 6=Temperature; op: 1=start 2=stop.
  // ACK response prefix is 0x7151; live values then stream as 7171/7272/7172/7979.
  instantMeasure: (type = 1, op = 1) => Buffer.from([0x31, 0x51, type & 0xff, op & 0xff]),

  // --- Auto-monitoring intervals (serversdk HeartRateIntervalManager / EmotionIntervalHelper) ---
  // HR/health periodic auto-measurement. minutes=0 disables. Use a value the ring
  // reports in its intervalList (read it first with getMeasureInterval).
  getMeasureInterval: () => Buffer.from([0x22, 0x10]),                          // -> resp 0x2110
  setMeasureInterval: (minutes) => Buffer.from([0x22, 0x11, minutes & 0xff]),   // -> resp 0x2111
  // Stress/emotion periodic auto-measurement. The wire value is a 16-bit count of
  // SECONDS (the ring reports 1800 = 30 min by default; HR defaults to 30 min too).
  // Helper takes MINUTES for convenience and converts. Range: ~1..1092 min (16-bit s).
  getStressInterval: () => Buffer.from([0x22, 0x20, 0x0c]),                     // -> resp 0x2120
  setStressInterval: (minutes) => {
    const s = Math.max(0, Math.round(minutes * 60)) & 0xffff;
    return Buffer.from([0x22, 0x21, 0x0c, (s >> 8) & 0xff, s & 0xff]);          // -> resp 0x2121
  },

  // --- Sport / workout records (serversdk SportHelp/SportManager, 0x96 family) ---
  // sportId is the session's start-time-in-ms, used as its identifier (like health
  // records' bit-packed timestamps, but here it's the plain 6-byte calendar form).
  getSportStatus:     () => Buffer.from([0x96, 0x10]),                                                                         // -> resp 0x9620 (confirmed)
  sportStart:  (sportType, sportId) => Buffer.concat([Buffer.from([0x96, 0x11]), timeBytes(new Date(sportId)), Buffer.from([sportType & 0xff])]), // -> 0x9621 (confirmed)
  sportPause:  (sportType, sportId) => Buffer.concat([Buffer.from([0x96, 0x12]), timeBytes(new Date(sportId)), Buffer.from([sportType & 0xff])]), // -> 0x9622 (confirmed)
  sportResume: (sportType, sportId) => Buffer.concat([Buffer.from([0x96, 0x13]), timeBytes(new Date(sportId)), Buffer.from([sportType & 0xff])]), // -> 0x9623 (confirmed)
  sportStop:   (sportType, sportId) => Buffer.concat([Buffer.from([0x96, 0x14]), timeBytes(new Date(sportId)), Buffer.from([sportType & 0xff])]), // -> 0x9624 (confirmed)
  sportAbort:  (sportType, sportId) => Buffer.concat([Buffer.from([0x96, 0x15]), timeBytes(new Date(sportId)), Buffer.from([sportType & 0xff])]), // -> 0x9625 (confirmed)
  getSportLiveData: (sportType, sportId) => Buffer.concat([Buffer.from([0x96, 0x36]), timeBytes(new Date(sportId)), Buffer.from([sportType & 0xff])]), // -> 0x9646 (confirmed)
  // Trigger sync of stored (finished) sport records. The ring PUSHES an unsolicited
  // total + per-record detail + end sequence. Every other command in this family
  // pairs request 0x96xx with response 0x96(xx+0x10) (confirmed for 0x10/0x11../0x36);
  // 0x9631 -> 0x9641 (total) is now confirmed live too. Detail (0x9632 -> 0x9642)
  // and end (0x9634 -> 0x9644) follow the same pattern but haven't been observed
  // live yet (this ring has no stored sessions) — decodeResponse still keeps a
  // structural fallback for any 0x96xx frame that doesn't match a known opcode.
  getSportRecord:     () => Buffer.from([0x96, 0x31]),
  getSportDetailData: (sportId) => Buffer.concat([Buffer.from([0x96, 0x32]), timeBytes(new Date(sportId))]),
  sportDetailDataAck: (sportId) => Buffer.concat([Buffer.from([0x96, 0x33]), timeBytes(new Date(sportId))]),
  sportDataEndAck:    (sportId) => Buffer.concat([Buffer.from([0x96, 0x34]), timeBytes(new Date(sportId))]),
};

const MEASURE_TYPE = { HeartRate: 1, Spo2: 2, Stress: 3, BodyComposition: 4, Temperature: 6 };

/**
 * Bind / authentication request (AizoComHelp.getBindRequest).
 * Payload = [0x30,0x30, encFlag] + time(6) + tzIndex(1) + lang(1) + rom(1)
 *           + appId(32 ASCII hex) + ";2.1.2;{compId};"
 * @param compId   company id string (encFlag=1 if it ends with 'E')
 * @param opts.appId  32-char hex app id (persist a stable one per install)
 * @param opts.tzQuarterHours  timezone offset in 15-min units (e.g. UTC+8 => 32)
 * @param opts.language 0=zh/HK/TW, 1=en(default), 2=ru
 * @param opts.rom      0 default, 1 huawei, 2 xiaomi, 3 oppo, 4 vivo
 */
function bindRequest(compId, opts = {}) {
  const enc = compId.toUpperCase().endsWith('E') ? 1 : 0;
  const appId = opts.appId || randomAppId();
  if (appId.length !== 32) throw new Error('appId must be 32 hex chars');
  const tz = opts.tzQuarterHours != null
    ? opts.tzQuarterHours
    : Math.trunc(-new Date().getTimezoneOffset() / 15); // minutes -> quarter hours
  const language = opts.language != null ? opts.language : 1;
  const rom = opts.rom != null ? opts.rom : 0;
  return Buffer.concat([
    Buffer.from([0x30, 0x30, enc]),
    timeBytes(),
    Buffer.from([tz & 0xff]),
    Buffer.from([language & 0xff]),
    Buffer.from([rom & 0xff]),
    Buffer.from(appId, 'utf8'),
    Buffer.from(`;2.1.2;${compId};`, 'utf8'),
  ]);
}

// A stable 32-hex app id. The SDK derives it from device build fingerprints,
// but the ring only needs a stable 32-hex identifier to bind against.
function randomAppId() {
  const crypto = require('crypto');
  return crypto.randomBytes(16).toString('hex');
}

// Bind/auth response body -> { status, mac, password, deviceType } (BleResultExtKt.authBean)
// payload = [cmd0, cmd1, status, ...UTF8 "MAC;PASSWORD;DEVICETYPE"]
function parseAuth(payload) {
  if (!payload || payload.length < 3) return null;
  const status = payload[2];
  const parts = payload.subarray(3).toString('utf8').split(';');
  return {
    status,
    mac: parts[0],
    password: (parts[1] || '').toUpperCase(),
    deviceType: parseInt(parts[2], 10),
    raw: payload.toString('hex'),
  };
}

// ACK frame the host writes back when a received packet had ack=1.
// payload: [0]=ok, [1]=crc error, [2]=resend. pkgType = PKG_ACK.
function ackFrame(sn, code = 0) {
  return buildFrame(Buffer.from([code & 0xff]), sn, { type: 0, pkgType: PKG.ACK });
}

// ---------------------------------------------------------------------------
// Byte helpers
// ---------------------------------------------------------------------------
function toIntBig(b) { let v = 0; for (const x of b) v = (v << 8) | (x & 0xff); return v >>> 0; }
function split(buf, sizes) {
  const out = []; let o = 0;
  for (const s of sizes) { out.push(buf.subarray(o, o + s)); o += s; }
  if (o < buf.length) out.push(buf.subarray(o));
  return out;
}

// ---------------------------------------------------------------------------
// Response decoders — keyed by the 2-byte response command (payload[0..1]).
// Mirrors BeSendData$operateHexData$1. Validity ranges from BtSendUtil.
// ---------------------------------------------------------------------------
const validHr = (v) => v >= 1 && v < 221;
const validBo = (v) => v >= 1 && v < 101;
const validPre = (v) => v >= 1 && v < 100;

// Real-time single sample: split [2,6,1] -> header, time(6), value(1)
function parseRealtime(payload) {
  const [, t, v] = split(payload, [2, 6, 1]);
  return { timestamp: timeLong(t), value: v[0] };
}
// History records: [2 header, N*4]; each record split [1,2,1] -> value, offset, flag.
// offsetScale: minutes multiplier (1 for HR/SpO2, 30 for pressure).
function parseHistory(payload, offsetScale = 1) {
  const body = payload.subarray(2);
  const midnight = cleanDayMs();
  const out = [];
  for (let i = 0; i + 4 <= body.length; i += 4) {
    const rec = body.subarray(i, i + 4);
    const value = rec[0];
    const offset = ((rec[1] << 8) | rec[2]) * offsetScale; // minutes
    const flag = rec[3];
    out.push({ timestamp: midnight + offset * 60000, offsetMinutes: offset, value, flag });
  }
  return out;
}

// Step info: split [2,6,4,4,4] (BleResultExtKt.stepInfo)
function parseStep(payload) {
  const s = split(payload, [2, 6, 4, 4, 4]);
  if (s.length < 5) return null;
  // Verified live (1575 steps -> raw calorie=699, raw distance=110250): calorie
  // raw is deci-kcal (÷10 = 69.9 kcal, plausible for the step count); distance
  // raw is centimeters (÷100 = 1102.5 m, matches steps*~0.7m stride almost
  // exactly). Both were previously mis-scaled by a factor of 1000.
  return {
    timestamp: timeLong(s[1]),
    steps: toIntBig(s[2]),
    calories: toIntBig(s[3]) / 10, // kcal
    distanceMeters: toIntBig(s[4]) / 100,
    distance: toIntBig(s[4]) / 100000, // km
  };
}

// Sleep detail single record (8 bytes) (BleResultExtKt.sleepDetail)
function parseSleepDetail(payload) {
  if (payload.length < 8) return null;
  const bin = (b) => [...b].map((x) => x.toString(2).padStart(8, '0')).join('');
  const d = bin(payload.subarray(0, 4));
  const t = bin(payload.subarray(4, 8));
  const year = 2000 + parseInt(d.slice(1, 7), 2);
  const month = parseInt(d.slice(7, 11), 2);
  const day = parseInt(d.slice(11, 16), 2);
  const offMin = parseInt(t.slice(0, 16), 2);
  const flag = parseInt(t.slice(27, 28), 2);
  const mode = parseInt(t.slice(28, 32), 2); // 1=Deep 2=Light 3=Awake 4=NotWorn 5=REM
  const base = new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
  return { timestamp: base + offMin * 60000, offsetMinutes: offMin, mode, flag };
}

// 4-byte bit-packed date/time (TimeUtil.byteToTime): year[0:6]+2000, month[6:10]-1,
// day[10:15], hour[15:20], minute[20:26], second[26:32].
function parseBitTime(buf4) {
  const bin = [...buf4].map((b) => b.toString(2).padStart(8, '0')).join('');
  const v = (a, b) => parseInt(bin.slice(a, b), 2);
  return new Date(2000 + v(0, 6), v(6, 10) - 1, v(10, 15), v(15, 20), v(20, 26), v(26, 32), 0).getTime();
}

// Daily health-history records (getHealthData 0xCC61 -> 0xCC62), 16 bytes each
// (BeDataReceive.zUthBDGWITqvQukd). Layout:
//   [0:4] bit-packed timestamp (see parseBitTime)
//   [4] hr  [5] hrv  [6] spo2  [7] stress
//   [8:16] bit-packed: step=bits[23:41], envTemp=bits[41:52]/10, bodyTemp=bits[52:63]/10, sos=bit[63]
function parseHealthRecords(payload) {
  const body = payload.subarray(2); // strip 0xCC62
  const out = [];
  for (let i = 0; i + 16 <= body.length; i += 16) {
    const rec = body.subarray(i, i + 16);
    let allZero = true, allFF = true;
    for (const b of rec) { if (b !== 0) allZero = false; if (b !== 0xff) allFF = false; }
    if (allZero || allFF) continue; // skip empty / padding records
    const ts = parseBitTime(rec.subarray(0, 4));
    const bin = [...rec.subarray(8, 16)].map((b) => b.toString(2).padStart(8, '0')).join('');
    const bits = (a, b) => parseInt(bin.slice(a, b), 2);
    const envRaw = bits(41, 52), tempRaw = bits(52, 63);
    out.push({
      timestamp: ts,
      hr: rec[4], hrv: rec[5], spo2: rec[6], stress: rec[7],
      step: bits(23, 41),
      bodyTemp: tempRaw === 2047 ? null : tempRaw / 10,
      envTemp: envRaw === 2047 ? null : envRaw / 10,
      sos: bits(63, 64) === 1,
    });
  }
  return out;
}

// Sleep summary (getSleepData 0xCC81 -> 0xCC82), BeSleepDataTwoUtil split
// [2,1,2,2,2,1,2,2,6,6,rest]. Durations in minutes; total = deep+light+rem.
function parseSleepSummary(payload) {
  if (payload.length < 26) return null;
  let allZero = true;
  for (let i = 2; i < 26; i++) if (payload[i] !== 0) { allZero = false; break; }
  if (allZero) return null; // no sleep recorded that day
  const u16 = (o) => payload.readUInt16BE(o);
  const tt = (o) => timeLong(payload.subarray(o, o + 6));
  return {
    sleepType: payload[2], // 1=night 2=nap
    deepMin: u16(3), lightMin: u16(5), awakeMin: u16(7),
    awakeTimes: payload[9], remMin: u16(10), totalMin: u16(12),
    start: tt(14), end: tt(20),
  };
}

// Sleep detail stages (getSleepDetail 0xCC71 -> 0xCC72). After the 2-byte code and
// a 4-byte bit-packed day header, N × 8-byte stage records:
//   [0:2] marker  [2:4] avg HR (BE)  [4:6] offset minutes from midnight (BE)
//   [6] segment field  [7] stage: 1=Deep 2=Light 3=Awake 4=NotWorn 5=REM
const SLEEP_MODE = { 1: 'Deep', 2: 'Light', 3: 'Awake', 4: 'NotWorn', 5: 'REM' };
function parseSleepDetail2(payload) {
  const midnight = cleanDayMs(parseBitTime(payload.subarray(2, 6)));
  const body = payload.subarray(6);
  const out = [];
  for (let i = 0; i + 8 <= body.length; i += 8) {
    const r = body.subarray(i, i + 8);
    const offMin = r.readUInt16BE(4);
    out.push({
      timestamp: midnight + offMin * 60000,
      offsetMin: offMin,
      hr: r.readUInt16BE(2),
      stage: r[7],
      mode: SLEEP_MODE[r[7]] || String(r[7]),
    });
  }
  return out;
}

// --- Sport / workout records (BeSportDataUtil / SportManager, 0x96 family) ---

// getSportStatus response (0x9620, confirmed live): [hdr(2), active(1), sportType(1), sportId(6, 0=none)]
function parseSportStatus(payload) {
  const s = split(payload, [2, 1, 1]);
  const rest = s[3] || Buffer.alloc(0);
  const allZero = rest.length === 0 || [...rest].every((b) => b === 0);
  return { active: s[1][0] === 1, sportType: s[2][0], sportId: allZero ? null : timeLong(rest) };
}

// start/pause/resume/stop/abort ack (0x9621-0x9625, confirmed): [hdr(2), sportId(6), result(1)]
// result: 1=ok, 3=already-in-that-state (pause/resume/stop only), else fail/unsupported.
function parseSportAck(payload) {
  if (payload.length < 9) return { ok: false, result: null, raw: payload.toString('hex') };
  const result = payload[8];
  return { ok: result === 1, result, raw: payload.toString('hex') };
}

// Single 16-byte sport-detail sample (BeSportDataUtil.parseSportDetailBytes):
//   [0:2] time offset from sportId, seconds  [2:4] calorie(BE /10)  [4:8] step(BE)
//   [8:10] distance(BE *10)  [12] hr  [14:16] pace(BE)
function parseSportDetailRecord(buf16) {
  const s = split(buf16, [2, 2, 4, 2, 2, 1, 1, 2]);
  return {
    timeOffsetSec: toIntBig(s[0]),
    calorie: toIntBig(s[1]) / 10,
    step: toIntBig(s[2]),
    dist: toIntBig(s[3]) * 10,
    hr: s[5][0],
    pace: toIntBig(s[7]),
  };
}

// getSportLiveData response (0x9646, confirmed): [hdr(2), sportId(6), rfu(1), state(1), records...]
// state===3 means the device has ended the session; otherwise body is 16-byte live samples.
function parseSportLive(payload) {
  const s = split(payload, [2, 6, 1, 1]);
  const state = s[3] ? s[3][0] : null;
  if (state === 3) return { ended: true, records: [] };
  const body = s[4] || Buffer.alloc(0);
  const records = [];
  for (let i = 0; i + 16 <= body.length; i += 16) records.push(parseSportDetailRecord(body.subarray(i, i + 16)));
  return { ended: false, records };
}

// Sport TOTAL/summary record (0x9641, confirmed live — response to REQ.getSportRecord's
// 0x9631, all-zero when no session is stored). BeSportDataUtil.processSportTotalData,
// 26 bytes incl. header:
//   [0:2] opcode  [2:8] sportId=startTime(6)  [8] sportType  [9] rfu
//   [10:12] duration(BE, seconds)  [12:14] calorie(BE /10)  [14:18] steps(BE)
//   [18:20] distance(BE *10)  [20:22] rfu  [22] avgHr  [23] rfu
function parseSportTotal(payload) {
  const s = split(payload, [2, 6, 1, 1, 2, 2, 4, 2, 2, 2, 2]);
  if (s.length < 8) return null;
  let allZero = true;
  for (let i = 2; i < payload.length; i++) if (payload[i] !== 0) { allZero = false; break; }
  if (allZero) return null; // no sport session stored
  const sportId = timeLong(s[1]);
  const duration = toIntBig(s[4]);
  return {
    sportId, sportType: s[2][0], startTime: sportId, endTime: sportId + duration * 1000,
    duration, calorie: toIntBig(s[5]) / 10, steps: toIntBig(s[6]), distance: toIntBig(s[7]) * 10,
    avgHr: s[9] ? s[9][0] : null,
  };
}

// Sport DETAIL push (BeSportDataUtil.processSportDetailData): [hdr(2), sportId(6), sportType(1), rfu(9), N*16-byte records]
function parseSportDetailPush(payload) {
  const s = split(payload, [2, 6, 1, 9]);
  const sportId = timeLong(s[1]);
  const sportType = s[2][0];
  const body = s[4] || Buffer.alloc(0);
  const records = [];
  for (let i = 0; i + 16 <= body.length; i += 16) records.push(parseSportDetailRecord(body.subarray(i, i + 16)));
  return { sportId, sportType, records };
}

// Sport upload-end notice (BeSportDataUtil.receiveSportDataEnd): [hdr(2), sportId(6)]
function parseSportEnd(payload) {
  const s = split(payload, [2]);
  return { sportId: timeLong(s[1]) };
}

// Device status/battery: bytes[3]=battery%, bytes[4]=workingMode (BleResultExtKt.status)
function parseStatus(payload) {
  if (payload.length < 5) return null;
  return { battery: payload[3], workingMode: payload[4] };
}

// WatchConfig feature/capability flags (BleResultExtKt.config), 44-byte payload.
function parseWatchConfig(payload) {
  if (payload.length < 44) return null;
  const b = (i) => payload[i] > 0;
  return {
    alarm: b(3), sedentary: b(4), drinkWater: b(5), medicine: b(6),
    incomingCall: b(7), notifyMsg: b(8), findWatch: b(9), findPhone: b(10),
    ota: b(11), dial: b(12), customDial: b(13), customCard: b(14),
    heart: b(15), sleep: b(16), dayActivityTarget: b(17), daySportTarget: b(18),
    sportSync: b(19), timeSet: b(20), tempSet: b(21), language: b(22),
    music: b(23), musicControl: b(24), takePhoto: b(25), alexa: b(26),
    weather: b(27), contact: b(28), dialNumber: b(29),
    dialType: payload[30], otaType: payload[31], heartRateSupport: b(32), touchSet: b(33),
    heartRateMonitoring: payload[34], sleepMonitoring: payload[35],
    pressureMonitoring: payload[36], bloodOxygenMonitoring: payload[37],
    bloodSugarMonitoring: payload[38], bloodPressureMonitoring: payload[39],
    temperatureMonitoring: payload[40], ecgMonitoring: payload[41],
    menstrualMonitoring: payload[42], breatheMonitoring: payload[43],
  };
}

/**
 * High-level dispatcher: takes a decoded frame's payload and returns
 * { kind, data }. Unknown commands return { kind:'unknown' }.
 */
function decodeResponse(payload) {
  if (!payload || payload.length < 2) return { kind: 'empty' };
  const c = payload.readUInt16BE(0);
  switch (c) {
    case 0x7171: { const r = parseRealtime(payload); return { kind: 'heartRate', mode: 'realtime', valid: validHr(r.value), data: r }; }
    case 0x7161: return { kind: 'heartRate', mode: 'history', data: parseHistory(payload, 1).filter((r) => validHr(r.value)) };
    case 0x7172: { const r = parseRealtime(payload); return { kind: 'pressure', mode: 'realtime', valid: validPre(r.value), data: r }; }
    case 0x7162: return { kind: 'pressure', mode: 'history', data: parseHistory(payload, 30).filter((r) => validPre(r.value)) };
    case 0x7272: { const r = parseRealtime(payload); return { kind: 'bloodOxygen', mode: 'realtime', valid: validBo(r.value), data: r }; }
    case 0x7262: return { kind: 'bloodOxygen', mode: 'history', data: parseHistory(payload, 1).filter((r) => validBo(r.value)) };
    case 0x7175: { // temperature realtime (instant measure): [hdr(2), time(6), bodyTemp(2 BE, ÷10), envTemp(2 BE, ÷10; 0xffff=invalid)]
      const s = split(payload, [2, 6, 2, 2]);
      const body = s[2] && s[2].length >= 2 ? (s[2][0] << 8) | s[2][1] : null;
      const env = s[3] && s[3].length >= 2 ? (s[3][0] << 8) | s[3][1] : null;
      return { kind: 'temperature', mode: 'realtime', data: { value: body == null ? null : body / 10, bodyTemp: body == null ? null : body / 10, envTemp: env == null || env === 0xffff ? null : env / 10, timestamp: timeLong(s[1]) } };
    }
    case 0x7373: return { kind: 'step', data: parseStep(payload) };
    case 0x7575: return { kind: 'sleep', mode: 'summary', data: payload }; // summary packing; see spec §7.7
    case 0x9595: { // sleep DETAIL stage records: [header(2)] + N*8-byte records
      const body = payload.subarray(2); const recs = [];
      for (let i = 0; i + 8 <= body.length; i += 8) { const r = parseSleepDetail(body.subarray(i, i + 8)); if (r) recs.push(r); }
      return { kind: 'sleep', mode: 'detail', data: recs };
    }
    case 0x7979: { // body-temperature stream: split [2,1,6,1,2,2] -> value, time
      const s = split(payload, [2, 1, 6, 1, 2, 2]);
      return { kind: 'temperature', mode: 'realtime', data: { value: s[1][0], timestamp: timeLong(s[2]) } };
    }
    case 0x7672: case 0x7673: case 0x7674: case 0x7675: case 0x7676:
      return { kind: 'sport', cmd: c.toString(16), data: payload };
    // Device info family 0x7878, sub-dispatched by infoType = payload[2].
    // infoType 2 = battery/status ([78 78 02 battery mode time(6)], verified);
    // other infoTypes carry device-about/settings data (structure varies).
    case 0xcc62: return { kind: 'healthHistory', data: parseHealthRecords(payload) };
    case 0xcc64: return { kind: 'healthHistory', mode: 'end', data: [] };
    case 0xcc82: return { kind: 'sleepSummary', data: parseSleepSummary(payload) };
    case 0xcc84: return { kind: 'sleepSummary', mode: 'end', data: null };
    case 0xcc72: return { kind: 'sleepDetail', data: parseSleepDetail2(payload) };
    case 0xcc74: return { kind: 'sleepDetail', mode: 'end', data: [] };
    case 0x7878:
      if (payload[2] === 2) return { kind: 'status', data: parseStatus(payload) };
      return { kind: 'deviceInfo', infoType: payload[2], data: { infoType: payload[2], raw: payload.toString('hex') } };
    case 0x7151: return { kind: 'measureAck', data: { started: payload[3] === 1, raw: payload.toString('hex') } };
    case 0x7152: return { kind: 'measureDone', data: { type: payload[2], valid: payload[3] === 1, raw: payload.toString('hex') } };
    case 0x2110: { // HR/health interval config: [hdr(2), current(1), default(1), rfu(1), list(1*N)]
      const s = split(payload, [2, 1, 1, 1]);
      const list = s.length > 4 ? [...s[4]] : [];
      return { kind: 'measureInterval', data: { currentMinutes: payload[2], defaultMinutes: payload[3], allowedMinutes: list } };
    }
    case 0x2111: return { kind: 'measureIntervalSet', data: { ok: true, raw: payload.toString('hex') } };
    case 0x2120: { // [hdr(2), type(1)=0c, current(2 = seconds), default(2 = seconds)]
      const curS = payload.length >= 5 ? (payload[3] << 8) | payload[4] : null;
      const defS = payload.length >= 7 ? (payload[5] << 8) | payload[6] : null;
      return { kind: 'stressInterval', data: { currentSeconds: curS, currentMinutes: curS == null ? null : curS / 60, defaultSeconds: defS, defaultMinutes: defS == null ? null : defS / 60 } };
    }
    case 0x2121: return { kind: 'stressIntervalSet', data: { ok: true, raw: payload.toString('hex') } };
    case 0x9620: return { kind: 'sportStatus', data: parseSportStatus(payload) };
    case 0x9621: return { kind: 'sportAck', action: 'start', data: parseSportAck(payload) };
    case 0x9622: return { kind: 'sportAck', action: 'pause', data: parseSportAck(payload) };
    case 0x9623: return { kind: 'sportAck', action: 'resume', data: parseSportAck(payload) };
    case 0x9624: return { kind: 'sportAck', action: 'stop', data: parseSportAck(payload) };
    case 0x9625: return { kind: 'sportAck', action: 'abort', data: parseSportAck(payload) };
    case 0x9646: return { kind: 'sportLive', data: parseSportLive(payload) };
    case 0x9641: return { kind: 'sportTotal', data: parseSportTotal(payload) }; // confirmed live (0x9631 -> 0x9641)
    // Not yet observed live (ring has no stored sessions) — inferred from the
    // req(0x96xx) -> resp(0x96xx+0x10) pattern confirmed on every other pair in
    // this family (0x10/0x20, 0x11-0x15/0x21-0x25, 0x36/0x46, 0x31/0x41).
    case 0x9642: return { kind: 'sportDetail', confirmed: false, data: parseSportDetailPush(payload) };
    case 0x9644: return { kind: 'sportEnd', confirmed: false, data: parseSportEnd(payload) };
    default: break;
  }
  if (payload[0] === 0x38 && payload[1] === 0x38) return { kind: 'status', data: parseStatus(payload) };
  if (payload[0] === 0x96) {
    // Any other 0x96xx frame: unclassified push, log raw so it can be pinned down.
    return { kind: 'sportRaw', opcode: c.toString(16).padStart(4, '0'), data: payload.toString('hex') };
  }
  return { kind: 'unknown', cmd: c.toString(16), data: payload.toString('hex') };
}

module.exports = {
  UUID, BLE_VER, PKG, MEASURE_TYPE, NAME_PREFIXES,
  crc16, crc16Bytes,
  buildControl, parseControl, buildFrame, parseFrame, chunk,
  timeBytes, timeLong, cleanDayMs,
  cmd, REQ, bindRequest, randomAppId, parseAuth, ackFrame,
  toIntBig, split,
  parseRealtime, parseHistory, parseStep, parseSleepDetail, parseStatus, parseWatchConfig, parseHealthRecords, parseSleepSummary, parseSleepDetail2, startOfTodayMs,
  parseSportStatus, parseSportAck, parseSportLive, parseSportTotal, parseSportDetailPush, parseSportEnd, parseSportDetailRecord,
  decodeResponse,
};
