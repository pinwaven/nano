// lib/ppgAnalysis.js — pulse-wave analysis over the raw 50 Hz PPG stream (V8 band / Halo ring,
// the SDK's "blood glucose" tap): the 0.5 s high-pass, discontinuity blanking, systolic-peak
// detection that skips the dicrotic wave, the regularity/amplitude quality gate, and the 24-bit
// packing. Pure. Thresholds were pinned against five live captures on 2026-09-20
// (temp/v8-ecg/ppg-*.json): ring still → accepted, ring typing / loose band → refused.
const test = require('node:test');
const assert = require('node:assert');
const {
    analyzePpg, pulseWave, detectPulsePeaks, findDiscontinuities, countLostPackets, measureSampleRate,
    packSamples, unpackSamples, PPG_MIN_ACCEPTED_BEATS, PPG_MIN_REGULAR_FRACTION, PPG_MAX_AMPLITUDE_CV,
} = require('../src/functions/worker/lib/ppgAnalysis');

// Synthetic strip in the devices' own shape: 50-sample frames once a second, a pulse of the
// real morphology (fast rise, slower fall, a dicrotic bump ~300 ms later) at ~1 % of a DC level
// that wanders slowly, plus noise. `irregular` jitters every interval; `motion` adds large
// low-frequency swings and a gain re-range step; `flat` is wander only (sensor off the skin).
function syntheticFrames({ fs = 50, seconds = 60, rrSec = 60 / 78, seed = 1, t0 = 5000000, irregular = false, motion = false, flat = false, dc = 1500000 } = {}) {
    let r = seed;
    const rnd = () => { r = (r * 1103515245 + 12345) & 0x7fffffff; return r / 0x7fffffff - 0.5; };
    const n = fs * seconds;
    const samples = new Array(n);
    let nextBeat = 0.5;
    const beats = [];
    while (nextBeat < seconds + 1) { beats.push(nextBeat); nextBeat += rrSec * (irregular ? 0.6 + 0.8 * (rnd() + 0.5) : 1 + 0.02 * rnd()); }
    for (let i = 0; i < n; i++) {
        const t = i / fs;
        let wander = dc + 0.02 * dc * Math.sin(t * 0.5) + 0.01 * dc * Math.sin(t * 0.17);
        if (motion) wander += 0.6 * dc * Math.sin(t * 0.9) + (t > seconds / 2 ? -0.5 * dc : 0);
        let pulse = 0;
        if (!flat) {
            for (const b of beats) {
                const dt = t - b;
                if (dt < 0 || dt > 0.6) continue;
                pulse += 0.012 * dc * (dt < 0.12 ? Math.sin(dt / 0.12 * Math.PI / 2) : Math.exp(-(dt - 0.12) / 0.16));
                if (dt > 0.28 && dt < 0.42) pulse += 0.003 * dc * Math.sin((dt - 0.28) / 0.14 * Math.PI);   // dicrotic wave
            }
        }
        samples[i] = Math.round(wander + pulse + 0.0005 * dc * rnd());
    }
    const frames = [];
    for (let i = 0, id = 0; i < n; i += 50, id++) {
        frames.push({ packetId: id & 0xff, samples: samples.slice(i, i + 50), receivedAt: t0 + Math.round(i / fs * 1000) + (id % 2) * 8 });
    }
    return frames;
}

test('a steady 60 s pulse wave is accepted, at the right rate, without counting the dicrotic wave', () => {
    const r = analyzePpg(syntheticFrames({ rrSec: 60 / 78 }));
    assert.strictEqual(r.ok, true, JSON.stringify(r.summary));
    assert.ok(Math.abs(r.summary.bpm - 78) <= 1, `bpm ${r.summary.bpm}`);
    assert.ok(r.summary.rr_sd_ms < 40, `sd ${r.summary.rr_sd_ms}`);
    assert.ok(r.summary.regular_fraction >= 0.95, `regular ${r.summary.regular_fraction}`);
    assert.ok(r.summary.amplitude_cv < 0.3, `amplitude cv ${r.summary.amplitude_cv}`);
    assert.ok(Math.abs(r.summary.sample_rate_hz - 50) < 2, `rate ${r.summary.sample_rate_hz}`);
    assert.strictEqual(r.summary.lost_packets, 0);
    assert.strictEqual(r.summary.discontinuities, 0);
    assert.ok(r.summary.accepted_beats >= 70 && r.summary.accepted_beats <= 80, `beats ${r.summary.accepted_beats}`);
    const fast = analyzePpg(syntheticFrames({ rrSec: 60 / 110, seed: 5 }));
    assert.ok(Math.abs(fast.summary.bpm - 110) <= 1, `bpm ${fast.summary.bpm}`);
});

