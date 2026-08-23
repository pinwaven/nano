'use strict';

const { pool } = require('../lib/db');
const { resolveEffectivePersona } = require('../lib/persona');
const { grantPersonaOverride, revokePersonaOverride } = require('../lib/personaOverride');

const ALLOWED_PERSONA_TYPES = new Set(['nano', 'viva']);

// Same channel-ownership check UserCreditModal's backend (handlers/credits.js) uses —
// superadmin unrestricted, channel admin limited to users in their own channel.
async function _loadUserForOwnershipCheck(userId, adminCtx) {
    const { rows: [u] } = await pool.query(
        'SELECT user_id, channel_id, language FROM users WHERE user_id = $1', [userId]
    );
    if (!u) return { error: { success: false, error: 'User not found', statusCode: 404 } };
    if (adminCtx.role !== 'superadmin' && String(u.channel_id) !== String(adminCtx.channelId)) {
        return { error: { success: false, error: 'Access denied', statusCode: 403 } };
    }
    return { user: u };
}

async function handleGetAdminUserPersonaSubscription(userId, adminCtx) {
    if (!userId) return { success: false, error: 'userId is required', statusCode: 400 };
    try {
        const { error, user } = await _loadUserForOwnershipCheck(userId, adminCtx);
        if (error) return error;

        const [overrideRes, channelRes, historyRes] = await Promise.all([
            pool.query('SELECT persona_override_type, persona_override_expires_at, viva_ag_expires_at FROM users WHERE user_id = $1', [userId]),
            pool.query(
                `SELECT COALESCE(c.config->>'persona_type', 'nano') AS persona_type
                 FROM users u JOIN channels c ON c.id = u.channel_id WHERE u.user_id = $1`,
                [userId]
            ),
            pool.query(
                'SELECT * FROM persona_subscription_grants WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
                [userId]
            ),
        ]);

        const override = overrideRes.rows[0] || {};
        const channelPersonaType = channelRes.rows[0]?.persona_type || 'nano';
        const effectivePersona = resolveEffectivePersona({
            channelPersonaType,
            personaOverrideType: override.persona_override_type,
            personaOverrideExpiresAt: override.persona_override_expires_at,
        });

        return {
            success: true,
            channel_persona_type: channelPersonaType,
            effective_persona_type: effectivePersona,
            persona_override_type: override.persona_override_type || null,
            persona_override_expires_at: override.persona_override_expires_at || null,
            // Viva AG add-on, granted/revoked separately from the persona override above.
            // The history list below needs no filtering change — persona_subscription_grants
            // rows with persona_type='viva_ag' already come back from the same query.
            viva_ag_expires_at: override.viva_ag_expires_at || null,
            history: historyRes.rows,
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostAdminUserPersonaSubscription(userId, body, adminCtx) {
    if (!userId) return { success: false, error: 'userId is required', statusCode: 400 };
    const personaType = body?.persona_type;
    const durationDays = parseInt(body?.duration_days, 10);
    const note = (body?.note || '').trim();
    if (!ALLOWED_PERSONA_TYPES.has(personaType)) {
        return { success: false, error: `persona_type must be one of: ${[...ALLOWED_PERSONA_TYPES].join(', ')}`, statusCode: 400 };
    }
    if (!durationDays || durationDays <= 0) {
        return { success: false, error: 'duration_days must be a positive integer', statusCode: 400 };
    }
    if (!note) return { success: false, error: 'note is required', statusCode: 400 };

    try {
        const { error } = await _loadUserForOwnershipCheck(userId, adminCtx);
        if (error) return error;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const override = await grantPersonaOverride(client, userId, personaType, durationDays);
            if (personaType === 'viva') {
                // mirror into the legacy column for any not-yet-migrated reader
                await client.query('UPDATE users SET viva_subscription_expires_at = $2 WHERE user_id = $1',
                    [userId, override.persona_override_expires_at]);
            }
            const annotatedNote = `[Admin: ${adminCtx.username || adminCtx.accountId || 'unknown'}] ${note}`;
            await client.query(
                `INSERT INTO persona_subscription_grants (user_id, persona_type, action, duration_days, new_expires_at, note, granted_by, channel_id)
                 SELECT $1, $2, 'grant', $3, $4, $5, $6, channel_id FROM users WHERE user_id = $1`,
                [userId, personaType, durationDays, override.persona_override_expires_at, annotatedNote, adminCtx.username || adminCtx.accountId || 'unknown']
            );
            await client.query('COMMIT');
            return {
                success: true,
                persona_override_type: override.persona_override_type,
                persona_override_expires_at: override.persona_override_expires_at,
            };
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleDeleteAdminUserPersonaSubscription(userId, body, adminCtx) {
    if (!userId) return { success: false, error: 'userId is required', statusCode: 400 };
    const note = (body?.note || '').trim();
    if (!note) return { success: false, error: 'note is required', statusCode: 400 };

    try {
        const { error } = await _loadUserForOwnershipCheck(userId, adminCtx);
        if (error) return error;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const { rows: [before] } = await client.query(
                'SELECT persona_override_type FROM users WHERE user_id = $1', [userId]
            );
            if (!before?.persona_override_type) {
                await client.query('ROLLBACK');
                return { success: false, error: 'No active persona subscription to revoke', statusCode: 400 };
            }
            await revokePersonaOverride(client, userId);
            // Only clear the legacy mirror if it was actually a Viva override — a Nano
            // override never touched viva_subscription_expires_at in the first place.
            if (before.persona_override_type === 'viva') {
                await client.query('UPDATE users SET viva_subscription_expires_at = NULL WHERE user_id = $1', [userId]);
            }
            const annotatedNote = `[Admin: ${adminCtx.username || adminCtx.accountId || 'unknown'}] ${note}`;
            await client.query(
                `INSERT INTO persona_subscription_grants (user_id, persona_type, action, duration_days, new_expires_at, note, granted_by, channel_id)
                 SELECT $1, $2, 'revoke', NULL, NULL, $3, $4, channel_id FROM users WHERE user_id = $1`,
                [userId, before.persona_override_type, annotatedNote, adminCtx.username || adminCtx.accountId || 'unknown']
            );
            await client.query('COMMIT');
            return { success: true };
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ---------------------------------------------------------------------------------------
// Viva AG add-on grant/revoke.
//
// Deliberately NOT routed through grantPersonaOverride/ALLOWED_PERSONA_TYPES: that Set guards
// users.persona_override_type, which must stay 'nano'|'viva' (see
// migration_users_viva_ag_expiry.sql). AG is an add-on column with its own expiry, so it gets
// its own pair of handlers that reuse the same ownership check, the same [Admin: x] note
// annotation, and the same persona_subscription_grants audit table with persona_type='viva_ag'.
// ---------------------------------------------------------------------------------------

async function handlePostAdminUserVivaAg(userId, body, adminCtx) {
    if (!userId) return { success: false, error: 'userId is required', statusCode: 400 };
    const durationDays = parseInt(body?.duration_days, 10);
    const note = (body?.note || '').trim();
    if (!durationDays || durationDays <= 0) {
        return { success: false, error: 'duration_days must be a positive integer', statusCode: 400 };
    }
    if (!note) return { success: false, error: 'note is required', statusCode: 400 };

    try {
        const { error } = await _loadUserForOwnershipCheck(userId, adminCtx);
        if (error) return error;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            // Stacking semantics mirror grantPersonaOverride: extend a live window, restart
            // from now on an expired/absent one.
            const { rows: [updated] } = await client.query(
                `UPDATE users
                 SET viva_ag_expires_at = CASE
                         WHEN viva_ag_expires_at > NOW() THEN viva_ag_expires_at + ($2 || ' days')::interval
                         ELSE NOW() + ($2 || ' days')::interval
                     END
                 WHERE user_id = $1
                 RETURNING viva_ag_expires_at`,
                [userId, durationDays]
            );
            const annotatedNote = `[Admin: ${adminCtx.username || adminCtx.accountId || 'unknown'}] ${note}`;
            await client.query(
                `INSERT INTO persona_subscription_grants (user_id, persona_type, action, duration_days, new_expires_at, note, granted_by, channel_id)
                 SELECT $1, 'viva_ag', 'grant', $2, $3, $4, $5, channel_id FROM users WHERE user_id = $1`,
                [userId, durationDays, updated.viva_ag_expires_at, annotatedNote, adminCtx.username || adminCtx.accountId || 'unknown']
            );
            await client.query('COMMIT');
            return { success: true, viva_ag_expires_at: updated.viva_ag_expires_at };
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleDeleteAdminUserVivaAg(userId, body, adminCtx) {
    if (!userId) return { success: false, error: 'userId is required', statusCode: 400 };
    const note = (body?.note || '').trim();
    if (!note) return { success: false, error: 'note is required', statusCode: 400 };

    try {
        const { error } = await _loadUserForOwnershipCheck(userId, adminCtx);
        if (error) return error;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const { rows: [before] } = await client.query(
                'SELECT viva_ag_expires_at FROM users WHERE user_id = $1', [userId]
            );
            if (!before?.viva_ag_expires_at) {
                await client.query('ROLLBACK');
                return { success: false, error: 'No Viva AG add-on to revoke', statusCode: 400 };
            }
            await client.query('UPDATE users SET viva_ag_expires_at = NULL WHERE user_id = $1', [userId]);
            const annotatedNote = `[Admin: ${adminCtx.username || adminCtx.accountId || 'unknown'}] ${note}`;
            await client.query(
                `INSERT INTO persona_subscription_grants (user_id, persona_type, action, duration_days, new_expires_at, note, granted_by, channel_id)
                 SELECT $1, 'viva_ag', 'revoke', NULL, NULL, $2, $3, channel_id FROM users WHERE user_id = $1`,
                [userId, annotatedNote, adminCtx.username || adminCtx.accountId || 'unknown']
            );
            await client.query('COMMIT');
            return { success: true };
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// Superadmin-only cross-channel list for the AIPersonaTab global screen. Explicit role
// check here (not just nav-level gating in the web admin panel) since this is a new
// endpoint with no precedent loose-checking to inherit.
async function handleGetAdminPersonaSubscriptions(query, adminCtx) {
    if (adminCtx.role !== 'superadmin') return { success: false, error: 'Access denied', statusCode: 403 };
    try {
        const { persona_type, channel_id, status } = query || {};
        const params = [];
        const conditions = ['u.persona_override_type IS NOT NULL'];
        if (persona_type) { params.push(persona_type); conditions.push(`u.persona_override_type = $${params.length}`); }
        if (channel_id)   { params.push(channel_id);   conditions.push(`u.channel_id = $${params.length}`); }
        if (status === 'active')  conditions.push(`u.persona_override_expires_at > NOW()`);
        if (status === 'expired') conditions.push(`u.persona_override_expires_at <= NOW()`);
        const where = 'WHERE ' + conditions.join(' AND ');
        const { rows } = await pool.query(
            `SELECT u.user_id, u.nickname, u.channel_id, c.name AS channel_name,
                    COALESCE(c.config->>'persona_type', 'nano') AS channel_persona_type,
                    u.persona_override_type, u.persona_override_expires_at
             FROM users u
             LEFT JOIN channels c ON c.id = u.channel_id
             ${where}
             ORDER BY u.persona_override_expires_at DESC
             LIMIT 500`,
            params
        );
        return { success: true, subscriptions: rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = {
    handleGetAdminUserPersonaSubscription,
    handlePostAdminUserPersonaSubscription,
    handleDeleteAdminUserPersonaSubscription,
    handleGetAdminPersonaSubscriptions,
    handlePostAdminUserVivaAg,
    handleDeleteAdminUserVivaAg,
};
