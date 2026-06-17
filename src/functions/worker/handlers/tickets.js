const { pool } = require('../lib/db');
const ossLib = require('../lib/oss');

const TICKET_STATUSES   = new Set(['open', 'in_progress', 'resolved', 'closed']);
const TICKET_PRIORITIES = new Set(['low', 'normal', 'high']);

async function handleGetTickets(channelId) {
    try {
        if (channelId) {
            const result = await pool.query(
                `SELECT t.id, t.title, t.description, t.status, t.priority, t.images, t.reporter, t.created_at, t.updated_at
                 FROM tickets t
                 LEFT JOIN users u ON u.external_id = t.reporter
                 WHERE t.channel_id = $1
                    OR (t.channel_id IS NULL AND u.channel_id = $1)
                 ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'resolved' THEN 2 ELSE 3 END, t.created_at DESC`,
                [channelId]
            );
            return { success: true, tickets: result.rows };
        }
        const result = await pool.query(
            `SELECT id, title, description, status, priority, images, reporter, created_at, updated_at
             FROM tickets ORDER BY
                 CASE status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'resolved' THEN 2 ELSE 3 END,
                 created_at DESC`
        );
        return { success: true, tickets: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

function normalizeTicketInput(body) {
    const out = {};
    if (typeof body.title       === 'string') out.title       = body.title.trim();
    if (typeof body.description === 'string') out.description = body.description.trim() || null;
    if (typeof body.status      === 'string') {
        const s = body.status.trim();
        if (!TICKET_STATUSES.has(s)) throw new Error(`Invalid status: ${s}`);
        out.status = s;
    }
    if (typeof body.priority    === 'string') {
        const p = body.priority.trim();
        if (!TICKET_PRIORITIES.has(p)) throw new Error(`Invalid priority: ${p}`);
        out.priority = p;
    }
    if (Array.isArray(body.images)) {
        out.images = body.images.filter(k => typeof k === 'string' && k.trim()).map(k => k.trim());
    }
    if (typeof body.reporter    === 'string') out.reporter    = body.reporter.trim() || null;
    return out;
}

async function handlePostTicket(body, adminCtx = {}) {
    try {
        const t = normalizeTicketInput(body || {});
        if (!t.title) return { success: false, error: 'title is required' };
        const channelId = adminCtx.channelId || null;
        const result = await pool.query(
            `INSERT INTO tickets (title, description, status, priority, images, reporter, channel_id)
             VALUES ($1, $2, COALESCE($3, 'open'), COALESCE($4, 'normal'), COALESCE($5, ARRAY[]::TEXT[]), $6, $7)
             RETURNING *`,
            [t.title, t.description || null, t.status, t.priority, t.images || null, t.reporter || null, channelId]
        );
        return { success: true, ticket: result.rows[0] };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePutTicket(id, body) {
    try {
        const t = normalizeTicketInput(body || {});
        const sets = [];
        const params = [];
        const push = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };

        if ('title'       in t) {
            if (!t.title) return { success: false, error: 'title cannot be empty' };
            push('title', t.title);
        }
        if ('description' in t) push('description', t.description);
        if ('status'      in t) push('status',      t.status);
        if ('priority'    in t) push('priority',    t.priority);
        if ('images'      in t) push('images',      t.images);
        if ('reporter'    in t) push('reporter',    t.reporter);

        if (sets.length === 0) return { success: false, error: 'No fields to update' };
        sets.push('updated_at = CURRENT_TIMESTAMP');
        params.push(parseInt(id));

        const result = await pool.query(
            `UPDATE tickets SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
            params
        );
        if (result.rowCount === 0) return { success: false, error: 'Ticket not found' };
        return { success: true, ticket: result.rows[0] };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleDeleteTicket(id) {
    try {
        const res = await pool.query('SELECT images FROM tickets WHERE id = $1', [parseInt(id)]);
        if (res.rows.length === 0) return { success: false, error: 'Ticket not found' };
        const images = res.rows[0].images || [];
        for (const key of images) {
            await ossLib.deleteObject(key);
        }
        await pool.query('DELETE FROM tickets WHERE id = $1', [parseInt(id)]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = {
    handleGetTickets,
    handlePostTicket,
    handlePutTicket,
    handleDeleteTicket,
};
