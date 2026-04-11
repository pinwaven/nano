'use strict';

/**
 * HTTP API server.
 *
 * POST /calculate
 * Body: {
 *   "ChronoAge": 39,
 *   "BiomarkerValues": {
 *     "hsCRP": 1.4,
 *     "IL6": 0.79,
 *     "GA": 13.6,
 *     "CD38": 1.4,
 *     "GDF15": 470,
 *     "CystatinC": 0.69
 *   }
 * }
 *
 * Response: { ChronoAge, BiomarkerValues, BioAgeProfile: { BioAge, AgeDifference, mFI, Scores, Details } }
 */

const express = require('express');
const { runWorkflow } = require('./workflow');

const app = express();
app.use(express.json());

app.post('/calculate', (req, res) => {
  const { ChronoAge, BiomarkerValues } = req.body;

  if (ChronoAge === undefined || !BiomarkerValues) {
    return res.status(400).json({ error: 'ChronoAge and BiomarkerValues are required.' });
  }

  const required = ['hsCRP', 'IL6', 'GA', 'CD38', 'GDF15', 'CystatinC'];
  const missing = required.filter(k => BiomarkerValues[k] === undefined);
  if (missing.length) {
    return res.status(400).json({ error: `Missing biomarkers: ${missing.join(', ')}` });
  }

  res.json(runWorkflow({ ChronoAge, BiomarkerValues }));
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`BioAgeCalculator API listening on http://localhost:${PORT}`);
  console.log(`POST http://localhost:${PORT}/calculate`);
});
