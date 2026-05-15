'use strict';

const { TAG_REGISTRY, normalizeTag } = require('./tagRegistry');

/**
 * Inflammaging Estimation Engine (Stochastic Version v3)
 * -----------------------------------------------------------
 * v2: Replaced HbA1c with Glycated Albumin (GA).
 * v3: Tag-driven adjustments via tagRegistry; seeded reproducible noise.
 *
 * Sources:
 * - Inflammatory Aging Quantitative Assessment System
 * - GDF-15 Reference Ranges & Variances (PubMed/PMC)
 * - Cytokine Levels & Standard Deviations (PMC)
 * - Glycated Albumin Reference Intervals (Zhou et al.)
 * -----------------------------------------------------------
 */
class BiomarkerEstimator {
  constructor(chronologicalAge, testResults = {}, biometrics = {}, tags = [], options = {}) {
    this.age = Math.max(20, Math.min(100, chronologicalAge));
    this.estimates = {};
    this.testResults = { ...testResults };
    this.biometrics = { ...biometrics };
    this.tags = tags.map(normalizeTag).filter(t => TAG_REGISTRY[t]);
    this.referenceData = {};
    this.rand = options.seed ? mulberry32(hashSeed(options.seed)) : Math.random;
  }

  applyTagAdjustments(biomarkerKey, value) {
    for (const tag of this.tags) {
      const rule = TAG_REGISTRY[tag][biomarkerKey];
      if (!rule) continue;
      const [op, n] = rule;
      value = op === '*' ? value * n : value + n;
    }
    return value;
  }

  applyBiologicalNoise(value, variancePercent) {
    // Box-Muller normal noise; variancePercent ≈ 3σ (99.7% within ±variance).
    let u = 0, v = 0;
    while (u === 0) u = this.rand();
    while (v === 0) v = this.rand();
    const num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    const stdDev = variancePercent / 3;
    const noiseMultiplier = 1 + (num * stdDev);
    const cappedMultiplier = Math.max(1 - variancePercent, Math.min(1 + variancePercent, noiseMultiplier));
    return value * cappedMultiplier;
  }

  runEstimation() {
    this.estimateGDF15();
    this.estimateIL6();
    this.estimateHsCRP();
    this.estimateGA();
    this.estimateCystatinC();
    this.estimateCD38();
    return this.estimates;
  }

  getBMI() {
    if (this.biometrics.BMI !== undefined) return this.biometrics.BMI;
    if (this.biometrics.Weight !== undefined && this.biometrics.Height !== undefined) {
      return this.biometrics.Weight / Math.pow(this.biometrics.Height / 100, 2);
    }
    return 22; // Default "healthy" BMI
  }

  estimateGDF15() {
    if (this.testResults.GDF15 !== undefined) {
      this.estimates.gdf15 = this.testResults.GDF15;
      this.referenceData.gdf15 = 'pg/mL';
      return;
    }
    let val = 400 + 10 * Math.exp(0.055 * this.age);
    const bmi = this.getBMI();
    
    if (bmi > 22) {
      val *= (1 + (bmi - 22) * 0.05);
    }

    if (this.age > 55) {
      val *= (1 + 0.03 * (this.age - 55));
    }
    val = this.applyTagAdjustments('GDF15', val);
    val = this.applyBiologicalNoise(val, 0.35);
    this.estimates.gdf15 = Math.round(val);
    this.referenceData.gdf15 = 'pg/mL';
  }

  estimateIL6() {
    if (this.testResults.IL6 !== undefined) {
      this.estimates.il6 = this.testResults.IL6;
      this.referenceData.il6 = 'pg/mL';
      return;
    }
    let val = 0.5;
    if (this.age > 30) val += Math.pow(this.age - 30, 2.0) / 450;
    
    const bmi = this.getBMI();
    if (bmi > 23) {
      val += 0.06 * Math.pow(bmi - 23, 1.5);
    }

    val = this.applyTagAdjustments('IL6', val);
    val = this.applyBiologicalNoise(val, 0.40);
    val = Math.max(0.1, val);
    this.estimates.il6 = parseFloat(val.toFixed(2));
    this.referenceData.il6 = 'pg/mL';
  }

