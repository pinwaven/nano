// Ported from TestModePointChartData.kt. x = array index, y = curve value.
const FLAT_SLOPE_THRESHOLD = 0.2;
const MIN_REGION_X_DISTANCE = 75;
const MIN_PEAK_TO_END_X_DISTANCE = 50;
// Slope is averaged over this x-window when searching outward from the peak,
// so small plateaus/noise on the rise or fall don't stop the walk early.
const SLOPE_WINDOW_X_DISTANCE = 20;
// A flat point mid-fall is only the end if no steep drop resumes within this
// lookahead — otherwise it's a shoulder and the walk continues through it.
const STEEP_DROP_LOOKAHEAD_X_DISTANCE = 100;
const MAX_REGION_X_DISTANCE = 320;

function interpolateLineY(start, end, x, dx) {
  return start.y + (end.y - start.y) * ((x - start.x) / dx);
}

function calculateSegmentArea(leftDiff, rightDiff, width) {
  if (leftDiff === 0 || rightDiff === 0 || leftDiff * rightDiff > 0) {
    return (Math.abs(leftDiff) + Math.abs(rightDiff)) * width / 2;
  }
  const leftAbs = Math.abs(leftDiff);
  const rightAbs = Math.abs(rightDiff);
  const total = leftAbs + rightAbs;
  if (total === 0) return 0;
  const leftWidth = width * leftAbs / total;
  const rightWidth = width - leftWidth;
  return leftAbs * leftWidth / 2 + rightAbs * rightWidth / 2;
}

export function calculateAreaBetweenCurveAndLine(pts, startIdx, endIdx) {
  if (endIdx <= startIdx) return 0;
  const startPoint = pts[startIdx];
  const endPoint = pts[endIdx];
  const dx = endPoint.x - startPoint.x;
  if (dx === 0) return 0;

  let area = 0;
  for (let i = startIdx; i < endIdx; i++) {
    const leftPoint = pts[i];
    const rightPoint = pts[i + 1];
    const width = rightPoint.x - leftPoint.x;
    if (width <= 0) continue;
    const leftDiff = leftPoint.y - interpolateLineY(startPoint, endPoint, leftPoint.x, dx);
    const rightDiff = rightPoint.y - interpolateLineY(startPoint, endPoint, rightPoint.x, dx);
    area += calculateSegmentArea(leftDiff, rightDiff, width);
  }
  return area;
}

// Flatten every region into start/peak/end marker points, each carrying the
// curve value (y) at its index (x) so a chart can plot them directly.
export function buildCurveMarkers(curve) {
  if (!curve || !curve.length) return [];
  const markers = [];
  findSlopeRegions(curve).forEach((r) => {
    markers.push({ type: 'start', x: r.startIndex, y: curve[r.startIndex] });
    markers.push({ type: 'peak', x: r.peakIndex, y: curve[r.peakIndex] });
    markers.push({ type: 'end', x: r.endIndex, y: curve[r.endIndex] });
  });
  return markers;
}

const slope = (a, b) => (b.x > a.x ? (b.y - a.y) / (b.x - a.x) : 0);

// Walk right from the peak: descend past it, then stop where it goes flat.
// Slope is measured over a window so noise mid-fall doesn't stop the walk.
function findRightFlatPoint(pts, peakIndex) {
  let endIndex = peakIndex;
  let hasDownwardSlope = false;
  while (endIndex < pts.length - 1) {
    const currentSlope = slope(
      pts[endIndex],
      pts[Math.min(pts.length - 1, endIndex + SLOPE_WINDOW_X_DISTANCE)]
    );
    if (currentSlope < -FLAT_SLOPE_THRESHOLD) {
      hasDownwardSlope = true;
      endIndex++;
      continue;
    }
    if (hasDownwardSlope && pts[endIndex].x - pts[peakIndex].x >= MIN_PEAK_TO_END_X_DISTANCE) {
      // Shoulder check: 2+ consecutive steep down-slopes within the lookahead
      // mean the fall resumes, so this flat point is not the end.
      const limitX = pts[endIndex].x + STEEP_DROP_LOOKAHEAD_X_DISTANCE;
      let steepAhead = false;
      let consecutive = 0;
      for (let i = endIndex; i < pts.length - 1 && pts[i].x < limitX; i++) {
        if (slope(pts[i], pts[i + 1]) < -FLAT_SLOPE_THRESHOLD) {
          consecutive++;
          if (consecutive >= 2) {
            steepAhead = true;
            break;
          }
        } else {
          consecutive = 0;
        }
      }
      if (!steepAhead) break;
    }
    endIndex++;
  }

  // The tail can keep declining gently below the flat threshold; end at its
  // lowest point, not the first flat point, so the chord isn't tilted up.
  // Break on windowed slope, not adjacent, so one noise up-tick doesn't stop
  // the scan before the true tail minimum.
  for (let i = endIndex; i < pts.length - 1; i++) {
    if (
      slope(pts[i], pts[Math.min(pts.length - 1, i + SLOPE_WINDOW_X_DISTANCE)]) > FLAT_SLOPE_THRESHOLD
    ) {
      break;
    }
    if (pts[i].y < pts[endIndex].y) endIndex = i;
  }
  return endIndex;
}

