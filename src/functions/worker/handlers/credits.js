const { pool } = require('../lib/db');
const { getUserBalance, getLedgerHistory, creditUser, debitUser, getChannelExchangeRate, getChannelCurrency } = require('../lib/credits');

async function handleGetCreditBalance(query) {
    const { user_id, openid } = query;
    const uid = user_id || openid;
    if (!uid) return { success: false, error: 'user_id is required', statusCode: 400 };
    try {
        const userRes = await pool.query('SELECT channel_id FROM users WHERE user_id = $1', [uid]);
        if (!userRes.rows[0]) return { success: false, error: 'User not found', statusCode: 404 };
        const channelId = userRes.rows[0].channel_id;
        const [balance, exchangeRate, currency] = await Promise.all([
            getUserBalance(uid),
            getChannelExchangeRate(channelId),
            getChannelCurrency(channelId),
        ]);
        return { success: true, balance, exchange_rate: exchangeRate, currency };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetCreditHistory(query) {
    const { user_id, openid, limit, offset } = query;
    const uid = user_id || openid;
    if (!uid) return { success: false, error: 'user_id is required', statusCode: 400 };
    try {
        const rows = await getLedgerHistory(uid, parseInt(limit || 50), parseInt(offset || 0));
        return { success: true, history: rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostCreditWithdraw(body) {
    const { user_id, openid, credits_amount, payment_method, payment_account } = body;
    const uid = user_id || openid;
    if (!uid) return { success: false, error: 'user_id is required', statusCode: 400 };
    if (!credits_amount || parseFloat(credits_amount) <= 0) return { success: false, error: 'credits_amount must be positive', statusCode: 400 };
    try {
        const userRes = await pool.query('SELECT channel_id FROM users WHERE user_id = $1', [uid]);
        if (!userRes.rows[0]) return { success: false, error: 'User not found', statusCode: 404 };
        const channelId = userRes.rows[0].channel_id;
        const [balance, exchangeRate, currency] = await Promise.all([
            getUserBalance(uid),
            getChannelExchangeRate(channelId),
            getChannelCurrency(channelId),
        ]);
        const credits = parseFloat(parseFloat(credits_amount).toFixed(2));
        if (credits > balance) return { success: false, error: 'Insufficient credit balance', statusCode: 400 };
        const currencyAmount = parseFloat((credits / exchangeRate).toFixed(2));
        const { rows } = await pool.query(
            `INSERT INTO credit_withdrawals
                (user_id, credits_amount, currency_amount, exchange_rate, currency, payment_method, payment_account)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
            [uid, credits, currencyAmount, exchangeRate, currency,
             payment_method || 'wechat_pay', payment_account || null]
        );
        return { success: true, withdrawal_id: rows[0].id, credits_amount: credits, currency_amount: currencyAmount, currency };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetUserWithdrawals(query) {
    const { user_id, openid } = query;
    const uid = user_id || openid;
    if (!uid) return { success: false, error: 'user_id is required', statusCode: 400 };
    try {
        const { rows } = await pool.query(
            `SELECT * FROM credit_withdrawals WHERE user_id = $1 ORDER BY requested_at DESC LIMIT 50`,
            [uid]
        );
        return { success: true, withdrawals: rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetAdminWithdrawals(query) {
    const { status, channel_id } = query;
    try {
        const params = [];
        const conditions = [];
        if (status)     { params.push(status);     conditions.push(`cw.status = $${params.length}`); }
        if (channel_id) { params.push(channel_id); conditions.push(`u.channel_id = $${params.length}`); }
        const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
        const { rows } = await pool.query(
            `SELECT cw.*, u.nickname, u.avatar_url
             FROM credit_withdrawals cw
             JOIN users u ON u.user_id = cw.user_id
             ${where}
             ORDER BY cw.requested_at DESC
             LIMIT 200`,
            params
        );
        return { success: true, withdrawals: rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePutAdminWithdrawal(withdrawalId, body, adminCtx) {
    const { status, admin_note } = body;
    const allowed = ['approved', 'rejected', 'completed'];
    if (!allowed.includes(status)) return { success: false, error: `status must be one of: ${allowed.join(', ')}`, statusCode: 400 };
    try {
        const { rows } = await pool.query(
            `SELECT * FROM credit_withdrawals WHERE id = $1`, [withdrawalId]
        );
        const wd = rows[0];
        if (!wd) return { success: false, error: 'Withdrawal not found', statusCode: 404 };
        if (wd.status !== 'pending') return { success: false, error: `Cannot update a withdrawal with status: ${wd.status}`, statusCode: 400 };
        await pool.query(
            `UPDATE credit_withdrawals SET status=$1, admin_note=$2, processed_at=NOW(), processed_by=$3 WHERE id=$4`,
            [status, admin_note || null, adminCtx?.userId || null, withdrawalId]
        );
        // On approval: debit the user's credit ledger to lock the credits
        if (status === 'approved') {
            await debitUser(wd.user_id, parseFloat(wd.credits_amount), 'withdrawal',
                wd.id, 'credit_withdrawals', `Withdrawal approved: ${wd.currency_amount} ${wd.currency}`);
        }
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetAdminUserCreditHistory(userId, adminCtx) {
    if (!userId) return { success: false, error: 'userId is required', statusCode: 400 };
    try {
        const { rows: [u] } = await pool.query('SELECT channel_id FROM users WHERE user_id = $1', [userId]);
        if (!u) return { success: false, error: 'User not found', statusCode: 404 };
        if (adminCtx.role !== 'superadmin' && String(u.channel_id) !== String(adminCtx.channelId))
            return { success: false, error: 'Access denied', statusCode: 403 };
        const [balance, currency, historyRows] = await Promise.all([
            getUserBalance(userId),
            getChannelCurrency(u.channel_id),
            pool.query('SELECT * FROM credit_ledger WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100', [userId]),
        ]);
        return { success: true, balance, currency, history: historyRows.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostAdminUserCreditAdjustment(userId, body, adminCtx) {
    if (!userId) return { success: false, error: 'userId is required', statusCode: 400 };
    const amount = parseFloat(body?.amount);
    const note = (body?.note || '').trim();
    if (!amount || amount === 0) return { success: false, error: 'amount must be a non-zero number', statusCode: 400 };
    if (!note) return { success: false, error: 'note is required', statusCode: 400 };
    try {
        const { rows: [u] } = await pool.query('SELECT channel_id FROM users WHERE user_id = $1', [userId]);
        if (!u) return { success: false, error: 'User not found', statusCode: 404 };
        if (adminCtx.role !== 'superadmin' && String(u.channel_id) !== String(adminCtx.channelId))
            return { success: false, error: 'Access denied', statusCode: 403 };
        const annotatedNote = `[Admin: ${adminCtx.username || adminCtx.accountId || 'unknown'}] ${note}`;
        if (amount > 0) {
            await creditUser(userId, amount, 1.0, 'adjustment', null, null, annotatedNote);
        } else {
            await debitUser(userId, Math.abs(amount), 'adjustment', null, null, annotatedNote);
        }
        const balance = await getUserBalance(userId);
        return { success: true, balance };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = {
    handleGetCreditBalance,
    handleGetCreditHistory,
    handlePostCreditWithdraw,
    handleGetUserWithdrawals,
    handleGetAdminWithdrawals,
    handlePutAdminWithdrawal,
    handleGetAdminUserCreditHistory,
    handlePostAdminUserCreditAdjustment,
};
