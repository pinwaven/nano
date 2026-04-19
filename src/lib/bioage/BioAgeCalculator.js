'use strict';

/**
 * BioAgeCalculator v3.0
 *
 * Four named aging dimensions, each producing a sub-age and contributing
 * equally to the combined Biological Age (BioAge).
 *
 * Dimensions:
 *   1. Resilience    — hsCRP, IL-6      (stress-buffering / inflammatory resilience)
 *   2. Cellular      — GDF-15, CD38     (raw cellular vitality)
 *   3. Metabolic     — GA               (fuel-burning efficiency)
 *   4. MicroVascular — Cystatin C       (nutrient & O₂ delivery)
 */
class BioAgeCalculator {
  constructor() {
    // Resilience (hsCRP, IL-6)
    this.CRP_K       = 0.64;   // Decay constant for hs-CRP
    this.CRP_OPTIMAL = 0.5;    // Max-score threshold (mg/L)
    this.IL6_K       = 0.36;   // Decay constant for IL-6
    this.IL6_OPTIMAL = 1.5;    // Max-score threshold (pg/mL)

    // Metabolic (GA) — inflammation coupling preserved
    this.GA_ALPHA = 0.90;      // Sigmoid slope
    this.GA_BETA  = 14.5;      // Sigmoid inflection point (pre-diabetes transition %)

    // Cellular (GDF-15, CD38)
    this.GDF_M      = 1050;    // Hill half-maximal constant (pg/mL)
    this.GDF_N      = 3;       // Hill coefficient
    this.CD38_SLOPE = 4.5;     // Linear penalty per fold-change above 1.0

    // MicroVascular (Cystatin C)
    this.CYS_K       = 2.0;    // Decay constant
    this.CYS_OPTIMAL = 0.68;   // Max-score threshold (mg/L)

    // Deficit Accumulation Model
    this.MAX_HEALTH_SCORE = 40; // 4 dimensions × 10 pts
    this.BASELINE_AGE     = 25; // Theoretical zero-deficit age
    this.BASELINE_MFI     = 0.05;
    this.AGING_RATE       = 0.005;
    this.TANH_SCALE       = 11;
  }

  /** S = 10 × e^(−k × (val − threshold)), clamped [0, 10] */
  _exponentialScore(value, threshold, k) {
    if (value <= threshold) return 10.0;
    return Math.max(0, 10.0 * Math.exp(-k * (value - threshold)));
  }

  /** S = 10 / (1 + e^(alpha × (val − beta))) */
  _sigmoidScore(value, alpha, beta) {
    return 10.0 / (1.0 + Math.exp(alpha * (value - beta)));
  }

  /** S = 10 / (1 + (val / M)^n) */
  _hillScore(value, M, n) {
    return 10.0 / (1.0 + Math.pow(value / M, n));
  }

  /** Resilience dimension — hsCRP + IL-6: how well you buffer stress */
  _calcResilience(hsCRP, IL6) {
    const s_crp = this._exponentialScore(hsCRP, this.CRP_OPTIMAL, this.CRP_K);
    const s_il6 = this._exponentialScore(IL6,   this.IL6_OPTIMAL, this.IL6_K);
    return { score: 0.5 * s_crp + 0.5 * s_il6, components: { s_crp, s_il6 } };
  }

  /** Cellular dimension — GDF-15 + CD38: raw life-force of your cells */
  _calcCellular(GDF15, CD38) {
    const s_gdf  = this._hillScore(GDF15, this.GDF_M, this.GDF_N);
    const s_cd38 = Math.max(0, Math.min(10, 10.0 - this.CD38_SLOPE * (CD38 - 1.0)));
    return { score: 0.5 * s_gdf + 0.5 * s_cd38, components: { s_gdf, s_cd38 } };
  }

  /** Metabolic dimension — GA: how cleanly you burn fuel.
   *  Coupling: high inflammation (Resilience score < 4) accelerates metabolic decay → 10% penalty. */
  _calcMetabolic(GA, resilienceScore) {
    const s_ga    = this._sigmoidScore(GA, this.GA_ALPHA, this.GA_BETA);
    const penalty = resilienceScore < 4.0 ? 0.9 : 1.0;
    return { score: s_ga * penalty, components: { s_ga }, penaltyApplied: penalty < 1.0 };
  }

