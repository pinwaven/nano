'use strict';

/**
 * HTTP API server (mirrors the Coze workflow as a POST endpoint).
 *
 * POST /estimate
 * Body: {
 *   "ChronoAge": 39,
 *   "TestID": "MVNS0725111401-0035",
 *   "UserID": "72227835-9365-4463-9342-56e0c3414caf",
 *   "Tags": ["焦虑", "睡眠不足", "糖尿病前期"],
 *   "BiomarkerValues": { "hsCRP": 4.8 },
 *   "Biometrics": { "Height": 159, "Sex": "女", "Weight": 80 }
 * }
 *
 * Response: { output: { ...report }, cached: boolean }
 */

const express = require('express');
const { runWorkflow } = require('./workflow');

const app = express();
app.use(express.json());

app.post('/estimate', async (req, res) => {
  const { ChronoAge, TestID, UserID, Tags, BiomarkerValues, Biometrics } = req.body;

  if (!TestID || !UserID || ChronoAge === undefined) {
    return res.status(400).json({ error: 'ChronoAge, TestID, and UserID are required.' });
  }

  try {
    const result = await runWorkflow({ ChronoAge, TestID, UserID, Tags, BiomarkerValues, Biometrics });
    res.json(result);
  } catch (err) {
    console.error('runWorkflow error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`BiomarkerEstimator API listening on http://localhost:${PORT}`);
  console.log(`POST http://localhost:${PORT}/estimate`);
});
