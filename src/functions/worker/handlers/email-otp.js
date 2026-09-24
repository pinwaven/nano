'use strict';

// Email as a login identity — the email twin of handlers/phone-otp.js, endpoint for endpoint:
// send / verify (login or sign-up) / bind / list / set-primary / remove, plus an admin add.
// user_emails (migration_user_emails.sql) is the source of truth for email -> user_id, and
// users.email / users.email_verified_at is the denormalized primary-email cache, exactly as
// user_phones / users.phone are for phones. Codes are nano's own (lib/email-otp.js) because
// DirectMail only delivers — there is no PNVS-style managed verification for email.
//
// Email identities are channel-agnostic. A new browser user is assigned through a coach
// invitation; legacy non-browser callers without an invitation keep the root `waven` fallback.
// Once created, the same email must remain usable for later login regardless of channel.

const { pool } = require('../lib/db');
const { generateUserId, generateReferralCode } = require('../lib/auth');
const { normalizeEmail, isValidEmail, issueEmailOtp, verifyEmailOtp, TTL_MINUTES } = require('../lib/email-otp');
const { resolveRootChannelKey } = require('../lib/channels');
const { mergeUsers, resolveMergedUser } = require('./user-merge');
const { grantSignupTrial } = require('../lib/personaOverride');
const { USER_SELECT, shapeUserRow, SUPER_OTP_ENABLED, SUPER_OTP_CODE } = require('./phone-otp');
const { signSignupProof, verifySignupProof } = require('../lib/auth');
const { resolveSignupInvite, recordInvitationUse } = require('../lib/signup-invite');

const EMAIL_LOGIN_ROOT_CHANNEL = 'waven';

function emailLoginAllowed(rootKey) {
    return true;
}

// Same backdoor phone-otp.js honours, same scoping rule: login path only, never bind. Audited
// into the shared table with identifier_type = 'email' (migration_super_otp_audit_log_identifier_type).
async function logSuperOtpUse(email, userId) {
    await pool.query(
        "INSERT INTO super_otp_audit_log (target_phone, identifier_type, resolved_user_id) VALUES ($1, 'email', $2)",
        [email, userId]
    );
}

async function findUserByEmail(email) {
    const { rows } = await pool.query(
        `${USER_SELECT} JOIN user_emails ue ON ue.user_id = u.user_id WHERE ue.email = $1 LIMIT 1`,
        [email]
    );
    return rows[0] || null;
}

async function wavenChannelId() {
    const { rows } = await pool.query("SELECT id FROM channels WHERE key_name = $1 LIMIT 1", [EMAIL_LOGIN_ROOT_CHANNEL]);
    return rows[0]?.id || null;
}

function langOf(body) {
    return body && body.language === 'zh' ? 'zh' : 'en';
}

async function handleEmailOtpSend(body) {
    try {
        const { email: rawEmail, purpose } = body || {};
        const email = normalizeEmail(rawEmail);
        if (!isValidEmail(email)) return { success: false, error: 'invalid_email' };

        const issued = await issueEmailOtp(email, purpose === 'bind' ? 'bind' : 'login', langOf(body));
        if (!issued.ok) {
            console.log(JSON.stringify({ level: 'INFO', msg: 'email-otp-rate-limited', data: { email, retry_after: issued.retry_after } }));
            return { success: false, error: issued.error, retry_after: issued.retry_after };
        }
        console.log(JSON.stringify({ level: 'INFO', msg: 'email-otp-issued', data: { email } }));
        return { success: true, expires_in: TTL_MINUTES * 60 };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'email-otp-send-error', data: { err: err.message } }));
        return { success: false, error: 'send_failed' };
    }
}