  /** MicroVascular dimension — Cystatin C: how well you deliver nutrients and oxygen */
  _calcMicroVascular(CystatinC) {
    const s_cys = this._exponentialScore(CystatinC, this.CYS_OPTIMAL, this.CYS_K);
    return { score: s_cys, components: { s_cys } };
  }

  /**
   * Convert a single-dimension score (0–10) to a sub-age.
   * Uses the same mFI deficit model as the combined BioAge, but calibrated
   * for one dimension (offset -1 vs. -4 for the full four-dimension model).
   */
  _scoreToSubAge(chronologicalAge, score) {
    const effectiveAge  = Math.max(this.BASELINE_AGE, chronologicalAge);
    const mFI_Actual    = (10 - score) / 10;
    const mFI_Expected  = this.BASELINE_MFI + this.AGING_RATE * (effectiveAge - this.BASELINE_AGE);
    const rawDeviation  = (mFI_Actual - mFI_Expected) / this.AGING_RATE;
    const compressed    = this.TANH_SCALE * Math.tanh(rawDeviation / this.TANH_SCALE) - 1;
    return parseFloat((chronologicalAge + compressed).toFixed(1));
  }

  /**
   * Calculate Biological Age.
   * @param {number} chronologicalAge
   * @param {{ hsCRP, IL6, GA, CD38, GDF15, CystatinC }} biomarkers
   * @returns {object} Full BioAge profile including sub-ages
   */
  calculateBioAge(chronologicalAge, biomarkers) {
    const resilience    = this._calcResilience(biomarkers.hsCRP, biomarkers.IL6);
    const cellular      = this._calcCellular(biomarkers.GDF15, biomarkers.CD38);
    const metabolic     = this._calcMetabolic(biomarkers.GA, resilience.score);
    const microVascular = this._calcMicroVascular(biomarkers.CystatinC);

    const totalHealthScore = resilience.score + cellular.score + metabolic.score + microVascular.score;

    const mFI_Actual   = (this.MAX_HEALTH_SCORE - totalHealthScore) / this.MAX_HEALTH_SCORE;
    const effectiveAge = Math.max(this.BASELINE_AGE, chronologicalAge);
    const mFI_Expected = this.BASELINE_MFI + this.AGING_RATE * (effectiveAge - this.BASELINE_AGE);

    const rawYearDeviation   = (mFI_Actual - mFI_Expected) / this.AGING_RATE;
    const compressedDeviation = this.TANH_SCALE * Math.tanh(rawYearDeviation / this.TANH_SCALE) - 4;

    return {
      ChronoAge:    chronologicalAge,
      BioAge:       parseFloat((chronologicalAge + compressedDeviation).toFixed(1)),
      AgeDifference: parseFloat(compressedDeviation.toFixed(1)),
      SubAges: {
        ResilienceAge:    this._scoreToSubAge(chronologicalAge, resilience.score),
        CellularAge:      this._scoreToSubAge(chronologicalAge, cellular.score),
        MetabolicAge:     this._scoreToSubAge(chronologicalAge, metabolic.score),
        MicroVascularAge: this._scoreToSubAge(chronologicalAge, microVascular.score),
      },
      mFI: {
        actual:   parseFloat(mFI_Actual.toFixed(3)),
        expected: parseFloat(mFI_Expected.toFixed(3)),
      },
      Scores: {
        total:        parseFloat(totalHealthScore.toFixed(2)),
        Resilience:   parseFloat(resilience.score.toFixed(2)),
        Cellular:     parseFloat(cellular.score.toFixed(2)),
        Metabolic:    parseFloat(metabolic.score.toFixed(2)),
        MicroVascular: parseFloat(microVascular.score.toFixed(2)),
      },
      Details: {
        Resilience_components:    resilience.components,
        Cellular_components:      cellular.components,
        Metabolic_components:     metabolic.components,
        MicroVascular_components: microVascular.components,
        couplingPenalty:          metabolic.penaltyApplied,
      },
    };
  }
}

module.exports = { BioAgeCalculator };
