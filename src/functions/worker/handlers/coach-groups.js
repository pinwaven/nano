const { pool } = require('../lib/db');

// ── Coach Groups ──────────────────────────────────────────────────────────────

async function handleGetCoachGroups(query, adminCtx) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const channelId = adminCtx?.channelId || query.channel_id;
        if (!channelId) return { success: false, error: 'channel_id is required', statusCode: 400 };
        const result = await pool.query(
            `SELECT cg.id, cg.channel_id, cg.name, cg.description, cg.type, cg.created_at,
                    COUNT(DISTINCT c.id) AS coach_count
             FROM coach_groups cg
             LEFT JOIN coaches c ON c.group_id = cg.id
             WHERE cg.channel_id = $1
             GROUP BY cg.id
             ORDER BY cg.name`,
            [channelId]
        );
        return { success: true, groups: result.rows };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handlePostCoachGroup(body, adminCtx) {
    const { name, description, type } = body;
    const channelId = adminCtx?.channelId || body.channel_id;
    if (!channelId) return { success: false, error: 'channel_id is required', statusCode: 400 };
    if (!name) return { success: false, error: 'name is required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const result = await pool.query(
            'INSERT INTO coach_groups (channel_id, name, description, type) VALUES ($1, $2, $3, $4) RETURNING *',
            [channelId, name, description || null, type || null]
        );
        return { success: true, group: result.rows[0] };
    } catch (err) {
        if (err.code === '23505') return { success: false, error: 'A group with that name already exists in this channel', statusCode: 409 };
        return { success: false, error: err.message };
    }
}

async function handlePutCoachGroup(groupId, body, adminCtx) {
    const { name, description, type } = body;
    if (!name) return { success: false, error: 'name is required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        if (adminCtx?.channelId) {
            const check = await pool.query('SELECT channel_id FROM coach_groups WHERE id = $1', [groupId]);
            if (!check.rows.length) return { success: false, error: 'Group not found', statusCode: 404 };
            if (parseInt(check.rows[0].channel_id) !== parseInt(adminCtx.channelId)) return { success: false, error: 'Forbidden', statusCode: 403 };
        }
        const result = await pool.query(
            'UPDATE coach_groups SET name=$1, description=$2, type=$3 WHERE id=$4 RETURNING *',
            [name, description || null, type || null, groupId]
        );
        if (!result.rows.length) return { success: false, error: 'Group not found', statusCode: 404 };
        return { success: true, group: result.rows[0] };
    } catch (err) {
        if (err.code === '23505') return { success: false, error: 'A group with that name already exists in this channel', statusCode: 409 };
        return { success: false, error: err.message };
    }
}

