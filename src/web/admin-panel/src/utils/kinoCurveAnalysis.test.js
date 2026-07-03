import { test, expect } from 'vitest';
import { findSlopeRegions, calculateAreaBetweenCurveAndLine, buildCurveMarkers } from './kinoCurveAnalysis.js';

test('returns empty for empty curve', () => {
  expect(findSlopeRegions([])).toEqual([]);
});

test('area is 0 for points on a flat line', () => {
  const pts = [0, 1, 2, 3].map((x) => ({ x, y: 5 }));
  expect(calculateAreaBetweenCurveAndLine(pts, 0, 3)).toBeCloseTo(0);
});

test('area equals triangle for a simple peak above baseline', () => {
  // (0,0),(1,10),(2,0): baseline is y=0, area = 10*2/2 = 10
  const pts = [{ x: 0, y: 0 }, { x: 1, y: 10 }, { x: 2, y: 0 }];
  expect(calculateAreaBetweenCurveAndLine(pts, 0, 2)).toBeCloseTo(10);
});

test('detects a single broad peak in a 1000-point bell curve', () => {
  // Exact integer slopes (no rounding plateaus), like smooth ADC data.
  const curve = Array.from({ length: 1000 }, (_, i) => {
    if (i <= 200) return i;          // rise, slope 1
    if (i <= 400) return 400 - i;    // fall, slope -1
    return 0;                        // flat tail
  });
  const regions = findSlopeRegions(curve);
  expect(regions.length).toBeGreaterThanOrEqual(1);
  expect(regions[0].area).toBeGreaterThan(0);
  expect(regions[0]).toHaveProperty('startIndex');
  expect(regions[0]).toHaveProperty('endIndex');
  expect(regions[0]).toHaveProperty('peakIndex');
});

test('detects two separate peaks in order and both have positive area', () => {
  // Exact integer slopes (no rounding plateaus).
  // Peak 1: apex 150 at i=150, base 0..300 (taller/wider)
  // Flat valley 300..600
  // Peak 2: apex 90 at i=690, base 600..780 (shorter/narrower)
  const curve = Array.from({ length: 1000 }, (_, i) => {
    if (i <= 150) return i;              // peak 1 rise
    if (i <= 300) return 300 - i;        // peak 1 fall
    if (i <= 600) return 0;              // valley
    if (i <= 690) return i - 600;        // peak 2 rise
    if (i <= 780) return 780 - i;        // peak 2 fall
    return 0;
  });
  const regions = findSlopeRegions(curve);
  expect(regions.length).toBe(2);
  expect(regions[0].peakIndex).toBeLessThan(regions[1].peakIndex);
  expect(regions[0].area).toBeGreaterThan(0);
  expect(regions[1].area).toBeGreaterThan(0);
  // Peak 1 is taller and wider -> larger area -> ratio > 1
  expect(regions[0].area / regions[1].area).toBeGreaterThan(1);
});

test('start advances to the steep-rise foot when the gentle lead-in dips below the chord', () => {
  // Monotonic rise: a gentle slope-1 lead-in (100..140), then a steep slope-5
  // rise to the peak (340 @200), then a fall that ENDS elevated (240). The
  // left-flat walk includes the whole rise (every step > 0.2) and starts at 100.
  // But the start->end chord is steep (~1.6), so the gentle lead-in lies below
  // it -> the real start is the steep-rise foot (~140), not the baseline (100).
  const curve = Array.from({ length: 1000 }, (_, i) => {
    if (i <= 100) return 0;
    if (i <= 140) return i - 100;          // gentle rise, slope 1 -> 40
    if (i <= 200) return 40 + 5 * (i - 140); // steep rise, slope 5 -> 340
    if (i <= 250) return 340 - 2 * (i - 200); // fall, slope -2 -> 240
    return 240;                            // elevated flat tail
  });
  const regions = findSlopeRegions(curve);
  expect(regions.length).toBeGreaterThanOrEqual(1);
  expect(regions[0].peakIndex).toBe(200);
  expect(regions[0].startIndex).toBeGreaterThanOrEqual(135);
});

test('start searches outward past a small mid-rise plateau to the true foot of the wave', () => {
  // Real curves have small plateaus/noise on the rise. Walking back from the
  // peak with adjacent-point slope stops at the plateau (start lands mid-rise).
  // Searching outward from the peak with a windowed slope must walk through it
  // and put the start at the foot of the wave (~300).
  const curve = Array.from({ length: 1000 }, (_, i) => {
    if (i <= 300) return 0;                 // baseline
    if (i <= 400) return i - 300;           // rise, slope 1 -> 100
    if (i <= 405) return 100;               // small plateau mid-rise
    if (i <= 500) return 100 + (i - 405);   // rise resumes -> 195
    if (i <= 695) return 195 - (i - 500);   // fall, slope -1 -> 0
    return 0;                               // flat tail
  });
  const regions = findSlopeRegions(curve);
  expect(regions.length).toBeGreaterThanOrEqual(1);
  expect(regions[0].peakIndex).toBe(500);
  expect(regions[0].startIndex).toBeLessThanOrEqual(310);
  expect(regions[0].startIndex).toBeGreaterThanOrEqual(280);
});

