'use strict';

/**
 * Shared server-side entitlement gate for every Viva AG surface (document management and the
 * job queue). Lives in lib/ rather than in either handler because both need it and neither
 * should require the other.
 *
 * Viva AG is an ADD-ON, so "has access" is a COMPOSITE of three things, not just the AG column:
 *
 *   1. the user's effective persona is 'viva'
 *   2. they hold a live Viva grant  (hasActiveVivaAccess)
 *   3. they hold a live AG add-on   (hasActiveVivaAgAccess)
 *
 * Conditions 1-2 mirror handlePostChat's existing Viva paywall exactly. That matters: because
 * hasActiveVivaAccess() only returns true for an explicit per-user override, a user whose viva
 * persona comes from the channel default with no grant of their own fails it — which is
 * precisely what the chatbox already does to them (they get the "subscription expired" block).
 * Mirroring it keeps AG consistent with the chatbox instead of inventing a second, looser
 * definition of "is a Viva subscriber".
 */

const { pool } = require('./db');
const { resolveEffectivePersona, hasActiveVivaAccess, hasActiveVivaAgAccess } = require('./persona');

// Returned as `reason` so the client can tell "you need Viva" apart from "you need the AG
// add-on" and route the user to the right upsell.
const REASONS = {
    MISSING_OPENID: 'missing_openid',
    USER_NOT_FOUND: 'user_not_found',
    VIVA_INACTIVE: 'viva_inactive',
    VIVA_AG_INACTIVE: 'viva_ag_inactive',
};

async function loadUserForVivaAg(openid) {
    const { rows } = await pool.query(
        `SELECT u.user_id, u.external_id, u.nickname, u.gender, u.birth_date, u.language,
                u.bio_data, u.channel_id,
                u.persona_override_type, u.persona_override_expires_at, u.viva_ag_expires_at,
                COALESCE(c.config->>'persona_type', 'nano') AS channel_persona_type
         FROM users u LEFT JOIN channels c ON c.id = u.channel_id
         WHERE u.user_id = $1 OR u.external_id = $1 LIMIT 1`,
        [openid]
    );
    return rows[0] || null;
}

/**
 * @returns {{ok: true, user, persona}} on success, or
 *          {{ok: false, reason, error}} where `error` is a ready-to-return handler result.
 */
async function requireVivaAgAccess(openid) {
    if (!openid) {
        return { ok: false, reason: REASONS.MISSING_OPENID, error: { success: false, reason: REASONS.MISSING_OPENID, error: 'openid is required', statusCode: 400 } };
    }
    const user = await loadUserForVivaAg(openid);
    if (!user) {
        return { ok: false, reason: REASONS.USER_NOT_FOUND, error: { success: false, reason: REASONS.USER_NOT_FOUND, error: 'User not found', statusCode: 404 } };
    }
    const persona = resolveEffectivePersona({
        channelPersonaType: user.channel_persona_type,
        personaOverrideType: user.persona_override_type,
        personaOverrideExpiresAt: user.persona_override_expires_at,
    });
    if (persona !== 'viva' || !hasActiveVivaAccess(user)) {
        return { ok: false, reason: REASONS.VIVA_INACTIVE, error: { success: false, reason: REASONS.VIVA_INACTIVE, error: 'An active Viva subscription is required', statusCode: 403 } };
    }
    if (!hasActiveVivaAgAccess(user)) {
        return { ok: false, reason: REASONS.VIVA_AG_INACTIVE, error: { success: false, reason: REASONS.VIVA_AG_INACTIVE, error: 'An active Viva AG add-on is required', statusCode: 403 } };
    }
    return { ok: true, user, persona };
}

module.exports = { requireVivaAgAccess, loadUserForVivaAg, REASONS };
