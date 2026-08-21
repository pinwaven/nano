// Generalized grant/revoke primitive backing per-user persona subscriptions (see
// migration_users_persona_override.sql). Callers are responsible for inserting the
// matching persona_subscription_grants audit row — kept separate so the GCN-redemption
// path and the admin-grant path can log different `granted_by`/`action` values.

// Granting the SAME persona a user already has an active override for stacks/extends
// the expiry (mirrors the old Viva-only GREATEST(...) behavior). Granting a DIFFERENT
// persona resets to a fresh duration window rather than combining across persona types.
async function grantPersonaOverride(client, userId, personaType, durationDays) {
    const result = await client.query(
        `UPDATE users
         SET persona_override_type = $2,
             persona_override_expires_at = CASE
                 WHEN persona_override_type = $2 AND persona_override_expires_at > NOW()
                     THEN persona_override_expires_at + ($3 || ' days')::interval
                 ELSE NOW() + ($3 || ' days')::interval
             END
         WHERE user_id = $1
         RETURNING persona_override_type, persona_override_expires_at`,
        [userId, personaType, durationDays]
    );
    return result.rows[0] || null;
}

async function revokePersonaOverride(client, userId) {
    await client.query(
        `UPDATE users SET persona_override_type = NULL, persona_override_expires_at = NULL WHERE user_id = $1`,
        [userId]
    );
}

// Auto-grant applied to every brand-new signup (product decision, 2026-08-19 — the
// one-time bulk grant to the existing user base doesn't cover anyone who joins
// afterward). Callers pass whichever client/pool they used for the signup INSERT so
// this runs in the same transaction where one exists. Mirrors into the legacy
// viva_subscription_expires_at column and logs a persona_subscription_grants audit
// row, same as every other grant path. Best-effort by design — callers should not let
// a failure here block account creation, since missing a promo trial is much less bad
// than failing a signup.
const SIGNUP_TRIAL_DURATION_DAYS = 30;

async function grantSignupTrial(client, userId, channelId) {
    const override = await grantPersonaOverride(client, userId, 'viva', SIGNUP_TRIAL_DURATION_DAYS);
    if (!override) return null;
    await client.query(
        `UPDATE users SET viva_subscription_expires_at = $2 WHERE user_id = $1`,
        [userId, override.persona_override_expires_at]
    );
    await client.query(
        `INSERT INTO persona_subscription_grants (user_id, persona_type, action, duration_days, new_expires_at, note, granted_by, channel_id)
         VALUES ($1, 'viva', 'grant', $2, $3, 'New signup trial (auto-grant)', 'system-signup-trial', $4)`,
        [userId, SIGNUP_TRIAL_DURATION_DAYS, override.persona_override_expires_at, channelId || null]
    );
    return override;
}

module.exports = { grantPersonaOverride, revokePersonaOverride, grantSignupTrial };
