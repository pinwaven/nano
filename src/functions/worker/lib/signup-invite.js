'use strict';

// Resolve the two six-digit codes accepted by signup: a coach/admin invitation, or a user's
// referral code. Callers pass their transaction client so account creation and invite usage can
// be committed together.
async function resolveSignupInvite(db, rawCode) {
    const code = String(rawCode || '').trim();
    if (!code) return null;

    const invitation = await db.query(
        `SELECT id, channel_id, created_by
           FROM invitations
          WHERE code = $1 AND is_active = TRUE
            AND (expires_at IS NULL OR expires_at > NOW())
            AND (max_uses IS NULL OR use_count < max_uses)
          LIMIT 1`,
        [code.toUpperCase()]
    );
    if (invitation.rows.length) {
        const row = invitation.rows[0];
        let coachId = null;
        if (row.created_by) {
            const coach = await db.query(
                `SELECT id FROM coaches
                  WHERE user_id = $1 AND status = 'active' LIMIT 1`,
                [row.created_by]
            );
            coachId = coach.rows[0]?.id || null;
        }
        if (!coachId && row.channel_id) {
            const coaches = await db.query(
                `SELECT c.id FROM coaches c
                   JOIN users u ON u.user_id = c.user_id
                  WHERE u.channel_id = $1 AND c.status = 'active'`,
                [row.channel_id]
            );
            if (coaches.rows.length === 1) coachId = coaches.rows[0].id;
        }
        return { invitationId: row.id, channelId: row.channel_id, coachId, referredByUserId: null };
    }

    const referral = await db.query(
        `SELECT u.user_id, u.channel_id,
                COALESCE(own.id, assigned.id) AS coach_id
           FROM users u
           LEFT JOIN coaches own
             ON own.user_id = u.user_id AND own.status = 'active'
           LEFT JOIN coaches assigned
             ON assigned.id = u.coach_id AND assigned.status = 'active'
          WHERE u.referral_code = $1
          LIMIT 1`,
        [code]
    );
    if (!referral.rows.length) return null;
    const row = referral.rows[0];
    return {
        invitationId: null,
        channelId: row.channel_id,
        coachId: row.coach_id || null,
        referredByUserId: row.user_id,
    };
}

async function recordInvitationUse(db, invitationId, userId) {
    if (!invitationId) return;
    const updated = await db.query(
        `UPDATE invitations SET use_count = use_count + 1
          WHERE id = $1 AND is_active = TRUE
            AND (expires_at IS NULL OR expires_at > NOW())
            AND (max_uses IS NULL OR use_count < max_uses)
          RETURNING id`,
        [invitationId]
    );
    if (!updated.rows.length) throw new Error('Invitation code is no longer available');
    await db.query(
        `INSERT INTO invitation_uses (invitation_id, user_id, user_id_snapshot)
         VALUES ($1, $2, $2)
         ON CONFLICT (invitation_id, user_id_snapshot) DO NOTHING`,
        [invitationId, userId]
    );
}

module.exports = { resolveSignupInvite, recordInvitationUse };
