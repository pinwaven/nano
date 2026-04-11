'use strict';

/**
 * Inflammaging Estimation Engine (Stochastic Version v2)
 * -----------------------------------------------------------
 * A computational model to estimate key biomarkers of aging
 * based on chronological age.
 *
 * UPDATE v2: Replaced HbA1c with Glycated Albumin (GA) to
 * provide a more sensitive, shorter-term metabolic metric.
 *
 * Sources:
 * - Inflammatory Aging Quantitative Assessment System
 * - GDF-15 Reference Ranges & Variances (PubMed/PMC)
 * - Cytokine Levels & Standard Deviations (PMC)
 * - Glycated Albumin Reference Intervals (Zhou et al.)
 * -----------------------------------------------------------
 */
class BiomarkerEstimator {
  constructor(chronologicalAge, testResults = {}, biometrics = {}, tags = []) {
    this.age = Math.max(20, Math.min(100, chronologicalAge));
    this.estimates = {};
    this.testResults = { ...testResults };
    this.biometrics = { ...biometrics };
    this.tags = [...tags];
    this.referenceData = {};
  }

  applyBiologicalNoise(value, variancePercent) {
    const noiseFactor = 1 + (Math.random() * (variancePercent * 2) - variancePercent);
    return value * noiseFactor;
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

  estimateGDF15() {
    if (this.testResults.GDF15 !== undefined) {
      this.estimates.gdf15 = this.testResults.GDF15;
      this.referenceData.gdf15 = 'pg/mL';
      return;
    }
    let val = 400 + 10 * Math.exp(0.055 * this.age);
    if (this.biometrics.Weight !== undefined && this.biometrics.Height !== undefined) {
      const bmi = this.biometrics.Weight / Math.pow(this.biometrics.Height / 100, 2);
      if (bmi >= 25) val *= 1.1;
      if (bmi >= 30) val *= 1.2;
    }
    val = this.applyBiologicalNoise(val, 0.25);
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
    val = this.applyBiologicalNoise(val, 0.30);
    val = Math.max(0.1, val);
    this.estimates.il6 = parseFloat(val.toFixed(2));
    this.referenceData.il6 = 'pg/mL';
  }

  estimateHsCRP() {
    if (this.testResults.hsCRP !== undefined) {
      this.estimates.hscrp = this.testResults.hsCRP;
      this.referenceData.hscrp = 'mg/L';
      return;
    }
    const slope = (3.0 - 1.2) / 60;
    let val = -0.1 + slope * this.age;
    if (this.age > 65) val *= 1.1;
    val = this.applyBiologicalNoise(val, 0.20);
    this.estimates.hscrp = parseFloat(val.toFixed(2));
    this.referenceData.hscrp = 'mg/L';
  }

  estimateGA() {
    if (this.testResults.GA !== undefined) {
      this.estimates.ga = this.testResults.GA;
      this.referenceData.ga = '%';
      return;
    }
    let val = 11.9 + this.age * 0.02;
    if (this.biometrics.Weight !== undefined && this.biometrics.Height !== undefined) {
      const bmi = this.biometrics.Weight / Math.pow(this.biometrics.Height / 100, 2);
      if (bmi >= 25) val += 0.5;
      if (bmi >= 30) val += 1.0;
    }
    if (this.tags.includes('糖尿病前期')) val += 1.0;
    else if (this.tags.includes('糖尿病')) val += 2.0;
    val = this.applyBiologicalNoise(val, 0.05);
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
    val = this.applyBiologicalNoise(val, 0.15);
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
    };
  }

  generateContext() {
    if (this.age < 40) return 'Phase: Reproductive Prime. Maintenance systems active.';
    if (this.age < 60) return 'Phase: Maintenance Abandonment. Onset of Inflammaging.';
    return 'Phase: Clinical Senescence. High risk of SASP-driven pathology.';
  }
}

module.exports = { BiomarkerEstimator };
