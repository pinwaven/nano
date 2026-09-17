'use strict';

// Shared renderer for the always-fetched per-day wearable rows (llmContext.wearable_daily).
// Persona-agnostic, like the other prompts/chat blocks. `now_iso` is the Shanghai ISO string
// every template already receives, so "today" is the same date the user's phone shows.
const { describeWearableDaily } = require('../../lib/wearableDaily');

function getWearableDailyBlock(rows, isZh = true, nowIso = null) {
  if (!rows || rows.length === 0) return '';
  const today = typeof nowIso === 'string' ? nowIso.slice(0, 10) : null;
  return describeWearableDaily(rows, isZh, today);
}

module.exports = { getWearableDailyBlock };
