// Masks a phone number for display only (e.g. logged-out screen). Never used
// to reconstruct or transmit the real number — just a "is this me?" hint.
function maskPhone(phone) {
  if (!phone) return ''
  const digits = String(phone).replace(/^\+86/, '')
  if (digits.length < 7) return digits
  return `${digits.slice(0, 3)}****${digits.slice(-4)}`
}

module.exports = { maskPhone }
