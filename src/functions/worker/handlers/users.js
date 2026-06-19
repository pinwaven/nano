'use strict';

const crypto = require('crypto');
const { pool } = require('../lib/db');
const { generateUserId, verifySubchannelOwnership } = require('../lib/auth');
const { calculateAge } = require('../lib/time-utils');

async function handleGetUsers(channelId, query = {}) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };

        // Lightweight query used by other tabs that just need a user list for dropdowns
        if (query.minimal === 'true') {
            const params = [];
            const channelFilter = channelId ? `AND u.channel_id = $${params.push(channelId)}` : '';
            const res = await pool.query(
                `SELECT u.user_id, u.nickname, u.coach_id, u.channel_id
                 FROM users u WHERE 1=1 ${channelFilter}
                 ORDER BY u.created_at DESC`,
                params
            );
            return { success: true, users: res.rows };
        }

        const limit = Math.min(parseInt(query.limit) || 50, 200);
        const offset = parseInt(query.offset) || 0;
        const search = (query.q || '').trim();
        const filterChannelId = query.filter_channel_id ? parseInt(query.filter_channel_id) : null;

        // Expand the selected channel to include its entire subtree
        let filterChannelIds = null;
        if (!channelId && filterChannelId) {
            const treeRes = await pool.query(
                `WITH RECURSIVE subtree AS (
                    SELECT id FROM channels WHERE id = $1
                    UNION ALL
                    SELECT c.id FROM channels c JOIN subtree s ON c.parent_channel_id = s.id
                ) SELECT id FROM subtree`,
                [filterChannelId]
            );
            filterChannelIds = treeRes.rows.map(r => r.id);
        }

        const sortFieldMap = {
            user_id: 'u.user_id', nickname: 'u.nickname', channel_name: 'c.name',
            birth_date: 'u.birth_date', chrono_age: 'u.birth_date',
            bio_age: 'b.bio_age', created_at: 'u.created_at',
        };
        const sortCol = sortFieldMap[query.sort_field] || 'u.created_at';
        let sortDir = query.sort_dir === 'asc' ? 'ASC' : 'DESC';
        if (query.sort_field === 'chrono_age') sortDir = sortDir === 'ASC' ? 'DESC' : 'ASC';

        const params = [];
        const conditions = ['1=1'];

        if (channelId) {
            conditions.push(`u.channel_id = $${params.push(channelId)}`);
        } else if (filterChannelIds) {
            conditions.push(`u.channel_id = ANY($${params.push(filterChannelIds)})`);
        }

        if (search) {
            const idx = params.push(`%${search}%`);
            conditions.push(`(u.nickname ILIKE $${idx} OR u.phone ILIKE $${idx} OR u.email ILIKE $${idx} OR u.user_id::TEXT ILIKE $${idx})`);
        }

        const where = conditions.join(' AND ');
        const limitIdx = params.push(limit);
        const offsetIdx = params.push(offset);

        const sql = `
            SELECT u.user_id, u.external_id, u.external_app, u.nickname, u.birth_date, u.language, u.gender,
                    u.avatar_url, u.coach_id, u.channel_id, u.roles, u.created_at, u.phone, u.email,
                    u.referred_by_user_id, u.invited_by_invitation_id,
                    u.bio_data as user_bio_data,
                    ru.nickname as referrer_nickname,
                    inv.code as invite_code,
                    inv_cu.nickname as inviter_nickname,
                    b.bio_age, b.data as bio_data,
                    cu.nickname as coach_name,
                    c.name as channel_name, c.logo_url as channel_logo_url,
                    (SELECT content FROM notifications WHERE user_id = u.user_id AND notification_type = 'biological_report' ORDER BY sent_at DESC LIMIT 1) as latest_report,
                    (SELECT content FROM notifications WHERE user_id = u.user_id AND notification_type = 'nutrition_plan' ORDER BY sent_at DESC LIMIT 1) as latest_plan,
                    COUNT(*) OVER() AS _total,
                    COUNT(b.bio_age) OVER() AS _tested,
                    AVG(b.bio_age) OVER() AS _avg_bio_age
            FROM users u
            LEFT JOIN coaches p ON u.coach_id = p.id
            LEFT JOIN users cu ON p.user_id = cu.user_id
            LEFT JOIN channels c ON u.channel_id = c.id
            LEFT JOIN users ru ON ru.user_id = u.referred_by_user_id
            LEFT JOIN invitations inv ON inv.id = u.invited_by_invitation_id
            LEFT JOIN users inv_cu ON inv_cu.user_id = inv.created_by
            LEFT JOIN (
                SELECT DISTINCT ON (user_id) user_id, bio_age, data
                FROM biomarkers
                ORDER BY user_id, tested_at DESC
            ) b ON u.user_id = b.user_id
            WHERE ${where}
            ORDER BY ${sortCol} ${sortDir} NULLS LAST
            LIMIT $${limitIdx} OFFSET $${offsetIdx}
        `;

        // Stats queries — channel-scoped but no search filter and no pagination
        const sParams = [];
        const sConditions = ['1=1'];
        if (channelId) {
            sConditions.push(`u.channel_id = $${sParams.push(channelId)}`);
        } else if (filterChannelIds) {
            sConditions.push(`u.channel_id = ANY($${sParams.push(filterChannelIds)})`);
        }
        const sWhere = sConditions.join(' AND ');

        const csParams = [];
        const csConditions = ['1=1'];
        if (channelId) {
            csConditions.push(`u.channel_id = $${csParams.push(channelId)}`);
        } else if (filterChannelIds) {
            csConditions.push(`u.channel_id = ANY($${csParams.push(filterChannelIds)})`);
        }
        const csWhere = csConditions.join(' AND ');

        const [mainResult, userStatsResult, coachStatsResult, scanStatsResult, bioAgeDeltaResult] = await Promise.all([
            pool.query(sql, params),
            pool.query(`
                SELECT
                    COUNT(*) FILTER (WHERE u.gender = 'male') AS male_count,
                    COUNT(*) FILTER (WHERE u.gender = 'female') AS female_count,
                    COUNT(*) FILTER (WHERE u.created_at >= NOW() - INTERVAL '7 days') AS new_users_7d
                FROM users u WHERE ${sWhere}
            `, sParams),
            pool.query(`
                SELECT
                    COUNT(*) FILTER (WHERE u.gender = 'male') AS male_coach_count,
                    COUNT(*) FILTER (WHERE u.gender = 'female') AS female_coach_count,
                    COUNT(*) FILTER (WHERE p.created_at >= NOW() - INTERVAL '7 days') AS new_coaches_7d,
                    COUNT(*) AS total_coaches
                FROM coaches p
                JOIN users u ON p.user_id = u.user_id
                WHERE ${csWhere}
            `, csParams),
            pool.query(`
                SELECT
                    COUNT(*) FILTER (WHERE b.tested_at >= NOW() - INTERVAL '7 days') AS scans_7d,
                    COUNT(*) FILTER (WHERE b.tested_at >= NOW() - INTERVAL '14 days') AS scans_14d,
                    COUNT(*) FILTER (WHERE b.tested_at >= NOW() - INTERVAL '30 days') AS scans_30d,
                    COUNT(*) AS scans_total
                FROM biomarkers b
                JOIN users u ON u.user_id = b.user_id
                WHERE ${sWhere}
            `, sParams),
            pool.query(`
                SELECT ROUND(AVG(b.bio_age - EXTRACT(YEAR FROM AGE(u.birth_date))::numeric)::numeric, 1)::text AS bio_age_delta
                FROM users u
                JOIN (
                    SELECT DISTINCT ON (user_id) user_id, bio_age
                    FROM biomarkers ORDER BY user_id, tested_at DESC
                ) b ON u.user_id = b.user_id
                WHERE u.birth_date IS NOT NULL AND b.bio_age IS NOT NULL AND ${sWhere}
            `, sParams),
        ]);

        const rows = mainResult.rows;
        const total = rows.length > 0 ? parseInt(rows[0]._total) : 0;
        const tested = rows.length > 0 ? parseInt(rows[0]._tested) : 0;
        const rawAvg = rows.length > 0 ? rows[0]._avg_bio_age : null;
        const avgBioAge = rawAvg != null ? parseFloat(rawAvg).toFixed(1) : '—';

        const userStats = userStatsResult.rows[0] || {};
        const coachStats = coachStatsResult.rows[0] || {};
        const scanStats = scanStatsResult.rows[0] || {};
        const bioAgeDeltaRow = bioAgeDeltaResult.rows[0] || {};

        const users = rows.map(({ _total, _tested, _avg_bio_age, ...u }) => ({
            ...u, chrono_age: calculateAge(u.birth_date),
        }));

        return {
            success: true, users, total, tested, avgBioAge,
            maleCount: parseInt(userStats.male_count) || 0,
            femaleCount: parseInt(userStats.female_count) || 0,
            newUsers7d: parseInt(userStats.new_users_7d) || 0,
            maleCoachCount: parseInt(coachStats.male_coach_count) || 0,
            femaleCoachCount: parseInt(coachStats.female_coach_count) || 0,
            newCoaches7d: parseInt(coachStats.new_coaches_7d) || 0,
            coachTotal: parseInt(coachStats.total_coaches) || 0,
            scansTotal: parseInt(scanStats.scans_total) || 0,
            scans7d: parseInt(scanStats.scans_7d) || 0,
            scans14d: parseInt(scanStats.scans_14d) || 0,
            scans30d: parseInt(scanStats.scans_30d) || 0,
            bioAgeDelta: bioAgeDeltaRow.bio_age_delta || null,
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ── Admin dashboard stats (time series + distributions) ─────────────────────
// Read-only aggregates for the admin panel Dashboard tab. Channel admins are
// scoped to their own channel via adminCtx.channelId; superadmins see all.
async function handleGetDashboardStats(query, adminCtx) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const channelId = adminCtx?.role === 'channel' ? adminCtx.channelId : (query.channel_id || null);

        // Expand channelId to its full descendant subtree so channel admins see
        // data from child channels and their children recursively.
        let channelIds = null;
        if (channelId) {
            const treeRes = await pool.query(
                `WITH RECURSIVE subtree AS (
                    SELECT id FROM channels WHERE id = $1
                    UNION ALL
                    SELECT c.id FROM channels c JOIN subtree s ON c.parent_channel_id = s.id
                ) SELECT id FROM subtree`,
                [channelId]
            );
            channelIds = treeRes.rows.map(r => r.id);
        }

        const uParams = [];
        const uFilter = channelIds ? `AND u.channel_id = ANY($${uParams.push(channelIds)})` : '';
        const oParams = [];
        const oFilter = channelIds ? `AND o.channel_id = ANY($${oParams.push(channelIds)})` : '';

        const [signups, scans, ordersDaily, deltaHist, subAgeAvgs, channelTop, revenue, tickets, recentUsers] = await Promise.all([
            pool.query(
                `SELECT TO_CHAR(u.created_at::date, 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
                 FROM users u
                 WHERE u.created_at >= NOW() - INTERVAL '30 days' ${uFilter}
                 GROUP BY 1 ORDER BY 1`, uParams),
            pool.query(
                `SELECT TO_CHAR(b.tested_at::date, 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
                 FROM biomarkers b
                 JOIN users u ON u.user_id = b.user_id
                 WHERE b.tested_at >= NOW() - INTERVAL '30 days' ${uFilter}
                 GROUP BY 1 ORDER BY 1`, uParams),
            pool.query(
                `SELECT TO_CHAR(o.created_at::date, 'YYYY-MM-DD') AS day, COUNT(*)::int AS count,
                        COALESCE(SUM(o.price_cny * o.quantity), 0)::numeric AS revenue_cny
                 FROM orders o
                 WHERE o.created_at >= NOW() - INTERVAL '30 days' ${oFilter}
                 GROUP BY 1 ORDER BY 1`, oParams),
            pool.query(
                `WITH latest AS (
                    SELECT DISTINCT ON (user_id) user_id, bio_age
                    FROM biomarkers ORDER BY user_id, tested_at DESC
                 )
                 SELECT CASE
                          WHEN x.d < -5 THEN 'lt_m5'
                          WHEN x.d < -2 THEN 'm5_m2'
                          WHEN x.d < 0  THEN 'm2_0'
                          WHEN x.d < 2  THEN '0_2'
                          WHEN x.d < 5  THEN '2_5'
                          ELSE 'gt_5'
                        END AS bucket,
                        COUNT(*)::int AS count
                 FROM (
                    SELECT (l.bio_age - EXTRACT(YEAR FROM AGE(u.birth_date)))::numeric AS d
                    FROM latest l
                    JOIN users u ON u.user_id = l.user_id
                    WHERE u.birth_date IS NOT NULL AND l.bio_age IS NOT NULL ${uFilter}
                 ) x
                 GROUP BY 1`, uParams),
            pool.query(
                `WITH latest AS (
                    SELECT DISTINCT ON (user_id) user_id, data
                    FROM biomarkers ORDER BY user_id, tested_at DESC
                 )
                 SELECT
                    ROUND(AVG((l.data->'bioage_profile'->'SubAges'->>'CellularAge')::numeric), 1)::text      AS cellular,
                    ROUND(AVG((l.data->'bioage_profile'->'SubAges'->>'MetabolicAge')::numeric), 1)::text     AS metabolic,
                    ROUND(AVG((l.data->'bioage_profile'->'SubAges'->>'MicroVascularAge')::numeric), 1)::text AS microvascular,
                    ROUND(AVG((l.data->'bioage_profile'->'SubAges'->>'ResilienceAge')::numeric), 1)::text    AS resilience,
                    ROUND(AVG((l.data->'bioage_profile'->>'ChronoAge')::numeric), 1)::text                   AS chrono
                 FROM latest l
                 JOIN users u ON u.user_id = l.user_id
                 WHERE TRUE ${uFilter}`, uParams),
            channelIds
                ? Promise.resolve({ rows: [] })
                : pool.query(
                    `SELECT c.name, COUNT(u.user_id)::int AS user_count
                     FROM channels c
                     JOIN users u ON u.channel_id = c.id
                     GROUP BY c.id, c.name
                     ORDER BY user_count DESC LIMIT 8`),
            pool.query(
                `SELECT COALESCE(SUM(o.price_cny * o.quantity) FILTER (WHERE o.created_at >= NOW() - INTERVAL '30 days'), 0)::numeric AS revenue_30d,
                        COALESCE(SUM(o.price_cny * o.quantity), 0)::numeric AS revenue_total,
                        COUNT(*)::int AS orders_total,
                        (COUNT(*) FILTER (WHERE o.status = 'pending'))::int AS orders_pending
                 FROM orders o WHERE TRUE ${oFilter}`, oParams),
            channelIds
                ? pool.query(
                    `SELECT (COUNT(*) FILTER (WHERE t.status IN ('open', 'in_progress')))::int AS open
                     FROM tickets t
                     LEFT JOIN users u ON u.external_id = t.reporter
                     WHERE t.channel_id = ANY($1) OR (t.channel_id IS NULL AND u.channel_id = ANY($1))`, [channelIds])
                : pool.query(
                    `SELECT (COUNT(*) FILTER (WHERE status IN ('open', 'in_progress')))::int AS open FROM tickets`),
            pool.query(
                `SELECT u.user_id, u.nickname, u.avatar_url, u.created_at, c.name AS channel_name, b.bio_age
                 FROM users u
                 LEFT JOIN channels c ON c.id = u.channel_id
                 LEFT JOIN (
                    SELECT DISTINCT ON (user_id) user_id, bio_age
                    FROM biomarkers ORDER BY user_id, tested_at DESC
                 ) b ON b.user_id = u.user_id
                 WHERE TRUE ${uFilter}
                 ORDER BY u.created_at DESC LIMIT 6`, uParams),
        ]);

        return {
            success: true,
            daily: { signups: signups.rows, scans: scans.rows, orders: ordersDaily.rows },
            delta_histogram: deltaHist.rows,
            sub_age_avgs: subAgeAvgs.rows[0] || {},
            channel_top: channelTop.rows,
            revenue: revenue.rows[0] || {},
            attention: { open_tickets: parseInt(tickets.rows[0]?.open) || 0 },
            recent_users: recentUsers.rows,
        };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handleGetUser(user_id) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const res = await pool.query(
            `SELECT u.user_id, u.nickname, u.avatar_url, u.phone, u.email, u.language, u.gender,
                    u.birth_date, u.roles, u.coach_id, u.channel_id, u.created_at,
                    u.bio_data as user_bio_data,
                    u.referred_by_user_id, u.invited_by_invitation_id,
                    ru.nickname as referrer_nickname,
                    inv.code as invite_code,
                    inv_cu.nickname as inviter_nickname
             FROM users u
             LEFT JOIN users ru ON ru.user_id = u.referred_by_user_id
             LEFT JOIN invitations inv ON inv.id = u.invited_by_invitation_id
             LEFT JOIN users inv_cu ON inv_cu.user_id = inv.created_by
             WHERE u.user_id=$1`,
            [user_id]
        );
        if (!res.rows.length) return { success: false, error: 'User not found' };
        return { success: true, user: res.rows[0] };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetBiomarkers(openid) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        if (!openid) return { success: true, records: [] };
        const result = await pool.query(
            `SELECT id, test_type, data, bio_age, tested_at
             FROM biomarkers
             WHERE user_id = $1
             ORDER BY tested_at ASC`,
            [openid]
        );
        return { success: true, records: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetNotifications(openid) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        if (!openid) return { success: true, notifications: [] };
        const query = `
            SELECT n.id, n.content, n.notification_type
            FROM notifications n
            JOIN users u ON n.user_id = u.user_id
            WHERE u.user_id = $1 AND n.status = 'pending'
            ORDER BY n.sent_at ASC;
        `;
        const result = await pool.query(query, [openid]);
        if (result.rows.length > 0) {
            const ids = result.rows.map(r => r.id);
            await pool.query('UPDATE notifications SET status = $1 WHERE id = ANY($2)', ['sent', ids]);
        }
        return { success: true, notifications: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostUsers(body) {
    const { openid, external_id: extId, external_app, nickname, phone, email, gender, birth_date, language, coach_id, channel_id } = body;
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const newUserId = generateUserId();
        const external_id = extId || openid || null;
        const result = await pool.query(
            `INSERT INTO users (user_id, external_id, external_app, nickname, phone, email, gender, birth_date, language, coach_id, channel_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING user_id`,
            [newUserId, external_id, external_app || null, nickname || null, phone || null, email || null, gender || null, birth_date || null, language || 'zh', coach_id || null, channel_id || null]
        );
        return { success: true, user_id: result.rows[0].user_id };
    } catch (err) {
        return { success: false, error: err.detail || err.message };
    }
}

async function handlePutUser(user_id, body) {
    const { nickname, phone, email, gender, birth_date, language, coach_id, channel_id, bio_data, roles, avatar_url } = body;
    // channel_id uses COALESCE so a missing/null value in the request never overwrites an existing assignment
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        if (bio_data && roles) {
            await pool.query(
                `UPDATE users SET nickname=$1, phone=$2, email=$3, gender=$4, birth_date=$5, language=$6, coach_id=$7, channel_id=COALESCE($8, channel_id), bio_data = bio_data || $9, roles=$10, avatar_url=COALESCE($11, avatar_url) WHERE user_id=$12`,
                [nickname || null, phone || null, email || null, gender || null, birth_date || null, language || 'zh', coach_id || null, channel_id || null, JSON.stringify(bio_data), roles, avatar_url || null, user_id]
            );
        } else if (bio_data) {
            await pool.query(
                `UPDATE users SET nickname=$1, phone=$2, email=$3, gender=$4, birth_date=$5, language=$6, coach_id=$7, channel_id=COALESCE($8, channel_id), bio_data = bio_data || $9, avatar_url=COALESCE($10, avatar_url) WHERE user_id=$11`,
                [nickname || null, phone || null, email || null, gender || null, birth_date || null, language || 'zh', coach_id || null, channel_id || null, JSON.stringify(bio_data), avatar_url || null, user_id]
            );
        } else if (roles) {
            await pool.query(
                `UPDATE users SET nickname=$1, phone=$2, email=$3, gender=$4, birth_date=$5, language=$6, coach_id=$7, channel_id=COALESCE($8, channel_id), roles=$9, avatar_url=COALESCE($10, avatar_url) WHERE user_id=$11`,
                [nickname || null, phone || null, email || null, gender || null, birth_date || null, language || 'zh', coach_id || null, channel_id || null, roles, avatar_url || null, user_id]
            );
        } else {
            await pool.query(
                `UPDATE users SET nickname=$1, phone=$2, email=$3, gender=$4, birth_date=$5, language=$6, coach_id=$7, channel_id=COALESCE($8, channel_id), avatar_url=COALESCE($9, avatar_url) WHERE user_id=$10`,
                [nickname || null, phone || null, email || null, gender || null, birth_date || null, language || 'zh', coach_id || null, channel_id || null, avatar_url || null, user_id]
            );
        }
        // Sync coaches table when roles change
        if (roles) {
            if (roles.includes('coach')) {
                await pool.query(
                    `INSERT INTO coaches (user_id)
                     SELECT $1 FROM users WHERE user_id = $1
                     AND NOT EXISTS (SELECT 1 FROM coaches WHERE user_id = $1)`,
                    [user_id]
                );
            } else {
                // Block removal if coach still has assigned users
                const coachRow = await pool.query('SELECT id FROM coaches WHERE user_id = $1', [user_id]);
                if (coachRow.rows.length > 0) {
                    const coachId = coachRow.rows[0].id;
                    const assigned = await pool.query('SELECT COUNT(*) FROM users WHERE coach_id = $1', [coachId]);
                    if (parseInt(assigned.rows[0].count) > 0) {
                        return { success: false, statusCode: 409, error: `Cannot remove coach role: ${assigned.rows[0].count} user(s) are still assigned to this coach.` };
                    }
                    await pool.query('DELETE FROM coaches WHERE id = $1', [coachId]);
                }
            }
        }
        return { success: true };
    } catch (err) {
        return { success: false, statusCode: 500, error: err.message };
    }
}

async function handlePatchUser(user_id, body) {
    const { theme } = body;
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const updates = [];
        const params = [];
        if (theme !== undefined) {
            params.push(theme === 'light' ? 'light' : 'dark');
            updates.push(`theme = $${params.length}`);
        }
        if (updates.length === 0) return { success: true };
        params.push(user_id);
        await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE user_id = $${params.length}`, params);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleDeleteUser(user_id) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        await pool.query('DELETE FROM users WHERE user_id = $1', [user_id]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetInvitations(query) {
    const { channel_id, created_by } = query;
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        let sql = `
            SELECT i.id, i.code, i.type, i.max_uses, i.use_count, i.is_active, i.created_at, i.expires_at,
                   i.channel_id, COALESCE(i.created_by, i.created_by_snapshot) AS created_by,
                   c.name AS channel_name,
                   COALESCE(u.nickname, i.created_by_snapshot) AS creator_name
            FROM invitations i
            LEFT JOIN channels c ON i.channel_id = c.id
            LEFT JOIN users u ON i.created_by = u.user_id
        `;
        const params = [];
        const conditions = [];
        if (channel_id) { params.push(parseInt(channel_id)); conditions.push(`i.channel_id = $${params.length}`); }
        if (created_by) { params.push(created_by); conditions.push(`i.created_by = $${params.length}`); }
        if (conditions.length) sql += ` WHERE ${conditions.join(' AND ')}`;
        sql += ` ORDER BY i.created_at DESC`;
        const result = await pool.query(sql, params);
        return { success: true, invitations: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostInvitation(body, adminCtx) {
    const { created_by, channel_id, type = 'coach', max_uses = null } = body;
    if (!channel_id) return { success: false, error: 'channel_id is required', statusCode: 400 };
    if (adminCtx?.role === 'channel' && adminCtx.canManageSubchannels && parseInt(channel_id) !== adminCtx.channelId) {
        const owns = await verifySubchannelOwnership(channel_id, adminCtx);
        if (!owns) return { statusCode: 403, success: false, error: 'Forbidden' };
    }
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        let code, attempts = 0;
        do {
            code = String(100000 + (parseInt(crypto.randomBytes(3).toString('hex'), 16) % 900000));
            const exists = await pool.query('SELECT id FROM invitations WHERE code = $1', [code]);
            if (exists.rows.length === 0) break;
            attempts++;
        } while (attempts < 10);
        const result = await pool.query(
            `INSERT INTO invitations (code, created_by, created_by_snapshot, channel_id, type, max_uses)
             VALUES ($1, $2, $2, $3, $4, $5) RETURNING id, code`,
            [code, created_by || null, parseInt(channel_id), type, max_uses || null]
        );
        return { success: true, id: result.rows[0].id, code: result.rows[0].code };
    } catch (err) {
        return { success: false, error: err.detail || err.message };
    }
}

async function handleDeleteInvitation(inviteId) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        await pool.query('UPDATE invitations SET is_active = FALSE WHERE id = $1', [inviteId]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = {
    handleGetUsers,
    handleGetDashboardStats,
    handleGetUser,
    handleGetBiomarkers,
    handleGetNotifications,
    handlePostUsers,
    handlePutUser,
    handlePatchUser,
    handleDeleteUser,
    handleGetInvitations,
    handlePostInvitation,
    handleDeleteInvitation,
};
