'use strict';

const crypto = require('crypto');
const { pool } = require('../lib/db');
const { resolveEffectivePersona, hasActiveVivaAccess, hasActiveVivaAgAccess } = require('../lib/persona');
const { grantPersonaOverride } = require('../lib/personaOverride');

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
            `SELECT u.viva_subscription_expires_at, u.persona_override_type, u.persona_override_expires_at,
                    u.viva_ag_expires_at,
                    COALESCE(c.config->>'persona_type', 'nano') AS channel_persona_type
             FROM users u LEFT JOIN channels c ON c.id = u.channel_id
             WHERE u.user_id = $1 OR u.external_id = $1 LIMIT 1`,
            [openid]
        );
        if (result.rows.length === 0) return { success: false, error: 'User not found' };
        const row = result.rows[0];
        const effectivePersona = resolveEffectivePersona({
            channelPersonaType: row.channel_persona_type,
            personaOverrideType: row.persona_override_type,
            personaOverrideExpiresAt: row.persona_override_expires_at,
        });
        // Prefer the generalized override's expiry once active (covers a Viva grant on a
        // non-Viva channel too); fall back to the legacy column for any not-yet-migrated row.
        const vivaExpiresAt = row.persona_override_type === 'viva'
            ? row.persona_override_expires_at
            : row.viva_subscription_expires_at;
        // Viva AG is an add-on, so "active" means an active Viva grant AND an active AG
        // window — the same composite the server-side gates in handlers/viva_ag.js enforce.
        // This field only drives whether the miniapp renders the AG subtab at all; it is
        // cosmetic, and every AG endpoint re-checks entitlement server-side.
        const vivaAgActive = hasActiveVivaAccess(row) && hasActiveVivaAgAccess(row);
        return {
            success: true,
            persona_type: effectivePersona,
            viva_subscription_expires_at: vivaExpiresAt,
            viva_ag_expires_at: row.viva_ag_expires_at,
            viva_ag_active: vivaAgActive,
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
            `SELECT plan_key, label, label_zh, duration_days, product_type FROM viva_subscription_plans
             WHERE is_active = TRUE ORDER BY duration_days ASC`
        );
        return { success: true, plans: result.rows };
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handleGetVivaSubscriptionPlans failed', error: err.message }));
        return { success: false, error: err.message };
    }
}

// Legacy Viva-only entry point (GCN code redemption / checkout-confirmed auto-redeem).
// Now a thin wrapper over the generalized override mechanism (persona_type='viva') —
// see migration_users_persona_override.sql / lib/personaOverride.js. Still mirrors into
// the legacy viva_subscription_expires_at column for back-compat reads, and logs a
// persona_subscription_grants audit row so the admin UI shows one unified history
// regardless of whether a grant came from a code redemption or a direct admin grant.
async function _extendUserSubscription(client, userId, durationDays, productType = 'viva') {
    // Every product grants the Viva persona window: for 'viva' that IS the product, and for
    // 'viva_ag' it's a prerequisite — requireVivaAgAccess() (lib/vivaAgAccess.js) is a composite
    // of effective-persona-is-viva AND a live Viva grant AND a live AG grant, so granting only
    // the AG column would leave a paying buyer locked out of the subtab they just bought.
    const override = await grantPersonaOverride(client, userId, 'viva', durationDays);
    if (!override) return null;
    await client.query(
        `UPDATE users SET viva_subscription_expires_at = $2 WHERE user_id = $1`,
        [userId, override.persona_override_expires_at]
    );
    await client.query(
        `INSERT INTO persona_subscription_grants (user_id, persona_type, action, duration_days, new_expires_at, note, granted_by, channel_id)
         SELECT $1, 'viva', 'code_redeemed', $2, $3, 'Code redeemed', 'gcn', channel_id FROM users WHERE user_id = $1`,
        [userId, durationDays, override.persona_override_expires_at]
    );

    if (productType !== 'viva_ag') return override.persona_override_expires_at;

    // Same stacking semantics as grantPersonaOverride and handlePostAdminUserVivaAg: extend a
    // live window, restart from now on an expired/absent one. A second audit row (persona_type
    // 'viva_ag') so the admin history shows that one purchase moved two entitlements.
    const { rows: [agRow] } = await client.query(
        `UPDATE users
         SET viva_ag_expires_at = CASE
                 WHEN viva_ag_expires_at > NOW() THEN viva_ag_expires_at + ($2 || ' days')::interval
                 ELSE NOW() + ($2 || ' days')::interval
             END
         WHERE user_id = $1
         RETURNING viva_ag_expires_at`,
        [userId, durationDays]
    );
    await client.query(
        `INSERT INTO persona_subscription_grants (user_id, persona_type, action, duration_days, new_expires_at, note, granted_by, channel_id)
         SELECT $1, 'viva_ag', 'code_redeemed', $2, $3, 'Code redeemed', 'gcn', channel_id FROM users WHERE user_id = $1`,
        [userId, durationDays, agRow?.viva_ag_expires_at || null]
    );
    return override.persona_override_expires_at;
}

