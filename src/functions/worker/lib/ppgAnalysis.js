'use strict';

// 脉搏波 — pulse-wave analysis over the raw PPG stream the V8 band and the Halo ring both
// expose through the vendor SDK's "blood glucose" collection (0x78 start / 0x3a frames): one
// optical channel, 50 Hz, 24-bit reflected-light counts with no documented LED, gain or units.
// Pure — no DB, no I/O. Sibling of ecgAnalysis.js, not a reuse of it: an ECG R-peak is a sharp
// spike over a flat baseline, a PPG pulse is a slow hump riding on a DC level a hundred times
// larger, and the device re-ranges its gain mid-stream. Every rule below came from live captures
// on 2026-09-20 (tools/halo README "PPG", v8-smart-band.md §6, halo-smart-ring.md §3.12):
//   - the pulse is 0.5–3 % of DC, so the signal is high-passed (0.5 s) before anything else;
//   - a >20 % single-sample step is the device re-ranging (or the sensor leaving the skin) —
//     the strip is blanked around it and no interval may span it;
//   - the first 2 s are the LED/gain settling ramp and are never analysed;
//   - a device that is not against skin streams smooth wander with no pulse at all, and motion
//     swings the DC level 2–3× within seconds — both are refused as poor_contact, never repaired.
// Nothing here is a diagnosis: heart rate and beat-to-beat regularity only.

const PPG_MIN_ACCEPTED_BEATS = 15;   // a 60 s capture at 60 bpm has ~55; fewer is a contact miss
// Quality gate, calibrated on the 2026-09-20 captures. Neither a spectral peak nor a peak/noise
// ratio separated a loose wrist from a finger (the band's wander is itself quasi-periodic), but
// two things did: how regular the accepted intervals are, and how consistent the pulse
// amplitudes are. Ring on a still finger: 98 % of intervals within ±20 % of the median,
// amplitude CV 0.23. Band on a still wrist: 58 % / 0.60. Ring while typing: 79 % / 1.98. Band
// on a loose wrist: 57 % / 0.42. The gate passes the first, refuses the rest — a marginal wrist
// signal is refused as poor_contact and the UI asks for a snug strap, never repaired.
const PPG_MIN_REGULAR_FRACTION = 0.6;
const PPG_MAX_AMPLITUDE_CV = 1.0;
const PPI_MIN_MS = 330;              // 182 bpm
const PPI_MAX_MS = 2000;             // 30 bpm
const PULSE_REFRACTORY_MS = 400;     // 150 bpm; longer than the ECG's so the dicrotic wave is not a beat
const SETTLE_SECONDS = 2;
const STEP_FRACTION = 0.2;           // a single-sample step larger than this of the level is a discontinuity
const BLANK_BEFORE_S = 0.5;
const BLANK_AFTER_S = 1.0;
const DEFAULT_RATE_HZ = 50;

// Centred moving average of half-width w (window 2w+1), edge-shrunk.
function centredAverage(a, w) {
    const n = a.length;
    const out = new Array(n);
    let sum = 0;
    const q = [];
    for (let i = 0; i < n + w; i++) {
        if (i < n) { q.push(a[i]); sum += a[i]; }
        if (q.length > 2 * w + 1) sum -= q.shift();
        if (i - w >= 0) out[i - w] = sum / q.length;
    }
    return out;
}

// Count frames missing from the uint8 sequence byte. A gap of 128+ is a counter reset.
function countLostPackets(packets) {
    let lost = 0;
    for (let i = 1; i < packets.length; i++) {
        const expected = (packets[i - 1].packetId + 1) & 0xff;
        const gap = (packets[i].packetId - expected + 256) & 0xff;
        if (gap > 0 && gap < 128) lost += gap;
    }
    return lost;
}

// Sample rate from arrival times: all frames but the last, over the first→last arrival span.
function measureSampleRate(packets) {
    if (packets.length < 2) return null;
    const span = packets[packets.length - 1].receivedAt - packets[0].receivedAt;
    if (span <= 0) return null;
    let covered = 0;
    for (let i = 0; i < packets.length - 1; i++) covered += packets[i].samples.length;
    return Math.round((covered / span) * 1000 * 10) / 10;
}

// Sample indexes where the level jumps by more than STEP_FRACTION in one sample.
function findDiscontinuities(samples) {
    const out = [];
    for (let i = 1; i < samples.length; i++) {
        const prev = Math.abs(samples[i - 1]) || 1;
        if (Math.abs(samples[i] - samples[i - 1]) > STEP_FRACTION * prev) out.push(i);
    }
    return out;
}

