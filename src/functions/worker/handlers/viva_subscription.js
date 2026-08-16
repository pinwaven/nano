'use strict';

const crypto = require('crypto');
const { pool } = require('../lib/db');

// High-entropy, unguessable code — unlike kino_chips.chip_code (sequential KNC{8}-{4}), a
// subscription code is a bearer credential worth real money if guessed. 12 random bytes
// base64url-encoded gives 16 chars, ~96 bits of entropy.
function _generateSubscriptionCode() {
    return crypto.randomBytes(12).toString('base64url').toUpperCase();
}

// Lightweight status check the miniapp calls after login (rather than threading these two
// columns through login.js's many branched user-lookup queries) — persona_type + subscription
// expiry are the only two fields the client needs to decide whether to show the redeem
// entry/banner and gate access to the Viva chat UI locally.
async function handleGetVivaSubscriptionStatus(openid) {
    if (!openid) return { success: false, error: 'openid is required' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const result = await pool.query(
            `SELECT u.viva_subscription_expires_at, COALESCE(c.config->>'persona_type', 'nano') AS persona_type
             FROM users u LEFT JOIN channels c ON c.id = u.channel_id
             WHERE u.user_id = $1 OR u.external_id = $1 LIMIT 1`,
            [openid]
        );
        if (result.rows.length === 0) return { success: false, error: 'User not found' };
        return {
            success: true,
            persona_type: result.rows[0].persona_type,
            viva_subscription_expires_at: result.rows[0].viva_subscription_expires_at,
        };
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handleGetVivaSubscriptionStatus failed', error: err.message }));
        return { success: false, error: err.message };
    }
}

async function handleGetVivaSubscriptionPlans() {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const result = await pool.query(
            `SELECT plan_key, label, label_zh, duration_days FROM viva_subscription_plans
             WHERE is_active = TRUE ORDER BY duration_days ASC`
        );
        return { success: true, plans: result.rows };
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handleGetVivaSubscriptionPlans failed', error: err.message }));
        return { success: false, error: err.message };
    }
}

// Extends (stacks) a user's viva_subscription_expires_at — never resets backward. Shared by
// the redeem endpoint and checkout-confirmed's auto_redeem_openid path.
async function _extendUserSubscription(client, userId, durationDays) {
    const result = await client.query(
        `UPDATE users
         SET viva_subscription_expires_at = GREATEST(COALESCE(viva_subscription_expires_at, NOW()), NOW()) + ($2 || ' days')::interval
         WHERE user_id = $1
         RETURNING viva_subscription_expires_at`,
        [userId, durationDays]
    );
    return result.rows[0]?.viva_subscription_expires_at || null;
}

// GCN-allowed-path — called by GCN after payment is confirmed. Idempotent by order_ref
// (deliberate deviation from handlePostFormulationPurchaseConfirmed's plain-UPDATE pattern:
// this mints a valuable code rather than just setting a timestamp, so a retried/replayed call
// must never mint a second one). auto_redeem_openid present only for "buy for myself" —
// GCN's checkout owns the self-vs-gift choice and has no nano user session to call the
// user-authenticated redeem endpoint with, so self-purchase redemption happens inline here.
async function handlePostVivaSubscriptionCheckoutConfirmed(body) {
    const { order_ref, plan_key, purchaser_openid, auto_redeem_openid } = body || {};
    if (!order_ref || !plan_key) {
        return { success: false, error: 'order_ref and plan_key are required' };
    }
    if (!pool) return { success: false, error: 'Database pool not initialized' };

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const planRes = await client.query(
            `SELECT duration_days FROM viva_subscription_plans WHERE plan_key = $1 AND is_active = TRUE`,
            [plan_key]
        );
        if (planRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return { success: false, error: 'invalid_plan_key' };
        }
        const durationDays = planRes.rows[0].duration_days;

        const insertRes = await client.query(
            `INSERT INTO viva_subscription_codes (code, plan_key, duration_days, order_ref, purchaser_openid, expires_at)
             VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '1 year')
             ON CONFLICT (order_ref) DO NOTHING
             RETURNING id, code, plan_key, duration_days, status, expires_at`,
            [_generateSubscriptionCode(), plan_key, durationDays, order_ref, purchaser_openid || null]
        );

        let codeRow;
        let freshlyMinted;
        if (insertRes.rows.length > 0) {
            codeRow = insertRes.rows[0];
            freshlyMinted = true;
        } else {
            // Replay of an already-processed order_ref — return the existing row unchanged,
            // never mint (or auto-redeem) twice.
            const existing = await client.query(
                `SELECT id, code, plan_key, duration_days, status, expires_at FROM viva_subscription_codes WHERE order_ref = $1`,
                [order_ref]
            );
            codeRow = existing.rows[0];
            freshlyMinted = false;
        }

        if (freshlyMinted && auto_redeem_openid) {
            const redeemRes = await client.query(
                `UPDATE viva_subscription_codes
                 SET status = 'redeemed', redeemed_by_user_id = $2, redeemed_at = NOW()
                 WHERE id = $1 AND status = 'unredeemed'
                 RETURNING status, redeemed_at`,
                [codeRow.id, auto_redeem_openid]
            );
            if (redeemRes.rows.length > 0) {
                await _extendUserSubscription(client, auto_redeem_openid, codeRow.duration_days);
                codeRow.status = redeemRes.rows[0].status;
            }
        }

        await client.query('COMMIT');
        return {
            success: true,
            code: codeRow.code,
            plan_key: codeRow.plan_key,
            duration_days: codeRow.duration_days,
            status: codeRow.status,
            redeemed: codeRow.status === 'redeemed',
            expires_at: codeRow.status === 'unredeemed' ? codeRow.expires_at : null,
        };
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handlePostVivaSubscriptionCheckoutConfirmed failed', error: err.message }));
        return { success: false, error: err.message };
    } finally {
        client.release();
    }
}

