'use strict';

const crypto = require('crypto');
const { pool } = require('../lib/db');
const { generateUserId, verifySubchannelOwnership } = require('../lib/auth');
const { calculateAge } = require('../lib/time-utils');
const { findAndMergeDuplicateAccount } = require('./user-merge');
const { syncPartnerPhoneFromUser } = require('./partners');

async function handleGetUsers(channelId, query = {}) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };

        // Lightweight query used by other tabs that just need a user list for dropdowns
        if (query.minimal === 'true') {
            const params = [];
            const channelFilter = channelId ? `AND u.channel_id = $${params.push(channelId)}` : '';
            const res = await pool.query(
                `SELECT u.user_id, u.nickname, u.phone, u.coach_id, u.channel_id
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
                    (u.phone_verified_at IS NOT NULL AND u.phone IS NOT NULL) AS phone_verified,
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

const GET_USER_SELECT =
    `SELECT u.user_id, u.nickname, u.avatar_url, u.avatar_character, u.phone, u.email, u.language, u.gender,
            u.birth_date, u.roles, u.coach_id, u.channel_id, u.created_at, u.merged_into_user_id,
            (u.phone_verified_at IS NOT NULL AND u.phone IS NOT NULL) AS phone_verified,
            u.bio_data as user_bio_data,
            COALESCE((u.preferences->>'text_scale')::int, 0) AS text_scale,
            u.wearable_brand, u.wearable_mac, u.wearable_name, u.wearable_bound_at,
            u.referred_by_user_id, u.invited_by_invitation_id,
            ru.nickname as referrer_nickname,
            inv.code as invite_code,
            inv_cu.nickname as inviter_nickname
     FROM users u
     LEFT JOIN users ru ON ru.user_id = u.referred_by_user_id
     LEFT JOIN invitations inv ON inv.id = u.invited_by_invitation_id
     LEFT JOIN users inv_cu ON inv_cu.user_id = inv.created_by
     WHERE u.user_id=$1`;

async function handleGetUser(user_id) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const res = await pool.query(GET_USER_SELECT, [user_id]);
        if (!res.rows.length) return { success: false, error: 'User not found' };
        let row = res.rows[0];
        // Same-system account merge (handlers/user-merge.js) transparently resolved to the
        // surviving winner — mirrors the identical loop in handlers/login.js's
        // WX_LOGIN_USER_SELECT/WEBVIEW_USER_SELECT. Without this, a caller holding a merged-away
        // "loser" user_id (e.g. the miniapp's own cached session) reads that loser's own stale
        // phone/phone_verified instead of the winner's real, current state — which is exactly
        // what GCN's SSO exchange (WEBVIEW_USER_SELECT) already resolves through, so the two
        // could silently disagree.
        while (row.merged_into_user_id) {
            const winnerRes = await pool.query(GET_USER_SELECT, [row.merged_into_user_id]);
            if (winnerRes.rows.length === 0) break;
            row = winnerRes.rows[0];
        }
        return { success: true, user: row };
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
        // Atomic claim-and-mark-sent in a single statement (fixed 2026-08-01 after a real
        // duplicate-bubble report). The previous version ran a separate SELECT ... WHERE
        // status='pending' followed by an UPDATE — two near-simultaneous polls (e.g. onLoad and
        // onShow both kicking off _startPolling on a cold app launch) could both SELECT the
        // same row while it was still 'pending', before either UPDATE committed, delivering
        // (and rendering) the same notification twice even though it only exists once. A single
        // UPDATE ... RETURNING row-locks each matched row for the duration of the statement, so
        // a second concurrent call simply can't see a row the first has already claimed.
        const result = await pool.query(
            `UPDATE notifications SET status = 'sent'
             WHERE user_id = $1 AND status = 'pending'
             RETURNING id, content, notification_type, sent_at`,
            [openid]
        );
        const notifications = result.rows
            .sort((a, b) => new Date(a.sent_at) - new Date(b.sent_at))
            .map(({ id, content, notification_type }) => ({ id, content, notification_type }));
        return { success: true, notifications };
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

// Keeps user_phones (the actual source of truth for phone/OTP login — see phone-otp.js)
// in sync whenever the admin panel writes users.phone directly. Without this, an
// admin-edited phone never reaches user_phones: the new number can't be used to log in,
// and the next time this user re-verifies or switches their primary phone through the
// OTP flow, users.phone gets silently overwritten back to whatever user_phones says,
// erasing the manual edit with no warning.
async function syncPrimaryPhone(client, user_id, phone) {
    if (!phone) {
        await client.query(`UPDATE user_phones SET is_primary = false WHERE user_id = $1`, [user_id]);
        return { success: true };
    }
    const conflict = await client.query(
        `SELECT user_id FROM user_phones WHERE phone = $1 AND user_id != $2`,
        [phone, user_id]
    );
    if (conflict.rows.length > 0) return { success: false, error: 'phone_in_use' };

    // Demote any other phone this user holds before promoting the new one — user_phones
    // has a partial unique index enforcing one primary per user_id, so both can never be
    // true at once. verified_at is intentionally left NULL on insert: a manually-typed
    // admin edit isn't an OTP verification, so it shouldn't read as one.
    await client.query(`UPDATE user_phones SET is_primary = false WHERE user_id = $1 AND phone != $2`, [user_id, phone]);
    await client.query(
        `INSERT INTO user_phones (user_id, phone, is_primary) VALUES ($1, $2, true)
         ON CONFLICT (phone) DO UPDATE SET is_primary = true WHERE user_phones.user_id = EXCLUDED.user_id`,
        [user_id, phone]
    );
    return { success: true };
}

async function handlePutUser(user_id, body) {
    const { nickname, phone, email, gender, birth_date, language, coach_id, channel_id, bio_data, roles, avatar_url, avatar_character } = body;
    if (!pool) return { success: false, error: 'Database pool not initialized' };
    // Several callers (e.g. the Health tab's saveEdit, which only ever means to update
    // nickname/gender/birth_date/bio_data) send a body with no `phone` key at all, expecting
    // every other field to be left untouched — a plain partial update. Distinguishing "key
    // omitted" from "key present but empty" (an admin deliberately clearing the phone field)
    // is required so an unrelated profile edit can never silently wipe a verified phone —
    // found via a real incident where exactly this happened. `phone || null` alone can't
    // make that distinction (both cases evaluate the same way), so it's gated separately.
    const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
    const phoneProvided = has('phone');
    const emailProvided = has('email');
    const languageProvided = has('language');
    const coachIdProvided = has('coach_id');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        if (phoneProvided) {
            const phoneSync = await syncPrimaryPhone(client, user_id, phone || null);
            if (!phoneSync.success) {
                await client.query('ROLLBACK');
                return { success: false, statusCode: 409, error: phoneSync.error };
            }

            // A manually-typed admin edit isn't an OTP verification (same principle
            // syncPrimaryPhone already applies to user_phones.verified_at above) — if phone is
            // being changed, any stale phone_verified_at from whatever the account's old phone
            // was must not silently carry over onto the new value. Without this, an admin
            // clearing or retyping a phone here leaves phone_verified_at stamped for a phone
            // nobody ever actually OTP-verified, which every phone_verified read downstream
            // (login.js, the webview/GCN SSO handoff) trusts. Re-promoting a phone this same
            // user already OTP-verified before (switching primary back to an old, still-verified
            // secondary number) is the one case that's exempt.
            const currentPhoneRes = await client.query('SELECT phone FROM users WHERE user_id = $1', [user_id]);
            const currentPhone = currentPhoneRes.rows[0]?.phone || null;
            const newPhone = phone || null;
            if (newPhone !== currentPhone) {
                let keepVerified = false;
                if (newPhone) {
                    const verifiedRes = await client.query(
                        `SELECT 1 FROM user_phones WHERE user_id = $1 AND phone = $2 AND verified_at IS NOT NULL`,
                        [user_id, newPhone]
                    );
                    keepVerified = verifiedRes.rows.length > 0;
                }
                if (!keepVerified) {
                    await client.query('UPDATE users SET phone_verified_at = NULL WHERE user_id = $1', [user_id]);
                }
            }
        }

        // Built dynamically rather than as hand-numbered positional-param variants (the
        // previous shape here) — that pattern is exactly what let phone/email/language/
        // coach_id silently go unprotected against partial updates in the first place; a
        // field only added to one of four near-identical SQL strings is easy to miss adding
        // to the others. nickname/gender/birth_date stay unconditional (every known caller
        // that PUTs at all already means to set these); channel_id/avatar_url/avatar_character
        // keep their existing COALESCE-on-missing behavior. phone/email/coach_id support an
        // explicit clear (caller sends the key as empty) alongside "field omitted entirely"
        // (leave untouched) — the two are deliberately not the same thing, per phoneProvided
        // above. language has no real "clear" concept (falls back to 'zh' when provided-but-
        // empty, same as before this change), only "provided" vs "omitted".
        const sets = ['nickname=$1', 'gender=$2', 'birth_date=$3', 'channel_id=COALESCE($4, channel_id)', 'avatar_url=COALESCE($5, avatar_url)', 'avatar_character=COALESCE($6, avatar_character)'];
        const params = [nickname || null, gender || null, birth_date || null, channel_id || null, avatar_url || null, avatar_character || null];
        const addConditional = (column, provided, value) => {
            if (provided) {
                params.push(value);
                sets.push(`${column}=$${params.length}`);
            } else {
                sets.push(`${column}=${column}`);
            }
        };
        addConditional('phone', phoneProvided, phone || null);
        addConditional('email', emailProvided, email || null);
        addConditional('language', languageProvided, language || 'zh');
        addConditional('coach_id', coachIdProvided, coach_id || null);
        if (bio_data) {
            params.push(JSON.stringify(bio_data));
            sets.push(`bio_data = bio_data || $${params.length}`);
        }
        if (roles) {
            params.push(roles);
            sets.push(`roles=$${params.length}`);
        }
        params.push(user_id);
        await client.query(`UPDATE users SET ${sets.join(', ')} WHERE user_id=$${params.length}`, params);
        // Sync coaches table when roles change
        if (roles) {
            if (roles.includes('coach')) {
                await client.query(
                    `INSERT INTO coaches (user_id)
                     SELECT $1 FROM users WHERE user_id = $1
                     AND NOT EXISTS (SELECT 1 FROM coaches WHERE user_id = $1)`,
                    [user_id]
                );
            } else {
                // Block removal if coach still has assigned users
                const coachRow = await client.query('SELECT id FROM coaches WHERE user_id = $1', [user_id]);
                if (coachRow.rows.length > 0) {
                    const coachId = coachRow.rows[0].id;
                    const assigned = await client.query('SELECT COUNT(*) FROM users WHERE coach_id = $1', [coachId]);
                    if (parseInt(assigned.rows[0].count) > 0) {
                        await client.query('ROLLBACK');
                        return { success: false, statusCode: 409, error: `Cannot remove coach role: ${assigned.rows[0].count} user(s) are still assigned to this coach.` };
                    }
                    await client.query('DELETE FROM coaches WHERE id = $1', [coachId]);
                }
            }
        }
        await client.query('COMMIT');

        if (phoneProvided) await syncPartnerPhoneFromUser(user_id, phone || null);

        return { success: true };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        return { success: false, statusCode: 500, error: err.message };
    } finally {
        client.release();
    }
}

async function handlePatchUser(user_id, body) {
    const { theme, wearable, text_scale } = body;
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const updates = [];
        const params = [];
        if (theme !== undefined) {
            params.push(theme === 'light' ? 'light' : 'dark');
            updates.push(`theme = $${params.length}`);
        }
        // Accessibility text-size level (0-3), mirrored from the miniapp's
        // app.globalData.textScale / wx.getStorageSync('nano_text_scale').
        // Merged with `||` rather than assigned: jsonb_build_object would wipe the
        // dispatcher's preferences->>'daily_checkin_enabled' opt-out.
        if (text_scale !== undefined) {
            const lvl = Math.max(0, Math.min(3, parseInt(text_scale, 10) || 0));
            params.push(JSON.stringify({ text_scale: lvl }));
            updates.push(`preferences = COALESCE(preferences, '{}'::jsonb) || $${params.length}::jsonb`);
        }
        // wearable: { brand, mac, name } to bind/update, or null to unbind.
        if (wearable !== undefined) {
            if (wearable === null) {
                updates.push('wearable_brand = NULL', 'wearable_mac = NULL', 'wearable_name = NULL', 'wearable_bound_at = NULL');
            } else {
                params.push(wearable.brand ?? null);
                updates.push(`wearable_brand = $${params.length}`);
                params.push(wearable.mac ?? null);
                updates.push(`wearable_mac = $${params.length}`);
                params.push(wearable.name ?? null);
                updates.push(`wearable_name = $${params.length}`);
                updates.push('wearable_bound_at = NOW()');
            }
        }
        if (updates.length === 0) return { success: true };
        params.push(user_id);
        await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE user_id = $${params.length}`, params);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// PATCH-style identity capture, separate from handlePatchUser (theme/wearable only) since
// this is the one write path with real consequences: it's also the trigger point for the
// same-system duplicate-account merge (see handlers/user-merge.js). No general profile-
// update endpoint existed for these fields before this — government_id/first_name/last_name
// were previously only ever set via a one-time academy backfill script
// (migration_users_government_id_backfill.sql), and birth_date only via the chat
// questionnaire, so this is the first live path a user can set all four through directly.
async function handleSetIdentity(user_id, body) {
    const { first_name, last_name, birth_date, government_id } = body || {};
    if (!user_id) return { success: false, error: 'user_id is required' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };

        const updates = [];
        const params = [];
        if (first_name !== undefined) { params.push(first_name); updates.push(`first_name = $${params.length}`); }
        if (last_name !== undefined) { params.push(last_name); updates.push(`last_name = $${params.length}`); }
        if (birth_date !== undefined) { params.push(birth_date); updates.push(`birth_date = $${params.length}`); }
        if (government_id !== undefined) { params.push(government_id); updates.push(`government_id = $${params.length}`); }
        if (updates.length === 0) return { success: true };

        params.push(user_id);
        const updated = await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE user_id = $${params.length} RETURNING user_id`, params);
        if (updated.rows.length === 0) return { success: false, error: 'user_not_found' };

        const mergedIntoUserId = await findAndMergeDuplicateAccount(user_id);
        return { success: true, merged_into_user_id: mergedIntoUserId };
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
                   i.note,
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
    const { created_by, channel_id, type = 'coach', max_uses = null, note = null } = body;
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
        const cleanNote = (typeof note === 'string' && note.trim()) ? note.trim() : null;
        const result = await pool.query(
            `INSERT INTO invitations (code, created_by, created_by_snapshot, channel_id, type, max_uses, note)
             VALUES ($1, $2, $2, $3, $4, $5, $6) RETURNING id, code`,
            [code, created_by || null, parseInt(channel_id), type, max_uses || null, cleanNote]
        );
        return { success: true, id: result.rows[0].id, code: result.rows[0].code };
    } catch (err) {
        return { success: false, error: err.detail || err.message };
    }
}

async function handlePatchInvitation(inviteId, body) {
    const { note } = body;
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        if (note === undefined) return { success: true };
        const cleanNote = (typeof note === 'string' && note.trim()) ? note.trim() : null;
        await pool.query('UPDATE invitations SET note = $1 WHERE id = $2', [cleanNote, inviteId]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
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

// Server-to-server only (GCN_ALLOWED_PATHS-gated, see worker/index.js) — GCN calls this the
// moment a custom-formulation order is confirmed paid. This one nullable timestamp is nano's
// entire signal for "has this user ever bought a custom formulation" (nano has no visibility
// into GCN's orders otherwise), used to gate the topup-triggered reorder-ready notification
// (it was read by the since-removed nutrition top-up job) — no need to re-derive it, so
// this is a plain unconditional UPDATE rather than an ON CONFLICT-guarded first-write-only one.
// POST /api/formulation-purchase-confirmed   (GCN service token)
//
// GCN confirmed payment on a formulation order. Two things come out of that, and they are for
// different products:
//
//   1. The purchase flag, always. nano has no other visibility into GCN's orders and uses this one
//      column to decide whether a later reformulation should be framed as a reorder.
//   2. A chat message, only when the order parked at 'awaiting_formulation' — i.e. a buy-first
//      package (GCN's migration_0085) whose recipe does not exist yet. That order is waiting on
//      something ONLY this app can produce, and nothing in the store says so; without this message
//      the buyer has paid and has no idea the next move is theirs.
//
// A formulate→buy order (migration_0061) sends neither flag nor message beyond (1): its recipe
// already exists and there is nothing to prompt.
async function handlePostFormulationPurchaseConfirmed(body) {
    const { openid, awaiting_formulation, fulfillment, max_distinct_dots, package_name,
            intended_nano_plan_id } = body || {};
    if (!openid) return { success: false, error: 'openid is required' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const { rows: [user] } = await pool.query(
            `UPDATE users SET custom_formulation_purchased_at = NOW()
             WHERE user_id = $1 OR external_id = $1
             RETURNING user_id, language`,
            [openid]
        );
        if (!user) return { success: false, error: 'user_not_found' };

        // An expert-review package is formulated by Viva AG on its own schedule — the user has
        // nothing to do, so inviting them to run 营养定制 would send them somewhere that cannot
        // fulfil their order.
        if (awaiting_formulation && fulfillment === 'fast_track') {
            await _settleFastTrackPackage(user, { max_distinct_dots, package_name, intended_nano_plan_id });
        }
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// A fast-track package just went paid. Two outcomes, and this is where which one happens is decided.
//
// The buyer reached checkout by tapping "order" on a formulation card, so they usually have a
// specific proposal in mind, and GCN carried its id through (migration_0086). Attaching it now is
// the difference between "you already approved this, we are compounding it" and sending someone
// back to re-run a tool on a formula they just agreed to.
//
// It is only ever an ATTEMPT. handlePostFormulationSubmit re-checks everything from scratch —
// ownership, that the plan is still 'proposed' (a newer formulation supersedes it), that an order
// really is waiting, that it fits the purchased weekly width, and that the expansion still passes
// the validator. Any of those can legitimately say no, and every no falls through to the nudge —
// which is exactly the behaviour this flow had before a plan id was carried at all. Nothing here
// can leave the buyer worse off than the nudge alone.
async function _settleFastTrackPackage(user, { max_distinct_dots, package_name, intended_nano_plan_id }) {
    const planId = Number(intended_nano_plan_id);
    if (Number.isFinite(planId) && planId > 0) {
        try {
            // Required at call time for the same reason ./chat is below.
            const { handlePostFormulationSubmit } = require('./dots');
            const result = await handlePostFormulationSubmit({ openid: user.user_id, plan_id: planId });
            if (result?.success) {
                console.log(JSON.stringify({ level: 'INFO', msg: 'fasttrack_auto_submitted',
                    user_id: user.user_id, plan_id: planId, order_id: result.order_id,
                    already_submitted: !!result.already_submitted }));
                await _notifyFormulationAutoSubmitted(user, { package_name });
                return;
            }
            // The one refusal worth its own message: the formula is fine, it is simply wider than
            // the package they bought. Re-running the tool now produces one built for the tier,
            // because the prompt is told the width.
            if (result?.reason === 'formulation_exceeds_package') {
                console.log(JSON.stringify({ level: 'INFO', msg: 'fasttrack_auto_submit_over_tier',
                    user_id: user.user_id, plan_id: planId,
                    distinct_dots: result.distinct_dots, max_distinct_dots: result.max_distinct_dots }));
                await _notifyFormulationPackagePaid(user, {
                    max_distinct_dots: result.max_distinct_dots ?? max_distinct_dots,
                    package_name, overTierDots: result.distinct_dots,
                });
                return;
            }
            console.log(JSON.stringify({ level: 'INFO', msg: 'fasttrack_auto_submit_declined',
                user_id: user.user_id, plan_id: planId, reason: result?.reason || 'unknown' }));
        } catch (err) {
            // Never fatal: the nudge below is the entire pre-existing behaviour and still works.
            console.error(JSON.stringify({ level: 'ERROR', msg: 'fasttrack_auto_submit_failed',
                user_id: user.user_id, plan_id: planId, error: err.message }));
        }
    }
    await _notifyFormulationPackagePaid(user, { max_distinct_dots, package_name });
}

// The proposal the buyer ordered was accepted and is going to compounding, so this is a
// confirmation, not an instruction. Telling them to go and formulate here would be wrong twice
// over: the work is done, and running the tool again would produce a NEW proposal that is not the
// one being compounded.
async function _notifyFormulationAutoSubmitted(user, { package_name }) {
    try {
        const { deliverTerminalMessage } = require('./chat');
        const { resolveEffectivePersona } = require('../lib/persona');
        const { rows: [row] } = await pool.query(
            `SELECT c.config->>'persona_type' AS channel_persona,
                    u.persona_override_type, u.persona_override_expires_at
             FROM users u LEFT JOIN channels c ON c.id = u.channel_id
             WHERE u.user_id = $1`,
            [user.user_id]
        );
        const personaType = resolveEffectivePersona({
            channelPersonaType: row?.channel_persona,
            personaOverrideType: row?.persona_override_type,
            personaOverrideExpiresAt: row?.persona_override_expires_at,
        });
        const isZh = (user.language || 'zh') !== 'en';
        const name = package_name || (isZh ? '28天定制套餐' : 'your 28-day custom package');
        const text = isZh
            ? `您的「${name}」已支付成功 🎉\n\n您下单时确认的原粒配方已提交配制，我们会尽快为您加工发货。收到实物后扫描包装上的二维码，即可开始您的 28 天周期。`
            : `Your ${name} is paid 🎉\n\nThe formula you confirmed at checkout has gone to compounding — we'll get it made and shipped. Scan the QR on the box when it arrives to start your 28-day cycle.`;
        await deliverTerminalMessage(user.user_id, personaType, 'formulation_order_paid', text);
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'formulation_auto_submitted_notify_failed',
            user_id: user.user_id, error: err.message }));
    }
}

