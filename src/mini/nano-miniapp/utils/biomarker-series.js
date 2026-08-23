// Micro-trend ("sparkline") data for the chat tab's biomarker metric tiles (pages/main/).
//
// The model writes a :::metric block carrying a label and the LATEST value. The trend drawn
// behind that value is built HERE, client-side, from the user's own biomarker history — never
// from anything the model wrote, and never round-tripped through a prompt.
//
// That split is the whole point. A series is exactly the kind of number an LLM will invent
// fluently: verifyBiomarkerGrounding only ever compares a reply against the latest snapshot, so
// a fabricated "your hsCRP has fallen every month since March" has nothing to fail against. By
// sourcing the series from GET /api/biomarkers on this side of the wire, the sparkline is
// structurally incapable of showing a history that didn't happen. The model's only contribution
// to the tile is the label — and a label that doesn't resolve just yields no sparkline.
//
// Rendering is bars-as-views rather than a <canvas> polyline, deliberately: a canvas in a long
// scroll-view needs a per-instance SelectorQuery to fetch its node, manual dpr scaling, and an
// imperative redraw on every theme toggle and history append. At roughly 110rpx x 36rpx a bar
// micro-chart also simply reads better than a 8-point line. See main.wxss's .spark block.

'use strict'

// Canonical keys as stored in biomarkers.data.validated (BiomarkerEstimator's own spelling).
const KEYS = ['hsCRP', 'IL6', 'GDF15', 'GA', 'CystatinC', 'CD38']

// Aliases are matched against a normalised label (see _norm). Entries of 4+ characters also
// match as a SUBSTRING, so "糖化白蛋白 (GA)" and "超敏C反应蛋白 (hsCRP)" both resolve; shorter
// ones ('ga', 'il6') must match exactly, because a 2-3 character substring scan would happily
// pull 'ga' out of "Omega-3".
//
// Bare "CRP" is deliberately absent: systemHealthReport.js treats CRP and hsCRP as two separate
// markers, so guessing hsCRP from an unqualified "CRP" could attach the wrong history. Showing
// no sparkline is the correct failure here.
const ALIASES = {
  hsCRP:     ['hscrp', 'hscrp', '超敏c反应蛋白', '超敏crp', 'c反应蛋白'],
  IL6:       ['il6', 'interleukin6', '白介素6', '白细胞介素6'],
  GDF15:     ['gdf15', 'growthdifferentiationfactor15', '生长分化因子15'],
  GA:        ['ga', 'glycatedalbumin', '糖化白蛋白'],
  CystatinC: ['cystatinc', '胱抑素c', '胱抑素'],
  CD38:      ['cd38'],
}

// Every one of the six Kino markers is "lower is better" — CLAUDE.md §11's reference ranges are
// upper bounds without exception, so a falling series is an improvement for all of them. Kept as
// an explicit per-key map rather than a global assumption so that adding a marker where higher
// is better (an HDL, a VitaminD) can't silently inherit the inverted colour.
const BETTER_LOW = { hsCRP: true, IL6: true, GDF15: true, GA: true, CystatinC: true, CD38: true }

// Only the Kino chip. lab_import rows also carry data.validated, but they come off a different
// assay entirely — splicing them into one trend line would draw a step change that reflects the
// instrument, not the user. Widen this map if the two are ever calibrated against each other.
const SERIES_TEST_TYPES = { kino_chip: true }

const SPARK_BARS = 8        // window: the last N measurements
const SPARK_MIN_POINTS = 2  // one point is a value, not a trend
const FLAT_REL_SPREAD = 0.02 // below this, render level bars instead of amplifying noise
const FLAT_DELTA_PCT = 2     // and report no direction
const BAR_MIN_PCT = 16       // the minimum bar still reads as a bar, not a gap

function _norm(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '')
}

// Display label (model-authored, free-form) -> canonical key, or null when nothing matches.
function resolveBiomarkerKey(label) {
  const n = _norm(label)
  if (!n) return null
  for (const key of KEYS) {
    for (const a of ALIASES[key]) {
      if (n === a) return key
      if (a.length >= 4 && n.indexOf(a) !== -1) return key
    }
  }
  return null
}

