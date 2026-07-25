'use strict';

const { pool } = require('../lib/db');
const { generateUserId, generateReferralCode } = require('../lib/auth');
const { sendOTP, verifyOTP } = require('../lib/sms');

const PHONE_RE = /^1\d{10}$/;

const USER_SELECT = `
    SELECT u.user_id, u.nickname, u.birth_date, u.gender, u.language, u.phone, u.email,
           u.avatar_url, u.coach_id, u.channel_id, u.roles, u.created_at, u.bio_data, u.referral_code,
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

async function findUserByPhone(phone) {
    const { rows } = await pool.query(`${USER_SELECT} WHERE u.phone = $1 LIMIT 1`, [phone]);
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

        const existing = await findUserByPhone(phone);
        if (existing) {
            console.log(JSON.stringify({ level: 'INFO', msg: 'phone-otp-login-existing', data: { phone, user_id: existing.user_id } }));
            const { user, channel } = shapeUserRow(existing);
            return { success: true, user, channel };
        }

        const user_id = generateUserId();
        const referral_code = await generateReferralCode();
        try {
            const created = await pool.query(
                `INSERT INTO users (user_id, phone, external_app, language, referral_code, created_at, phone_verified_at)
                 VALUES ($1, $2, 'phone', 'zh', $3, NOW(), NOW())
                 RETURNING user_id, nickname, birth_date, gender, language, phone, email, avatar_url,
                           coach_id, channel_id, roles, created_at, bio_data, referral_code, referred_by_user_id,
                           (phone_verified_at IS NOT NULL) AS phone_verified`,
                [user_id, phone, referral_code]
            );
            console.log(JSON.stringify({ level: 'INFO', msg: 'phone-otp-login-new-user', data: { phone, user_id } }));
            return { success: true, user: { ...created.rows[0], bio_age: null, coach_name: null }, channel: null };
        } catch (err) {
            // Unique-violation on users.phone — two concurrent verifies for the same
            // brand-new number raced the insert. Re-fetch the row the other one created.
            if (err.code === '23505') {
                const raced = await findUserByPhone(phone);
                if (raced) {
                    const { user, channel } = shapeUserRow(raced);
                    return { success: true, user, channel };
                }
            }
            throw err;
        }
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'phone-otp-verify-error', data: { err: err.message } }));
        return { success: false, error: err.message };
    }
}

// Attaches + proves a phone number for an EXISTING (already-logged-in-via-WeChat)
// user, unlike handlePhoneOtpVerify which looks up/creates a user BY phone (that
// endpoint is for the web user-app's phone-login surface, not the miniapp — see plan).
async function handlePhoneOtpBind(body) {
    try {
        const { user_id, phone, code } = body || {};
        if (!user_id) return { success: false, error: 'user_id is required' };
        if (!phone || !PHONE_RE.test(phone)) return { success: false, error: 'Invalid phone number' };
        if (!code) return { success: false, error: 'code is required' };

        const valid = await verifyOTP(phone, code);
        if (!valid) return { success: false, error: 'invalid_code' };

        const conflict = await pool.query('SELECT user_id FROM users WHERE phone = $1 AND user_id != $2', [phone, user_id]);
        if (conflict.rows.length > 0) return { success: false, error: 'phone_in_use' };

        const updated = await pool.query(
            `UPDATE users SET phone = $1, phone_verified_at = NOW() WHERE user_id = $2 RETURNING user_id`,
            [phone, user_id]
        );
        if (updated.rows.length === 0) return { success: false, error: 'user_not_found' };

        const { rows } = await pool.query(`${USER_SELECT} WHERE u.user_id = $1 LIMIT 1`, [user_id]);
        const { user, channel } = shapeUserRow(rows[0]);
        console.log(JSON.stringify({ level: 'INFO', msg: 'phone-otp-bind', data: { phone, user_id } }));
        return { success: true, user, channel };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'phone-otp-bind-error', data: { err: err.message } }));
        return { success: false, error: err.message };
    }
}

module.exports = { handlePhoneOtpSend, handlePhoneOtpVerify, handlePhoneOtpBind };
