'use strict';

const { pool } = require('../lib/db');
const { calculateAge } = require('../lib/time-utils');

async function handleGetCoachList(channelId) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const params = [];
        // Two different scopes off ONE placeholder. channelFilter decides which COACHES are listed,
        // by the coach's own user row. assignedFilter decides which of their CLIENTS are counted —
        // and it has to exist separately because users.coach_id is NOT channel-scoped: a coach can
        // hold clients in several channels (prod: coaches.id 8 has 7 in channel 2 and 13 in
        // channel 1). Without it a channel admin reads "20 clients" above a list of 7.
        //
        // It belongs in the JOIN's ON clause, never the WHERE: this is a LEFT JOIN, so moving it
        // out would drop every coach with no clients in the caller's channel off the list
        // entirely, instead of showing them with a count of 0.
        const channelIdx = channelId ? params.push(channelId) : null;
        const channelFilter = channelId ? `WHERE u.channel_id = $${channelIdx}` : '';
        const assignedFilter = channelId ? `AND assigned.channel_id = $${channelIdx}` : '';
        const query = `
            SELECT p.id, u.channel_id, p.user_id, p.created_at,
                   u.nickname AS name, u.email, u.phone, u.avatar_url, u.language,
                   COUNT(assigned.user_id) AS user_count,
                   c.name AS channel_name,
                   p.group_id, cg.name AS group_name
            FROM coaches p
            JOIN users u ON p.user_id = u.user_id
            LEFT JOIN users assigned ON p.id = assigned.coach_id ${assignedFilter}
            LEFT JOIN channels c ON u.channel_id = c.id
            LEFT JOIN coach_groups cg ON cg.id = p.group_id
            ${channelFilter}
            GROUP BY p.id, u.channel_id, u.nickname, u.email, u.phone, u.avatar_url, u.language, c.name, p.group_id, cg.name;
        `;
        const result = await pool.query(query, params);
        return { success: true, coaches: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetChannelUsers(channelId, query = {}) {
    if (!channelId) return { success: false, error: 'channelId is required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };

        const includeSubchannels = query.include_subchannels === 'true';

        // Lightweight query used by other tabs (e.g. Partners/Coach "linked user" search) that
        // just need the full user list for a dropdown — mirrors handleGetUsers' minimal branch.
        // Must stay unpaginated: search widgets filter client-side over the whole list.
        if (query.minimal === 'true') {
            const subtreeJoin = includeSubchannels
                ? `JOIN (WITH RECURSIVE subtree AS (
                        SELECT id FROM channels WHERE id = $1
                        UNION ALL
                        SELECT c.id FROM channels c JOIN subtree s ON c.parent_channel_id = s.id
                    ) SELECT id FROM subtree) st ON u.channel_id = st.id`
                : 'JOIN (SELECT $1::int AS id) st ON u.channel_id = st.id';
            const res = await pool.query(
                `SELECT u.user_id, u.nickname, u.phone, u.coach_id, u.channel_id
                 FROM users u ${subtreeJoin}
                 ORDER BY u.created_at DESC`,
                [channelId]
            );
            return { success: true, users: res.rows };
        }

        const limit = Math.min(parseInt(query.limit) || 50, 200);
        const offset = parseInt(query.offset) || 0;
        const search = (query.q || '').trim();

        const sortFieldMap = {
            user_id: 'u.user_id', nickname: 'u.nickname', channel_name: 'ch.name',
            birth_date: 'u.birth_date', chrono_age: 'u.birth_date',
            bio_age: 'b.bio_age', created_at: 'u.created_at',
        };
        const sortCol = sortFieldMap[query.sort_field] || 'u.created_at';
        let sortDir = query.sort_dir === 'asc' ? 'ASC' : 'DESC';
        if (query.sort_field === 'chrono_age') sortDir = sortDir === 'ASC' ? 'DESC' : 'ASC';

        // Channel scope JOIN — same fragment reused in both the list query and stats queries
        const channelJoin = includeSubchannels
            ? `JOIN (WITH RECURSIVE subtree AS (
                    SELECT id FROM channels WHERE id = $1
                    UNION ALL
                    SELECT c.id FROM channels c JOIN subtree s ON c.parent_channel_id = s.id
                ) SELECT id FROM subtree) st ON u.channel_id = st.id`
            : 'JOIN (SELECT $1::int AS id) st ON u.channel_id = st.id';

        // ── Paginated user list (with optional search) ─────────────────────────
        const listParams = [channelId];
        let searchClause = '';
        if (search) {
            const idx = listParams.push(`%${search}%`);
            searchClause = `AND (u.nickname ILIKE $${idx} OR u.phone ILIKE $${idx} OR u.email ILIKE $${idx} OR u.user_id::TEXT ILIKE $${idx})`;
        }
        const limitIdx = listParams.push(limit);
        const offsetIdx = listParams.push(offset);

        const listRes = await pool.query(`
            SELECT u.user_id, u.external_id, u.nickname, u.birth_date, u.language, u.gender,
                   u.coach_id, u.channel_id, u.roles, u.created_at, u.phone, u.email,
                   u.bio_data AS user_bio_data,
                   b.bio_age, cu.nickname AS coach_name, ch.name AS channel_name,
                   COUNT(*) OVER() AS _total
            FROM users u
            ${channelJoin}
            LEFT JOIN channels ch ON ch.id = u.channel_id
            LEFT JOIN coaches p ON u.coach_id = p.id
            LEFT JOIN users cu ON p.user_id = cu.user_id
            LEFT JOIN (
                SELECT DISTINCT ON (user_id) user_id, bio_age
                FROM biomarkers ORDER BY user_id, tested_at DESC
            ) b ON u.user_id = b.user_id
            WHERE 1=1 ${searchClause}
            ORDER BY ${sortCol} ${sortDir} NULLS LAST
            LIMIT $${limitIdx} OFFSET $${offsetIdx}
        `, listParams);

        const rows = listRes.rows.map(({ _total, ...u }) => ({ ...u, chrono_age: calculateAge(u.birth_date) }));
        const filteredTotal = listRes.rows.length > 0 ? parseInt(listRes.rows[0]._total) : 0;
        const testedRows = rows.filter(r => r.bio_age != null);
        const avgBioAgeVal = testedRows.length > 0
            ? (testedRows.reduce((s, r) => s + parseFloat(r.bio_age), 0) / testedRows.length).toFixed(1)
            : null;

        // ── Channel-wide stats (no search filter, no pagination) ───────────────
        const subtreeCte = `WITH RECURSIVE subtree AS (SELECT id FROM channels WHERE id = $1 UNION ALL SELECT c.id FROM channels c JOIN subtree s ON c.parent_channel_id = s.id)`;
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        const [statsRes, coachRes, scanRes] = await Promise.all([
            pool.query(`
                SELECT COUNT(*) AS total_users,
                       COUNT(*) FILTER (WHERE u.gender = 'male') AS male_count,
                       COUNT(*) FILTER (WHERE u.gender = 'female') AS female_count,
                       COUNT(*) FILTER (WHERE u.created_at >= NOW() - INTERVAL '7 days') AS new_7d,
                       COUNT(b.bio_age) AS tested,
                       ROUND(AVG(b.bio_age)::NUMERIC, 1) AS avg_bio_age
                FROM users u
                ${channelJoin}
                LEFT JOIN (
                    SELECT DISTINCT ON (user_id) user_id, bio_age
                    FROM biomarkers ORDER BY user_id, tested_at DESC
                ) b ON u.user_id = b.user_id
            `, [channelId]),
            pool.query(
                includeSubchannels
                    ? `${subtreeCte} SELECT u.gender, p.created_at FROM coaches p JOIN users u ON p.user_id = u.user_id JOIN subtree st ON u.channel_id = st.id`
                    : `SELECT u.gender, p.created_at FROM coaches p JOIN users u ON p.user_id = u.user_id WHERE u.channel_id = $1`,
                [channelId]
            ),
            pool.query(`
                SELECT COUNT(*) FILTER (WHERE b.tested_at >= NOW() - INTERVAL '7 days') AS s7,
                       COUNT(*) FILTER (WHERE b.tested_at >= NOW() - INTERVAL '14 days') AS s14,
                       COUNT(*) FILTER (WHERE b.tested_at >= NOW() - INTERVAL '30 days') AS s30,
                       COUNT(*) AS total
                FROM biomarkers b
                JOIN users u ON u.user_id = b.user_id
                ${channelJoin}
            `, [channelId]),
        ]);

        const stats = statsRes.rows[0] || {};
        const coaches = coachRes.rows;
        const scanRow = scanRes.rows[0] || {};

        return {
            success: true,
            users: rows,
            total: filteredTotal,
            tested: parseInt(stats.tested) || 0,
            avgBioAge: stats.avg_bio_age ?? avgBioAgeVal ?? '—',
            maleCount: parseInt(stats.male_count) || 0,
            femaleCount: parseInt(stats.female_count) || 0,
            newUsers7d: parseInt(stats.new_7d) || 0,
            coachTotal: coaches.length,
            maleCoachCount: coaches.filter(c => c.gender === 'male').length,
            femaleCoachCount: coaches.filter(c => c.gender === 'female').length,
            newCoaches7d: coaches.filter(c => new Date(c.created_at) >= sevenDaysAgo).length,
            scansTotal: parseInt(scanRow.total) || 0,
            scans7d: parseInt(scanRow.s7) || 0,
            scans14d: parseInt(scanRow.s14) || 0,
            scans30d: parseInt(scanRow.s30) || 0,
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetChannelCoaches(channelId, includeSubchannels = false) {
    if (!channelId) return { success: false, error: 'channelId is required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        if (includeSubchannels) {
            const result = await pool.query(`
                WITH RECURSIVE subtree AS (
                    SELECT id FROM channels WHERE id = $1
                    UNION ALL
                    SELECT c.id FROM channels c JOIN subtree s ON c.parent_channel_id = s.id
                )
                SELECT p.id, u.channel_id, p.user_id, p.created_at,
                       u.nickname AS name, u.email, u.phone, u.avatar_url, u.language,
                       COUNT(assigned.user_id) AS user_count,
                       ch.name AS channel_name,
                       p.group_id, cg.name AS group_name
                FROM coaches p
                JOIN users u ON p.user_id = u.user_id
                JOIN subtree st ON u.channel_id = st.id
                LEFT JOIN channels ch ON ch.id = u.channel_id
                -- Scoped to the same subtree the coaches were selected from, NOT to $1 alone:
                -- users.coach_id is not channel-scoped, so an unscoped count reports a coach's
                -- clients from channels this call never listed. Scoping it to $1 instead would
                -- swap that for the opposite error — counting only the root channel while listing
                -- coaches across the whole tree. In the ON clause, never the WHERE: this is a LEFT
                -- JOIN, and moving it out would drop every coach with no clients in the subtree off
                -- the list rather than showing them at 0.
                LEFT JOIN users assigned ON p.id = assigned.coach_id
                    AND assigned.channel_id IN (SELECT id FROM subtree)
                LEFT JOIN coach_groups cg ON cg.id = p.group_id
                GROUP BY p.id, u.channel_id, u.nickname, u.email, u.phone, u.avatar_url, u.language, ch.name, p.group_id, cg.name
                ORDER BY p.created_at DESC
            `, [channelId]);
            return { success: true, coaches: result.rows };
        }
        const result = await pool.query(
            `SELECT p.id, u.channel_id, p.user_id, p.created_at,
                    u.nickname AS name, u.email, u.phone, u.avatar_url, u.language,
                    COUNT(assigned.user_id) AS user_count,
                    ch.name AS channel_name,
                    p.group_id, cg.name AS group_name
             FROM coaches p
             JOIN users u ON p.user_id = u.user_id
             LEFT JOIN channels ch ON ch.id = u.channel_id
             -- Same reasoning as the subtree branch above, and as handleGetCoachList: count only
             -- the clients this call actually listed coaches for.
             LEFT JOIN users assigned ON p.id = assigned.coach_id AND assigned.channel_id = $1
             LEFT JOIN coach_groups cg ON cg.id = p.group_id
             WHERE u.channel_id = $1
             GROUP BY p.id, u.channel_id, u.nickname, u.email, u.phone, u.avatar_url, u.language, ch.name, p.group_id, cg.name
             ORDER BY p.created_at DESC`,
            [channelId]
        );
        return { success: true, coaches: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// `channelId` is the CALLER's scope (adminCtx.channelId), null for a superadmin bearer. It has to be
// applied because users.coach_id is not channel-scoped: a coach can hold clients across several
// channels, so `WHERE u.coach_id = $1` alone let a channel-scoped admin read users outside their own
// channel — they see the coach in their own /coach-list (which is keyed on the COACH's channel, not
// the clients') and then fetch the whole cross-channel roster here.
//
// Every caller that exists today is unaffected: the miniapp's coach client and the WeChat bridge
// both authenticate with API_BEARER_TOKEN, whose branch leaves adminCtx.channelId null (it is
// assigned only in the `ch.` branch, worker/index.js). So a coach whose clients span channels keeps
// seeing all of them, and only a `ch.` channel-admin token narrows — which is the case this closes.
async function handleGetCoachUsers(coachId, query = {}, channelId = null) {
    if (!coachId) return { success: false, error: 'coachId is required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const params = [coachId];
        const extraConds = [];
        if (channelId) { extraConds.push(`u.channel_id = $${params.length + 1}`); params.push(channelId); }
        if (query.stage) { extraConds.push(`COALESCE(cps.stage, 'lead') = $${params.length + 1}`); params.push(query.stage); }
        if (query.tag_id) { extraConds.push(`cta.tag_id = $${params.length + 1}`); params.push(query.tag_id); }
        const whereCond = extraConds.length ? `AND ${extraConds.join(' AND ')}` : '';
        const result = await pool.query(
            `SELECT u.user_id, u.external_id, u.nickname, u.avatar_url, u.birth_date, u.language, u.gender,
                    u.coach_id, u.channel_id, u.roles, u.created_at, u.phone, u.email,
                    b.bio_age, b.data AS bio_data, b.tested_at AS last_scan_at,
                    m.last_msg_at,
                    lm.last_user_msg, lm.last_user_msg_at,
                    COALESCE(cps.stage, 'lead') AS crm_stage,
                    ARRAY_AGG(DISTINCT ct.name ORDER BY ct.name) FILTER (WHERE ct.name IS NOT NULL) AS crm_tags,
                    ARRAY_AGG(DISTINCT jsonb_build_object('id', ct.id, 'name', ct.name, 'color_hex', ct.color_hex))
                        FILTER (WHERE ct.id IS NOT NULL) AS crm_tag_objects
             FROM users u
             LEFT JOIN (
                 SELECT DISTINCT ON (user_id) user_id, bio_age, data, tested_at
                 FROM biomarkers
                 WHERE test_type = 'kino_chip'
                 ORDER BY user_id, tested_at DESC
             ) b ON u.user_id = b.user_id
             LEFT JOIN (
                 SELECT user_id, MAX(created_at) AS last_msg_at
                 FROM chat_messages
                 GROUP BY user_id
             ) m ON u.user_id = m.user_id
             LEFT JOIN (
                 SELECT DISTINCT ON (user_id) user_id, content AS last_user_msg, created_at AS last_user_msg_at
                 FROM chat_messages
                 WHERE role = 'user'
                 ORDER BY user_id, created_at DESC, id DESC
             ) lm ON u.user_id = lm.user_id
             LEFT JOIN client_pipeline_stages cps ON cps.user_id = u.user_id AND cps.coach_id = $1
             LEFT JOIN client_tag_assignments cta ON cta.user_id = u.user_id AND cta.coach_id = $1
             LEFT JOIN client_tags ct ON ct.id = cta.tag_id
             WHERE u.coach_id = $1 ${whereCond}
             GROUP BY u.user_id, b.bio_age, b.data, b.tested_at, m.last_msg_at, lm.last_user_msg, lm.last_user_msg_at, COALESCE(cps.stage, 'lead')
             ORDER BY COALESCE(m.last_msg_at, b.tested_at, u.created_at) DESC`,
            params
        );
        return { success: true, users: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostCoachInstruction(body) {
    const { openid, instruction } = body;
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const user = await pool.query('SELECT user_id FROM users WHERE user_id = $1', [openid]);
        if (user.rows.length === 0) return { success: false, error: 'User not found', statusCode: 404 };
        await pool.query(
            'INSERT INTO chat_messages (user_id, role, content) VALUES ($1, $2, $3)',
            [user.rows[0].user_id, 'coach', instruction]
        );
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetCoachSentMessages(userId) {
    if (!userId) return { success: false, error: 'user_id is required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const result = await pool.query(
            `SELECT id, content, status, sent_at
             FROM notifications
             WHERE user_id = $1 AND notification_type = 'coach_instruction'
             ORDER BY sent_at DESC
             LIMIT 50`,
            [userId]
        );
        return { success: true, messages: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostReminder(body) {
    const { user_id, coach_id, content, scheduled_for, recurrence } = body;
    if (!user_id || !content || !scheduled_for)
        return { success: false, error: 'user_id, content, scheduled_for are required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const result = await pool.query(
            `INSERT INTO reminders (user_id, coach_id, content, scheduled_for, recurrence)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, scheduled_for`,
            [user_id, coach_id || null, content, scheduled_for, recurrence || null]
        );
        return { success: true, reminder: result.rows[0] };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetReminders(openid) {
    if (!openid) return { success: false, error: 'openid is required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const result = await pool.query(
            `SELECT id, content, scheduled_for, recurrence, status, coach_id
             FROM reminders
             WHERE user_id = $1
               AND status = 'pending'
               AND scheduled_for >= NOW() - INTERVAL '1 hour'
             ORDER BY scheduled_for ASC
             LIMIT 50`,
            [openid]
        );
        return { success: true, reminders: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetCoachUserChat(userId, coachId) {
    if (!userId) return { success: false, error: 'user_id is required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        if (coachId) {
            const check = await pool.query(
                'SELECT 1 FROM users WHERE user_id = $1 AND coach_id = $2',
                [userId, coachId]
            );
            if (check.rows.length === 0) return { success: false, error: 'Access denied', statusCode: 403 };
        }
        const result = await pool.query(
            `SELECT role, content, created_at FROM (
                SELECT role, content, created_at FROM chat_messages
                WHERE user_id = $1
                ORDER BY created_at DESC
                LIMIT 50
            ) sub ORDER BY created_at ASC`,
            [userId]
        );
        return { success: true, messages: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostAssignCoach(body) {
    const { user_id, coach_id } = body;
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        await pool.query('UPDATE users SET coach_id = $1 WHERE user_id = $2', [coach_id || null, user_id]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostCoaches(body) {
    const { user_id, group_id } = body;
    if (!user_id) return { success: false, error: 'user_id is required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const result = await pool.query(
            'INSERT INTO coaches (user_id, group_id) VALUES ($1, $2) RETURNING id',
            [user_id, group_id || null]
        );
        await pool.query(
            `UPDATE users SET roles = array_append(roles, 'coach') WHERE user_id = $1 AND NOT ('coach' = ANY(roles))`,
            [user_id]
        );
        return { success: true, id: result.rows[0].id };
    } catch (err) {
        return { success: false, error: err.detail || err.message };
    }
}

async function handlePutCoach(coachId, body) {
    const { user_id, group_id } = body;
    if (!user_id) return { success: false, error: 'user_id is required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const oldResult = await pool.query('SELECT user_id FROM coaches WHERE id = $1', [coachId]);
        const oldUserId = oldResult.rows[0]?.user_id;
        await pool.query(
            'UPDATE coaches SET user_id=$1, group_id=$2 WHERE id=$3',
            [user_id, group_id || null, coachId]
        );
        await pool.query(
            `UPDATE users SET roles = array_append(roles, 'coach') WHERE user_id = $1 AND NOT ('coach' = ANY(roles))`,
            [user_id]
        );
        if (oldUserId && oldUserId !== user_id) {
            const stillCoach = await pool.query('SELECT id FROM coaches WHERE user_id = $1', [oldUserId]);
            if (stillCoach.rows.length === 0) {
                await pool.query(
                    `UPDATE users SET roles = array_remove(roles, 'coach') WHERE user_id = $1`,
                    [oldUserId]
                );
            }
        }
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleDeleteCoach(coachId) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const coachRow = await pool.query('SELECT user_id FROM coaches WHERE id = $1', [coachId]);
        if (!coachRow.rows.length) return { success: false, statusCode: 404, error: 'Coach not found' };
        const userId = coachRow.rows[0].user_id;
        const assigned = await pool.query('SELECT COUNT(*) FROM users WHERE coach_id = $1', [coachId]);
        if (parseInt(assigned.rows[0].count) > 0) {
            return { success: false, statusCode: 409, error: `Cannot delete coach: ${assigned.rows[0].count} user(s) are still assigned.` };
        }
        await pool.query('DELETE FROM coaches WHERE id = $1', [coachId]);
        if (userId) {
            await pool.query(
                `UPDATE users SET roles = array_remove(roles, 'coach') WHERE user_id = $1`,
                [userId]
            );
        }
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = {
    handleGetCoachList,
    handleGetChannelUsers,
    handleGetChannelCoaches,
    handleGetCoachUsers,
    handlePostCoachInstruction,
    handleGetCoachSentMessages,
    handlePostReminder,
    handleGetReminders,
    handleGetCoachUserChat,
    handlePostAssignCoach,
    handlePostCoaches,
    handlePutCoach,
    handleDeleteCoach,
};
