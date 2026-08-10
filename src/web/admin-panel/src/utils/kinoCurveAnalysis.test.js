import { test, expect } from 'vitest';
import { findSlopeRegions, calculateAreaBetweenCurveAndLine, buildCurveMarkers } from './kinoCurveAnalysis.js';

// Restructured to encode the faithful port of TestModePointChartData.kt:
//   - isPeak uses a wide (50 x-unit) window; a wave needs > 20 left-rise and > 20 right-drop
//   - a region is rejected unless peak.y - start.y >= MIN_PEAK_TROUGH_Y_DIFF (50)
//   - a chord violation is a single point below the line (not a run)
//   - the region span is clamped to MAX_REGION_X (400) from the start
// The curve is a dense ADC sampling: x = array index, 1 sample per x-unit.

test('returns empty for empty curve', () => {
  expect(findSlopeRegions([])).toEqual([]);
});

test('area is 0 for points on a flat line', () => {
  const pts = [0, 1, 2, 3].map((x) => ({ x, y: 5 }));
  expect(calculateAreaBetweenCurveAndLine(pts, 0, 3)).toBeCloseTo(0);
});

test('area equals triangle for a simple peak above baseline', () => {
  const pts = [{ x: 0, y: 0 }, { x: 1, y: 10 }, { x: 2, y: 0 }];
  expect(calculateAreaBetweenCurveAndLine(pts, 0, 2)).toBeCloseTo(10);
});

test('detects a single broad peak in a 1000-point bell curve', () => {
  const curve = Array.from({ length: 1000 }, (_, i) => {
    if (i <= 200) return i;          // rise, slope 1 -> apex 200 @200
    if (i <= 400) return 400 - i;    // fall, slope -1
    return 0;                        // flat tail
  });
  const regions = findSlopeRegions(curve);
  expect(regions.length).toBeGreaterThanOrEqual(1);
  expect(regions[0].peakIndex).toBe(200);
  expect(regions[0].area).toBeGreaterThan(0);
  expect(regions[0]).toHaveProperty('startIndex');
  expect(regions[0]).toHaveProperty('endIndex');
});

test('detects two separate peaks in order and both have positive area', () => {
  // Peak 1: apex 150 @150, base 0..300 (taller/wider). Valley 300..600.
  // Peak 2: apex 90 @690, base 600..780 (shorter/narrower).
  const curve = Array.from({ length: 1000 }, (_, i) => {
    if (i <= 150) return i;
    if (i <= 300) return 300 - i;
    if (i <= 600) return 0;
    if (i <= 690) return i - 600;
    if (i <= 780) return 780 - i;
    return 0;
  });
  const regions = findSlopeRegions(curve);
  expect(regions.length).toBe(2);
  expect(regions[0].peakIndex).toBeLessThan(regions[1].peakIndex);
  expect(regions[0].area).toBeGreaterThan(0);
  expect(regions[1].area).toBeGreaterThan(0);
  expect(regions[0].area / regions[1].area).toBeGreaterThan(1);
});

test('rejects a wide noise-level bump whose peak rises less than 5 above the start', () => {
  // Faithful port raises the reject floor to MIN_PEAK_TROUGH_Y_DIFF (50): a bump
  // 40 high and 200+ wide fires isPeak (rise/drop > 20) but is rejected because
  // peak - start = 40 < 50.
  const curve = Array.from({ length: 1000 }, (_, i) => {
    if (i < 300) return 0;                     // baseline
    if (i <= 400) return 0.4 * (i - 300);      // rise -> 40
    if (i <= 500) return 40;                   // wide flat top
    if (i <= 600) return 40 - 0.4 * (i - 500); // fall -> 0
    return 0;                                  // flat tail
  });
  expect(findSlopeRegions(curve)).toEqual([]);
});

