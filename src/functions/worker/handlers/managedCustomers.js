'use strict';

// Managed customers — login-less accounts a coach creates and operates for a B2B channel's own
// customers (SuperiorMed). docs/architecture/managed-customers.md; migration_managed_customers.sql.
//
// A managed customer is an ordinary users row (so every per-user table — biomarkers, plans,
// facts, chat — works unchanged) with account_type = 'managed', no external_id (no WeChat login),
// no user_phones row (no OTP login) and the coach-entered number in contact_phone instead. The
// coach who creates them is their coach (users.coach_id), which is what lets that coach's session
// act on them (lib/userAccess.js). Their channel's admin can release them into a regular account.

const { pool } = require('../lib/db');
const { generateUserId, requirePermission } = require('../lib/auth');
const { normalizeCnPhone } = require('../lib/phone');

const GENDERS = new Set(['male', 'female']);
const EDITABLE = ['nickname', 'first_name', 'last_name', 'birth_date', 'gender', 'contact_phone', 'external_ref', 'language'];

const MANAGED_SELECT = `
    SELECT user_id, nickname, first_name, last_name, birth_date::text AS birth_date, gender, language,
           contact_phone, external_ref, coach_id, channel_id, account_type, created_at,
           managed_created_by_coach_id, managed_released_at`;

function clean(v) {
    if (v === undefined) return undefined;
    if (v === null) return null;
    const s = String(v).trim();
    return s === '' ? null : s;
}

// Validates and normalizes the editable fields present in `body`. Returns { values } or { error }.
function readFields(body, { requireCore }) {
    const values = {};
    for (const k of EDITABLE) {
        if (body[k] !== undefined) values[k] = clean(body[k]);
    }
    if (requireCore || values.birth_date !== undefined) {
        // BioAge is computed against chronological age; without a birth date the estimator
        // silently assumes 30, which is exactly the wrong answer for a real patient.
        if (!values.birth_date || !/^\d{4}-\d{2}-\d{2}$/.test(values.birth_date) || isNaN(Date.parse(values.birth_date))) {
            return { error: 'birth_date_required' };
        }
        if (new Date(values.birth_date) > new Date()) return { error: 'birth_date_required' };
    }
    if (requireCore || values.gender !== undefined) {
        if (!GENDERS.has(values.gender)) return { error: 'gender_required' };
    }
    if (values.contact_phone) {
        const digits = values.contact_phone.replace(/[\s-]/g, '');
        if (!/^(\+?86)?1\d{10}$/.test(digits)) return { error: 'invalid_phone' };
        values.contact_phone = normalizeCnPhone(digits.replace(/^\+?86/, ''));
    }
    if (values.language && !['zh', 'en'].includes(values.language)) values.language = 'zh';
    if (requireCore && !values.nickname) {
        const name = [values.last_name, values.first_name].filter(Boolean).join('');
        values.nickname = name || values.external_ref || null;
        if (!values.nickname) return { error: 'name_required' };
    }
    return { values };
}

// The caller's coach row and whether its channel takes managed customers. coach_id has already
// been checked by lib/userAccess.js to be one of the caller's own coach rows.
async function loadCoach(coachId) {
    const { rows } = await pool.query(
        `SELECT co.id, co.user_id, u.channel_id,
                COALESCE(effective_channel_config(u.channel_id, 'managed_customers') = 'true'::jsonb, false) AS enabled
           FROM coaches co JOIN users u ON u.user_id = co.user_id
          WHERE co.id = $1`,
        [coachId]
    );
    return rows[0] || null;
}

