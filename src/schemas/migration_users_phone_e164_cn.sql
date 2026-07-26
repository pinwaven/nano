-- Canonicalizes existing bare 11-digit China mobile numbers to E.164 (+86...),
-- matching the format all write paths now use (see lib/phone.js normalizeCnPhone).
-- Safe to re-run: already-prefixed rows no longer match '^1\d{10}$'.
UPDATE users SET phone = '+86' || phone WHERE phone ~ '^1\d{10}$';
