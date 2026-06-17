const { pool } = require('../lib/db');

async function handleGetCommissionSettings() {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const { rows } = await pool.query(
            'SELECT id, role, product_type, flat_rate_cny, percentage FROM commission_settings ORDER BY role, product_type'
        );
        return { success: true, settings: rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePutCommissionSetting(id, body) {
    const { flat_rate_cny, percentage } = body;
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        await pool.query(
            'UPDATE commission_settings SET flat_rate_cny=$1, percentage=$2, updated_at=NOW() WHERE id=$3',
            [flat_rate_cny ?? null, percentage ?? null, id]
        );
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetCoachCommissions(query) {
    const { coach_id, channel_id, status } = query;
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const conditions = [];
        const params = [];
        if (coach_id)   { params.push(coach_id);   conditions.push(`cc.coach_id=$${params.length}`); }
        if (channel_id) { params.push(channel_id); conditions.push(`cc.channel_id=$${params.length}`); }
        if (status)     { params.push(status);     conditions.push(`cc.status=$${params.length}`); }
        const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
        const { rows } = await pool.query(`
            SELECT cc.*, u.nickname AS coach_name, ch.name AS channel_name
            FROM coach_commissions cc
            LEFT JOIN users u ON u.user_id = cc.coach_id
            LEFT JOIN channels ch ON ch.id = cc.channel_id
            ${where}
            ORDER BY cc.created_at DESC
            LIMIT 500
        `, params);
        return { success: true, commissions: rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetChannelCommissions(query) {
    const { channel_id, status } = query;
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const conditions = [];
        const params = [];
        if (channel_id) { params.push(channel_id); conditions.push(`cc.channel_id=$${params.length}`); }
        if (status)     { params.push(status);     conditions.push(`cc.status=$${params.length}`); }
        const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
        const { rows } = await pool.query(`
            SELECT cc.*, ch.name AS channel_name, u.nickname AS coach_name
            FROM channel_commissions cc
            LEFT JOIN channels ch ON ch.id = cc.channel_id
            LEFT JOIN users u ON u.user_id = cc.coach_id
            ${where}
            ORDER BY cc.created_at DESC
            LIMIT 500
        `, params);
        return { success: true, commissions: rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetCoachEarnings(coachUserId) {
    if (!coachUserId) return { success: false, error: 'coach_user_id required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const now = new Date();
        const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const [thisMonth, available, payouts] = await Promise.all([
            pool.query(
                `SELECT COALESCE(SUM(amount_cny),0) AS total FROM coach_commissions
                 WHERE coach_id=$1 AND status='pending' AND to_char(created_at,'YYYY-MM')=$2`,
                [coachUserId, period]
            ),
            pool.query(
                `SELECT COALESCE(SUM(amount_cny),0) AS total FROM coach_commissions
                 WHERE coach_id=$1 AND status='approved'`,
                [coachUserId]
            ),
            pool.query(
                `SELECT id, period, total_cny, status, transferred_at FROM coach_payouts
                 WHERE coach_id=$1 ORDER BY period DESC LIMIT 12`,
                [coachUserId]
            ),
        ]);
        return {
            success: true,
            this_month_pending: Number(thisMonth.rows[0].total),
            available_cny: Number(available.rows[0].total),
            payouts: payouts.rows,
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetCoachPayouts(query) {
    const { coach_id, channel_id } = query;
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const conditions = [];
        const params = [];
        if (coach_id)   { params.push(coach_id);   conditions.push(`cp.coach_id=$${params.length}`); }
        if (channel_id) { params.push(channel_id); conditions.push(`cp.channel_id=$${params.length}`); }
        const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
        const { rows } = await pool.query(`
            SELECT cp.*, u.nickname AS coach_name, ch.name AS channel_name
            FROM coach_payouts cp
            LEFT JOIN users u ON u.user_id = cp.coach_id
            LEFT JOIN channels ch ON ch.id = cp.channel_id
            ${where}
            ORDER BY cp.period DESC, cp.created_at DESC
        `, params);
        return { success: true, payouts: rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetChannelPayouts(query) {
    const { channel_id } = query;
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const params = [];
        let where = '';
        if (channel_id) { params.push(channel_id); where = 'WHERE cp.channel_id=$1'; }
        const { rows } = await pool.query(`
            SELECT cp.*, ch.name AS channel_name
            FROM channel_payouts cp
            LEFT JOIN channels ch ON ch.id = cp.channel_id
            ${where}
            ORDER BY cp.period DESC, cp.created_at DESC
        `, params);
        return { success: true, payouts: rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostGenerateCoachPayouts(body) {
    const { channel_id, period } = body;
    if (!period) return { success: false, error: 'period required (YYYY-MM)', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const conditions = [`to_char(cc.created_at,'YYYY-MM') = $1`, `cc.status = 'pending'`, `cc.payout_id IS NULL`];
        const params = [period];
        if (channel_id) { params.push(channel_id); conditions.push(`cc.channel_id=$${params.length}`); }
        const { rows: groups } = await pool.query(`
            SELECT cc.coach_id, cc.channel_id, COALESCE(SUM(cc.amount_cny),0) AS total,
                   array_agg(cc.id) AS commission_ids
            FROM coach_commissions cc
            WHERE ${conditions.join(' AND ')}
            GROUP BY cc.coach_id, cc.channel_id
            HAVING SUM(cc.amount_cny) > 0
        `, params);

        let created = 0;
        for (const g of groups) {
            const res = await pool.query(`
                INSERT INTO coach_payouts (coach_id, channel_id, period, total_cny, status)
                VALUES ($1,$2,$3,$4,'draft')
                ON CONFLICT (coach_id, period) DO UPDATE SET total_cny=EXCLUDED.total_cny
                RETURNING id
            `, [g.coach_id, g.channel_id, period, g.total]);
            const payoutId = res.rows[0].id;
            await pool.query(
                `UPDATE coach_commissions SET payout_id=$1 WHERE id = ANY($2::uuid[])`,
                [payoutId, g.commission_ids]
            );
            created++;
        }
        return { success: true, generated: created };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostGenerateChannelPayouts(body) {
    const { period } = body;
    if (!period) return { success: false, error: 'period required (YYYY-MM)', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const { rows: groups } = await pool.query(`
            SELECT cc.channel_id, COALESCE(SUM(cc.amount_cny),0) AS total,
                   array_agg(cc.id) AS commission_ids
            FROM channel_commissions cc
            WHERE to_char(cc.created_at,'YYYY-MM') = $1
              AND cc.status = 'pending'
              AND cc.payout_id IS NULL
            GROUP BY cc.channel_id
            HAVING SUM(cc.amount_cny) > 0
        `, [period]);

        let created = 0;
        for (const g of groups) {
            const res = await pool.query(`
                INSERT INTO channel_payouts (channel_id, period, total_cny, status)
                VALUES ($1,$2,$3,'draft')
                ON CONFLICT (channel_id, period) DO UPDATE SET total_cny=EXCLUDED.total_cny
                RETURNING id
            `, [g.channel_id, period, g.total]);
            const payoutId = res.rows[0].id;
            await pool.query(
                `UPDATE channel_commissions SET payout_id=$1 WHERE id = ANY($2::uuid[])`,
                [payoutId, g.commission_ids]
            );
            created++;
        }
        return { success: true, generated: created };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePutCoachPayout(payoutId, body) {
    const { status, approved_by } = body;
    if (!status) return { success: false, error: 'status required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const now = new Date().toISOString();
        await pool.query(`
            UPDATE coach_payouts
            SET status=$1,
                approved_by=CASE WHEN $1='approved' THEN $2 ELSE approved_by END,
                approved_at=CASE WHEN $1='approved' THEN $3 ELSE approved_at END,
                transferred_at=CASE WHEN $1='transferred' THEN $3 ELSE transferred_at END
            WHERE id=$4
        `, [status, approved_by || null, now, payoutId]);
        if (status === 'approved' || status === 'transferred') {
            await pool.query(
                `UPDATE coach_commissions SET status=$1 WHERE payout_id=$2`,
                [status, payoutId]
            );
        }
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePutChannelPayout(payoutId, body) {
    const { status, approved_by } = body;
    if (!status) return { success: false, error: 'status required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const now = new Date().toISOString();
        await pool.query(`
            UPDATE channel_payouts
            SET status=$1,
                approved_by=CASE WHEN $1='approved' THEN $2 ELSE approved_by END,
                approved_at=CASE WHEN $1='approved' THEN $3 ELSE approved_at END,
                transferred_at=CASE WHEN $1='transferred' THEN $3 ELSE transferred_at END
            WHERE id=$4
        `, [status, approved_by || null, now, payoutId]);
        if (status === 'approved' || status === 'transferred') {
            await pool.query(
                `UPDATE channel_commissions SET status=$1 WHERE payout_id=$2`,
                [status, payoutId]
            );
        }
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = {
    handleGetCommissionSettings,
    handlePutCommissionSetting,
    handleGetCoachCommissions,
    handleGetChannelCommissions,
    handleGetCoachEarnings,
    handleGetCoachPayouts,
    handleGetChannelPayouts,
    handlePostGenerateCoachPayouts,
    handlePostGenerateChannelPayouts,
    handlePutCoachPayout,
    handlePutChannelPayout,
};