export function findSlopeRegions(curve) {
  if (!curve || curve.length < 3) return [];
  const pts = curve.map((y, x) => ({ x, y }));

  const regions = [];
  let index = 1;
  while (index < pts.length - 1) {
    if (!(pts[index].y > pts[index - 1].y && pts[index].y >= pts[index + 1].y)) {
      index++;
      continue;
    }

    // isPeak can fire early on a rounding plateau; advance to the true apex so the
    // region below spans the whole peak instead of truncating just past it.
    while (index < pts.length - 1 && pts[index + 1].y >= pts[index].y) index++;

    // Search outward from the peak. Slope is measured over a window so a small
    // plateau or noise mid-rise doesn't stop the walk before the true foot.
    let startIndex = index;
    while (
      startIndex > 0 &&
      slope(pts[Math.max(0, startIndex - SLOPE_WINDOW_X_DISTANCE)], pts[startIndex]) > FLAT_SLOPE_THRESHOLD
    ) {
      startIndex--;
    }

    // The lead-in can keep rising gently below the flat threshold (long-distance
    // wave); slide the start left to its lowest point, mirroring the flat-tail
    // scan on the right. Stop at a steep drop — that's a previous wave's fall.
    for (let i = startIndex; i > 0; i--) {
      if (slope(pts[i - 1], pts[i]) < -FLAT_SLOPE_THRESHOLD) break;
      if (pts[i - 1].y < pts[startIndex].y) startIndex = i - 1;
    }

    let endIndex = findRightFlatPoint(pts, index);

    if (pts[endIndex].x - pts[startIndex].x < MIN_REGION_X_DISTANCE) {
      index++;
      continue;
    }

    let peakIndex = startIndex;
    for (let k = startIndex; k <= endIndex; k++) {
      if (pts[k].y > pts[peakIndex].y) peakIndex = k;
    }

    // The true peak can sit after the isPeak trigger point; recompute the end
    // walk from it (min peak-to-end distance is measured from the true peak)
    // until end and peak stabilize.
    for (let guard = 0; guard < pts.length; guard++) {
      const recalculatedEnd = findRightFlatPoint(pts, peakIndex);
      let recalculatedPeak = startIndex;
      for (let k = startIndex; k <= recalculatedEnd; k++) {
        if (pts[k].y > pts[recalculatedPeak].y) recalculatedPeak = k;
      }
      if (recalculatedEnd === endIndex && recalculatedPeak === peakIndex) break;
      endIndex = recalculatedEnd;
      peakIndex = recalculatedPeak;
    }

    // Clamp the region to MAX_REGION_X_DISTANCE from the start; if the clamped
    // boundary lands mid-rise, back up to the start of that rise.
    const maxEndX = pts[startIndex].x + MAX_REGION_X_DISTANCE;
    if (pts[endIndex].x > maxEndX) {
      while (endIndex > startIndex && pts[endIndex].x > maxEndX) endIndex--;
      while (endIndex > 0 && slope(pts[endIndex - 1], pts[endIndex]) > 0) endIndex--;
      peakIndex = startIndex;
      for (let k = startIndex; k <= endIndex; k++) {
        if (pts[k].y > pts[peakIndex].y) peakIndex = k;
      }
    }

    // Keep the curve above the start->end chord. A violation before the peak is
    // baseline lead-in, so advance start to it; a violation after the peak is
    // tail that fell below the chord, so shrink end to it.
    for (let guard = 0; guard < pts.length; guard++) {
      const s = pts[startIndex];
      const e = pts[endIndex];
      const dx = e.x - s.x;
      if (dx <= 0) break;
      // A violation only counts when the curve stays below the chord for 5
      // consecutive points — an isolated dip is reader noise, not a boundary.
      let violation = -1;
      let run = 0;
      for (let i = startIndex + 1; i < endIndex; i++) {
        if (pts[i].y < s.y + (e.y - s.y) * ((pts[i].x - s.x) / dx)) {
          run++;
          if (run >= 5) {
            violation = i - run + 1;
            break;
          }
        } else {
          run = 0;
        }
      }
      if (violation === -1 || violation === peakIndex) break;
      if (violation < peakIndex) {
        startIndex = violation;
      } else {
        if (violation <= startIndex) break;
        endIndex = violation;
      }
      peakIndex = startIndex;
      for (let k = startIndex; k <= endIndex; k++) {
        if (pts[k].y > pts[peakIndex].y) peakIndex = k;
      }
    }

    // A region whose peak rises less than 5 above its start is reader noise.
    if (pts[peakIndex].y - pts[startIndex].y < 5) {
      index++;
      continue;
    }

    regions.push({
      startIndex,
      endIndex,
      peakIndex,
      area: calculateAreaBetweenCurveAndLine(pts, startIndex, endIndex),
    });
    index = endIndex + 1;
  }
  return regions;
}
