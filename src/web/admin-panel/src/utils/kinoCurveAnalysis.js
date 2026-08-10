// Ported from poct-device-app TestModePointChartData.kt.
// Public API keeps x = array index for raw curve arrays.
const DEFAULT_FLAT_SLOPE_THRESHOLD = 0.2;
const DEFAULT_MIN_REGION_X_DISTANCE = 75;
const DEFAULT_MIN_PEAK_TROUGH_Y_DIFF = 50;

const PeakDetect = {
  NEAR_WINDOW_X: 20,
  WIDE_WINDOW_X: 50,
  MIN_RISE_DROP_Y: 20,
};

const BoundarySearch = {
  MAX_REGION_X: 500,
  SLOPE_SAMPLE_X: 5,
  STEEP_SCAN_X: 50,
  ADAPTIVE_FLAT_RATIO: 0.1,
  STEEP_DROP_RATIO: 0.3,
  NEW_WAVE_TROUGH_DEPTH_RATIO: 0.4,
  STEEP_RISE_MIN_SLOPE: 1,
  SMALL_WAVE_NOISE_FLOOR_Y: 10,
  NET_RISE_SCAN_X: 20,
  NET_RISE_MIN_Y: 5,
  NET_DROP_SCAN_X: 30,
  NET_DROP_MIN_Y: 20,
  NET_DROP_CONTINUE_Y: 200,
  LOWER_GROUND_MIN_Y_RATIO: 3,
};

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

function toPoints(curve) {
  return curve.map((point, index) => {
    if (point && typeof point === 'object' && Number.isFinite(point.x) && Number.isFinite(point.y)) {
      return { x: point.x, y: point.y };
    }
    return { x: index, y: point };
  });
}

function slope(startPoint, endPoint) {
  const dx = endPoint.x - startPoint.x;
  if (dx <= 0) return 0;
  return (endPoint.y - startPoint.y) / dx;
}

function findHighestPoint(points, startIndex, endIndex) {
  let maxIndex = startIndex;
  for (let index = startIndex; index <= endIndex; index++) {
    if (points[index].y > points[maxIndex].y) {
      maxIndex = index;
    }
  }
  return maxIndex;
}

function isPeak(points, index, minPeakTroughYDiff) {
  if (index === 0 || index >= points.length - 1) return false;

  const threshold = Math.min(PeakDetect.MIN_RISE_DROP_Y, minPeakTroughYDiff);
  const { x, y } = points[index];

  let leftMax = points[index - 1].y;
  let leftWideMin = points[index - 1].y;
  let left = index - 1;
  while (left >= 0 && x - points[left].x <= PeakDetect.WIDE_WINDOW_X) {
    if (x - points[left].x <= PeakDetect.NEAR_WINDOW_X) {
      leftMax = Math.max(leftMax, points[left].y);
    }
    leftWideMin = Math.min(leftWideMin, points[left].y);
    left--;
  }

  let rightMin = points[index + 1].y;
  let right = index + 1;
  while (right < points.length && points[right].x - x <= PeakDetect.WIDE_WINDOW_X) {
    rightMin = Math.min(rightMin, points[right].y);
    right++;
  }

  return y >= leftMax &&
    y - leftWideMin > threshold &&
    y - rightMin > threshold;
}

function isWideFlatTopOnset(points, index, minPeakTroughYDiff) {
  if (index === 0 || index >= points.length - 1) return false;
  const y = points[index].y;
  const threshold = Math.min(PeakDetect.MIN_RISE_DROP_Y, minPeakTroughYDiff);

  if (y - points[index - 1].y <= threshold) return false;

  let runEnd = index;
  while (runEnd < points.length - 1 && Math.abs(points[runEnd + 1].y - y) <= threshold) {
    runEnd++;
  }
  if (points[runEnd].x - points[index].x <= 2 * PeakDetect.WIDE_WINDOW_X) return false;

  let afterPlateau = runEnd;
  while (afterPlateau < points.length - 1 && y - points[afterPlateau].y <= threshold) {
    afterPlateau++;
  }
  if (y - points[afterPlateau].y <= threshold) return false;

  let leftMin = points[index - 1].y;
  let left = index - 1;
  while (left >= 0 && points[index].x - points[left].x <= PeakDetect.WIDE_WINDOW_X) {
    leftMin = Math.min(leftMin, points[left].y);
    left--;
  }
  return y - leftMin > threshold;
}

