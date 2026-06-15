const { pool } = require('./db');

// When channelId is provided: return channel-specific rules if any exist for this
// event_type; otherwise fall back to global (channel_id IS NULL) rules.
async function getCommissionRules(eventType, channelId) {
    if (!pool) return [];
    try {
        if (channelId) {
            const { rows } = await pool.query(
                `SELECT * FROM partner_commission_rules WHERE event_type = $1 AND channel_id = $2 AND is_active = TRUE ORDER BY sort_order, id`,
                [eventType, channelId]
            );
            if (rows.length > 0) return rows;
        }
        const { rows } = await pool.query(
            `SELECT * FROM partner_commission_rules WHERE event_type = $1 AND channel_id IS NULL AND is_active = TRUE ORDER BY sort_order, id`,
            [eventType]
        );
        return rows;
    } catch (err) {
        console.log(JSON.stringify({ level: 'WARN', msg: 'getCommissionRules failed', data: { error: err.message } }));
        return [];
    }
}

// Most-specific match wins: (earner+subject) > (earner only) > (subject only) > wildcard
function resolveRate(rules, earnerType, subjectType) {
    const score = r => (r.earner_type ? 2 : 0) + (r.subject_type ? 1 : 0);
    const candidates = rules
        .filter(r =>
            (r.earner_type === null || r.earner_type === earnerType) &&
            (r.subject_type === null || r.subject_type === subjectType)
        )
        .sort((a, b) => score(b) - score(a));
    return candidates.length > 0 ? Number(candidates[0].rate) : null;
}

// Returns { tier, rate } for the user's active partner record (best rate), or null.
async function getPartnerProductDiscount(userId) {
    if (!pool || !userId) return null;
    try {
        const { rows } = await pool.query(
            `SELECT tier, channel_id FROM partners WHERE user_id = $1 AND status = 'active'`,
            [userId]
        );
        if (rows.length === 0) return null;
        const channelId = rows[0]?.channel_id;
        const rules = await getCommissionRules('product_discount', channelId);
        let best = null;
        for (const { tier } of rows) {
            const rate = resolveRate(rules, tier, null);
            if (rate && rate > 0 && rate < 1 && (!best || rate > best.rate)) best = { tier, rate };
        }
        return best;
    } catch (err) {
        console.log(JSON.stringify({ level: 'WARN', msg: 'getPartnerProductDiscount failed', data: { error: err.message } }));
        return null;
    }
}

function applyPartnerDiscount(price, rate) {
    if (price == null || !rate) return price;
    return Number((Number(price) * (1 - rate)).toFixed(2));
}

// Records referral commissions for all upline levels defined in commission rules.
// Uses a recursive CTE to walk up the referral chain N levels.
async function recordReferralCommission(newPartner) {
    if (!pool || !newPartner?.referred_by_partner_id) return;
    try {
        const channelId = newPartner.channel_id || null;
        const rules = await getCommissionRules('referral', channelId);
        if (rules.length === 0) return;

        const maxLevel = Math.max(...rules.map(r => r.upline_level ?? 1));

        const { rows: chain } = await pool.query(`
            WITH RECURSIVE upline_chain AS (
                SELECT id, tier, real_name, referred_by_partner_id, 1 AS level
                FROM partners WHERE id = $1 AND status = 'active'
                UNION ALL
                SELECT p.id, p.tier, p.real_name, p.referred_by_partner_id, uc.level + 1
                FROM partners p
                JOIN upline_chain uc ON p.id = uc.referred_by_partner_id
                WHERE uc.level < $2 AND p.status = 'active'
            )
            SELECT * FROM upline_chain
        `, [newPartner.referred_by_partner_id, maxLevel]);

        for (const upline of chain) {
            const levelRules = rules.filter(r => (r.upline_level ?? 1) === upline.level);
            const rate = resolveRate(levelRules, upline.tier, newPartner.tier);
            if (!rate) continue;
            const amount = Number((Number(newPartner.entry_fee_paid) * rate).toFixed(2));
            if (amount <= 0) continue;
            await pool.query(`
                INSERT INTO partner_commissions
                    (partner_id, source_type, source_partner_id, amount_cny, rate, base_amount, description, commission_level)
                VALUES ($1, 'referral', $2, $3, $4, $5, $6, $7)
            `, [
                upline.id,
                newPartner.id,
                amount,
                rate,
                newPartner.entry_fee_paid,
                `Referral L${upline.level}: ${newPartner.real_name} (${newPartner.tier}) @ ${(rate * 100).toFixed(0)}%`,
                upline.level,
            ]);
        }
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'recordReferralCommission failed', data: { error: err.message } }));
    }
}

