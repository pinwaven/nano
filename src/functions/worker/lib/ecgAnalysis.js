'use strict';

// Single-lead ECG from the V8 band (CLAUDE.md §18): pure analysis over the raw 0x07 sample
// stream the miniapp adapter collects. No DB, no I/O — the same pipeline as tools/halo's
// src/ecg-summary.js, which was validated live on 2026-09-19 against the band's own optical
// heart rate (108–110 vs 105–113 bpm over the same minutes). The band ships no analysis and no
// voltage scale, so everything here is rhythm: beats, R–R intervals, a rate. Nothing is a
// diagnosis and no copy anywhere may call it one.
//
// Input shape: packets [{ packetId, samples: number[] (unsigned 24-bit ADC counts), receivedAt (ms) }]
// as the adapter received them, in order. The band keeps sampling after the app's stop and
// buffers while the tap is closed, then flushes the buffer at ~33 packets/s on the next tap
// open — that flush belongs to a previous measurement and is split off here (backlog), never
// analysed.

const ECG_MIN_ACCEPTED_BEATS = 10;   // fewer and the strip is a contact miss, not a recording
// R-waves must stand above the band-pass noise floor. Pure noise scores 1.6–3.2 in tests;
// the noisiest real strips of 2026-09-19 (motion, weak contact) scored 4.1–4.2 and clean ones
// 6–18. 3.5 keeps every real strip and drops every noise-only one; quality stays visible
// through peak_snr and rr_sd_ms on the stored summary.
const ECG_MIN_PEAK_SNR = 3.5;
const RR_MIN_MS = 330;               // 182 bpm
const RR_MAX_MS = 2000;              // 30 bpm
const SETTLE_SECONDS = 2.5;          // front-end settling ramp at the start of every measurement

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

// Everything before the first >500 ms gap is a backlog flush when it holds more than one live
// second's worth (a normal start is 3 packets, then the ~900 ms gap).
function splitBacklog(packets) {
    let cut = 0;
    for (let i = 1; i < packets.length; i++) {
        if (packets[i].receivedAt - packets[i - 1].receivedAt > 500) { cut = i; break; }
    }
    if (cut <= 4) return { backlog: [], live: packets };
    return { backlog: packets.slice(0, cut), live: packets.slice(cut) };
}

// Count packets missing from the uint8 packetId sequence. A gap of 128+ is a counter reset.
function countLostPackets(packets) {
    let lost = 0;
    for (let i = 1; i < packets.length; i++) {
        const expected = (packets[i - 1].packetId + 1) & 0xff;
        const gap = (packets[i].packetId - expected + 256) & 0xff;
        if (gap > 0 && gap < 128) lost += gap;
    }
    return lost;
}

// Sample rate measured from arrival times: samples in all packets but the last, over the span
// between the first and last packet arrival. Needs two packets.
function measureSampleRate(packets) {
    if (packets.length < 2) return null;
    const span = packets[packets.length - 1].receivedAt - packets[0].receivedAt;
    if (span <= 0) return null;
    let covered = 0;
    for (let i = 0; i < packets.length - 1; i++) covered += packets[i].samples.length;
    return Math.round((covered / span) * 1000 * 10) / 10;
}

// Pan-Tompkins-shaped R-peak detection: band-pass as the difference of a 3-sample and a 120 ms
// moving average, square, 100 ms integrate, local maxima above 30% of the surrounding 2 s window
// with a 300 ms refractory, each refined to the largest band-pass excursion within ±100 ms.
function detectRPeaks(samples, fs) {
    if (!fs || samples.length < fs * 5) return [];
    const short = movingAverage(samples, 3);
    const long = movingAverage(samples, Math.max(2, Math.round(fs * 0.12)));
    const sq = short.map((v, i) => { const d = v - long[i]; return d * d; });
    const integ = movingAverage(sq, Math.max(2, Math.round(fs * 0.1)));
    const start = Math.round(fs * SETTLE_SECONDS);
    const refractory = Math.round(fs * 0.3);
    const win = Math.round(fs * 2);
    const peaks = [];
    let last = -refractory;
    for (let i = start + 1; i < integ.length - 1; i++) {
        if (!(integ[i] >= integ[i - 1] && integ[i] > integ[i + 1]) || i - last <= refractory) continue;
        let mx = 0;
        for (let j = Math.max(start, i - win); j < Math.min(integ.length, i + win); j++) if (integ[j] > mx) mx = integ[j];
        if (integ[i] > 0.3 * mx) { peaks.push(i); last = i; }
    }
    const half = Math.round(fs * 0.1);
    for (let k = 0; k < peaks.length; k++) {
        let best = peaks[k]; let bestV = -1;
        for (let j = Math.max(0, peaks[k] - half); j <= Math.min(short.length - 1, peaks[k] + half); j++) {
            const v = Math.abs(short[j] - long[j]);
            if (v > bestV) { bestV = v; best = j; }
        }
        peaks[k] = best;
    }
    return peaks;
}