function sampledSlopeLeftOf(points, index) {
  let back = index - 1;
  while (back > 0 && points[index].x - points[back - 1].x <= BoundarySearch.SLOPE_SAMPLE_X) {
    back--;
  }
  return slope(points[back], points[index]);
}

function sampledSlopeRightOf(points, index) {
  let forward = index + 1;
  while (
    forward < points.length - 1 &&
    points[forward + 1].x - points[index].x <= BoundarySearch.SLOPE_SAMPLE_X
  ) {
    forward++;
  }
  return slope(points[index], points[forward]);
}

function hasSteepRiseBehind(points, fromIndex, steepSlopeThreshold) {
  const limitX = points[fromIndex].x - BoundarySearch.STEEP_SCAN_X;
  let i = fromIndex;
  let consecutiveSteepCount = 0;
  while (i > 0 && points[i].x > limitX) {
    if (slope(points[i - 1], points[i]) > steepSlopeThreshold) {
      consecutiveSteepCount++;
      if (consecutiveSteepCount >= 2) return true;
    } else {
      consecutiveSteepCount = 0;
    }
    i--;
  }
  return false;
}

function hasNetRiseBehind(points, fromIndex) {
  const limitX = points[fromIndex].x - BoundarySearch.NET_RISE_SCAN_X;
  let back = fromIndex;
  while (back > 0 && points[back - 1].x >= limitX) {
    back--;
  }
  return points[fromIndex].y - points[back].y > BoundarySearch.NET_RISE_MIN_Y;
}

function hasLowerGroundBehind(points, fromIndex, minPeakTroughYDiff) {
  const limitX = points[fromIndex].x - BoundarySearch.STEEP_SCAN_X;
  let minBehind = points[fromIndex].y;
  let i = fromIndex - 1;

  while (i >= 0 && points[i].x >= limitX) {
    minBehind = Math.min(minBehind, points[i].y);
    i--;
  }

  return (
    points[fromIndex].y - minBehind >
    BoundarySearch.LOWER_GROUND_MIN_Y_RATIO * minPeakTroughYDiff
  );
}

function findLeftFlatPoint(points, peakIndex, flatSlopeThreshold, minPeakTroughYDiff) {
  let index = peakIndex;
  let steepestRise = 0;
  while (index > 0) {
    const slopeValue = sampledSlopeLeftOf(points, index);
    if (slopeValue > steepestRise) {
      steepestRise = slopeValue;
    }
    const effectiveFlat = Math.max(flatSlopeThreshold, steepestRise * BoundarySearch.ADAPTIVE_FLAT_RATIO);
    const steepThreshold = Math.max(
      BoundarySearch.STEEP_RISE_MIN_SLOPE,
      steepestRise * BoundarySearch.ADAPTIVE_FLAT_RATIO
    );
    const stillRising = hasSteepRiseBehind(points, index, steepThreshold) && hasNetRiseBehind(points, index);
    if (
      slopeValue <= effectiveFlat &&
      !stillRising &&
      points[peakIndex].y - points[index].y > minPeakTroughYDiff &&
      !hasLowerGroundBehind(points, index, minPeakTroughYDiff)
    ) {
      break;
    }
    index--;
  }
  return index;
}

function skipSmallWavesOnLeft(points, startIndex, minPeakTroughYDiff) {
  let start = startIndex;
  while (start > 0) {
    let peakIndex = start;
    while (peakIndex > 0 && points[peakIndex - 1].y >= points[peakIndex].y) {
      peakIndex--;
    }
    if (peakIndex === start) break;

    let troughIndex = peakIndex;
    while (troughIndex > 0 && points[troughIndex - 1].y <= points[troughIndex].y) {
      troughIndex--;
    }

    const amplitude = points[peakIndex].y - Math.min(points[start].y, points[troughIndex].y);
    if (amplitude >= minPeakTroughYDiff) break;
    if (amplitude < Math.min(BoundarySearch.SMALL_WAVE_NOISE_FLOOR_Y, minPeakTroughYDiff / 2)) break;
    start = troughIndex;
  }
  return start;
}

