'use strict';

const { pool } = require('../lib/db');
const { generateUserId, generateReferralCode } = require('../lib/auth');
const { sendOTP, verifyOTP } = require('../lib/sms');
const { normalizeCnPhone } = require('../lib/phone');

const PHONE_RE = /^1\d{10}$/;

const USER_SELECT = `
    SELECT u.user_id, u.nickname, u.birth_date, u.gender, u.language, u.phone, u.email,
           u.avatar_url, u.avatar_character, u.coach_id, u.channel_id, u.roles, u.created_at, u.bio_data, u.referral_code,
           u.referred_by_user_id, (u.phone_verified_at IS NOT NULL) AS phone_verified, b.bio_age,
           cu.nickname AS coach_name,
           c.name AS channel_name, c.key_name AS channel_key, effective_channel_logo(c.id) AS channel_logo_url,
           c.config->'sub_age_display_names' AS channel_sub_age_names,
           c.config->>'locale' AS channel_locale
    FROM users u
    LEFT JOIN coaches p ON u.coach_id = p.id
    LEFT JOIN users cu ON p.user_id = cu.user_id
    LEFT JOIN channels c ON u.channel_id = c.id
    LEFT JOIN (
        SELECT DISTINCT ON (user_id) user_id, bio_age
        FROM biomarkers ORDER BY user_id, tested_at DESC
    ) b ON u.user_id = b.user_id`;

function shapeUserRow(row) {
    const { channel_name, channel_key, channel_logo_url, channel_sub_age_names, channel_locale, ...user } = row;
    const channel = channel_name
        ? { name: channel_name, key_name: channel_key, logo_url: channel_logo_url, sub_age_display_names: channel_sub_age_names || null, locale: channel_locale || 'zh' }
        : null;
    return { user, channel };
}

// Joins through user_phones (source of truth for phone -> user_id) rather than
// u.phone directly, so a user can log in with any phone they've attached, not
// just their primary. u.phone stays as a denormalized primary-phone cache read
// by other call sites (gcnClient.js, partners.phone, etc.) — see
// migration_users_phone_verified_multi.sql.
async function findUserByPhone(phone) {
    const { rows } = await pool.query(
        `${USER_SELECT} JOIN user_phones up ON up.user_id = u.user_id WHERE up.phone = $1 LIMIT 1`,
        [phone]
    );
    return rows[0] || null;
}

async function handlePhoneOtpSend(body) {
    try {
        const { phone } = body || {};
        if (!phone || !PHONE_RE.test(phone)) return { success: false, error: 'Invalid phone number' };

        await sendOTP(phone);
        console.log(JSON.stringify({ level: 'INFO', msg: 'phone-otp-sent', data: { phone } }));
        return { success: true, expires_in: 300 };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'phone-otp-send-error', data: { err: err.message } }));
        return { success: false, error: err.message };
    }
}

async function handlePhoneOtpVerify(body) {
    try {
        const { phone, code } = body || {};
        if (!phone || !PHONE_RE.test(phone)) return { success: false, error: 'Invalid phone number' };
        if (!code) return { success: false, error: 'code is required' };

        const valid = await verifyOTP(phone, code);
        if (!valid) return { success: false, error: 'invalid_code' };

        // phone stays bare for sendOTP/verifyOTP (matches phone_otp_codes and PNVS's
        // expected format); users.phone is canonicalized to E.164 (+86...).
        const fullPhone = normalizeCnPhone(phone);

        const existing = await findUserByPhone(fullPhone);
        if (existing) {
            console.log(JSON.stringify({ level: 'INFO', msg: 'phone-otp-login-existing', data: { phone: fullPhone, user_id: existing.user_id } }));
            const { user, channel } = shapeUserRow(existing);
            return { success: true, user, channel };
        }

        const user_id = generateUserId();
        const referral_code = await generateReferralCode();
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const created = await client.query(
                `INSERT INTO users (user_id, phone, external_app, language, referral_code, created_at, phone_verified_at)
                 VALUES ($1, $2, 'phone', 'zh', $3, NOW(), NOW())
                 RETURNING user_id, nickname, birth_date, gender, language, phone, email, avatar_url, avatar_character,
                           coach_id, channel_id, roles, created_at, bio_data, referral_code, referred_by_user_id,
                           (phone_verified_at IS NOT NULL) AS phone_verified`,
                [user_id, fullPhone, referral_code]
            );
            await client.query(
                `INSERT INTO user_phones (user_id, phone, verified_at, is_primary) VALUES ($1, $2, NOW(), true)`,
                [user_id, fullPhone]
            );
            await client.query('COMMIT');
            console.log(JSON.stringify({ level: 'INFO', msg: 'phone-otp-login-new-user', data: { phone: fullPhone, user_id } }));
            return { success: true, user: { ...created.rows[0], bio_age: null, coach_name: null }, channel: null };
        } catch (err) {
            await client.query('ROLLBACK');
            // Unique-violation on users.phone / user_phones.phone — two concurrent
            // verifies for the same brand-new number raced the insert. Re-fetch the
            // row the other one created.
            if (err.code === '23505') {
                const raced = await findUserByPhone(fullPhone);
                if (raced) {
                    const { user, channel } = shapeUserRow(raced);
                    return { success: true, user, channel };
                }
            }
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'phone-otp-verify-error', data: { err: err.message } }));
        return { success: false, error: err.message };
    }
}

