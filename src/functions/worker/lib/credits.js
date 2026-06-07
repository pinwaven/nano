const { pool } = require('./db');

const CHANNEL_INHERITANCE_CTE = `
    WITH RECURSIVE chain AS (
        SELECT id, parent_channel_id, config, can_customize_rewards, 0 AS depth
        FROM channels WHERE id = $1
        UNION ALL
        SELECT c.id, c.parent_channel_id, c.config, c.can_customize_rewards, chain.depth + 1
        FROM channels c JOIN chain ON c.id = chain.parent_channel_id
        WHERE chain.depth < 10
    )
    SELECT * FROM chain ORDER BY depth ASC
`;

async function getChannelExchangeRate(channelId) {
    if (!channelId || !pool) return 1.0;
    try {
        const { rows } = await pool.query(CHANNEL_INHERITANCE_CTE, [channelId]);
        for (const row of rows) {
            const isRoot = row.parent_channel_id == null;
            const canUseOwn = isRoot || row.can_customize_rewards;
            const rate = row.config?.credit_exchange_rate;
            if (canUseOwn && rate != null) return parseFloat(rate);
            if (isRoot) break;
        }
        return 1.0;
    } catch {
        return 1.0;
    }
}

async function getChannelCurrency(channelId) {
    if (!channelId || !pool) return 'CNY';
    try {
        const { rows } = await pool.query(CHANNEL_INHERITANCE_CTE, [channelId]);
        for (const row of rows) {
            const isRoot = row.parent_channel_id == null;
            const canUseOwn = isRoot || row.can_customize_rewards;
            const currency = row.config?.currency;
            if (canUseOwn && currency) return currency;
            if (isRoot) break;
        }
        return 'CNY';
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
