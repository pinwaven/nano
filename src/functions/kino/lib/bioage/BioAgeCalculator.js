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
    this.GA_BETA  = 15.5;      // Sigmoid inflection point (pre-diabetes transition %)

    // Cellular (GDF-15, CD38)
    this.GDF_M      = 1150;    // Hill half-maximal constant (pg/mL)
    this.GDF_N      = 3;       // Hill coefficient
    this.CD38_SLOPE = 4.5;     // Linear penalty per fold-change above 1.0

    // MicroVascular (Cystatin C)
    this.CYS_K       = 4.5;    // Decay constant
    this.CYS_OPTIMAL = 0.70;   // Max-score threshold (mg/L)

    // Deficit Accumulation Model (Gompertz-calibrated to Chinese population statistics)
    this.MAX_HEALTH_SCORE = 40; // 4 dimensions × 10 pts
    this.BASELINE_AGE     = 25;
    
    // Fit: mFI = A * e^(B * age)
    this.GOMPERTZ_A      = 0.0325;
    this.GOMPERTZ_B      = 0.0415;

    // Soft-compression scales (non-hard caps)
    this.LOWER_SOFT_SCALE = 6.0;   // Controls youth-bias sensitivity
    this.UPPER_SOFT_SCALE = 12.0;  // Controls aging-acceleration sensitivity
  }

  /**
   * Asymmetric Logarithmic Compression:
   * Provides a "soft" limit that slows down as it approaches the desired range,
   * but never hard-caps, allowing for extreme statistical outliers.
   */
  _compress(deviation) {
    if (deviation >= 0) {
      // Positive: y = S * ln(1 + x/S)
      return this.UPPER_SOFT_SCALE * Math.log(1 + deviation / this.UPPER_SOFT_SCALE);
    } else {
      // Negative: y = -S * ln(1 + |x|/S)
      const absDev = Math.abs(deviation);
      return -this.LOWER_SOFT_SCALE * Math.log(1 + absDev / this.LOWER_SOFT_SCALE);
    }
  }

  /**
   * Inverse Gompertz: Maps a deficit ratio (mFI) to the age at which 
   * an average person would have that deficit.
   */
  _mfiToAge(mFI) {
    const safeMFI = Math.max(0.001, mFI);
    return Math.log(safeMFI / this.GOMPERTZ_A) / this.GOMPERTZ_B;
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
   *  Coupling: high inflammation (Resilience score < 4) accelerates metabolic decay → 10% penalty.
   *  BMI Factor: High BMI directly taxes metabolic health score. */
  _calcMetabolic(GA, resilienceScore, BMI = 22) {
    const s_ga    = this._sigmoidScore(GA, this.GA_ALPHA, this.GA_BETA);
    
    // BMI Penalty: Sigmoid health score centered at 28 (overweight boundary)
    // S = 10 / (1 + e^(0.4 * (BMI - 28)))
    const s_bmi   = this._sigmoidScore(BMI, 0.4, 28);
    
    const penalty = resilienceScore < 4.0 ? 0.9 : 1.0;
    
    // Metabolic score is weighted 70% GA, 30% BMI
    const baseScore = (0.7 * s_ga + 0.3 * s_bmi);
    
    return { 
      score: baseScore * penalty, 
      components: { s_ga, s_bmi }, 
      penaltyApplied: penalty < 1.0 
    };
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
    const mFI_Actual    = (10 - score) / 10;
    const rawBioAge     = this._mfiToAge(mFI_Actual);
    const rawDeviation  = rawBioAge - chronologicalAge;
    const compressed    = this._compress(rawDeviation);
    return parseFloat((chronologicalAge + compressed).toFixed(1));
  }

  /**
   * Calculate Biological Age.
   * @param {number} chronologicalAge
   * @param {{ hsCRP, IL6, GA, CD38, GDF15, CystatinC }} biomarkers
   * @param {{ BMI, Weight, Height }} biometrics
   * @returns {object} Full BioAge profile including sub-ages
   */
  calculateBioAge(chronologicalAge, biomarkers, biometrics = {}) {
    const BMI = biometrics.BMI || (biometrics.Weight && biometrics.Height ? biometrics.Weight / Math.pow(biometrics.Height / 100, 2) : 22);

    const resilience    = this._calcResilience(biomarkers.hsCRP, biomarkers.IL6);
    const cellular      = this._calcCellular(biomarkers.GDF15, biomarkers.CD38);
    const metabolic     = this._calcMetabolic(biomarkers.GA, resilience.score, BMI);
    const microVascular = this._calcMicroVascular(biomarkers.CystatinC);

    const totalHealthScore = resilience.score + cellular.score + metabolic.score + microVascular.score;

    const mFI_Actual   = (this.MAX_HEALTH_SCORE - totalHealthScore) / this.MAX_HEALTH_SCORE;
    const mFI_Expected = this.GOMPERTZ_A * Math.exp(this.GOMPERTZ_B * chronologicalAge);
    const rawBioAge    = this._mfiToAge(mFI_Actual);

    const rawYearDeviation   = rawBioAge - chronologicalAge;
    const compressedDeviation = this._compress(rawYearDeviation);

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