function hasSteepDropAhead(points, fromIndex, steepSlopeThreshold) {
  const limitX = points[fromIndex].x + BoundarySearch.STEEP_SCAN_X;
  let i = fromIndex;
  let consecutiveSteepCount = 0;
  while (i < points.length - 1 && points[i].x < limitX) {
    if (slope(points[i], points[i + 1]) < -steepSlopeThreshold) {
      consecutiveSteepCount++;
      if (consecutiveSteepCount >= 2) return true;
    } else {
      consecutiveSteepCount = 0;
    }
    i++;
  }
  return false;
}

function netDropAheadAmount(points, fromIndex) {
  const limitX = points[fromIndex].x + BoundarySearch.NET_DROP_SCAN_X;
  let ahead = fromIndex;
  while (ahead < points.length - 1 && points[ahead + 1].x <= limitX) {
    ahead++;
  }
  return points[fromIndex].y - points[ahead].y;
}

function hasNetDropAhead(points, fromIndex) {
  return netDropAheadAmount(points, fromIndex) > BoundarySearch.NET_DROP_MIN_Y;
}

function findRightFlatPoint(points, peakIndex, startIndex, flatSlopeThreshold, minPeakTroughYDiff) {
  const peakY = points[peakIndex].y;
  const amplitude = peakY - points[startIndex].y;
  const dropThreshold = Math.min(peakY * 0.05, minPeakTroughYDiff);

  let declineStart = -1;
  let index = peakIndex + 1;
  while (index < points.length - 1) {
    const drop = peakY - points[index].y;
    const slopeValue = slope(points[index - 1], points[index]);
    if (drop > dropThreshold && slopeValue < -flatSlopeThreshold) {
      declineStart = index;
      break;
    }
    index++;
  }

  if (declineStart < 0) {
    return points.length - 1;
  }

  let tail = declineStart;
  let stableCount = 0;
  let minIndex = declineStart;
  let steepestDrop = 0;

  while (tail < points.length - 2) {
    if (points[tail].y < points[minIndex].y) {
      minIndex = tail;
    }
    if (points[tail].y - points[minIndex].y > minPeakTroughYDiff) {
      const troughDepth = peakY - points[minIndex].y;
      if (amplitude <= 0 || troughDepth >= amplitude * BoundarySearch.NEW_WAVE_TROUGH_DEPTH_RATIO) {
        return minIndex;
      }
    }

    const nextSlope = sampledSlopeRightOf(points, tail);
    if (nextSlope < steepestDrop) {
      steepestDrop = nextSlope;
    }
    const effectiveFlat = Math.max(flatSlopeThreshold, Math.abs(steepestDrop) * BoundarySearch.ADAPTIVE_FLAT_RATIO);

    if (Math.abs(nextSlope) < effectiveFlat) {
      stableCount++;
      if (stableCount >= 10) {
        const steepThreshold = Math.max(
          flatSlopeThreshold,
          Math.abs(steepestDrop) * BoundarySearch.STEEP_DROP_RATIO
        );
        const stillDescending =
          (hasSteepDropAhead(points, tail, steepThreshold) && hasNetDropAhead(points, tail)) ||
          netDropAheadAmount(points, tail) > BoundarySearch.NET_DROP_CONTINUE_Y;
        if (stillDescending) {
          stableCount = 0;
        } else {
          return tail;
        }
      }
    } else {
      stableCount = 0;
    }
    tail++;
  }

  return tail;
}

function findFirstViolation(points, startIndex, endIndex) {
  const startPoint = points[startIndex];
  const endPoint = points[endIndex];
  const dx = endPoint.x - startPoint.x;
  if (dx <= 0) return -1;

  for (let i = startIndex + 1; i < endIndex; i++) {
    const lineY = interpolateLineY(startPoint, endPoint, points[i].x, dx);
    if (points[i].y < lineY - 1e-5) return i;
  }
  return -1;
}

function adjustBoundsToKeepAboveLine(points, startIndex, endIndex, peakIndex) {
  let start = startIndex;
  let end = endIndex;
  let peak = peakIndex;
  const visitedStarts = new Set();
  const visitedEnds = new Set();

  for (let k = 0; k < points.length; k++) {
    const violation = findFirstViolation(points, start, end);
    if (violation === -1) return { start, end, peak };

    if (visitedStarts.has(start) && visitedEnds.has(end)) {
      break;
    }
    visitedStarts.add(start);
    visitedEnds.add(end);

    if (violation <= peak) {
      if (violation >= peak) return { start, end, peak };
      start = violation;
    } else {
      if (violation <= start) return { start, end, peak };
      end = violation;
    }
    peak = findHighestPoint(points, start, end);
  }
  return { start, end, peak };
}