// Login-or-sign-up by email. A known address logs into its account (any attached email, not
// just the primary); an unknown one must supply a coach invitation after OTP verification.
async function handleEmailOtpVerify(body) {
    try {
        const { email: rawEmail, code, invite_code, signup_proof, require_invite } = body || {};
        const email = normalizeEmail(rawEmail);
        if (!isValidEmail(email)) return { success: false, error: 'invalid_email' };
        const proof = signup_proof ? verifySignupProof(signup_proof, 'email', email) : null;
        if (signup_proof && !proof) return { success: false, error: 'invalid_signup_proof' };
        if (!proof && !code) return { success: false, error: 'code is required' };

        const isSuperOtp = !proof && SUPER_OTP_ENABLED && String(code) === SUPER_OTP_CODE;
        if (!proof && !isSuperOtp) {
            const check = await verifyEmailOtp(email, String(code));
            if (!check.ok) return { success: false, error: check.error };
        }

        const existing = await findUserByEmail(email);
        if (existing) {
            if (proof) return { success: false, error: 'invalid_signup_proof' };
            if (isSuperOtp) await logSuperOtpUse(email, existing.user_id);
            console.log(JSON.stringify({ level: 'INFO', msg: 'email-otp-login-existing', data: { email, user_id: existing.user_id } }));
            const { user, channel, coach } = await shapeUserRow(existing);
            return { success: true, user, channel, coach };
        }

        if (!invite_code && require_invite === true) {
            return {
                success: false,
                invite_required: true,
                signup_proof: signup_proof || signSignupProof('email', email, langOf(body)),
            };
        }

        const user_id = generateUserId();
        const referral_code = await generateReferralCode();
        const client = await pool.connect();
        let channelId = null;
        try {
            await client.query('BEGIN');
            const invite = invite_code ? await resolveSignupInvite(client, invite_code) : {
                invitationId: null, channelId: null, coachId: null, referredByUserId: null,
            };
            if (invite_code && !invite) {
                await client.query('ROLLBACK');
                return { success: false, invalid_code: true, error: 'Invalid or expired invitation code', signup_proof: signup_proof || signSignupProof('email', email, langOf(body)) };
            }
            channelId = invite.channelId || await wavenChannelId();
            await client.query(
                `INSERT INTO users (user_id, email, email_verified_at, external_app, language, channel_id, coach_id,
                                    invited_by_invitation_id, referred_by_user_id, referral_code, created_at)
                 VALUES ($1, $2, NOW(), 'email', $3, $4, $5, $6, $7, $8, NOW())`,
                [user_id, email, langOf(body), channelId, invite.coachId, invite.invitationId, invite.referredByUserId, referral_code]
            );
            await client.query(
                `INSERT INTO user_emails (user_id, email, verified_at, is_primary) VALUES ($1, $2, NOW(), true)`,
                [user_id, email]
            );
            await recordInvitationUse(client, invite.invitationId, user_id);
            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK');
            // Two concurrent verifies for the same brand-new address raced the insert —
            // re-fetch the row the other one created (same recovery as phone-otp.js).
            if (err.code === '23505') {
                const raced = await findUserByEmail(email);
                if (raced) {
                    if (isSuperOtp) await logSuperOtpUse(email, raced.user_id);
                    const { user, channel, coach } = await shapeUserRow(raced);
                    return { success: true, user, channel, coach };
                }
            }
            throw err;
        } finally {
            client.release();
        }

        // Best-effort, after COMMIT so a failure can never roll back the sign-up itself.
        try { await grantSignupTrial(pool, user_id, channelId); } catch (err) {
            console.error(JSON.stringify({ level: 'ERROR', msg: 'grantSignupTrial failed', user_id, error: err.message }));
        }
        if (isSuperOtp) await logSuperOtpUse(email, user_id);

        // Re-read through USER_SELECT so the new user carries the same channel object every
        // other login path returns (phone sign-up returns channel: null because it has none).
        const { rows } = await pool.query(`${USER_SELECT} WHERE u.user_id = $1 LIMIT 1`, [user_id]);
        const { user, channel, coach } = await shapeUserRow(rows[0]);
        console.log(JSON.stringify({ level: 'INFO', msg: 'email-otp-login-new-user', data: { email, user_id, channel_id: channelId } }));
        return { success: true, new_user: true, user: { ...user, bio_age: user.bio_age ?? null, coach_name: user.coach_name ?? null }, channel, coach };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'email-otp-verify-error', data: { err: err.message } }));
        return { success: false, error: err.message };
    }
}

