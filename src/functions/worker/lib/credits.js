const { pool } = require('./db');

async function getChannelExchangeRate(channelId) {
    if (!channelId || !pool) return 1.0;
    try {
        const { rows } = await pool.query('SELECT config FROM channels WHERE id = $1', [channelId]);
        const rate = rows[0]?.config?.credit_exchange_rate;
        return rate != null ? parseFloat(rate) : 1.0;
    } catch {
        return 1.0;
    }
}

async function getChannelCurrency(channelId) {
    if (!channelId || !pool) return 'CNY';
    try {
        const { rows } = await pool.query('SELECT config FROM channels WHERE id = $1', [channelId]);
        return rows[0]?.config?.currency || 'CNY';
    } catch {
        return 'CNY';
    }
}

async function creditUser(userId, cnyAmount, exchangeRate, type, referenceId, referenceType, note) {
    if (!pool || !userId || cnyAmount <= 0) return;
    const credits = parseFloat((cnyAmount * exchangeRate).toFixed(2));
    await pool.query(
        `INSERT INTO credit_ledger (user_id, amount, type, reference_id, reference_type, note)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, credits, type, referenceId || null, referenceType || null, note || null]
    );
}

async function debitUser(userId, credits, type, referenceId, referenceType, note) {
    if (!pool || !userId || credits <= 0) return;
    await pool.query(
        `INSERT INTO credit_ledger (user_id, amount, type, reference_id, reference_type, note)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, -credits, type, referenceId || null, referenceType || null, note || null]
    );
}

async function getUserBalance(userId) {
    if (!pool || !userId) return 0;
    const { rows } = await pool.query(
        `SELECT COALESCE(SUM(amount), 0)::NUMERIC(12,2) AS balance FROM credit_ledger WHERE user_id = $1`,
        [userId]
    );
    return parseFloat(rows[0]?.balance || 0);
}

async function getLedgerHistory(userId, limit = 50, offset = 0) {
    if (!pool || !userId) return [];
    const { rows } = await pool.query(
        `SELECT * FROM credit_ledger WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
    );
    return rows;
}

module.exports = { getChannelExchangeRate, getChannelCurrency, creditUser, debitUser, getUserBalance, getLedgerHistory };