function findRiseStartAtBoundary(points, boundaryIndex) {
  let i = boundaryIndex;
  while (i > 0 && slope(points[i - 1], points[i]) > 0) {
    i--;
  }
  return i;
}

export function findSlopeRegions(
  curve,
  flatSlopeThreshold = DEFAULT_FLAT_SLOPE_THRESHOLD,
  minRegionXDistance = DEFAULT_MIN_REGION_X_DISTANCE,
  minPeakTroughYDiff = DEFAULT_MIN_PEAK_TROUGH_Y_DIFF
) {
  if (!curve || curve.length < 3) return [];

  const points = toPoints(curve);
  const regions = [];
  let index = 1;

  while (index < points.length - 1) {
    if (!isPeak(points, index, minPeakTroughYDiff) && !isWideFlatTopOnset(points, index, minPeakTroughYDiff)) {
      index++;
      continue;
    }

    const currentPeakFallback = index;
    const riseStartIndex = findLeftFlatPoint(points, index, flatSlopeThreshold, minPeakTroughYDiff);
    let startIndex = skipSmallWavesOnLeft(points, riseStartIndex, minPeakTroughYDiff);
    let endIndex = findRightFlatPoint(points, index, startIndex, flatSlopeThreshold, minPeakTroughYDiff);

    if (points[endIndex].x - points[startIndex].x < minRegionXDistance) {
      index = Math.max(index + 1, currentPeakFallback + 1);
      continue;
    }

    let peakIndex = findHighestPoint(points, startIndex, endIndex);
    let iterations = 0;
    while (iterations < 10) {
      const recalculatedEndIndex = findRightFlatPoint(points, peakIndex, startIndex, flatSlopeThreshold, minPeakTroughYDiff);
      const recalculatedPeakIndex = findHighestPoint(points, startIndex, recalculatedEndIndex);

      if (recalculatedEndIndex === endIndex && recalculatedPeakIndex === peakIndex) {
        break;
      }
      endIndex = recalculatedEndIndex;
      peakIndex = recalculatedPeakIndex;
      iterations++;
    }

    const reLeftStart = skipSmallWavesOnLeft(
      points,
      findLeftFlatPoint(points, peakIndex, flatSlopeThreshold, minPeakTroughYDiff),
      minPeakTroughYDiff
    );
    startIndex = Math.min(startIndex, reLeftStart);

    const maxEndX = points[startIndex].x + BoundarySearch.MAX_REGION_X;
    if (points[endIndex].x > maxEndX) {
      let lastValid = null;
      for (let i = startIndex; i <= endIndex; i++) {
        if (points[i].x <= maxEndX) {
          lastValid = i;
        }
      }
      if (lastValid !== null) {
        endIndex = findRiseStartAtBoundary(points, lastValid);
        peakIndex = findHighestPoint(points, startIndex, endIndex);
      }
    }

    const adjusted = adjustBoundsToKeepAboveLine(points, startIndex, endIndex, peakIndex);
    startIndex = adjusted.start;
    endIndex = adjusted.end;
    peakIndex = adjusted.peak;

    if (currentPeakFallback < startIndex || currentPeakFallback > endIndex) {
      index = currentPeakFallback + 1;
      continue;
    }

    if (regions.length > 0 && startIndex < regions[regions.length - 1].endIndex) {
      index = currentPeakFallback + 1;
      continue;
    }

    if (
      points[endIndex].x - points[startIndex].x < minRegionXDistance ||
      points[peakIndex].y - points[startIndex].y < minPeakTroughYDiff
    ) {
      index = Math.max(index + 1, endIndex + 1);
      continue;
    }

    regions.push({
      startIndex,
      endIndex,
      peakIndex,
      area: calculateAreaBetweenCurveAndLine(points, startIndex, endIndex),
    });
    index = Math.max(index + 1, endIndex + 1);
  }

  return regions;
}