test('region is clamped to the max x-distance on a long slow fall', () => {
  // Faithful port clamps the span to MAX_REGION_X (500) from the start.
  const curve = Array.from({ length: 1000 }, (_, i) => {
    if (i <= 100) return 0;                     // baseline
    if (i <= 200) return 2 * (i - 100);         // rise, slope 2 -> 200
    if (i <= 700) return 200 - 0.5 * (i - 200); // long slow fall
    return 0;                                   // flat tail
  });
  const regions = findSlopeRegions(curve);
  expect(regions.length).toBeGreaterThanOrEqual(1);
  expect(regions[0].peakIndex).toBe(200);
  expect(regions[0].startIndex).toBeLessThanOrEqual(105);
  expect(regions[0].endIndex - regions[0].startIndex).toBeLessThanOrEqual(500);
  expect(regions[0].endIndex - regions[0].startIndex).toBeGreaterThan(480);
});

test('end stops on a mid-fall shoulder when no net drop lies ahead in the Kotlin window', () => {
  // The fall pauses on a plateau (y=100) before a second steep drop to baseline.
  // Kotlin now requires both consecutive steep points and a net drop inside the
  // forward window, so this wide shoulder is treated as the tail.
  const curve = Array.from({ length: 1000 }, (_, i) => {
    if (i <= 100) return 0;                       // baseline
    if (i <= 200) return 2 * (i - 100);           // rise, slope 2 -> 200
    if (i <= 250) return 200 - 2 * (i - 200);     // fall, slope -2 -> 100
    if (i <= 290) return 100;                     // shoulder plateau
    if (i <= 340) return 100 - 2 * (i - 290);     // second drop -> 0
    return 0;                                     // flat tail
  });
  const regions = findSlopeRegions(curve);
  expect(regions.length).toBeGreaterThanOrEqual(1);
  expect(regions[0].peakIndex).toBe(200);
  expect(regions[0].endIndex).toBeLessThan(290);
});

test('end shrinks to the violation point when the fall dips below the start-end chord', () => {
  // Elevated baseline (100), tall peak, concave fall: fast drop to 40 then a
  // slow slide to 0 that sits below the start(100)->tail(0) chord. The port
  // treats the first single point below the chord as the violation, so end
  // shrinks back to where the fast drop crosses the chord (~205).
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
  expect(regions[0].endIndex).toBeGreaterThanOrEqual(200);
  expect(regions[0].endIndex).toBeLessThanOrEqual(215);
});

test('end is recomputed from the true peak when a taller peak follows the first local max', () => {
  // A small local max (100 @150) precedes the true peak (210 @200). The end
  // walk is recomputed from the true peak (stabilization loop).
  const curve = Array.from({ length: 1000 }, (_, i) => {
    if (i <= 100) return 0;                     // baseline
    if (i <= 150) return 2 * (i - 100);         // rise -> 100 (local max)
    if (i <= 160) return 100 - (i - 150);       // small dip -> 90
    if (i <= 200) return 90 + 3 * (i - 160);    // taller rise -> 210 (true peak)
    if (i <= 260) return 210 - 3 * (i - 200);   // fall -> 30
    return 30;                                  // elevated flat tail
  });
  const regions = findSlopeRegions(curve);
  expect(regions.length).toBeGreaterThanOrEqual(1);
  expect(regions[0].peakIndex).toBe(200);
});

test('detects a long-distance wave whose gentle rise is below the flat threshold', () => {
  // A broad dome rising 0.5/x over 300 points (amplitude 150). isPeak fires via
  // the wide window; findLeftFlatPoint / skipSmallWavesOnLeft slide the start to
  // the foot of the rise.
  const curve = Array.from({ length: 1000 }, (_, i) => {
    if (i <= 200) return 0;                      // baseline
    if (i <= 500) return 0.5 * (i - 200);        // gentle rise -> 150
    if (i <= 800) return 150 - 0.5 * (i - 500);  // gentle fall -> 0
    return 0;                                    // flat tail
  });
  const regions = findSlopeRegions(curve);
  expect(regions.length).toBeGreaterThanOrEqual(1);
  expect(regions[0].peakIndex).toBe(500);
  expect(regions[0].startIndex).toBeLessThanOrEqual(260);
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
  expect(start.y).toBe(curve[start.x]);
  expect(end.y).toBe(curve[end.x]);
});
