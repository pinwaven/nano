// Maps live wearable readings to one of the 4 pregenerated avatar moods.
const { MOODS, AVATAR_GALLERY } = require('./avatar-gallery.js')

const DEFAULT_MOOD = 'relaxed'

// `raw` is the same raw ring-data shape user-health.js already builds from a
// synced wearable (stress 0-100, sleepMinutes, hrv ms, steps). No wearable
// attached / nothing synced yet → always the relaxed default.
function computeMood(raw) {
  if (!raw) return DEFAULT_MOOD
  if (raw.stress != null && raw.stress > 60) return 'stressed'
  const sleepHours = raw.sleepMinutes != null ? raw.sleepMinutes / 60 : null
  const wellRested = sleepHours != null && sleepHours >= 6.5 && (raw.hrv == null || raw.hrv >= 50)
  if (wellRested) return 'restored'
  if (raw.steps != null && raw.steps >= 6000) return 'engaged'
  return DEFAULT_MOOD
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
