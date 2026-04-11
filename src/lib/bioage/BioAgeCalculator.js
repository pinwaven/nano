'use strict';

/**
 * BioAgeCalculator v2.0
 *
 * A production-grade implementation of the "Inflammatory Aging Quantified Assessment System".
 * Based on the "Accumulation of Deficits" model and "Inflammaging" theory.
 *
 * Reference: '炎性衰老量化评估体系算法.pdf' and integrated GA research.
 *
 * Calculates Biological Age (BioAge) by transforming six key biomarkers
 * into four functional dimensions:
 *   1. ILI  — Inflammatory Load Index
 *   2. MRI  — Metabolic Resilience Index
 *   3. MFI  — Mitochondrial Function Index
 *   4. MVII — Microvascular Integrity Index
 */
class BioAgeCalculator {
  constructor() {
    // Dimension 1: ILI — Inflammatory Load Index
    this.CRP_K = 0.64;        // Decay constant for hs-CRP
    this.CRP_OPTIMAL = 0.5;   // Max-score threshold (mg/L)
    this.IL6_K = 0.36;        // Decay constant for IL-6
    this.IL6_OPTIMAL = 1.5;   // Max-score threshold (pg/mL)

    // Dimension 2: MRI — Metabolic Resilience Index
    this.GA_ALPHA = 0.90;     // Sigmoid slope (for GA range)
    this.GA_BETA = 14.5;      // Sigmoid inflection point (pre-diabetes transition %)
    this.CD38_SLOPE = 4.5;    // Linear penalty slope per fold change

    // Dimension 3: MFI — Mitochondrial Function Index
    this.GDF_M = 1050;        // Half-maximal constant (pg/mL)
    this.GDF_N = 3;           // Hill coefficient (steepness)

    // Dimension 4: MVII — Microvascular Integrity Index
    this.CYS_K = 2.0;         // Decay constant for Cystatin C
    this.CYS_OPTIMAL = 0.68;  // Max-score threshold (mg/L)

    // BioAge Mapping — Deficit Accumulation Model
    this.MAX_HEALTH_SCORE = 40; // 4 dimensions × 10 points
    this.BASELINE_AGE = 25;     // Theoretical "zero deficit" age
    this.BASELINE_MFI = 0.05;   // Expected mFI at age 25 (5% system noise)
    this.AGING_RATE = 0.005;    // Average annual deficit accumulation
    this.TANH_SCALE = 11;       // Compression factor for age deviation
  }

  /** Exponential decay: S = 10 × e^(−k × (val − threshold)), clamped to [0, 10] */
  _exponentialScore(value, threshold, k) {
    if (value <= threshold) return 10.0;
    return Math.max(0, 10.0 * Math.exp(-k * (value - threshold)));
  }

  /** Inverse sigmoid: S = 10 / (1 + e^(alpha × (val − beta))) */
  _sigmoidScore(value, alpha, beta) {
    return 10.0 / (1.0 + Math.exp(alpha * (value - beta)));
  }

  /** Inverse Hill equation: S = 10 / (1 + (val / M)^n) */
  _hillScore(value, M, n) {
    return 10.0 / (1.0 + Math.pow(value / M, n));
  }

  /** Dimension 1: Inflammatory Load Index — hsCRP + IL6 */
  _calcILI(hsCRP, IL6) {
    const s_crp = this._exponentialScore(hsCRP, this.CRP_OPTIMAL, this.CRP_K);
    const s_il6 = this._exponentialScore(IL6, this.IL6_OPTIMAL, this.IL6_K);
    return {
      score: 0.5 * s_crp + 0.5 * s_il6,
      components: { s_crp, s_il6 },
    };
  }

  /** Dimension 2: Metabolic Resilience Index — GA + CD38, with ILI coupling */
  _calcMRI(GA, CD38, ILI_Score) {
    const s_ga = this._sigmoidScore(GA, this.GA_ALPHA, this.GA_BETA);
    const s_cd38 = Math.max(0, Math.min(10, 10.0 - this.CD38_SLOPE * (CD38 - 1.0)));
    const base = 0.5 * s_ga + 0.5 * s_cd38;
    // Coupling: high inflammation (ILI < 4) accelerates metabolic decay → 10% penalty
    const penalty = ILI_Score < 4.0 ? 0.9 : 1.0;
    return {
      score: base * penalty,
      components: { s_ga, s_cd38 },
      penaltyApplied: penalty < 1.0,
    };
  }

  /** Dimension 3: Mitochondrial Function Index — GDF15 */
  _calcMFI(GDF15) {
    const s_gdf = this._hillScore(GDF15, this.GDF_M, this.GDF_N);
    return { score: s_gdf, components: { s_gdf } };
  }

  /** Dimension 4: Microvascular Integrity Index — CystatinC */
  _calcMVII(CystatinC) {
    const s_cys = this._exponentialScore(CystatinC, this.CYS_OPTIMAL, this.CYS_K);
    return { score: s_cys, components: { s_cys } };
  }

  /**
   * Calculate Biological Age.
   * @param {number} chronologicalAge
   * @param {{ hsCRP, IL6, GA, CD38, GDF15, CystatinC }} biomarkers
   * @returns {object} Full BioAge profile
   */
  calculateBioAge(chronologicalAge, biomarkers) {
    const ili  = this._calcILI(biomarkers.hsCRP, biomarkers.IL6);
    const mri  = this._calcMRI(biomarkers.GA, biomarkers.CD38, ili.score);
    const mfi  = this._calcMFI(biomarkers.GDF15);
    const mvii = this._calcMVII(biomarkers.CystatinC);

    const totalHealthScore = ili.score + mri.score + mfi.score + mvii.score;

    // Molecular Frailty Index: fraction of deficits (0 = perfect, 1 = total failure)
    const mFI_Actual = (this.MAX_HEALTH_SCORE - totalHealthScore) / this.MAX_HEALTH_SCORE;

    // Population baseline mFI for this chronological age
    const effectiveAge = Math.max(this.BASELINE_AGE, chronologicalAge);
    const mFI_Expected = this.BASELINE_MFI + this.AGING_RATE * (effectiveAge - this.BASELINE_AGE);

    // Convert deficit gap into years, then compress with tanh for biological plausibility
    const rawYearDeviation = (mFI_Actual - mFI_Expected) / this.AGING_RATE;
    const compressedDeviation = this.TANH_SCALE * Math.tanh(rawYearDeviation / this.TANH_SCALE) - 4;

    return {
      ChronoAge: chronologicalAge,
      BioAge: parseFloat((chronologicalAge + compressedDeviation).toFixed(1)),
      AgeDifference: parseFloat(compressedDeviation.toFixed(1)),
      mFI: {
        actual: parseFloat(mFI_Actual.toFixed(3)),
        expected: parseFloat(mFI_Expected.toFixed(3)),
      },
      Scores: {
        total: parseFloat(totalHealthScore.toFixed(2)),
        ILI:  parseFloat(ili.score.toFixed(2)),
        MRI:  parseFloat(mri.score.toFixed(2)),
        MFI:  parseFloat(mfi.score.toFixed(2)),
        MVII: parseFloat(mvii.score.toFixed(2)),
      },
      Details: {
        ILI_components: ili.components,
        MRI_components: mri.components,
        couplingPenalty: mri.penaltyApplied,
      },
    };
  }
}

module.exports = { BioAgeCalculator };
