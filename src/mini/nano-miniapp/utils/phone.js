// Masks a phone number for display only (e.g. logged-out screen). Never used
// to reconstruct or transmit the real number — just a "is this me?" hint.
function maskPhone(phone) {
  if (!phone) return ''
  const digits = String(phone).replace(/^\+86/, '')
  if (digits.length < 7) return digits
  return `${digits.slice(0, 3)}****${digits.slice(-4)}`
}

// Same idea for an email login identity: keeps the first two characters of the local
// part and the whole domain (ab***@example.com), which is enough to recognise "mine".
function maskEmail(email) {
  if (!email) return ''
  const s = String(email)
  const at = s.indexOf('@')
  if (at <= 0) return s
  const local = s.slice(0, at)
  const domain = s.slice(at)
  return `${local.slice(0, Math.min(2, local.length))}***${domain}`
}

module.exports = { maskPhone, maskEmail }
