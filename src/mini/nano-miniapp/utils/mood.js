// Maps live wearable readings to one of the 4 pregenerated avatar moods.
const { MOODS, AVATAR_GALLERY } = require('./avatar-gallery.js')

const DEFAULT_MOOD = 'relaxed'
const RELAXED_BASELINE = 45

// Curve helpers below mirror the equivalent normalizers in
// components/user-health/user-health.js (kept private/duplicated here per
// design decision — mood.js stays a self-contained utility). If those
// curves are retuned, update these to match.

// mirrors user-health.js:168 _scoreHrv
function _scoreHrv(ms) {
  if (ms >= 80) return 100
  if (ms >= 50) return 75 + (ms - 50) / 30 * 25
  if (ms >= 30) return 45 + (ms - 30) / 20 * 30
  return Math.max(10, ms / 30 * 45)
}

// mirrors user-health.js:174 _scoreRestHr
function _scoreRestHr(bpm) {
  if (bpm <= 52) return 100
  if (bpm <= 65) return 100 - (bpm - 52) / 13 * 20
  if (bpm <= 75) return 80 - (bpm - 65) / 10 * 20
  if (bpm <= 90) return 60 - (bpm - 75) / 15 * 30
  return Math.max(5, 30 - (bpm - 90) / 30 * 25)
}

// mirrors user-health.js:181 _scoreSpo2
function _scoreSpo2(pct) {
  if (pct >= 98) return 100
  if (pct >= 95) return 70 + (pct - 95) / 3 * 30
  return Math.max(10, 30 + (pct - 90) / 5 * 40)
}

// mirrors user-health.js:186 _scoreSteps
function _scoreSteps(steps) {
  if (steps >= 10000) return 100
  if (steps >= 7500) return 75 + (steps - 7500) / 2500 * 25
  if (steps >= 5000) return 50 + (steps - 5000) / 2500 * 25
  return Math.max(5, steps / 5000 * 50)
}

// mirrors user-health.js:200 _scoreBp
function _scoreBp(sys, dia) {
  if (sys == null || dia == null) return null
  if (sys >= 140 || dia >= 90) return 20
  if (sys >= 130 || dia >= 85) return 50
  if (sys >= 120 || dia >= 80) return 75
  if (sys < 85 || dia < 55) return 60
  return 100
}

// new curve (no user-health.js equivalent), anchored on the old 6.5h cutoff
function _scoreSleep(hours) {
  if (hours >= 8) return 100
  if (hours >= 6.5) return 70 + (hours - 6.5) / 1.5 * 30
  if (hours >= 5) return 40 + (hours - 5) / 1.5 * 30
  return Math.max(5, hours / 5 * 40)
}

// Weighted average over only the non-null [value, weight] pairs, renormalized
// so missing metrics degrade gracefully instead of requiring ad hoc null checks.
function _weightedAvg(pairs) {
  let sumV = 0, sumW = 0
  for (const [value, weight] of pairs) {
    if (value == null) continue
    sumV += value * weight
    sumW += weight
  }
  return sumW > 0 ? sumV / sumW : 0
}

// `raw` is the same raw ring-data shape user-health.js already builds from a
// synced wearable (stress 0-100, sleepMinutes, hrv ms, steps, restingHr,
// spo2, systolicBP/diastolicBP). No wearable attached / nothing synced yet →
// always the relaxed default.
//
// Three continuous 0-100 evidence axes (Stress / Recovery / Activity) are
// compared against a fixed relaxed baseline instead of an ordered cutoff
// waterfall, so a metric landing one point past an old threshold no longer
// flips the whole result, and a strong signal on one axis no longer
// automatically overrides better evidence on another.
function computeMood(raw) {
  if (!raw) return DEFAULT_MOOD

  const stressAxis = _weightedAvg([
    [raw.stress, 0.60],
    [raw.restingHr != null ? 100 - _scoreRestHr(raw.restingHr) : null, 0.15],
    [raw.hrv != null ? 100 - _scoreHrv(raw.hrv) : null, 0.15],
    [_scoreBp(raw.systolicBP, raw.diastolicBP) != null ? 100 - _scoreBp(raw.systolicBP, raw.diastolicBP) : null, 0.10],
  ])

  const sleepHours = raw.sleepMinutes != null ? raw.sleepMinutes / 60 : null
  const recoveryAxis = _weightedAvg([
    [sleepHours != null ? _scoreSleep(sleepHours) : null, 0.50],
    [raw.hrv != null ? _scoreHrv(raw.hrv) : null, 0.30],
    [raw.restingHr != null ? _scoreRestHr(raw.restingHr) : null, 0.15],
    [raw.spo2 != null ? _scoreSpo2(raw.spo2) : null, 0.05],
  ])

  const activityAxis = _weightedAvg([
    [raw.steps != null ? _scoreSteps(raw.steps) : null, 1.0],
  ])

  const scores = { stressed: stressAxis, restored: recoveryAxis, engaged: activityAxis, relaxed: RELAXED_BASELINE }
  let mood = 'relaxed'
  for (const key of ['stressed', 'restored', 'engaged', 'relaxed']) {
    if (scores[key] > scores[mood]) mood = key
  }
  return mood
}

function findAvatar(avatarId) {
  return AVATAR_GALLERY.find(a => a.id === avatarId) || null
}

function resolveAvatarUrl(avatarId, mood) {
  const avatar = findAvatar(avatarId)
  if (!avatar) return null
  return avatar.moods[mood] || avatar.moods[DEFAULT_MOOD] || null
}

module.exports = { MOODS, AVATAR_GALLERY, DEFAULT_MOOD, computeMood, findAvatar, resolveAvatarUrl }
