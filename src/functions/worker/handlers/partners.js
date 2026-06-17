const { pool } = require('../lib/db');
const { requirePermission, verifySubchannelOwnership } = require('../lib/auth');
const { recordReferralCommission, generatePartnerPayouts, getCommissionRules, resolveRate } = require('../lib/partnerCommissions');

// ── Partner system handlers ──────────────────────────────────────────────────

async function handleGetPartners(query, adminCtx) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const conditions = [];
        const params = [];
        const channelId = adminCtx?.channelId || query.channel_id;
        if (channelId) { params.push(channelId); conditions.push(`p.channel_id=$${params.length}`); }
        if (query.status) { params.push(query.status); conditions.push(`p.status=$${params.length}`); }
        if (query.tier)   { params.push(query.tier);   conditions.push(`p.tier=$${params.length}`); }
        const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
        const { rows } = await pool.query(`
            SELECT p.*,
                   ch.name AS channel_name,
                   up.real_name AS upline_name, up.tier AS upline_tier,
                   COALESCE(comm.total_commissions, 0) AS total_commissions_cny
            FROM partners p
            LEFT JOIN channels ch ON ch.id = p.channel_id
            LEFT JOIN partners up ON up.id = p.referred_by_partner_id
            LEFT JOIN (
                SELECT partner_id, SUM(amount_cny) AS total_commissions
                FROM partner_commissions
                GROUP BY partner_id
            ) comm ON comm.partner_id = p.id
            ${where}
            ORDER BY p.created_at DESC
            LIMIT 1000
        `, params);
        return { success: true, partners: rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetPartner(partnerId) {
    if (!partnerId) return { success: false, error: 'partner id required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const [partnerRes, commRes, payoutRes] = await Promise.all([
            pool.query(`
                SELECT p.*, ch.name AS channel_name,
                       up.real_name AS upline_name, up.tier AS upline_tier
                FROM partners p
                LEFT JOIN channels ch ON ch.id = p.channel_id
                LEFT JOIN partners up ON up.id = p.referred_by_partner_id
                WHERE p.id = $1
            `, [partnerId]),
            pool.query(`
                SELECT pc.*, sp.real_name AS source_partner_name
                FROM partner_commissions pc
                LEFT JOIN partners sp ON sp.id = pc.source_partner_id
                WHERE pc.partner_id = $1
                ORDER BY pc.created_at DESC LIMIT 100
            `, [partnerId]),
            pool.query(
                `SELECT * FROM partner_payouts WHERE partner_id=$1 ORDER BY period DESC LIMIT 24`,
                [partnerId]
            ),
        ]);
        if (!partnerRes.rows[0]) return { success: false, error: 'Partner not found', statusCode: 404 };
        return { success: true, partner: partnerRes.rows[0], commissions: commRes.rows, payouts: payoutRes.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostPartner(body) {
    const { tier, real_name, phone, entry_fee_paid, channel_id, user_id, referred_by_partner_id, contracted_at, notes, status } = body;
    if (!tier || !real_name || !phone || !entry_fee_paid) {
        return { success: false, error: 'tier, real_name, phone, entry_fee_paid are required', statusCode: 400 };
    }
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const typeCheck = await pool.query(`SELECT key FROM partner_types WHERE key=$1 AND is_active=TRUE`, [tier]);
        if (typeCheck.rows.length === 0) return { success: false, error: `Invalid partner tier: ${tier}`, statusCode: 400 };

        const { rows } = await pool.query(`
            INSERT INTO partners (tier, real_name, phone, entry_fee_paid, channel_id, user_id,
                                  referred_by_partner_id, contracted_at, notes, status)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
            RETURNING *
        `, [tier, real_name, phone, entry_fee_paid, channel_id || null, user_id || null,
            referred_by_partner_id || null, contracted_at || null, notes || null, status || 'active']);
        const newPartner = rows[0];

        if (referred_by_partner_id) {
            await recordReferralCommission(newPartner);
        }

        return { success: true, partner: newPartner };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePutPartner(partnerId, body) {
    if (!partnerId) return { success: false, error: 'partner id required', statusCode: 400 };
    const { tier, real_name, phone, entry_fee_paid, channel_id, user_id,
            referred_by_partner_id, contracted_at, notes, status } = body;
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        if (tier) {
            const typeCheck = await pool.query(`SELECT key FROM partner_types WHERE key=$1 AND is_active=TRUE`, [tier]);
            if (typeCheck.rows.length === 0) return { success: false, error: `Invalid partner tier: ${tier}`, statusCode: 400 };
        }
        await pool.query(`
            UPDATE partners SET
                tier=$1, real_name=$2, phone=$3, entry_fee_paid=$4,
                channel_id=$5, user_id=$6, referred_by_partner_id=$7,
                contracted_at=$8, notes=$9, status=$10, updated_at=NOW()
            WHERE id=$11
        `, [tier, real_name, phone, entry_fee_paid, channel_id || null, user_id || null,
            referred_by_partner_id || null, contracted_at || null, notes || null,
            status || 'active', partnerId]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleDeletePartner(partnerId) {
    if (!partnerId) return { success: false, error: 'partner id required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        await pool.query(`UPDATE partners SET status='inactive', updated_at=NOW() WHERE id=$1`, [partnerId]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetPartnerCommissions(query) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const conditions = [];
        const params = [];
        if (query.partner_id)   { params.push(query.partner_id);   conditions.push(`pc.partner_id=$${params.length}`); }
        if (query.source_type)  { params.push(query.source_type);  conditions.push(`pc.source_type=$${params.length}`); }
        if (query.status)       { params.push(query.status);       conditions.push(`pc.status=$${params.length}`); }
        if (query.from)         { params.push(query.from);         conditions.push(`pc.created_at>=$${params.length}`); }
        if (query.to)           { params.push(query.to);           conditions.push(`pc.created_at<=$${params.length}`); }
        const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
        const { rows } = await pool.query(`
            SELECT pc.*, p.real_name AS partner_name, p.tier AS partner_tier,
                   sp.real_name AS source_partner_name
            FROM partner_commissions pc
            JOIN partners p ON p.id = pc.partner_id
            LEFT JOIN partners sp ON sp.id = pc.source_partner_id
            ${where}
            ORDER BY pc.created_at DESC
            LIMIT 500
        `, params);
        return { success: true, commissions: rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostPartnerCommission(body) {
    const { partner_id, source_type, source_partner_id, amount_cny, rate, base_amount, description } = body;
    if (!partner_id || !source_type || !amount_cny) {
        return { success: false, error: 'partner_id, source_type, amount_cny are required', statusCode: 400 };
    }
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const { rows } = await pool.query(`
            INSERT INTO partner_commissions
                (partner_id, source_type, source_partner_id, amount_cny, rate, base_amount, description)
            VALUES ($1,$2,$3,$4,$5,$6,$7)
            RETURNING *
        `, [partner_id, source_type, source_partner_id || null, amount_cny,
            rate || null, base_amount || null, description || null]);
        return { success: true, commission: rows[0] };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetPartnerPayouts(query) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const conditions = [];
        const params = [];
        if (query.partner_id) { params.push(query.partner_id); conditions.push(`pp.partner_id=$${params.length}`); }
        if (query.status)     { params.push(query.status);     conditions.push(`pp.status=$${params.length}`); }
        if (query.channel_id) { params.push(query.channel_id); conditions.push(`p.channel_id=$${params.length}`); }
        const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
        const { rows } = await pool.query(`
            SELECT pp.*, p.real_name AS partner_name, p.tier AS partner_tier,
                   ch.name AS channel_name
            FROM partner_payouts pp
            JOIN partners p ON p.id = pp.partner_id
            LEFT JOIN channels ch ON ch.id = p.channel_id
            ${where}
            ORDER BY pp.period DESC, pp.created_at DESC
        `, params);
        return { success: true, payouts: rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostGeneratePartnerPayouts(body) {
    const { period, channel_id } = body;
    if (!period) return { success: false, error: 'period required (YYYY-MM)', statusCode: 400 };
    try {
        const result = await generatePartnerPayouts(period, channel_id || null);
        return { success: true, ...result };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePutPartnerPayout(payoutId, body) {
    const { status, notes } = body;
    if (!status) return { success: false, error: 'status required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const now = new Date().toISOString();
        await pool.query(`
            UPDATE partner_payouts SET
                status=$1,
                approved_at=CASE WHEN $1='approved' THEN $2 ELSE approved_at END,
                transferred_at=CASE WHEN $1='transferred' THEN $2 ELSE transferred_at END,
                notes=COALESCE($3, notes)
            WHERE id=$4
        `, [status, now, notes || null, payoutId]);
        if (status === 'approved' || status === 'transferred') {
            await pool.query(
                `UPDATE partner_commissions SET status=$1 WHERE payout_id=$2`,
                [status, payoutId]
            );
        }
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetPartnerTree(partnerId) {
    if (!partnerId) return { success: false, error: 'partner id required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const { rows: root } = await pool.query(
            `SELECT id, real_name, tier, status FROM partners WHERE id=$1`, [partnerId]
        );
        if (!root[0]) return { success: false, error: 'Partner not found', statusCode: 404 };

        const { rows: children } = await pool.query(
            `SELECT id, real_name, tier, status FROM partners WHERE referred_by_partner_id=$1`, [partnerId]
        );
        const childIds = children.map(c => c.id);
        let grandchildren = [];
        if (childIds.length > 0) {
            const { rows } = await pool.query(
                `SELECT id, real_name, tier, status, referred_by_partner_id
                 FROM partners WHERE referred_by_partner_id = ANY($1::int[])`,
                [childIds]
            );
            grandchildren = rows;
        }

        const tree = children.map(child => ({
            ...child,
            children: grandchildren.filter(gc => gc.referred_by_partner_id === child.id),
        }));

        return { success: true, partner: root[0], tree };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetChannelReferralNetwork(channelId) {
    if (!channelId) return { success: false, error: 'channel_id is required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const { rows } = await pool.query(
            `WITH RECURSIVE subtree AS (
                SELECT id FROM channels WHERE id = $1
                UNION ALL
                SELECT c.id FROM channels c JOIN subtree s ON c.parent_channel_id = s.id
            )
            SELECT u.user_id, u.nickname, u.avatar_url, u.referral_code,
                    u.referred_by_user_id,
                    inv.created_by        AS invited_by_user_id,
                    inv_u.nickname        AS inviter_nickname,
                    inv_u.avatar_url      AS inviter_avatar_url,
                    co.user_id            AS coach_user_id,
                    co_u.nickname         AS coach_nickname,
                    co_u.avatar_url       AS coach_avatar_url
             FROM users u
             LEFT JOIN invitations inv  ON inv.id  = u.invited_by_invitation_id
             LEFT JOIN users inv_u      ON inv_u.user_id = inv.created_by
             LEFT JOIN coaches co       ON co.id   = u.coach_id
             LEFT JOIN users co_u       ON co_u.user_id = co.user_id
             WHERE u.channel_id IN (SELECT id FROM subtree)`,
            [channelId]
        );
        const channelUserIds = new Set(rows.map(r => r.user_id));
        const nodesMap = new Map();
        for (const r of rows) {
            nodesMap.set(r.user_id, {
                id: r.user_id,
                nickname: r.nickname || null,
                avatar_url: r.avatar_url || null,
                referral_code: r.referral_code || null,
                _isExternal: false,
            });
        }

        const addExternalNode = (userId, nickname, avatarUrl) => {
            if (!nodesMap.has(userId)) {
                nodesMap.set(userId, {
                    id: userId,
                    nickname: nickname || null,
                    avatar_url: avatarUrl || null,
                    referral_code: null,
                    _isExternal: true,
                });
            }
        };

        const linkKey = (src, tgt, type) => `${src}→${tgt}:${type}`;
        const linksSeen = new Set();
        const links = [];
        const addLink = (src, tgt, type) => {
            const k = linkKey(src, tgt, type);
            if (!linksSeen.has(k)) { linksSeen.add(k); links.push({ source: src, target: tgt, type }); }
        };

        for (const r of rows) {
            if (r.referred_by_user_id && channelUserIds.has(r.referred_by_user_id)) {
                addLink(r.referred_by_user_id, r.user_id, 'referral');
            }
            if (r.invited_by_user_id && r.invited_by_user_id !== r.referred_by_user_id) {
                addExternalNode(r.invited_by_user_id, r.inviter_nickname, r.inviter_avatar_url);
                addLink(r.invited_by_user_id, r.user_id, 'invitation');
            }
            if (r.coach_user_id && r.coach_user_id !== r.invited_by_user_id && r.coach_user_id !== r.referred_by_user_id) {
                addExternalNode(r.coach_user_id, r.coach_nickname, r.coach_avatar_url);
                addLink(r.coach_user_id, r.user_id, 'coach');
            }
        }
        return { success: true, nodes: [...nodesMap.values()], links };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ── Shim: synthesise old JSON format from partner_commission_rules ────────────
async function handleGetPartnerCommissionConfig() {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const { rows } = await pool.query(
            `SELECT * FROM partner_commission_rules WHERE is_active = TRUE ORDER BY sort_order, id`
        );
        const referral_rates = {};
        const product_discount_rates = {};
        const training_discount_rates = {};
        let team_primary_rate = 0.02;
        let team_secondary_rate = 0.02;
        for (const rule of rows) {
            if (rule.event_type === 'referral' && rule.earner_type && rule.subject_type) {
                if (!referral_rates[rule.earner_type]) referral_rates[rule.earner_type] = {};
                referral_rates[rule.earner_type][rule.subject_type] = Number(rule.rate);
            } else if (rule.event_type === 'product_discount' && rule.earner_type) {
                product_discount_rates[rule.earner_type] = Number(rule.rate);
            } else if (rule.event_type === 'training_discount' && rule.earner_type) {
                training_discount_rates[rule.earner_type] = Number(rule.rate);
            } else if (rule.event_type === 'team_income') {
                if (rule.upline_level === 1) team_primary_rate = Number(rule.rate);
                if (rule.upline_level === 2) team_secondary_rate = Number(rule.rate);
            }
        }
        return { success: true, config: { referral_rates, product_discount_rates, training_discount_rates, team_primary_rate, team_secondary_rate } };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ── Shim: translate old JSON format into upserts on partner_commission_rules ──
async function handlePutPartnerCommissionConfig(body) {
    const { referral_rates, product_discount_rates, training_discount_rates, team_primary_rate, team_secondary_rate } = body;
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const toUpsert = [];
        let order = 0;
        if (referral_rates) {
            for (const [earner, subjects] of Object.entries(referral_rates)) {
                for (const [subject, rate] of Object.entries(subjects)) {
                    toUpsert.push({ event_type: 'referral', upline_level: 1, earner_type: earner, subject_type: subject, rate: Number(rate), description: `Referral: ${earner} → ${subject}`, sort_order: order++ });
                }
            }
        }
        if (product_discount_rates) {
            for (const [tier, rate] of Object.entries(product_discount_rates)) {
                toUpsert.push({ event_type: 'product_discount', upline_level: null, earner_type: tier, subject_type: null, rate: Number(rate), description: `Product discount: ${tier}`, sort_order: order++ });
            }
        }
        if (training_discount_rates) {
            for (const [tier, rate] of Object.entries(training_discount_rates)) {
                toUpsert.push({ event_type: 'training_discount', upline_level: null, earner_type: tier, subject_type: null, rate: Number(rate), description: `Training discount: ${tier}`, sort_order: order++ });
            }
        }
        if (team_primary_rate != null) toUpsert.push({ event_type: 'team_income', upline_level: 1, earner_type: null, subject_type: null, rate: Number(team_primary_rate), description: 'Team income level 1', sort_order: order++ });
        if (team_secondary_rate != null) toUpsert.push({ event_type: 'team_income', upline_level: 2, earner_type: null, subject_type: null, rate: Number(team_secondary_rate), description: 'Team income level 2', sort_order: order++ });

        for (const rule of toUpsert) {
            await pool.query(
                `DELETE FROM partner_commission_rules WHERE event_type=$1 AND (upline_level IS NOT DISTINCT FROM $2) AND (earner_type IS NOT DISTINCT FROM $3) AND (subject_type IS NOT DISTINCT FROM $4)`,
                [rule.event_type, rule.upline_level, rule.earner_type, rule.subject_type]
            );
            await pool.query(
                `INSERT INTO partner_commission_rules (event_type, upline_level, earner_type, subject_type, rate, description, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
                [rule.event_type, rule.upline_level, rule.earner_type, rule.subject_type, rule.rate, rule.description, rule.sort_order]
            );
        }
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ── Partner Types CRUD ────────────────────────────────────────────────────────
// GET /api/partner-types
// - No channel_id param → effective types for caller:
//     superadmin gets all global types; channel admin gets their channel's types
//     if they have can_customize_partner_system AND have created some, else global.
// - ?channel_id=X → returns ONLY channel-specific types stored for channel X
//     (used by channel config modal for CRUD).
async function handleGetPartnerTypes(query, adminCtx) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const requestedChannelId = query?.channel_id ? parseInt(query.channel_id) : null;

        if (adminCtx?.role === 'channel') {
            const myChannelId = adminCtx.channelId;
            if (requestedChannelId) {
                // Scope check: must be own channel or owned subchannel
                if (requestedChannelId !== myChannelId) {
                    const owns = await verifySubchannelOwnership(requestedChannelId, adminCtx);
                    if (!owns) return { statusCode: 403, success: false, error: 'Forbidden' };
                }
                const { rows } = await pool.query(
                    `SELECT * FROM partner_types WHERE channel_id = $1 ORDER BY sort_order, id`,
                    [requestedChannelId]
                );
                return { success: true, types: rows };
            }
            // No explicit channel_id: return effective types for dropdowns
            const { rows: permRows } = await pool.query(
                `SELECT can_customize_partner_system FROM channels WHERE id = $1`, [myChannelId]
            );
            if (permRows[0]?.can_customize_partner_system) {
                const { rows: channelTypes } = await pool.query(
                    `SELECT * FROM partner_types WHERE channel_id = $1 AND is_active = TRUE ORDER BY sort_order, id`,
                    [myChannelId]
                );
                if (channelTypes.length > 0) return { success: true, types: channelTypes };
            }
            // Fall through: return global types
            const { rows } = await pool.query(
                `SELECT * FROM partner_types WHERE channel_id IS NULL ORDER BY sort_order, id`
            );
            return { success: true, types: rows };
        }

        // Superadmin
        if (requestedChannelId) {
            const { rows } = await pool.query(
                `SELECT * FROM partner_types WHERE channel_id = $1 ORDER BY sort_order, id`,
                [requestedChannelId]
            );
            return { success: true, types: rows };
        }
        const { rows } = await pool.query(
            `SELECT * FROM partner_types ORDER BY COALESCE(channel_id, 0), sort_order, id`
        );
        return { success: true, types: rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostPartnerType(body, adminCtx) {
    const { key, label, label_zh, color, entry_fee, sort_order, description, channel_id: bodyChannelId } = body;
    if (!key || !label) return { success: false, error: 'key and label are required', statusCode: 400 };
    if (!/^[a-z][a-z0-9_]*$/.test(key)) return { success: false, error: 'key must be snake_case (lowercase letters, digits, underscores)', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        let channelId = null;
        if (adminCtx?.role === 'channel') {
            const { rows: permRows } = await pool.query(
                `SELECT can_customize_partner_system FROM channels WHERE id = $1`, [adminCtx.channelId]
            );
            if (!permRows[0]?.can_customize_partner_system)
                return { statusCode: 403, success: false, error: 'Channel does not have partner system customization permission' };
            channelId = adminCtx.channelId;
        } else {
            channelId = bodyChannelId ? parseInt(bodyChannelId) : null;
        }
        const { rows } = await pool.query(
            `INSERT INTO partner_types (key, label, label_zh, color, entry_fee, sort_order, description, channel_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [key, label, label_zh || null, color || '#64748b', entry_fee || 0, sort_order || 0, description || null, channelId]
        );
        return { success: true, type: rows[0] };
    } catch (err) {
        if (err.code === '23505') return { success: false, error: `Partner type key '${key}' already exists in this channel`, statusCode: 409 };
        return { success: false, error: err.message };
    }
}

async function handlePutPartnerType(typeKey, body, adminCtx) {
    if (!typeKey) return { success: false, error: 'type key required', statusCode: 400 };
    const { label, label_zh, color, entry_fee, sort_order, description, is_active } = body;
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        let channelFilter, params;
        if (adminCtx?.role === 'channel') {
            const { rows: permRows } = await pool.query(
                `SELECT can_customize_partner_system FROM channels WHERE id = $1`, [adminCtx.channelId]
            );
            if (!permRows[0]?.can_customize_partner_system)
                return { statusCode: 403, success: false, error: 'Forbidden' };
            channelFilter = 'channel_id = $9';
            params = [label, label_zh, color, entry_fee, sort_order, description, is_active, typeKey, adminCtx.channelId];
        } else {
            // Superadmin: can pass channel_id in body to edit channel-specific types, else global
            const targetChannelId = body.channel_id ? parseInt(body.channel_id) : null;
            channelFilter = targetChannelId ? `channel_id = $9` : `channel_id IS NULL`;
            params = targetChannelId
                ? [label, label_zh, color, entry_fee, sort_order, description, is_active, typeKey, targetChannelId]
                : [label, label_zh, color, entry_fee, sort_order, description, is_active, typeKey];
        }
        const { rows } = await pool.query(
            `UPDATE partner_types SET
                label=COALESCE($1,label), label_zh=COALESCE($2,label_zh), color=COALESCE($3,color),
                entry_fee=COALESCE($4,entry_fee), sort_order=COALESCE($5,sort_order),
                description=COALESCE($6,description), is_active=COALESCE($7,is_active), updated_at=NOW()
             WHERE key=$8 AND ${channelFilter} RETURNING *`,
            params
        );
        if (rows.length === 0) return { success: false, error: 'Partner type not found', statusCode: 404 };
        return { success: true, type: rows[0] };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleDeletePartnerType(typeKey, adminCtx) {
    if (!typeKey) return { success: false, error: 'type key required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        let channelFilter, params;
        if (adminCtx?.role === 'channel') {
            const { rows: permRows } = await pool.query(
                `SELECT can_customize_partner_system FROM channels WHERE id = $1`, [adminCtx.channelId]
            );
            if (!permRows[0]?.can_customize_partner_system)
                return { statusCode: 403, success: false, error: 'Forbidden' };
            channelFilter = 'channel_id = $2';
            params = [typeKey, adminCtx.channelId];
        } else {
            const targetChannelId = null; // superadmin delete always targets global types by key
            channelFilter = 'channel_id IS NULL';
            params = [typeKey];
        }
        const { rows: active } = await pool.query(
            `SELECT COUNT(*) AS cnt FROM partners WHERE tier=$1 AND status='active'`, [typeKey]
        );
        if (Number(active[0].cnt) > 0) {
            return { success: false, error: `Cannot deactivate: ${active[0].cnt} active partner(s) use this type`, statusCode: 409 };
        }
        await pool.query(
            `UPDATE partner_types SET is_active=FALSE, updated_at=NOW() WHERE key=$1 AND ${channelFilter}`,
            params
        );
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ── Partner Commission Rules CRUD ─────────────────────────────────────────────
// GET /api/partner-commission-rules
// - No channel_id → all global rules (superadmin) or channel admin's channel rules
// - ?channel_id=X → rules scoped to channel X
async function handleGetPartnerCommissionRules(query, adminCtx) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const requestedChannelId = query?.channel_id ? parseInt(query.channel_id) : null;

        if (adminCtx?.role === 'channel') {
            const myChannelId = adminCtx.channelId;
            const targetId = requestedChannelId || myChannelId;
            if (targetId !== myChannelId) {
                const owns = await verifySubchannelOwnership(targetId, adminCtx);
                if (!owns) return { statusCode: 403, success: false, error: 'Forbidden' };
            }
            const { rows } = await pool.query(
                `SELECT * FROM partner_commission_rules WHERE channel_id = $1 ORDER BY event_type, sort_order, id`,
                [targetId]
            );
            return { success: true, rules: rows };
        }

        // Superadmin
        if (requestedChannelId) {
            const { rows } = await pool.query(
                `SELECT * FROM partner_commission_rules WHERE channel_id = $1 ORDER BY event_type, sort_order, id`,
                [requestedChannelId]
            );
            return { success: true, rules: rows };
        }
        const { rows } = await pool.query(
            `SELECT * FROM partner_commission_rules WHERE channel_id IS NULL ORDER BY event_type, sort_order, id`
        );
        return { success: true, rules: rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostPartnerCommissionRule(body, adminCtx) {
    const { event_type, upline_level, earner_type, subject_type, rate, description, sort_order, channel_id: bodyChannelId } = body;
    if (!event_type || rate == null) return { success: false, error: 'event_type and rate are required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        let channelId = null;
        if (adminCtx?.role === 'channel') {
            const { rows: permRows } = await pool.query(
                `SELECT can_customize_partner_system FROM channels WHERE id = $1`, [adminCtx.channelId]
            );
            if (!permRows[0]?.can_customize_partner_system)
                return { statusCode: 403, success: false, error: 'Channel does not have partner system customization permission' };
            channelId = adminCtx.channelId;
        } else {
            channelId = bodyChannelId ? parseInt(bodyChannelId) : null;
        }
        const { rows } = await pool.query(
            `INSERT INTO partner_commission_rules (event_type, upline_level, earner_type, subject_type, rate, description, sort_order, channel_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [event_type, upline_level ?? null, earner_type || null, subject_type || null, rate, description || null, sort_order || 0, channelId]
        );
        return { success: true, rule: rows[0] };
    } catch (err) {
        if (err.code === '23505') return { success: false, error: 'A rule with this exact combination already exists in this channel', statusCode: 409 };
        return { success: false, error: err.message };
    }
}

async function handlePutPartnerCommissionRule(ruleId, body, adminCtx) {
    if (!ruleId) return { success: false, error: 'rule id required', statusCode: 400 };
    const { rate, description, is_active, sort_order } = body;
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        let channelFilter = '';
        let params = [rate, description, is_active, sort_order, ruleId];
        if (adminCtx?.role === 'channel') {
            const { rows: permRows } = await pool.query(
                `SELECT can_customize_partner_system FROM channels WHERE id = $1`, [adminCtx.channelId]
            );
            if (!permRows[0]?.can_customize_partner_system)
                return { statusCode: 403, success: false, error: 'Forbidden' };
            channelFilter = ` AND channel_id = $${params.length + 1}`;
            params.push(adminCtx.channelId);
        }
        const { rows } = await pool.query(
            `UPDATE partner_commission_rules SET
                rate=COALESCE($1,rate), description=COALESCE($2,description),
                is_active=COALESCE($3,is_active), sort_order=COALESCE($4,sort_order), updated_at=NOW()
             WHERE id=$5${channelFilter} RETURNING *`,
            params
        );
        if (rows.length === 0) return { success: false, error: 'Rule not found', statusCode: 404 };
        return { success: true, rule: rows[0] };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleDeletePartnerCommissionRule(ruleId, adminCtx) {
    if (!ruleId) return { success: false, error: 'rule id required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        let channelFilter = '';
        let params = [ruleId];
        if (adminCtx?.role === 'channel') {
            const { rows: permRows } = await pool.query(
                `SELECT can_customize_partner_system FROM channels WHERE id = $1`, [adminCtx.channelId]
            );
            if (!permRows[0]?.can_customize_partner_system)
                return { statusCode: 403, success: false, error: 'Forbidden' };
            channelFilter = ' AND channel_id = $2';
            params.push(adminCtx.channelId);
        }
        await pool.query(`DELETE FROM partner_commission_rules WHERE id=$1${channelFilter}`, params);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// Superadmin or parent channel admin can grant/revoke can_customize_partner_system on a channel.
async function handlePutChannelPartnerSystemPermission(channelId, body, adminCtx) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const cid = parseInt(channelId);
        if (adminCtx?.role === 'channel') {
            if (!adminCtx.canManageSubchannels) return { statusCode: 403, success: false, error: 'Forbidden' };
            const { rows } = await pool.query('SELECT parent_channel_id FROM channels WHERE id = $1', [cid]);
            const parentId = rows[0]?.parent_channel_id;
            if (!parentId) return { statusCode: 403, success: false, error: 'Cannot grant partner system permission to a root channel' };
            const owns = await verifySubchannelOwnership(parentId, adminCtx);
            if (!owns && parentId !== adminCtx.channelId) return { statusCode: 403, success: false, error: 'Forbidden' };
        }
        const { can_customize_partner_system } = body || {};
        if (typeof can_customize_partner_system !== 'boolean')
            return { statusCode: 400, success: false, error: 'can_customize_partner_system must be a boolean' };
        await pool.query('UPDATE channels SET can_customize_partner_system = $1 WHERE id = $2', [can_customize_partner_system, cid]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetChannelRewardsSummary(channelId) {
    if (!channelId) return { success: false, error: 'channel_id required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const now = new Date();
        const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const [chMonth, coachBreakdown, pendingPayouts] = await Promise.all([
            pool.query(
                `SELECT COALESCE(SUM(amount_cny),0) AS total FROM channel_commissions
                 WHERE channel_id=$1 AND to_char(created_at,'YYYY-MM')=$2`,
                [channelId, period]
            ),
            pool.query(
                `SELECT cc.coach_id, u.nickname AS coach_name,
                        COALESCE(SUM(CASE WHEN to_char(cc.created_at,'YYYY-MM')=$2 THEN cc.amount_cny ELSE 0 END),0) AS this_month,
                        COALESCE(SUM(CASE WHEN cc.status='pending' THEN cc.amount_cny ELSE 0 END),0) AS pending_total
                 FROM coach_commissions cc
                 LEFT JOIN users u ON u.user_id = cc.coach_id
                 WHERE cc.channel_id=$1
                 GROUP BY cc.coach_id, u.nickname
                 ORDER BY pending_total DESC`,
                [channelId, period]
            ),
            pool.query(
                `SELECT id, coach_id, period, total_cny, status, u.nickname AS coach_name
                 FROM coach_payouts cp
                 LEFT JOIN users u ON u.user_id = cp.coach_id
                 WHERE cp.channel_id=$1 AND cp.status='draft'
                 ORDER BY cp.period DESC`,
                [channelId]
            ),
        ]);
        return {
            success: true,
            this_month_cny: Number(chMonth.rows[0].total),
            coach_breakdown: coachBreakdown.rows,
            pending_payouts: pendingPayouts.rows,
            period,
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ── End partner system handlers ──────────────────────────────────────────────

module.exports = {
    handleGetPartners,
    handleGetPartner,
    handlePostPartner,
    handlePutPartner,
    handleDeletePartner,
    handleGetPartnerCommissions,
    handlePostPartnerCommission,
    handleGetPartnerPayouts,
    handlePostGeneratePartnerPayouts,
    handlePutPartnerPayout,
    handleGetPartnerTree,
    handleGetChannelReferralNetwork,
    handleGetPartnerCommissionConfig,
    handlePutPartnerCommissionConfig,
    handleGetPartnerTypes,
    handlePostPartnerType,
    handlePutPartnerType,
    handleDeletePartnerType,
    handleGetPartnerCommissionRules,
    handlePostPartnerCommissionRule,
    handlePutPartnerCommissionRule,
    handleDeletePartnerCommissionRule,
    handlePutChannelPartnerSystemPermission,
    handleGetChannelRewardsSummary,
};
