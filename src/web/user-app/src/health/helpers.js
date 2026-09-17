// GENERATED from src/mini/nano-miniapp/components/user-health/user-health.js (the pure prelude
// above Component({)) by scripts/sync-health-helpers-from-miniapp.mjs. Do not edit by hand.
/* eslint-disable */
import smoothing from '@mini/wearable/signal-smoothing.js';
import mood from '@mini/mood.js';
import HEALTH_T, { TWIN_LAYER_LABELS } from '../i18n/health.js';
const { flagOutliers, interpolateFlagged } = smoothing;
const { computeMood, resolveAvatarUrl, DEFAULT_MOOD } = mood;
const T = HEALTH_T;
export { computeMood, resolveAvatarUrl, DEFAULT_MOOD, TWIN_LAYER_LABELS, T as HEALTH_T };


const BM_META = [
  { key: 'hsCRP',     unit: 'mg/L',      color: '#f472b6' },
  { key: 'GDF15',     unit: 'pg/mL',     color: '#fb7185' },
  { key: 'IL6',       unit: 'pg/mL',     color: '#a855f7' },
  { key: 'GA',        unit: '%',         color: '#6375EC' },
  { key: 'CystatinC', unit: 'mg/L',      color: '#0ea5e9' },
  { key: 'CD38',      unit: 'xBaseline', color: '#e879f9' },
]

const SUB_AGE_META = [
  { key: 'ResilienceAge',    color: '#c084d4' },
  { key: 'CellularAge',      color: '#10b981' },
  { key: 'MetabolicAge',     color: '#6375EC' },
  { key: 'MicroVascularAge', color: '#0ea5e9' },
]

const SUB_AGE_KEYS = SUB_AGE_META.map(m => m.key)

// health_events.source values that represent a real BP-device reading the user
// supplied themselves. Ring-derived sources (e.g. 'smart_ring') are excluded —
// the Halo ring estimates BP from HRV pulse-wave data, not a cuff, and is not
// accurate until calibrated against an actual BP device.
const USER_UPLOADED_BP_SOURCES = new Set(['manual_photo'])

function buildSubAgeLabels(base, overrides, lang) {
  if (!overrides) return base
  const result = { ...base }
  for (const key of SUB_AGE_KEYS) {
    const override = overrides[key]?.[lang]
    if (override && override.trim()) result[key] = override.trim()
  }
  return result
}

const CONDITION_KEYS = [
  'blood_sugar_high', 'blood_pressure_high', 'blood_lipids_high',
  'cholesterol_high', 'heart_issues', 'gout_uric_acid',
  'kidney_disease', 'sleep_deficiency', 'other',
]

function _scoreSleep(h) {
  if (h >= 7 && h <= 9) return Math.min(100, Math.round(80 + (h - 7) / 2 * 20))
  if (h > 9) return Math.max(50, Math.round(100 - (h - 9) * 25))
  if (h >= 6) return Math.round(50 + (h - 6) * 30)
  return Math.max(10, Math.round(h / 6 * 50))
}

// 'x3' is a legacy brand value from before the X3→Halo rename — still present
// in local storage / server rows for anyone bound before this change shipped.
function _normalizeBrand(brand) {
  return brand === 'x3' ? 'halo' : brand
}

// Halo and V8 share the same auto-monitoring config surface (0x2A/0x2B,
// confirmed identical) and the same single-phase "all historical, no
// realtime measurement" sync shape — see docs/architecture/v8-smart-band.md.
// Colmi and Aizo don't have either.
function _hasIntervalSettings(brand) {
  return brand === 'halo' || brand === 'v8'
}

// --- Sleep session helpers (shared by BLE-live sync, server hydration, and display prep) ---
// A "night" session starts in the 20:00–05:59 window; anything starting 06:00–19:59
// is a daytime nap. onset is a "YYYY-MM-DD HH:MM:SS" string.
function _isNightSession(onset) {
  const hour = parseInt(onset.slice(11, 13), 10)
  return hour >= 20 || hour < 6
}

// Minutes since the most recent noon (0 = noon, 720 = midnight, 1439 = 11:59am next day).
// Matches the noon-to-noon "night" bucket used by halo/index.js's _nightKey, so a session's
// position on a 24h axis lines up with the calendar day it's grouped under.
function _minutesSinceNoon(onset) {
  const hour = parseInt(onset.slice(11, 13), 10)
  const min  = parseInt(onset.slice(14, 16), 10)
  let mins = hour * 60 + min - 12 * 60
  if (mins < 0) mins += 1440
  return mins
}

// A long wake-up in the middle of the night splits one night's sleep into
// multiple discrete session records (see SPLIT_GAP_MINS in halo/index.js).
// Merges them into a single aggregate for the "Last Night" card, inserting a
// synthetic awake slot for the gap so the stage bar shows the time spent
// awake between segments instead of silently skipping it.
function _mergeNightSessions(sessions) {
  const ordered = sessions.slice().sort((a, b) => (a.onset < b.onset ? -1 : 1))
  const first = ordered[0], last = ordered[ordered.length - 1]
  let totalMinutes = 0, deep = 0, light = 0, rem = 0, awake = 0
  const slots = []
  let prevEndMins = null
  for (const s of ordered) {
    totalMinutes += s.totalMinutes || 0
    deep  += s.deep  || 0
    light += s.light || 0
    rem   += s.rem   || 0
    awake += s.awake || 0
    if (s.onset) {
      const startMins = _minutesSinceNoon(s.onset)
      if (prevEndMins != null && startMins > prevEndMins) slots.push({ type: 'awake', min: startMins - prevEndMins })
      prevEndMins = startMins + (s.totalMinutes || 0)
    }
    if (s.slots?.length) slots.push(...s.slots)
  }
  return {
    date: first.date, onset: first.onset,
    totalMinutes, deep, light, rem, awake,
    sleepStart: first.sleepStart, sleepEnd: last.sleepEnd,
    slots: slots.length ? slots : null,
  }
}

