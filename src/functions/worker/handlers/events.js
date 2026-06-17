const { pool } = require('../lib/db');

// ── Events (线下活动) ──────────────────────────────────────────────────────────

async function handleGetEvents(query, adminCtx) {
    const { channel_id, user_id } = query;
    if (!channel_id) return { success: false, error: 'channel_id is required', statusCode: 400 };
    try {
        const r = await pool.query(
            `SELECT e.id, e.title, e.description, e.location, e.scheduled_at, e.end_at,
                    e.capacity, e.status, e.created_at,
                    (SELECT COUNT(*) FROM event_signups es WHERE es.event_id = e.id AND es.status = 'confirmed') AS signup_count,
                    ${user_id ? `EXISTS(SELECT 1 FROM event_signups es2 WHERE es2.event_id = e.id AND es2.user_id = $2 AND es2.status = 'confirmed')` : 'FALSE'} AS signed_up
             FROM events e
             WHERE e.channel_id = $1
               AND e.status != 'cancelled'
               AND e.scheduled_at > NOW() - INTERVAL '2 hours'
             ORDER BY e.scheduled_at ASC`,
            user_id ? [channel_id, user_id] : [channel_id]
        );
        return { success: true, events: r.rows };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handlePostEvent(body, adminCtx) {
    const { title, description, location, scheduled_at, end_at, capacity, channel_id } = body;
    if (!title || !scheduled_at) return { success: false, error: 'title and scheduled_at are required', statusCode: 400 };
    const cid = adminCtx?.channelId || channel_id;
    if (!cid) return { success: false, error: 'channel_id is required', statusCode: 400 };
    const created_by = adminCtx?.sub || null;
    try {
        const r = await pool.query(
            `INSERT INTO events (channel_id, title, description, location, scheduled_at, end_at, capacity, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id, title, scheduled_at, status`,
            [cid, title, description || null, location || null, scheduled_at, end_at || null, capacity || null, created_by]
        );
        return { success: true, event: r.rows[0] };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handlePutEvent(id, body) {
    const { title, description, location, scheduled_at, end_at, capacity, status } = body;
    try {
        const r = await pool.query(
            `UPDATE events
             SET title = COALESCE($2, title),
                 description = COALESCE($3, description),
                 location = COALESCE($4, location),
                 scheduled_at = COALESCE($5, scheduled_at),
                 end_at = COALESCE($6, end_at),
                 capacity = COALESCE($7, capacity),
                 status = COALESCE($8, status),
                 updated_at = NOW()
             WHERE id = $1
             RETURNING id, title, scheduled_at, status`,
            [id, title || null, description || null, location || null, scheduled_at || null, end_at || null, capacity || null, status || null]
        );
        if (!r.rows.length) return { success: false, error: 'Event not found', statusCode: 404 };
        return { success: true, event: r.rows[0] };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handleDeleteEvent(id) {
    try {
        await pool.query(`UPDATE events SET status = 'cancelled', updated_at = NOW() WHERE id = $1`, [id]);
        return { success: true };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handleGetEventSignups(eventId) {
    try {
        const r = await pool.query(
            `SELECT es.id, es.user_id, es.signed_up_at, es.status,
                    u.nickname, u.avatar_url, u.phone
             FROM event_signups es
             JOIN users u ON u.user_id = es.user_id
             WHERE es.event_id = $1 AND es.status = 'confirmed'
             ORDER BY es.signed_up_at ASC`,
            [eventId]
        );
        return { success: true, signups: r.rows };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handlePostEventSignup(body) {
    const { event_id, user_id } = body;
    if (!event_id || !user_id) return { success: false, error: 'event_id and user_id are required', statusCode: 400 };
    try {
        const evt = await pool.query(`SELECT capacity, status FROM events WHERE id = $1`, [event_id]);
        if (!evt.rows.length) return { success: false, error: 'Event not found', statusCode: 404 };
        if (evt.rows[0].status === 'cancelled') return { success: false, error: 'Event is cancelled', statusCode: 400 };
        if (evt.rows[0].capacity !== null) {
            const cnt = await pool.query(
                `SELECT COUNT(*) AS cnt FROM event_signups WHERE event_id = $1 AND status = 'confirmed'`, [event_id]
            );
            if (parseInt(cnt.rows[0].cnt, 10) >= evt.rows[0].capacity) {
                return { success: false, error: 'Event is full', statusCode: 409 };
            }
        }
        await pool.query(
            `INSERT INTO event_signups (event_id, user_id) VALUES ($1, $2)
             ON CONFLICT (event_id, user_id) DO UPDATE SET status = 'confirmed', signed_up_at = NOW()`,
            [event_id, user_id]
        );
        return { success: true };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handleDeleteEventSignup(eventId, userId) {
    if (!eventId || !userId) return { success: false, error: 'event_id and user_id are required', statusCode: 400 };
    try {
        await pool.query(
            `UPDATE event_signups SET status = 'cancelled' WHERE event_id = $1 AND user_id = $2`,
            [eventId, userId]
        );
        return { success: true };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handleGetMyEventSignups(query) {
    const { user_id } = query;
    if (!user_id) return { success: false, error: 'user_id is required', statusCode: 400 };
    try {
        const r = await pool.query(
            `SELECT e.id, e.title, e.location, e.scheduled_at, e.end_at, e.status AS event_status,
                    es.signed_up_at, es.status
             FROM event_signups es
             JOIN events e ON e.id = es.event_id
             WHERE es.user_id = $1 AND es.status = 'confirmed'
             ORDER BY e.scheduled_at ASC`,
            [user_id]
        );
        return { success: true, signups: r.rows };
    } catch (err) { return { success: false, error: err.message }; }
}

module.exports = {
    handleGetEvents,
    handlePostEvent,
    handlePutEvent,
    handleDeleteEvent,
    handleGetEventSignups,
    handlePostEventSignup,
    handleDeleteEventSignup,
    handleGetMyEventSignups,
};
