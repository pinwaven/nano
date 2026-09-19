// lib/ecgAnalysis.js — the rhythm analysis over a V8 band's raw 0x07 stream: backlog split,
// measured sample rate, R-peak detection through baseline wander, the refusal floor, and the
// 24-bit waveform packing. Pure; the numbers here were pinned against three live captures on
// 2026-09-19 (temp/v8-ecg/), where the derived rate matched the band's optical HR.
const test = require('node:test');
const assert = require('node:assert');
const {
    analyzeEcg, splitBacklog, countLostPackets, measureSampleRate, packSamples, unpackSamples,
    ECG_MIN_ACCEPTED_BEATS,
} = require('../src/functions/worker/lib/ecgAnalysis');

// Synthetic single-lead strip in the band's own shape: 80-sample packets, 3 per second, a
// narrow positive spike every rrSec on slow wander plus noise, unsigned 24-bit range.
function syntheticPackets({ fs = 256, seconds = 30, rrSec = 60 / 72, seed = 1, t0 = 1000000, flat = false } = {}) {
    let r = seed;
    const rnd = () => { r = (r * 1103515245 + 12345) & 0x7fffffff; return r / 0x7fffffff - 0.5; };
    const samples = [];
    for (let i = 0; i < fs * seconds; i++) {
        const t = i / fs;
        const wander = 2200000 + 60000 * Math.sin(t * 0.7) + 30000 * Math.sin(t * 0.13);
        const phase = (t % rrSec) / rrSec;
        const qrs = !flat && phase < 0.03 ? 40000 * Math.sin((phase / 0.03) * Math.PI) : 0;
        samples.push(Math.round(wander + qrs + 1500 * rnd()));
    }
    // Arrival times consistent with fs (the band's 3-and-a-bit packets per second), with the
    // 30 ms in-burst jitter a real capture shows.
    const packets = [];
    for (let i = 0, id = 0; i < samples.length; i += 80, id++) {
        packets.push({ packetId: id & 0xff, samples: samples.slice(i, i + 80), receivedAt: t0 + Math.round(i / fs * 1000) + (id % 3) * 10 });
    }
    return packets;
}

test('a clean 30 s strip is accepted and its rate is recovered through baseline wander', () => {
    const r = analyzeEcg(syntheticPackets({ rrSec: 60 / 72 }));
    assert.strictEqual(r.ok, true);
    assert.ok(Math.abs(r.summary.bpm - 72) <= 1, `bpm ${r.summary.bpm}`);
    assert.ok(r.summary.rr_sd_ms < 20, `sd ${r.summary.rr_sd_ms}`);
    assert.ok(Math.abs(r.summary.sample_rate_hz - 256) < 8, `rate ${r.summary.sample_rate_hz}`);
    assert.ok(r.summary.peak_snr > 10, `snr ${r.summary.peak_snr}`);
    assert.strictEqual(r.summary.lost_packets, 0);
    assert.strictEqual(r.summary.backlog_packets, 0);
    assert.ok(r.live.peaks.length >= 30);
    const fast = analyzeEcg(syntheticPackets({ rrSec: 60 / 110, seed: 7 }));
    assert.ok(Math.abs(fast.summary.bpm - 110) <= 1, `bpm ${fast.summary.bpm}`);
});

test('too few clean beats is a refusal, not a recording', () => {
    const flat = analyzeEcg(syntheticPackets({ flat: true }));
    assert.strictEqual(flat.ok, false);
    assert.strictEqual(flat.reason, 'poor_contact');
    assert.ok(flat.summary.peak_snr < 3.5, `noise "peaks" scored snr ${flat.summary.peak_snr}`);
    const loud = analyzeEcg(syntheticPackets({ flat: true, seed: 3 }).map((p) => ({ ...p, samples: p.samples.map((v) => 2200000 + (v - 2200000) * 20) })));
    assert.strictEqual(loud.ok, false, 'louder noise is still noise');
    // The 11-packet abort a band emits without finger contact.
    const burst = analyzeEcg(syntheticPackets().slice(0, 11));
    assert.strictEqual(burst.ok, false);
    assert.strictEqual(burst.reason, 'too_short');
    assert.strictEqual(analyzeEcg([]).ok, false);
    assert.strictEqual(analyzeEcg(null).ok, false);
});

test('a backlog flush from the previous measurement is split off and never analysed', () => {
    const live = syntheticPackets({ t0: 2000000 });
    // 40 stale packets at 30 ms spacing, then the ~900 ms gap the live stream keeps.
    const stale = [];
    for (let i = 0; i < 40; i++) stale.push({ packetId: (200 + i) & 0xff, samples: new Array(80).fill(2200000), receivedAt: 1990000 + i * 30 });
    const r = analyzeEcg(stale.concat(live));
    assert.strictEqual(r.summary.backlog_packets, 40);
    assert.strictEqual(r.summary.packets, live.length);
    assert.ok(Math.abs(r.summary.bpm - 72) <= 1);
    const normal = splitBacklog(live);
    assert.strictEqual(normal.backlog.length, 0, 'a normal 3-packet start is not a backlog');
});

test('lost packets and the measured rate', () => {
    const ids = (list) => list.map((packetId) => ({ packetId, samples: [] }));
    assert.strictEqual(countLostPackets(ids([254, 255, 0, 1])), 0);
    assert.strictEqual(countLostPackets(ids([254, 1])), 2);
    assert.strictEqual(countLostPackets(ids([100, 0])), 0, 'a 128+ gap is a counter reset');
    const p = [{ samples: new Array(80), receivedAt: 0 }, { samples: new Array(80), receivedAt: 320 }, { samples: new Array(80), receivedAt: 640 }];
    assert.strictEqual(measureSampleRate(p), 250);
    assert.strictEqual(measureSampleRate(p.slice(0, 1)), null);
});

test('packSamples/unpackSamples round-trip the band\'s 24-bit range at 3 bytes per sample', () => {
    const s = [0, 1, 255, 256, 65535, 65536, 2200000, 16777215];
    const buf = packSamples(s);
    assert.strictEqual(buf.length, s.length * 3);
    assert.deepStrictEqual(unpackSamples(buf), s);
    assert.deepStrictEqual(unpackSamples(packSamples([-5, 99999999])), [0, 16777215], 'clamped, never wrapped');
});
