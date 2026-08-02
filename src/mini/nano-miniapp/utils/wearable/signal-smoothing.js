// Pure statistics helpers for chart-display outlier smoothing. No wx.* calls,
// no mutation of inputs. Used by user-health.js's _buildReadingLineCharts to
// keep a single bad ring reading (ring off-wrist, poor contact, BLE/firmware
// glitch) from distorting the whole HRV/SpO2/Stress trend chart. This never
// touches stored/synced sensor data — display-layer only, see CLAUDE.md §17's
// actual-vs-validated convention applied to this domain.

function medianOf(arr) {
  if (!arr.length) return null
  const sorted = arr.slice().sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function madOf(arr, median) {
  if (!arr.length) return 0
  const m = median != null ? median : medianOf(arr)
  return medianOf(arr.map(v => Math.abs(v - m)))
}

/**
 * Flags values that are very likely sensor errors: out of physiologically
 * plausible bounds, a literal 0 sentinel, or a local MAD-based statistical
 * outlier relative to a centered window of neighbors.
 * @param {number[]} vals
 * @param {{min:number,max:number,k:number,window:number,epsilon:number}} cfg
 * @returns {boolean[]} parallel to vals
 */
function flagOutliers(vals, cfg) {
  const { min, max, k, window, epsilon } = cfg
  const half = Math.floor(window / 2)
  const flags = vals.map(v => v == null || v === 0 || v < min || v > max)

  for (let i = 0; i < vals.length; i++) {
    if (flags[i]) continue
    const lo = Math.max(0, i - half)
    const hi = Math.min(vals.length, i + half + 1)
    const neighborhood = []
    for (let j = lo; j < hi; j++) {
      if (j !== i && !flags[j]) neighborhood.push(vals[j])
    }
    if (neighborhood.length < 3) continue // not enough local context to judge
    const median = medianOf(neighborhood)
    const mad = Math.max(madOf(neighborhood, median), epsilon)
    if (Math.abs(vals[i] - median) > k * mad) flags[i] = true
  }
  return flags
}

/**
 * Replaces flagged values with a linear interpolation between the nearest
 * valid neighbors (flat-extrapolated at series edges). Returns null (not a
 * value) for a fully-degenerate all-flagged series.
 * @param {number[]} vals
 * @param {boolean[]} flags
 * @returns {{value:number, estimated:boolean}[]}
 */
function interpolateFlagged(vals, flags) {
  const validIdx = []
  for (let i = 0; i < vals.length; i++) if (!flags[i]) validIdx.push(i)

  return vals.map((v, i) => {
    if (!flags[i]) return { value: v, estimated: false }
    if (!validIdx.length) return { value: v, estimated: true }

    let before = null, after = null
    for (const j of validIdx) {
      if (j <= i) before = j
      if (j >= i && after == null) after = j
    }
    if (before == null) return { value: vals[after], estimated: true }
    if (after == null) return { value: vals[before], estimated: true }
    if (before === after) return { value: vals[before], estimated: true }

    const t = (i - before) / (after - before)
    return { value: vals[before] + (vals[after] - vals[before]) * t, estimated: true }
  })
}

module.exports = { medianOf, madOf, flagOutliers, interpolateFlagged }