async function handleDeleteCoachGroup(groupId, adminCtx) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        if (adminCtx?.channelId) {
            const check = await pool.query('SELECT channel_id FROM coach_groups WHERE id = $1', [groupId]);
            if (!check.rows.length) return { success: false, error: 'Group not found', statusCode: 404 };
            if (parseInt(check.rows[0].channel_id) !== parseInt(adminCtx.channelId)) return { success: false, error: 'Forbidden', statusCode: 403 };
        }
        await pool.query('DELETE FROM coach_groups WHERE id = $1', [groupId]);
        return { success: true };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handleGetCoachGroupKpis(query) {
    const { group_id, period } = query;
    if (!group_id) return { success: false, error: 'group_id is required', statusCode: 400 };
    const targetPeriod = period || new Date().toISOString().slice(0, 7);
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const groupRow = await pool.query('SELECT id, name, type FROM coach_groups WHERE id = $1', [group_id]);
        if (!groupRow.rows.length) return { success: false, error: 'Group not found', statusCode: 404 };

        const isCurrentMonth = targetPeriod === new Date().toISOString().slice(0, 7);
        if (!isCurrentMonth) {
            const snap = await pool.query(
                `SELECT
                    SUM(cps.total_clients)::int      AS total_clients,
                    SUM(cps.active_clients)::int     AS active_clients,
                    SUM(cps.at_risk_count)::int      AS at_risk_count,
                    SUM(cps.scans_facilitated)::int  AS scans_facilitated,
                    SUM(cps.plans_assigned)::int     AS plans_assigned,
                    SUM(cps.messages_sent)::int      AS messages_sent,
                    SUM(cps.appointments_held)::int  AS appointments_held,
                    SUM(cps.commission_cny)          AS commission_cny,
                    SUM(cps.nps_response_count)::int AS nps_response_count,
                    CASE WHEN SUM(cps.nps_response_count) > 0
                         THEN SUM(cps.avg_nps_score * cps.nps_response_count) / SUM(cps.nps_response_count)
                         ELSE NULL END                AS avg_nps_score,
                    COUNT(cps.coach_id)::int          AS coach_count
                 FROM coach_performance_snapshots cps
                 JOIN coaches c ON c.id = cps.coach_id
                 WHERE c.group_id = $1 AND cps.period = $2`,
                [group_id, targetPeriod]
            );
            if (snap.rows.length && snap.rows[0].coach_count > 0) {
                return { success: true, kpis: { ...snap.rows[0], group_id: parseInt(group_id), period: targetPeriod }, group: groupRow.rows[0], source: 'snapshot' };
            }
        }

        const coachIds = await pool.query('SELECT id FROM coaches WHERE group_id = $1', [group_id]);
        if (!coachIds.rows.length) {
            return { success: true, kpis: { group_id: parseInt(group_id), period: targetPeriod, total_clients: 0, active_clients: 0, at_risk_count: 0, scans_facilitated: 0, plans_assigned: 0, messages_sent: 0, appointments_held: 0, avg_nps_score: null, nps_response_count: 0, commission_cny: 0, coach_count: 0 }, group: groupRow.rows[0], source: 'live' };
        }
        const ids = coachIds.rows.map(r => r.id);
        const [pipeline, scans, plans, msgs, appts, nps, commissions] = await Promise.all([
            pool.query(
                `SELECT COALESCE(cps.stage, 'lead') AS stage, COUNT(u.user_id) AS cnt
                 FROM users u
                 LEFT JOIN client_pipeline_stages cps ON cps.user_id = u.user_id AND cps.coach_id = u.coach_id
                 WHERE u.coach_id = ANY($1)
                 GROUP BY COALESCE(cps.stage, 'lead')`,
                [ids]
            ),
            pool.query(`SELECT COUNT(*) AS cnt FROM biomarkers b JOIN users u ON u.user_id = b.user_id WHERE u.coach_id = ANY($1) AND b.test_type = 'kino_chip' AND TO_CHAR(b.tested_at, 'YYYY-MM') = $2`, [ids, targetPeriod]),
            pool.query(`SELECT COUNT(*) AS cnt FROM health_plans WHERE coach_id = ANY($1) AND TO_CHAR(created_at, 'YYYY-MM') = $2`, [ids, targetPeriod]),
            pool.query(`SELECT COUNT(*) AS cnt FROM client_activity_log WHERE coach_id = ANY($1) AND activity_type = 'message_sent' AND TO_CHAR(occurred_at, 'YYYY-MM') = $2`, [ids, targetPeriod]),
            pool.query(`SELECT COUNT(*) AS cnt FROM appointments WHERE coach_id = ANY($1) AND status = 'completed' AND TO_CHAR(scheduled_at, 'YYYY-MM') = $2`, [ids, targetPeriod]),
            pool.query(`SELECT AVG(score) AS avg_score, COUNT(*) AS cnt FROM client_nps_surveys WHERE coach_id = ANY($1) AND status = 'responded' AND TO_CHAR(sent_at, 'YYYY-MM') = $2`, [ids, targetPeriod]),
            pool.query(`SELECT COALESCE(SUM(amount_cny), 0) AS total FROM coach_commissions WHERE coach_id = ANY($1) AND TO_CHAR(created_at, 'YYYY-MM') = $2`, [ids, targetPeriod]),
        ]);
        const stageMap = {};
        for (const row of pipeline.rows) stageMap[row.stage] = parseInt(row.cnt, 10);
        const kpis = {
            group_id: parseInt(group_id),
            period: targetPeriod,
            total_clients: Object.values(stageMap).reduce((a, b) => a + b, 0),
            active_clients: stageMap['active'] || 0,
            at_risk_count: stageMap['at_risk'] || 0,
            scans_facilitated: parseInt(scans.rows[0].cnt, 10),
            plans_assigned: parseInt(plans.rows[0].cnt, 10),
            messages_sent: parseInt(msgs.rows[0].cnt, 10),
            appointments_held: parseInt(appts.rows[0].cnt, 10),
            avg_nps_score: nps.rows[0].avg_score ? parseFloat(parseFloat(nps.rows[0].avg_score).toFixed(2)) : null,
            nps_response_count: parseInt(nps.rows[0].cnt, 10),
            commission_cny: parseFloat(commissions.rows[0].total),
            coach_count: ids.length,
        };
        return { success: true, kpis, group: groupRow.rows[0], source: 'live' };
    } catch (err) { return { success: false, error: err.message }; }
}

module.exports = {
    handleGetCoachGroups,
    handlePostCoachGroup,
    handlePutCoachGroup,
    handleDeleteCoachGroup,
    handleGetCoachGroupKpis,
};