// Attaches + proves an email for an EXISTING user (logged in by WeChat or phone). First email
// becomes primary; later ones are additional login identities. An address already owned by a
// different account merges the two (earlier-created wins), exactly as a verified phone does —
// but only when both sides are email-eligible channels, so an aeviva account can never be
// pulled into a merge by this path.
async function handleEmailOtpBind(body) {
    const client = await pool.connect();
    try {
        const { user_id, email: rawEmail, code } = body || {};
        if (!user_id) return { success: false, error: 'user_id is required' };
        const email = normalizeEmail(rawEmail);
        if (!isValidEmail(email)) return { success: false, error: 'invalid_email' };
        if (!code) return { success: false, error: 'code is required' };

        const check = await verifyEmailOtp(email, String(code));
        if (!check.ok) return { success: false, error: check.error };

        const me = await client.query('SELECT user_id, channel_id, created_at, merged_into_user_id FROM users WHERE user_id = $1', [user_id]);
        if (me.rows.length === 0) return { success: false, error: 'user_not_found' };
        const myRoot = await resolveRootChannelKey(me.rows[0].channel_id, client);
        const conflict = await client.query('SELECT user_id FROM user_emails WHERE email = $1 AND user_id != $2', [email, user_id]);
        if (conflict.rows.length > 0) {
            const ownerId = conflict.rows[0].user_id;
            const owner = await client.query('SELECT user_id, channel_id, created_at, merged_into_user_id FROM users WHERE user_id = $1', [ownerId]);
            if (owner.rows.length === 0) return { success: false, error: 'user_not_found' };
            const ownerRoot = await resolveRootChannelKey(owner.rows[0].channel_id, client);
            // A verified address may merge duplicate accounts inside one organization tree,
            // but must not move private data between unrelated channel trees.
            if (myRoot && ownerRoot && myRoot !== ownerRoot) return { success: false, error: 'channel_not_supported' };
            const resolvedCurrent = await resolveMergedUser(client, me.rows[0]);
            const resolvedOwner = await resolveMergedUser(client, owner.rows[0]);
            let winnerId = resolvedCurrent.user_id;
            if (resolvedCurrent.user_id !== resolvedOwner.user_id) {
                const winner = new Date(resolvedCurrent.created_at) <= new Date(resolvedOwner.created_at) ? resolvedCurrent : resolvedOwner;
                const loser = winner.user_id === resolvedCurrent.user_id ? resolvedOwner : resolvedCurrent;
                await mergeUsers(winner.user_id, loser.user_id, 'email_otp');
                winnerId = winner.user_id;
            }
            const { rows } = await client.query(`${USER_SELECT} WHERE u.user_id = $1 LIMIT 1`, [winnerId]);
            if (rows.length === 0) return { success: false, error: 'user_not_found' };
            const { user, channel, coach } = await shapeUserRow(rows[0]);
            console.log(JSON.stringify({ level: 'INFO', msg: 'email-otp-bind-merged', data: { email, requested_user_id: user_id, winner_user_id: winnerId } }));
            return { success: true, user, channel, coach, merged: true };
        }

        await client.query('BEGIN');
        // Excludes the address being bound so re-verifying the current primary keeps it primary.
        const existingPrimary = await client.query(
            'SELECT 1 FROM user_emails WHERE user_id = $1 AND is_primary AND email != $2',
            [user_id, email]
        );
        const isFirst = existingPrimary.rows.length === 0;
        const attach = await client.query(
            `INSERT INTO user_emails (user_id, email, verified_at, is_primary) VALUES ($1, $2, NOW(), $3)
             ON CONFLICT (email) DO UPDATE SET verified_at = NOW(), is_primary = EXCLUDED.is_primary
             WHERE user_emails.user_id = EXCLUDED.user_id
             RETURNING user_id, is_primary`,
            [user_id, email, isFirst]
        );
        if (attach.rows.length === 0) {
            await client.query('ROLLBACK');
            return { success: false, error: 'email_in_use' };
        }
        if (attach.rows[0].is_primary) {
            await client.query('UPDATE users SET email = $1, email_verified_at = NOW() WHERE user_id = $2', [email, user_id]);
        }
        await client.query('COMMIT');

        const { rows } = await client.query(`${USER_SELECT} WHERE u.user_id = $1 LIMIT 1`, [user_id]);
        const { user, channel, coach } = await shapeUserRow(rows[0]);
        console.log(JSON.stringify({ level: 'INFO', msg: 'email-otp-bind', data: { email, user_id, is_primary: attach.rows[0].is_primary } }));
        return { success: true, user, channel, coach };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.log(JSON.stringify({ level: 'ERROR', msg: 'email-otp-bind-error', data: { err: err.message } }));
        return { success: false, error: err.message };
    } finally {
        client.release();
    }
}