test('end lands on the lowest point of the flat tail, not the first flat point', () => {
  // After the fall, the tail keeps declining gently (slope -0.1, below the flat
  // threshold). The end must sit at the tail minimum (~400, y=28), not where
  // the walk first sees a flat slope (~280, y=40) — a high end tilts the chord
  // and corrupts the start adjustment.
  const curve = Array.from({ length: 1000 }, (_, i) => {
    if (i <= 100) return 0;                       // baseline
    if (i <= 200) return 2 * (i - 100);           // rise, slope 2 -> 200
    if (i <= 280) return 200 - 2 * (i - 200);     // fall, slope -2 -> 40
    if (i <= 400) return 40 - 0.1 * (i - 280);    // gentle tail decline -> 28
    return 28;                                    // flat
  });
  const regions = findSlopeRegions(curve);
  expect(regions.length).toBeGreaterThanOrEqual(1);
  expect(regions[0].peakIndex).toBe(200);
  expect(regions[0].endIndex).toBe(400);
});

test('end shrinks to the violation point when the fall dips below the start-end chord', () => {
  // Elevated baseline (100), tall peak, concave fall: fast drop to 40, then a
  // slow slide to 0. The slow slide sits BELOW the chord from start (y=100) to
  // the tail (y=0), so the region must not include it: end shrinks back to the
  // first violation point (~205) where the fast drop crosses the chord.
  const curve = Array.from({ length: 1000 }, (_, i) => {
    if (i <= 100) return 100;                     // elevated baseline
    if (i <= 160) return 100 + 5 * (i - 100);     // rise, slope 5 -> 400
    if (i <= 205) return 400 - 8 * (i - 160);     // fast fall, slope -8 -> 40
    if (i <= 285) return 40 - 0.5 * (i - 205);    // slow slide, slope -0.5 -> 0
    return 0;                                     // flat tail
  });
  const regions = findSlopeRegions(curve);
  expect(regions.length).toBeGreaterThanOrEqual(1);
  expect(regions[0].peakIndex).toBe(160);
  expect(regions[0].startIndex).toBeLessThanOrEqual(105);
  expect(regions[0].endIndex).toBe(205);
});

test('end walks through a mid-fall shoulder when a steep drop lies ahead', () => {
  // The fall pauses on a shoulder (flat 100, small bump to 110) before dropping
  // to the real baseline. The walk must look ahead, see the steep drop coming,
  // and continue through the shoulder so the end lands at the true foot (340),
  // not on the shoulder (250).
  const curve = Array.from({ length: 1000 }, (_, i) => {
    if (i <= 100) return 0;                       // baseline
    if (i <= 200) return 2 * (i - 100);           // rise, slope 2 -> 200
    if (i <= 250) return 200 - 2 * (i - 200);     // fall, slope -2 -> 100
    if (i <= 280) return 100;                     // shoulder
    if (i <= 290) return 100 + (i - 280);         // small bump -> 110
    if (i <= 340) return 110 - 2.2 * (i - 290);   // second drop -> 0
    return 0;                                     // flat tail
  });
  const regions = findSlopeRegions(curve);
  expect(regions.length).toBeGreaterThanOrEqual(1);
  expect(regions[0].peakIndex).toBe(200);
  expect(regions[0].endIndex).toBe(340);
});

test('region is clamped to the max x-distance on a long slow fall', () => {
  // A fall of slope -0.5 keeps the walk going for 400 points, producing an
  // absurdly wide region. The region must be clamped to 320 x-units from the
  // start, like the Kotlin reference.
  const curve = Array.from({ length: 1000 }, (_, i) => {
    if (i <= 100) return 0;                     // baseline
    if (i <= 200) return 2 * (i - 100);         // rise, slope 2 -> 200
    if (i <= 600) return 200 - 0.5 * (i - 200); // long slow fall -> 0
    return 0;                                   // flat tail
  });
  const regions = findSlopeRegions(curve);
  expect(regions.length).toBeGreaterThanOrEqual(1);
  expect(regions[0].startIndex).toBeLessThanOrEqual(105);
  expect(regions[0].endIndex - regions[0].startIndex).toBeLessThanOrEqual(320);
  expect(regions[0].endIndex).toBeGreaterThan(380);
});

test('rejects a wide noise-level bump whose peak rises less than 5 above the start', () => {
  // A bump only 4.8 high but 120+ wide passes every distance check, yet it is
  // reader noise, not a wave. The Kotlin reference rejects regions whose peak
  // is less than MIN_PEAK_START_HEIGHT_DIFF (5) above the start point.
  const curve = Array.from({ length: 1000 }, (_, i) => {
    if (i < 300) return 0;                            // baseline
    if (i <= 320) return 0.24 * (i - 300);            // rise -> 4.8
    if (i < 420) return i % 2 === 0 ? 4.8 : 4.7;      // noisy low plateau
    if (i <= 440) return 4.8 - 0.24 * (i - 420);      // fall -> 0
    return 0;                                         // flat tail
  });
  expect(findSlopeRegions(curve)).toEqual([]);
});

