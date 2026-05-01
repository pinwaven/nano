'use strict';

const { normalizeTag, TAG_REGISTRY } = require('./tagRegistry');

const COMPLIANCE_HIGH = 0.7;
const COMPLIANCE_LOW = 0.3;
const WEIGHT_DELTA_KG = 2;
const TRAJECTORY_MIN_POINTS = 3;
const TRAJECTORY_SLOPE_THRESHOLD = -0.05; // mg/L per day, hsCRP

// Pure function. Inputs are already-fetched plain data (no I/O here).
// Returns a deduped array of valid registry tags.
function deriveTags({ history = [], weightHistory = [], compliance = {}, selfReported = [] } = {}) {
  const tags = new Set();

  for (const tag of selfReported) {
    const normalized = normalizeTag(tag);
    if (TAG_REGISTRY[normalized]) tags.add(normalized);
  }

  addComplianceTags(tags, compliance);
  addWeightTrendTags(tags, weightHistory);
  addTrajectoryTags(tags, history);

  return Array.from(tags);
}

function addComplianceTags(tags, compliance) {
  const map = {
    ResilienceAge:    ['inflammation_load_low', 'inflammation_load_high'],
    MetabolicAge:     ['metabolic_load_low',    'metabolic_load_high'],
    CellularAge:      ['cellular_stress_low',   'cellular_stress_high'],
    MicroVascularAge: ['microvascular_load_low','microvascular_load_high'],
  };
  for (const [pathway, [lowTag, highTag]] of Object.entries(map)) {
    const v = compliance[pathway];
    if (typeof v !== 'number' || Number.isNaN(v)) continue;
    if (v >= COMPLIANCE_HIGH) tags.add(lowTag);
    else if (v <= COMPLIANCE_LOW) tags.add(highTag);
  }
}

function addWeightTrendTags(tags, weightHistory) {
  if (!Array.isArray(weightHistory) || weightHistory.length < 2) return;
  // Sort defensively oldest-first; callers may pass either order.
  const sorted = [...weightHistory]
    .filter(w => typeof w.weight === 'number' && w.tested_at)
    .sort((a, b) => new Date(a.tested_at) - new Date(b.tested_at));
  if (sorted.length < 2) return;
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const baseline = sorted.find(w => new Date(w.tested_at).getTime() <= cutoff) || sorted[0];
  const latest = sorted[sorted.length - 1];
  const delta = latest.weight - baseline.weight;
  if (delta <= -WEIGHT_DELTA_KG) tags.add('weight_loss_sustained');
  else if (delta >= WEIGHT_DELTA_KG) tags.add('weight_gain_recent');
}

function addTrajectoryTags(tags, history) {
  if (!Array.isArray(history) || history.length < TRAJECTORY_MIN_POINTS) return;
  const points = history
    .filter(h => h && h.tested_at && h.biomarkers && typeof h.biomarkers.hsCRP === 'number')
    .map(h => ({ t: new Date(h.tested_at).getTime(), y: h.biomarkers.hsCRP }))
    .sort((a, b) => a.t - b.t);
  if (points.length < TRAJECTORY_MIN_POINTS) return;
  const slope = linearSlopePerDay(points);
  if (slope <= TRAJECTORY_SLOPE_THRESHOLD) tags.add('inflammation_load_low');
  else if (slope >= -TRAJECTORY_SLOPE_THRESHOLD) tags.add('inflammation_load_high');
}

function linearSlopePerDay(points) {
  const t0 = points[0].t;
  const xs = points.map(p => (p.t - t0) / (24 * 60 * 60 * 1000));
  const ys = points.map(p => p.y);
  const n = points.length;
  const meanX = xs.reduce((s, x) => s + x, 0) / n;
  const meanY = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

module.exports = { deriveTags };
