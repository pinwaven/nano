const { pool } = require('./db');

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

        const coachRate   = await getRate('coach', productType, channelId);
        const coachAmount = calcAmount(coachRate, order.quantity, order.price_cny);
        if (coachAmount > 0) {
            await pool.query(`
                INSERT INTO coach_commissions
                    (coach_id, channel_id, user_id, order_id, product_type, item_key, quantity, amount_cny)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                ON CONFLICT (order_id) DO NOTHING
            `, [order.coach_user_id, channelId, order.user_id, orderId,
                productType, order.item_key, order.quantity, coachAmount]);
        }

        if (channelId) {
            const chRate   = await getRate('channel', productType, channelId);
            const chAmount = calcAmount(chRate, order.quantity, order.price_cny);
            if (chAmount > 0) {
                await pool.query(`
                    INSERT INTO channel_commissions
                        (channel_id, coach_id, user_id, order_id, product_type, item_key, quantity, amount_cny)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                    ON CONFLICT (order_id) DO NOTHING
                `, [channelId, order.coach_user_id, order.user_id, orderId,
                    productType, order.item_key, order.quantity, chAmount]);
            }
        }
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'recordOrderCommissions failed', data: { orderId, error: err.message } }));
    }
}

module.exports = { recordOrderCommissions };