test('end is recomputed from the true peak when a taller peak follows the first local max', () => {
  // isPeak fires on a small local max (100 @150); the true peak (210 @200)
  // comes after a small dip. The min peak-to-end distance must be measured
  // from the TRUE peak, so the end walk is recomputed from it (Kotlin
  // stabilization loop) — otherwise the end stops within 50 of the peak.
  const curve = Array.from({ length: 1000 }, (_, i) => {
    if (i <= 100) return 0;                     // baseline
    if (i <= 150) return 2 * (i - 100);         // rise -> 100 (local max)
    if (i <= 160) return 100 - (i - 150);       // small dip -> 90
    if (i <= 200) return 90 + 3 * (i - 160);    // taller rise -> 210 (true peak)
    if (i <= 240) return 210 - 5 * (i - 200);   // fall -> 10
    return 10;                                  // elevated flat tail
  });
  const regions = findSlopeRegions(curve);
  expect(regions.length).toBeGreaterThanOrEqual(1);
  expect(regions[0].peakIndex).toBe(200);
  expect(regions[0].endIndex - regions[0].peakIndex).toBeGreaterThanOrEqual(50);
});

test('detects a long-distance wave whose gentle rise is below the flat threshold', () => {
  // A broad dome: 300-point rise and fall at slope 0.15, under the 0.2 flat
  // threshold. The left walk stops at the apex immediately, so without a
  // lead-in scan the start sticks to the peak and the region is rejected as
  // noise. The start must slide down to the foot of the rise (~200).
  const curve = Array.from({ length: 1000 }, (_, i) => {
    if (i <= 200) return 0;                      // baseline
    if (i <= 500) return 0.15 * (i - 200);       // gentle rise -> 45
    if (i <= 800) return 45 - 0.15 * (i - 500);  // gentle fall -> 0
    return 0;                                    // flat tail
  });
  const regions = findSlopeRegions(curve);
  expect(regions.length).toBeGreaterThanOrEqual(1);
  expect(regions[0].peakIndex).toBe(500);
  expect(regions[0].startIndex).toBeGreaterThanOrEqual(190);
  expect(regions[0].startIndex).toBeLessThanOrEqual(210);
});

test('end is not cut short by a single noise spike in the declining tail', () => {
  // Same declining-tail shape as the flat-tail test, but with a one-point noise
  // spike at 330. The tail scan must not break on that single adjacent up-tick;
  // the end still belongs at the tail minimum (400), not at the spike (~329).
  const curve = Array.from({ length: 1000 }, (_, i) => {
    if (i <= 100) return 0;                       // baseline
    if (i <= 200) return 2 * (i - 100);           // rise -> 200
    if (i <= 280) return 200 - 2 * (i - 200);     // fall -> 40
    if (i <= 400) {
      const y = 40 - 0.1 * (i - 280);             // gentle tail decline -> 28
      return i === 330 ? y + 3 : y;               // single-point noise spike
    }
    return 28;                                    // flat
  });
  const regions = findSlopeRegions(curve);
  expect(regions.length).toBeGreaterThanOrEqual(1);
  expect(regions[0].peakIndex).toBe(200);
  expect(regions[0].endIndex).toBe(400);
});

test('start is not advanced by a single noise point dipping below the chord', () => {
  // Long gentle wave with ONE noisy sample at 130 dipping just below the
  // start->end chord. A single-point dip is noise, not a lead-in below the
  // chord — the start must stay at the foot (100), not jump to the dip (130).
  const curve = Array.from({ length: 1000 }, (_, i) => {
    if (i <= 100) return 0;                       // baseline
    if (i <= 400) {
      const y = 0.15 * (i - 100);                 // gentle rise -> 45
      return i === 130 ? y - 1.5 : y;             // single-point noise dip
    }
    if (i <= 700) return 45 - 0.15 * (i - 400);   // gentle fall -> 0
    return 0;                                     // flat tail
  });
  const regions = findSlopeRegions(curve);
  expect(regions.length).toBeGreaterThanOrEqual(1);
  expect(regions[0].peakIndex).toBe(400);
  expect(regions[0].startIndex).toBeLessThanOrEqual(105);
});

test('buildCurveMarkers emits start, peak, and end points at the curve values', () => {
  const curve = Array.from({ length: 1000 }, (_, i) => {
    if (i <= 200) return i;       // rise -> peak 200 @200
    if (i <= 400) return 400 - i; // fall
    return 0;
  });
  const markers = buildCurveMarkers(curve);
  const peak = markers.find((m) => m.type === 'peak');
  expect(peak).toBeTruthy();
  expect(peak.x).toBe(200);
  expect(peak.y).toBe(200);
  const start = markers.find((m) => m.type === 'start');
  const end = markers.find((m) => m.type === 'end');
  expect(start).toBeTruthy();
  expect(end).toBeTruthy();
  // marker y must equal the curve value at that index
  expect(start.y).toBe(curve[start.x]);
  expect(end.y).toBe(curve[end.x]);
});