test('a loose or moving sensor is refused, never repaired', () => {
    const flat = analyzePpg(syntheticFrames({ flat: true }));
    assert.strictEqual(flat.ok, false);
    assert.strictEqual(flat.reason, 'poor_contact');
    const jittered = analyzePpg(syntheticFrames({ irregular: true, seed: 3 }));
    assert.strictEqual(jittered.ok, false, `irregular intervals passed: ${JSON.stringify(jittered.summary)}`);
    assert.ok(jittered.summary.regular_fraction < PPG_MIN_REGULAR_FRACTION || jittered.summary.amplitude_cv > PPG_MAX_AMPLITUDE_CV);
    const moving = analyzePpg(syntheticFrames({ motion: true, seed: 9 }));
    assert.ok(moving.summary.discontinuities >= 1, 'the gain step is a discontinuity');
    // Refusal carries the numbers so the client can explain; nothing is stored either way.
    assert.ok('accepted_beats' in flat.summary && 'regular_fraction' in flat.summary);
    const short = analyzePpg(syntheticFrames().slice(0, 5));
    assert.strictEqual(short.ok, false);
    assert.strictEqual(short.reason, 'too_short');
    assert.strictEqual(analyzePpg([]).ok, false);
});

test('discontinuities blank the wave and no interval may span one', () => {
    const frames = syntheticFrames({ seconds: 30 });
    // A gain re-range half way: every later sample drops to a quarter.
    for (let k = 15; k < frames.length; k++) frames[k].samples = frames[k].samples.map((v) => Math.round(v / 4));
    const samples = frames.flatMap((f) => f.samples);
    const jumps = findDiscontinuities(samples);
    assert.deepStrictEqual(jumps, [750]);
    const { hp, valid } = pulseWave(samples, 50);
    assert.strictEqual(valid[750], false);
    assert.strictEqual(valid[750 - 25], false, '0.5 s before is blanked');
    assert.strictEqual(valid[750 + 49], false, '1 s after is blanked');
    assert.strictEqual(valid[750 + 60], true);
    assert.strictEqual(valid[50], false, 'the settling ramp is blanked');
    const peaks = detectPulsePeaks(hp, valid, 50);
    assert.ok(peaks.every((p) => valid[p]));
    const r = analyzePpg(frames);
    assert.strictEqual(r.summary.discontinuities, 1);
    assert.ok(r.summary.rejected_intervals >= 1, 'the interval across the step is rejected');
});

test('frame sequence gaps, the measured rate, and the 24-bit packing', () => {
    const frames = syntheticFrames({ seconds: 10 });
    assert.strictEqual(countLostPackets(frames), 0);
    assert.strictEqual(countLostPackets([frames[0], frames[1], frames[4]]), 2);
    assert.strictEqual(countLostPackets([{ packetId: 250 }, { packetId: 3 }]), 8, 'a small gap across the uint8 wrap is still a loss');
    assert.strictEqual(countLostPackets([{ packetId: 40 }, { packetId: 0 }]), 0, 'a jump of 128+ backwards is a counter reset, not a loss');
    assert.ok(Math.abs(measureSampleRate(frames) - 50) < 2);
    assert.strictEqual(measureSampleRate(frames.slice(0, 1)), null);
    const vals = [0, 1, 255, 256, 65535, 65536, 0xffffff, 1234567, 6414323];
    assert.deepStrictEqual(unpackSamples(packSamples(vals)), vals);
    assert.strictEqual(packSamples(vals).length, vals.length * 3);
    assert.deepStrictEqual(unpackSamples(packSamples([0x1000000 + 5, -3])), [0xffffff, 0], 'clamped to 24 bits');
    assert.ok(PPG_MIN_ACCEPTED_BEATS >= 10);
});
