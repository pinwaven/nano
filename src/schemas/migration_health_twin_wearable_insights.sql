-- health_twin.wearable_insights: the analysis layer over synced ring data (twin layer 2,
-- 日常监测), written by lib/healthTwinUpdater.js from lib/wearableAnalysis.js on every
-- health_events sync. Codes and numbers only — personal HRV baseline/band, today's z-scores,
-- readiness score + drivers, sleep debt/regularity, stress balance, anomaly flags.
-- Recomputed from scratch each time (never COALESCEd), like latest_lab_data.
-- Fresh reads for the health tab go through GET /api/wearable-insights, which recomputes;
-- this column is the cheap copy for prompts, the daily check-in and the AG twin bundle.
ALTER TABLE health_twin ADD COLUMN IF NOT EXISTS wearable_insights JSONB;
