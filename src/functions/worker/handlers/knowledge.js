'use strict';

/**
 * CRUD for knowledge_entries — Viva's (persona-agnostic going forward) curated knowledge
 * base, split into 'essential' (always injected — see lib/knowledgeBase.js's
 * getEssentialBlock()) and 'optional' (matched on request — findRelevantEntries()) tiers.
 * Mirrors handlers/kino.js's kino_chip_models CRUD block.
 */
const { pool } = require('../lib/db');

async function handleGetKnowledgeEntries() {
    try {
        const result = await pool.query(`
            SELECT id, persona_type, tier, category, topic, content_zh, evidence_level,
                   status, sort_order, last_reviewed, reviewed_by, created_at, updated_at
            FROM knowledge_entries
            ORDER BY tier, persona_type, sort_order, id
        `);
        return { success: true, entries: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

function normalizeKnowledgeEntryInput(body) {
    const out = {};
    if (typeof body.id === 'string') out.id = body.id.trim();
    if (typeof body.persona_type === 'string') out.persona_type = body.persona_type.trim() || 'viva';
    if (typeof body.tier === 'string') out.tier = body.tier.trim();
    if (typeof body.category === 'string') out.category = body.category.trim() || null;
    if (Array.isArray(body.topic)) {
        out.topic = body.topic.map(t => typeof t === 'string' ? t.trim() : '').filter(Boolean);
    }
    if (typeof body.content_zh === 'string') out.content_zh = body.content_zh.trim();
    if (typeof body.evidence_level === 'string') out.evidence_level = body.evidence_level.trim() || null;
    if (typeof body.status === 'string') out.status = body.status.trim() || 'active';
    if (body.sort_order !== undefined) {
        const n = parseInt(body.sort_order, 10);
        out.sort_order = Number.isFinite(n) ? n : 0;
    }
    if (typeof body.last_reviewed === 'string') out.last_reviewed = body.last_reviewed.trim() || null;
    if (typeof body.reviewed_by === 'string') out.reviewed_by = body.reviewed_by.trim() || null;
    return out;
}

const VALID_TIERS = new Set(['essential', 'optional']);

function validateKnowledgeEntry(e) {
    if (!e.id) return 'id is required';
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(e.id)) return 'id must be lowercase kebab-case (letters, digits, hyphens)';
    if (!e.tier || !VALID_TIERS.has(e.tier)) return "tier must be 'essential' or 'optional'";
    if (!e.content_zh) return 'content_zh is required';
    if (e.tier === 'optional' && (!Array.isArray(e.topic) || e.topic.length === 0)) {
        return 'topic (non-empty array) is required for optional-tier entries';
    }
    if (e.status === 'active' && !e.reviewed_by) {
        return 'reviewed_by is required before an entry can be set to active';
    }
    return null;
}

async function handlePostKnowledgeEntry(body) {
    try {
        const e = normalizeKnowledgeEntryInput(body || {});
        const err = validateKnowledgeEntry({ status: 'active', ...e });
        if (err) return { success: false, error: err };
        const result = await pool.query(
            `INSERT INTO knowledge_entries
                (id, persona_type, tier, category, topic, content_zh, evidence_level, status, sort_order, last_reviewed, reviewed_by)
             VALUES ($1, COALESCE($2, 'viva'), $3, $4, COALESCE($5, '{}'), $6, $7, COALESCE($8, 'active'), COALESCE($9, 0), $10, $11)
             RETURNING id`,
            [e.id, e.persona_type || null, e.tier, e.category || null, e.topic || null, e.content_zh,
             e.evidence_level || null, e.status || null, e.sort_order ?? null, e.last_reviewed || null, e.reviewed_by || null]
        );
        return { success: true, id: result.rows[0].id };
    } catch (err) {
        if (err.code === '23505') return { success: false, error: 'An entry with this id already exists' };
        return { success: false, error: err.message };
    }
}

async function handlePutKnowledgeEntry(id, body) {
    try {
        const e = normalizeKnowledgeEntryInput(body || {});

        const existing = await pool.query('SELECT * FROM knowledge_entries WHERE id = $1', [id]);
        if (existing.rowCount === 0) return { success: false, error: 'Entry not found' };
        const err = validateKnowledgeEntry({ ...existing.rows[0], ...e });
        if (err) return { success: false, error: err };

        const sets = [];
        const params = [];
        const push = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };

        if ('persona_type'   in e) push('persona_type',   e.persona_type);
        if ('tier'           in e) push('tier',           e.tier);
        if ('category'       in e) push('category',       e.category);
        if ('topic'          in e) push('topic',          e.topic);
        if ('content_zh'     in e) push('content_zh',     e.content_zh);
        if ('evidence_level' in e) push('evidence_level', e.evidence_level);
        if ('status'         in e) push('status',         e.status);
        if ('sort_order'     in e) push('sort_order',     e.sort_order);
        if ('last_reviewed'  in e) push('last_reviewed',  e.last_reviewed);
        if ('reviewed_by'    in e) push('reviewed_by',    e.reviewed_by);

        if (sets.length === 0) return { success: false, error: 'No fields to update' };
        sets.push('updated_at = CURRENT_TIMESTAMP');
        params.push(id);

        const result = await pool.query(
            `UPDATE knowledge_entries SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING id`,
            params
        );
        if (result.rowCount === 0) return { success: false, error: 'Entry not found' };
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleDeleteKnowledgeEntry(id) {
    try {
        const result = await pool.query('DELETE FROM knowledge_entries WHERE id = $1 RETURNING id', [id]);
        if (result.rowCount === 0) return { success: false, error: 'Entry not found' };
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = {
    handleGetKnowledgeEntries,
    handlePostKnowledgeEntry,
    handlePutKnowledgeEntry,
    handleDeleteKnowledgeEntry,
};