// The pulse wave: MA(±2 samples) minus MA(±0.25 s) — a 0.5 s high-pass with light smoothing —
// plus a validity mask that blanks the settling ramp and every discontinuity.
function pulseWave(samples, fs) {
    const short = centredAverage(samples, 2);
    const long = centredAverage(samples, Math.max(2, Math.round(fs * 0.25)));
    const hp = new Array(samples.length);
    for (let i = 0; i < samples.length; i++) hp[i] = short[i] - long[i];
    const valid = new Array(samples.length).fill(true);
    for (let i = 0; i < Math.min(samples.length, Math.round(fs * SETTLE_SECONDS)); i++) valid[i] = false;
    const jumps = findDiscontinuities(samples);
    for (const j of jumps) {
        for (let i = Math.max(0, j - Math.round(fs * BLANK_BEFORE_S)); i < Math.min(samples.length, j + Math.round(fs * BLANK_AFTER_S)); i++) valid[i] = false;
    }
    return { hp, valid, jumps };
}

// Systolic peaks: local maxima of the valid pulse wave above 40 % of the largest excursion in
// the surrounding ±1.5 s, at least PULSE_REFRACTORY_MS apart — the dicrotic wave sits
// 250–400 ms after the systolic peak and must not count as a beat, which is why this
// refractory is longer than the ECG's 300 ms. Of two candidates inside it the taller wins.
function detectPulsePeaks(hp, valid, fs) {
    let n = 0;
    for (let i = 0; i < hp.length; i++) if (valid[i]) n++;
    if (n < fs * 3) return [];
    const half = Math.round(fs * 1.5);
    const refractory = Math.round(fs * PULSE_REFRACTORY_MS / 1000);
    const peaks = [];
    for (let i = 1; i < hp.length - 1; i++) {
        if (!valid[i] || hp[i] <= 0) continue;
        if (hp[i] < hp[i - 1] || hp[i] <= hp[i + 1]) continue;
        let localMax = 0;
        for (let k = Math.max(0, i - half); k < Math.min(hp.length, i + half); k++) if (valid[k] && hp[k] > localMax) localMax = hp[k];
        if (hp[i] < 0.4 * localMax) continue;
        if (peaks.length && i - peaks[peaks.length - 1] <= refractory) {
            if (hp[i] > hp[peaks[peaks.length - 1]]) peaks[peaks.length - 1] = i;
            continue;
        }
        peaks.push(i);
    }
    return peaks;
}

// Median pulse amplitude over the median absolute level of the clean strip.
function peakSnr(hp, valid, peaks) {
    if (!peaks.length) return 0;
    const floor = [];
    for (let i = 0; i < hp.length; i += 2) if (valid[i]) floor.push(Math.abs(hp[i]));
    floor.sort((a, b) => a - b);
    const noise = floor[Math.floor(floor.length / 2)] || 1;
    const at = peaks.map((i) => hp[i]).sort((a, b) => a - b);
    return Math.round((at[Math.floor(at.length / 2)] / noise) * 10) / 10;
}

// Amplitude consistency of the detected pulses: sd / mean of the pulse-wave value at each peak.
function amplitudeCv(hp, peaks) {
    if (peaks.length < 3) return null;
    const amps = peaks.map((i) => hp[i]);
    const mean = amps.reduce((a, b) => a + b, 0) / amps.length;
    if (!(mean > 0)) return null;
    const sd = Math.sqrt(amps.reduce((a, v) => a + (v - mean) * (v - mean), 0) / amps.length);
    return Math.round((sd / mean) * 100) / 100;
}

