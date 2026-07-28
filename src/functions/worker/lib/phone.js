'use strict';

// Canonicalizes a bare 11-digit China mobile number (no dial code) to E.164
// (+86...) before it touches users.phone. Anything else — already +-prefixed,
// a non-China number, null/undefined — passes through unchanged, so this is
// safe to call on any value without first checking its shape, and idempotent
// to call more than once on the same value.
function normalizeCnPhone(phone) {
    return phone && /^1\d{10}$/.test(phone) ? `+86${phone}` : phone;
}

module.exports = { normalizeCnPhone };