// Attaches + proves a phone number for an EXISTING (already-logged-in-via-WeChat)
// user, unlike handlePhoneOtpVerify which looks up/creates a user BY phone (that
// endpoint is for the web user-app's phone-login surface, not the miniapp — see plan).
//
// A user's FIRST bound phone becomes their primary (users.phone cache is set,
// same as this endpoint's old replace-only behavior). Any phone bound after that
// is added as an additional login phone rather than overwriting the primary —
// see handlePhoneSetPrimary to change which one is primary.
async function handlePhoneOtpBind(body) {
    const client = await pool.connect();
    try {
        const { user_id, phone, code } = body || {};
        if (!user_id) return { success: false, error: 'user_id is required' };
        if (!phone || !PHONE_RE.test(phone)) return { success: false, error: 'Invalid phone number' };
        if (!code) return { success: false, error: 'code is required' };

        const valid = await verifyOTP(phone, code);
        if (!valid) return { success: false, error: 'invalid_code' };

        const fullPhone = normalizeCnPhone(phone);

        const conflict = await client.query('SELECT user_id FROM user_phones WHERE phone = $1 AND user_id != $2', [fullPhone, user_id]);
        if (conflict.rows.length > 0) return { success: false, error: 'phone_in_use' };

        await client.query('BEGIN');
        const existingPrimary = await client.query('SELECT 1 FROM user_phones WHERE user_id = $1 AND is_primary', [user_id]);
        const isFirstPhone = existingPrimary.rows.length === 0;

        // WHERE clause on the DO UPDATE guards the race window between the conflict
        // check above and this statement: if another request attached this exact
        // phone to a DIFFERENT user in between, the update is skipped (0 rows) rather
        // than silently refreshing verified_at on a row we don't own.
        const attach = await client.query(
            `INSERT INTO user_phones (user_id, phone, verified_at, is_primary) VALUES ($1, $2, NOW(), $3)
             ON CONFLICT (phone) DO UPDATE SET verified_at = NOW() WHERE user_phones.user_id = EXCLUDED.user_id
             RETURNING user_id`,
            [user_id, fullPhone, isFirstPhone]
        );
        if (attach.rows.length === 0) {
            await client.query('ROLLBACK');
            return { success: false, error: 'phone_in_use' };
        }
        if (isFirstPhone) {
            const updated = await client.query(
                `UPDATE users SET phone = $1, phone_verified_at = NOW() WHERE user_id = $2 RETURNING user_id`,
                [fullPhone, user_id]
            );
            if (updated.rows.length === 0) {
                await client.query('ROLLBACK');
                return { success: false, error: 'user_not_found' };
            }
        }
        await client.query('COMMIT');

        const { rows } = await client.query(`${USER_SELECT} WHERE u.user_id = $1 LIMIT 1`, [user_id]);
        const { user, channel } = shapeUserRow(rows[0]);
        console.log(JSON.stringify({ level: 'INFO', msg: 'phone-otp-bind', data: { phone: fullPhone, user_id, is_primary: isFirstPhone } }));
        return { success: true, user, channel };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.log(JSON.stringify({ level: 'ERROR', msg: 'phone-otp-bind-error', data: { err: err.message } }));
        return { success: false, error: err.message };
    } finally {
        client.release();
    }
}