async function handleEmailSetPrimary(body) {
    const client = await pool.connect();
    try {
        const { user_id, email: rawEmail } = body || {};
        if (!user_id) return { success: false, error: 'user_id is required' };
        const email = normalizeEmail(rawEmail);
        if (!email) return { success: false, error: 'email is required' };

        await client.query('BEGIN');
        const owned = await client.query('SELECT verified_at FROM user_emails WHERE user_id = $1 AND email = $2', [user_id, email]);
        if (owned.rows.length === 0) {
            await client.query('ROLLBACK');
            return { success: false, error: 'email_not_attached' };
        }
        await client.query('UPDATE user_emails SET is_primary = false WHERE user_id = $1 AND is_primary', [user_id]);
        await client.query('UPDATE user_emails SET is_primary = true WHERE user_id = $1 AND email = $2', [user_id, email]);
        await client.query('UPDATE users SET email = $1, email_verified_at = $2 WHERE user_id = $3', [email, owned.rows[0].verified_at, user_id]);
        await client.query('COMMIT');

        console.log(JSON.stringify({ level: 'INFO', msg: 'email-set-primary', data: { email, user_id } }));
        return { success: true };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.log(JSON.stringify({ level: 'ERROR', msg: 'email-set-primary-error', data: { err: err.message } }));
        return { success: false, error: err.message };
    } finally {
        client.release();
    }
}

async function handleEmailOtpList(query) {
    try {
        const { user_id } = query || {};
        if (!user_id) return { success: false, error: 'user_id is required' };
        const { rows } = await pool.query(
            `SELECT email, is_primary, verified_at FROM user_emails WHERE user_id = $1 ORDER BY is_primary DESC, verified_at DESC NULLS LAST`,
            [user_id]
        );
        return { success: true, emails: rows };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'email-otp-list-error', data: { err: err.message } }));
        return { success: false, error: err.message };
    }
}