// Signal quality: the median band-pass excursion at the detected peaks over the median
// excursion everywhere else. A real R-wave stands tens of times above the floor; noise on a
// flat line only ever finds "peaks" a few times above it, whatever the adaptive threshold does.
function peakSnr(samples, peaks, fs) {
    if (!peaks.length || !fs) return 0;
    const short = movingAverage(samples, 3);
    const long = movingAverage(samples, Math.max(2, Math.round(fs * 0.12)));
    const start = Math.round(fs * SETTLE_SECONDS);
    const floor = [];
    for (let i = start; i < samples.length; i += 4) floor.push(Math.abs(short[i] - long[i]));
    floor.sort((a, b) => a - b);
    const noise = floor[Math.floor(floor.length / 2)] || 1;
    const atPeaks = peaks.map((i) => Math.abs(short[i] - long[i])).sort((a, b) => a - b);
    return Math.round((atPeaks[Math.floor(atPeaks.length / 2)] / noise) * 10) / 10;
}

function rhythmFromPeaks(peaks, fs) {
    const rr = [];
    for (let i = 1; i < peaks.length; i++) rr.push((peaks[i] - peaks[i - 1]) / fs * 1000);
    const accepted = rr.filter((r) => r >= RR_MIN_MS && r <= RR_MAX_MS).sort((a, b) => a - b);
    if (accepted.length < 3) {
        return { beats: peaks.length, accepted_beats: accepted.length, bpm: null, rr_median_ms: null, rr_sd_ms: null, rejected_intervals: rr.length - accepted.length };
    }
    const median = accepted[Math.floor(accepted.length / 2)];
    const mean = accepted.reduce((a, b) => a + b, 0) / accepted.length;
    const sd = Math.sqrt(accepted.reduce((a, r) => a + (r - mean) * (r - mean), 0) / accepted.length);
    return {
        beats: peaks.length,
        accepted_beats: accepted.length,
        bpm: Math.round(60000 / median),
        rr_median_ms: Math.round(median),
        rr_sd_ms: Math.round(sd),
        rejected_intervals: rr.length - accepted.length,
    };
}

// The whole thing. Returns { ok, reason?, summary, live: { samples, peaks }, backlogPackets }.
// `ok: false` with reason 'poor_contact' is a refusal to store — not an error — when fewer than
// ECG_MIN_ACCEPTED_BEATS clean beats were found; 'too_short' when there is nothing to analyse.
function analyzeEcg(packets, opts = {}) {
    const clean = (Array.isArray(packets) ? packets : [])
        .filter((p) => p && Array.isArray(p.samples) && Number.isFinite(p.receivedAt))
        .map((p) => ({ packetId: Number(p.packetId) & 0xff, samples: p.samples.map(Number), receivedAt: Number(p.receivedAt) }));
    const { backlog, live } = splitBacklog(clean);
    const samples = [];
    for (const p of live) for (const v of p.samples) samples.push(v);
    const fs = opts.sampleRateHz || measureSampleRate(live);
    const streamMs = live.length >= 2 ? live[live.length - 1].receivedAt - live[0].receivedAt : 0;
    const base = {
        packets: live.length,
        samples: samples.length,
        lost_packets: countLostPackets(live),
        sample_rate_hz: fs,
        duration_seconds: Math.round(streamMs / 100) / 10,
        backlog_packets: backlog.length,
    };
    if (!fs || samples.length < fs * 5) {
        return { ok: false, reason: 'too_short', summary: { ...base, ...rhythmFromPeaks([], fs || 1) }, live: { samples, peaks: [] }, backlogPackets: backlog.length };
    }
    const peaks = detectRPeaks(samples, fs);
    const rhythm = rhythmFromPeaks(peaks, fs);
    const summary = { ...base, ...rhythm, peak_snr: peakSnr(samples, peaks, fs) };
    if (rhythm.accepted_beats < ECG_MIN_ACCEPTED_BEATS || summary.peak_snr < ECG_MIN_PEAK_SNR) {
        return { ok: false, reason: 'poor_contact', summary, live: { samples, peaks }, backlogPackets: backlog.length };
    }
    return { ok: true, summary, live: { samples, peaks }, backlogPackets: backlog.length };
}

// Waveform storage: 3 bytes per sample, little-endian, exactly the band's own encoding — a
// 30 s strip is ~23 KB instead of ~60 KB of JSON digits.
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
    ECG_MIN_ACCEPTED_BEATS, ECG_MIN_PEAK_SNR, RR_MIN_MS, RR_MAX_MS, SETTLE_SECONDS, peakSnr,
    analyzeEcg, detectRPeaks, rhythmFromPeaks, splitBacklog, countLostPackets, measureSampleRate,
    packSamples, unpackSamples,
};
