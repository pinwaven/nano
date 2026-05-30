const { pool } = require('./db');
const { getChannelExchangeRate, creditUser } = require('./credits');

function getProductType(itemKey) {
    if (itemKey && itemKey.startsWith('kino-chip')) return 'chip';
    if (itemKey && itemKey.startsWith('dots-')) return 'dot';
    return 'subscription';
}

async function getRate(role, productType, channelId) {
    if (channelId) {
        const { rows } = await pool.query(
            'SELECT commission_config FROM channels WHERE id = $1',
            [channelId]
        );
        const cfg = rows[0]?.commission_config;
        if (cfg) {
            const flatKey = `${role}_${productType}_flat`;
            const pctKey  = `${role}_${productType}_pct`;
            if (cfg[flatKey] != null) return { flat_rate_cny: Number(cfg[flatKey]), percentage: null };
            if (cfg[pctKey]  != null) return { flat_rate_cny: null, percentage: Number(cfg[pctKey]) };
        }
    }
    const { rows } = await pool.query(
        'SELECT flat_rate_cny, percentage FROM commission_settings WHERE role=$1 AND product_type=$2',
        [role, productType]
    );
    return rows[0] || { flat_rate_cny: 0, percentage: null };
}

function calcAmount(rate, quantity, priceCny) {
    if (rate.flat_rate_cny != null) return Number((rate.flat_rate_cny * quantity).toFixed(2));
    if (rate.percentage    != null) return Number((priceCny * rate.percentage / 100).toFixed(2));
    return 0;
}

async function recordOrderCommissions(orderId) {
    if (!pool) return;
    try {
        const { rows } = await pool.query(`
            SELECT o.id, o.user_id, o.item_key, o.quantity, o.price_cny,
                   inv.created_by AS coach_user_id,
                   inv.channel_id
            FROM orders o
            JOIN users u ON u.user_id = o.user_id
            LEFT JOIN invitations inv ON inv.id = u.invited_by_invitation_id
            WHERE o.id = $1
        `, [orderId]);

        const order = rows[0];
        if (!order || !order.coach_user_id) return;

        const productType = getProductType(order.item_key);
        const channelId   = order.channel_id;

        const exchangeRate = await getChannelExchangeRate(channelId);

        const coachRate   = await getRate('coach', productType, channelId);
        const coachAmount = calcAmount(coachRate, order.quantity, order.price_cny);
        if (coachAmount > 0) {
            const coachRes = await pool.query(`
                INSERT INTO coach_commissions
                    (coach_id, channel_id, user_id, order_id, product_type, item_key, quantity, amount_cny)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                ON CONFLICT (order_id) DO NOTHING
                RETURNING id
            `, [order.coach_user_id, channelId, order.user_id, orderId,
                productType, order.item_key, order.quantity, coachAmount]);
            if (coachRes.rows[0]?.id) {
                await creditUser(order.coach_user_id, coachAmount, exchangeRate,
                    'coach_commission', coachRes.rows[0].id, 'coach_commissions');
            }
        }

        if (channelId) {
            const chRate   = await getRate('channel', productType, channelId);
            const chAmount = calcAmount(chRate, order.quantity, order.price_cny);
            if (chAmount > 0) {
                const chRes = await pool.query(`
                    INSERT INTO channel_commissions
                        (channel_id, coach_id, user_id, order_id, product_type, item_key, quantity, amount_cny)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                    ON CONFLICT (order_id) DO NOTHING
                    RETURNING id
                `, [channelId, order.coach_user_id, order.user_id, orderId,
                    productType, order.item_key, order.quantity, chAmount]);
                if (chRes.rows[0]?.id) {
                    // Credit the channel's admin user — look up via channel config
                    const chAdminRes = await pool.query(
                        `SELECT config->>'admin_user_id' AS admin_user_id FROM channels WHERE id = $1`, [channelId]);
                    const adminUserId = chAdminRes.rows[0]?.admin_user_id;
                    if (adminUserId) {
                        await creditUser(adminUserId, chAmount, exchangeRate,
                            'channel_commission', chRes.rows[0].id, 'channel_commissions');
                    }
                }
            }
        }
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'recordOrderCommissions failed', data: { orderId, error: err.message } }));
    }
}

async function recordUserReferralCommission(orderId) {
    if (!pool) return;
    try {
        const { rows } = await pool.query(`
            SELECT o.id, o.user_id, o.item_key, o.quantity, o.price_cny,
                   u.referred_by_user_id AS referrer_user_id,
                   u.channel_id
            FROM orders o
            JOIN users u ON u.user_id = o.user_id
            WHERE o.id = $1
        `, [orderId]);

        const order = rows[0];
        if (!order || !order.referrer_user_id) return;

        const productType = getProductType(order.item_key);

        let rate = 5; // default 5%
        if (order.channel_id) {
            const chanRes = await pool.query('SELECT config FROM channels WHERE id = $1', [order.channel_id]);
            const cfg = chanRes.rows[0]?.config;
            if (cfg?.referral_commission_rate != null) rate = Number(cfg.referral_commission_rate);
        }

        const amount = Number((order.price_cny * rate / 100).toFixed(2));
        if (amount <= 0) return;

        const exchangeRate = await getChannelExchangeRate(order.channel_id);

        const refRes = await pool.query(`
            INSERT INTO referral_commissions
                (referrer_user_id, referee_user_id, order_id, product_type, item_key, quantity, amount_cny)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (order_id, referrer_user_id) DO NOTHING
            RETURNING id
        `, [order.referrer_user_id, order.user_id, orderId,
            productType, order.item_key, order.quantity, amount]);
        if (refRes.rows[0]?.id) {
            await creditUser(order.referrer_user_id, amount, exchangeRate,
                'referral_commission', refRes.rows[0].id, 'referral_commissions');
        }
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'recordUserReferralCommission failed', data: { orderId, error: err.message } }));
    }
}

module.exports = { recordOrderCommissions, recordUserReferralCommission };