// Removing the primary promotes the most-recently-verified remaining address; with none left,
// users.email / email_verified_at go NULL (a WeChat- or phone-only user is a normal state).
async function handleEmailOtpRemove(body) {
    const client = await pool.connect();
    try {
        const { user_id, email: rawEmail } = body || {};
        if (!user_id) return { success: false, error: 'user_id is required' };
        const email = normalizeEmail(rawEmail);
        if (!email) return { success: false, error: 'email is required' };

        await client.query('BEGIN');
        const owned = await client.query('SELECT is_primary FROM user_emails WHERE user_id = $1 AND email = $2', [user_id, email]);
        if (owned.rows.length === 0) {
            await client.query('ROLLBACK');
            return { success: false, error: 'email_not_attached' };
        }
        const wasPrimary = owned.rows[0].is_primary;
        await client.query('DELETE FROM user_emails WHERE user_id = $1 AND email = $2', [user_id, email]);

        let newPrimary = null;
        let newPrimaryVerifiedAt = null;
        if (wasPrimary) {
            const next = await client.query(
                `SELECT email, verified_at FROM user_emails WHERE user_id = $1 ORDER BY verified_at DESC NULLS LAST LIMIT 1`,
                [user_id]
            );
            if (next.rows.length > 0) {
                newPrimary = next.rows[0].email;
                newPrimaryVerifiedAt = next.rows[0].verified_at;
                await client.query('UPDATE user_emails SET is_primary = true WHERE user_id = $1 AND email = $2', [user_id, newPrimary]);
            }
            await client.query('UPDATE users SET email = $1, email_verified_at = $2 WHERE user_id = $3', [newPrimary, newPrimaryVerifiedAt, user_id]);
        }
        await client.query('COMMIT');

        console.log(JSON.stringify({ level: 'INFO', msg: 'email-otp-remove', data: { email, user_id, was_primary: wasPrimary, new_primary: newPrimary } }));
        return { success: true, new_primary: newPrimary };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.log(JSON.stringify({ level: 'ERROR', msg: 'email-otp-remove-error', data: { err: err.message } }));
        return { success: false, error: err.message };
    } finally {
        client.release();
    }
}

// Admin-only: attaches an email with no OTP proof (verified_at NULL) — the way staff give a
// user a login identity they reported out of band. Becomes primary only if the user has none.
// NOT under the bearer-exempt /email-otp/ prefix: it attaches an arbitrary address to an
// arbitrary account with zero ownership proof, so it is mounted at /admin-email-add and gated
// by requireAdminTab('users') at the router, exactly like /admin-phone-add.
async function handleEmailOtpAdminAdd(body) {
    const client = await pool.connect();
    try {
        const { user_id, email: rawEmail } = body || {};
        if (!user_id) return { success: false, error: 'user_id is required' };
        const email = normalizeEmail(rawEmail);
        if (!isValidEmail(email)) return { success: false, error: 'invalid_email' };

        await client.query('BEGIN');
        const existingPrimary = await client.query('SELECT 1 FROM user_emails WHERE user_id = $1 AND is_primary', [user_id]);
        const becomesPrimary = existingPrimary.rows.length === 0;
        const inserted = await client.query(
            `INSERT INTO user_emails (user_id, email, verified_at, is_primary) VALUES ($1, $2, NULL, $3)
             ON CONFLICT (email) DO NOTHING RETURNING email`,
            [user_id, email, becomesPrimary]
        );
        if (inserted.rows.length === 0) {
            await client.query('ROLLBACK');
            return { success: false, error: 'email_in_use' };
        }
        if (becomesPrimary) {
            await client.query('UPDATE users SET email = $1, email_verified_at = NULL WHERE user_id = $2', [email, user_id]);
        }
        await client.query('COMMIT');

        console.log(JSON.stringify({ level: 'INFO', msg: 'email-otp-admin-add', data: { email, user_id, became_primary: becomesPrimary } }));
        return { success: true, became_primary: becomesPrimary };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.log(JSON.stringify({ level: 'ERROR', msg: 'email-otp-admin-add-error', data: { err: err.message } }));
        return { success: false, error: err.message };
    } finally {
        client.release();
    }
}

module.exports = {
    handleEmailOtpSend, handleEmailOtpVerify, handleEmailOtpBind, handleEmailSetPrimary,
    handleEmailOtpList, handleEmailOtpRemove, handleEmailOtpAdminAdd,
    emailLoginAllowed, EMAIL_LOGIN_ROOT_CHANNEL,
};
