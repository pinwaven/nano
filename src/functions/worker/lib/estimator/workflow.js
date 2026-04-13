'use strict';

/**
 * Core workflow logic, mirroring the Coze workflow graph:
 *
 * Start → Query DB (by TestID)
 *           ↓ exists?
 *        [No]  → Estimate Biomarkers → Insert Record → Variable Merge → End
 *        [Yes] → Return Saved Output → Variable Merge → End
 */

const { BiomarkerEstimator } = require('./BiomarkerEstimator');
const db = require('./db');

/**
 * Runs the BiomarkerEstimator workflow.
 *
 * @param {object} input
 * @param {number} input.ChronoAge
 * @param {string} input.TestID
 * @param {string} input.UserID
 * @param {string[]} input.Tags
 * @param {object} input.BiomarkerValues  - optional known test values
 * @param {object} input.Biometrics       - optional Height/Weight/Sex
 * @returns {Promise<{ output: object, cached: boolean }>}
 */
async function runWorkflow(input) {
  const { ChronoAge, TestID, UserID, Tags = [], BiomarkerValues = {}, Biometrics = {} } = input;

  // Node 192065: Query DB — does this TestID already exist?
  const existing = await db.findByTestId(TestID);

  if (existing) {
    // Node 178672 (false branch): return saved output
    const report = typeof existing.output === 'string'
      ? JSON.parse(existing.output)
      : existing.output;
    return { output: report, cached: true };
  }

  // Node 140320 (true branch): estimate biomarkers
  const estimator = new BiomarkerEstimator(ChronoAge ?? 40, BiomarkerValues, Biometrics, Tags);
  const report = estimator.generateReport();
  const merged = Object.assign({}, input, report);

  // Node 193898: insert record into DB
  await db.insert({
    user_id: UserID,
    test_id: TestID,
    input: JSON.stringify(input),
    output: JSON.stringify(merged),
  });

  return { output: merged, cached: false };
}

module.exports = { runWorkflow };