// Records selling partner's sales margin + N-level team income defined in commission rules.
async function recordSalesCommission(sellingPartnerId, saleAmountCny, description) {
    if (!pool) return;
    try {
        const { rows: sellerMeta } = await pool.query(
            `SELECT channel_id FROM partners WHERE id = $1`, [sellingPartnerId]
        );
        const channelId = sellerMeta[0]?.channel_id || null;

        const [productRules, teamRules] = await Promise.all([
            getCommissionRules('product_discount', channelId),
            getCommissionRules('team_income', channelId),
        ]);

        const maxLevel = teamRules.length > 0
            ? Math.max(...teamRules.map(r => r.upline_level ?? 0))
            : 0;

        const { rows } = await pool.query(`
            WITH RECURSIVE chain AS (
                SELECT id, tier, referred_by_partner_id, 0 AS level
                FROM partners WHERE id = $1 AND status = 'active'
                UNION ALL
                SELECT p.id, p.tier, p.referred_by_partner_id, c.level + 1
                FROM partners p
                JOIN chain c ON p.id = c.referred_by_partner_id
                WHERE c.level < $2 AND p.status = 'active'
            )
            SELECT * FROM chain
        `, [sellingPartnerId, maxLevel]);

        const seller = rows.find(r => r.level === 0);
        if (!seller) return;

        // Seller's own product margin
        const salesRate = resolveRate(productRules, seller.tier, null);
        if (salesRate && salesRate > 0) {
            const salesAmount = Number((saleAmountCny * salesRate).toFixed(2));
            await pool.query(`
                INSERT INTO partner_commissions
                    (partner_id, source_type, source_partner_id, amount_cny, rate, base_amount, description, commission_level)
                VALUES ($1, 'sales', NULL, $2, $3, $4, $5, 0)
            `, [sellingPartnerId, salesAmount, salesRate, saleAmountCny, description || 'Product sale']);
        }

        // Upline team income for each defined level
        for (const ancestor of rows.filter(r => r.level > 0)) {
            const levelRules = teamRules.filter(r => r.upline_level === ancestor.level);
            const rate = resolveRate(levelRules, ancestor.tier, seller.tier);
            if (!rate) continue;
            const amount = Number((saleAmountCny * rate).toFixed(2));
            if (amount <= 0) continue;
            // Keep legacy source_types for L1/L2; use team_income for L3+
            const srcType = ancestor.level === 1 ? 'team_primary'
                          : ancestor.level === 2 ? 'team_secondary'
                          : 'team_income';
            await pool.query(`
                INSERT INTO partner_commissions
                    (partner_id, source_type, source_partner_id, amount_cny, rate, base_amount, description, commission_level)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            `, [
                ancestor.id, srcType, sellingPartnerId, amount, rate, saleAmountCny,
                `Team income L${ancestor.level} from partner #${sellingPartnerId}`,
                ancestor.level,
            ]);
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

module.exports = {
    getCommissionRules,
    resolveRate,
    getPartnerProductDiscount,
    applyPartnerDiscount,
    recordReferralCommission,
    recordSalesCommission,
    generatePartnerPayouts,
};
