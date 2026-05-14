const { pool } = require('./db');

const DEFAULT_CONFIG = {
    referral_rates: {
        light_entrepreneur: { light_entrepreneur: 0.25, leader_partner: 0.20, operations_center: 0.10 },
        leader_partner:     { light_entrepreneur: 0.40, leader_partner: 0.25, operations_center: 0.20 },
        operations_center:  { light_entrepreneur: 0.50, leader_partner: 0.30, operations_center: 0.25 },
    },
    product_discount_rates: { light_entrepreneur: 0.30, leader_partner: 0.40, operations_center: 0.50 },
    training_discount_rates: { light_entrepreneur: 0.10, leader_partner: 0.30, operations_center: 0.50 },
    team_primary_rate: 0.02,
    team_secondary_rate: 0.02,
};

async function getCommissionConfig() {
    if (!pool) return DEFAULT_CONFIG;
    try {
        const { rows } = await pool.query(
            `SELECT referral_rates, product_discount_rates, training_discount_rates,
                    team_primary_rate, team_secondary_rate
             FROM partner_commission_config WHERE id = 1`
        );
        if (rows[0]) return rows[0];
    } catch (err) {
        console.log(JSON.stringify({ level: 'WARN', msg: 'getCommissionConfig fallback to defaults', data: { error: err.message } }));
    }
    return DEFAULT_CONFIG;
}

// Keep named exports for backward compat (reflect current DB config at import time is not feasible in CJS;
// callers that need fresh config should use getCommissionConfig() directly)
const REFERRAL_RATES         = DEFAULT_CONFIG.referral_rates;
const PRODUCT_DISCOUNT_RATES = DEFAULT_CONFIG.product_discount_rates;
const TRAINING_DISCOUNT_RATES = DEFAULT_CONFIG.training_discount_rates;

async function recordReferralCommission(uplinePartner, newPartner) {
    if (!pool) return;
    const cfg = await getCommissionConfig();
    const rate = cfg.referral_rates?.[uplinePartner.tier]?.[newPartner.tier];
    if (!rate) return;
    const amount = Number((Number(newPartner.entry_fee_paid) * rate).toFixed(2));
    if (amount <= 0) return;
    try {
        await pool.query(`
            INSERT INTO partner_commissions
                (partner_id, source_type, source_partner_id, amount_cny, rate, base_amount, description)
            VALUES ($1, 'referral', $2, $3, $4, $5, $6)
        `, [
            uplinePartner.id,
            newPartner.id,
            amount,
            rate,
            newPartner.entry_fee_paid,
            `Referral: ${newPartner.real_name} (${newPartner.tier}) @ ${(rate * 100).toFixed(0)}%`,
        ]);
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'recordReferralCommission failed', data: { error: err.message } }));
    }
}

// Records selling partner's sales commission + 2% team income for up to 2 upline levels.
async function recordSalesCommission(sellingPartnerId, saleAmountCny, description) {
    if (!pool) return;
    try {
        const { rows } = await pool.query(`
            SELECT p.id, p.tier, p.referred_by_partner_id,
                   up.id AS upline_id, up.tier AS upline_tier,
                   up2.id AS upline2_id, up2.tier AS upline2_tier
            FROM partners p
            LEFT JOIN partners up  ON up.id  = p.referred_by_partner_id
            LEFT JOIN partners up2 ON up2.id = up.referred_by_partner_id
            WHERE p.id = $1 AND p.status = 'active'
        `, [sellingPartnerId]);

        const partner = rows[0];
        if (!partner) return;

        const cfg = await getCommissionConfig();
        const salesRate = cfg.product_discount_rates?.[partner.tier] || 0;
        if (salesRate > 0) {
            const salesAmount = Number((saleAmountCny * salesRate).toFixed(2));
            await pool.query(`
                INSERT INTO partner_commissions
                    (partner_id, source_type, source_partner_id, amount_cny, rate, base_amount, description)
                VALUES ($1, 'sales', NULL, $2, $3, $4, $5)
            `, [sellingPartnerId, salesAmount, salesRate, saleAmountCny, description || 'Product sale']);
        }

        const teamPrimaryRate = Number(cfg.team_primary_rate ?? 0.02);
        const teamSecondaryRate = Number(cfg.team_secondary_rate ?? 0.02);
        if (partner.upline_id) {
            const amount = Number((saleAmountCny * teamPrimaryRate).toFixed(2));
            await pool.query(`
                INSERT INTO partner_commissions
                    (partner_id, source_type, source_partner_id, amount_cny, rate, base_amount, description)
                VALUES ($1, 'team_primary', $2, $3, $4, $5, $6)
            `, [partner.upline_id, sellingPartnerId, amount, teamPrimaryRate, saleAmountCny,
                `Team income (primary) from partner #${sellingPartnerId}`]);
        }

        if (partner.upline2_id) {
            const amount = Number((saleAmountCny * teamSecondaryRate).toFixed(2));
            await pool.query(`
                INSERT INTO partner_commissions
                    (partner_id, source_type, source_partner_id, amount_cny, rate, base_amount, description)
                VALUES ($1, 'team_secondary', $2, $3, $4, $5, $6)
            `, [partner.upline2_id, sellingPartnerId, amount, teamSecondaryRate, saleAmountCny,
                `Team income (secondary) from partner #${sellingPartnerId}`]);
        }
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'recordSalesCommission failed', data: { error: err.message } }));
    }
}

async function generatePartnerPayouts(period, channelId) {
    if (!pool) return { generated: 0 };
    const conditions = [`to_char(pc.created_at,'YYYY-MM') = $1`, `pc.status = 'pending'`, `pc.payout_id IS NULL`];
    const params = [period];
    if (channelId) {
        params.push(channelId);
        conditions.push(`p.channel_id=$${params.length}`);
    }
    const { rows: groups } = await pool.query(`
        SELECT pc.partner_id, COALESCE(SUM(pc.amount_cny), 0) AS total,
               array_agg(pc.id) AS commission_ids
        FROM partner_commissions pc
        JOIN partners p ON p.id = pc.partner_id
        WHERE ${conditions.join(' AND ')}
        GROUP BY pc.partner_id
        HAVING SUM(pc.amount_cny) > 0
    `, params);

    let created = 0;
    for (const g of groups) {
        const res = await pool.query(`
            INSERT INTO partner_payouts (partner_id, period, total_cny, status)
            VALUES ($1, $2, $3, 'draft')
            ON CONFLICT (partner_id, period) DO UPDATE SET total_cny = EXCLUDED.total_cny
            RETURNING id
        `, [g.partner_id, period, g.total]);
        const payoutId = res.rows[0].id;
        await pool.query(
            `UPDATE partner_commissions SET payout_id = $1 WHERE id = ANY($2::uuid[])`,
            [payoutId, g.commission_ids]
        );
        created++;
    }
    return { generated: created };
}

module.exports = { REFERRAL_RATES, PRODUCT_DISCOUNT_RATES, TRAINING_DISCOUNT_RATES, getCommissionConfig, recordReferralCommission, recordSalesCommission, generatePartnerPayouts };