// Beat intervals between consecutive peaks; an interval that spans blanked samples is rejected
// alongside the physiologically implausible ones. regular_fraction is the share of accepted
// intervals within ±20 % of their median — the regularity the quality gate reads.
function rhythmFromPeaks(peaks, valid, fs) {
    const all = [];
    const accepted = [];
    for (let i = 1; i < peaks.length; i++) {
        const ms = (peaks[i] - peaks[i - 1]) / fs * 1000;
        let clean = ms >= PPI_MIN_MS && ms <= PPI_MAX_MS;
        if (clean) for (let k = peaks[i - 1]; k <= peaks[i]; k++) if (!valid[k]) { clean = false; break; }
        all.push(ms);
        if (clean) accepted.push(ms);
    }
    accepted.sort((a, b) => a - b);
    if (accepted.length < 3) {
        return { beats: peaks.length, accepted_beats: accepted.length, bpm: null, rr_median_ms: null, rr_sd_ms: null, rejected_intervals: all.length - accepted.length, regular_fraction: null };
    }
    const median = accepted[Math.floor(accepted.length / 2)];
    const mean = accepted.reduce((a, b) => a + b, 0) / accepted.length;
    const sd = Math.sqrt(accepted.reduce((a, r) => a + (r - mean) * (r - mean), 0) / accepted.length);
    const regular = accepted.filter((r) => Math.abs(r - median) < 0.2 * median).length;
    return {
        beats: peaks.length,
        accepted_beats: accepted.length,
        bpm: Math.round(60000 / median),
        rr_median_ms: Math.round(median),   // same field names as the ECG summary so one card renders both
        rr_sd_ms: Math.round(sd),
        rejected_intervals: all.length - accepted.length,
        regular_fraction: Math.round((regular / accepted.length) * 100) / 100,
    };
}

// The whole thing. Same contract as analyzeEcg: { ok, reason?, summary, live: { samples, peaks } }.
// `ok: false` with 'poor_contact' is a refusal to store — too few clean beats or a pulse not
// standing out of the wander — and 'too_short' when there is nothing to analyse.
function analyzePpg(packets, opts = {}) {
    const samples = [];
    for (const p of packets) for (const v of p.samples) samples.push(v);
    const fs = opts.sampleRateHz || measureSampleRate(packets) || (packets.length === 1 ? DEFAULT_RATE_HZ : null);
    const streamMs = packets.length >= 2 ? packets[packets.length - 1].receivedAt - packets[0].receivedAt : 0;
    const base = {
        packets: packets.length,
        samples: samples.length,
        lost_packets: countLostPackets(packets),
        sample_rate_hz: fs,
        duration_seconds: Math.round(streamMs / 100) / 10,
    };
    if (!fs || samples.length < fs * 8) {
        return { ok: false, reason: 'too_short', summary: { ...base, discontinuities: 0, ...rhythmFromPeaks([], [], fs || 1) }, live: { samples, peaks: [] } };
    }
    const { hp, valid, jumps } = pulseWave(samples, fs);
    const peaks = detectPulsePeaks(hp, valid, fs);
    const rhythm = rhythmFromPeaks(peaks, valid, fs);
    const summary = { ...base, discontinuities: jumps.length, ...rhythm, amplitude_cv: amplitudeCv(hp, peaks), peak_snr: peakSnr(hp, valid, peaks) };
    if (rhythm.accepted_beats < PPG_MIN_ACCEPTED_BEATS || !(rhythm.regular_fraction >= PPG_MIN_REGULAR_FRACTION) ||
        !(summary.amplitude_cv != null && summary.amplitude_cv <= PPG_MAX_AMPLITUDE_CV)) {
        return { ok: false, reason: 'poor_contact', summary, live: { samples, peaks } };
    }
    return { ok: true, summary, live: { samples, peaks } };
}

// 24-bit little-endian packing, shared shape with the ECG store (values are 24-bit counts).
function packSamples(samples) {
    const buf = Buffer.alloc(samples.length * 3);
    for (let i = 0; i < samples.length; i++) {
        const v = Math.max(0, Math.min(0xffffff, Math.round(samples[i])));
        buf[3 * i] = v & 0xff; buf[3 * i + 1] = (v >> 8) & 0xff; buf[3 * i + 2] = (v >> 16) & 0xff;
    }
    return buf;
}

function unpackSamples(buf) {
    const n = Math.floor(buf.length / 3);
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = buf[3 * i] | (buf[3 * i + 1] << 8) | (buf[3 * i + 2] << 16);
    return out;
}

module.exports = {
    PPG_MIN_ACCEPTED_BEATS, PPG_MIN_REGULAR_FRACTION, PPG_MAX_AMPLITUDE_CV, PPI_MIN_MS, PPI_MAX_MS,
    PULSE_REFRACTORY_MS, SETTLE_SECONDS, STEP_FRACTION,
    analyzePpg, pulseWave, detectPulsePeaks, rhythmFromPeaks, amplitudeCv, peakSnr, findDiscontinuities,
    countLostPackets, measureSampleRate, packSamples, unpackSamples,
};
