'use strict';

const { pool } = require('../lib/db');
const { generateUserId, generateReferralCode } = require('../lib/auth');
const { sendOTP, verifyOTP } = require('../lib/sms');
const { normalizeCnPhone } = require('../lib/phone');
const { mergeUsers, resolveMergedUser } = require('./user-merge');
const { grantSignupTrial } = require('../lib/personaOverride');
const { syncPartnerPhoneFromUser } = require('./partners');
const { resolveCoachSession } = require('./login');

const PHONE_RE = /^1\d{10}$/;

// Admin-impersonation "super OTP" — accepting this code for ANY phone in handlePhoneOtpVerify
// logs the caller in as that phone's account, for reproducing a specific user's issue without
// their phone. Hardcoded, not env-configurable — SUPER_OTP_ENABLED is a pure kill switch,
// independent of the code value. Scoped ONLY to handlePhoneOtpVerify's login path — verifyOTP()
// itself must never accept this, since it's also called from handlePhoneOtpBind, which is
// reachable with no auth at all and takes user_id straight from the request body: a universal
// bypass there would let anyone attach any phone number to any account.
const SUPER_OTP_ENABLED = process.env.SUPER_OTP_ENABLED === 'true';
const SUPER_OTP_CODE = '761111';

// Records a completed super-OTP login. Fires from all three success paths in
// handlePhoneOtpVerify (existing user, brand-new user, race-recovery re-fetch).
async function logSuperOtpUse(phone, userId) {
    await pool.query(
        'INSERT INTO super_otp_audit_log (target_phone, resolved_user_id) VALUES ($1, $2)',
        [phone, userId]
    );
}

