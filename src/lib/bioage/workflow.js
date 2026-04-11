'use strict';

/**
 * Core workflow logic, mirroring the Coze graph:
 *   Start → Code (BioAgeCalculator) → End
 *
 * @param {object} input
 * @param {number} input.ChronoAge
 * @param {object} input.BiomarkerValues  { hsCRP, IL6, GA, CD38, GDF15, CystatinC }
 * @returns {object} input merged with BioAgeProfile
 */
const { BioAgeCalculator } = require('./BioAgeCalculator');

function runWorkflow(input) {
  const calculator = new BioAgeCalculator();
  const bioAgeProfile = calculator.calculateBioAge(input.ChronoAge, input.BiomarkerValues);
  return { ...input, BioAgeProfile: bioAgeProfile };
}

module.exports = { runWorkflow };