// Miniapp-facing — normal user session (openid), NOT a GCN_ALLOWED_PATH. Redeems a code
// entered manually (the gift path) or re-entered by a user who received a code some other way.
async function handlePostVivaSubscriptionRedeem(body) {
    const { openid, code } = body || {};
    if (!openid || !code) return { success: false, status: 'missing_params' };
    if (!pool) return { success: false, status: 'internal_error' };

    const normalizedCode = String(code).trim().toUpperCase();
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const claim = await client.query(
            `UPDATE viva_subscription_codes
             SET status = 'redeemed', redeemed_by_user_id = $2, redeemed_at = NOW()
             WHERE code = $1 AND status = 'unredeemed' AND (expires_at IS NULL OR expires_at > NOW())
             RETURNING plan_key, duration_days`,
            [normalizedCode, openid]
        );

        if (claim.rows.length === 0) {
            await client.query('ROLLBACK');
            const existing = await pool.query(
                `SELECT status, expires_at FROM viva_subscription_codes WHERE code = $1`,
                [normalizedCode]
            );
            if (existing.rows.length === 0) return { success: false, status: 'invalid_code' };
            const row = existing.rows[0];
            if (row.status === 'redeemed') return { success: false, status: 'already_used' };
            if (row.status === 'revoked') return { success: false, status: 'revoked' };
            if (row.expires_at && new Date(row.expires_at) <= new Date()) return { success: false, status: 'code_expired' };
            return { success: false, status: 'invalid_code' };
        }

        const { duration_days } = claim.rows[0];
        const newExpiresAt = await _extendUserSubscription(client, openid, duration_days);

        await client.query('COMMIT');
        return { success: true, new_expires_at: newExpiresAt };
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handlePostVivaSubscriptionRedeem failed', error: err.message }));
        return { success: false, status: 'internal_error' };
    } finally {
        client.release();
    }
}

// Admin (superadmin) — list codes for the VivaSubscriptionsTab, most recent first.
async function handleGetVivaSubscriptionCodes(query) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const { status } = query || {};
        const params = [];
        let where = '';
        if (status) {
            params.push(status);
            where = `WHERE vsc.status = $${params.length}`;
        }
        const result = await pool.query(
            `SELECT vsc.id, vsc.code, vsc.plan_key, vsc.duration_days, vsc.status, vsc.order_ref,
                    vsc.purchaser_openid, vsc.redeemed_by_user_id, u.nickname AS redeemed_by_nickname,
                    vsc.redeemed_at, vsc.expires_at, vsc.created_at
             FROM viva_subscription_codes vsc
             LEFT JOIN users u ON u.user_id = vsc.redeemed_by_user_id
             ${where}
             ORDER BY vsc.created_at DESC
             LIMIT 500`,
            params
        );
        return { success: true, codes: result.rows };
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handleGetVivaSubscriptionCodes failed', error: err.message }));
        return { success: false, error: err.message };
    }
}

// Admin (superadmin) — soft-revoke. Only an unredeemed code can be revoked: revoking after
// redemption would need to also claw back users.viva_subscription_expires_at, which is a
// separate, not-yet-built action (known v1 limitation, see plan doc).
async function handlePutVivaSubscriptionCode(id, body) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const { status } = body || {};
        if (status !== 'revoked') return { success: false, error: 'only status=revoked is supported' };

        const result = await pool.query(
            `UPDATE viva_subscription_codes SET status = 'revoked' WHERE id = $1 AND status = 'unredeemed' RETURNING id, status`,
            [id]
        );
        if (result.rows.length === 0) return { success: false, error: 'code_not_found_or_not_revocable' };
        return { success: true, code: result.rows[0] };
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handlePutVivaSubscriptionCode failed', error: err.message }));
        return { success: false, error: err.message };
    }
}

module.exports = {
    handleGetVivaSubscriptionStatus,
    handleGetVivaSubscriptionPlans,
    handlePostVivaSubscriptionCheckoutConfirmed,
    handlePostVivaSubscriptionRedeem,
    handleGetVivaSubscriptionCodes,
    handlePutVivaSubscriptionCode,
};
