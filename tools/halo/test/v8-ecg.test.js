'use strict';

// Offline checks for the V8 ECG path. Packet layouts come from the vendor
// SDK (ResolveUtil.getECG / BleSDK.SetDeviceMeasurementWithType); the sample
// values are the ones printed in the vendor's V8.xlsx callback example.
// Run: node --test tools/halo/test/

const test = require('node:test');
const assert = require('node:assert');
const protocol = require('../src/v8-protocol');
const { summarizeEcg, splitBacklog, countLostPackets, ecgSamplesToCsv, estimateHeartRate } = require('../src/ecg-summary');
const { V8Client } = require('../src/v8');

const VENDOR_SAMPLES = [1429272, 1402068, 1382763, 1355117, 1315190, 1271053, 1225516, 1179102, 1125663, 1048665, 945237, 836901, 744799, 673132, 615415, 568752, 541206, 532816, 521992, 485754, 422314, 352940, 303238, 284075, 293211, 321627, 352622, 365930, 350703, 316788, 284343, 260096, 236995, 213204, 196413, 190137, 186608, 176680, 160667, 145869, 138577, 141382, 153764, 174527, 201296, 227139, 244340, 249042, 241738, 228752, 219720, 221348, 282861, 523197, 967257, 1431678, 1712529, 1775463, 1719479, 1651933, 1621051, 1622996, 1635745, 1643687, 1644366, 1642879, 1643099, 1644468, 1645463, 1646026, 1646446, 1646903, 1647086, 1645718, 1642712, 1640866, 1643639, 1651050, 1659041, 1664213];

function ecgNotification(packetId, samples) {
  const buf = new Uint8Array(2 + samples.length * 3);
  buf[0] = 0x07;
  buf[1] = packetId;
  samples.forEach((v, i) => {
    buf[2 + 3 * i] = v & 0xff;
    buf[3 + 3 * i] = (v >> 8) & 0xff;
    buf[4 + 3 * i] = (v >> 16) & 0xff;
  });
  return buf;
}

test('setMeasurementPacket(ecg) matches BleSDK.SetDeviceMeasurementWithType(ECG, 50*1000, true)', () => {
  const pkt = protocol.setMeasurementPacket('ecg', true);
  // value[0]=0x28, [1]=0x04 (ECG), [2]=1 (open), [4..5]=50000 LE, [6]=1
  assert.deepStrictEqual(Array.from(pkt.slice(0, 7)), [0x28, 0x04, 0x01, 0x00, 0x50, 0xc3, 0x01]);
  assert.strictEqual(pkt[15], protocol.calculateChecksum(pkt));
  const stop = protocol.setMeasurementPacket('ecg', false, 300);
  assert.deepStrictEqual(Array.from(stop.slice(0, 7)), [0x28, 0x04, 0x00, 0x00, 0x2c, 0x01, 0x01]);
});

test('setMeasurementPacket for non-ECG types leaves byte 6 clear', () => {
  const pkt = protocol.setMeasurementPacket('hrv', true, 60);
  assert.deepStrictEqual(Array.from(pkt.slice(0, 7)), [0x28, 0x01, 0x01, 0x00, 0x3c, 0x00, 0x00]);
  assert.throws(() => protocol.setMeasurementPacket('ecg', true, 70000), /0\.\.65535/);
  assert.throws(() => protocol.setMeasurementPacket('bogus', true), /Unknown measurement type/);
});

test('setEcgRealtimePacket matches BleSDK.setECGRealtimeDuringHRVEnabled', () => {
  assert.deepStrictEqual(Array.from(protocol.setEcgRealtimePacket(true).slice(0, 2)), [0x07, 0x01]);
  assert.deepStrictEqual(Array.from(protocol.setEcgRealtimePacket(false).slice(0, 2)), [0x07, 0x00]);
});

test('parseEcgChunk round-trips the vendor sample packet (packetID=7, 80 samples)', () => {
  const chunk = protocol.parseEcgChunk(ecgNotification(7, VENDOR_SAMPLES));
  assert.strictEqual(chunk.packetId, 7);
  assert.deepStrictEqual(chunk.samples, VENDOR_SAMPLES);
});

test('parseEcgChunk ignores the 16-byte ack frame, like the SDK', () => {
  assert.strictEqual(protocol.parseEcgChunk(protocol.setEcgRealtimePacket(true)), null);
});