  estimateHsCRP() {
    const valProvided = this.testResults.hsCRP;
    if (valProvided !== undefined && valProvided >= 0.2 && valProvided <= 2.5) {
      this.estimates.hscrp = valProvided;
      this.referenceData.hscrp = 'mg/L';
      return;
    }
    const slope = (3.0 - 1.2) / 60;
    let val = -0.3 + slope * this.age;
    if (this.age > 65) val *= 1.35;

    const bmi = this.getBMI();
    // BMI is a strong, non-linear driver of CRP
    if (bmi > 22) {
      val += 0.03 * Math.pow(bmi - 22, 1.7);
    }

    val = this.applyTagAdjustments('hsCRP', val);
    val = this.applyBiologicalNoise(val, 0.30);
    val = Math.max(0.1, val);
    this.estimates.hscrp = parseFloat(val.toFixed(2));
    this.referenceData.hscrp = 'mg/L';
  }

  estimateGA() {
    if (this.testResults.GA !== undefined) {
      this.estimates.ga = this.testResults.GA;
      this.referenceData.ga = '%';
      return;
    }
    let val = 13.0 + this.age * 0.02;
    const bmi = this.getBMI();
    if (bmi > 22) {
      val += 0.015 * Math.pow(bmi - 22, 1.6);
    }

    val = this.applyTagAdjustments('GA', val);
    val = this.applyBiologicalNoise(val, 0.25);
    this.estimates.ga = parseFloat(val.toFixed(1));
    this.referenceData.ga = '%';
  }

  estimateCystatinC() {
    if (this.testResults.CystatinC !== undefined) {
      this.estimates.cystatinC = this.testResults.CystatinC;
      this.referenceData.cystatinC = 'mg/L';
      return;
    }
    let val = 0.70;
    if (this.age > 70) {
      val += (this.age - 70) * 0.05 + 30 * 0.006;
    } else if (this.age > 50) {
      val += (this.age - 50) * 0.012 + 30 * 0.004;
    } else {
      val += (this.age - 20) * 0.002;
    }
    val = this.applyTagAdjustments('CystatinC', val);
    val = this.applyBiologicalNoise(val, 0.03);
    this.estimates.cystatinC = parseFloat(val.toFixed(2));
    this.referenceData.cystatinC = 'mg/L';
  }

  estimateCD38() {
    if (this.testResults.CD38 !== undefined) {
      this.estimates.cd38 = this.testResults.CD38;
      this.referenceData.cd38 = 'xBaseline';
      return;
    }
    let val = 1.0 + (this.age - 20) * (2.0 / 60);
    val = this.applyTagAdjustments('CD38', val);
    val = this.applyBiologicalNoise(val, 0.25);
    this.estimates.cd38 = parseFloat(val.toFixed(1));
    this.referenceData.cd38 = 'xBaseline';
  }

  generateReport() {
    this.runEstimation();
    return {
      ChronoAge: this.age,
      BiomarkerValues: {
        GDF15: this.estimates.gdf15,
        IL6: this.estimates.il6,
        hsCRP: this.estimates.hscrp,
        GA: this.estimates.ga,
        CystatinC: this.estimates.cystatinC,
        CD38: this.estimates.cd38,
      },
      BiomarkerProfile: {
        GDF15: `${this.estimates.gdf15} ${this.referenceData.gdf15}`,
        IL6: `${this.estimates.il6} ${this.referenceData.il6}`,
        hsCRP: `${this.estimates.hscrp} ${this.referenceData.hscrp}`,
        GA: `${this.estimates.ga} ${this.referenceData.ga}`,
        CystatinC: `${this.estimates.cystatinC} ${this.referenceData.cystatinC}`,
        CD38: `${this.estimates.cd38} ${this.referenceData.cd38}`,
      },
      ClinicalContext: this.generateContext(),
      AppliedTags: [...this.tags],
    };
  }

  generateContext() {
    if (this.age < 40) return 'Phase: Reproductive Prime. Maintenance systems active.';
    if (this.age < 60) return 'Phase: Maintenance Abandonment. Onset of Inflammaging.';
    return 'Phase: Clinical Senescence. High risk of SASP-driven pathology.';
  }
}

function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a) {
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

module.exports = { BiomarkerEstimator };
