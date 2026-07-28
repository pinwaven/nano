/**
 * Pre-computed normal/elevated/high classification for the 6 Kino biomarkers.
 * Thresholds mirror CLAUDE.md §11's documented reference ranges verbatim
 * (hsCRP, IL6, GDF15, GA, CystatinC). CD38 has no documented elevated/high
 * split there (only "~1.0 baseline; each fold above degrades NAD+ faster") —
 * elevated=1.3x/high=1.7x is this file's own judgment call, not a canonical
 * source; revisit if the product/clinical team specifies exact cutoffs.
 *
 * Exists so prompt templates can state a biomarker's status directly instead
 * of asking the LLM to compare a raw value against a threshold itself — that
 * comparison is a real LLM failure mode (see 2026-07-25 incident: a live
 * Viva response called GDF-15=650 "升高" against a stated <750=normal range).
 */
'use strict';

const THRESHOLDS = {
    hsCRP:     { elevated: 1,    high: 3,    unit: 'mg/L' },
    IL6:       { elevated: 3,    high: 6,    unit: 'pg/mL' },
    GDF15:     { elevated: 750,  high: 1500, unit: 'pg/mL' },
    GA:        { elevated: 15,   high: 20,   unit: '%' },
    CystatinC: { elevated: 0.9,  high: 1.2,  unit: 'mg/L' },
    CD38:      { elevated: 1.3,  high: 1.7,  unit: 'x baseline' },
};

const LABELS_ZH = { normal: '正常', elevated: '偏高', high: '高' };
const LABELS_EN = { normal: 'normal', elevated: 'elevated', high: 'high' };

function classifyBiomarker(key, value) {
    const t = THRESHOLDS[key];
    if (!t || value == null || Number.isNaN(Number(value))) return null;
    const v = Number(value);
    if (v >= t.high) return 'high';
    if (v >= t.elevated) return 'elevated';
    return 'normal';
}

function classifyBiomarkers(biomarkers = {}) {
    const out = {};
    for (const key of Object.keys(THRESHOLDS)) {
        if (biomarkers[key] != null) out[key] = classifyBiomarker(key, biomarkers[key]);
    }
    return out;
}

module.exports = { THRESHOLDS, LABELS_ZH, LABELS_EN, classifyBiomarker, classifyBiomarkers };