// GET /api/biomarkers records -> { <key>: [{ v, t }, ...] }, oldest first.
// Reads data.validated ONLY, per CLAUDE.md §17: data.actual is the raw pre-validation reading and
// can sit outside the physiologically plausible range the stored BioAge was computed against.
function buildSeriesIndex(records) {
  const idx = {}
  const rows = (records || [])
    .filter((r) => r && SERIES_TEST_TYPES[r.test_type] && r.data && r.data.validated)
    .slice()
    // The endpoint already sorts ascending; re-sorting keeps this function order-independent so
    // a test (or a future caller that merges pages) can't get a silently reversed trend.
    .sort((a, b) => new Date(a.tested_at) - new Date(b.tested_at))
  for (const r of rows) {
    const v = r.data.validated
    const t = +new Date(r.tested_at) || 0
    for (const key of Object.keys(v)) {
      const n = Number(v[key])
      if (v[key] === null || v[key] === '' || !isFinite(n)) continue
      if (!idx[key]) idx[key] = []
      idx[key].push({ v: n, t })
    }
  }
  return idx
}

// Series -> the flat shape WXML renders. Returns null when there is nothing honest to draw.
function buildSpark(points, betterLow) {
  if (!points || points.length < SPARK_MIN_POINTS) return null
  const win = points.slice(-SPARK_BARS)
  const vals = win.map((p) => p.v)
  const min = Math.min.apply(null, vals)
  const max = Math.max.apply(null, vals)
  const range = max - min
  // A near-constant series min-max normalised to full height turns assay noise into a dramatic
  // staircase. Below the threshold every bar sits level instead — visually honest about "this
  // hasn't really moved".
  const level = !(range > 0) || (Math.abs(max) > 0 && range / Math.abs(max) < FLAT_REL_SPREAD)
  const mid = Math.round((BAR_MIN_PCT + 100) / 2)
  const bars = vals.map((v, i) => ({
    h: level ? mid : Math.round(BAR_MIN_PCT + ((v - min) / range) * (100 - BAR_MIN_PCT)),
    last: i === vals.length - 1,
  }))

  const first = vals[0]
  const last = vals[vals.length - 1]
  const pct = first === 0 ? null : Math.round(((last - first) / Math.abs(first)) * 100)
  const dir = (pct === null || Math.abs(pct) < FLAT_DELTA_PCT) ? 'flat' : (pct > 0 ? 'up' : 'down')
  // tone drives colour: an improving trend is green whichever direction that happens to be.
  const tone = dir === 'flat' ? 'flat' : (((dir === 'down') === !!betterLow) ? 'good' : 'bad')

  return {
    bars,
    n: win.length,
    dir,
    tone,
    delta: dir === 'flat' ? '' : (pct > 0 ? '+' : '') + pct + '%',
    arrow: dir === 'up' ? '↑' : (dir === 'down' ? '↓' : ''),
  }
}

// Fold a just-finished scan into an existing index without a refetch. POST /api/biomarkers
// returns estimationReport.BiomarkerValues, which is verbatim what it also writes to
// data.validated — so this is the same data the next buildSeriesIndex would read back.
function appendReading(seriesIndex, validated, testedAt) {
  if (!seriesIndex || !validated) return seriesIndex
  const t = +new Date(testedAt || Date.now()) || Date.now()
  for (const key of Object.keys(validated)) {
    const n = Number(validated[key])
    if (validated[key] === null || validated[key] === '' || !isFinite(n)) continue
    if (!seriesIndex[key]) seriesIndex[key] = []
    seriesIndex[key].push({ v: n, t })
  }
  return seriesIndex
}

// Convenience for the one real caller: label -> spark, or null.
function sparkForLabel(seriesIndex, label) {
  if (!seriesIndex) return null
  const key = resolveBiomarkerKey(label)
  if (!key) return null
  return buildSpark(seriesIndex[key], BETTER_LOW[key])
}

module.exports = {
  KEYS,
  BETTER_LOW,
  SPARK_BARS,
  resolveBiomarkerKey,
  buildSeriesIndex,
  buildSpark,
  sparkForLabel,
  appendReading,
}