test('parseMeasurementResult decodes the hrv/hr/spo2 spot-reading layout', () => {
  const r = protocol.parseMeasurementResult(new Uint8Array([0x28, 0x01, 72, 98, 55, 30, 120, 80, 0, 0, 0, 0, 0, 0, 0, 0]));
  assert.deepStrictEqual({ type: r.type, heartRate: r.heartRate, spo2: r.spo2, hrv: r.hrv, stress: r.stress, systolic: r.systolic, diastolic: r.diastolic },
    { type: 'hrv', heartRate: 72, spo2: 98, hrv: 55, stress: 30, systolic: 120, diastolic: 80 });
  assert.strictEqual(protocol.parseMeasurementResult(new Uint8Array([0x28, 0x04])).type, 'ecg');
});

test('countLostPackets handles the uint8 wrap and a counter reset', () => {
  const ids = (list) => list.map((packetId) => ({ packetId, samples: [] }));
  assert.strictEqual(countLostPackets(ids([254, 255, 0, 1])), 0);
  assert.strictEqual(countLostPackets(ids([254, 1])), 2);
  assert.strictEqual(countLostPackets(ids([5, 6, 9])), 2);
  assert.strictEqual(countLostPackets(ids([100, 0])), 0, 'a gap of 128+ is a counter reset, not a loss');
});

test('summarizeEcg derives rate from covered samples over the arrival span', () => {
  const packets = [
    { packetId: 1, samples: VENDOR_SAMPLES, receivedAt: 1000 },
    { packetId: 2, samples: VENDOR_SAMPLES, receivedAt: 1320 },
    { packetId: 3, samples: VENDOR_SAMPLES, receivedAt: 1640 },
  ];
  const samples = packets.flatMap((p) => p.samples);
  const s = summarizeEcg({ packets, samples, firstPacketAt: 1000, lastPacketAt: 1640 });
  assert.strictEqual(s.packetCount, 3);
  assert.strictEqual(s.sampleCount, 240);
  assert.strictEqual(s.effectiveSampleRateHz, 250); // 160 samples over 640ms
  assert.strictEqual(s.streamSeconds, 0.6);
  assert.deepStrictEqual(s.samplesPerPacket, [80]);
  assert.strictEqual(s.min, 138577);
  assert.strictEqual(s.max, 1775463);
  const single = summarizeEcg({ packets: packets.slice(0, 1), samples: VENDOR_SAMPLES, firstPacketAt: 1000, lastPacketAt: 1000 });
  assert.strictEqual(single.effectiveSampleRateHz, null);
  const empty = summarizeEcg({ packets: [], samples: [], firstPacketAt: null, lastPacketAt: null });
  assert.strictEqual(empty.mean, null);
});

// Synthetic ECG: a narrow positive spike every `rrSec` on top of slow baseline
// wander and noise, in the same 24-bit count range the band produces.
function syntheticEcg(fs, seconds, rrSec, seed = 1) {
  let r = seed;
  const rnd = () => { r = (r * 1103515245 + 12345) & 0x7fffffff; return r / 0x7fffffff - 0.5; };
  const out = [];
  for (let i = 0; i < fs * seconds; i++) {
    const t = i / fs;
    const wander = 2200000 + 60000 * Math.sin(t * 0.7) + 30000 * Math.sin(t * 0.13);
    const phase = (t % rrSec) / rrSec;
    const qrs = phase < 0.03 ? 40000 * Math.sin((phase / 0.03) * Math.PI) : 0;
    out.push(Math.round(wander + qrs + 1500 * rnd()));
  }
  return out;
}

test('estimateHeartRate finds the beat rate through baseline wander', () => {
  const hr = estimateHeartRate(syntheticEcg(250, 30, 60 / 72), 250);
  assert.ok(hr, 'expected an estimate');
  assert.ok(Math.abs(hr.bpmMedian - 72) <= 1, `got ${hr.bpmMedian}`);
  assert.ok(hr.rrSdMs < 20, `sd ${hr.rrSdMs}`);
  const fast = estimateHeartRate(syntheticEcg(255, 30, 60 / 110, 7), 255);
  assert.ok(Math.abs(fast.bpmMedian - 110) <= 1, `got ${fast.bpmMedian}`);
});