// Delivers the "your package is paid — now formulate it" nudge.
//
// Best-effort by design: the money has already moved and the flag above is already written, so a
// failure here must never turn into a non-2xx that makes GCN log a failed payment notify. The user
// can still reach 营养定制 on their own, and the card they get there resolves the waiting order at
// delivery time regardless of whether this message ever arrived.
//
// require('./chat') is at call time rather than at module load: chat.js pulls in the whole dots /
// questionnaires / coaches graph, and this is one endpoint on a module that is otherwise a leaf of
// that graph. Nothing in the chat graph requires users.js, so this is not breaking a cycle — it is
// keeping a cold path off the module-load critical path of every warm container.
async function _notifyFormulationPackagePaid(user, { max_distinct_dots, package_name, overTierDots }) {
    try {
        const { deliverTerminalMessage } = require('./chat');
        const { resolveEffectivePersona } = require('../lib/persona');
        const { rows: [row] } = await pool.query(
            `SELECT c.config->>'persona_type' AS channel_persona,
                    u.persona_override_type, u.persona_override_expires_at
             FROM users u LEFT JOIN channels c ON c.id = u.channel_id
             WHERE u.user_id = $1`,
            [user.user_id]
        );
        const personaType = resolveEffectivePersona({
            channelPersonaType: row?.channel_persona,
            personaOverrideType: row?.persona_override_type,
            personaOverrideExpiresAt: row?.persona_override_expires_at,
        });
        const isZh = (user.language || 'zh') !== 'en';
        const cap = Number(max_distinct_dots);
        // "per week", not "in total": the package caps how many dots run at once, and the formula
        // may rotate others in the following week. Saying "up to N dots" would undersell what
        // they bought and misdescribe the box.
        const tier = Number.isFinite(cap) && cap > 0
            ? (isZh ? `（每周最多 ${cap} 种原粒）` : ` (up to ${cap} dots running each week)`)
            : '';
        const name = package_name || (isZh ? '28天定制套餐' : 'your 28-day custom package');
        // Say WHY when the plan they ordered was refused. Without it they would regenerate the same
        // too-wide formula and hit the same wall; with it, one re-run inside the tool (whose prompt
        // is told the width) produces one that fits.
        const overTier = Number.isFinite(Number(overTierDots)) && Number(overTierDots) > 0
            ? (isZh
                ? `\n\n您下单时的方案某一周同时用到 ${overTierDots} 种原粒，超出本套餐上限，因此未直接提交。`
                : `\n\nThe formulation you had at checkout runs ${overTierDots} dots at once in one of its weeks, over this package's limit, so it wasn't submitted as-is.`)
            : '';
        const text = isZh
            ? `您的「${name}」${tier}已支付成功 🎉${overTier}\n\n接下来请在下方工具箱中点击「营养定制」，我会根据您最新的健康数据为您生成这 28 天的专属原粒配方。确认方案后我们就立即开始配制发货。`
            : `Your ${name}${tier} is paid 🎉${overTier}\n\nNext, tap "Formulate Dots" in the toolbox below and I'll build your bespoke 28-day capsule formula from your latest health data. Confirm it and compounding starts right away.`;
        await deliverTerminalMessage(user.user_id, personaType, 'formulation_order_paid', text);
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'formulation_order_paid_notify_failed',
            user_id: user.user_id, error: err.message }));
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
    handleSetIdentity,
    handleDeleteUser,
    handleGetInvitations,
    handlePostInvitation,
    handlePatchInvitation,
    handleDeleteInvitation,
    handlePostFormulationPurchaseConfirmed,
};