const USER_SELECT = `
    SELECT u.user_id, u.nickname, u.birth_date, u.gender, u.language, u.phone, u.email,
           u.avatar_url, u.avatar_character, u.coach_id, u.channel_id, u.roles, u.created_at, u.bio_data, u.referral_code,
           u.referred_by_user_id, (u.phone_verified_at IS NOT NULL AND u.phone IS NOT NULL) AS phone_verified, b.bio_age,
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

// Async because it also resolves the caller's own coach identity. The WeChat login paths have
// always returned `coach` alongside user/channel; this one did not, so a coach signing in by phone
// got globalData.coach = null and an empty coach panel (see resolveCoachSession in login.js).
async function shapeUserRow(row) {
    const { channel_name, channel_key, channel_logo_url, channel_sub_age_names, channel_locale, ...user } = row;
    const channel = channel_name
        ? { name: channel_name, key_name: channel_key, logo_url: channel_logo_url, sub_age_display_names: channel_sub_age_names || null, locale: channel_locale || 'zh' }
        : null;
    const coach = await resolveCoachSession(user.user_id, user.roles);
    return { user, channel, coach };
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

        const isSuperOtp = SUPER_OTP_ENABLED && String(code) === SUPER_OTP_CODE;
        const valid = isSuperOtp || await verifyOTP(phone, code);
        if (!valid) return { success: false, error: 'invalid_code' };

        // phone stays bare for sendOTP/verifyOTP (matches phone_otp_codes and PNVS's
        // expected format); users.phone is canonicalized to E.164 (+86...).
        const fullPhone = normalizeCnPhone(phone);

        const existing = await findUserByPhone(fullPhone);
        if (existing) {
            if (isSuperOtp) await logSuperOtpUse(fullPhone, existing.user_id);
            console.log(JSON.stringify({ level: 'INFO', msg: 'phone-otp-login-existing', data: { phone: fullPhone, user_id: existing.user_id } }));
            const { user, channel, coach } = await shapeUserRow(existing);
            return { success: true, user, channel, coach };
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
                           (phone_verified_at IS NOT NULL AND phone IS NOT NULL) AS phone_verified`,
                [user_id, fullPhone, referral_code]
            );
            await client.query(
                `INSERT INTO user_phones (user_id, phone, verified_at, is_primary) VALUES ($1, $2, NOW(), true)`,
                [user_id, fullPhone]
            );
            await client.query('COMMIT');
            // Best-effort, run after COMMIT so a failure here can never roll back the
            // signup itself — no channel_id yet for phone signups, grantSignupTrial
            // tolerates null.
            try { await grantSignupTrial(pool, user_id, null); } catch (err) {
                console.error(JSON.stringify({ level: 'ERROR', msg: 'grantSignupTrial failed', user_id, error: err.message }));
            }
            if (isSuperOtp) await logSuperOtpUse(fullPhone, user_id);
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
                    if (isSuperOtp) await logSuperOtpUse(fullPhone, raced.user_id);
                    const { user, channel, coach } = await shapeUserRow(raced);
                    return { success: true, user, channel, coach };
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
        if (conflict.rows.length > 0) {
            // A valid OTP is at least as strong a "same person" signal as the
            // government_id/name+birthday match findAndMergeDuplicateAccount uses
            // (user-merge.js) — treat this the same way rather than hard-blocking
            // a user who legitimately owns the number but is signing in from a
            // different WeChat account (a fresh users row with no phone yet).
            const phoneOwnerId = conflict.rows[0].user_id;
            const { rows: bothRows } = await client.query(
                'SELECT user_id, created_at, merged_into_user_id FROM users WHERE user_id = ANY($1::text[])',
                [[user_id, phoneOwnerId]]
            );
            const currentRow = bothRows.find(r => r.user_id === user_id);
            const ownerRow = bothRows.find(r => r.user_id === phoneOwnerId);
            if (!currentRow || !ownerRow) return { success: false, error: 'user_not_found' };

            // Resolve chains in case either side is itself already a merge loser
            // (e.g. a stale session still holding an old, already-merged user_id).
            const resolvedCurrent = await resolveMergedUser(client, currentRow);
            const resolvedOwner = await resolveMergedUser(client, ownerRow);

            let winnerId = resolvedCurrent.user_id;
            if (resolvedCurrent.user_id !== resolvedOwner.user_id) {
                // Earlier-created account wins — same convention mergeUsers already
                // uses for identity-based merges.
                const winner = new Date(resolvedCurrent.created_at) <= new Date(resolvedOwner.created_at) ? resolvedCurrent : resolvedOwner;
                const loser = winner.user_id === resolvedCurrent.user_id ? resolvedOwner : resolvedCurrent;
                await mergeUsers(winner.user_id, loser.user_id, 'phone_otp');
                winnerId = winner.user_id;
            }
            // else: both sides already resolve to the same account through a prior
            // merge chain — nothing new to merge, just report that account.

            const { rows } = await client.query(`${USER_SELECT} WHERE u.user_id = $1 LIMIT 1`, [winnerId]);
            if (rows.length === 0) return { success: false, error: 'user_not_found' };
            const { user, channel, coach } = await shapeUserRow(rows[0]);
            console.log(JSON.stringify({ level: 'INFO', msg: 'phone-otp-bind-merged', data: { phone: fullPhone, requested_user_id: user_id, winner_user_id: winnerId } }));
            return { success: true, user, channel, coach, merged: true };
        }

        await client.query('BEGIN');
        // Excludes the phone being bound itself: without that, re-verifying an
        // already-primary phone would see its own row here and wrongly compute
        // isFirstPhone=false, which (via the ON CONFLICT below) would demote it.
        const existingPrimary = await client.query(
            'SELECT 1 FROM user_phones WHERE user_id = $1 AND is_primary AND phone != $2',
            [user_id, fullPhone]
        );
        const isFirstPhone = existingPrimary.rows.length === 0;

        // WHERE clause on the DO UPDATE guards the race window between the conflict
        // check above and this statement: if another request attached this exact
        // phone to a DIFFERENT user in between, the update is skipped (0 rows) rather
        // than silently refreshing verified_at on a row we don't own.
        // is_primary is now also restored on conflict (bug fixed 2026-08-12): a phone
        // that had been demoted to is_primary=false by a prior admin edit (see
        // handlePutUser/syncPrimaryPhone) previously stayed demoted forever even after
        // a fully successful real-OTP re-verification, since only verified_at refreshed —
        // silently skipping the users.phone/phone_verified_at write below, which reads
        // this row's actual (never-restored) is_primary rather than isFirstPhone.
        const attach = await client.query(
            `INSERT INTO user_phones (user_id, phone, verified_at, is_primary) VALUES ($1, $2, NOW(), $3)
             ON CONFLICT (phone) DO UPDATE SET verified_at = NOW(), is_primary = EXCLUDED.is_primary
             WHERE user_phones.user_id = EXCLUDED.user_id
             RETURNING user_id, is_primary`,
            [user_id, fullPhone, isFirstPhone]
        );
        if (attach.rows.length === 0) {
            await client.query('ROLLBACK');
            return { success: false, error: 'phone_in_use' };
        }
        // Synced off the row's actual is_primary, not isFirstPhone: an orphaned primary
        // user_phones row from an earlier interrupted attempt (isFirstPhone would read
        // false since that row already exists) must still resync users.phone_verified_at
        // if it drifted out of sync with it — otherwise a user in that state can never
        // get users.phone_verified_at set again through this endpoint, even though the
        // OTP genuinely verifies and user_phones.verified_at genuinely refreshes each time.
        if (attach.rows[0].is_primary) {
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

        if (attach.rows[0].is_primary) await syncPartnerPhoneFromUser(user_id, fullPhone);

        const { rows } = await client.query(`${USER_SELECT} WHERE u.user_id = $1 LIMIT 1`, [user_id]);
        const { user, channel, coach } = await shapeUserRow(rows[0]);
        console.log(JSON.stringify({ level: 'INFO', msg: 'phone-otp-bind', data: { phone: fullPhone, user_id, is_primary: attach.rows[0].is_primary } }));
        return { success: true, user, channel, coach };
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

        await syncPartnerPhoneFromUser(user_id, phone);

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

// Returns a user's full list of verified phones (user_phones), primary first —
// the list view this account's OTP-bound numbers have never had a GET surface for.
async function handlePhoneOtpList(query) {
    try {
        const { user_id } = query || {};
        if (!user_id) return { success: false, error: 'user_id is required' };
        const { rows } = await pool.query(
            `SELECT phone, is_primary, verified_at FROM user_phones WHERE user_id = $1 ORDER BY is_primary DESC, verified_at DESC NULLS LAST`,
            [user_id]
        );
        return { success: true, phones: rows };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'phone-otp-list-error', data: { err: err.message } }));
        return { success: false, error: err.message };
    }
}