// A free, time-boxed Viva AG window so a user who uploads a chronic food-sensitivity panel gets
// a deep review of it without buying the add-on (§40). Audited like every other grant, with its
// own note, so the admin history never shows a free review as a purchase.
//
// IT WILL NOT FLIP A NANO USER'S PERSONA. requireVivaAgAccess is a composite of
// effective-persona-is-viva AND a live Viva grant AND a live AG grant, and the only way to give a
// nano-channel user the first of those is persona_override_type = 'viva' — which switches their
// whole assistant's brand, prompts and (persona-scoped) chat history. Rebranding someone's
// assistant as a side effect of uploading a PDF is not a trade this is allowed to make, so a user
// who is not already effectively Viva simply does not get the review. The panel, the restrictions
// and the formulation weighting all work for them regardless; only the narrated review is skipped.
async function grantFoodPanelReviewAccess(userId, durationDays = 30) {
    const client = await pool.connect();
    try {
        const { rows: [row] } = await client.query(
            `SELECT u.user_id, u.persona_override_type, u.persona_override_expires_at,
                    c.config->>'persona_type' AS channel_persona_type
               FROM users u LEFT JOIN channels c ON c.id = u.channel_id
              WHERE u.user_id = $1`,
            [userId]
        );
        if (!row) return { granted: false, reason: 'user_not_found' };

        const effective = resolveEffectivePersona({
            channelPersonaType: row.channel_persona_type,
            personaOverrideType: row.persona_override_type,
            personaOverrideExpiresAt: row.persona_override_expires_at,
        });
        if (effective !== 'viva') return { granted: false, reason: 'not_viva_persona' };

        await client.query('BEGIN');
        // Same stacking semantics as every other grant: extend a live window, restart from now on
        // an expired one. A user who already pays for AG loses nothing by uploading a panel.
        const override = await grantPersonaOverride(client, userId, 'viva', durationDays);
        await client.query(
            `UPDATE users SET viva_subscription_expires_at = $2 WHERE user_id = $1`,
            [userId, override.persona_override_expires_at]
        );
        const { rows: [agRow] } = await client.query(
            `UPDATE users
                SET viva_ag_expires_at = CASE
                        WHEN viva_ag_expires_at > NOW() THEN viva_ag_expires_at + ($2 || ' days')::interval
                        ELSE NOW() + ($2 || ' days')::interval
                    END
              WHERE user_id = $1
              RETURNING viva_ag_expires_at`,
            [userId, durationDays]
        );
        for (const [persona, expires] of [['viva', override.persona_override_expires_at],
                                          ['viva_ag', agRow?.viva_ag_expires_at || null]]) {
            await client.query(
                `INSERT INTO persona_subscription_grants
                    (user_id, persona_type, action, duration_days, new_expires_at, note, granted_by, channel_id)
                 SELECT $1, $2, 'granted', $3, $4, 'Free review of an uploaded food-sensitivity panel', 'system', channel_id
                   FROM users WHERE user_id = $1`,
                [userId, persona, durationDays, expires]
            );
        }
        await client.query('COMMIT');
        return { granted: true, viva_ag_expires_at: agRow?.viva_ag_expires_at || null };
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) { /* the connection is already gone */ }
        console.error(JSON.stringify({ level: 'ERROR', msg: 'grantFoodPanelReviewAccess failed', error: err.message }));
        return { granted: false, reason: 'internal_error' };
    } finally {
        client.release();
    }
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
            `SELECT duration_days, product_type FROM viva_subscription_plans WHERE plan_key = $1 AND is_active = TRUE`,
            [plan_key]
        );
        if (planRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return { success: false, error: 'invalid_plan_key' };
        }
        const durationDays = planRes.rows[0].duration_days;
        const productType = planRes.rows[0].product_type || 'viva';

        const insertRes = await client.query(
            `INSERT INTO viva_subscription_codes (code, plan_key, duration_days, product_type, order_ref, purchaser_openid, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW() + INTERVAL '1 year')
             ON CONFLICT (order_ref) DO NOTHING
             RETURNING id, code, plan_key, duration_days, product_type, status, expires_at`,
            [_generateSubscriptionCode(), plan_key, durationDays, productType, order_ref, purchaser_openid || null]
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
                `SELECT id, code, plan_key, duration_days, product_type, status, expires_at FROM viva_subscription_codes WHERE order_ref = $1`,
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
                await _extendUserSubscription(client, auto_redeem_openid, codeRow.duration_days, codeRow.product_type || 'viva');
                codeRow.status = redeemRes.rows[0].status;
            }
        }

        await client.query('COMMIT');
        return {
            success: true,
            code: codeRow.code,
            plan_key: codeRow.plan_key,
            duration_days: codeRow.duration_days,
            product_type: codeRow.product_type || 'viva',
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
             RETURNING plan_key, duration_days, product_type`,
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

        const { duration_days, product_type } = claim.rows[0];
        const newExpiresAt = await _extendUserSubscription(client, openid, duration_days, product_type || 'viva');

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
            `SELECT vsc.id, vsc.code, vsc.plan_key, vsc.duration_days, vsc.product_type, vsc.status, vsc.order_ref,
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
    grantFoodPanelReviewAccess,
    handleGetVivaSubscriptionStatus,
    handleGetVivaSubscriptionPlans,
    handlePostVivaSubscriptionCheckoutConfirmed,
    handlePostVivaSubscriptionRedeem,
    handleGetVivaSubscriptionCodes,
    handlePutVivaSubscriptionCode,
};