// Switches which of a user's already-verified phones is primary (the one cached
// on users.phone and used by other call sites that still read u.phone directly —
// gcnClient.js, partners.phone, etc.). Does not itself verify anything; the phone
// must already be in user_phones via handlePhoneOtpVerify/handlePhoneOtpBind.
async function handlePhoneSetPrimary(body) {
    const client = await pool.connect();
    try {
        const { user_id, phone } = body || {};
        if (!user_id) return { success: false, error: 'user_id is required' };
        if (!phone) return { success: false, error: 'phone is required' };

        await client.query('BEGIN');
        const owned = await client.query('SELECT 1 FROM user_phones WHERE user_id = $1 AND phone = $2', [user_id, phone]);
        if (owned.rows.length === 0) {
            await client.query('ROLLBACK');
            return { success: false, error: 'phone_not_attached' };
        }

        await client.query('UPDATE user_phones SET is_primary = false WHERE user_id = $1 AND is_primary', [user_id]);
        await client.query('UPDATE user_phones SET is_primary = true WHERE user_id = $1 AND phone = $2', [user_id, phone]);
        const primaryRow = await client.query('SELECT verified_at FROM user_phones WHERE user_id = $1 AND phone = $2', [user_id, phone]);
        await client.query('UPDATE users SET phone = $1, phone_verified_at = $2 WHERE user_id = $3', [phone, primaryRow.rows[0].verified_at, user_id]);
        await client.query('COMMIT');

        console.log(JSON.stringify({ level: 'INFO', msg: 'phone-set-primary', data: { phone, user_id } }));
        return { success: true };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.log(JSON.stringify({ level: 'ERROR', msg: 'phone-set-primary-error', data: { err: err.message } }));
        return { success: false, error: err.message };
    } finally {
        client.release();
    }
}

// Loose E.164-ish check for non-China numbers submitted with their dial code
// (e.g. "+18005551234") — no per-country format validation exists yet, so this
// only guards against obvious garbage, not correctness.
const INTL_PHONE_RE = /^\+[1-9]\d{5,14}$/;

// Non-China phone numbers are accepted as-is, with no OTP proof — Aliyun PNVS
// (this backend's only SMS provider) is not confirmed to support delivery/signature
// approval outside China. Distinct from handlePhoneOtpBind: this never calls
// verifyOTP and phone_verified_at is intentionally left NULL, since nothing was
// actually verified. Stored WITH the submitted "+<dialcode>" — same E.164 shape
// China numbers now use (see lib/phone.js normalizeCnPhone), just a different
// dial code, so no separate collision handling is needed here.
async function handlePhoneAcceptUnverified(body) {
    try {
        const { user_id, phone } = body || {};
        if (!user_id) return { success: false, error: 'user_id is required' };
        if (!phone || !INTL_PHONE_RE.test(phone)) return { success: false, error: 'Invalid phone number' };

        const conflict = await pool.query('SELECT user_id FROM users WHERE phone = $1 AND user_id != $2', [phone, user_id]);
        if (conflict.rows.length > 0) return { success: false, error: 'phone_in_use' };

        const updated = await pool.query(
            `UPDATE users SET phone = $1 WHERE user_id = $2 RETURNING user_id`,
            [phone, user_id]
        );
        if (updated.rows.length === 0) return { success: false, error: 'user_not_found' };

        const { rows } = await pool.query(`${USER_SELECT} WHERE u.user_id = $1 LIMIT 1`, [user_id]);
        const { user, channel } = shapeUserRow(rows[0]);
        console.log(JSON.stringify({ level: 'INFO', msg: 'phone-accept-unverified', data: { phone, user_id } }));
        return { success: true, user, channel };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'phone-accept-unverified-error', data: { err: err.message } }));
        return { success: false, error: err.message };
    }
}

module.exports = { handlePhoneOtpSend, handlePhoneOtpVerify, handlePhoneOtpBind, handlePhoneSetPrimary, handlePhoneAcceptUnverified };
