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
 * @property {number|null} hrv       - ms (RMSSD)
 * @property {number|null} stress    - 0–100
 * @property {number|null} spo2      - % (SpO2 blood oxygen)
 * @property {number}      syncedAt  - Date.now()
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
  const todayDate  = _utcDateStr(now, 0)
  const sleepDate  = _utcDateStr(now, -1)   // sleep is overnight — belongs to the previous date
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

  const hasVitals = snapshot.restingHr != null || snapshot.hrv != null || snapshot.stress != null || snapshot.spo2 != null
  if (hasVitals) {
    events.push({
      category: 'vitals',
      source: src,
      data_date: todayDate,
      recorded_at: recordedAt,
      external_id: `${src}_vitals_${todayDate}`,
      data: {
        resting_hr: snapshot.restingHr ?? null,
        hrv_ms:     snapshot.hrv       ?? null,
        stress:     snapshot.stress    ?? null,
        spo2:       snapshot.spo2      ?? null,
        ...(snapshot.hrSlots?.length ? { hr_slots: snapshot.hrSlots } : {}),
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

function _utcDateStr(date, dayOffset) {
  const d = new Date(date)
  d.setUTCDate(d.getUTCDate() + dayOffset)
  const y  = d.getUTCFullYear()
  const m  = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

module.exports = { syncWearableData }