// Picks the most recent night's session(s) from a sleepHistory array (oldest
// first, each with a `date` = noon-to-noon night bucket) and merges them so a
// wake-interrupted night is represented as one session. `_isNightSession` is
// only used to pick WHICH date bucket is "last night" (so a trailing daytime
// nap doesn't take it over) — once chosen, every session sharing that date
// bucket is merged in, since a segment resumed after 6am still classifies as
// a "nap" by the hour heuristic even though it's a continuation of that same
// night (see the noon-to-noon bucketing in halo/index.js's _nightKey).
// Falls back to the single most recent session if no night session exists yet.
function _selectLastNight(sleepHistory) {
  if (!sleepHistory.length) return null
  const nightSessions = sleepHistory.filter(s => s.onset && _isNightSession(s.onset))
  if (!nightSessions.length) return sleepHistory[sleepHistory.length - 1]
  const lastDate = nightSessions.reduce((max, s) => (s.date > max ? s.date : max), nightSessions[0].date)
  const group = sleepHistory.filter(s => s.date === lastDate)
  return group.length > 1 ? _mergeNightSessions(group) : group[0]
}

function _dayQualityColor(totalMinutes) {
  return totalMinutes >= 420 ? '#10b981' : totalMinutes >= 360 ? '#0ea5e9' : totalMinutes >= 300 ? '#f97316' : '#ef4444'
}