test('estimateHeartRate returns null on a short burst or a flat line', () => {
  assert.strictEqual(estimateHeartRate(VENDOR_SAMPLES.concat(VENDOR_SAMPLES, VENDOR_SAMPLES), 250), null);
  const flat = new Array(250 * 20).fill(2200000);
  assert.strictEqual(estimateHeartRate(flat, 250), null);
  assert.strictEqual(summarizeEcg({ packets: [], samples: [], firstPacketAt: null, lastPacketAt: null }).heartRate, null);
});

test('splitBacklog separates a fast flush from the live 3-per-second stream', () => {
  const packets = [];
  let t = 1000; let id = 200;
  for (let i = 0; i < 40; i++) { packets.push({ packetId: id++ & 0xff, samples: [1], receivedAt: t }); t += 30; } // flush
  t += 900;
  for (let sec = 0; sec < 5; sec++) {
    for (let k = 0; k < 3; k++) { packets.push({ packetId: id++ & 0xff, samples: [1], receivedAt: t }); t += 30; }
    t += 900;
  }
  const { backlog, live } = splitBacklog(packets);
  assert.strictEqual(backlog.length, 40);
  assert.strictEqual(live.length, 15);
  const s = summarizeEcg({ packets, samples: packets.flatMap((p) => p.samples), firstPacketAt: 1000, lastPacketAt: t });
  assert.strictEqual(s.backlogPackets, 40);
  assert.strictEqual(s.packetCount, 15);
  // A normal start (3 packets, then the ~900ms gap) is not a backlog.
  const normal = splitBacklog(packets.slice(40));
  assert.strictEqual(normal.backlog.length, 0);
});

test('ecgSamplesToCsv emits one row per sample with a running index', () => {
  const csv = ecgSamplesToCsv([{ packetId: 3, samples: [10, 20] }, { packetId: 4, samples: [30] }]);
  assert.strictEqual(csv, 'index,packetId,value\n0,3,10\n1,3,20\n2,4,30\n');
});

// Fake transport: records writes, lets the test push notifications.
function fakeClient() {
  const client = Object.create(V8Client.prototype);
  const ble = {
    writes: [],
    handler: null,
    onNotify(fn) { this.handler = fn; },
    async write(pkt) { this.writes.push(Array.from(pkt)); },
  };
  client._ble = ble;
  return { client, ble };
}

test('recordEcg sends start pair, collects 0x07 data, and always sends the stop pair', async () => {
  const { client, ble } = fakeClient();
  const seen = [];
  const p = client.recordEcg({ captureMs: 20, onPacket: (r) => seen.push(r.packetId) });
  await new Promise((r) => setImmediate(r));
  ble.handler(protocol.setEcgRealtimePacket(true)); // 16-byte ack, not data
  ble.handler(new Uint8Array([0x28, 0x04, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
  ble.handler(ecgNotification(7, VENDOR_SAMPLES));
  ble.handler(ecgNotification(8, VENDOR_SAMPLES.slice(0, 10)));
  ble.handler(new Uint8Array([0x54, 0, 0])); // unrelated opcode, ignored
  const result = await p;

  assert.deepStrictEqual(seen, [7, 8]);
  assert.strictEqual(result.samples.length, 90);
  assert.strictEqual(result.acks.length, 2);
  assert.strictEqual(result.acks[0].type, 'ecg_realtime_ack');
  assert.strictEqual(result.acks[1].type, 'ecg');
  assert.deepStrictEqual(ble.writes.map((w) => [w[0], w[1], w[2]]), [
    [0x28, 0x04, 0x01], [0x07, 0x01, 0x00],
    [0x28, 0x04, 0x00], [0x07, 0x00, 0x00],
  ]);
  assert.strictEqual(ble.handler, null, 'listener released after the run');
});

test('recordEcg stops early on the stop signal', async () => {
  const { client, ble } = fakeClient();
  let stop;
  const t0 = Date.now();
  const p = client.recordEcg({ captureMs: 5000, onStopSignal: (fn) => { stop = fn; } });
  await new Promise((r) => setImmediate(r));
  stop();
  await p;
  assert.ok(Date.now() - t0 < 1000);
  assert.strictEqual(ble.writes.length, 4);
});
