'use strict';

// Pure helpers over a V8Client.recordEcg() result. No BLE, no I/O -- so the
// numbers the CLI prints can be checked offline against canned packets.

// Count packets missing from the uint8 packetId sequence (wraps at 256). A
// gap of 128 or more is treated as a counter reset, not a loss -- with a
// wrapping counter the two are indistinguishable, so this is a heuristic
// that reads a burst of <128 dropped notifications correctly.
function countLostPackets(packets) {
  let lost = 0;
  for (let i = 1; i < packets.length; i++) {
    const expected = (packets[i - 1].packetId + 1) & 0xff;
    const gap = (packets[i].packetId - expected + 256) & 0xff;
    if (gap > 0 && gap < 128) lost += gap;
  }
  return lost;
}

// The band keeps sampling after our stop pair and buffers while the 0x07 tap
// is closed (confirmed live 2026-09-19: ~150-200 packets, i.e. the last
// ~50-60s), then dumps the buffer at ~33 packets/s the moment the tap
// reopens. Live streaming is 3-4 packets/s with ~900ms gaps. Everything
// before the first >500ms gap is the backlog when it holds more than one
// live second's worth; it belongs to the previous measurement and must not
// feed the rate or heart-rate estimate.
function splitBacklog(packets) {
  let cut = 0;
  for (let i = 1; i < packets.length; i++) {
    if (packets[i].receivedAt - packets[i - 1].receivedAt > 500) { cut = i; break; }
  }
  if (cut <= 4) return { backlog: [], live: packets };
  return { backlog: packets.slice(0, cut), live: packets.slice(cut) };
}

function summarizeEcg(result) {
  const { backlog, live } = splitBacklog(result.packets);
  const liveSamples = [];
  for (const p of live) for (const v of p.samples) liveSamples.push(v);
  const s = summarizeEcgPackets({
    packets: live,
    samples: liveSamples,
    firstPacketAt: live.length ? live[0].receivedAt : null,
    lastPacketAt: live.length ? live[live.length - 1].receivedAt : null,
  });
  s.backlogPackets = backlog.length;
  s.backlogSamples = backlog.reduce((n, p) => n + p.samples.length, 0);
  return s;
}

function summarizeEcgPackets(result) {
  const { packets, samples, firstPacketAt, lastPacketAt } = result;
  const sampleCount = samples.length;
  const streamMs = firstPacketAt != null && lastPacketAt != null ? lastPacketAt - firstPacketAt : 0;
  let min = null; let max = null; let sum = 0;
  for (const v of samples) {
    if (min == null || v < min) min = v;
    if (max == null || v > max) max = v;
    sum += v;
  }
  // Rate = samples in all packets but the last, over the span between the
  // first and last packet arrival (the last packet's samples cover time
  // after its own arrival). Needs at least two packets to mean anything.
  let effectiveSampleRateHz = null;
  if (packets.length >= 2 && streamMs > 0) {
    const covered = sampleCount - packets[packets.length - 1].samples.length;
    effectiveSampleRateHz = Math.round((covered / streamMs) * 1000 * 10) / 10;
  }
  const perPacket = Array.from(new Set(packets.map((p) => p.samples.length))).sort((a, b) => a - b);
  const heartRate = effectiveSampleRateHz ? estimateHeartRate(samples, effectiveSampleRateHz) : null;
  return {
    packetCount: packets.length,
    sampleCount,
    lostPackets: countLostPackets(packets),
    streamSeconds: Math.round(streamMs / 100) / 10,
    effectiveSampleRateHz,
    samplesPerPacket: perPacket,
    min,
    max,
    mean: sampleCount ? Math.round(sum / sampleCount) : null,
    firstPacketId: packets.length ? packets[0].packetId : null,
    lastPacketId: packets.length ? packets[packets.length - 1].packetId : null,
    heartRate,
  };
}

// R-peak detection over the raw stream -- a Pan-Tompkins-shaped pipeline
// kept deliberately simple: bandpass as the difference of a 3-sample and a
// 120ms moving average (keeps QRS energy, drops baseline wander), square,
// 100ms integration, then local maxima above 30% of the surrounding 2s
// window's max with a 300ms refractory. Validated 2026-09-19 against a live
// 58s capture (JCV8B 9525CA, ~255 Hz): 110 bpm vs the band's own optical
// 105-113 bpm for the same minutes. The first 2.5s are skipped (front-end
// settling). Returns null with under 3 accepted beats.
function movingAverage(a, w) {
  const out = new Array(a.length);
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i];
    if (i >= w) sum -= a[i - w];
    out[i] = sum / Math.min(i + 1, w);
  }
  return out;
}

function estimateHeartRate(samples, sampleRateHz) {
  const fs = sampleRateHz;
  if (!fs || samples.length < fs * 5) return null;
  const short = movingAverage(samples, 3);
  const long = movingAverage(samples, Math.max(2, Math.round(fs * 0.12)));
  const sq = short.map((v, i) => { const d = v - long[i]; return d * d; });
  const integ = movingAverage(sq, Math.max(2, Math.round(fs * 0.1)));
  const start = Math.round(fs * 2.5);
  const refractory = Math.round(fs * 0.3);
  const win = Math.round(fs * 2);
  const peaks = [];
  let last = -refractory;
  // Rolling window max, recomputed only when the window slides past a peak.
  for (let i = start + 1; i < integ.length - 1; i++) {
    if (!(integ[i] >= integ[i - 1] && integ[i] > integ[i + 1]) || i - last <= refractory) continue;
    let mx = 0;
    for (let j = Math.max(start, i - win); j < Math.min(integ.length, i + win); j++) if (integ[j] > mx) mx = integ[j];
    if (integ[i] > 0.3 * mx) { peaks.push(i); last = i; }
  }
  // The integrated envelope has a flat top as wide as the window, so refine
  // each beat to the largest bandpass excursion within +/-100ms of it.
  const half = Math.round(fs * 0.1);
  for (let k = 0; k < peaks.length; k++) {
    let best = peaks[k]; let bestV = -1;
    for (let j = Math.max(0, peaks[k] - half); j <= Math.min(short.length - 1, peaks[k] + half); j++) {
      const v = Math.abs(short[j] - long[j]);
      if (v > bestV) { bestV = v; best = j; }
    }
    peaks[k] = best;
  }
  const rr = [];
  for (let i = 1; i < peaks.length; i++) rr.push((peaks[i] - peaks[i - 1]) / fs);
  const accepted = rr.filter((r) => r >= 0.33 && r <= 2.0).sort((a, b) => a - b);
  if (accepted.length < 3) return null;
  const median = accepted[Math.floor(accepted.length / 2)];
  const mean = accepted.reduce((a, b) => a + b, 0) / accepted.length;
  const sd = Math.sqrt(accepted.reduce((a, r) => a + (r - mean) * (r - mean), 0) / accepted.length);
  return {
    beats: peaks.length,
    bpmMedian: Math.round(60 / median),
    bpmMean: Math.round(60 / mean),
    rrMedianMs: Math.round(median * 1000),
    rrSdMs: Math.round(sd * 1000),
    rejectedIntervals: rr.length - accepted.length,
  };
}

function ecgSamplesToCsv(packets) {
  const lines = ['index,packetId,value'];
  let index = 0;
  for (const p of packets) {
    for (const v of p.samples) lines.push(`${index++},${p.packetId},${v}`);
  }
  return lines.join('\n') + '\n';
}

module.exports = { summarizeEcg, splitBacklog, countLostPackets, ecgSamplesToCsv, estimateHeartRate };
