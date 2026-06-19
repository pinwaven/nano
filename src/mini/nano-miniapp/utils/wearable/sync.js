'use strict'

/**
 * Brand-agnostic wearable data sync utility.
 *
 * @typedef {Object} WearableSnapshot
 * @property {string} source         - 'smart_ring', 'apple_health', 'garmin', etc.
 * @property {number|null} steps
 * @property {number|null} calories
 * @property {number|null} distance  - metres
 * @property {Array|null}  stepSlots - [{t, steps, cal, dist}] per 15-min window
 * @property {number|null} sleepMinutes
 * @property {number|null} sleepDeep
 * @property {number|null} sleepLight
 * @property {number|null} sleepRem
 * @property {number|null} sleepAwake
 * @property {number|null} sleepStart - minutes after midnight (sleep onset)
 * @property {number|null} sleepEnd   - minutes after midnight (wake time)
 * @property {Array|null}  sleepSlots - [{type, min}] consecutive sleep stage periods
 * @property {Array|null}  hrSlots    - [{t, bpm}] per 5-min interval
 * @property {number|null} restingHr - bpm
 * @property {number|null} hrv            - ms (RMSSD)
 * @property {number|null} stress         - 0–100
 * @property {number|null} spo2           - % (SpO2 blood oxygen)
 * @property {number|null} breathRate     - breaths per minute (from HRV measurement)
 * @property {number|null} heartRateFromHrv - bpm measured during HRV session
 * @property {number|null} systolicBP     - mmHg systolic blood pressure
 * @property {number|null} diastolicBP    - mmHg diastolic blood pressure
 * @property {number}      syncedAt       - Date.now()
 */

const { BASE } = require('../config.js')

/**
 * Map a WearableSnapshot to health_events and POST to /api/health-events/sync.
 * Returns the server response object, or { success: false, error } on network failure.
 *
 * @param {string} openid
 * @param {WearableSnapshot} snapshot
 * @param {string} [apiToken]
 */
function syncWearableData(openid, snapshot, apiToken) {
  const now = new Date(snapshot.syncedAt)
  const todayDate  = _shanghaiDateStr(now, 0)
  const sleepDate  = _shanghaiDateStr(now, -1)   // sleep is overnight — belongs to the previous date
  const recordedAt = now.toISOString()
  const src = snapshot.source

  const events = []

  if (snapshot.steps != null || snapshot.calories != null || snapshot.distance != null) {
    events.push({
      category: 'activity',
      source: src,
      data_date: todayDate,
      recorded_at: recordedAt,
      external_id: `${src}_activity_${todayDate}`,
      data: {
        steps:      snapshot.steps      ?? null,
        calories:   snapshot.calories   ?? null,
        distance_m: snapshot.distance   ?? null,
        ...(snapshot.stepSlots?.length ? { slots: snapshot.stepSlots } : {}),
      },
    })
  }

  if (snapshot.sleepMinutes != null && snapshot.sleepMinutes > 0) {
    events.push({
      category: 'sleep',
      source: src,
      data_date: sleepDate,
      recorded_at: recordedAt,
      external_id: `${src}_sleep_${sleepDate}`,
      data: {
        duration_minutes: snapshot.sleepMinutes,
        deep_minutes:     snapshot.sleepDeep   ?? null,
        light_minutes:    snapshot.sleepLight  ?? null,
        rem_minutes:      snapshot.sleepRem    ?? null,
        awake_minutes:    snapshot.sleepAwake  ?? null,
        sleep_start_min:  snapshot.sleepStart  ?? null,
        sleep_end_min:    snapshot.sleepEnd    ?? null,
        ...(snapshot.sleepSlots?.length ? { slots: snapshot.sleepSlots } : {}),
      },
    })
  }

  // Daily vitals: resting HR + full-day HR log (upsert per day — derived from complete HR log)
  if (snapshot.restingHr != null || snapshot.hrSlots?.length) {
    events.push({
      category: 'vitals',
      source: src,
      data_date: todayDate,
      recorded_at: recordedAt,
      external_id: `${src}_resting_hr_${todayDate}`,
      data: {
        resting_hr: snapshot.restingHr ?? null,
        ...(snapshot.hrSlots?.length ? { hr_slots: snapshot.hrSlots } : {}),
      },
    })
  }

  // Per-measurement: HRV / stress / SpO₂ / BP — each sync gets its own row (timestamp external_id)
  const hasRealtime = snapshot.hrv != null || snapshot.stress != null || snapshot.spo2 != null
    || snapshot.systolicBP != null || snapshot.breathRate != null
  if (hasRealtime) {
    const ts = new Date(snapshot.syncedAt).toISOString().replace(/[:.]/g, '')
    events.push({
      category: 'vitals',
      source: src,
      data_date: todayDate,
      recorded_at: recordedAt,
      external_id: `${src}_realtime_${ts}`,
      data: {
        hrv_ms:       snapshot.hrv             ?? null,
        stress:       snapshot.stress          ?? null,
        spo2:         snapshot.spo2            ?? null,
        breath_rate:  snapshot.breathRate      ?? null,
        heart_rate_hrv: snapshot.heartRateFromHrv ?? null,
        bp_systolic:  snapshot.systolicBP      ?? null,
        bp_diastolic: snapshot.diastolicBP     ?? null,
      },
    })
  }

  if (!events.length) return Promise.resolve({ success: true, synced: 0, skipped: 0 })

  return new Promise((resolve) => {
    wx.request({
      url: `${BASE}/api/health-events/sync`,
      method: 'POST',
      header: { 'Content-Type': 'application/json', ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {}) },
      data: { openid, events },
      success: (res) => resolve(res.data),
      fail: (err) => resolve({ success: false, error: err.errMsg }),
    })
  })
}

function _shanghaiDateStr(date, dayOffset) {
  const OFFSET_MS = 8 * 60 * 60 * 1000
  const d = new Date(date.getTime() + OFFSET_MS)
  d.setUTCDate(d.getUTCDate() + dayOffset)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

module.exports = { syncWearableData }
