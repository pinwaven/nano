'use strict';

/**
 * CRUD for user_memory_facts — personal facts a user has stated in Viva chat (dietary
 * restrictions, allergies, preferences, goals), plus manual admin/coach-added entries.
 * User-scoped, not persona-scoped. Mirrors handlers/knowledge.js's CRUD shape.
 *
 * Extraction/upsert from live chat happens in handlers/chat.js's finalizeChatReply()
 * (the remember_fact action) — this file only covers the admin/coach-facing CRUD surface.
 */
const { pool } = require('../lib/db');

async function resolveUserId(openid) {
    const result = await pool.query('SELECT user_id FROM users WHERE user_id = $1 OR external_id = $1 LIMIT 1', [openid]);
    return result.rows[0]?.user_id || null;
}

async function handleGetUserFacts(openid, coachId) {
    try {
        if (!openid) return { success: false, error: 'openid is required' };
        const user_id = await resolveUserId(openid);
        if (!user_id) return { success: false, error: 'User not found' };
        // Same coarse ownership pattern as handleGetCoachUserChat: only enforced when the
        // caller supplies its own coach_id (admin panel calls omit it and see everyone).
        if (coachId) {
            const check = await pool.query('SELECT 1 FROM users WHERE user_id = $1 AND coach_id = $2', [user_id, coachId]);
            if (check.rows.length === 0) return { success: false, error: 'Access denied', statusCode: 403 };
        }
        const result = await pool.query(
            `SELECT id, user_id, category, fact_zh, status, source, first_mentioned_at, last_mentioned_at, created_at, updated_at
             FROM user_memory_facts WHERE user_id = $1 ORDER BY status, category, last_mentioned_at DESC`,
            [user_id]
        );
        return { success: true, facts: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

const VALID_CATEGORIES = new Set(['dietary_restriction', 'allergy', 'preference', 'goal', 'other']);
const VALID_STATUSES = new Set(['active', 'inactive']);

function normalizeFactInput(body) {
    const out = {};
    if (typeof body.category === 'string') out.category = body.category.trim();
    if (typeof body.fact_zh === 'string') out.fact_zh = body.fact_zh.trim();
    if (typeof body.status === 'string') out.status = body.status.trim() || 'active';
    return out;
}

async function handlePostUserFact(body) {
    try {
        const { openid } = body || {};
        if (!openid) return { success: false, error: 'openid is required' };
        const user_id = await resolveUserId(openid);
        if (!user_id) return { success: false, error: 'User not found' };

        const f = normalizeFactInput(body || {});
        if (!f.category || !VALID_CATEGORIES.has(f.category)) return { success: false, error: 'category must be one of: ' + [...VALID_CATEGORIES].join(', ') };
        if (!f.fact_zh) return { success: false, error: 'fact_zh is required' };

        const result = await pool.query(
            `INSERT INTO user_memory_facts (user_id, category, fact_zh, status, source)
             VALUES ($1, $2, $3, COALESCE($4, 'active'), 'admin_added')
             ON CONFLICT (user_id, category, fact_zh) WHERE status = 'active'
             DO UPDATE SET last_mentioned_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
             RETURNING id`,
            [user_id, f.category, f.fact_zh, f.status || null]
        );
        return { success: true, id: result.rows[0].id };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePutUserFact(id, body) {
    try {
        const f = normalizeFactInput(body || {});
        if ('category' in f && !VALID_CATEGORIES.has(f.category)) return { success: false, error: 'category must be one of: ' + [...VALID_CATEGORIES].join(', ') };
        if ('status' in f && !VALID_STATUSES.has(f.status)) return { success: false, error: "status must be 'active' or 'inactive'" };

        const sets = [];
        const params = [];
        const push = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };

        if ('category' in f) push('category', f.category);
        if ('fact_zh'  in f) push('fact_zh', f.fact_zh);
        if ('status'   in f) push('status', f.status);

        if (sets.length === 0) return { success: false, error: 'No fields to update' };
        sets.push('updated_at = CURRENT_TIMESTAMP');
        params.push(id);

        const result = await pool.query(
            `UPDATE user_memory_facts SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING id`,
            params
        );
        if (result.rowCount === 0) return { success: false, error: 'Fact not found' };
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleDeleteUserFact(id) {
    try {
        const result = await pool.query('DELETE FROM user_memory_facts WHERE id = $1 RETURNING id', [id]);
        if (result.rowCount === 0) return { success: false, error: 'Fact not found' };
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = {
    handleGetUserFacts,
    handlePostUserFact,
    handlePutUserFact,
    handleDeleteUserFact,
};
