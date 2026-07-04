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
 * @property {Array|null}  sleepHistory - [{date, onset, totalMinutes, deep, light, rem, awake, sleepStart, sleepEnd, slots}] per-session sleep summaries, oldest first (X3). `date` is the noon-to-noon "night" bucket (see _nightKey in x3/index.js); `onset` is the session's actual "YYYY-MM-DD HH:MM:SS" start time, used to distinguish naps from night sleep and to position blocks on a 24h timeline.
 * @property {Array|null}  hrSlots    - [{t, bpm}] per 5-min interval
 * @property {number|null} restingHr - bpm
 * @property {number|null} hrv            - ms (RMSSD) — last reading, used for display
 * @property {number|null} stress         - 0–100 — last reading, used for display
 * @property {number|null} spo2           - % (SpO2 blood oxygen) — last reading, used for display
 * @property {number|null} breathRate     - breaths per minute (from HRV measurement)
 * @property {number|null} heartRateFromHrv - bpm measured during HRV session
 * @property {number|null} systolicBP     - mmHg systolic blood pressure
 * @property {number|null} diastolicBP    - mmHg diastolic blood pressure
 * @property {string|null} hrvMeasuredAt  - ring's BCD timestamp for the HRV record ("YYYY-MM-DD HH:MM:SS")
 * @property {Array|null}  hrvSlots  - [{timestamp, hrv, stress, breath, heartRate, highBP, lowBP}] all cached HRV readings across ~3 days (X3)
 * @property {Array|null}  spo2Slots - [{timestamp, spo2}] all cached SpO2 readings across ~3 days (X3)
 * @property {Array|null}  tempSlots - [{timestamp, skinTemp, estimatedBodyTemp, status}] all cached temp readings (X3)
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

  // Sleep — one event per calendar date. Sessions are keyed by their own
  // recorded date (not "yesterday relative to sync time"), and multiple
  // sessions on the same date (e.g. an afternoon nap plus the night's sleep)
  // are merged into a single event instead of only sending whichever
  // session happens to be chronologically last.
  if (snapshot.sleepHistory?.length) {
    const byDate = {}
    for (const s of snapshot.sleepHistory) {
      if (!s.totalMinutes) continue
      const agg = byDate[s.date] || (byDate[s.date] = {
        totalMinutes: 0, deep: 0, light: 0, rem: 0, awake: 0,
        sleepStart: null, sleepEnd: null, slots: [], sessions: [],
      })
      agg.totalMinutes += s.totalMinutes
      agg.deep  += s.deep  ?? 0
      agg.light += s.light ?? 0
      agg.rem   += s.rem   ?? 0
      agg.awake += s.awake ?? 0
      if (s.sleepStart != null) agg.sleepStart = agg.sleepStart == null ? s.sleepStart : Math.min(agg.sleepStart, s.sleepStart)
      if (s.sleepEnd   != null) agg.sleepEnd   = agg.sleepEnd   == null ? s.sleepEnd   : Math.max(agg.sleepEnd, s.sleepEnd)
      if (s.slots?.length) agg.slots.push(...s.slots)
      // Preserve each discrete session (nap, night sleep, or a wake-interrupted
      // segment of one) so the UI can render distinct sleep blocks per day
      // instead of only the same-day merged total.
      agg.sessions.push({
        onset: s.onset ?? null,
        totalMinutes: s.totalMinutes,
        deep: s.deep ?? null, light: s.light ?? null, rem: s.rem ?? null, awake: s.awake ?? null,
        sleepStart: s.sleepStart ?? null, sleepEnd: s.sleepEnd ?? null,
        ...(s.slots?.length ? { slots: s.slots } : {}),
      })
    }
    for (const date of Object.keys(byDate)) {
      const agg = byDate[date]
      events.push({
        category: 'sleep',
        source: src,
        data_date: date,
        recorded_at: recordedAt,
        external_id: `${src}_sleep_${date}`,
        data: {
          duration_minutes: agg.totalMinutes,
          deep_minutes:     agg.deep,
          light_minutes:    agg.light,
          rem_minutes:      agg.rem,
          awake_minutes:    agg.awake,
          sleep_start_min:  agg.sleepStart,
          sleep_end_min:    agg.sleepEnd,
          ...(agg.slots.length ? { slots: agg.slots } : {}),
          sessions: agg.sessions,
        },
      })
    }
  } else if (snapshot.sleepMinutes != null && snapshot.sleepMinutes > 0) {
    // Fallback for sources without per-session history (e.g. non-X3 wearables).
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

  // Per-measurement HRV events (X3 — one event per reading, each with its own external_id).
  // Each slot already carries stress, breath, HR, and BP from the same 0x56 record.
  if (snapshot.hrvSlots?.length) {
    for (const slot of snapshot.hrvSlots) {
      const ts = slot.timestamp.replace(/\D/g, '')
      const slotDate = slot.timestamp.substring(0, 10)  // '2026-06-20' from '2026-06-20 14:30:12'
      events.push({
        category: 'vitals',
        source: src,
        data_date: slotDate,
        recorded_at: recordedAt,
        external_id: `${src}_hrv_${ts}`,
        data: {
          hrv_ms:         slot.hrv       ?? null,
          stress:         slot.stress    ?? null,
          breath_rate:    slot.breath    ?? null,
          heart_rate_hrv: slot.heartRate ?? null,
          bp_systolic:    slot.highBP    ?? null,
          bp_diastolic:   slot.lowBP     ?? null,
        },
      })
    }
  }

  // Per-measurement SpO2 events (X3 — one event per auto-SpO2 reading).
  if (snapshot.spo2Slots?.length) {
    for (const slot of snapshot.spo2Slots) {
      const ts = slot.timestamp.replace(/\D/g, '')
      const slotDate = slot.timestamp.substring(0, 10)
      events.push({
        category: 'vitals',
        source: src,
        data_date: slotDate,
        recorded_at: recordedAt,
        external_id: `${src}_spo2_${ts}`,
        data: { spo2: slot.spo2 ?? null },
      })
    }
  }

  // Per-measurement temperature events (X3 — one event per scheduled temp reading).
  if (snapshot.tempSlots?.length) {
    for (const slot of snapshot.tempSlots) {
      const ts = slot.timestamp ? slot.timestamp.replace(/\D/g, '') : String(slot.date || '').replace(/\D/g, '') + '0000'
      const slotDate = slot.timestamp ? slot.timestamp.substring(0, 10) : String(slot.date || todayDate)
      if (slot.estimatedBodyTemp == null) continue
      events.push({
        category: 'vitals',
        source: src,
        data_date: slotDate,
        recorded_at: recordedAt,
        external_id: `${src}_temp_${ts}`,
        data: {
          body_temp_c: slot.estimatedBodyTemp,
          skin_temp_c: slot.skinTemp ?? null,
        },
      })
    }
  }

  // Single realtime vitals event — Colmi / on-demand measurements (no per-measurement slots).
  // external_id uses the ring's actual measurement timestamp so repeated syncs upsert the same row.
  const hasRealtime = !snapshot.hrvSlots?.length && !snapshot.spo2Slots?.length
    && (snapshot.hrv != null || snapshot.stress != null || snapshot.spo2 != null
      || snapshot.systolicBP != null || snapshot.breathRate != null)
  if (hasRealtime) {
    const measuredTs = snapshot.hrvMeasuredAt
      ? snapshot.hrvMeasuredAt.replace(/[^0-9]/g, '')
      : new Date(snapshot.syncedAt).toISOString().replace(/[:.]/g, '')
    events.push({
      category: 'vitals',
      source: src,
      data_date: todayDate,
      recorded_at: recordedAt,
      external_id: `${src}_realtime_${measuredTs}`,
      data: {
        hrv_ms:         snapshot.hrv             ?? null,
        stress:         snapshot.stress          ?? null,
        spo2:           snapshot.spo2            ?? null,
        breath_rate:    snapshot.breathRate      ?? null,
        heart_rate_hrv: snapshot.heartRateFromHrv ?? null,
        bp_systolic:    snapshot.systolicBP      ?? null,
        bp_diastolic:   snapshot.diastolicBP     ?? null,
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