function _fmtHM(totalMinutes, isZh) {
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (isZh) return m > 0 ? `${h}时${m}分` : `${h}时`
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

// Reconstructs per-session sleep blocks from one health_events sleep row.
// Prefers the `sessions` array (added so distinct naps/night segments survive
// the per-date merge in sync.js); falls back to synthesizing a single session
// from the older aggregate-only shape for rows synced before that change.
function _sessionsFromEventData(date, d) {
  if (Array.isArray(d.sessions) && d.sessions.length) {
    return d.sessions.map(s => ({ ...s, date }))
  }
  if (!d.duration_minutes) return []
  let onset = null
  if (d.sleep_start_min != null) {
    const mins = ((d.sleep_start_min % 1440) + 1440) % 1440
    onset = `${date} ${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}:00`
  }
  return [{
    date, onset,
    totalMinutes: d.duration_minutes,
    deep: d.deep_minutes ?? null, light: d.light_minutes ?? null, rem: d.rem_minutes ?? null, awake: d.awake_minutes ?? null,
    sleepStart: d.sleep_start_min ?? null, sleepEnd: d.sleep_end_min ?? null,
    slots: d.slots ?? null,
  }]
}
function _scoreHrv(ms) {
  if (ms >= 80) return 100
  if (ms >= 50) return Math.round(75 + (ms - 50) / 30 * 25)
  if (ms >= 30) return Math.round(45 + (ms - 30) / 20 * 30)
  return Math.max(10, Math.round(ms / 30 * 45))
}
function _scoreRestHr(bpm) {
  if (bpm <= 52) return 100
  if (bpm <= 65) return Math.round(100 - (bpm - 52) / 13 * 20)
  if (bpm <= 75) return Math.round(80 - (bpm - 65) / 10 * 20)
  if (bpm <= 90) return Math.round(60 - (bpm - 75) / 15 * 30)
  return Math.max(5, Math.round(30 - (bpm - 90) / 30 * 25))
}
function _scoreSpo2(pct) {
  if (pct >= 98) return 100
  if (pct >= 95) return Math.round(70 + (pct - 95) / 3 * 30)
  return Math.max(10, Math.round(30 + (pct - 90) / 5 * 40))
}
function _scoreSteps(steps) {
  if (steps >= 10000) return 100
  if (steps >= 7500) return Math.round(75 + (steps - 7500) / 2500 * 25)
  if (steps >= 5000) return Math.round(50 + (steps - 5000) / 2500 * 25)
  return Math.max(5, Math.round(steps / 5000 * 50))
}
function _scoreBmi(bmi) {
  if (bmi >= 18.5 && bmi <= 24.9) return 100
  if (bmi >= 25 && bmi <= 27.5) return Math.round(100 - (bmi - 24.9) / 2.6 * 30)
  if (bmi >= 17 && bmi < 18.5) return Math.round(70 + (bmi - 17) / 1.5 * 30)
  if (bmi > 27.5) return Math.max(10, Math.round(70 - (bmi - 27.5) / 10 * 60))
  return Math.max(10, Math.round(bmi / 17 * 70))
}

function _scoreBp(sys, dia) {
  if (sys == null || dia == null) return null
  if (sys >= 140 || dia >= 90) return 20
  if (sys >= 130 || dia >= 85) return 50
  if (sys >= 120 || dia >= 80) return 75
  if (sys < 85  || dia < 55)  return 60  // hypotension
  return 100
}

// The four Digital Twin layers (CLAUDE.md §34). Deliberately NOT the five health_events
// categories — those are all wearable-derived and know nothing about Kino or the profile,
// so they can't back a twin-completeness view on their own.
const TWIN_LAYER_KEYS = ['precision', 'daily', 'medical', 'profile']


function _buildRingDisplayData(raw, isZh) {
  const syncLabel = isZh ? `已同步 ${_shanghaiTimeStr(raw.syncedAt)}` : `Synced ${_shanghaiTimeStr(raw.syncedAt)}`

  let sleepStr = null, sleepDeepPct = 0, sleepLightPct = 0, sleepRemPct = 0, sleepAwakePct = 0
  if (raw.sleepMinutes != null && raw.sleepMinutes > 0) {
    const h = Math.floor(raw.sleepMinutes / 60)
    const m = raw.sleepMinutes % 60
    sleepStr = isZh ? `${h}时${m}分` : `${h}h ${m}m`
    const total = raw.sleepMinutes
    sleepDeepPct  = Math.round((raw.sleepDeep  || 0) / total * 100)
    sleepRemPct   = Math.round((raw.sleepRem   || 0) / total * 100)
    sleepLightPct = Math.round((raw.sleepLight || 0) / total * 100)
    sleepAwakePct = Math.max(0, 100 - sleepDeepPct - sleepRemPct - sleepLightPct)
  }

  let stepsStr = null, stepsPct = 0
  if (raw.steps != null) {
    const s = raw.steps
    stepsStr = s >= 10000 ? `${(s / 1000).toFixed(1)}k`
      : s >= 1000 ? `${Math.floor(s / 1000)},${String(s % 1000).padStart(3, '0')}`
      : String(s)
    stepsPct = Math.min(100, Math.round(s / 10000 * 100))
  }

  // HRV color by quality zone (ms)
  let hrvColor = '#A6C4E5'
  if (raw.hrv != null) {
    if (raw.hrv >= 80)      hrvColor = '#0ea5e9'
    else if (raw.hrv >= 50) hrvColor = '#10b981'
    else if (raw.hrv >= 30) hrvColor = '#f97316'
    else                    hrvColor = '#ef4444'
  }
  const hrvPct = raw.hrv != null ? Math.min(100, Math.max(2, Math.round((raw.hrv - 20) / 80 * 100))) : 0

  // Stress color + label (0-100 scale)
  let stressLabel = null, stressColor = '#A6C4E5'
  if (raw.stress != null) {
    const levels = isZh
      ? ['放松', '正常', '中等', '偏高']
      : ['Relaxed', 'Normal', 'Moderate', 'High']
    const colors = ['#10b981', '#6375EC', '#f97316', '#ef4444']
    const idx = raw.stress <= 25 ? 0 : raw.stress <= 50 ? 1 : raw.stress <= 75 ? 2 : 3
    stressLabel = levels[idx]
    stressColor = colors[idx]
  }

  // SpO2 color
  let spo2Color = '#A6C4E5'
  if (raw.spo2 != null) {
    spo2Color = raw.spo2 >= 98 ? '#0ea5e9' : raw.spo2 >= 95 ? '#10b981' : raw.spo2 >= 90 ? '#f97316' : '#ef4444'
  }
  const spo2Pct = raw.spo2 != null ? Math.min(100, Math.max(2, Math.round((raw.spo2 - 90) / 10 * 100))) : 0

  // Blood pressure (Halo HRV measurement) + breath rate
  let bpStr = null, bpColor = '#A6C4E5'
  if (raw.systolicBP != null && raw.diastolicBP != null) {
    bpStr = `${raw.systolicBP}/${raw.diastolicBP}`
    bpColor = raw.systolicBP >= 140 ? '#ef4444' : raw.systolicBP >= 130 ? '#f97316' : raw.systolicBP >= 120 ? '#f97316' : '#10b981'
  }
  const breathRateStr = raw.breathRate != null ? String(raw.breathRate) : null

  // ── Body temperature ──
  let tempColor = '#A6C4E5', tempPct = 0
  if (raw.bodyTempC != null) {
    tempColor = raw.bodyTempC >= 38 ? '#ef4444' : raw.bodyTempC >= 37.2 ? '#f97316' : '#10b981'
    tempPct   = Math.min(100, Math.max(2, Math.round((raw.bodyTempC - 35.5) / 3 * 100)))
  }

  // ── Slot charts ──
  const CHART_H = 72  // rpx height of bar chart area

  // Steps: aggregate 15-min slots → 24 hourly bars
  let stepsBars = null
  if (raw.stepSlots && raw.stepSlots.length > 0) {
    const hrSteps = new Array(24).fill(0)
    for (const s of raw.stepSlots) {
      hrSteps[_shanghaiHour(s.t)] += s.steps
    }
    const maxS = Math.max(...hrSteps, 1)
    stepsBars = hrSteps.map((steps, h) => ({
      h: h % 6 === 0 ? String(h) : '',
      heightRpx: Math.round(steps / maxS * CHART_H),
      active: steps > 0,
    }))
  }

  // HR: aggregate 5-min slots → 24 hourly avg bars
  let hrBars = null
  if (raw.hrSlots && raw.hrSlots.length > 0) {
    const hrMap = {}
    for (const r of raw.hrSlots) {
      const h = _shanghaiHour(r.t)
      if (!hrMap[h]) hrMap[h] = []
      hrMap[h].push(r.bpm)
    }
    hrBars = new Array(24).fill(0).map((_, h) => {
      const arr = hrMap[h]
      if (!arr) return { h: h % 6 === 0 ? String(h) : '', heightRpx: 3, color: 'rgba(99,117,236,0.08)', bpm: 0 }
      const bpm = Math.round(arr.reduce((a, b) => a + b, 0) / arr.length)
      const color = bpm < 60 ? '#0ea5e9' : bpm < 75 ? '#10b981' : bpm < 90 ? '#f97316' : '#ef4444'
      const heightRpx = Math.round(Math.max(6, Math.min(CHART_H, (bpm - 40) / 80 * CHART_H)))
      return { h: h % 6 === 0 ? String(h) : '', heightRpx, color, bpm }
    })
  }

  // Sleep: consecutive stage segments as % widths
  let sleepSegs = null, sleepTimeRange = null
  if (raw.sleepSlots && raw.sleepSlots.length > 0) {
    const totalMin = raw.sleepSlots.reduce((s, p) => s + p.min, 0)
    const segColors = { deep: '#6375EC', rem: '#a855f7', light: '#0ea5e9', awake: 'rgba(166,196,229,0.18)' }
    sleepSegs = raw.sleepSlots.map(p => ({
      widthPct: Math.round(p.min / totalMin * 100),
      color: segColors[p.type] || '#6375EC',
    }))
    if (raw.sleepStart != null && raw.sleepEnd != null) {
      const fmtMins = (m) => { const a = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}` }
      sleepTimeRange = `${fmtMins(raw.sleepStart)} → ${fmtMins(raw.sleepEnd)}`
    }
  }

  // HRV daily trend bars (last 7 days)
  let hrvDayBars = null
  if (raw.hrvSlots?.length > 0) {
    const byDay = {}
    for (const s of raw.hrvSlots) {
      const d = s.timestamp.substring(0, 10)
      if (!byDay[d]) byDay[d] = []
      if (s.hrv != null) byDay[d].push(s.hrv)
    }
    const days = Object.keys(byDay).sort().slice(-7)
    const avgs = days.map(d => byDay[d].length ? Math.round(byDay[d].reduce((a, b) => a + b, 0) / byDay[d].length) : 0)
    const maxHrv = Math.max(...avgs, 1)
    hrvDayBars = days.map((d, i) => ({
      label: d.slice(5).replace('-', '/'),
      heightRpx: Math.round(Math.max(4, avgs[i] / maxHrv * CHART_H)),
      color: avgs[i] >= 80 ? '#0ea5e9' : avgs[i] >= 50 ? '#10b981' : avgs[i] >= 30 ? '#f97316' : '#ef4444',
      avg: avgs[i],
    }))
  }

  // SpO₂ daily trend bars (last 7 days)
  let spo2DayBars = null
  if (raw.spo2Slots?.length > 0) {
    const byDay = {}
    for (const s of raw.spo2Slots) {
      const d = s.timestamp.substring(0, 10)
      if (!byDay[d]) byDay[d] = []
      if (s.spo2 != null) byDay[d].push(s.spo2)
    }
    const days = Object.keys(byDay).sort().slice(-7)
    const avgs = days.map(d => byDay[d].length ? Math.round(byDay[d].reduce((a, b) => a + b, 0) / byDay[d].length * 10) / 10 : 0)
    const minSpo2 = 90, maxSpo2 = 100
    spo2DayBars = days.map((d, i) => ({
      label: d.slice(5).replace('-', '/'),
      heightRpx: Math.round(Math.max(4, (avgs[i] - minSpo2) / (maxSpo2 - minSpo2) * CHART_H)),
      color: avgs[i] >= 98 ? '#0ea5e9' : avgs[i] >= 95 ? '#10b981' : avgs[i] >= 90 ? '#f97316' : '#ef4444',
      avg: avgs[i],
    }))
  }

  // Weekly sleep timeline: every discrete block (naps kept separate from night
  // sleep, and a night interrupted by a long wake-up kept as separate segments)
  // positioned on a noon→noon 24h axis, up to the last 7 nights.
  const SLEEP_AXIS_H = 480 // rpx — represents the full 24h noon-to-noon window
  let sleepWeek = null
  if (raw.sleepHistory?.length > 0) {
    const byDate = {}
    for (const s of raw.sleepHistory) {
      if (!s.totalMinutes || !s.onset) continue
      ;(byDate[s.date] = byDate[s.date] || []).push(s)
    }
    const dates = Object.keys(byDate).sort().slice(-7)
    if (dates.length > 0) {
      sleepWeek = dates.map(date => {
        const sessions = byDate[date].slice().sort((a, b) => (a.onset < b.onset ? -1 : 1))
        const nightMins = sessions.filter(s => _isNightSession(s.onset)).reduce((sum, s) => sum + s.totalMinutes, 0)
        const napMins = sessions.filter(s => !_isNightSession(s.onset)).reduce((sum, s) => sum + s.totalMinutes, 0)
        // Color reflects the day's combined sleep total, not each segment's own
        // duration — a night interrupted into several short segments (or one that
        // resumes after 6am and gets bucketed as a "nap" by the hour heuristic,
        // see _selectLastNight's comment) previously colored red/orange per-piece
        // even when the day's actual total sleep was good.
        const dayColor = _dayQualityColor(nightMins + napMins)
        const blocks = sessions.map((s, i) => {
          const mins = _minutesSinceNoon(s.onset)
          return {
            key: `${date}-${i}`,
            topRpx: Math.round(mins / 1440 * SLEEP_AXIS_H),
            heightRpx: Math.max(6, Math.round(s.totalMinutes / 1440 * SLEEP_AXIS_H)),
            color: dayColor,
            isNap: !_isNightSession(s.onset),
            timeLabel: s.onset.slice(11, 16),
            durLabel: _fmtHM(s.totalMinutes, isZh),
          }
        })
        return {
          date,
          label: date.slice(5).replace('-', '/'),
          totalLabel: (nightMins + napMins) > 0 ? _fmtHM(nightMins + napMins, isZh) : '—',
          hasNap: napMins > 0,
          blocks,
        }
      })
    }
  }

  const sleepDateLabel = raw.sleepDate ? raw.sleepDate.slice(5).replace('-', '/') : null

  return {
    ...raw,
    sleepStr, sleepDeepPct, sleepLightPct, sleepRemPct, sleepAwakePct,
    stepsStr, stepsPct,
    syncLabel,
    hasSteps:      raw.steps        != null,
    hasSleep:      raw.sleepMinutes != null && raw.sleepMinutes > 0,
    hasHr:         raw.restingHr    != null,
    hasHrv:        raw.hrv          != null,
    hasStress:     raw.stress       != null,
    hasSpo2:       raw.spo2         != null,
    hasBp:         raw.systolicBP   != null && raw.diastolicBP != null,
    hasBreathRate: raw.breathRate   != null,
    hasBodyTemp:   raw.bodyTempC    != null,
    hrvColor, hrvPct,
    stressLabel, stressColor,
    spo2Color, spo2Pct,
    bpStr, bpColor, breathRateStr,
    stepsBars, hrBars, sleepSegs, sleepTimeRange, sleepDateLabel,
    hrvDayBars, spo2DayBars, sleepWeek,
    sleepAxisHeightRpx: SLEEP_AXIS_H,
    bodyTempC: raw.bodyTempC != null ? raw.bodyTempC.toFixed(1) : null,
    tempPct, tempColor,
    hasSlotCharts: !!(stepsBars || hrBars || sleepSegs || hrvDayBars || spo2DayBars || sleepWeek),
  }
}

const _CST_MS = 8 * 60 * 60 * 1000

function _shanghaiDateStr(ts) {
  const d = new Date((ts || Date.now()) + _CST_MS)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

// Converts any timestamp (Unix ms or ISO string) to Shanghai (UTC+8) HH:MM string
function _shanghaiTimeStr(t) {
  const d = new Date(new Date(t).getTime() + _CST_MS)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

// Returns the Shanghai (UTC+8) hour (0–23) from any timestamp or ISO string
function _shanghaiHour(t) {
  return new Date(new Date(t).getTime() + _CST_MS).getUTCHours()
}


// Merge Halo HRV+SpO2 slot arrays into the same reading shape _fmtRealtimeReadings expects.
// Ring timestamps ('2026-06-20 14:30:12') are CST, so append +08:00 before parsing.
function _slotsToReadings(hrvSlots, spo2Slots) {
  const byTs = {}
  for (const s of (spo2Slots || [])) {
    byTs[s.timestamp] = byTs[s.timestamp] || {}
    byTs[s.timestamp].spo2 = s.spo2
  }
  for (const s of (hrvSlots || [])) {
    byTs[s.timestamp] = byTs[s.timestamp] || {}
    Object.assign(byTs[s.timestamp], {
      hrv: s.hrv ?? null, stress: s.stress ?? null,
      breathRate: s.breath ?? null,
      systolicBP: s.highBP ?? null, diastolicBP: s.lowBP ?? null,
    })
  }
  return Object.keys(byTs).sort().reverse().map(ts => ({
    t: new Date(ts.replace(' ', 'T') + '+08:00').getTime(),
    ...byTs[ts],
  }))
}

// --- Incremental Halo/V8 sync: cursor derivation + merge (see
// docs/architecture/halo-smart-ring.md §9) ---
//
// The ring's own history commands support "since date" (protocol mode
// 0x01), but handleSyncWearable() otherwise re-fetches full history every
// sync. Rather than a dedicated "last sync" storage key, each type's cursor
// is derived from the max key field already present in the previously
// stored `wearable_ring_data` slot array — its lifecycle then automatically
// matches the data's own (cleared on unbind, advanced only on a successful
// commit), instead of needing separate upkeep.
//
// IMPORTANT — confirmed live against a real V8 band 2026-07-30 (see
// docs/architecture/v8-smart-band.md): mode 0x01 requires the `since` date
// to EXACTLY match one of the device's own stored record timestamps
// (inclusive — that exact record is included in the result). Any other
// value, even one second off, makes the device silently fall back to
// returning its FULL history instead of an empty/partial result. There is
// no safety margin here — subtracting any offset from the last-known
// timestamp would almost always miss the exact match and defeat the whole
// optimization. The cursor must be exactly the last-known timestamp, which
// is safe to reuse as-is (it's a real value the ring itself produced, not
// an independently-derived "now" subject to clock drift), and the inclusive
// boundary means it always returns at least that one (harmless, deduped by
// the merge step) record plus anything genuinely new.
const RING_CURSOR_STALE_MS = 4 * 24 * 60 * 60 * 1000  // heuristic only (see _deriveSinceDate) — not a correctness bound
const RING_SLOT_RETENTION_DAYS = 7                // local retention window after merging

// Returns the max `keyField` value across `slots` as a comparable string, or
// null if empty. `keyField` values are Date objects (hrSlots.t is an ISO
// string; hrLog's raw timestamp is a Date — normalized to ISO by the caller
// before storage) or "YYYY-MM-DD HH:MM:SS" strings, both lexicographically sortable.
function _lastSlotTimestamp(slots, keyField) {
  if (!slots || !slots.length) return null
  let max = null
  for (const s of slots) {
    const v = s[keyField]
    if (v != null && (max === null || v > max)) max = v
  }
  return max
}

// Derives a `sinceDate` (Date|null) to request incrementally from the ring,
// given the previous sync's slot array — exactly the last-known timestamp,
// no margin (see the block comment above for why). Returns null (→ full
// mode-0x00 fetch) when there's no previous data. RING_CURSOR_STALE_MS is
// purely a "don't bother attempting" heuristic to skip a fetch that's likely
// past the ring's actual retention and would just fall back to full history
// anyway (per the same confirmed behavior) — not a correctness requirement,
// since an exact-but-purged timestamp degrades gracefully to that same
// full-history fallback rather than losing or corrupting data.
function _deriveSinceDate(prevSlots, keyField) {
  const lastTs = _lastSlotTimestamp(prevSlots, keyField)
  if (!lastTs) return null
  const lastMs = new Date(String(lastTs).replace(' ', 'T') + (String(lastTs).includes('T') ? '' : '+08:00')).getTime()
  if (!lastMs || Date.now() - lastMs > RING_CURSOR_STALE_MS) return null
  return new Date(lastMs)
}

// Upserts `newSlots` over `prevSlots` keyed by `keyField` (new wins on
// collision), sorted ascending, trimmed to `retentionDays`. Runs even when
// `newSlots` is empty (incremental fetch found nothing new, or the fetch
// failed) — in that case this returns `prevSlots` trimmed, which is what
// keeps a single failed/empty per-type fetch from wiping out the
// previously-synced data that _commitRingData would otherwise overwrite.
function _mergeRingSlots(prevSlots, newSlots, keyField, retentionDays) {
  const byKey = new Map()
  for (const s of (prevSlots || [])) byKey.set(s[keyField], s)
  for (const s of (newSlots || [])) byKey.set(s[keyField], s)
  const merged = Array.from(byKey.values()).sort((a, b) => (a[keyField] < b[keyField] ? -1 : a[keyField] > b[keyField] ? 1 : 0))
  if (!retentionDays || !merged.length) return merged
  const cutoffStr = _shanghaiDateStr(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
  return merged.filter(s => String(s[keyField]) >= cutoffStr)
}

function _fmtRealtimeReadings(readings) {
  const todayStr = _shanghaiDateStr(Date.now())
  const yesterStr = _shanghaiDateStr(Date.now() - 86400000)
  const sectionMap = {}
  const sectionOrder = []
  for (const r of readings) {
    const dateStr = _shanghaiDateStr(r.t)
    const sectionLabel = dateStr === todayStr ? '今天' : dateStr === yesterStr ? '昨天' : dateStr.slice(5).replace('-', '/')
    if (!sectionMap[dateStr]) {
      sectionMap[dateStr] = { dateLabel: sectionLabel, readings: [] }
      sectionOrder.push(dateStr)
    }
    const time = _shanghaiTimeStr(r.t)
    const hrvColor    = r.hrv    == null ? null : r.hrv >= 80 ? '#0ea5e9' : r.hrv >= 50 ? '#10b981' : r.hrv >= 30 ? '#f97316' : '#ef4444'
    const spo2Color   = r.spo2   == null ? null : r.spo2 >= 98 ? '#0ea5e9' : r.spo2 >= 95 ? '#10b981' : r.spo2 >= 90 ? '#f97316' : '#ef4444'
    const stressColor = r.stress == null ? null : r.stress <= 25 ? '#10b981' : r.stress <= 50 ? '#6375EC' : r.stress <= 75 ? '#f97316' : '#ef4444'
    const bpStr   = r.systolicBP != null && r.diastolicBP != null ? `${r.systolicBP}/${r.diastolicBP}` : null
    const bpColor = r.systolicBP == null ? null : r.systolicBP >= 140 ? '#ef4444' : r.systolicBP >= 130 ? '#f97316' : r.systolicBP >= 120 ? '#f97316' : '#10b981'
    sectionMap[dateStr].readings.push({ time, hrv: r.hrv, stress: r.stress, spo2: r.spo2, hrvColor, spo2Color, stressColor, bpStr, bpColor, breathRate: r.breathRate ?? null })
  }
  return sectionOrder.map(d => sectionMap[d])
}

// Bounds/MAD-multiplier per metric for signal-smoothing.flagOutliers — see
// utils/wearable/signal-smoothing.js and docs on _buildReadingLineCharts.
const _SMOOTHING_CONFIG = {
  hrv:    { min: 2,  max: 220, k: 2.5, window: 7, epsilon: 2 },
  spo2:   { min: 70, max: 100, k: 2.5, window: 7, epsilon: 0.8 },
  stress: { min: 0,  max: 100, k: 2.5, window: 7, epsilon: 3 },
}

function _buildReadingLineCharts(readings) {
  const pts = readings.slice().reverse()  // oldest → newest

  function _extract(key) { return pts.filter(r => r[key] != null).map(r => r[key]) }
  function _hrvColor(v)    { return v >= 80 ? '#0ea5e9' : v >= 50 ? '#10b981' : v >= 30 ? '#f97316' : '#ef4444' }
  function _spo2Color(v)   { return v >= 98 ? '#0ea5e9' : v >= 95 ? '#10b981' : v >= 90 ? '#f97316' : '#ef4444' }
  function _stressColor(v) { return v <= 25 ? '#10b981' : v <= 50 ? '#6375EC' : v <= 75 ? '#f97316' : '#ef4444' }

  // Detects likely sensor errors (ring off-wrist, poor contact, byte glitch)
  // and replaces them with an interpolated estimate for chart display only —
  // raw vals/readings are untouched, this never feeds back into stored data.
  function _smooth(vals, metricKey) {
    const flags = flagOutliers(vals, _SMOOTHING_CONFIG[metricKey])
    const corrected = interpolateFlagged(vals, flags)
    const validCount = flags.filter(f => !f).length
    return { corrected, validCount }
  }

  const CHART_H = 72, MAX_BARS = 48

  function _toBars(corrected, colorFn) {
    if (corrected.length < 2) return null
    const N = Math.min(corrected.length, MAX_BARS)
    const binned = []
    for (let i = 0; i < N; i++) {
      const s = Math.floor(i / N * corrected.length)
      const e = Math.floor((i + 1) / N * corrected.length)
      const slice = corrected.slice(s, e)
      binned.push({
        value: slice.reduce((a, b) => a + b.value, 0) / slice.length,
        estimated: slice.some(b => b.estimated),
      })
    }
    const min = Math.min(...binned.map(b => b.value)), max = Math.max(...binned.map(b => b.value))
    const range = max - min || 1
    return binned.map(b => ({
      heightRpx: Math.round(Math.max(4, (b.value - min) / range * CHART_H)),
      color: colorFn(b.value),
      estimated: b.estimated,
    }))
  }

  function _chart(vals, colorFn, metricKey) {
    const { corrected, validCount } = _smooth(vals, metricKey)
    const correctedVals = corrected.map(c => c.value)
    const latestRaw = vals.length ? vals[vals.length - 1] : null
    const latestEntry = corrected.length ? corrected[corrected.length - 1] : null
    const estimatedCount = corrected.filter(c => c.estimated).length
    return {
      hasData:         validCount >= 2,
      bars:            _toBars(corrected, colorFn),
      latestVal:       latestRaw,
      latestColor:     latestRaw != null ? colorFn(latestRaw) : 'rgba(166,196,229,0.5)',
      latestEstimated: !!(latestEntry && latestEntry.estimated),
      minVal:          correctedVals.length ? Math.round(Math.min(...correctedVals) * 10) / 10 : null,
      maxVal:          correctedVals.length ? Math.round(Math.max(...correctedVals) * 10) / 10 : null,
      count:           vals.length,
      estimatedCount,
    }
  }

  return {
    hrvChart:    _chart(_extract('hrv'),    _hrvColor,    'hrv'),
    spo2Chart:   _chart(_extract('spo2'),   _spo2Color,   'spo2'),
    stressChart: _chart(_extract('stress'), _stressColor, 'stress'),
  }
}

function _isPrivacyError(e) {
  const msg = e?.message || e?.errMsg || ''
  return msg.includes('privacy api banned') || msg.includes('privacy')
}

function chronoAge(birthDate) {
  if (!birthDate) return null
  return Math.floor((Date.now() - new Date(birthDate).getTime()) / (1000 * 60 * 60 * 24 * 365.25))
}

function fmtDate(d, lang) {
  if (!d) return '—'
  const date = new Date(d)
  if (isNaN(date.getTime())) return String(d)
  const y = date.getFullYear()
  const m = date.getMonth() + 1
  const day = date.getDate()
  if (lang === 'zh') return `${y}年${m}月${day}日`
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[date.getMonth()]} ${day}, ${y}`
}

function bioAgeColor(bio, chrono) {
  if (!bio || !chrono) return '#A6C4E5'
  return Number(bio) <= Number(chrono) ? '#10b981' : '#ef4444'
}

// ref ranges: [low, high, higherIsBetter]
const BIO_REF = {
  hsCRP:          [null, 1.0,   false],
  IL6:            [null, 3.0,   false],
  GDF15:          [null, 750,   false],
  GA:             [11.0, 15.0,  false],
  CystatinC:      [0.51, 0.95,  false],
  HbA1c:          [null, 5.7,   false],
  FPG:            [3.9,  6.1,   false],
  Triglycerides:  [null, 1.7,   false],
  ALT:            [null, 40,    false],
  AST:            [null, 40,    false],
  GGT:            [null, 50,    false],
  TSH:            [0.35, 4.5,   false],
  TotalCholesterol:[null, 5.2,  false],
  LDL:            [null, 3.4,   false],
  HDL:            [1.0,  null,  true ],
  Creatinine:     [53,   115,   false],
  eGFR:           [90,   null,  true ],
  BUN:            [1.7,  8.3,   false],
  UricAcid:       [null, 416,   false],
  CRP:            [null, 10,    false],
  VitaminD:       [50,   150,   false],
  WBC:            [4.0,  10.0,  false],
  Ferritin:       [13,   150,   false],
  Hemoglobin:     [115,  175,   false],
}

const REF_DISPLAY = {
  hsCRP: '< 1.0 mg/L', IL6: '< 3.0 pg/mL', GDF15: '< 750 pg/mL',
  GA: '11–15 %', CystatinC: '0.51–0.95 mg/L', HbA1c: '< 5.7 %',
  FPG: '3.9–6.1 mmol/L', Triglycerides: '< 1.7 mmol/L',
  ALT: '< 40 U/L', AST: '< 40 U/L', GGT: '< 50 U/L',
  TSH: '0.35–4.5 mIU/L', TotalCholesterol: '< 5.2 mmol/L',
  LDL: '< 3.4 mmol/L', HDL: '> 1.0 mmol/L',
  Creatinine: '53–115 μmol/L', eGFR: '> 90', BUN: '1.7–8.3 mmol/L',
  UricAcid: '< 416 μmol/L', CRP: '< 10 mg/L', VitaminD: '50–150 nmol/L',
  WBC: '4–10 ×10⁹/L', Ferritin: '13–150 μg/L', Hemoglobin: '115–175 g/L',
}

function _bioStatus(keyName, value) {
  if (value == null || !keyName) return 'normal'
  const ref = BIO_REF[keyName]
  if (!ref) return 'normal'
  const [lo, hi, higherBetter] = ref
  const v = parseFloat(value)
  if (higherBetter) {
    if (lo != null && v < lo) return 'low'
    return 'normal'
  }
  if (hi != null && v > hi) return 'high'
  if (lo != null && v < lo) return 'low'
  return 'normal'
}

function _refText(keyName) {
  return REF_DISPLAY[keyName] || ''
}

// Maps legacy (US-unit, snake_case) lab keys → catalog key_name for status lookup
const LEGACY_KEY_MAP = {
  ldl: 'LDL', hdl: 'HDL', alt: 'ALT', ast: 'AST', tsh: 'TSH',
  hba1c: 'HbA1c', ferritin: 'Ferritin', uric_acid: 'UricAcid',
  vitamin_d: 'VitaminD', creatinine: 'Creatinine',
  triglycerides: 'Triglycerides', glucose_fasting: 'FPG',
  total_cholesterol: 'TotalCholesterol', hsCRP: 'hsCRP', il6: 'IL6',
}

// Display label overrides for compact rendering
const LAB_DISPLAY_NAME = {
  TotalCholesterol: 'Chol', MicroVascularAge: 'µVasc',
  total_cholesterol: 'Chol', uric_acid: 'UA', glucose_fasting: 'Gluc',
  vitamin_d: 'VitD', vitamin_b12: 'B12',
}

// Status from the SERVER's ranges when a marker carries them (every per-marker value does since
// 2026-09-15), else the client table — which only ever covered the original 25 keys. Kept as the
// fallback for the legacy `results` shape and for a twin written before the ranges shipped.
function _statusFor(key, v, info) {
  if (v == null || Number.isNaN(v)) return 'normal'
  const lo = info && info.ref_low != null ? Number(info.ref_low) : null
  const hi = info && info.ref_high != null ? Number(info.ref_high) : null
  if (lo != null || hi != null) {
    if (hi != null && v > hi) return 'high'
    if (lo != null && v < lo) return 'low'
    return 'normal'
  }
  return _bioStatus(key, v)
}

function _refTextFor(key, info, unit) {
  const lo = info && info.ref_low != null ? Number(info.ref_low) : null
  const hi = info && info.ref_high != null ? Number(info.ref_high) : null
  if (lo != null && hi != null) return `${lo}–${hi} ${unit || ''}`.trim()
  if (hi != null) return `< ${hi} ${unit || ''}`.trim()
  if (lo != null) return `> ${lo} ${unit || ''}`.trim()
  return _refText(key)
}

// The panel is the latest value PER MARKER across every lab report (lib/labHistory.js), each
// marker with its own date; the header says how many reports it spans. `series` (from
// /api/lab-history?series=1) marks which tiles have more than one point to chart.
function _buildLabPanel(twin, lang, series) {
  const labData = twin.latest_lab_data
  const labDate = twin.latest_lab_date
  if (!labData || !labDate) return { labPanel: [], labPanelDate: '', labPanelAbnormal: 0, labPanelMeta: '' }
  const isZh = (lang || 'zh') !== 'en'
  const t = T[isZh ? 'zh' : 'en']

  const panelDate = String(labDate).substring(0, 10)
  const labPanelDate = fmtDate(labDate, lang || 'zh')
  const items = []
  const pointsOf = key => ((series || {})[key] || {}).points || []

  if (labData.markers) {
    // { markers: { LDL: { value, unit, data_date?, display_name_zh?, ref_low?, ref_high?, category? } } }
    for (const [key, info] of Object.entries(labData.markers)) {
      const v = parseFloat(info.value)
      const status = _statusFor(key, v, info)
      const statusColor = status === 'high' ? '#ef4444' : status === 'low' ? '#60a5fa' : '#10b981'
      const date = info.data_date ? String(info.data_date).substring(0, 10) : panelDate
      const displayName = isZh
        ? (info.display_name_zh || LAB_DISPLAY_NAME[key] || key)
        : (LAB_DISPLAY_NAME[key] || info.display_name || key)
      items.push({
        key, displayName, value: String(v), unit: info.unit || '', status, statusColor,
        category: info.category || '',
        date,
        dateShort: date !== panelDate ? date.substring(5) : '',
        hasTrend: pointsOf(key).length > 1,
      })
    }
  } else if (labData.results) {
    // Legacy format: { results: { ldl: { value, unit, ref_high, ref_low }, ... } }
    for (const [legacyKey, info] of Object.entries(labData.results)) {
      const catalogKey = LEGACY_KEY_MAP[legacyKey] || legacyKey
      const v = parseFloat(info.value)
      let status = 'normal'
      if (info.ref_high != null && v > info.ref_high) status = 'high'
      else if (info.ref_low != null && v < info.ref_low) status = 'low'
      const statusColor = status === 'high' ? '#ef4444' : status === 'low' ? '#60a5fa' : '#10b981'
      const displayName = LAB_DISPLAY_NAME[legacyKey] || legacyKey.replace(/_/g, ' ')
      items.push({ key: catalogKey, displayName, value: String(v), unit: info.unit || '', status, statusColor,
        category: '', date: panelDate, dateShort: '', hasTrend: pointsOf(catalogKey).length > 1 })
    }
  }

  // Abnormal first, then by category so a CBC block reads together, then by key.
  items.sort((a, b) => {
    const aAbn = a.status !== 'normal' ? 0 : 1
    const bAbn = b.status !== 'normal' ? 0 : 1
    if (aAbn !== bAbn) return aAbn - bAbn
    if (a.category !== b.category) return a.category.localeCompare(b.category)
    return a.key.localeCompare(b.key)
  })

  const labPanelAbnormal = items.filter(i => i.status !== 'normal').length
  const dates = Array.isArray(labData.dates) && labData.dates.length
    ? labData.dates
    : [...new Set(items.map(i => i.date))]
  const labPanelMeta = t.labPanelMeta
    .replace('{d}', labPanelDate).replace('{n}', String(items.length)).replace('{m}', String(dates.length))
  return { labPanel: items, labPanelDate, labPanelAbnormal, labPanelMeta }
}

// Medical Records layer — one accent per food-sensitivity class. Class 0 never renders (it is
// not a restriction), so the map starts at 1.
function _foodClassColor(cls) {
  switch (cls) {
    case 3:  return '#ef4444'
    case 2:  return '#f97316'
    case 1:  return '#eab308'
    default: return 'rgba(166,196,229,0.55)'
  }
}

// Personal Profile layer — one accent per user_memory_facts category.
function _factCategoryColor(cat) {
  switch (cat) {
    case 'allergy':             return '#ef4444'
    case 'dietary_restriction': return '#f97316'
    case 'preference':          return '#6375EC'
    case 'goal':                return '#10b981'
    default:                    return 'rgba(166,196,229,0.55)'
  }
}

function _reportTypeColor(type) {
  if (type === 'annual_checkup') return '#a855f7'
  if (type === 'lab_panel')      return '#0ea5e9'
  if (type === 'imaging')        return '#14b8a6'
  if (type === 'functional')     return '#f59e0b'
  if (type === 'genetic')        return '#ec4899'
  if (type === 'microbiome')     return '#84cc16'
  return '#6375EC'
}

// "6.9 MB" / "820 KB" for the 综合报告 card meta line.
function _sizeLabel(bytes) {
  const n = Number(bytes) || 0
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  if (n >= 1024) return `${Math.round(n / 1024)} KB`
  return `${n} B`
}

export {
  BM_META, SUB_AGE_META, SUB_AGE_KEYS, USER_UPLOADED_BP_SOURCES, buildSubAgeLabels, CONDITION_KEYS, _scoreSleep, _normalizeBrand, _hasIntervalSettings, _isNightSession, _minutesSinceNoon, _mergeNightSessions, _selectLastNight, _dayQualityColor, _fmtHM, _sessionsFromEventData, _scoreHrv, _scoreRestHr, _scoreSpo2, _scoreSteps, _scoreBmi, _scoreBp, TWIN_LAYER_KEYS, _buildRingDisplayData, _CST_MS, _shanghaiDateStr, _shanghaiTimeStr, _shanghaiHour, _slotsToReadings, RING_CURSOR_STALE_MS, RING_SLOT_RETENTION_DAYS, _lastSlotTimestamp, _deriveSinceDate, _mergeRingSlots, _fmtRealtimeReadings, _SMOOTHING_CONFIG, _buildReadingLineCharts, _isPrivacyError, chronoAge, fmtDate, bioAgeColor, BIO_REF, REF_DISPLAY, _bioStatus, _refText, LEGACY_KEY_MAP, LAB_DISPLAY_NAME, _statusFor, _refTextFor, _buildLabPanel, _foodClassColor, _factCategoryColor, _reportTypeColor, _sizeLabel,
};
