'use strict';

// Shared renderer for the always-fetched per-day wearable rows (llmContext.wearable_daily).
// Persona-agnostic, like the other prompts/chat blocks. `now_iso` is the Shanghai ISO string
// every template already receives, so "today" is the same date the user's phone shows.
const { describeWearableDaily } = require('../../lib/wearableDaily');
const { describeWearableInsights } = require('../../lib/wearableAnalysis');

// `insights` is llmContext.wearable_insights — the analysis health_twin stored at the last sync
// (readiness, personal HRV band, sleep debt, stress balance, anomaly flags). Rendered under the
// per-day rows so the same templates that can answer 「昨晚睡得怎么样」 can also answer 「我今天
// 恢复得怎么样」 against the user's own baseline instead of an absolute cut.
function getWearableDailyBlock(rows, isZh = true, nowIso = null, insights = null) {
  const today = typeof nowIso === 'string' ? nowIso.slice(0, 10) : null;
  const daily = rows && rows.length ? describeWearableDaily(rows, isZh, today) : '';
  const analysis = describeWearableInsights(insights, isZh);
  return [daily, analysis].filter(Boolean).join('\n\n');
}

module.exports = { getWearableDailyBlock };
