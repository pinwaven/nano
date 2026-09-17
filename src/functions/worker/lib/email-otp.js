'use strict';

// Email OTP lifecycle — generate, store (hashed), rate-limit, verify, consume. This is the
// production path, not a dev bypass: DirectMail (lib/email.js) only delivers, unlike PNVS which
// owns the SMS code end to end. Keyed on the lowercased email in email_otp_codes
// (migration_email_otp_codes.sql).
//
// Limits are per-address only. Handlers never see the client IP (index.js does not extract it),
// so a distributed sender can still burn the DirectMail daily quota — a denial of service on
// the mail budget, not an account-takeover vector, which the attempt cap below closes.

const crypto = require('crypto');
const { pool } = require('./db');
const { generatePhoneOtpCode } = require('./auth');
const { sendEmailOtp } = require('./email');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const EMAIL_MAX_LEN = 254;

const TTL_MINUTES = 5;
const SEND_MIN_INTERVAL_SECONDS = 60;
const SEND_HOURLY_MAX = 5;
const VERIFY_MAX_ATTEMPTS = 5;

function normalizeEmail(raw) {
    return String(raw || '').trim().toLowerCase();
}

function isValidEmail(email) {
    return typeof email === 'string' && email.length <= EMAIL_MAX_LEN && EMAIL_RE.test(email);
}

function hashOTP(code) {
    return crypto.createHash('sha256').update(String(code)).digest('hex');
}

function safeEqualHex(a, b) {
    const ba = Buffer.from(String(a), 'hex');
    const bb = Buffer.from(String(b), 'hex');
    return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// Returns { ok: true } or { ok: false, error: 'rate_limited', retry_after }. The email must
// already be normalized + validated by the caller. Never looks at `users`, so the response
// is identical for a registered and an unknown address (no enumeration through this path).
async function issueEmailOtp(email, purpose = 'login', lang = 'zh') {
    const { rows } = await pool.query(
        `SELECT COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '${SEND_MIN_INTERVAL_SECONDS} seconds')::int AS recent,
                COUNT(*)::int AS hourly,
                MAX(created_at) AS last_at
         FROM email_otp_codes
         WHERE email = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
        [email]
    );
    const { recent, hourly, last_at } = rows[0];
    if (recent > 0) {
        // Clamped both ways: DB and function clocks can disagree by a second or two.
        const elapsed = Math.floor((Date.now() - new Date(last_at).getTime()) / 1000);
        return { ok: false, error: 'rate_limited', retry_after: Math.min(SEND_MIN_INTERVAL_SECONDS, Math.max(1, SEND_MIN_INTERVAL_SECONDS - elapsed)) };
    }
    if (hourly >= SEND_HOURLY_MAX) {
        return { ok: false, error: 'rate_limited', retry_after: 3600 };
    }

    // Only the newest code for an address is live — a resend invalidates the previous one
    // (PNVS's duplicatePolicy: 2 behaviour, which sms.js relies on).
    await pool.query('UPDATE email_otp_codes SET consumed = TRUE WHERE email = $1 AND consumed = FALSE', [email]);

    const code = generatePhoneOtpCode();
    await pool.query(
        `INSERT INTO email_otp_codes (email, code_hash, purpose, expires_at)
         VALUES ($1, $2, $3, NOW() + INTERVAL '${TTL_MINUTES} minutes')`,
        [email, hashOTP(code), purpose]
    );
    await sendEmailOtp(email, code, lang);
    return { ok: true };
}

// Returns { ok: true } or { ok: false, error: 'invalid_code' | 'too_many_attempts' }.
// The live row is locked for the check+update so two parallel guesses cannot both pass.
async function verifyEmailOtp(email, code) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { rows } = await client.query(
            `SELECT id, code_hash, attempts FROM email_otp_codes
             WHERE email = $1 AND consumed = FALSE AND expires_at > NOW()
             ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
            [email]
        );
        if (rows.length === 0) {
            await client.query('COMMIT');
            return { ok: false, error: 'invalid_code' };
        }
        const row = rows[0];
        if (row.attempts >= VERIFY_MAX_ATTEMPTS) {
            await client.query('UPDATE email_otp_codes SET consumed = TRUE WHERE id = $1', [row.id]);
            await client.query('COMMIT');
            return { ok: false, error: 'too_many_attempts' };
        }
        if (!safeEqualHex(hashOTP(code), row.code_hash)) {
            const next = row.attempts + 1;
            await client.query(
                'UPDATE email_otp_codes SET attempts = $2::int, consumed = ($2::int >= $3::int) WHERE id = $1',
                [row.id, next, VERIFY_MAX_ATTEMPTS]
            );
            await client.query('COMMIT');
            return { ok: false, error: next >= VERIFY_MAX_ATTEMPTS ? 'too_many_attempts' : 'invalid_code' };
        }
        await client.query('UPDATE email_otp_codes SET consumed = TRUE WHERE id = $1', [row.id]);
        await client.query('COMMIT');
        return { ok: true };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

module.exports = {
    EMAIL_RE, TTL_MINUTES, SEND_MIN_INTERVAL_SECONDS, SEND_HOURLY_MAX, VERIFY_MAX_ATTEMPTS,
    normalizeEmail, isValidEmail, hashOTP, issueEmailOtp, verifyEmailOtp,
};