// POST /managed-customers {coach_id, nickname?, first_name?, last_name?, birth_date, gender,
// contact_phone?, external_ref?, language?}
async function handlePostManagedCustomer(body) {
    try {
        const coachId = body && body.coach_id;
        if (!coachId) return { statusCode: 400, success: false, error: 'coach_id is required' };
        const coach = await loadCoach(coachId);
        if (!coach) return { statusCode: 404, success: false, error: 'coach_not_found' };
        if (!coach.channel_id || !coach.enabled) {
            return { statusCode: 403, success: false, error: 'managed_customers_not_enabled' };
        }
        const { values, error } = readFields(body, { requireCore: true });
        if (error) return { statusCode: 400, success: false, error };

        const userId = generateUserId();
        const { rows } = await pool.query(
            `INSERT INTO users (user_id, external_id, external_app, account_type, roles, nickname, first_name, last_name,
                                birth_date, gender, language, contact_phone, external_ref, coach_id, channel_id,
                                managed_created_by_coach_id, created_at)
             VALUES ($1, NULL, 'managed', 'managed', ARRAY['user'], $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $10, NOW())
             RETURNING user_id`,
            [userId, values.nickname, values.first_name ?? null, values.last_name ?? null, values.birth_date,
             values.gender, values.language || 'zh', values.contact_phone ?? null, values.external_ref ?? null,
             coach.id, coach.channel_id]
        );
        const created = await pool.query(`${MANAGED_SELECT} FROM users WHERE user_id = $1`, [rows[0].user_id]);
        console.log(JSON.stringify({ level: 'INFO', msg: 'managed_customer_created', data: { user_id: userId, coach_id: coach.id, channel_id: coach.channel_id } }));
        return { success: true, customer: created.rows[0] };
    } catch (err) {
        if (err.code === '23505' && /external_ref/.test(err.constraint || err.message)) {
            return { statusCode: 409, success: false, error: 'external_ref_in_use' };
        }
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handlePostManagedCustomer failed', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

// PUT /managed-customers/:user — the coach edits a customer's profile. Only while managed:
// once released the customer owns their profile.
async function handlePutManagedCustomer(userId, body) {
    try {
        const { values, error } = readFields(body || {}, { requireCore: false });
        if (error) return { statusCode: 400, success: false, error };
        const keys = Object.keys(values);
        if (keys.length === 0) return { statusCode: 400, success: false, error: 'nothing_to_update' };
        const sets = keys.map((k, i) => `${k} = $${i + 2}`);
        const { rows } = await pool.query(
            `UPDATE users SET ${sets.join(', ')}, updated_at = NOW()
              WHERE user_id = $1 AND account_type = 'managed' RETURNING user_id`,
            [userId, ...keys.map(k => values[k])]
        );
        if (!rows.length) return { statusCode: 404, success: false, error: 'not_a_managed_customer' };
        const updated = await pool.query(`${MANAGED_SELECT} FROM users WHERE user_id = $1`, [userId]);
        return { success: true, customer: updated.rows[0] };
    } catch (err) {
        if (err.code === '23505' && /external_ref/.test(err.constraint || err.message)) {
            return { statusCode: 409, success: false, error: 'external_ref_in_use' };
        }
        return { statusCode: 500, success: false, error: err.message };
    }
}

// POST /managed-customers/:user/release — the channel's admin (web admin panel) turns a managed
// customer into a regular account. The coach link and every record stay. contact_phone becomes
// the account's (unverified) phone when nobody else holds it, so the customer can sign in with
// an OTP to that number; otherwise it stays in contact_phone and the admin is told why.
async function handleReleaseManagedCustomer(userId, adminCtx) {
    const denied = requirePermission(adminCtx, 'users:write');
    if (denied) return denied;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { rows: [u] } = await client.query(
            `SELECT user_id, channel_id, account_type, contact_phone FROM users WHERE user_id = $1 FOR UPDATE`,
            [userId]
        );
        if (!u) { await client.query('ROLLBACK'); return { statusCode: 404, success: false, error: 'user_not_found' }; }
        if (u.account_type !== 'managed') { await client.query('ROLLBACK'); return { statusCode: 409, success: false, error: 'not_a_managed_customer' }; }
        if (adminCtx.role === 'channel') {
            // The customer's channel, or a sub-channel of the admin's (same rule as the Users tab).
            const { rows: [own] } = await client.query(
                `WITH RECURSIVE tree AS (SELECT id FROM channels WHERE id = $1
                    UNION ALL SELECT c.id FROM channels c JOIN tree t ON c.parent_channel_id = t.id)
                 SELECT 1 AS ok FROM tree WHERE id = $2`,
                [adminCtx.channelId, u.channel_id]
            );
            if (!own) { await client.query('ROLLBACK'); return { statusCode: 403, success: false, error: 'Forbidden' }; }
        }

        let phoneMoved = false;
        let phoneNote = null;
        if (u.contact_phone) {
            const clash = await client.query(
                `SELECT 1 FROM users WHERE phone = $1 AND user_id <> $2
                  UNION ALL SELECT 1 FROM user_phones WHERE phone = $1 AND user_id <> $2 LIMIT 1`,
                [u.contact_phone, userId]
            );
            if (clash.rows.length) {
                phoneNote = 'phone_in_use';
            } else {
                await client.query(`UPDATE users SET phone = $2, phone_verified_at = NULL WHERE user_id = $1`, [userId, u.contact_phone]);
                await client.query(
                    `INSERT INTO user_phones (user_id, phone, is_primary) VALUES ($1, $2, true) ON CONFLICT (phone) DO NOTHING`,
                    [userId, u.contact_phone]
                );
                phoneMoved = true;
            }
        }
        const releasedBy = adminCtx.username || adminCtx.accountId || adminCtx.role;
        await client.query(
            `UPDATE users SET account_type = 'regular', managed_released_at = NOW(), managed_released_by = $2,
                    contact_phone = CASE WHEN $3 THEN NULL ELSE contact_phone END, updated_at = NOW()
              WHERE user_id = $1`,
            [userId, String(releasedBy), phoneMoved]
        );
        await client.query('COMMIT');
        console.log(JSON.stringify({ level: 'INFO', msg: 'managed_customer_released', data: { user_id: userId, by: releasedBy, phone_moved: phoneMoved } }));
        return { success: true, user_id: userId, phone_moved: phoneMoved, ...(phoneNote && { phone_note: phoneNote }) };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        return { statusCode: 500, success: false, error: err.message };
    } finally {
        client.release();
    }
}

module.exports = {
    handlePostManagedCustomer,
    handlePutManagedCustomer,
    handleReleaseManagedCustomer,
    _private: { readFields },
};