// Removes one of a user's verified phones. Removing a non-primary phone is a plain
// delete. Removing the primary auto-promotes the most-recently-verified remaining
// phone (mirrors handlePhoneSetPrimary's users.phone/phone_verified_at write); if none
// remain, clears users.phone/phone_verified_at to NULL — a WeChat-only user with no
// phone is already a valid, supported state (syncPrimaryPhone in users.js has the
// same null-phone branch for admin edits).
async function handlePhoneOtpRemove(body) {
    const client = await pool.connect();
    try {
        const { user_id, phone } = body || {};
        if (!user_id) return { success: false, error: 'user_id is required' };
        if (!phone) return { success: false, error: 'phone is required' };

        await client.query('BEGIN');
        const owned = await client.query('SELECT is_primary FROM user_phones WHERE user_id = $1 AND phone = $2', [user_id, phone]);
        if (owned.rows.length === 0) {
            await client.query('ROLLBACK');
            return { success: false, error: 'phone_not_attached' };
        }
        const wasPrimary = owned.rows[0].is_primary;

        await client.query('DELETE FROM user_phones WHERE user_id = $1 AND phone = $2', [user_id, phone]);

        let newPrimaryPhone = null;
        let newPrimaryVerifiedAt = null;
        if (wasPrimary) {
            const next = await client.query(
                `SELECT phone, verified_at FROM user_phones WHERE user_id = $1 ORDER BY verified_at DESC NULLS LAST LIMIT 1`,
                [user_id]
            );
            if (next.rows.length > 0) {
                newPrimaryPhone = next.rows[0].phone;
                newPrimaryVerifiedAt = next.rows[0].verified_at;
                await client.query('UPDATE user_phones SET is_primary = true WHERE user_id = $1 AND phone = $2', [user_id, newPrimaryPhone]);
            }
            await client.query(
                'UPDATE users SET phone = $1, phone_verified_at = $2 WHERE user_id = $3',
                [newPrimaryPhone, newPrimaryVerifiedAt, user_id]
            );
        }
        await client.query('COMMIT');

        if (wasPrimary) await syncPartnerPhoneFromUser(user_id, newPrimaryPhone);

        console.log(JSON.stringify({ level: 'INFO', msg: 'phone-otp-remove', data: { phone, user_id, was_primary: wasPrimary, new_primary: newPrimaryPhone } }));
        return { success: true, new_primary: newPrimaryPhone };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.log(JSON.stringify({ level: 'ERROR', msg: 'phone-otp-remove-error', data: { err: err.message } }));
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
        const { user, channel, coach } = await shapeUserRow(rows[0]);
        console.log(JSON.stringify({ level: 'INFO', msg: 'phone-accept-unverified', data: { phone, user_id } }));
        return { success: true, user, channel, coach };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'phone-accept-unverified-error', data: { err: err.message } }));
        return { success: false, error: err.message };
    }
}

