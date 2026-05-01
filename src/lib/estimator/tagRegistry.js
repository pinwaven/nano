'use strict';

// Each entry maps a tag to one or more biomarker adjustments.
// Operator '*' multiplies, '+' adds. Adjustments apply BEFORE noise.
const TAG_REGISTRY = Object.freeze({
  inflammation_load_high:  { hsCRP: ['*', 1.20], IL6:    ['*', 1.20] },
  inflammation_load_low:   { hsCRP: ['*', 0.90], IL6:    ['*', 0.90] },
  cellular_stress_high:    { GDF15: ['*', 1.15], CD38:   ['*', 1.10] },
  cellular_stress_low:     { GDF15: ['*', 0.92], CD38:   ['*', 0.95] },
  metabolic_load_high:     { GA:    ['+', 0.8] },
  metabolic_load_low:      { GA:    ['+', -0.4] },
  microvascular_load_high: { CystatinC: ['*', 1.10] },
  microvascular_load_low:  { CystatinC: ['*', 0.95] },
  weight_loss_sustained:   { GA: ['+', -0.3], hsCRP: ['*', 0.95] },
  weight_gain_recent:      { GA: ['+', 0.4],  hsCRP: ['*', 1.05] },
  diabetes_prediabetic:    { GA: ['+', 1.0] },
  diabetes_diagnosed:      { GA: ['+', 2.0] },
});

const TAG_ALIASES = Object.freeze({
  '糖尿病前期': 'diabetes_prediabetic',
  '糖尿病': 'diabetes_diagnosed',
});

const VALID_BIOMARKER_KEYS = new Set(['GDF15', 'IL6', 'hsCRP', 'GA', 'CystatinC', 'CD38']);

function normalizeTag(tag) {
  return TAG_ALIASES[tag] || tag;
}

module.exports = { TAG_REGISTRY, TAG_ALIASES, VALID_BIOMARKER_KEYS, normalizeTag };