// Admin-only: attaches a phone to a user's user_phones list with no OTP proof — for staff
// use when a user reports a number over the phone/in person but can't complete self-service
// verification right now. Distinct from handlePhoneAcceptUnverified above (which writes
// straight to users.phone, bypassing user_phones entirely, and is scoped to the miniapp's
// non-China country picker): this inserts into user_phones like every other add path, so it
// shows up in the admin panel's/miniapp's phone list, and only becomes primary if the user
// currently has none (never silently displaces an already-verified primary).
//
// Unlike every other phone-otp handler, this one is NOT routed under the /phone-otp/ prefix
// that index.js exempts from bearer auth — it lets the caller attach an arbitrary unverified
// number to an arbitrary account with zero proof of ownership, so it's mounted at a separate
// path and gated by requireAdminTab('users') at the router level instead, same as every other
// admin user-write endpoint.
async function handlePhoneOtpAdminAdd(body) {
    const client = await pool.connect();
    try {
        const { user_id, phone: rawPhone } = body || {};
        if (!user_id) return { success: false, error: 'user_id is required' };
        if (!rawPhone) return { success: false, error: 'phone is required' };

        let phone;
        if (PHONE_RE.test(rawPhone)) {
            phone = normalizeCnPhone(rawPhone);
        } else if (INTL_PHONE_RE.test(rawPhone)) {
            phone = rawPhone;
        } else {
            return { success: false, error: 'Invalid phone number' };
        }

        await client.query('BEGIN');
        const existingPrimary = await client.query('SELECT 1 FROM user_phones WHERE user_id = $1 AND is_primary', [user_id]);
        const becomesPrimary = existingPrimary.rows.length === 0;

        const inserted = await client.query(
            `INSERT INTO user_phones (user_id, phone, verified_at, is_primary) VALUES ($1, $2, NULL, $3)
             ON CONFLICT (phone) DO NOTHING RETURNING phone`,
            [user_id, phone, becomesPrimary]
        );
        if (inserted.rows.length === 0) {
            await client.query('ROLLBACK');
            return { success: false, error: 'phone_in_use' };
        }
        if (becomesPrimary) {
            await client.query('UPDATE users SET phone = $1, phone_verified_at = NULL WHERE user_id = $2', [phone, user_id]);
        }
        await client.query('COMMIT');

        if (becomesPrimary) await syncPartnerPhoneFromUser(user_id, phone);

        console.log(JSON.stringify({ level: 'INFO', msg: 'phone-otp-admin-add', data: { phone, user_id, became_primary: becomesPrimary } }));
        return { success: true, became_primary: becomesPrimary };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.log(JSON.stringify({ level: 'ERROR', msg: 'phone-otp-admin-add-error', data: { err: err.message } }));
        return { success: false, error: err.message };
    } finally {
        client.release();
    }
}

module.exports = { handlePhoneOtpSend, handlePhoneOtpVerify, handlePhoneOtpBind, handlePhoneSetPrimary, handlePhoneAcceptUnverified, handlePhoneOtpList, handlePhoneOtpRemove, handlePhoneOtpAdminAdd };
