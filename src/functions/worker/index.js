const { pool } = require('./lib/db');
const { recordOrderCommissions } = require('./lib/commissions');
const { recordReferralCommission, generatePartnerPayouts } = require('./lib/partnerCommissions');
const ossLib = require('./lib/oss');
const crypto = require('crypto');

const generateUserId = () => crypto.randomBytes(4).toString('hex');

function signChannelAdminToken({ sub, cid, tabs, cms }) {
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + 86400;
    const payload = Buffer.from(JSON.stringify({ sub, cid, tabs, cms: cms ?? false, iat, exp })).toString('base64url');
    const sig = crypto.createHmac('sha256', process.env.API_BEARER_TOKEN)
                      .update(`ch.${payload}`).digest('hex');
    return `ch.${payload}.${sig}`;
}

function verifyChannelAdminToken(token) {
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== 'ch') return null;
    const [prefix, payload, sig] = parts;
    const expected = crypto.createHmac('sha256', process.env.API_BEARER_TOKEN)
                           .update(`${prefix}.${payload}`).digest('hex');
    try {
        if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return null;
    } catch { return null; }
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
}

// WeChat access_token cache (module-level, survives container reuse)
const _wxTokenCache = {};
async function getWxAccessToken(appid = null, secret = null) {
    const id = appid || process.env.WX_APPID;
    const sec = secret || process.env.WX_SECRET;
    const cached = _wxTokenCache[id];
    if (cached && Date.now() < cached.expiry) return cached.token;
    const res = await fetch(`https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${id}&secret=${sec}`);
    const data = await res.json();
    if (data.errcode) throw new Error(`WX token error: ${data.errmsg} (${data.errcode})`);
    _wxTokenCache[id] = { token: data.access_token, expiry: Date.now() + (data.expires_in - 300) * 1000 };
    return data.access_token;
}
const { getNowShanghai, calculateAge } = require('./lib/time-utils');
const { updateHealthTwin } = require('./lib/healthTwinUpdater');
const { BiomarkerEstimator } = require('./lib/estimator/BiomarkerEstimator');
const { deriveTags } = require('./lib/estimator/tagDerivation');
const { BioAgeCalculator } = require('./lib/bioage/BioAgeCalculator');
const { runWorkflow: runFirstReportWorkflow } = require('./lib/reports/workflow');
const OpenAI = require('openai');
const intentClassifierTemplate = require('./prompts/chat/intentClassifier');
const chatPrompts = {
    casual_chat:        require('./prompts/chat/casual'),
    biomarker_question: require('./prompts/chat/biomarker'),
    nutrition_question: require('./prompts/chat/nutrition'),
    longevity_science:  require('./prompts/chat/science'),
    record_action:      require('./prompts/chat/record'),
    set_reminder:       require('./prompts/chat/reminder'),
    emotional_support:  require('./prompts/chat/emotional'),
};
const systemNutritionTemplate = require('./prompts/systemNutrition');
const systemHealthAdviceTemplate = require('./prompts/systemHealthAdvice');
const strings = require('./prompts/strings');
const systemAdminReportTemplate = require('./prompts/systemAdminReport');
const systemHealthReportTemplate = require('./prompts/systemHealthReport');

const getLlmClient = () => new OpenAI({
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
});

async function handleGetUsers(channelId) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const params = [];
        const channelFilter = channelId ? `AND u.channel_id = $${params.push(channelId)}` : '';
        const query = `
            SELECT u.user_id, u.external_id, u.external_app, u.nickname, u.birth_date, u.language, u.gender,
                    u.avatar_url, u.coach_id, u.channel_id, u.roles, u.created_at, u.phone, u.email,
                    b.bio_age, b.data as bio_data,
                    cu.nickname as coach_name,
                    c.name as channel_name, c.logo_url as channel_logo_url,
                    (SELECT content FROM notifications WHERE user_id = u.user_id AND notification_type = 'biological_report' ORDER BY sent_at DESC LIMIT 1) as latest_report,
                    (SELECT content FROM notifications WHERE user_id = u.user_id AND notification_type = 'nutrition_plan' ORDER BY sent_at DESC LIMIT 1) as latest_plan
            FROM users u
            LEFT JOIN coaches p ON u.coach_id = p.id
            LEFT JOIN users cu ON p.user_id = cu.user_id
            LEFT JOIN channels c ON u.channel_id = c.id
            LEFT JOIN (
                SELECT DISTINCT ON (user_id) user_id, bio_age, data
                FROM biomarkers
                ORDER BY user_id, tested_at DESC
            ) b ON u.user_id = b.user_id
            WHERE 1=1 ${channelFilter}
            ORDER BY u.created_at DESC;
        `;
        const result = await pool.query(query, params);
        const users = result.rows.map(u => ({ ...u, chrono_age: calculateAge(u.birth_date) }));
        return { success: true, users };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetUser(user_id) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const res = await pool.query(
            `SELECT user_id, nickname, avatar_url, phone, email, language, gender, birth_date, roles, coach_id, channel_id, created_at
             FROM users WHERE user_id=$1`,
            [user_id]
        );
        if (!res.rows.length) return { success: false, error: 'User not found' };
        return { success: true, user: res.rows[0] };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetBiomarkers(openid) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        if (!openid) return { success: true, records: [] };
        const result = await pool.query(
            `SELECT id, test_type, data, bio_age, tested_at
             FROM biomarkers
             WHERE user_id = $1
             ORDER BY tested_at ASC`,
            [openid]
        );
        return { success: true, records: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetNotifications(openid) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        if (!openid) return { success: true, notifications: [] };
        const query = `
            SELECT n.id, n.content, n.notification_type
            FROM notifications n
            JOIN users u ON n.user_id = u.user_id
            WHERE u.user_id = $1 AND n.status = 'pending'
            ORDER BY n.sent_at ASC;
        `;
        const result = await pool.query(query, [openid]);
        if (result.rows.length > 0) {
            const ids = result.rows.map(r => r.id);
            await pool.query('UPDATE notifications SET status = $1 WHERE id = ANY($2)', ['sent', ids]);
        }
        return { success: true, notifications: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetDotsInventory() {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const result = await pool.query('SELECT * FROM dots ORDER BY id ASC');
        return { success: true, dots: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetMyCartridges(openid) {
    if (!openid) return { success: false, error: 'openid is required' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const userResult = await pool.query(
            'SELECT user_id FROM users WHERE user_id = $1 OR external_id = $1 LIMIT 1', [openid]
        );
        if (userResult.rows.length === 0) return { success: false, error: 'User not found' };
        const userId = userResult.rows[0].user_id;

        const result = await pool.query(`
            SELECT uc.id, uc.nfc_tag_id, uc.total_dots, uc.remaining_dots, uc.status,
                   uc.inserted_at, uc.last_dispensed_at,
                   d.key_name AS dot_key, d.name AS dot_name, d.name_zh AS dot_name_zh,
                   d.color_hex, d.timing
            FROM user_cartridges uc
            JOIN dots d ON d.id = uc.dot_id
            WHERE uc.user_id = $1 AND uc.status != 'removed'
            ORDER BY d.id ASC
        `, [userId]);

        return { success: true, cartridges: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostCartridgeInsert(body) {
    const { openid, nfc_tag_id, dot_key } = body;
    if (!openid || !nfc_tag_id || !dot_key) return { success: false, error: 'openid, nfc_tag_id and dot_key are required' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };

        const [userResult, dotResult] = await Promise.all([
            pool.query('SELECT user_id FROM users WHERE user_id = $1 OR external_id = $1 LIMIT 1', [openid]),
            pool.query('SELECT id FROM dots WHERE key_name = $1 LIMIT 1', [dot_key.toUpperCase()]),
        ]);
        if (userResult.rows.length === 0) return { success: false, error: 'User not found' };
        if (dotResult.rows.length === 0) return { success: false, error: `Dot not found: ${dot_key}` };
        const userId = userResult.rows[0].user_id;
        const dotId = dotResult.rows[0].id;

        // Previous active cartridge of same dot type is auto-removed
        await pool.query(
            `UPDATE user_cartridges SET status = 'removed' WHERE user_id = $1 AND dot_id = $2 AND status = 'active'`,
            [userId, dotId]
        );

        // Upsert: if this NFC tag existed before (e.g. removed), reactivate it fresh
        await pool.query(`
            INSERT INTO user_cartridges (user_id, dot_id, nfc_tag_id, total_dots, remaining_dots, status, inserted_at)
            VALUES ($1, $2, $3, 800, 800, 'active', NOW())
            ON CONFLICT (nfc_tag_id) DO UPDATE
              SET user_id = EXCLUDED.user_id, dot_id = EXCLUDED.dot_id,
                  status = 'active', inserted_at = NOW(), remaining_dots = 800, total_dots = 800
        `, [userId, dotId, nfc_tag_id]);

        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostCartridgeRemove(body) {
    const { openid, nfc_tag_id } = body;
    if (!openid || !nfc_tag_id) return { success: false, error: 'openid and nfc_tag_id are required' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const userResult = await pool.query(
            'SELECT user_id FROM users WHERE user_id = $1 OR external_id = $1 LIMIT 1', [openid]
        );
        if (userResult.rows.length === 0) return { success: false, error: 'User not found' };
        const userId = userResult.rows[0].user_id;
        await pool.query(
            `UPDATE user_cartridges SET status = 'removed' WHERE nfc_tag_id = $1 AND user_id = $2`,
            [nfc_tag_id, userId]
        );
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostDispense(body) {
    const { openid, slot, date, dispensed } = body;
    if (!openid || !slot || !date || !dispensed) return { success: false, error: 'openid, slot, date and dispensed are required' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const userResult = await pool.query(
            'SELECT user_id FROM users WHERE user_id = $1 OR external_id = $1 LIMIT 1', [openid]
        );
        if (userResult.rows.length === 0) return { success: false, error: 'User not found' };
        const userId = userResult.rows[0].user_id;

        const dispenseLog = {};
        const updatedCartridges = [];

        for (const [dotKey, count] of Object.entries(dispensed)) {
            const cartResult = await pool.query(`
                SELECT uc.id, uc.remaining_dots
                FROM user_cartridges uc
                JOIN dots d ON d.id = uc.dot_id
                WHERE uc.user_id = $1 AND d.key_name = $2 AND uc.status = 'active'
                LIMIT 1
            `, [userId, dotKey]);

            if (cartResult.rows.length === 0) continue;
            const cart = cartResult.rows[0];
            const newRemaining = Math.max(0, cart.remaining_dots - count);
            const newStatus = newRemaining <= 0 ? 'empty' : 'active';

            await pool.query(
                `UPDATE user_cartridges SET remaining_dots = $1, status = $2, last_dispensed_at = NOW() WHERE id = $3`,
                [newRemaining, newStatus, cart.id]
            );

            dispenseLog[dotKey] = { deducted: count, cartridge_id: cart.id, remaining_after: newRemaining };
            updatedCartridges.push({ dot_key: dotKey, cartridge_id: cart.id, remaining: newRemaining, status: newStatus });
        }

        await pool.query(
            `UPDATE nutrition_schedules SET dispensed_at = NOW(), dispense_log = $1
             WHERE user_id = $2 AND scheduled_date = $3 AND slot_name = $4`,
            [JSON.stringify(dispenseLog), userId, date, slot]
        );

        return { success: true, dispensed: updatedCartridges };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetStoreItems(query = {}) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const showAll = query.all === 'true';
        const result = await pool.query(
            `SELECT id, key_name, name_zh, name_en, desc_zh, desc_en,
                    unit_zh, unit_en, price_cny, price_usd, tag, sort_order, active, image_url
             FROM store_items
             ${showAll ? '' : 'WHERE active = TRUE'}
             ORDER BY sort_order ASC, created_at ASC`
        );
        return { success: true, items: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetOrders() {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const result = await pool.query(
            `SELECT o.id, o.user_id, o.item_id, o.item_key, o.quantity,
                    o.price_cny, o.price_usd, o.status, o.created_at,
                    u.nickname, u.external_id,
                    s.name_en, s.name_zh
             FROM orders o
             LEFT JOIN users u ON o.user_id = u.user_id
             LEFT JOIN store_items s ON o.item_id = s.id
             ORDER BY o.created_at DESC
             LIMIT 200`
        );
        return { success: true, orders: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetMyOrders(openid) {
    if (!openid) return { success: false, error: 'openid is required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const result = await pool.query(
            `SELECT o.id, o.item_key, o.quantity, o.price_cny, o.price_usd, o.status, o.created_at,
                    s.name_en, s.name_zh, s.unit_en, s.unit_zh
             FROM orders o
             LEFT JOIN store_items s ON o.item_id = s.id
             WHERE o.user_id = $1
             ORDER BY o.created_at DESC`,
            [openid]
        );
        return { success: true, orders: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostStoreItem(body) {
    const { key_name, name_en, name_zh, desc_en, desc_zh, unit_en, unit_zh, price_cny, price_usd, tag, sort_order, active, image_url } = body;
    if (!key_name) return { success: false, error: 'key_name is required', statusCode: 400 };
    if (!name_en)  return { success: false, error: 'name_en is required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const result = await pool.query(
            `INSERT INTO store_items (key_name, name_en, name_zh, desc_en, desc_zh, unit_en, unit_zh, price_cny, price_usd, tag, sort_order, active, image_url)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
            [key_name, name_en, name_zh || '', desc_en || '', desc_zh || '', unit_en || '', unit_zh || '',
             parseFloat(price_cny) || 0, parseFloat(price_usd) || 0,
             tag || null, parseInt(sort_order) || 0, active !== false, image_url || null]
        );
        return { success: true, id: result.rows[0].id };
    } catch (err) {
        return { success: false, error: err.detail || err.message };
    }
}

async function handlePutStoreItem(itemId, body) {
    const { name_en, name_zh, desc_en, desc_zh, unit_en, unit_zh, price_cny, price_usd, tag, sort_order, active, image_url } = body;
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        await pool.query(
            `UPDATE store_items SET name_en=$1, name_zh=$2, desc_en=$3, desc_zh=$4,
             unit_en=$5, unit_zh=$6, price_cny=$7, price_usd=$8, tag=$9, sort_order=$10, active=$11,
             image_url=$12
             WHERE id=$13`,
            [name_en, name_zh || '', desc_en || '', desc_zh || '', unit_en || '', unit_zh || '',
             parseFloat(price_cny), parseFloat(price_usd),
             tag || null, parseInt(sort_order) || 0, active !== false,
             image_url || null, itemId]
        );
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ── Commission & Rewards handlers ─────────────────────────────────────────────

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
        const periodStart = `${period}-01`;
        const periodEnd   = `${period}-31`;
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
        const { rows } = await pool.query(`
            INSERT INTO partners (tier, real_name, phone, entry_fee_paid, channel_id, user_id,
                                  referred_by_partner_id, contracted_at, notes, status)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
            RETURNING *
        `, [tier, real_name, phone, entry_fee_paid, channel_id || null, user_id || null,
            referred_by_partner_id || null, contracted_at || null, notes || null, status || 'active']);
        const newPartner = rows[0];

        if (referred_by_partner_id) {
            const { rows: uplineRows } = await pool.query(
                `SELECT id, tier, real_name FROM partners WHERE id=$1 AND status='active'`,
                [referred_by_partner_id]
            );
            if (uplineRows[0]) {
                await recordReferralCommission(uplineRows[0], newPartner);
            }
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

async function handleGetPartnerCommissionConfig() {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const { rows } = await pool.query(
            `SELECT referral_rates, product_discount_rates, training_discount_rates,
                    team_primary_rate, team_secondary_rate, updated_at
             FROM partner_commission_config WHERE id = 1`
        );
        const cfg = rows[0] || {
            referral_rates: { light_entrepreneur: { light_entrepreneur: 0.25, leader_partner: 0.20, operations_center: 0.10 }, leader_partner: { light_entrepreneur: 0.40, leader_partner: 0.25, operations_center: 0.20 }, operations_center: { light_entrepreneur: 0.50, leader_partner: 0.30, operations_center: 0.25 } },
            product_discount_rates: { light_entrepreneur: 0.30, leader_partner: 0.40, operations_center: 0.50 },
            training_discount_rates: { light_entrepreneur: 0.10, leader_partner: 0.30, operations_center: 0.50 },
            team_primary_rate: 0.02,
            team_secondary_rate: 0.02,
        };
        return { success: true, config: cfg };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePutPartnerCommissionConfig(body) {
    const { referral_rates, product_discount_rates, training_discount_rates, team_primary_rate, team_secondary_rate } = body;
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        await pool.query(`
            INSERT INTO partner_commission_config
                (id, referral_rates, product_discount_rates, training_discount_rates, team_primary_rate, team_secondary_rate, updated_at)
            VALUES (1, $1, $2, $3, $4, $5, NOW())
            ON CONFLICT (id) DO UPDATE SET
                referral_rates = EXCLUDED.referral_rates,
                product_discount_rates = EXCLUDED.product_discount_rates,
                training_discount_rates = EXCLUDED.training_discount_rates,
                team_primary_rate = EXCLUDED.team_primary_rate,
                team_secondary_rate = EXCLUDED.team_secondary_rate,
                updated_at = NOW()
        `, [
            JSON.stringify(referral_rates),
            JSON.stringify(product_discount_rates),
            JSON.stringify(training_discount_rates),
            team_primary_rate,
            team_secondary_rate,
        ]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ── End partner system handlers ──────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────

async function handleDeleteStoreItem(itemId) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        await pool.query('DELETE FROM store_items WHERE id = $1', [itemId]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetChannelInventory(query, adminCtx) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const channelId = adminCtx?.role === 'channel' ? adminCtx.cid : query.channel_id;
        if (!channelId) return { success: false, error: 'channel_id required', statusCode: 400 };
        const { rows } = await pool.query(
            'SELECT * FROM channel_inventory_items WHERE channel_id = $1 ORDER BY sort_order, created_at',
            [channelId]
        );
        return { success: true, items: rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostChannelInventory(body, adminCtx) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const channelId = adminCtx?.role === 'channel' ? adminCtx.cid : body.channel_id;
        if (!channelId) return { success: false, error: 'channel_id required', statusCode: 400 };
        if (!body.key_name) return { success: false, error: 'key_name required', statusCode: 400 };
        if (!body.name_en) return { success: false, error: 'name_en required', statusCode: 400 };
        const { rows } = await pool.query(
            `INSERT INTO channel_inventory_items
              (channel_id, key_name, name_zh, name_en, desc_zh, desc_en, item_type,
               unit_zh, unit_en, price_cny, price_usd, stock_quantity, tag, sort_order, active, image_url, metadata)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
             RETURNING *`,
            [channelId, body.key_name, body.name_zh || '', body.name_en,
             body.desc_zh || '', body.desc_en || '', body.item_type || 'physical',
             body.unit_zh || '', body.unit_en || '',
             body.price_cny != null ? body.price_cny : null,
             body.price_usd != null ? body.price_usd : null,
             body.stock_quantity != null ? body.stock_quantity : null,
             body.tag || '', body.sort_order || 0, body.active !== false,
             body.image_url || '', body.metadata || null]
        );
        return { success: true, item: rows[0] };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePutChannelInventory(id, body, adminCtx) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const channelId = adminCtx?.role === 'channel' ? adminCtx.cid : null;
        const params = [
            body.name_zh || '', body.name_en || '', body.desc_zh || '', body.desc_en || '',
            body.item_type || 'physical', body.unit_zh || '', body.unit_en || '',
            body.price_cny != null ? body.price_cny : null,
            body.price_usd != null ? body.price_usd : null,
            body.stock_quantity != null ? body.stock_quantity : null,
            body.tag || '', body.sort_order || 0, body.active !== false,
            body.image_url || '', body.metadata || null, id,
        ];
        let sql = `UPDATE channel_inventory_items
             SET name_zh=$1, name_en=$2, desc_zh=$3, desc_en=$4, item_type=$5,
                 unit_zh=$6, unit_en=$7, price_cny=$8, price_usd=$9, stock_quantity=$10,
                 tag=$11, sort_order=$12, active=$13, image_url=$14, metadata=$15
             WHERE id=$16`;
        if (channelId) { sql += ' AND channel_id=$17'; params.push(channelId); }
        sql += ' RETURNING *';
        const { rows } = await pool.query(sql, params);
        if (!rows.length) return { success: false, error: 'Not found', statusCode: 404 };
        return { success: true, item: rows[0] };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleDeleteChannelInventory(id, adminCtx) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const channelId = adminCtx?.role === 'channel' ? adminCtx.cid : null;
        if (channelId) {
            await pool.query('DELETE FROM channel_inventory_items WHERE id=$1 AND channel_id=$2', [id, channelId]);
        } else {
            await pool.query('DELETE FROM channel_inventory_items WHERE id=$1', [id]);
        }
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePutOrder(orderId, body) {
    const { status } = body;
    if (!status) return { success: false, error: 'status is required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        await pool.query('UPDATE orders SET status = $1 WHERE id = $2', [status, orderId]);
        if (status === 'delivered') {
            await recordOrderCommissions(orderId);
        }
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostOrder(body) {
    const { openid, item_id, quantity = 1 } = body;
    if (!openid || !item_id) return { success: false, error: 'openid and item_id are required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const itemResult = await pool.query(
            'SELECT id, key_name, price_cny, price_usd FROM store_items WHERE id = $1 AND active = TRUE',
            [item_id]
        );
        if (itemResult.rows.length === 0) return { success: false, error: 'Item not found', statusCode: 404 };
        const item = itemResult.rows[0];
        const result = await pool.query(
            `INSERT INTO orders (user_id, item_id, item_key, quantity, price_cny, price_usd, status)
             VALUES ($1, $2, $3, $4, $5, $6, 'pending') RETURNING id`,
            [openid, item.id, item.key_name, quantity, item.price_cny, item.price_usd]
        );
        return { success: true, order_id: result.rows[0].id };
    } catch (err) {
        return { success: false, error: err.detail || err.message };
    }
}

async function handleGetNutritionPlan(openid) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        if (!openid) return { success: true, plan: null, dots: [] };

        // 1. Get latest structured plan
        const planResult = await pool.query(
            `SELECT id, start_date, end_date, goal, created_at
             FROM nutrition_plans
             WHERE user_id = $1
             ORDER BY created_at DESC LIMIT 1`,
            [openid]
        );

        let planData = null;
        let schedules = [];

        if (planResult.rows.length > 0) {
            planData = planResult.rows[0];
            const scheduleResult = await pool.query(
                `SELECT scheduled_date, slot_name, recipe, is_taken, taken_at
                 FROM nutrition_schedules
                 WHERE plan_id = $1
                 ORDER BY scheduled_date ASC, slot_name DESC`,
                [planData.id]
            );
            schedules = scheduleResult.rows;
        }

        // 2. Fallback/Legacy notification content
        const notifyResult = await pool.query(
            `SELECT content, sent_at FROM notifications
             WHERE user_id = $1 AND notification_type = 'nutrition_plan'
             ORDER BY sent_at DESC LIMIT 1`,
            [openid]
        );

        const dotsResult = await pool.query('SELECT * FROM dots ORDER BY id ASC');

        return {
            success: true,
            plan: notifyResult.rows[0]?.content || null,
            plan_date: notifyResult.rows[0]?.sent_at || null,
            structured_plan: planData,
            schedules: schedules,
            dots: dotsResult.rows,
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

function _scoreMarker(value, normalMax, elevatedMax) {
    const v = parseFloat(value);
    if (isNaN(v)) return 0;
    if (v <= normalMax) return 1;
    if (v <= elevatedMax) return 2;
    return 3;
}

function _calcDotCounts(biomarkers, bioageProfile) {
    const hsCRP = _scoreMarker(biomarkers.hsCRP, 1, 3);
    const il6   = _scoreMarker(biomarkers.IL6, 3, 6);
    const gdf15 = _scoreMarker(biomarkers.GDF15, 750, 1500);
    const ga    = _scoreMarker(biomarkers.GA, 15, 20);
    const cysC  = _scoreMarker(biomarkers.CystatinC, 0.9, 1.2);
    const bioOver = (bioageProfile.BioAge || 0) > (bioageProfile.ChronoAge || 999) ? 2 : 0;

    const base = 3;
    const raw = {
        D01: base + gdf15 + bioOver,
        D02: base + gdf15,
        D03: base + Math.max(gdf15, bioOver),
        D04: base + hsCRP + il6,
        D05: base + gdf15,
        D06: base + 1,
        D07: base + ga,
        D08: base + cysC,
        D09: base + 1,
        D10: base + 1,
        D11: base + ga,
        D12: base + hsCRP,
        D13: base + gdf15 + bioOver,
        D14: base + gdf15,
        D15: base + il6 + hsCRP,
        D16: base + il6,
        D17: base + cysC,
        D18: base + 1,
    };

    const counts = {};
    for (const [k, v] of Object.entries(raw)) {
        counts[k] = Math.min(10, Math.max(1, v));
    }
    return counts;
}

// Derived from dots.timing column at formulation time — do not hardcode here
const MONTH_EN = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const WEEKDAY_EN = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const WEEKDAY_ZH = ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'];

function _generatePlanText(dotCounts, availableDotKeys, lang, startDate, days, morningKeys, eveningKeys) {
    const lines = [];
    const start = new Date(startDate + 'T00:00:00+08:00');

    for (let i = 0; i < days; i++) {
        const d = new Date(start.getTime() + i * 86400000);
        const dow = d.getDay();
        const month = d.getMonth();
        const day = d.getDate();

        const mParts = morningKeys
            .filter(k => availableDotKeys.has(k))
            .map(k => `${k}x${dotCounts[k] || 3}`);
        const eParts = eveningKeys
            .filter(k => availableDotKeys.has(k))
            .map(k => `${k}x${dotCounts[k] || 3}`);

        if (lang === 'zh') {
            lines.push(`${month + 1}月${day}日 (${WEEKDAY_ZH[dow]}): 早上 ${mParts.join(' ')} 晚上 ${eParts.join(' ')}`);
        } else {
            lines.push(`${MONTH_EN[month]} ${day}, ${WEEKDAY_EN[dow]}: Morning ${mParts.join(' ')} Evening ${eParts.join(' ')}`);
        }
    }

    return lines.join('\n');
}

async function handlePostFormulaDots(body) {
    const { openid } = body;
    if (!openid) return { success: false, error: 'openid is required' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };

        const [userResult, bioResult, dotsResult] = await Promise.all([
            pool.query('SELECT * FROM users WHERE user_id = $1 OR external_id = $1 LIMIT 1', [openid]),
            pool.query(
                `SELECT bio_age, data FROM biomarkers WHERE user_id = (SELECT user_id FROM users WHERE user_id = $1 OR external_id = $1 LIMIT 1)
                 AND test_type = 'kino_chip' ORDER BY tested_at DESC LIMIT 1`,
                [openid]
            ),
            pool.query(`SELECT id, key_name, name, name_zh, timing, ingredients, ingredients_zh FROM dots ORDER BY id ASC`),
        ]);

        if (userResult.rows.length === 0) return { success: false, error: 'User not found' };
        const user = userResult.rows[0];
        const latestBio = bioResult.rows[0] || {};
        const data = latestBio.data || {};
        const biomarkers = data.biomarkers || data.estimated || data.actual || {};
        const bioageProfile = data.bioage_profile || {};

        const startDate = getNowShanghai().toISODate();
        const lang = user.language || 'zh';

        // Ask LLM to assign per-dot counts based on biomarkers
        const nutritionContext = {
            language: lang,
            biomarkers,
            bioage_profile: bioageProfile,
            dots_formulary: dotsResult.rows,
            start_date: startDate,
            days_needed: 7,
        };
        const llmClient = getLlmClient();
        const model = process.env.MODEL || 'qwen3.6-plus';
        const prompt = systemNutritionTemplate(nutritionContext);
        console.log(JSON.stringify({ level: 'INFO', msg: 'Formula DOTS Context', data: nutritionContext }));

        const completion = await llmClient.chat.completions.create({
            model,
            messages: [{ role: 'user', content: prompt }],
        });

        const llmText = completion.choices[0].message.content || '';
        console.log(JSON.stringify({ level: 'INFO', msg: 'LLM Response', text: llmText }));
        let analysis = '';
        const dotCounts = {};

        // Improved parsing for ANALYSIS and FORMULATION sections
        const lines = llmText.split('\n');
        let currentSection = '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            if (trimmed.startsWith('ANALYSIS:')) {
                analysis = trimmed.replace('ANALYSIS:', '').trim();
                currentSection = 'analysis';
                continue;
            } else if (trimmed.startsWith('FORMULATION:')) {
                currentSection = 'formulation';
                continue;
            }

            if (currentSection === 'formulation') {
                const m = trimmed.match(/^(D\d{2}):\s*(\d+)$/);
                if (m) {
                    dotCounts[m[1]] = Math.min(10, Math.max(1, parseInt(m[2], 10)));
                }
            } else if (currentSection === 'analysis' && !analysis) {
                // In case it's multi-line (though prompt says brief)
                analysis = trimmed;
            }
        }

        // Build morning/evening splits from DB timing column
        const morningKeys = dotsResult.rows.filter(r => r.timing === 'Morning').map(r => r.key_name.replace(/^DOT/, 'D'));
        const eveningKeys = dotsResult.rows.filter(r => r.timing === 'Evening').map(r => r.key_name.replace(/^DOT/, 'D'));

        // Fill any missing keys with deterministic fallback
        const availableDotKeys = new Set(dotsResult.rows.map(r => r.key_name.replace(/^DOT/, 'D')));
        const fallbackCounts = _calcDotCounts(biomarkers, bioageProfile);
        for (const k of availableDotKeys) {
            if (!dotCounts[k]) dotCounts[k] = fallbackCounts[k] || 4;
        }

        const planText = _generatePlanText(dotCounts, availableDotKeys, lang, startDate, 7, morningKeys, eveningKeys);
        const finalContent = analysis ? `${analysis}\n\n${planText}` : planText;

        const startDateObj = getNowShanghai();
        const endDateObj = startDateObj.plus({ days: 6 });

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const planInsert = await client.query(
                'INSERT INTO nutrition_plans (user_id, start_date, end_date, goal) VALUES ($1, $2, $3, $4) RETURNING id',
                [user.user_id, startDateObj.toISODate(), endDateObj.toISODate(), analysis || 'Personalized Formulation']
            );
            const planId = planInsert.rows[0].id;

            for (let i = 0; i < 7; i++) {
                const currentDate = startDateObj.plus({ days: i }).toISODate();

                const morningRecipe = { dots: {} };
                morningKeys.forEach(k => {
                    if (availableDotKeys.has(k) && dotCounts[k] > 0) {
                        morningRecipe.dots[k.replace('D', 'DOT')] = dotCounts[k];
                    }
                });

                const eveningRecipe = { dots: {} };
                eveningKeys.forEach(k => {
                    if (availableDotKeys.has(k) && dotCounts[k] > 0) {
                        eveningRecipe.dots[k.replace('D', 'DOT')] = dotCounts[k];
                    }
                });

                await client.query(
                    'INSERT INTO nutrition_schedules (plan_id, user_id, scheduled_date, slot_name, recipe) VALUES ($1, $2, $3, $4, $5)',
                    [planId, user.user_id, currentDate, 'morning_cup', morningRecipe]
                );
                await client.query(
                    'INSERT INTO nutrition_schedules (plan_id, user_id, scheduled_date, slot_name, recipe) VALUES ($1, $2, $3, $4, $5)',
                    [planId, user.user_id, currentDate, 'evening_cup', eveningRecipe]
                );
            }

            await client.query(
                'INSERT INTO notifications (user_id, notification_type, content, status) VALUES ($1, $2, $3, $4)',
                [user.user_id, 'nutrition_plan', finalContent, 'pending']
            );

            // Also save to chat history for persistence
            await saveChatMessage(user.user_id, 'ai', finalContent);

            await client.query('COMMIT');        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }

        return { success: true };
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handlePostFormulaDots failed', error: err.message }));
        return { success: false, error: err.message };
    }
}

async function handleGetCoachList(channelId) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const params = [];
        const channelFilter = channelId ? `WHERE p.channel_id = $${params.push(channelId)}` : '';
        const query = `
            SELECT p.id, p.channel_id, p.user_id, p.created_at,
                   u.nickname AS name, u.email, u.phone, u.avatar_url, u.language,
                   COUNT(assigned.user_id) AS user_count,
                   c.name AS channel_name
            FROM coaches p
            JOIN users u ON p.user_id = u.user_id
            LEFT JOIN users assigned ON p.id = assigned.coach_id
            LEFT JOIN channels c ON p.channel_id = c.id
            ${channelFilter}
            GROUP BY p.id, u.nickname, u.email, u.phone, u.avatar_url, u.language, c.name;
        `;
        const result = await pool.query(query, params);
        return { success: true, coaches: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetChannelUsers(channelId, includeSubchannels = false) {
    if (!channelId) return { success: false, error: 'channelId is required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const whereClause = includeSubchannels
            ? `(u.channel_id = $1 OR ch.parent_channel_id = $1)`
            : `u.channel_id = $1`;
        const result = await pool.query(
            `SELECT u.user_id, u.external_id, u.nickname, u.birth_date, u.language, u.gender,
                    u.coach_id, u.channel_id, u.roles, u.created_at, u.phone, u.email,
                    b.bio_age, cu.nickname AS coach_name,
                    ch.name AS channel_name
             FROM users u
             LEFT JOIN channels ch ON ch.id = u.channel_id
             LEFT JOIN coaches p ON u.coach_id = p.id
             LEFT JOIN users cu ON p.user_id = cu.user_id
             LEFT JOIN (
                 SELECT DISTINCT ON (user_id) user_id, bio_age
                 FROM biomarkers ORDER BY user_id, tested_at DESC
             ) b ON u.user_id = b.user_id
             WHERE ${whereClause}
             ORDER BY u.created_at DESC`,
            [channelId]
        );
        return { success: true, users: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetChannelCoaches(channelId, includeSubchannels = false) {
    if (!channelId) return { success: false, error: 'channelId is required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const whereClause = includeSubchannels
            ? `(p.channel_id = $1 OR ch.parent_channel_id = $1)`
            : `p.channel_id = $1`;
        const result = await pool.query(
            `SELECT p.id, p.channel_id, p.user_id, p.created_at,
                    u.nickname AS name, u.email, u.phone, u.avatar_url, u.language,
                    COUNT(assigned.user_id) AS user_count,
                    ch.name AS channel_name
             FROM coaches p
             JOIN users u ON p.user_id = u.user_id
             LEFT JOIN channels ch ON ch.id = p.channel_id
             LEFT JOIN users assigned ON p.id = assigned.coach_id
             WHERE ${whereClause}
             GROUP BY p.id, u.nickname, u.email, u.phone, u.avatar_url, u.language, ch.name
             ORDER BY p.created_at DESC`,
            [channelId]
        );
        return { success: true, coaches: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetCoachUsers(coachId, query = {}) {
    if (!coachId) return { success: false, error: 'coachId is required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const params = [coachId];
        const extraConds = [];
        if (query.stage) { extraConds.push(`cps.stage = $${params.length + 1}`); params.push(query.stage); }
        if (query.tag_id) { extraConds.push(`cta.tag_id = $${params.length + 1}`); params.push(query.tag_id); }
        const whereCond = extraConds.length ? `AND ${extraConds.join(' AND ')}` : '';
        const result = await pool.query(
            `SELECT u.user_id, u.external_id, u.nickname, u.avatar_url, u.birth_date, u.language, u.gender,
                    u.coach_id, u.channel_id, u.roles, u.created_at, u.phone, u.email,
                    b.bio_age, b.data AS bio_data, b.tested_at AS last_scan_at,
                    m.last_msg_at,
                    lm.last_user_msg, lm.last_user_msg_at,
                    cps.stage AS crm_stage,
                    ARRAY_AGG(DISTINCT ct.name ORDER BY ct.name) FILTER (WHERE ct.name IS NOT NULL) AS crm_tags,
                    ARRAY_AGG(DISTINCT jsonb_build_object('id', ct.id, 'name', ct.name, 'color_hex', ct.color_hex))
                        FILTER (WHERE ct.id IS NOT NULL) AS crm_tag_objects
             FROM users u
             LEFT JOIN (
                 SELECT DISTINCT ON (user_id) user_id, bio_age, data, tested_at
                 FROM biomarkers
                 WHERE test_type = 'kino_chip'
                 ORDER BY user_id, tested_at DESC
             ) b ON u.user_id = b.user_id
             LEFT JOIN (
                 SELECT user_id, MAX(created_at) AS last_msg_at
                 FROM chat_messages
                 GROUP BY user_id
             ) m ON u.user_id = m.user_id
             LEFT JOIN (
                 SELECT DISTINCT ON (user_id) user_id, content AS last_user_msg, created_at AS last_user_msg_at
                 FROM chat_messages
                 WHERE role = 'user'
                 ORDER BY user_id, created_at DESC, id DESC
             ) lm ON u.user_id = lm.user_id
             LEFT JOIN client_pipeline_stages cps ON cps.user_id = u.user_id AND cps.coach_id = $1
             LEFT JOIN client_tag_assignments cta ON cta.user_id = u.user_id AND cta.coach_id = $1
             LEFT JOIN client_tags ct ON ct.id = cta.tag_id
             WHERE u.coach_id = $1 ${whereCond}
             GROUP BY u.user_id, b.bio_age, b.data, b.tested_at, m.last_msg_at, lm.last_user_msg, lm.last_user_msg_at, cps.stage
             ORDER BY COALESCE(m.last_msg_at, b.tested_at, u.created_at) DESC`,
            params
        );
        return { success: true, users: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostCoachInstruction(body) {
    const { openid, instruction } = body;
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const user = await pool.query('SELECT user_id FROM users WHERE user_id = $1', [openid]);
        if (user.rows.length === 0) return { success: false, error: 'User not found', statusCode: 404 };
        await pool.query(
            'INSERT INTO chat_messages (user_id, role, content) VALUES ($1, $2, $3)',
            [user.rows[0].user_id, 'coach', instruction]
        );
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetCoachSentMessages(userId) {
    if (!userId) return { success: false, error: 'user_id is required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const result = await pool.query(
            `SELECT id, content, status, sent_at
             FROM notifications
             WHERE user_id = $1 AND notification_type = 'coach_instruction'
             ORDER BY sent_at DESC
             LIMIT 50`,
            [userId]
        );
        return { success: true, messages: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostReminder(body) {
    const { user_id, coach_id, content, scheduled_for, recurrence } = body;
    if (!user_id || !content || !scheduled_for)
        return { success: false, error: 'user_id, content, scheduled_for are required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const result = await pool.query(
            `INSERT INTO reminders (user_id, coach_id, content, scheduled_for, recurrence)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, scheduled_for`,
            [user_id, coach_id || null, content, scheduled_for, recurrence || null]
        );
        return { success: true, reminder: result.rows[0] };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetReminders(openid) {
    if (!openid) return { success: false, error: 'openid is required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const result = await pool.query(
            `SELECT id, content, scheduled_for, recurrence, status, coach_id
             FROM reminders
             WHERE user_id = $1
               AND status = 'pending'
               AND scheduled_for >= NOW() - INTERVAL '1 hour'
             ORDER BY scheduled_for ASC
             LIMIT 50`,
            [openid]
        );
        return { success: true, reminders: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// COACH CRM — all phases
// ─────────────────────────────────────────────────────────────────────────────

function logActivity(coachId, userId, activityType, metadata = {}) {
    if (!pool) return;
    pool.query(
        `INSERT INTO client_activity_log (coach_id, user_id, activity_type, metadata)
         VALUES ($1, $2, $3, $4)`,
        [coachId, userId, activityType, JSON.stringify(metadata)]
    ).catch(err => console.error(JSON.stringify({ level: 'ERROR', msg: 'activity_log_failed', data: { err: err.message } })));
}

// ── Phase 1: Tags ─────────────────────────────────────────────────────────────

async function handleGetCoachTags(coachId) {
    if (!coachId) return { success: false, error: 'coach_id is required', statusCode: 400 };
    try {
        const r = await pool.query(
            `SELECT id, name, color_hex, created_at FROM client_tags WHERE coach_id = $1 ORDER BY name`,
            [coachId]
        );
        return { success: true, tags: r.rows };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handlePostCoachTag(body) {
    const { coach_id, name, color_hex } = body;
    if (!coach_id || !name) return { success: false, error: 'coach_id and name are required', statusCode: 400 };
    try {
        const r = await pool.query(
            `INSERT INTO client_tags (coach_id, name, color_hex) VALUES ($1, $2, $3)
             ON CONFLICT (coach_id, name) DO UPDATE SET color_hex = EXCLUDED.color_hex
             RETURNING id, name, color_hex`,
            [coach_id, name, color_hex || '#6375EC']
        );
        return { success: true, tag: r.rows[0] };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handlePutCoachTag(tagId, body) {
    const { name, color_hex } = body;
    try {
        const sets = [];
        const vals = [];
        if (name) { sets.push(`name = $${vals.length + 2}`); vals.push(name); }
        if (color_hex) { sets.push(`color_hex = $${vals.length + 2}`); vals.push(color_hex); }
        if (!sets.length) return { success: false, error: 'Nothing to update', statusCode: 400 };
        const r = await pool.query(
            `UPDATE client_tags SET ${sets.join(', ')} WHERE id = $1 RETURNING id, name, color_hex`,
            [tagId, ...vals]
        );
        if (!r.rows.length) return { success: false, error: 'Tag not found', statusCode: 404 };
        return { success: true, tag: r.rows[0] };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handleDeleteCoachTag(tagId) {
    try {
        await pool.query('DELETE FROM client_tags WHERE id = $1', [tagId]);
        return { success: true };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handlePostCoachTagAssignments(body) {
    const { coach_id, user_id, tag_ids } = body;
    if (!coach_id || !user_id || !Array.isArray(tag_ids)) return { success: false, error: 'coach_id, user_id, tag_ids[] are required', statusCode: 400 };
    try {
        for (const tid of tag_ids) {
            await pool.query(
                `INSERT INTO client_tag_assignments (tag_id, user_id, coach_id)
                 VALUES ($1, $2, $3) ON CONFLICT (tag_id, user_id) DO NOTHING`,
                [tid, user_id, coach_id]
            );
        }
        return { success: true };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handleDeleteCoachTagAssignment(query) {
    const { tag_id, user_id } = query;
    if (!tag_id || !user_id) return { success: false, error: 'tag_id and user_id are required', statusCode: 400 };
    try {
        await pool.query('DELETE FROM client_tag_assignments WHERE tag_id = $1 AND user_id = $2', [tag_id, user_id]);
        return { success: true };
    } catch (err) { return { success: false, error: err.message }; }
}

// ── Phase 1: Pipeline ─────────────────────────────────────────────────────────

async function handleGetClientPipeline(coachId) {
    if (!coachId) return { success: false, error: 'coach_id is required', statusCode: 400 };
    try {
        const r = await pool.query(
            `SELECT cps.user_id, cps.stage, cps.stage_changed_at, cps.note,
                    u.nickname, u.avatar_url,
                    b.bio_age, b.tested_at AS last_scan_at
             FROM client_pipeline_stages cps
             JOIN users u ON u.user_id = cps.user_id
             LEFT JOIN (
                 SELECT DISTINCT ON (user_id) user_id, bio_age, tested_at
                 FROM biomarkers WHERE test_type = 'kino_chip'
                 ORDER BY user_id, tested_at DESC
             ) b ON b.user_id = cps.user_id
             WHERE cps.coach_id = $1
             ORDER BY cps.stage_changed_at DESC`,
            [coachId]
        );
        return { success: true, pipeline: r.rows };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handlePostClientPipeline(body) {
    const { coach_id, user_id, stage, note } = body;
    if (!coach_id || !user_id || !stage) return { success: false, error: 'coach_id, user_id, stage are required', statusCode: 400 };
    const validStages = ['lead', 'onboarding', 'active', 'at_risk', 'churned', 'graduated'];
    if (!validStages.includes(stage)) return { success: false, error: `stage must be one of: ${validStages.join(', ')}`, statusCode: 400 };
    try {
        const r = await pool.query(
            `INSERT INTO client_pipeline_stages (coach_id, user_id, stage, note, stage_changed_at)
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT (coach_id, user_id) DO UPDATE
             SET stage = EXCLUDED.stage, note = EXCLUDED.note, stage_changed_at = NOW()
             RETURNING id, stage, stage_changed_at`,
            [coach_id, user_id, stage, note || null]
        );
        logActivity(coach_id, user_id, 'stage_changed', { stage, note });
        return { success: true, pipeline: r.rows[0] };
    } catch (err) { return { success: false, error: err.message }; }
}

// ── Phase 1: Notes ────────────────────────────────────────────────────────────

async function handleGetCoachNotes(query) {
    const { coach_id, user_id, limit = 50, before } = query;
    if (!coach_id || !user_id) return { success: false, error: 'coach_id and user_id are required', statusCode: 400 };
    try {
        const params = [coach_id, user_id, parseInt(limit, 10)];
        let timeCond = '';
        if (before) { timeCond = `AND created_at < $${params.length + 1}`; params.push(before); }
        const r = await pool.query(
            `SELECT id, content, is_pinned, created_at, updated_at
             FROM coach_client_notes
             WHERE coach_id = $1 AND user_id = $2 ${timeCond}
             ORDER BY is_pinned DESC, created_at DESC
             LIMIT $3`,
            params
        );
        return { success: true, notes: r.rows };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handlePostCoachNote(body) {
    const { coach_id, user_id, content, is_pinned } = body;
    if (!coach_id || !user_id || !content) return { success: false, error: 'coach_id, user_id, content are required', statusCode: 400 };
    try {
        const r = await pool.query(
            `INSERT INTO coach_client_notes (coach_id, user_id, content, is_pinned)
             VALUES ($1, $2, $3, $4) RETURNING id, content, is_pinned, created_at`,
            [coach_id, user_id, content, is_pinned || false]
        );
        logActivity(coach_id, user_id, 'note_added', { note_id: r.rows[0].id });
        return { success: true, note: r.rows[0] };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handlePutCoachNote(noteId, body) {
    const { content, is_pinned } = body;
    try {
        const r = await pool.query(
            `UPDATE coach_client_notes
             SET content = COALESCE($2, content),
                 is_pinned = COALESCE($3, is_pinned),
                 updated_at = NOW()
             WHERE id = $1
             RETURNING id, content, is_pinned, updated_at`,
            [noteId, content || null, is_pinned !== undefined ? is_pinned : null]
        );
        if (!r.rows.length) return { success: false, error: 'Note not found', statusCode: 404 };
        return { success: true, note: r.rows[0] };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handleDeleteCoachNote(noteId) {
    try {
        await pool.query('DELETE FROM coach_client_notes WHERE id = $1', [noteId]);
        return { success: true };
    } catch (err) { return { success: false, error: err.message }; }
}

// ── Phase 1: Activity Feed ────────────────────────────────────────────────────

async function handleGetClientActivity(query) {
    const { coach_id, user_id, limit = 50, before } = query;
    if (!coach_id || !user_id) return { success: false, error: 'coach_id and user_id are required', statusCode: 400 };
    try {
        const params = [coach_id, user_id, parseInt(limit, 10)];
        let timeCond = '';
        if (before) { timeCond = `AND occurred_at < $${params.length + 1}`; params.push(before); }
        const r = await pool.query(
            `SELECT id, activity_type, metadata, occurred_at
             FROM client_activity_log
             WHERE coach_id = $1 AND user_id = $2 ${timeCond}
             ORDER BY occurred_at DESC
             LIMIT $3`,
            params
        );
        return { success: true, activities: r.rows };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handleGetCoachActivityFeed(coachId, limit) {
    if (!coachId) return { success: false, error: 'coach_id is required', statusCode: 400 };
    try {
        const r = await pool.query(
            `SELECT cal.id, cal.user_id, cal.activity_type, cal.metadata, cal.occurred_at,
                    u.nickname, u.avatar_url
             FROM client_activity_log cal
             JOIN users u ON u.user_id = cal.user_id
             WHERE cal.coach_id = $1
             ORDER BY cal.occurred_at DESC
             LIMIT $2`,
            [coachId, parseInt(limit, 10) || 30]
        );
        return { success: true, activities: r.rows };
    } catch (err) { return { success: false, error: err.message }; }
}

// ── Phase 2: Message Templates ────────────────────────────────────────────────

async function handleGetMessageTemplates(query) {
    const { coach_id, channel_id, category } = query;
    try {
        const conditions = ['is_active = true'];
        const params = [];
        if (coach_id) { conditions.push(`(coach_id = $${params.length + 1} OR coach_id IS NULL)`); params.push(coach_id); }
        if (channel_id) { conditions.push(`(channel_id = $${params.length + 1} OR channel_id IS NULL)`); params.push(channel_id); }
        if (category) { conditions.push(`category = $${params.length + 1}`); params.push(category); }
        const r = await pool.query(
            `SELECT id, coach_id, channel_id, title, content_zh, content_en, category, variables, use_count, created_at
             FROM message_templates
             WHERE ${conditions.join(' AND ')}
             ORDER BY use_count DESC, created_at DESC`,
            params
        );
        return { success: true, templates: r.rows };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handlePostMessageTemplate(body) {
    const { coach_id, channel_id, title, content_zh, content_en, category, variables } = body;
    if (!title || !content_zh) return { success: false, error: 'title and content_zh are required', statusCode: 400 };
    try {
        const r = await pool.query(
            `INSERT INTO message_templates (coach_id, channel_id, title, content_zh, content_en, category, variables)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id, title, category`,
            [coach_id || null, channel_id || null, title, content_zh, content_en || null, category || 'general', variables || []]
        );
        return { success: true, template: r.rows[0] };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handlePutMessageTemplate(id, body) {
    const { title, content_zh, content_en, category, variables, is_active } = body;
    try {
        const r = await pool.query(
            `UPDATE message_templates
             SET title = COALESCE($2, title),
                 content_zh = COALESCE($3, content_zh),
                 content_en = COALESCE($4, content_en),
                 category = COALESCE($5, category),
                 variables = COALESCE($6, variables),
                 is_active = COALESCE($7, is_active)
             WHERE id = $1
             RETURNING id, title, category, is_active`,
            [id, title || null, content_zh || null, content_en || null, category || null,
             variables ? JSON.stringify(variables) : null, is_active !== undefined ? is_active : null]
        );
        if (!r.rows.length) return { success: false, error: 'Template not found', statusCode: 404 };
        return { success: true, template: r.rows[0] };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handleDeleteMessageTemplate(id) {
    try {
        await pool.query('UPDATE message_templates SET is_active = false WHERE id = $1', [id]);
        return { success: true };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handlePostMessageTemplatePreview(id, body) {
    const { user_id, lang } = body;
    try {
        const tpl = await pool.query('SELECT content_zh, content_en, variables FROM message_templates WHERE id = $1', [id]);
        if (!tpl.rows.length) return { success: false, error: 'Template not found', statusCode: 404 };
        const { content_zh, content_en } = tpl.rows[0];
        let vars = { name: '用户', bio_age: '--', plan_name: '--', days_left: '--' };
        if (user_id) {
            const u = await pool.query(
                `SELECT u.nickname, ht.latest_bio_age, hp.start_date, hp.target_end_date,
                        hpt.name_zh AS plan_name_zh, hpt.name_en AS plan_name_en
                 FROM users u
                 LEFT JOIN health_twin ht ON ht.user_id = u.user_id
                 LEFT JOIN health_plans hp ON hp.user_id = u.user_id AND hp.status = 'active'
                 LEFT JOIN health_plan_templates hpt ON hpt.id = hp.template_id
                 WHERE u.user_id = $1 LIMIT 1`,
                [user_id]
            );
            if (u.rows.length) {
                const row = u.rows[0];
                vars.name = row.nickname || vars.name;
                vars.bio_age = row.latest_bio_age ? row.latest_bio_age.toFixed(1) : '--';
                vars.plan_name = (lang === 'en' ? row.plan_name_en : row.plan_name_zh) || '--';
                if (row.target_end_date) {
                    const daysLeft = Math.ceil((new Date(row.target_end_date) - new Date()) / 86400000);
                    vars.days_left = daysLeft > 0 ? String(daysLeft) : '0';
                }
            }
        }
        const substitute = (str) => str ? str.replace(/\{(\w+)\}/g, (_, k) => vars[k] || `{${k}}`) : null;
        return { success: true, rendered_zh: substitute(content_zh), rendered_en: substitute(content_en) };
    } catch (err) { return { success: false, error: err.message }; }
}

// ── Phase 2: Bulk Campaigns ───────────────────────────────────────────────────

async function resolveBulkRecipients(coachId, filter) {
    const conditions = [`u.coach_id = (SELECT id FROM coaches WHERE id = $1)`];
    const params = [coachId];
    if (filter.stage && filter.stage.length) {
        conditions.push(`cps.stage = ANY($${params.length + 1}::text[])`);
        params.push(filter.stage);
    }
    if (filter.tag_ids && filter.tag_ids.length) {
        conditions.push(`cta.tag_id = ANY($${params.length + 1}::int[])`);
        params.push(filter.tag_ids);
    }
    if (filter.has_scanned === true) {
        conditions.push(`b.user_id IS NOT NULL`);
    }
    const r = await pool.query(
        `SELECT DISTINCT u.user_id, u.nickname, u.language
         FROM users u
         JOIN coaches c ON c.id = u.coach_id AND c.id = $1
         LEFT JOIN client_pipeline_stages cps ON cps.user_id = u.user_id AND cps.coach_id = $1
         LEFT JOIN client_tag_assignments cta ON cta.user_id = u.user_id AND cta.coach_id = $1
         LEFT JOIN (SELECT DISTINCT user_id FROM biomarkers WHERE test_type = 'kino_chip') b ON b.user_id = u.user_id
         WHERE ${conditions.join(' AND ')}`,
        params
    );
    return r.rows;
}

async function handlePostBulkCampaign(body) {
    const { coach_id, title, content, target_filter, template_id, scheduled_at } = body;
    if (!coach_id || !title || !content) return { success: false, error: 'coach_id, title, content are required', statusCode: 400 };
    try {
        const recipients = await resolveBulkRecipients(coach_id, target_filter || {});
        const r = await pool.query(
            `INSERT INTO bulk_message_campaigns (coach_id, template_id, title, content, target_filter, recipient_count, scheduled_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, title, recipient_count, status`,
            [coach_id, template_id || null, title, content, JSON.stringify(target_filter || {}), recipients.length, scheduled_at || null]
        );
        const campaignId = r.rows[0].id;
        if (recipients.length) {
            const values = recipients.map((_, i) => `($1, $${i * 2 + 2}, $${i * 2 + 3})`).join(', ');
            const flatArgs = [campaignId];
            recipients.forEach(rec => { flatArgs.push(rec.user_id); flatArgs.push(null); });
            await pool.query(
                `INSERT INTO bulk_message_recipients (campaign_id, user_id, personalized) VALUES ${values}`,
                flatArgs
            );
        }
        return { success: true, campaign: r.rows[0] };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handlePostBulkCampaignSend(id) {
    try {
        const camp = await pool.query('SELECT * FROM bulk_message_campaigns WHERE id = $1', [id]);
        if (!camp.rows.length) return { success: false, error: 'Campaign not found', statusCode: 404 };
        if (camp.rows[0].status === 'sent') return { success: false, error: 'Already sent', statusCode: 400 };
        await pool.query(`UPDATE bulk_message_campaigns SET status = 'sending' WHERE id = $1`, [id]);
        const { coach_id, content } = camp.rows[0];
        const recipients = await pool.query(
            `SELECT user_id FROM bulk_message_recipients WHERE campaign_id = $1 AND status = 'pending'`,
            [id]
        );
        setImmediate(async () => {
            let sent = 0;
            const batchSize = 50;
            const users = recipients.rows;
            for (let i = 0; i < users.length; i += batchSize) {
                const batch = users.slice(i, i + batchSize);
                for (const { user_id } of batch) {
                    try {
                        await pool.query(
                            `INSERT INTO chat_messages (user_id, role, content) VALUES ($1, $2, $3)`,
                            [user_id, 'coach', content]
                        );
                        await pool.query(
                            `UPDATE bulk_message_recipients SET status = 'sent', sent_at = NOW() WHERE campaign_id = $1 AND user_id = $2`,
                            [id, user_id]
                        );
                        logActivity(coach_id, user_id, 'bulk_message_sent', { campaign_id: id });
                        sent++;
                    } catch (e) {
                        await pool.query(
                            `UPDATE bulk_message_recipients SET status = 'failed' WHERE campaign_id = $1 AND user_id = $2`,
                            [id, user_id]
                        ).catch(() => {});
                    }
                }
                if (i + batchSize < users.length) await new Promise(r => setTimeout(r, 100));
            }
            await pool.query(
                `UPDATE bulk_message_campaigns SET status = 'sent', sent_at = NOW(), sent_count = $2 WHERE id = $1`,
                [id, sent]
            ).catch(() => {});
        });
        return { success: true, message: 'Sending in progress', recipient_count: recipients.rows.length };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handleGetBulkCampaigns(coachId) {
    if (!coachId) return { success: false, error: 'coach_id is required', statusCode: 400 };
    try {
        const r = await pool.query(
            `SELECT id, title, recipient_count, sent_count, status, scheduled_at, sent_at, created_at
             FROM bulk_message_campaigns WHERE coach_id = $1 ORDER BY created_at DESC`,
            [coachId]
        );
        return { success: true, campaigns: r.rows };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handleGetBulkCampaignRecipients(id) {
    try {
        const r = await pool.query(
            `SELECT bmr.user_id, bmr.status, bmr.sent_at, u.nickname, u.avatar_url
             FROM bulk_message_recipients bmr
             JOIN users u ON u.user_id = bmr.user_id
             WHERE bmr.campaign_id = $1
             ORDER BY bmr.status, u.nickname`,
            [id]
        );
        return { success: true, recipients: r.rows };
    } catch (err) { return { success: false, error: err.message }; }
}

// ── Phase 3: Appointments ─────────────────────────────────────────────────────

async function handleGetAppointments(query) {
    const { coach_id, user_id, status } = query;
    if (!coach_id) return { success: false, error: 'coach_id is required', statusCode: 400 };
    try {
        const conditions = ['a.coach_id = $1'];
        const params = [coach_id];
        if (user_id) { conditions.push(`a.user_id = $${params.length + 1}`); params.push(user_id); }
        if (status) { conditions.push(`a.status = $${params.length + 1}`); params.push(status); }
        const r = await pool.query(
            `SELECT a.id, a.user_id, a.title, a.scheduled_at, a.duration_min, a.format,
                    a.status, a.coach_notes, a.meeting_link, a.created_at,
                    u.nickname, u.avatar_url
             FROM appointments a
             JOIN users u ON u.user_id = a.user_id
             WHERE ${conditions.join(' AND ')}
             ORDER BY a.scheduled_at DESC`,
            params
        );
        return { success: true, appointments: r.rows };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handlePostAppointment(body) {
    const { coach_id, user_id, title, scheduled_at, duration_min, format, meeting_link, coach_notes } = body;
    if (!coach_id || !user_id || !title || !scheduled_at) return { success: false, error: 'coach_id, user_id, title, scheduled_at are required', statusCode: 400 };
    try {
        const r = await pool.query(
            `INSERT INTO appointments (coach_id, user_id, title, scheduled_at, duration_min, format, meeting_link, coach_notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id, title, scheduled_at, format, status`,
            [coach_id, user_id, title, scheduled_at, duration_min || 30, format || 'video', meeting_link || null, coach_notes || null]
        );
        const apptId = r.rows[0].id;
        await pool.query(
            `INSERT INTO reminders (user_id, coach_id, content, scheduled_for)
             VALUES ($1, $2, $3, $4)`,
            [user_id, coach_id, `预约提醒: ${title}`, scheduled_at]
        );
        logActivity(coach_id, user_id, 'appointment_scheduled', { appointment_id: apptId, title, scheduled_at });
        return { success: true, appointment: r.rows[0] };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handlePutAppointment(id, body) {
    const { status, coach_notes, meeting_link, scheduled_at } = body;
    try {
        const r = await pool.query(
            `UPDATE appointments
             SET status = COALESCE($2, status),
                 coach_notes = COALESCE($3, coach_notes),
                 meeting_link = COALESCE($4, meeting_link),
                 scheduled_at = COALESCE($5, scheduled_at),
                 updated_at = NOW()
             WHERE id = $1
             RETURNING id, status, coach_notes, meeting_link, scheduled_at`,
            [id, status || null, coach_notes || null, meeting_link || null, scheduled_at || null]
        );
        if (!r.rows.length) return { success: false, error: 'Appointment not found', statusCode: 404 };
        if (status === 'completed') {
            const appt = await pool.query('SELECT coach_id, user_id FROM appointments WHERE id = $1', [id]);
            if (appt.rows.length) logActivity(appt.rows[0].coach_id, appt.rows[0].user_id, 'appointment_completed', { appointment_id: id });
        }
        return { success: true, appointment: r.rows[0] };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handleDeleteAppointment(id) {
    try {
        await pool.query(`UPDATE appointments SET status = 'cancelled', updated_at = NOW() WHERE id = $1`, [id]);
        return { success: true };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handleGetUpcomingAppointments(coachId) {
    if (!coachId) return { success: false, error: 'coach_id is required', statusCode: 400 };
    try {
        const r = await pool.query(
            `SELECT a.id, a.user_id, a.title, a.scheduled_at, a.duration_min, a.format, a.meeting_link,
                    u.nickname, u.avatar_url
             FROM appointments a
             JOIN users u ON u.user_id = a.user_id
             WHERE a.coach_id = $1
               AND a.status = 'scheduled'
               AND a.scheduled_at BETWEEN NOW() AND NOW() + INTERVAL '7 days'
             ORDER BY a.scheduled_at ASC
             LIMIT 20`,
            [coachId]
        );
        return { success: true, appointments: r.rows };
    } catch (err) { return { success: false, error: err.message }; }
}

// ── Phase 3: Goals ────────────────────────────────────────────────────────────

async function handleGetClientGoals(query) {
    const { coach_id, user_id, status } = query;
    if (!coach_id || !user_id) return { success: false, error: 'coach_id and user_id are required', statusCode: 400 };
    try {
        const conditions = ['coach_id = $1', 'user_id = $2'];
        const params = [coach_id, user_id];
        if (status) { conditions.push(`status = $${params.length + 1}`); params.push(status); }
        const r = await pool.query(
            `SELECT id, goal_type, title_zh, title_en, target_value, target_unit, target_sub_age,
                    baseline_value, current_value, target_date, status, achieved_at, created_at, updated_at
             FROM client_goals
             WHERE ${conditions.join(' AND ')}
             ORDER BY status ASC, target_date ASC NULLS LAST`,
            params
        );
        return { success: true, goals: r.rows };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handlePostClientGoal(body) {
    const { coach_id, user_id, goal_type, title_zh, title_en, target_value, target_unit, target_sub_age, baseline_value, target_date } = body;
    if (!coach_id || !user_id || !goal_type || !title_zh) return { success: false, error: 'coach_id, user_id, goal_type, title_zh are required', statusCode: 400 };
    try {
        const r = await pool.query(
            `INSERT INTO client_goals (coach_id, user_id, goal_type, title_zh, title_en, target_value, target_unit,
                                       target_sub_age, baseline_value, current_value, target_date)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10)
             RETURNING id, goal_type, title_zh, status`,
            [coach_id, user_id, goal_type, title_zh, title_en || null, target_value || null, target_unit || null,
             target_sub_age || null, baseline_value || null, target_date || null]
        );
        logActivity(coach_id, user_id, 'goal_set', { goal_id: r.rows[0].id, goal_type, title_zh });
        return { success: true, goal: r.rows[0] };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handlePutClientGoal(id, body) {
    const { current_value, status, achieved_at, target_value, target_date, title_zh } = body;
    try {
        const r = await pool.query(
            `UPDATE client_goals
             SET current_value = COALESCE($2, current_value),
                 status = COALESCE($3, status),
                 achieved_at = COALESCE($4, achieved_at),
                 target_value = COALESCE($5, target_value),
                 target_date = COALESCE($6, target_date),
                 title_zh = COALESCE($7, title_zh),
                 updated_at = NOW()
             WHERE id = $1
             RETURNING id, goal_type, title_zh, current_value, status, achieved_at`,
            [id, current_value !== undefined ? current_value : null, status || null,
             achieved_at || null, target_value || null, target_date || null, title_zh || null]
        );
        if (!r.rows.length) return { success: false, error: 'Goal not found', statusCode: 404 };
        if (status === 'achieved') {
            const g = await pool.query('SELECT coach_id, user_id FROM client_goals WHERE id = $1', [id]);
            if (g.rows.length) logActivity(g.rows[0].coach_id, g.rows[0].user_id, 'goal_achieved', { goal_id: id });
        }
        return { success: true, goal: r.rows[0] };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handleDeleteClientGoal(id) {
    try {
        await pool.query(`UPDATE client_goals SET status = 'cancelled', updated_at = NOW() WHERE id = $1`, [id]);
        return { success: true };
    } catch (err) { return { success: false, error: err.message }; }
}

async function refreshGoalProgress(userId) {
    if (!pool) return;
    try {
        const twin = await pool.query(
            `SELECT latest_bio_age, latest_sub_ages FROM health_twin WHERE user_id = $1`,
            [userId]
        );
        if (!twin.rows.length) return;
        const { latest_bio_age, latest_sub_ages } = twin.rows[0];
        const goals = await pool.query(
            `SELECT id, coach_id, goal_type, target_sub_age, target_value
             FROM client_goals WHERE user_id = $1 AND status = 'active'`,
            [userId]
        );
        for (const goal of goals.rows) {
            let currentVal = null;
            if (goal.goal_type === 'bio_age') currentVal = latest_bio_age;
            else if (goal.goal_type === 'sub_age' && goal.target_sub_age && latest_sub_ages) {
                currentVal = latest_sub_ages[goal.target_sub_age] || null;
            }
            if (currentVal === null) continue;
            const achieved = goal.target_value !== null && currentVal <= parseFloat(goal.target_value);
            await pool.query(
                `UPDATE client_goals SET current_value = $2, status = $3, achieved_at = $4, updated_at = NOW() WHERE id = $1`,
                [goal.id, currentVal, achieved ? 'achieved' : 'active', achieved ? new Date().toISOString() : null]
            );
            if (achieved) logActivity(goal.coach_id, userId, 'goal_achieved', { goal_id: goal.id });
        }
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'refresh_goal_progress_failed', data: { err: err.message, userId } }));
    }
}

// ── Phase 4: NPS Surveys ──────────────────────────────────────────────────────

async function handlePostNpsSurvey(body) {
    const { coach_id, user_id, survey_type, plan_id } = body;
    if (!coach_id || !user_id) return { success: false, error: 'coach_id and user_id are required', statusCode: 400 };
    try {
        const r = await pool.query(
            `INSERT INTO client_nps_surveys (coach_id, user_id, survey_type, plan_id)
             VALUES ($1, $2, $3, $4) RETURNING id, survey_type, sent_at, status`,
            [coach_id, user_id, survey_type || 'nps', plan_id || null]
        );
        logActivity(coach_id, user_id, 'nps_received', { survey_id: r.rows[0].id, survey_type: survey_type || 'nps' });
        return { success: true, survey: r.rows[0] };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handlePatchNpsSurvey(id, body) {
    const { score, feedback_text } = body;
    if (score === undefined) return { success: false, error: 'score is required', statusCode: 400 };
    try {
        const r = await pool.query(
            `UPDATE client_nps_surveys
             SET score = $2, feedback_text = $3, responded_at = NOW(), status = 'responded'
             WHERE id = $1
             RETURNING id, score, feedback_text, responded_at, status`,
            [id, score, feedback_text || null]
        );
        if (!r.rows.length) return { success: false, error: 'Survey not found', statusCode: 404 };
        return { success: true, survey: r.rows[0] };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handleGetNpsSurveys(query) {
    const { coach_id, period } = query;
    if (!coach_id) return { success: false, error: 'coach_id is required', statusCode: 400 };
    try {
        const conditions = ['n.coach_id = $1'];
        const params = [coach_id];
        if (period) {
            conditions.push(`TO_CHAR(n.sent_at, 'YYYY-MM') = $${params.length + 1}`);
            params.push(period);
        }
        const r = await pool.query(
            `SELECT n.id, n.user_id, n.survey_type, n.score, n.feedback_text,
                    n.sent_at, n.responded_at, n.status,
                    u.nickname, u.avatar_url
             FROM client_nps_surveys n
             JOIN users u ON u.user_id = n.user_id
             WHERE ${conditions.join(' AND ')}
             ORDER BY n.sent_at DESC`,
            params
        );
        const surveys = r.rows;
        const responded = surveys.filter(s => s.status === 'responded' && s.score !== null);
        const avg_score = responded.length ? (responded.reduce((a, s) => a + s.score, 0) / responded.length).toFixed(2) : null;
        const promoters = responded.filter(s => s.score >= 9).length;
        const passives = responded.filter(s => s.score >= 7 && s.score < 9).length;
        const detractors = responded.filter(s => s.score < 7).length;
        return { success: true, surveys, aggregate: { avg_score: avg_score ? parseFloat(avg_score) : null, promoters, passives, detractors, total: responded.length } };
    } catch (err) { return { success: false, error: err.message }; }
}

// ── Phase 4: Coach KPIs ───────────────────────────────────────────────────────

async function handleGetCoachKpis(query) {
    const { coach_id, period } = query;
    if (!coach_id) return { success: false, error: 'coach_id is required', statusCode: 400 };
    const targetPeriod = period || new Date().toISOString().slice(0, 7);
    try {
        const isCurrentMonth = targetPeriod === new Date().toISOString().slice(0, 7);
        if (!isCurrentMonth) {
            const snap = await pool.query(
                `SELECT * FROM coach_performance_snapshots WHERE coach_id = $1 AND period = $2`,
                [coach_id, targetPeriod]
            );
            if (snap.rows.length) return { success: true, kpis: snap.rows[0], source: 'snapshot' };
        }
        const [pipeline, scans, plans, msgs, appts, nps, commissions] = await Promise.all([
            pool.query(`SELECT stage, COUNT(*) AS cnt FROM client_pipeline_stages WHERE coach_id = $1 GROUP BY stage`, [coach_id]),
            pool.query(`SELECT COUNT(*) AS cnt FROM biomarkers b JOIN users u ON u.user_id = b.user_id WHERE u.coach_id = (SELECT id FROM coaches WHERE id = $1) AND b.test_type = 'kino_chip' AND TO_CHAR(b.tested_at, 'YYYY-MM') = $2`, [coach_id, targetPeriod]),
            pool.query(`SELECT COUNT(*) AS cnt FROM health_plans WHERE coach_id = $1 AND TO_CHAR(created_at, 'YYYY-MM') = $2`, [coach_id, targetPeriod]),
            pool.query(`SELECT COUNT(*) AS cnt FROM client_activity_log WHERE coach_id = $1 AND activity_type = 'message_sent' AND TO_CHAR(occurred_at, 'YYYY-MM') = $2`, [coach_id, targetPeriod]),
            pool.query(`SELECT COUNT(*) AS cnt FROM appointments WHERE coach_id = $1 AND status = 'completed' AND TO_CHAR(scheduled_at, 'YYYY-MM') = $2`, [coach_id, targetPeriod]),
            pool.query(`SELECT AVG(score) AS avg_score, COUNT(*) AS cnt FROM client_nps_surveys WHERE coach_id = $1 AND status = 'responded' AND TO_CHAR(sent_at, 'YYYY-MM') = $2`, [coach_id, targetPeriod]),
            pool.query(`SELECT COALESCE(SUM(amount_cny), 0) AS total FROM coach_commissions WHERE coach_id = $1 AND TO_CHAR(created_at, 'YYYY-MM') = $2`, [coach_id, targetPeriod]),
        ]);
        const stageMap = {};
        for (const row of pipeline.rows) stageMap[row.stage] = parseInt(row.cnt, 10);
        const totalClients = Object.values(stageMap).reduce((a, b) => a + b, 0);
        const kpis = {
            coach_id: parseInt(coach_id, 10),
            period: targetPeriod,
            total_clients: totalClients,
            active_clients: stageMap['active'] || 0,
            at_risk_count: stageMap['at_risk'] || 0,
            scans_facilitated: parseInt(scans.rows[0].cnt, 10),
            plans_assigned: parseInt(plans.rows[0].cnt, 10),
            messages_sent: parseInt(msgs.rows[0].cnt, 10),
            appointments_held: parseInt(appts.rows[0].cnt, 10),
            avg_nps_score: nps.rows[0].avg_score ? parseFloat(parseFloat(nps.rows[0].avg_score).toFixed(2)) : null,
            nps_response_count: parseInt(nps.rows[0].cnt, 10),
            commission_cny: parseFloat(commissions.rows[0].total),
        };
        return { success: true, kpis, source: 'live' };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handlePostCoachKpisCompute(body) {
    const { period } = body;
    if (!period) return { success: false, error: 'period (YYYY-MM) is required', statusCode: 400 };
    try {
        const coaches = await pool.query('SELECT id FROM coaches');
        let computed = 0;
        for (const { id: coachId } of coaches.rows) {
            const kpisResult = await handleGetCoachKpis({ coach_id: coachId, period });
            if (kpisResult.success) {
                const k = kpisResult.kpis;
                await pool.query(
                    `INSERT INTO coach_performance_snapshots
                         (coach_id, period, total_clients, active_clients, at_risk_count, scans_facilitated,
                          plans_assigned, messages_sent, appointments_held, avg_nps_score, nps_response_count, commission_cny)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
                     ON CONFLICT (coach_id, period) DO UPDATE SET
                         total_clients = EXCLUDED.total_clients, active_clients = EXCLUDED.active_clients,
                         at_risk_count = EXCLUDED.at_risk_count, scans_facilitated = EXCLUDED.scans_facilitated,
                         plans_assigned = EXCLUDED.plans_assigned, messages_sent = EXCLUDED.messages_sent,
                         appointments_held = EXCLUDED.appointments_held, avg_nps_score = EXCLUDED.avg_nps_score,
                         nps_response_count = EXCLUDED.nps_response_count, commission_cny = EXCLUDED.commission_cny,
                         computed_at = NOW()`,
                    [coachId, period, k.total_clients, k.active_clients, k.at_risk_count, k.scans_facilitated,
                     k.plans_assigned, k.messages_sent, k.appointments_held, k.avg_nps_score, k.nps_response_count, k.commission_cny]
                );
                computed++;
            }
        }
        return { success: true, computed };
    } catch (err) { return { success: false, error: err.message }; }
}

// ── Phase 5: Follow-Up Rules ──────────────────────────────────────────────────

async function handleGetFollowUpRules(coachId) {
    if (!coachId) return { success: false, error: 'coach_id is required', statusCode: 400 };
    try {
        const r = await pool.query(
            `SELECT id, rule_name, trigger_event, trigger_value, action_type, template_id, action_payload, is_active, last_run_at
             FROM follow_up_rules WHERE coach_id = $1 ORDER BY created_at DESC`,
            [coachId]
        );
        return { success: true, rules: r.rows };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handlePostFollowUpRule(body) {
    const { coach_id, rule_name, trigger_event, trigger_value, action_type, template_id, action_payload } = body;
    if (!coach_id || !rule_name || !trigger_event) return { success: false, error: 'coach_id, rule_name, trigger_event are required', statusCode: 400 };
    try {
        const r = await pool.query(
            `INSERT INTO follow_up_rules (coach_id, rule_name, trigger_event, trigger_value, action_type, template_id, action_payload)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, rule_name, trigger_event, is_active`,
            [coach_id, rule_name, trigger_event, trigger_value || null, action_type || 'send_reminder',
             template_id || null, JSON.stringify(action_payload || {})]
        );
        return { success: true, rule: r.rows[0] };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handlePutFollowUpRule(id, body) {
    const { rule_name, trigger_event, trigger_value, action_type, template_id, action_payload, is_active } = body;
    try {
        const r = await pool.query(
            `UPDATE follow_up_rules
             SET rule_name = COALESCE($2, rule_name),
                 trigger_event = COALESCE($3, trigger_event),
                 trigger_value = COALESCE($4, trigger_value),
                 action_type = COALESCE($5, action_type),
                 template_id = COALESCE($6, template_id),
                 action_payload = COALESCE($7, action_payload),
                 is_active = COALESCE($8, is_active)
             WHERE id = $1
             RETURNING id, rule_name, trigger_event, is_active`,
            [id, rule_name || null, trigger_event || null, trigger_value !== undefined ? trigger_value : null,
             action_type || null, template_id !== undefined ? template_id : null,
             action_payload ? JSON.stringify(action_payload) : null,
             is_active !== undefined ? is_active : null]
        );
        if (!r.rows.length) return { success: false, error: 'Rule not found', statusCode: 404 };
        return { success: true, rule: r.rows[0] };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handleDeleteFollowUpRule(id) {
    try {
        await pool.query('DELETE FROM follow_up_rules WHERE id = $1', [id]);
        return { success: true };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handlePostFollowUpRulesEvaluate() {
    try {
        const rules = await pool.query(`SELECT * FROM follow_up_rules WHERE is_active = true`);
        let fired = 0;
        for (const rule of rules.rows) {
            const { id: ruleId, coach_id, trigger_event, trigger_value, action_type, template_id, action_payload } = rule;
            let targetUsers = [];
            if (trigger_event === 'no_scan_days') {
                const days = trigger_value || 14;
                const r = await pool.query(
                    `SELECT u.user_id FROM users u
                     JOIN client_pipeline_stages cps ON cps.user_id = u.user_id AND cps.coach_id = $1
                     WHERE cps.stage IN ('active','onboarding')
                       AND (
                           u.last_scanned_at IS NULL
                           OR u.last_scanned_at < NOW() - ($2 || ' days')::INTERVAL
                       )`,
                    [coach_id, days]
                );
                targetUsers = r.rows;
            } else if (trigger_event === 'no_message_days') {
                const days = trigger_value || 7;
                const r = await pool.query(
                    `SELECT u.user_id FROM users u
                     JOIN client_pipeline_stages cps ON cps.user_id = u.user_id AND cps.coach_id = $1
                     WHERE cps.stage IN ('active','onboarding')
                       AND u.user_id NOT IN (
                           SELECT DISTINCT user_id FROM client_activity_log
                           WHERE coach_id = $1 AND activity_type = 'message_sent'
                             AND occurred_at > NOW() - ($2 || ' days')::INTERVAL
                       )`,
                    [coach_id, days]
                );
                targetUsers = r.rows;
            } else if (trigger_event === 'goal_deadline_approaching') {
                const days = trigger_value || 7;
                const r = await pool.query(
                    `SELECT DISTINCT user_id FROM client_goals
                     WHERE coach_id = $1 AND status = 'active'
                       AND target_date IS NOT NULL
                       AND target_date BETWEEN NOW() AND NOW() + ($2 || ' days')::INTERVAL`,
                    [coach_id, days]
                );
                targetUsers = r.rows;
            } else if (trigger_event === 'bio_age_increased') {
                const r = await pool.query(
                    `SELECT DISTINCT u.user_id
                     FROM users u
                     JOIN client_pipeline_stages cps ON cps.user_id = u.user_id AND cps.coach_id = $1
                     JOIN (
                         SELECT user_id, bio_age, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY tested_at DESC) AS rn
                         FROM biomarkers WHERE test_type = 'kino_chip'
                     ) latest ON latest.user_id = u.user_id AND latest.rn = 1
                     JOIN (
                         SELECT user_id, bio_age, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY tested_at DESC) AS rn
                         FROM biomarkers WHERE test_type = 'kino_chip'
                     ) prev ON prev.user_id = u.user_id AND prev.rn = 2
                     WHERE latest.bio_age > prev.bio_age + 2`,
                    [coach_id]
                );
                targetUsers = r.rows;
            }
            for (const { user_id } of targetUsers) {
                try {
                    if (action_type === 'send_reminder') {
                        let content = (action_payload && action_payload.content) || '您的教练为您发送了一条提醒';
                        if (template_id) {
                            const tpl = await pool.query('SELECT content_zh FROM message_templates WHERE id = $1', [template_id]);
                            if (tpl.rows.length) content = tpl.rows[0].content_zh;
                        }
                        await pool.query(
                            `INSERT INTO reminders (user_id, coach_id, content, scheduled_for)
                             VALUES ($1, $2, $3, NOW() + INTERVAL '1 hour')`,
                            [user_id, coach_id, content]
                        );
                    } else if (action_type === 'send_message') {
                        let content = (action_payload && action_payload.content) || '';
                        if (template_id) {
                            const tpl = await pool.query('SELECT content_zh FROM message_templates WHERE id = $1', [template_id]);
                            if (tpl.rows.length) content = tpl.rows[0].content_zh;
                        }
                        if (content) {
                            await pool.query(
                                `INSERT INTO chat_messages (user_id, role, content) VALUES ($1, $2, $3)`,
                                [user_id, 'coach', content]
                            );
                            logActivity(coach_id, user_id, 'message_sent', { rule_id: ruleId, auto: true });
                        }
                    } else if (action_type === 'change_stage') {
                        const newStage = (action_payload && action_payload.stage) || 'at_risk';
                        await pool.query(
                            `INSERT INTO client_pipeline_stages (coach_id, user_id, stage, stage_changed_at)
                             VALUES ($1, $2, $3, NOW())
                             ON CONFLICT (coach_id, user_id) DO UPDATE SET stage = EXCLUDED.stage, stage_changed_at = NOW()`,
                            [coach_id, user_id, newStage]
                        );
                        logActivity(coach_id, user_id, 'stage_changed', { stage: newStage, rule_id: ruleId, auto: true });
                    }
                    fired++;
                } catch (e) {
                    console.error(JSON.stringify({ level: 'ERROR', msg: 'follow_up_action_failed', data: { ruleId, user_id, err: e.message } }));
                }
            }
            await pool.query('UPDATE follow_up_rules SET last_run_at = NOW() WHERE id = $1', [ruleId]);
        }
        return { success: true, rules_evaluated: rules.rows.length, actions_fired: fired };
    } catch (err) { return { success: false, error: err.message }; }
}

// ─────────────────────────────────────────────────────────────────────────────

async function handleGetCoachUserChat(userId, coachId) {
    if (!userId) return { success: false, error: 'user_id is required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        if (coachId) {
            const check = await pool.query(
                'SELECT 1 FROM users WHERE user_id = $1 AND coach_id = $2',
                [userId, coachId]
            );
            if (check.rows.length === 0) return { success: false, error: 'Access denied', statusCode: 403 };
        }
        const result = await pool.query(
            `SELECT role, content, created_at FROM (
                SELECT role, content, created_at FROM chat_messages
                WHERE user_id = $1
                ORDER BY created_at DESC
                LIMIT 50
            ) sub ORDER BY created_at ASC`,
            [userId]
        );
        return { success: true, messages: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostAssignCoach(body) {
    const { user_id, coach_id } = body;
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        await pool.query('UPDATE users SET coach_id = $1 WHERE user_id = $2', [coach_id || null, user_id]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostCoaches(body) {
    const { channel_id, user_id } = body;
    if (!user_id) return { success: false, error: 'user_id is required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const result = await pool.query(
            'INSERT INTO coaches (user_id, channel_id) VALUES ($1, $2) RETURNING id',
            [user_id, channel_id || null]
        );
        await pool.query(
            `UPDATE users SET roles = array_append(roles, 'coach') WHERE user_id = $1 AND NOT ('coach' = ANY(roles))`,
            [user_id]
        );
        return { success: true, id: result.rows[0].id };
    } catch (err) {
        return { success: false, error: err.detail || err.message };
    }
}

async function handlePutCoach(coachId, body) {
    const { channel_id, user_id } = body;
    if (!user_id) return { success: false, error: 'user_id is required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const oldResult = await pool.query('SELECT user_id FROM coaches WHERE id = $1', [coachId]);
        const oldUserId = oldResult.rows[0]?.user_id;
        await pool.query(
            'UPDATE coaches SET user_id=$1, channel_id=$2 WHERE id=$3',
            [user_id, channel_id || null, coachId]
        );
        await pool.query(
            `UPDATE users SET roles = array_append(roles, 'coach') WHERE user_id = $1 AND NOT ('coach' = ANY(roles))`,
            [user_id]
        );
        if (oldUserId && oldUserId !== user_id) {
            const stillCoach = await pool.query('SELECT id FROM coaches WHERE user_id = $1', [oldUserId]);
            if (stillCoach.rows.length === 0) {
                await pool.query(
                    `UPDATE users SET roles = array_remove(roles, 'coach') WHERE user_id = $1`,
                    [oldUserId]
                );
            }
        }
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleDeleteCoach(coachId) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const coachRow = await pool.query('SELECT user_id FROM coaches WHERE id = $1', [coachId]);
        if (!coachRow.rows.length) return { success: false, statusCode: 404, error: 'Coach not found' };
        const userId = coachRow.rows[0].user_id;
        const assigned = await pool.query('SELECT COUNT(*) FROM users WHERE coach_id = $1', [coachId]);
        if (parseInt(assigned.rows[0].count) > 0) {
            return { success: false, statusCode: 409, error: `Cannot delete coach: ${assigned.rows[0].count} user(s) are still assigned.` };
        }
        await pool.query('DELETE FROM coaches WHERE id = $1', [coachId]);
        if (userId) {
            await pool.query(
                `UPDATE users SET roles = array_remove(roles, 'coach') WHERE user_id = $1`,
                [userId]
            );
        }
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostDots(body) {
    const { key_name, name, name_zh, color, color_zh, color_hex, group_name, group_name_zh, sub_age_target, sub_age_target_zh, timing, ingredients_summary, description, is_isolate, ingredients, ingredients_zh } = body;
    if (!key_name || !name) return { success: false, error: 'key_name and name are required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const maxIdResult = await pool.query('SELECT MAX(id) as max_id FROM dots');
        const nextId = (maxIdResult.rows[0].max_id || 0) + 1;

        const result = await pool.query(
            `INSERT INTO dots (id, key_name, name, name_zh, color, color_zh, color_hex, group_name, group_name_zh, sub_age_target, sub_age_target_zh, timing, ingredients_summary, description, is_isolate, ingredients, ingredients_zh)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
            [nextId, key_name, name, name_zh || null, color || null, color_zh || null, color_hex || null,
             group_name || null, group_name_zh || null, sub_age_target || null, sub_age_target_zh || null,
             timing || null, ingredients_summary || null, description || null, !!is_isolate,
             ingredients ? JSON.stringify(ingredients) : null,
             ingredients_zh ? JSON.stringify(ingredients_zh) : null]
        );
        return { success: true, id: result.rows[0].id };
    } catch (err) {
        return { success: false, error: err.detail || err.message };
    }
}

async function handlePutDot(dotId, body) {
    const { name, name_zh, color, color_zh, color_hex, group_name, group_name_zh, sub_age_target, sub_age_target_zh, timing, ingredients_summary, description, is_isolate, ingredients, ingredients_zh } = body;
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        await pool.query(
            `UPDATE dots SET name=$1, name_zh=$2, color=$3, color_zh=$4, color_hex=$5, group_name=$6, group_name_zh=$7,
             sub_age_target=$8, sub_age_target_zh=$9, timing=$10, ingredients_summary=$11,
             description=$12, is_isolate=$13, ingredients=$14, ingredients_zh=$15 WHERE id=$16`,
            [name, name_zh || null, color || null, color_zh || null, color_hex || null,
             group_name || null, group_name_zh || null, sub_age_target || null, sub_age_target_zh || null,
             timing || null, ingredients_summary || null, description || null, !!is_isolate,
             ingredients ? JSON.stringify(ingredients) : null,
             ingredients_zh ? JSON.stringify(ingredients_zh) : null,
             dotId]
        );
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}


async function handleDeleteDot(dotId) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        await pool.query('DELETE FROM dots WHERE id = $1', [dotId]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function verifySubchannelOwnership(channelId, adminCtx) {
    if (adminCtx?.role !== 'channel') return true;
    if (!adminCtx.canManageSubchannels) return false;
    const r = await pool.query('SELECT id FROM channels WHERE id = $1 AND parent_channel_id = $2', [channelId, adminCtx.channelId]);
    return r.rows.length > 0;
}

async function handleGetChannels(adminCtx) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        if (adminCtx?.role === 'channel' && adminCtx.canManageSubchannels) {
            const result = await pool.query(`
                SELECT c.id, c.key_name, c.name, c.logo_url, c.config, c.created_at, c.parent_channel_id, c.can_manage_subchannels,
                       COUNT(DISTINCT u.user_id) AS user_count,
                       COUNT(DISTINCT p.id) AS coach_count
                FROM channels c
                LEFT JOIN users u ON u.channel_id = c.id
                LEFT JOIN coaches p ON p.channel_id = c.id
                WHERE c.parent_channel_id = $1
                GROUP BY c.id
                ORDER BY c.id
            `, [adminCtx.channelId]);
            return { success: true, channels: result.rows };
        }
        const result = await pool.query(`
            SELECT c.id, c.key_name, c.name, c.logo_url, c.config, c.created_at, c.parent_channel_id, c.can_manage_subchannels,
                   COUNT(DISTINCT u.user_id) AS user_count,
                   COUNT(DISTINCT p.id) AS coach_count
            FROM channels c
            LEFT JOIN users u ON u.channel_id = c.id
            LEFT JOIN coaches p ON p.channel_id = c.id
            GROUP BY c.id
            ORDER BY c.id
        `);
        return { success: true, channels: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostChannel(body, adminCtx) {
    const isCmsAdmin = adminCtx?.role === 'channel' && adminCtx?.canManageSubchannels;
    if (adminCtx?.role === 'channel' && !isCmsAdmin) return { statusCode: 403, success: false, error: 'Forbidden' };
    const { key_name, name, logo_url, parent_channel_id } = body;
    if (!key_name) return { success: false, error: 'key_name is required', statusCode: 400 };
    if (!name)     return { success: false, error: 'name is required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        let parentChannelId = null;
        if (isCmsAdmin) {
            const parentCheck = await pool.query('SELECT parent_channel_id FROM channels WHERE id = $1', [adminCtx.channelId]);
            if (parentCheck.rows[0]?.parent_channel_id != null) {
                return { statusCode: 403, success: false, error: 'Cannot create sub-channels beyond 2 levels' };
            }
            parentChannelId = adminCtx.channelId;
        } else if (parent_channel_id) {
            parentChannelId = parseInt(parent_channel_id);
        }
        const result = await pool.query(
            `INSERT INTO channels (key_name, name, logo_url, parent_channel_id) VALUES ($1, $2, $3, $4) RETURNING id`,
            [key_name, name, logo_url || null, parentChannelId]
        );
        return { success: true, id: result.rows[0].id };
    } catch (err) {
        return { success: false, error: err.detail || err.message };
    }
}

async function handlePutChannel(channelId, body, adminCtx) {
    if (adminCtx?.role === 'channel') {
        if (!adminCtx.canManageSubchannels) return { statusCode: 403, success: false, error: 'Forbidden' };
        const owns = await verifySubchannelOwnership(channelId, adminCtx);
        if (!owns) return { statusCode: 403, success: false, error: 'Forbidden' };
    }
    const { name, logo_url, commission_config } = body;
    if (!name) return { success: false, error: 'name is required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        await pool.query(
            `UPDATE channels SET name=$1, logo_url=$2, commission_config=$3 WHERE id=$4`,
            [name, logo_url || null, commission_config ? JSON.stringify(commission_config) : null, channelId]
        );
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleDeleteChannel(channelId, adminCtx) {
    if (adminCtx?.role === 'channel') {
        if (!adminCtx.canManageSubchannels) return { statusCode: 403, success: false, error: 'Forbidden' };
        const owns = await verifySubchannelOwnership(channelId, adminCtx);
        if (!owns) return { statusCode: 403, success: false, error: 'Forbidden' };
    }
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        await pool.query('DELETE FROM channels WHERE id = $1', [channelId]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePutChannelManageSubchannels(channelId, body, adminCtx) {
    if (adminCtx?.role === 'channel') return { statusCode: 403, success: false, error: 'Forbidden' };
    const { can_manage_subchannels } = body || {};
    if (typeof can_manage_subchannels !== 'boolean') return { statusCode: 400, success: false, error: 'can_manage_subchannels must be a boolean' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        await pool.query('UPDATE channels SET can_manage_subchannels = $1 WHERE id = $2', [can_manage_subchannels, channelId]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePutChannelAdminTabs(channelId, body, adminCtx) {
    if (adminCtx?.role === 'channel') {
        if (!adminCtx.canManageSubchannels) return { statusCode: 403, success: false, error: 'Forbidden' };
        const owns = await verifySubchannelOwnership(channelId, adminCtx);
        if (!owns) return { statusCode: 403, success: false, error: 'Forbidden' };
    }
    const { tabs } = body || {};
    if (!Array.isArray(tabs)) return { statusCode: 400, success: false, error: 'tabs must be an array' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        await pool.query(
            `UPDATE channels SET config = jsonb_set(COALESCE(config, '{}'), '{admin_tabs}', $1::jsonb) WHERE id = $2`,
            [JSON.stringify(tabs), channelId]
        );
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePutChannelSubAgeLabels(channelId, body, adminCtx) {
    if (adminCtx?.role === 'channel') {
        if (!adminCtx.canManageSubchannels) return { statusCode: 403, success: false, error: 'Forbidden' };
        const owns = await verifySubchannelOwnership(channelId, adminCtx);
        if (!owns) return { statusCode: 403, success: false, error: 'Forbidden' };
    }
    const { sub_age_display_names } = body || {};
    if (!sub_age_display_names || typeof sub_age_display_names !== 'object')
        return { statusCode: 400, success: false, error: 'sub_age_display_names must be an object' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        await pool.query(
            `UPDATE channels SET config = jsonb_set(COALESCE(config, '{}'), '{sub_age_display_names}', $1::jsonb) WHERE id = $2`,
            [JSON.stringify(sub_age_display_names), channelId]
        );
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostUsers(body) {
    const { openid, external_id: extId, external_app, nickname, phone, email, gender, birth_date, language, coach_id, channel_id } = body;
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const newUserId = generateUserId();
        const external_id = extId || openid || null;
        const result = await pool.query(
            `INSERT INTO users (user_id, external_id, external_app, nickname, phone, email, gender, birth_date, language, coach_id, channel_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING user_id`,
            [newUserId, external_id, external_app || null, nickname || null, phone || null, email || null, gender || null, birth_date || null, language || 'zh', coach_id || null, channel_id || null]
        );
        return { success: true, user_id: result.rows[0].user_id };
    } catch (err) {
        return { success: false, error: err.detail || err.message };
    }
}

async function handlePutUser(user_id, body) {
    const { nickname, phone, email, gender, birth_date, language, coach_id, channel_id, bio_data, roles, avatar_url } = body;
    // channel_id uses COALESCE so a missing/null value in the request never overwrites an existing assignment
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        if (bio_data && roles) {
            await pool.query(
                `UPDATE users SET nickname=$1, phone=$2, email=$3, gender=$4, birth_date=$5, language=$6, coach_id=$7, channel_id=COALESCE($8, channel_id), bio_data = bio_data || $9, roles=$10, avatar_url=COALESCE($11, avatar_url) WHERE user_id=$12`,
                [nickname || null, phone || null, email || null, gender || null, birth_date || null, language || 'zh', coach_id || null, channel_id || null, JSON.stringify(bio_data), roles, avatar_url || null, user_id]
            );
        } else if (bio_data) {
            await pool.query(
                `UPDATE users SET nickname=$1, phone=$2, email=$3, gender=$4, birth_date=$5, language=$6, coach_id=$7, channel_id=COALESCE($8, channel_id), bio_data = bio_data || $9, avatar_url=COALESCE($10, avatar_url) WHERE user_id=$11`,
                [nickname || null, phone || null, email || null, gender || null, birth_date || null, language || 'zh', coach_id || null, channel_id || null, JSON.stringify(bio_data), avatar_url || null, user_id]
            );
        } else if (roles) {
            await pool.query(
                `UPDATE users SET nickname=$1, phone=$2, email=$3, gender=$4, birth_date=$5, language=$6, coach_id=$7, channel_id=COALESCE($8, channel_id), roles=$9, avatar_url=COALESCE($10, avatar_url) WHERE user_id=$11`,
                [nickname || null, phone || null, email || null, gender || null, birth_date || null, language || 'zh', coach_id || null, channel_id || null, roles, avatar_url || null, user_id]
            );
        } else {
            await pool.query(
                `UPDATE users SET nickname=$1, phone=$2, email=$3, gender=$4, birth_date=$5, language=$6, coach_id=$7, channel_id=COALESCE($8, channel_id), avatar_url=COALESCE($9, avatar_url) WHERE user_id=$10`,
                [nickname || null, phone || null, email || null, gender || null, birth_date || null, language || 'zh', coach_id || null, channel_id || null, avatar_url || null, user_id]
            );
        }
        // Sync coaches table when roles change
        if (roles) {
            if (roles.includes('coach')) {
                await pool.query(
                    `INSERT INTO coaches (user_id, channel_id)
                     SELECT $1, COALESCE($2, u.channel_id) FROM users u WHERE u.user_id = $1
                     AND NOT EXISTS (SELECT 1 FROM coaches WHERE user_id = $1)`,
                    [user_id, channel_id || null]
                );
            } else {
                // Block removal if coach still has assigned users
                const coachRow = await pool.query('SELECT id FROM coaches WHERE user_id = $1', [user_id]);
                if (coachRow.rows.length > 0) {
                    const coachId = coachRow.rows[0].id;
                    const assigned = await pool.query('SELECT COUNT(*) FROM users WHERE coach_id = $1', [coachId]);
                    if (parseInt(assigned.rows[0].count) > 0) {
                        return { success: false, statusCode: 409, error: `Cannot remove coach role: ${assigned.rows[0].count} user(s) are still assigned to this coach.` };
                    }
                    await pool.query('DELETE FROM coaches WHERE id = $1', [coachId]);
                }
            }
        }
        return { success: true };
    } catch (err) {
        return { success: false, statusCode: 500, error: err.message };
    }
}

async function handleGetAdminAccounts(adminCtx) {
    if (adminCtx?.role === 'channel' && !adminCtx.canManageSubchannels) return { statusCode: 403, success: false, error: 'Forbidden' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        let result;
        if (adminCtx?.role === 'channel' && adminCtx.canManageSubchannels) {
            result = await pool.query(
                `SELECT a.id, a.username, a.created_at, a.channel_id, c.name AS channel_name
                 FROM admin_accounts a
                 JOIN channels c ON a.channel_id = c.id
                 WHERE c.parent_channel_id = $1
                 ORDER BY a.created_at ASC`,
                [adminCtx.channelId]
            );
        } else {
            result = await pool.query(
                `SELECT a.id, a.username, a.created_at, a.channel_id, c.name AS channel_name
                 FROM admin_accounts a
                 LEFT JOIN channels c ON a.channel_id = c.id
                 ORDER BY a.created_at ASC`
            );
        }
        return { success: true, accounts: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostAdminAccount(body, adminCtx) {
    const isCmsAdmin = adminCtx?.role === 'channel' && adminCtx?.canManageSubchannels;
    if (adminCtx?.role === 'channel' && !isCmsAdmin) return { statusCode: 403, success: false, error: 'Forbidden' };
    const { username, password, channel_id } = body || {};
    if (!username || !password) return { statusCode: 400, success: false, error: 'Username and password required' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        if (isCmsAdmin && channel_id) {
            const owns = await verifySubchannelOwnership(channel_id, adminCtx);
            if (!owns) return { statusCode: 403, success: false, error: 'Forbidden' };
        }
        const { scryptSync, randomBytes } = require('crypto');
        const salt = randomBytes(16).toString('hex');
        const hash = scryptSync(password, salt, 64).toString('hex');
        const result = await pool.query(
            'INSERT INTO admin_accounts (username, password_hash, channel_id) VALUES ($1, $2, $3) RETURNING id, username, created_at, channel_id',
            [username, `${salt}:${hash}`, channel_id || null]
        );
        return { success: true, account: result.rows[0] };
    } catch (err) {
        if (err.code === '23505') return { statusCode: 409, success: false, error: 'Username already exists' };
        return { success: false, error: err.message };
    }
}

async function handlePutAdminAccount(id, body, adminCtx) {
    if (adminCtx?.role === 'channel') {
        if (!adminCtx.canManageSubchannels) return { statusCode: 403, success: false, error: 'Forbidden' };
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const acct = await pool.query(
            'SELECT a.channel_id FROM admin_accounts a JOIN channels c ON c.id = a.channel_id WHERE a.id = $1 AND c.parent_channel_id = $2',
            [id, adminCtx.channelId]
        );
        if (acct.rows.length === 0) return { statusCode: 403, success: false, error: 'Forbidden' };
    }
    const { password } = body || {};
    if (!password) return { statusCode: 400, success: false, error: 'Password required' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const { scryptSync, randomBytes } = require('crypto');
        const salt = randomBytes(16).toString('hex');
        const hash = scryptSync(password, salt, 64).toString('hex');
        await pool.query('UPDATE admin_accounts SET password_hash = $1 WHERE id = $2', [`${salt}:${hash}`, id]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleDeleteAdminAccount(id, adminCtx) {
    if (adminCtx?.role === 'channel') {
        if (!adminCtx.canManageSubchannels) return { statusCode: 403, success: false, error: 'Forbidden' };
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const acct = await pool.query(
            'SELECT a.channel_id FROM admin_accounts a JOIN channels c ON c.id = a.channel_id WHERE a.id = $1 AND c.parent_channel_id = $2',
            [id, adminCtx.channelId]
        );
        if (acct.rows.length === 0) return { statusCode: 403, success: false, error: 'Forbidden' };
    }
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const remaining = await pool.query('SELECT COUNT(*) FROM admin_accounts');
        if (parseInt(remaining.rows[0].count) <= 1) return { statusCode: 400, success: false, error: 'Cannot delete the last admin account' };
        await pool.query('DELETE FROM admin_accounts WHERE id = $1', [id]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleAdminLogin(body) {
    const { username, password } = body || {};
    if (!username || !password) return { statusCode: 400, success: false, error: 'Missing credentials' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const result = await pool.query('SELECT id, password_hash, channel_id FROM admin_accounts WHERE username = $1', [username]);
        if (result.rows.length === 0) {
            await new Promise(r => setTimeout(r, 200));
            return { statusCode: 401, success: false, error: 'Invalid credentials' };
        }
        const row = result.rows[0];
        const { scryptSync, timingSafeEqual } = require('crypto');
        const [salt, storedHash] = row.password_hash.split(':');
        const derivedKey = scryptSync(password, salt, 64);
        const match = timingSafeEqual(derivedKey, Buffer.from(storedHash, 'hex'));
        if (!match) return { statusCode: 401, success: false, error: 'Invalid credentials' };

        if (row.channel_id == null) {
            return { success: true, token: process.env.API_BEARER_TOKEN, role: 'superadmin', channel_id: null, allowed_tabs: null };
        }

        const chRes = await pool.query(`SELECT name, config->'admin_tabs' AS admin_tabs, can_manage_subchannels FROM channels WHERE id = $1`, [row.channel_id]);
        const channelRow = chRes.rows[0] || {};
        const allowedTabs = Array.isArray(channelRow.admin_tabs) ? channelRow.admin_tabs : [];
        const cms = channelRow.can_manage_subchannels ?? false;
        const token = signChannelAdminToken({ sub: row.id, cid: row.channel_id, tabs: allowedTabs, cms });
        return { success: true, token, role: 'channel', channel_id: row.channel_id, channel_name: channelRow.name || '', allowed_tabs: allowedTabs, can_manage_subchannels: cms };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePatchUser(user_id, body) {
    const { theme } = body;
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const updates = [];
        const params = [];
        if (theme !== undefined) {
            params.push(theme === 'light' ? 'light' : 'dark');
            updates.push(`theme = $${params.length}`);
        }
        if (updates.length === 0) return { success: true };
        params.push(user_id);
        await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE user_id = $${params.length}`, params);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleDeleteUser(user_id) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        await pool.query('DELETE FROM users WHERE user_id = $1', [user_id]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetInvitations(query) {
    const { channel_id, created_by } = query;
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        let sql = `
            SELECT i.id, i.code, i.type, i.max_uses, i.use_count, i.is_active, i.created_at, i.expires_at,
                   i.channel_id, COALESCE(i.created_by, i.created_by_snapshot) AS created_by,
                   c.name AS channel_name,
                   COALESCE(u.nickname, i.created_by_snapshot) AS creator_name
            FROM invitations i
            LEFT JOIN channels c ON i.channel_id = c.id
            LEFT JOIN users u ON i.created_by = u.user_id
        `;
        const params = [];
        const conditions = [];
        if (channel_id) { params.push(parseInt(channel_id)); conditions.push(`i.channel_id = $${params.length}`); }
        if (created_by) { params.push(created_by); conditions.push(`i.created_by = $${params.length}`); }
        if (conditions.length) sql += ` WHERE ${conditions.join(' AND ')}`;
        sql += ` ORDER BY i.created_at DESC`;
        const result = await pool.query(sql, params);
        return { success: true, invitations: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostInvitation(body, adminCtx) {
    const { created_by, channel_id, type = 'coach', max_uses = null } = body;
    if (!channel_id) return { success: false, error: 'channel_id is required', statusCode: 400 };
    if (adminCtx?.role === 'channel' && adminCtx.canManageSubchannels && parseInt(channel_id) !== adminCtx.channelId) {
        const owns = await verifySubchannelOwnership(channel_id, adminCtx);
        if (!owns) return { statusCode: 403, success: false, error: 'Forbidden' };
    }
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        let code, attempts = 0;
        do {
            code = String(100000 + (parseInt(crypto.randomBytes(3).toString('hex'), 16) % 900000));
            const exists = await pool.query('SELECT id FROM invitations WHERE code = $1', [code]);
            if (exists.rows.length === 0) break;
            attempts++;
        } while (attempts < 10);
        const result = await pool.query(
            `INSERT INTO invitations (code, created_by, created_by_snapshot, channel_id, type, max_uses)
             VALUES ($1, $2, $2, $3, $4, $5) RETURNING id, code`,
            [code, created_by || null, parseInt(channel_id), type, max_uses || null]
        );
        return { success: true, id: result.rows[0].id, code: result.rows[0].code };
    } catch (err) {
        return { success: false, error: err.detail || err.message };
    }
}

async function handleDeleteInvitation(inviteId) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        await pool.query('UPDATE invitations SET is_active = FALSE WHERE id = $1', [inviteId]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleResolvePhone(code, app_id = null) {
    try {
        if (!code) return { success: false, error: 'code is required' };
        const credMap = {};
        if (process.env.WX_APPID && process.env.WX_SECRET)
            credMap[process.env.WX_APPID] = process.env.WX_SECRET;
        if (process.env.WX_APPID_NANOVATE && process.env.WX_SECRET_NANOVATE)
            credMap[process.env.WX_APPID_NANOVATE] = process.env.WX_SECRET_NANOVATE;
        const appid = (app_id && credMap[app_id]) ? app_id : process.env.WX_APPID;
        const token = await getWxAccessToken(appid, credMap[appid]);
        const wxRes = await fetch(`https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${token}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code }),
        });
        const wxData = await wxRes.json();
        if (wxData.errcode) return { success: false, error: `WeChat: ${wxData.errmsg} (${wxData.errcode})` };
        const phone = wxData.phone_info?.purePhoneNumber;
        if (!phone) return { success: false, error: 'No phone number returned' };
        return { success: true, phone };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleBindPhone(user_id, code, app_id = null) {
    try {
        if (!code) return { success: false, error: 'code is required' };
        const credMap = {};
        if (process.env.WX_APPID && process.env.WX_SECRET)
            credMap[process.env.WX_APPID] = process.env.WX_SECRET;
        if (process.env.WX_APPID_NANOVATE && process.env.WX_SECRET_NANOVATE)
            credMap[process.env.WX_APPID_NANOVATE] = process.env.WX_SECRET_NANOVATE;
        const appid = (app_id && credMap[app_id]) ? app_id : process.env.WX_APPID;
        const token = await getWxAccessToken(appid, credMap[appid]);
        const wxRes = await fetch(`https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${token}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code }),
        });
        const wxData = await wxRes.json();
        if (wxData.errcode) return { success: false, error: `WeChat: ${wxData.errmsg} (${wxData.errcode})` };
        const phone = wxData.phone_info?.purePhoneNumber;
        if (!phone) return { success: false, error: 'No phone number returned' };
        await pool.query('UPDATE users SET phone = $1 WHERE user_id = $2', [phone, user_id]);
        return { success: true, phone };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleWxLogin(body) {
    console.log(JSON.stringify({ level: 'INFO', msg: 'wx-login-body', body_keys: Object.keys(body || {}), phone: body?.phone, phone_code: body?.phone_code }));
    const { code, coach_id, invite_code, app_id, phone_code, phone } = body;
    if (!code) return { success: false, error: 'code is required' };

    const credMap = {};
    if (process.env.WX_APPID && process.env.WX_SECRET)
        credMap[process.env.WX_APPID] = process.env.WX_SECRET;
    if (process.env.WX_APPID_NANOVATE && process.env.WX_SECRET_NANOVATE)
        credMap[process.env.WX_APPID_NANOVATE] = process.env.WX_SECRET_NANOVATE;

    const appid  = (app_id && credMap[app_id]) ? app_id : process.env.WX_APPID;
    const secret = credMap[appid];
    if (!appid || !secret) return { success: false, error: 'WX_APPID / WX_SECRET not configured' };

    const wxRes = await fetch(
        `https://api.weixin.qq.com/sns/jscode2session?appid=${appid}&secret=${secret}&js_code=${code}&grant_type=authorization_code`
    );
    const wxData = await wxRes.json();
    if (wxData.errcode) return { success: false, error: `WeChat: ${wxData.errmsg} (${wxData.errcode})` };

    const openid = wxData.openid;

    // Use pre-resolved phone (already verified by /resolve-phone), or resolve from code if provided
    console.log(JSON.stringify({ level: 'INFO', msg: 'wx-login-phone', phone_present: !!phone, phone_code_present: !!phone_code, phone_val: phone }));
    let resolvedPhone = phone || null;
    if (!resolvedPhone && phone_code) {
        const token = await getWxAccessToken(appid, credMap[appid]);
        const phoneRes = await fetch(`https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${token}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: phone_code }),
        });
        const phoneData = await phoneRes.json();
        if (phoneData.errcode || !phoneData.phone_info?.purePhoneNumber) {
            return { success: false, phone_error: true, error: `手机号获取失败: ${phoneData.errmsg || 'no number returned'} (${phoneData.errcode})` };
        }
        resolvedPhone = phoneData.phone_info.purePhoneNumber;
    }

    // Look up existing user — return with channel info and roles
    const existing = await pool.query(
        `SELECT u.user_id, u.nickname, u.birth_date, u.gender, u.language, u.phone, u.email,
                u.avatar_url, u.coach_id, u.channel_id, u.roles, u.created_at, u.bio_data, b.bio_age,
                cu.nickname AS coach_name,
                c.name AS channel_name, c.logo_url AS channel_logo_url,
                c.config->'sub_age_display_names' AS channel_sub_age_names
         FROM users u
         LEFT JOIN coaches p ON u.coach_id = p.id
         LEFT JOIN users cu ON p.user_id = cu.user_id
         LEFT JOIN channels c ON u.channel_id = c.id
         LEFT JOIN (
             SELECT DISTINCT ON (user_id) user_id, bio_age
             FROM biomarkers ORDER BY user_id, tested_at DESC
         ) b ON u.user_id = b.user_id
         WHERE u.external_id = $1 OR u.user_id = $1
         LIMIT 1`,
        [openid]
    );

    if (existing.rows.length > 0) {
        let existingRow = existing.rows[0];

        // Existing user with no channel + invite code → assign channel from invite
        if (!existingRow.channel_id && invite_code) {
            const invRes = await pool.query(
                `SELECT id, channel_id, created_by, max_uses, use_count FROM invitations
                 WHERE code = $1 AND is_active = TRUE AND (expires_at IS NULL OR expires_at > NOW()) LIMIT 1`,
                [invite_code.toUpperCase()]
            );
            if (invRes.rows.length > 0) {
                const inviteRecord = invRes.rows[0];
                let newChannelId = inviteRecord.channel_id;
                if (!newChannelId && inviteRecord.created_by) {
                    const coachByUser = await pool.query('SELECT channel_id FROM coaches WHERE user_id = $1 LIMIT 1', [inviteRecord.created_by]);
                    if (coachByUser.rows.length > 0) newChannelId = coachByUser.rows[0].channel_id;
                }
                if (newChannelId) {
                    await pool.query(
                        `UPDATE users SET channel_id = $1, invited_by_invitation_id = COALESCE(invited_by_invitation_id, $2) WHERE user_id = $3`,
                        [newChannelId, inviteRecord.id, existingRow.user_id]
                    );
                    await pool.query(
                        `UPDATE invitations SET use_count = use_count + 1 WHERE id = $1 AND (max_uses IS NULL OR use_count < max_uses)`,
                        [inviteRecord.id]
                    );
                    await pool.query(
                        'INSERT INTO invitation_uses (invitation_id, user_id, user_id_snapshot) VALUES ($1, $2, $2) ON CONFLICT (invitation_id, user_id_snapshot) DO NOTHING',
                        [inviteRecord.id, existingRow.user_id]
                    );
                    // Re-fetch with updated channel info
                    const refreshed = await pool.query(
                        `SELECT u.user_id, u.nickname, u.birth_date, u.gender, u.language, u.phone, u.email,
                                u.avatar_url, u.coach_id, u.channel_id, u.roles, u.created_at, u.bio_data, b.bio_age,
                                cu.nickname AS coach_name,
                                c.name AS channel_name, c.logo_url AS channel_logo_url,
                                c.config->'sub_age_display_names' AS channel_sub_age_names
                         FROM users u
                         LEFT JOIN coaches p ON u.coach_id = p.id
                         LEFT JOIN users cu ON p.user_id = cu.user_id
                         LEFT JOIN channels c ON u.channel_id = c.id
                         LEFT JOIN (
                             SELECT DISTINCT ON (user_id) user_id, bio_age
                             FROM biomarkers ORDER BY user_id, tested_at DESC
                         ) b ON u.user_id = b.user_id
                         WHERE u.user_id = $1 LIMIT 1`,
                        [existingRow.user_id]
                    );
                    if (refreshed.rows.length > 0) existingRow = refreshed.rows[0];
                }
            }
        }

        if (resolvedPhone && !existingRow.phone) {
            await pool.query('UPDATE users SET phone = $1 WHERE user_id = $2', [resolvedPhone, existingRow.user_id]);
            existingRow.phone = resolvedPhone;
        }
        const { channel_name, channel_logo_url, channel_sub_age_names, ...user } = existingRow;
        const channel = channel_name
            ? { name: channel_name, logo_url: channel_logo_url, sub_age_display_names: channel_sub_age_names || null }
            : null;
        // If user is a coach, fetch their coach record
        let coach = null;
        if (user.roles && user.roles.includes('coach')) {
            const coachRes = await pool.query(
                `SELECT id, channel_id, user_id FROM coaches WHERE user_id = $1 LIMIT 1`,
                [user.user_id]
            );
            if (coachRes.rows.length > 0) coach = coachRes.rows[0];
        }
        return { success: true, user, channel, coach };
    }

    // New user — if phone already exists on another account, re-link that account to this openid
    if (resolvedPhone) {
        const phoneMatch = await pool.query(
            `SELECT u.user_id, u.nickname, u.birth_date, u.gender, u.language, u.phone, u.email,
                    u.avatar_url, u.coach_id, u.channel_id, u.roles, u.created_at, u.bio_data, b.bio_age,
                    cu.nickname AS coach_name,
                    c.name AS channel_name, c.logo_url AS channel_logo_url,
                    c.config->'sub_age_display_names' AS channel_sub_age_names
             FROM users u
             LEFT JOIN coaches p ON u.coach_id = p.id
             LEFT JOIN users cu ON p.user_id = cu.user_id
             LEFT JOIN channels c ON u.channel_id = c.id
             LEFT JOIN (
                 SELECT DISTINCT ON (user_id) user_id, bio_age
                 FROM biomarkers ORDER BY user_id, tested_at DESC
             ) b ON u.user_id = b.user_id
             WHERE u.phone = $1 LIMIT 1`,
            [resolvedPhone]
        );
        if (phoneMatch.rows.length > 0) {
            const row = phoneMatch.rows[0];
            await pool.query('UPDATE users SET external_id = $1 WHERE user_id = $2', [openid, row.user_id]);
            const { channel_name, channel_logo_url, channel_sub_age_names, ...user } = row;
            const channel = channel_name
                ? { name: channel_name, logo_url: channel_logo_url, sub_age_display_names: channel_sub_age_names || null }
                : null;
            let coach = null;
            if (user.roles && user.roles.includes('coach')) {
                const coachRes = await pool.query('SELECT id, channel_id, user_id FROM coaches WHERE user_id = $1 LIMIT 1', [user.user_id]);
                if (coachRes.rows.length > 0) coach = coachRes.rows[0];
            }
            return { success: true, user, channel, coach };
        }
    }

    // New user — no invite code, allow guest browsing
    if (!invite_code && !coach_id) {
        return { success: true, guest: true, openid };
    }

    // New user — determine channel from invite code, coach invite, or default to nanovate
    let channelId = null;
    let resolvedCoachId = coach_id ? parseInt(coach_id) : null;
    let inviteRecord = null;

    if (invite_code) {
        const invRes = await pool.query(
            `SELECT id, channel_id, created_by, max_uses, use_count FROM invitations
             WHERE code = $1 AND is_active = TRUE AND (expires_at IS NULL OR expires_at > NOW()) LIMIT 1`,
            [invite_code.toUpperCase()]
        );
        if (invRes.rows.length === 0) {
            return { success: false, invalid_code: true, error: 'Invalid or expired invitation code' };
        }
        if (invRes.rows.length > 0) {
            inviteRecord = invRes.rows[0];
            channelId = inviteRecord.channel_id;
            // If invite was created by a coach, assign that coach
            if (inviteRecord.created_by && !resolvedCoachId) {
                const coachByUser = await pool.query('SELECT id FROM coaches WHERE user_id = $1 LIMIT 1', [inviteRecord.created_by]);
                if (coachByUser.rows.length > 0) resolvedCoachId = coachByUser.rows[0].id;
            }
            // Option B: fallback — if channel has exactly one coach, auto-assign them
            if (!resolvedCoachId && channelId) {
                const channelCoaches = await pool.query('SELECT id FROM coaches WHERE channel_id = $1', [channelId]);
                if (channelCoaches.rows.length === 1) resolvedCoachId = channelCoaches.rows[0].id;
            }
        }
    }

    if (!channelId && resolvedCoachId) {
        const coachRes = await pool.query('SELECT channel_id FROM coaches WHERE id = $1', [resolvedCoachId]);
        if (coachRes.rows.length > 0) channelId = coachRes.rows[0].channel_id;
    }
    if (!channelId) {
        const defaultCh = await pool.query("SELECT id FROM channels WHERE key_name = 'nanovate' LIMIT 1");
        channelId = defaultCh.rows[0]?.id || null;
    }

    const newUserId = generateUserId();
    const created = await pool.query(
        `INSERT INTO users (user_id, external_id, external_app, language, coach_id, channel_id, invited_by_invitation_id, phone)
         VALUES ($1, $2, 'wechat', 'zh', $3, $4, $5, $6)
         RETURNING user_id, nickname, birth_date, gender, language, phone, email, avatar_url, coach_id, channel_id, roles, created_at, bio_data`,
        [newUserId, openid, resolvedCoachId, channelId, inviteRecord?.id || null, resolvedPhone]
    );

    if (inviteRecord) {
        await pool.query(
            `UPDATE invitations SET use_count = use_count + 1 WHERE id = $1
             AND (max_uses IS NULL OR use_count < max_uses)`,
            [inviteRecord.id]
        );
        await pool.query(
            'INSERT INTO invitation_uses (invitation_id, user_id, user_id_snapshot) VALUES ($1, $2, $2) ON CONFLICT (invitation_id, user_id_snapshot) DO NOTHING',
            [inviteRecord.id, newUserId]
        );
    }

    let channel = null;
    if (channelId) {
        const chanRes = await pool.query(
            `SELECT name, logo_url, config->'sub_age_display_names' AS sub_age_display_names FROM channels WHERE id = $1`,
            [channelId]
        );
        if (chanRes.rows.length > 0) channel = {
            name: chanRes.rows[0].name,
            logo_url: chanRes.rows[0].logo_url,
            sub_age_display_names: chanRes.rows[0].sub_age_display_names || null,
        };
    }

    return { success: true, new_user: true, user: { ...created.rows[0], bio_age: null, coach_name: null }, channel };
}

async function handleValidateInvite(body) {
    const { invite_code } = body;
    if (!invite_code) return { success: false, error: 'invite_code is required' };

    const invRes = await pool.query(
        `SELECT id, channel_id FROM invitations
         WHERE code = $1 AND is_active = TRUE AND (expires_at IS NULL OR expires_at > NOW()) LIMIT 1`,
        [invite_code.toUpperCase()]
    );
    if (invRes.rows.length === 0) {
        return { success: false, invalid_code: true, error: 'Invalid or expired invitation code' };
    }

    const channelId = invRes.rows[0].channel_id;
    let channel = null;
    if (channelId) {
        const chanRes = await pool.query('SELECT name, logo_url FROM channels WHERE id = $1', [channelId]);
        if (chanRes.rows.length > 0) channel = { name: chanRes.rows[0].name, logo_url: chanRes.rows[0].logo_url };
    }
    return { success: true, channel };
}

async function saveChatMessage(user_id, role, content, image_url = null) {
    try {
        await pool.query(
            'INSERT INTO chat_messages (user_id, role, content, image_url) VALUES ($1, $2, $3, $4)',
            [user_id, role, content, image_url]
        );
    } catch (err) {
        console.error('Failed to save chat message:', err);
    }
}

async function handleGetChatHistory(openid, sinceId = null) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        if (!openid) return { success: true, messages: [] };
        if (sinceId !== null) {
            const result = await pool.query(
                `SELECT id, role, content, image_url, created_at
                 FROM chat_messages
                 WHERE user_id = $1 AND id > $2 AND role = 'coach'
                 ORDER BY created_at ASC, id ASC`,
                [openid, sinceId]
            );
            return { success: true, messages: result.rows };
        }
        const limit = parseInt(process.env.CHAT_HISTORY_LIMIT || '20', 10);
        const result = await pool.query(
            `SELECT id, role, content, image_url, created_at FROM (
                SELECT id, role, content, image_url, created_at FROM chat_messages
                WHERE user_id = $1
                ORDER BY created_at DESC, id DESC
                LIMIT $2
            ) sub ORDER BY created_at ASC, id ASC`,
            [openid, limit]
        );
        return { success: true, messages: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function resolveOrUpsertUser(body) {
    const { openid, nickname, gender, birth_date, language, phone, email,
            test_type, test_data, tested_at, message, ...rest } = body;
    if (!openid) throw new Error('openid is required');

    // If openid matches an existing user_id (admin-created or simulator users), use it directly.
    // Otherwise fall back to the external_id upsert (production WeChat flow).
    const byUserId = await pool.query(
        'SELECT user_id, birth_date, bio_data, nickname, language, phone, email FROM users WHERE user_id = $1',
        [openid]
    );
    if (byUserId.rows.length > 0) return byUserId.rows[0];

    const userQuery = `
        INSERT INTO users (user_id, external_id, external_app, nickname, phone, email, gender, birth_date, language, bio_data, channel_id)
        VALUES ($1, $2, 'wechat', $3, $4, $5, $6, $7, $8, $9, (SELECT id FROM channels WHERE key_name = 'nanovate' LIMIT 1))
        ON CONFLICT (external_id)
        DO UPDATE SET
            nickname = COALESCE(EXCLUDED.nickname, users.nickname),
            phone = COALESCE(EXCLUDED.phone, users.phone),
            email = COALESCE(EXCLUDED.email, users.email),
            gender = COALESCE(EXCLUDED.gender, users.gender),
            birth_date = COALESCE(EXCLUDED.birth_date, users.birth_date),
            language = COALESCE(EXCLUDED.language, users.language),
            bio_data = users.bio_data || EXCLUDED.bio_data,
            updated_at = CURRENT_TIMESTAMP
        RETURNING user_id, birth_date, bio_data, nickname, language, phone, email;
    `;
    const userResult = await pool.query(userQuery, [
        generateUserId(), openid, nickname, phone || null, email || null,
        gender, birth_date, language || 'zh', JSON.stringify(rest)
    ]);
    return userResult.rows[0];
}

// Fetch the structured context that drives tag derivation: prior kino_chip estimates,
// recent body_composition entries, and 14-day per-pathway dot-compliance.
// Pathway keys returned use the canonical sub-age code keys (CellularAge, MetabolicAge, ...).
async function fetchTagDerivationContext(user_id) {
    const PATHWAY_DB_TO_CODE = {
        'Cellular Age':       'CellularAge',
        'Metabolic Age':      'MetabolicAge',
        'Micro-Vascular Age': 'MicroVascularAge',
        'Resilience Age':     'ResilienceAge',
    };
    const ctx = { history: [], weightHistory: [], compliance: {}, selfReported: [] };

    try {
        const r = await pool.query(
            `SELECT data, tested_at FROM biomarkers
             WHERE user_id = $1 AND test_type = 'kino_chip'
             ORDER BY tested_at DESC LIMIT 5`,
            [user_id]
        );
        ctx.history = r.rows.map(row => {
            const d = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
            return { tested_at: row.tested_at, biomarkers: (d && (d.estimated || d.actual)) || {} };
        });
    } catch (err) {
        console.log(JSON.stringify({ level: 'WARN', msg: 'fetchTagDerivationContext.history failed', error: err.message }));
    }

    try {
        const r = await pool.query(
            `SELECT data, tested_at FROM biomarkers
             WHERE user_id = $1 AND test_type = 'body_composition'
             ORDER BY tested_at DESC LIMIT 10`,
            [user_id]
        );
        ctx.weightHistory = r.rows
            .map(row => {
                const d = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
                const weight = d && d.actual && typeof d.actual.weight === 'number' ? d.actual.weight : null;
                return weight === null ? null : { tested_at: row.tested_at, weight };
            })
            .filter(Boolean);
    } catch (err) {
        console.log(JSON.stringify({ level: 'WARN', msg: 'fetchTagDerivationContext.weight failed', error: err.message }));
    }

    try {
        const r = await pool.query(
            `SELECT d.sub_age_target AS pathway,
                    SUM(CASE WHEN ns.is_taken THEN (kv.value)::int ELSE 0 END)::float AS taken_count,
                    SUM((kv.value)::int)::float AS total_count
             FROM nutrition_schedules ns
             CROSS JOIN LATERAL jsonb_each_text(ns.recipe -> 'dots') AS kv(key, value)
             JOIN dots d ON d.key_name = kv.key
             WHERE ns.user_id = $1
               AND ns.scheduled_date >= CURRENT_DATE - INTERVAL '14 days'
               AND ns.scheduled_date <= CURRENT_DATE
               AND d.sub_age_target IS NOT NULL
             GROUP BY d.sub_age_target`,
            [user_id]
        );
        for (const row of r.rows) {
            const codeKey = PATHWAY_DB_TO_CODE[row.pathway];
            if (!codeKey || !row.total_count) continue;
            ctx.compliance[codeKey] = row.taken_count / row.total_count;
        }
    } catch (err) {
        console.log(JSON.stringify({ level: 'WARN', msg: 'fetchTagDerivationContext.compliance failed', error: err.message }));
    }

    return ctx;
}

async function handlePostBiomarkers(body) {
    const { openid, test_type = 'kino_chip', test_data, tested_at, kino_device_id } = body;
    if (!test_data) throw new Error('test_data is required');

    const user = await resolveOrUpsertUser(body);
    const user_id = user.user_id;

    if (test_type === 'kino_chip') {
        const age = calculateAge(user.birth_date);
        const bioData = user.bio_data || {};

        const tagContext = await fetchTagDerivationContext(user_id);
        const tags = deriveTags(tagContext);
        const scanTimestamp = tested_at || new Date().toISOString();
        const scanDate = scanTimestamp.slice(0, 10);
        const weekBucket = Math.floor(new Date(scanDate).getTime() / (7 * 24 * 60 * 60 * 1000));
        const persistentSeed = `${user_id}:w${weekBucket}`;
        const seed = `${user_id}:${scanTimestamp}`;
        console.log(JSON.stringify({
            level: 'INFO',
            msg: 'biomarker_tags_derived',
            data: { user_id, tags, compliance: tagContext.compliance, history_count: tagContext.history.length, weight_count: tagContext.weightHistory.length }
        }));

        const estimator = new BiomarkerEstimator(age, test_data, { Weight: bioData.weight, Height: bioData.height }, tags, { seed, persistentSeed });
        const estimationReport = estimator.generateReport();
        const bioAgeCalc = new BioAgeCalculator();
        const bioAgeReport = bioAgeCalc.calculateBioAge(age, estimationReport.BiomarkerValues);

        // Resolve serial number → integer FK (kino_device_id is INTEGER referencing kino_devices.id)
        let deviceFk = null;
        if (kino_device_id) {
            const devRow = await pool.query('SELECT id FROM kino_devices WHERE serial_number = $1', [kino_device_id]);
            if (devRow.rows.length > 0) deviceFk = devRow.rows[0].id;
        }

        const finalData = { actual: test_data, estimated: estimationReport.BiomarkerValues, context: estimationReport.ClinicalContext, bioage_profile: bioAgeReport, tags };
        const biomarkerResult = await pool.query(
            'INSERT INTO biomarkers (user_id, test_type, data, bio_age, tested_at, kino_device_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
            [user_id, test_type, JSON.stringify(finalData), bioAgeReport.BioAge, tested_at || new Date().toISOString(), deviceFk]
        );
        const biomarkerId = biomarkerResult.rows[0].id;

        const lang = user.language || 'zh';
        const content = lang === 'zh'
            ? `已完成生物标志物检测分析。您的生理年龄为 **${bioAgeReport.BioAge.toFixed(1)} 岁**。请用健康管理小工具查看详细分析！`
            : `I've analyzed your biomarker test. Your biological age is **${bioAgeReport.BioAge.toFixed(1)} years**. Check your health advice tool for details!`;
        await pool.query(
            'INSERT INTO notifications (user_id, biomarker_id, notification_type, content, status) VALUES ($1, $2, $3, $4, $5)',
            [user_id, biomarkerId, 'biological_report', content, 'pending']
        );
        await saveChatMessage(user_id, 'ai', content);

        refreshGoalProgress(user_id);

        return { success: true, user_id, biomarkers: estimationReport.BiomarkerValues, bioage_profile: bioAgeReport };
    } else {
        // Non-kino: save raw record only, no estimation
        await pool.query(
            'INSERT INTO biomarkers (user_id, test_type, data, tested_at) VALUES ($1, $2, $3, $4)',
            [user_id, test_type, JSON.stringify({ actual: test_data }), tested_at || new Date().toISOString()]
        );
        if (test_type === 'body_composition' && body.send_weight_reminder && test_data.weight) {
            try {
                const token = await getWxAccessToken();
                await sendWeightSubscribeMsg(user_id, test_data.weight, token);
            } catch (e) {
                console.log(JSON.stringify({ level: 'WARN', msg: 'weight subscribe msg failed', error: e.message }));
            }
        }
        return { success: true, user_id };
    }
}

async function sendWeightSubscribeMsg(openid, weightKg, accessToken) {
    const tmplId = process.env.WX_WEIGHT_TMPL_ID;
    if (!tmplId) return;
    const now = getNowShanghai().toFormat('yyyy-MM-dd HH:mm');
    const res = await fetch(
        `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${accessToken}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                touser: openid,
                template_id: tmplId,
                page: 'pages/main/main',
                data: {
                    thing1: { value: '体重记录成功' },
                    number2: { value: String(weightKg) },
                    time3:   { value: now },
                },
            }),
        }
    );
    const result = await res.json();
    if (result.errcode && result.errcode !== 0) {
        console.log(JSON.stringify({ level: 'WARN', msg: 'wx_subscribe_send_error', data: result }));
    }
}

async function handlePostChat(body) {
    const { openid, message } = body;
    if (!openid) throw new Error('openid is required');

    const user = await resolveOrUpsertUser(body);
    const user_id = user.user_id;

    if (message) {
        // Intent-routed chat message handling
        try {
            const client = getLlmClient();
            const model = process.env.MODEL || 'qwen3.6-plus';

            // Step 1: Classify the user's intent
            let intent = 'casual_chat';
            let required_data = [];
            try {
                const classifierCompletion = await client.chat.completions.create({
                    model: process.env.CLASSIFIER_MODEL || model,
                    messages: [{ role: 'user', content: intentClassifierTemplate(message) }],
                    max_tokens: 60,
                });
                const raw = classifierCompletion.choices[0].message.content.trim();
                const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
                intent = parsed.intent || 'casual_chat';
                required_data = Array.isArray(parsed.required_data) ? parsed.required_data : [];
            } catch (classifyErr) {
                console.log(JSON.stringify({ level: 'WARN', msg: 'Intent classification failed, defaulting to casual_chat', error: classifyErr.message }));
            }
            console.log(JSON.stringify({ level: 'INFO', msg: 'Chat intent classified', intent, required_data }));

            // Step 2: Fetch only the data the intent actually needs
            const fetches = {};
            if (required_data.includes('biomarkers') || required_data.includes('bioage')) {
                fetches.biomarker = pool.query(
                    `SELECT data FROM biomarkers WHERE user_id = $1 AND test_type = 'kino_chip' ORDER BY tested_at DESC LIMIT 1`,
                    [user_id]
                );
            }
            if (required_data.includes('dots')) {
                fetches.dots = pool.query(
                    `SELECT id, key_name, name, name_zh, description, is_isolate FROM dots ORDER BY id ASC`
                );
            }
            if (required_data.includes('plan')) {
                fetches.plan = pool.query(
                    `SELECT content FROM notifications WHERE user_id = $1 AND notification_type = 'nutrition_plan' ORDER BY sent_at DESC LIMIT 1`,
                    [user_id]
                );
            }
            if (required_data.includes('weight_history')) {
                fetches.weight = pool.query(
                    `SELECT data FROM biomarkers WHERE user_id = $1 AND test_type = 'body_composition' ORDER BY tested_at DESC LIMIT 1`,
                    [user_id]
                );
            }

            // Always fetch health_twin — provides wearable/sleep/activity context for all intents
            fetches.health_twin = pool.query(
                `SELECT avg_hrv_ms, avg_resting_hr, avg_spo2,
                        avg_sleep_hours, avg_sleep_score, avg_deep_sleep_pct,
                        avg_daily_steps, avg_active_minutes,
                        latest_weight_kg, latest_bmi, latest_body_fat_pct,
                        latest_lab_data, latest_lab_date,
                        trend_data, data_coverage
                 FROM health_twin WHERE user_id = $1`,
                [user_id]
            );

            // Always fetch completed questionnaire responses — coach-collected data enriches all intents
            fetches.questionnaire_responses = pool.query(
                `SELECT q.name, q.name_zh, qq.prompt_en, qq.prompt_zh, qr.answer
                 FROM questionnaire_responses qr
                 JOIN questionnaire_questions qq ON qq.id = qr.question_id
                 JOIN questionnaire_assignments qa ON qa.id = qr.assignment_id
                 JOIN questionnaires q ON q.id = qa.questionnaire_id
                 WHERE qa.user_id = $1 AND qa.status = 'completed'
                 ORDER BY qa.completed_at ASC, qq.sort_order ASC`,
                [user_id]
            );
            fetches.health_plans = pool.query(
                `SELECT hp.id, hp.plan_type, hp.start_date, hp.duration_weeks, hp.baseline_data,
                        hpt.name_en, hpt.name_zh, hpt.goal_en, hpt.goal_zh, hpt.target_sub_ages,
                        (SELECT COUNT(*) FROM health_plan_checkins WHERE plan_id = hp.id) AS checkin_count,
                        (SELECT COUNT(*) FROM health_plan_milestones WHERE plan_id = hp.id) AS milestones_done
                 FROM health_plans hp
                 LEFT JOIN health_plan_templates hpt ON hpt.id = hp.template_id
                 WHERE hp.user_id = $1 AND hp.status = 'active'
                 ORDER BY hp.plan_type ASC LIMIT 2`,
                [user_id]
            );

            const fetchKeys = Object.keys(fetches);
            const fetchResults = await Promise.all(fetchKeys.map(k => fetches[k]));
            const fetched = {};
            fetchKeys.forEach((k, i) => { fetched[k] = fetchResults[i]; });

            const biomarkerRow = fetched.biomarker?.rows[0] || {};
            const llmContext = {
                user_profile: {
                    nickname: user.nickname,
                    gender: user.gender,
                    age: calculateAge(user.birth_date),
                    language: user.language,
                },
                biomarkers: biomarkerRow.data?.actual || {},
                bioage: biomarkerRow.data?.bioage_profile || {},
                dots: fetched.dots?.rows || [],
                plan: fetched.plan?.rows[0]?.content || null,
                last_weight: fetched.weight?.rows[0]?.data?.actual?.weight ?? null,
                health_twin: fetched.health_twin?.rows[0] || null,
                now_iso: getNowShanghai().toISO(),
                questionnaire_context: formatQuestionnaireContext(
                    fetched.questionnaire_responses?.rows || [],
                    user.language
                ),
                active_health_plans: (fetched.health_plans?.rows || []).map(p => ({
                    plan_type: p.plan_type,
                    name: user.language === 'zh' ? p.name_zh : p.name_en,
                    goal: user.language === 'zh' ? p.goal_zh : p.goal_en,
                    target_sub_ages: p.target_sub_ages || [],
                    weeks_elapsed: Math.max(0, Math.floor((Date.now() - new Date(p.start_date).getTime()) / (7 * 86400000))),
                    total_weeks: p.duration_weeks,
                    checkin_count: parseInt(p.checkin_count || 0, 10),
                    milestones_done: parseInt(p.milestones_done || 0, 10),
                })),
            };

            const promptBuilder = chatPrompts[intent] || chatPrompts.casual_chat;
            const systemPrompt = promptBuilder(llmContext);

            // Save the incoming user message to the conversation log
            await pool.query(
                'INSERT INTO chat_messages (user_id, role, content) VALUES ($1, $2, $3)',
                [user_id, 'user', message]
            );

            // Fetch recent conversation history (oldest-first for the LLM)
            const historyLimit = parseInt(process.env.CHAT_HISTORY_LIMIT || '20', 10);
            const historyResult = await pool.query(
                `SELECT role, content FROM (
                    SELECT role, content, created_at FROM chat_messages
                    WHERE user_id = $1
                    ORDER BY created_at DESC
                    LIMIT $2
                ) sub ORDER BY created_at ASC`,
                [user_id, historyLimit]
            );

            // Normalize roles ('ai' → 'assistant') and collapse consecutive same-role turns
            // Only 'user' and 'ai' rows are forwarded; 'coach', 'action', and anything else is UI-only
            const cleanHistory = [];
            for (const row of historyResult.rows) {
                if (row.role !== 'user' && row.role !== 'ai') continue;
                const role = row.role === 'ai' ? 'assistant' : row.role;
                const last = cleanHistory[cleanHistory.length - 1];
                if (last && last.role === role) {
                    last.content = row.content;
                } else {
                    cleanHistory.push({ role, content: row.content });
                }
            }
            while (cleanHistory.length > 0 && cleanHistory[0].role !== 'user') {
                cleanHistory.shift();
            }

            const dbQueryTool = {
                type: 'function',
                function: {
                    name: 'query_database',
                    description: `Run a read-only SQL SELECT to retrieve this user's health data when it isn't already in context.
Tables (always filter by user_id = $1):
- biomarkers(tested_at TIMESTAMPTZ, test_type TEXT, data JSONB)
    data.actual: {hsCRP, GDF15, GA, CystatinC, IL6, CD38}  (body_composition has .weight)
    data.bioage_profile: {BioAge, ChronoAge, SubAges:{CellularAge,MetabolicAge,MicroVascularAge,ResilienceAge}}
- nutrition_schedules(scheduled_date DATE, dot_id INT, dot_name TEXT, timing TEXT, quantity INT)
- reminders(content TEXT, scheduled_for TIMESTAMPTZ, recurrence TEXT, status TEXT)
- chat_messages(role TEXT, content TEXT, created_at TIMESTAMPTZ)
SQL must be a SELECT statement. $1 is always user_id.`,
                    parameters: {
                        type: 'object',
                        properties: {
                            sql: { type: 'string', description: 'SELECT statement; use $1 for user_id, $2+ for extra params' },
                            extra_params: { type: 'array', items: {}, description: 'Values for $2, $3, … (optional)' }
                        },
                        required: ['sql']
                    }
                }
            };

            const chatMessages = [
                { role: 'system', content: systemPrompt },
                ...cleanHistory,
            ];

            let rawReply = '';
            for (let _iter = 0; _iter < 4; _iter++) {
                const completion = await client.chat.completions.create({
                    model,
                    messages: chatMessages,
                    tools: [dbQueryTool],
                    tool_choice: 'auto',
                });
                const choice = completion.choices[0];

                if (choice.finish_reason === 'tool_calls') {
                    chatMessages.push(choice.message);
                    const toolResults = [];
                    for (const tc of choice.message.tool_calls || []) {
                        if (tc.function.name === 'query_database') {
                            let toolResult;
                            try {
                                const args = JSON.parse(tc.function.arguments);
                                const sql = (args.sql || '').trim();
                                const extraParams = Array.isArray(args.extra_params) ? args.extra_params : [];
                                if (!/^\s*(SELECT|WITH)\s/i.test(sql) || !/\$1\b/.test(sql)) {
                                    toolResult = { error: 'Rejected: must be SELECT with $1 for user_id' };
                                } else {
                                    const qr = await pool.query(sql, [user_id, ...extraParams]);
                                    toolResult = { rows: qr.rows, count: qr.rowCount };
                                }
                            } catch (qErr) {
                                toolResult = { error: qErr.message };
                            }
                            console.log(JSON.stringify({ level: 'INFO', msg: 'DB tool call', rows: toolResult.rows?.length ?? 0 }));
                            toolResults.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(toolResult) });
                        }
                    }
                    chatMessages.push(...toolResults);
                } else {
                    rawReply = choice.message.content || '';
                    break;
                }
            }

            // Detect weight-recording action embedded by the LLM
            const weightActionMatch = rawReply.match(/\{"action"\s*:\s*"record_weight"\s*,\s*"value_kg"\s*:\s*([\d.]+)\}/);
            if (weightActionMatch) {
                const weightKg = parseFloat(weightActionMatch[1]);
                const isZh = (user.language || 'zh') === 'zh';

                if (!isNaN(weightKg) && weightKg >= 20 && weightKg <= 300) {
                    const lastRecord = await pool.query(
                        `SELECT data FROM biomarkers WHERE user_id = $1 AND test_type = 'body_composition' ORDER BY tested_at DESC LIMIT 1`,
                        [user_id]
                    );
                    const lastWeight = lastRecord.rows[0]?.data?.actual?.weight ?? null;

                    let simpleReply;
                    let recordedWeight = null;

                    if (lastWeight !== null && Math.abs(weightKg - lastWeight) > 15) {
                        simpleReply = isZh
                            ? `⚠️ 您上次记录的体重是 **${lastWeight} kg**，与本次输入（**${weightKg} kg**）相差较大，请核对后重新发送。`
                            : `⚠️ Your last recorded weight was **${lastWeight} kg**. The new value **${weightKg} kg** looks quite different — please double-check and resend if it's correct.`;
                    } else {
                        await pool.query(
                            'INSERT INTO biomarkers (user_id, test_type, data, tested_at) VALUES ($1, $2, $3, $4)',
                            [user_id, 'body_composition', JSON.stringify({ actual: { weight: weightKg } }), new Date().toISOString()]
                        );
                        recordedWeight = weightKg;
                        simpleReply = isZh
                            ? `✅ 已记录您的体重：**${weightKg} kg**`
                            : `✅ Weight recorded: **${weightKg} kg**`;
                    }

                    await saveChatMessage(user_id, 'ai', simpleReply);
                    await pool.query(
                        'INSERT INTO notifications (user_id, notification_type, content, status) VALUES ($1, $2, $3, $4)',
                        [user_id, 'chat_reply', simpleReply, 'pending']
                    );
                    return { success: true, user_id, ...(recordedWeight !== null && { recorded_weight: recordedWeight }) };
                }
            }

            // Detect reminder-setting action embedded by the LLM
            const reminderActionMatch = rawReply.match(/\{"action"\s*:\s*"set_reminder"[^}]*\}/);
            if (reminderActionMatch) {
                try {
                    const reminderAction = JSON.parse(reminderActionMatch[0]);
                    if (reminderAction.content && reminderAction.scheduled_for) {
                        await handlePostReminder({ user_id, content: reminderAction.content, scheduled_for: reminderAction.scheduled_for });
                    }
                } catch (e) {
                    console.log(JSON.stringify({ level: 'WARN', msg: 'set_reminder action parse failed', error: e.message }));
                }
            }

            const reply = rawReply
                .replace(/\n?\{"action"\s*:\s*"record_weight"[^}]*\}/g, '')
                .replace(/\n?\{"action"\s*:\s*"set_reminder"[^}]*\}/g, '')
                .trim();

            // Save assistant reply to the conversation log
            await saveChatMessage(user_id, 'ai', reply);

            // Save reply as a notification (existing delivery mechanism for frontend poll)
            await pool.query(
                'INSERT INTO notifications (user_id, notification_type, content, status) VALUES ($1, $2, $3, $4)',
                [user_id, 'chat_reply', reply, 'pending']
            );
        } catch (err) {
            console.error('LLM Chat Error:', err);
            // Fallback for demo if LLM fails
            await pool.query(
                'INSERT INTO notifications (user_id, notification_type, content, status) VALUES ($1, $2, $3, $4)',
                [user_id, 'chat_reply', "I'm sorry, I'm having trouble connecting to my brain right now. Please try again later.", 'pending']
            );
        }
    }
    return { success: true, user_id };
}

async function handlePostChatMessages(body) {
    const { openid, role, content } = body;
    if (!openid || !role || !content) return { success: false, error: 'openid, role, and content are required', statusCode: 400 };
    await saveChatMessage(openid, role, content);
    return { success: true };
}

async function handlePostHeartbeat(body) {
    const { user_id } = body;
    if (!user_id) return { success: false, error: 'user_id required', statusCode: 400 };
    await pool.query('UPDATE users SET last_active_at = NOW() WHERE user_id = $1', [user_id]);
    return { success: true };
}

async function handleGetKinoDevices() {
    const result = await pool.query(`
        SELECT kd.id, kd.serial_number, kd.name, kd.status, kd.notes, kd.registered_at, kd.created_at,
               kd.coach_id, u.nickname AS coach_name,
               kd.channel_id, ch.name AS channel_name,
               COUNT(b.id)::int AS test_count,
               MAX(b.tested_at) AS last_used_at
        FROM kino_devices kd
        LEFT JOIN coaches c ON c.id = kd.coach_id
        LEFT JOIN users u ON u.user_id = c.user_id
        LEFT JOIN channels ch ON ch.id = kd.channel_id
        LEFT JOIN biomarkers b ON b.kino_device_id = kd.id
        GROUP BY kd.id, u.nickname, ch.name
        ORDER BY kd.id ASC
    `);
    return { success: true, devices: result.rows };
}

async function handlePostKinoDevice(body) {
    const { serial_number, name, coach_id, channel_id, status, notes } = body;
    if (!serial_number?.trim()) return { success: false, error: 'serial_number is required', statusCode: 400 };
    try {
        const result = await pool.query(
            `INSERT INTO kino_devices (serial_number, name, coach_id, channel_id, status, notes)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [serial_number.trim(), name || null, coach_id || null, channel_id || null, status || 'active', notes || null]
        );
        return { success: true, id: result.rows[0].id };
    } catch (err) {
        return { success: false, error: err.detail || err.message };
    }
}

async function handlePutKinoDevice(id, body) {
    const { name, coach_id, channel_id, status, notes } = body;
    try {
        await pool.query(
            `UPDATE kino_devices SET name=$1, coach_id=$2, channel_id=$3, status=$4, notes=$5 WHERE id=$6`,
            [name || null, coach_id || null, channel_id || null, status || 'active', notes || null, parseInt(id)]
        );
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleDeleteKinoDevice(id) {
    try {
        await pool.query('DELETE FROM kino_devices WHERE id = $1', [parseInt(id)]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Kone APK Release Handlers
// ─────────────────────────────────────────────────────────────────────────────

const KONE_APK_BUCKET  = process.env.KONE_APK_OSS_BUCKET  || 'kone-apk';
const KONE_APK_CNAME   = process.env.KONE_APK_CNAME_DOMAIN || null;

async function handleGetKinoUpgrade() {
    try {
        const result = await pool.query(
            `SELECT version, download_url FROM kone_apk_releases WHERE is_active = true LIMIT 1`
        );
        if (result.rows.length === 0) return { version: '', url: '' };
        const row = result.rows[0];
        return { version: row.version, url: row.download_url };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetKoneApkReleases() {
    try {
        const result = await pool.query(
            `SELECT id, version, oss_key, download_url, notes, is_active, created_at
             FROM kone_apk_releases ORDER BY created_at DESC`
        );
        return { success: true, releases: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostKoneApkRelease(body) {
    const { version, oss_key, download_url, notes } = body;
    if (!version || !oss_key || !download_url) {
        return { success: false, error: 'version, oss_key, and download_url are required' };
    }
    try {
        const result = await pool.query(
            `INSERT INTO kone_apk_releases (version, oss_key, download_url, notes)
             VALUES ($1, $2, $3, $4) RETURNING id`,
            [version, oss_key, download_url, notes || null]
        );
        return { success: true, id: result.rows[0].id };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePutKoneApkRelease(id, body) {
    try {
        const releaseId = parseInt(id);
        if (body.is_active === true) {
            // Clear any existing active release, then activate this one
            await pool.query(`UPDATE kone_apk_releases SET is_active = false`);
            await pool.query(`UPDATE kone_apk_releases SET is_active = true WHERE id = $1`, [releaseId]);
        }
        if (body.notes !== undefined) {
            await pool.query(`UPDATE kone_apk_releases SET notes = $1 WHERE id = $2`, [body.notes, releaseId]);
        }
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleDeleteKoneApkRelease(id) {
    try {
        const releaseId = parseInt(id);
        const check = await pool.query(`SELECT is_active FROM kone_apk_releases WHERE id = $1`, [releaseId]);
        if (check.rows.length === 0) return { success: false, error: 'Release not found' };
        if (check.rows[0].is_active) return { success: false, error: 'Cannot delete the active release' };
        await pool.query(`DELETE FROM kone_apk_releases WHERE id = $1`, [releaseId]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetKoneApkPresign() {
    try {
        const id = crypto.randomBytes(8).toString('hex');
        const key = `apk/${id}.apk`;
        const put_url = ossLib.generatePresignedPutUrl(key, 3600, KONE_APK_BUCKET);
        const get_url = ossLib.generatePresignedGetUrl(key, 315360000, KONE_APK_BUCKET, KONE_APK_CNAME);
        return { success: true, put_url, get_url, key };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetKinoChipBatches() {
    try {
        const result = await pool.query(`
            SELECT b.id, b.prefix, b.model, b.quantity, b.status, b.notes, b.created_at,
                   COUNT(c.id)                                          AS total_chips,
                   COUNT(CASE WHEN c.status = 'available' THEN 1 END)  AS available,
                   COUNT(CASE WHEN c.status = 'used'      THEN 1 END)  AS used,
                   COUNT(CASE WHEN c.status = 'damaged'   THEN 1 END)  AS damaged
            FROM kino_chip_batches b
            LEFT JOIN kino_chips c ON c.batch_id = b.id
            GROUP BY b.id
            ORDER BY b.created_at DESC
        `);
        return { success: true, batches: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetKinoChipBatchChips(batchId, query) {
    try {
        const page  = Math.max(1, parseInt(query.page  || '1'));
        const limit = Math.min(100, parseInt(query.limit || '50'));
        const offset = (page - 1) * limit;
        const rows = await pool.query(
            `SELECT c.id, c.chip_code, c.status, c.created_at,
                    s.scan_status, s.user_id, u.nickname
             FROM kino_chips c
             LEFT JOIN scans  s ON s.chip_id  = c.chip_code
             LEFT JOIN users  u ON u.user_id  = s.user_id
             WHERE c.batch_id = $1
             ORDER BY c.chip_code
             LIMIT $2 OFFSET $3`,
            [parseInt(batchId), limit, offset]
        );
        const cnt = await pool.query(
            'SELECT COUNT(*) FROM kino_chips WHERE batch_id = $1',
            [parseInt(batchId)]
        );
        return { success: true, chips: rows.rows, total: parseInt(cnt.rows[0].count), page, limit };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostKinoChipBatch(body) {
    const { prefix, model, quantity, notes } = body;
    if (!prefix || !prefix.trim()) return { success: false, error: 'prefix is required' };
    if (!model  || !model.trim())  return { success: false, error: 'model is required' };
    const qty = parseInt(quantity);
    if (!qty || qty < 1 || qty > 9999) return { success: false, error: 'quantity must be 1–9999' };

    const cleanPrefix = prefix.trim().toUpperCase();
    if (!/^[A-Z0-9]{3,20}$/.test(cleanPrefix)) return { success: false, error: 'prefix must be 3–20 uppercase letters/digits' };
    const pad = 4;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const batchRes = await client.query(
            `INSERT INTO kino_chip_batches (prefix, model, quantity, notes)
             VALUES ($1, $2, $3, $4) RETURNING id`,
            [cleanPrefix, model.trim(), qty, notes || null]
        );
        const batchId = batchRes.rows[0].id;

        // Insert chips in chunks of 500 rows to avoid huge single queries
        const CHUNK = 500;
        for (let start = 1; start <= qty; start += CHUNK) {
            const end = Math.min(start + CHUNK - 1, qty);
            const vals = [], params = [];
            for (let i = start; i <= end; i++) {
                vals.push(`($${params.length + 1}, $${params.length + 2})`);
                params.push(batchId, `${cleanPrefix}-${String(i).padStart(pad, '0')}`);
            }
            await client.query(
                `INSERT INTO kino_chips (batch_id, chip_code) VALUES ${vals.join(', ')}`,
                params
            );
        }
        await client.query('COMMIT');
        return { success: true, id: batchId, prefix: cleanPrefix, quantity: qty };
    } catch (err) {
        await client.query('ROLLBACK');
        return { success: false, error: err.message };
    } finally {
        client.release();
    }
}

async function handlePutKinoChipBatch(id, body) {
    const { model, notes, status } = body;
    const validStatuses = ['active', 'inactive', 'recalled'];
    if (status !== undefined && !validStatuses.includes(status)) {
        return { success: false, error: `status must be one of: ${validStatuses.join(', ')}` };
    }
    try {
        await pool.query(
            `UPDATE kino_chip_batches
             SET model  = COALESCE($1, model),
                 notes  = $2,
                 status = COALESCE($3, status)
             WHERE id = $4`,
            [model || null, notes ?? null, status || null, parseInt(id)]
        );
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleDeleteKinoChipBatch(id) {
    try {
        const check = await pool.query(
            `SELECT COUNT(*) FROM kino_chips WHERE batch_id = $1 AND status = 'used'`,
            [parseInt(id)]
        );
        if (parseInt(check.rows[0].count) > 0) {
            return { success: false, error: 'Cannot delete a batch with used chips' };
        }
        await pool.query('DELETE FROM kino_chip_batches WHERE id = $1', [parseInt(id)]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetKinoChipModels() {
    try {
        const result = await pool.query(`
            SELECT m.code, m.name, m.biomarker_keys, m.config,
                   m.guide_video, m.guide_text, m.status, m.notes,
                   m.created_at, m.updated_at,
                   COALESCE(b.batch_count, 0)::int  AS batch_count,
                   COALESCE(b.chip_count, 0)::int   AS chip_count
            FROM kino_chip_models m
            LEFT JOIN (
                SELECT cb.model AS code,
                       COUNT(DISTINCT cb.id)::int AS batch_count,
                       COALESCE(SUM(cb.quantity), 0)::int AS chip_count
                FROM kino_chip_batches cb
                GROUP BY cb.model
            ) b ON b.code = m.code
            ORDER BY m.code
        `);
        return { success: true, models: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

function normalizeChipModelInput(body) {
    const out = {};
    if (typeof body.code === 'string') out.code = body.code.trim().toUpperCase();
    if (typeof body.name === 'string') out.name = body.name.trim() || null;
    if (Array.isArray(body.biomarker_keys)) {
        out.biomarker_keys = body.biomarker_keys
            .map(k => typeof k === 'string' ? k.trim() : '')
            .filter(Boolean);
    }
    if (body.config !== undefined) {
        if (typeof body.config === 'string') {
            try { out.config = JSON.parse(body.config); }
            catch (e) { throw new Error('config is not valid JSON: ' + e.message); }
        } else if (typeof body.config === 'object' && body.config !== null) {
            out.config = body.config;
        } else {
            throw new Error('config must be a JSON object');
        }
    }
    if (typeof body.guide_video === 'string') out.guide_video = body.guide_video.trim() || null;
    if (typeof body.guide_text  === 'string') out.guide_text  = body.guide_text.trim()  || null;
    if (typeof body.status      === 'string') out.status      = body.status.trim() || 'active';
    if (typeof body.notes       === 'string') out.notes       = body.notes.trim() || null;
    return out;
}

async function handlePostKinoChipModel(body) {
    try {
        const m = normalizeChipModelInput(body || {});
        if (!m.code) return { success: false, error: 'code is required' };
        if (!/^[A-Z0-9]{1,16}$/.test(m.code)) return { success: false, error: 'code must be 1–16 uppercase letters/digits' };
        if (!Array.isArray(m.biomarker_keys) || m.biomarker_keys.length === 0) {
            return { success: false, error: 'biomarker_keys must be a non-empty array' };
        }
        if (!m.config || typeof m.config !== 'object') {
            return { success: false, error: 'config (JSON object) is required' };
        }
        const result = await pool.query(
            `INSERT INTO kino_chip_models
                (code, name, biomarker_keys, config, guide_video, guide_text, status, notes)
             VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 'active'), $8)
             RETURNING code`,
            [m.code, m.name || null, m.biomarker_keys, m.config,
             m.guide_video || null, m.guide_text || null, m.status, m.notes || null]
        );
        return { success: true, code: result.rows[0].code };
    } catch (err) {
        if (err.code === '23505') return { success: false, error: 'A model with this code already exists' };
        return { success: false, error: err.message };
    }
}

async function handlePutKinoChipModel(code, body) {
    try {
        const m = normalizeChipModelInput(body || {});
        const sets = [];
        const params = [];
        const push = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };

        if ('name'           in m) push('name',           m.name);
        if ('biomarker_keys' in m) push('biomarker_keys', m.biomarker_keys);
        if ('config'         in m) push('config',         m.config);
        if ('guide_video'    in m) push('guide_video',    m.guide_video);
        if ('guide_text'     in m) push('guide_text',     m.guide_text);
        if ('status'         in m) push('status',         m.status);
        if ('notes'          in m) push('notes',          m.notes);

        if (sets.length === 0) return { success: false, error: 'No fields to update' };
        sets.push('updated_at = CURRENT_TIMESTAMP');
        params.push(String(code).toUpperCase());

        const result = await pool.query(
            `UPDATE kino_chip_models SET ${sets.join(', ')} WHERE code = $${params.length} RETURNING code`,
            params
        );
        if (result.rowCount === 0) return { success: false, error: 'Model not found' };
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleDeleteKinoChipModel(code) {
    try {
        const upper = String(code).toUpperCase();
        const ref = await pool.query(
            'SELECT COUNT(*)::int AS n FROM kino_chip_batches WHERE model = $1',
            [upper]
        );
        if (ref.rows[0].n > 0) {
            return { success: false, error: `Cannot delete: ${ref.rows[0].n} batch(es) reference this model` };
        }
        const result = await pool.query(
            'DELETE FROM kino_chip_models WHERE code = $1 RETURNING code',
            [upper]
        );
        if (result.rowCount === 0) return { success: false, error: 'Model not found' };
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetKinoChip(chip_id) {
    if (!chip_id) throw new Error('chip_id is required');

    const batchCheck = await pool.query(
        `SELECT kb.status AS batch_status, kc.status AS chip_status
         FROM kino_chips kc
         JOIN kino_chip_batches kb ON kb.id = kc.batch_id
         WHERE kc.chip_code = $1`,
        [chip_id]
    );
    if (batchCheck.rows.length === 0 || batchCheck.rows[0].batch_status !== 'active') {
        return { found: false };
    }
    const chip_status = batchCheck.rows[0].chip_status;

    const result = await pool.query(
        `SELECT s.id, s.user_id, s.scan_status, u.nickname, u.birth_date, u.gender,
                cb.model,
                m.biomarker_keys, m.config AS chip_config, m.guide_video, m.guide_text
         FROM scans s
         JOIN users u ON u.user_id = s.user_id
         LEFT JOIN kino_chips        c  ON c.chip_code = s.chip_id
         LEFT JOIN kino_chip_batches cb ON cb.id       = c.batch_id
         LEFT JOIN kino_chip_models  m  ON m.code      = cb.model
         WHERE s.chip_id = $1 LIMIT 1`,
        [chip_id]
    );
    if (result.rows.length === 0) {
        // If chip is used but no scan record exists (e.g. manual sync), return used: true
        if (chip_status === 'used') return { found: true, used: true };
        return { found: false };
    }
    const row = result.rows[0];
    return {
        found: true,
        used: row.scan_status === 'completed' || chip_status === 'used',
        scan_id: row.id,
        user_id: row.user_id,
        scan_status: row.scan_status,
        nickname: row.nickname,
        birth_date: row.birth_date || null,
        chrono_age: row.birth_date ? calculateAge(row.birth_date) : null,
        gender: row.gender || null,
        model: row.model || null,
        biomarker_keys: row.biomarker_keys || null,
        chip_config: row.chip_config || null,
        guide_video: row.guide_video || null,
        guide_text: row.guide_text || null,
    };
}

async function handlePostKinoScan(body) {
    const { openid, chip_id } = body;
    if (!openid) throw new Error('openid is required');
    if (!chip_id) throw new Error('chip_id is required');

    const batchCheck = await pool.query(
        `SELECT kb.status AS batch_status, kc.status AS chip_status
         FROM kino_chips kc
         JOIN kino_chip_batches kb ON kb.id = kc.batch_id
         WHERE kc.chip_code = $1`,
        [chip_id]
    );
    if (batchCheck.rows.length === 0 || batchCheck.rows[0].batch_status !== 'active') {
        return { success: false, status: 'invalid_chip' };
    }
    if (batchCheck.rows[0].chip_status === 'used') {
        return { success: false, status: 'used' };
    }

    const userResult = await pool.query(
        'SELECT user_id FROM users WHERE user_id = $1 OR external_id = $1 LIMIT 1',
        [openid]
    );
    if (userResult.rows.length === 0) throw new Error('User not found');
    const user_id = userResult.rows[0].user_id;

    const existing = await pool.query(
        'SELECT id, user_id, scan_status FROM scans WHERE chip_id = $1 LIMIT 1',
        [chip_id]
    );

    if (existing.rows.length > 0) {
        const row = existing.rows[0];
        if (row.scan_status === 'completed') {
            return { success: true, status: 'used', scan_id: row.id };
        }
        if (row.user_id === user_id) {
            return { success: true, status: 'already_linked', scan_id: row.id };
        }
    }

    const result = await pool.query(
        `INSERT INTO scans (user_id, chip_id, scan_status, scan_results)
         VALUES ($1, $2, 'pending', $3)
         ON CONFLICT (chip_id) WHERE chip_id IS NOT NULL DO UPDATE SET user_id = EXCLUDED.user_id, scan_status = 'pending', updated_at = NOW()
         RETURNING id`,
        [user_id, chip_id, JSON.stringify({ chip_id })]
    );
    return { success: true, status: 'registered', scan_id: result.rows[0].id };
}

async function handlePostKinoResult(body) {
    const { chip_id, data, bio_age, kino_device_id } = body;
    if (!chip_id) throw new Error('chip_id is required');
    if (!data) throw new Error('data is required');

    const scanResult = await pool.query(
        'SELECT id, user_id FROM scans WHERE chip_id = $1 LIMIT 1',
        [chip_id]
    );
    if (scanResult.rows.length === 0) throw new Error('No registered scan found for this chip');

    const { id: scan_id, user_id } = scanResult.rows[0];

    await pool.query(
        `UPDATE scans SET scan_status = 'completed', scan_results = $1 WHERE id = $2`,
        [JSON.stringify({ chip_id, ...data }), scan_id]
    );

    await pool.query(
        `UPDATE kino_chips SET status = 'used' WHERE chip_code = $1`,
        [chip_id]
    );

    const bmResult = await pool.query(
        `INSERT INTO biomarkers (user_id, test_type, data, bio_age, tested_at, kino_device_id)
         VALUES ($1, 'kino_chip', $2, $3, NOW(), $4)
         RETURNING id`,
        [user_id, JSON.stringify(data), bio_age ?? null, kino_device_id || null]
    );

    return { success: true, scan_id, biomarker_id: bmResult.rows[0].id, user_id };
}

async function handlePostHealthAdvice(body) {
    const { openid } = body;
    if (!openid) return { success: false, error: 'openid required', statusCode: 400 };

    try {
        const userResult = await pool.query(
            `SELECT user_id, nickname, gender, birth_date, language, bio_data
             FROM users WHERE user_id = $1 OR external_id = $1 LIMIT 1`,
            [openid]
        );
        if (!userResult.rows.length) return { success: false, error: 'User not found', statusCode: 404 };
        const user = userResult.rows[0];
        const user_id = user.user_id;

        const [bioResult, dotsResult, plansResult, twinResult] = await Promise.all([
            pool.query(
                `SELECT bio_age, data FROM biomarkers
                 WHERE user_id = $1 AND test_type = 'kino_chip'
                 ORDER BY tested_at DESC LIMIT 1`,
                [user_id]
            ),
            pool.query(
                `SELECT key_name, name, name_zh, sub_age_target, description, timing
                 FROM dots ORDER BY id ASC`
            ),
            pool.query(
                `SELECT hp.id, hp.plan_type, hp.start_date, hp.duration_weeks,
                        COALESCE(hpt.name_en, hp.custom_name_en) AS name_en,
                        COALESCE(hpt.name_zh, hp.custom_name_zh) AS name_zh,
                        COALESCE(hpt.goal_en, hp.custom_goal_en) AS goal_en,
                        COALESCE(hpt.goal_zh, hp.custom_goal_zh) AS goal_zh,
                        COALESCE(hpt.target_sub_ages, '{}') AS target_sub_ages,
                        (SELECT COUNT(*) FROM health_plan_checkins WHERE plan_id = hp.id) AS checkin_count
                 FROM health_plans hp
                 LEFT JOIN health_plan_templates hpt ON hpt.id = hp.template_id
                 WHERE hp.user_id = $1 AND hp.status = 'active'
                 ORDER BY hp.plan_type ASC LIMIT 2`,
                [user_id]
            ),
            pool.query(
                `SELECT avg_hrv_ms, avg_resting_hr, avg_spo2,
                        avg_sleep_hours, avg_sleep_score, avg_deep_sleep_pct,
                        avg_daily_steps, avg_active_minutes,
                        latest_weight_kg, latest_bmi, latest_body_fat_pct,
                        latest_lab_data, latest_lab_date,
                        trend_data, data_coverage
                 FROM health_twin WHERE user_id = $1`,
                [user_id]
            ),
        ]);

        const activePlans = plansResult.rows;
        const healthTwin = twinResult.rows[0] || null;
        let planTemplates = [];
        if (activePlans.length === 0) {
            const tplResult = await pool.query(
                `SELECT name_en, name_zh, goal_en, goal_zh, desc_en, desc_zh, target_sub_ages, duration_weeks
                 FROM health_plan_templates
                 WHERE channel_id IS NULL OR channel_id = $1
                 ORDER BY sort_order ASC, id ASC`,
                [user.channel_id || null]
            );
            planTemplates = tplResult.rows;
        }

        const latestBio = bioResult.rows[0] || null;
        const bioageProfile = latestBio?.data?.bioage_profile || null;
        const estimatedBm = latestBio?.data?.estimated || {};
        const actualBm = latestBio?.data?.actual || {};
        const biomarkers = { ...estimatedBm, ...actualBm };
        const subAges = bioageProfile?.SubAges || {};
        const bioAge = bioageProfile?.BioAge ?? null;
        const age = calculateAge(user.birth_date);
        const chronoAge = bioageProfile?.ChronoAge ?? age;

        const dotsByDimension = {};
        dotsResult.rows.forEach(d => {
            const t = d.sub_age_target;
            if (!t) return;
            if (!dotsByDimension[t]) dotsByDimension[t] = [];
            dotsByDimension[t].push(d);
        });

        const healthConditions = user.bio_data?.health_conditions || [];
        const healthConditionsOther = user.bio_data?.health_conditions_other || '';
        const isZh = (user.language || 'zh') !== 'en';

        const systemPrompt = systemHealthAdviceTemplate({
            isZh,
            nickname: user.nickname,
            age,
            gender: user.gender,
            bioAge,
            chronoAge,
            subAges,
            biomarkers,
            dotsByDimension,
            healthConditions,
            healthConditionsOther,
            health_twin: healthTwin,
            active_health_plans: activePlans.map(p => ({
                plan_type: p.plan_type,
                name: isZh ? p.name_zh : p.name_en,
                goal: isZh ? p.goal_zh : p.goal_en,
                target_sub_ages: p.target_sub_ages || [],
                weeks_elapsed: Math.max(0, Math.floor((Date.now() - new Date(p.start_date).getTime()) / (7 * 86400000))),
                total_weeks: p.duration_weeks,
                checkin_count: parseInt(p.checkin_count || 0, 10),
            })),
            plan_templates: planTemplates.map(t => ({
                name: isZh ? t.name_zh : t.name_en,
                goal: isZh ? t.goal_zh : t.goal_en,
                desc: isZh ? t.desc_zh : t.desc_en,
                target_sub_ages: t.target_sub_ages || [],
                duration_weeks: t.duration_weeks,
            })),
        });

        const userMsg = isZh
            ? '请分析我目前的健康状态，并给我专业的健康建议。'
            : 'Please analyze my current health status and give me personalized health advice.';

        // Save user trigger to keep conversation history well-formed (no consecutive AI turns)
        await saveChatMessage(user_id, 'user', userMsg);

        const llmClient = getLlmClient();
        const model = process.env.MODEL || 'qwen3.6-plus';
        const completion = await llmClient.chat.completions.create({
            model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMsg },
            ],
        });

        const reply = completion.choices[0].message.content;
        await saveChatMessage(user_id, 'ai', reply);

        return { success: true, message: reply };
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handlePostHealthAdvice failed', error: err.message }));
        return { success: false, error: err.message, statusCode: 500 };
    }
}

async function handlePostAnalyzeImage(body) {
    const { openid, oss_key, filename, get_url } = body;
    if (!openid) return { success: false, error: 'openid required', statusCode: 400 };
    if (!oss_key) return { success: false, error: 'oss_key required', statusCode: 400 };

    try {
        const userResult = await pool.query(
            `SELECT user_id, nickname, gender, birth_date, language FROM users
             WHERE user_id = $1 OR external_id = $1 LIMIT 1`,
            [openid]
        );
        if (!userResult.rows.length) return { success: false, error: 'User not found', statusCode: 404 };
        const user = userResult.rows[0];
        const user_id = user.user_id;
        const isZh = (user.language || 'zh') !== 'en';
        const age = calculateAge(user.birth_date);

        const systemPrompt = systemHealthReportTemplate({
            isZh,
            nickname: user.nickname,
            age,
            gender: user.gender,
        });

        const ext = oss_key.split('.').pop().toLowerCase();
        const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
        const buf = await ossLib.getObjectBuffer(oss_key);
        const imageEntry = { type: 'image_url', image_url: { url: `data:${mime};base64,${buf.toString('base64')}` } };

        const llmClient = getLlmClient();
        const completion = await llmClient.chat.completions.create({
            model: 'qwen-vl-plus',
            messages: [{
                role: 'user',
                content: [imageEntry, { type: 'text', text: systemPrompt }],
            }],
        });

        const rawReply = completion.choices[0].message.content || '';

        const jsonMatch = rawReply.match(/```json\s*([\s\S]*?)```/);
        let extracted = {};
        let abnormalItems = [];
        let reportDate = null;
        let bodyWeightKg = null;
        let bmi = null;

        let contentType = 'health_photo';
        if (jsonMatch) {
            try {
                const parsed = JSON.parse(jsonMatch[1]);
                contentType = parsed.content_type || 'health_photo';
                extracted = parsed.extracted || {};
                abnormalItems = parsed.abnormal_items || [];
                reportDate = parsed.report_date || null;
                bodyWeightKg = parsed.body_weight_kg || null;
                bmi = parsed.bmi || null;
            } catch (e) {
                console.log(JSON.stringify({ level: 'WARN', msg: 'Failed to parse image analysis JSON', error: e.message }));
            }
        }

        const narrative = rawReply.replace(/```json[\s\S]*?```\s*/, '').trim();

        const testType = contentType === 'food_photo' ? 'food_photo'
                       : contentType === 'health_report' ? 'health_checkup_report'
                       : contentType === 'waven_dots' ? 'waven_dots'
                       : 'health_photo';
        const testedAt = reportDate ? new Date(reportDate) : new Date();
        const data = { oss_key, content_type: contentType, extracted, abnormal_items: abnormalItems, report_date: reportDate, ai_analysis: narrative };

        const insertResult = await pool.query(
            `INSERT INTO biomarkers (user_id, test_type, data, bio_age, tested_at)
             VALUES ($1, $2, $3, NULL, $4)
             RETURNING id`,
            [user_id, testType, JSON.stringify(data), testedAt]
        );
        const biomarker_id = insertResult.rows[0].id;

        if (bodyWeightKg) {
            await pool.query(
                `UPDATE users SET bio_data = bio_data || $1::jsonb WHERE user_id = $2`,
                [JSON.stringify({ weight_kg: bodyWeightKg, ...(bmi ? { bmi } : {}) }), user_id]
            );
        }

        const userTrigger = isZh ? '（图片）' : '(image)';
        await saveChatMessage(user_id, 'user', userTrigger, get_url || null);
        await saveChatMessage(user_id, 'ai', narrative);

        console.log(JSON.stringify({ level: 'INFO', msg: 'Image analyzed', user_id, biomarker_id, content_type: contentType }));
        return { success: true, message: narrative, biomarker_id, get_url: get_url || null };
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handlePostAnalyzeImage failed', error: err.message }));
        return { success: false, error: err.message, statusCode: 500 };
    }
}

// ── Health Events & Digital Twin handlers ────────────────────────────────────

const VALID_CATEGORIES = new Set(['sleep', 'activity', 'vitals', 'lab_result', 'body_composition']);

async function handlePostHealthEvent(body) {
    const { openid, category, source, data_date, data, recorded_at, external_id } = body;
    if (!openid) return { success: false, error: 'openid required', statusCode: 400 };
    if (!category || !VALID_CATEGORIES.has(category)) {
        return { success: false, error: `category must be one of: ${[...VALID_CATEGORIES].join(', ')}`, statusCode: 400 };
    }
    if (!source) return { success: false, error: 'source required', statusCode: 400 };
    if (!data_date) return { success: false, error: 'data_date required', statusCode: 400 };
    if (!data || typeof data !== 'object') return { success: false, error: 'data must be an object', statusCode: 400 };
    if (!recorded_at) return { success: false, error: 'recorded_at required', statusCode: 400 };

    try {
        const userResult = await pool.query(
            `SELECT user_id FROM users WHERE user_id = $1 OR external_id = $1 LIMIT 1`,
            [openid]
        );
        if (!userResult.rows.length) return { success: false, error: 'User not found', statusCode: 404 };
        const user_id = userResult.rows[0].user_id;

        const insertResult = await pool.query(`
            INSERT INTO health_events (user_id, source, category, data_date, recorded_at, data, external_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (user_id, source, external_id) WHERE external_id IS NOT NULL DO NOTHING
            RETURNING id
        `, [user_id, source, category, data_date, recorded_at, JSON.stringify(data), external_id || null]);

        const inserted = insertResult.rows.length > 0;
        if (inserted) {
            await updateHealthTwin(user_id, pool);
        }

        return { success: true, id: insertResult.rows[0]?.id ?? null, inserted };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handlePostHealthEvent failed', error: err.message }));
        return { success: false, error: err.message, statusCode: 500 };
    }
}

async function handlePostHealthEventsSync(body) {
    const { openid, events } = body;
    if (!openid) return { success: false, error: 'openid required', statusCode: 400 };
    if (!Array.isArray(events) || events.length === 0) return { success: false, error: 'events array required', statusCode: 400 };
    if (events.length > 500) return { success: false, error: 'max 500 events per sync call', statusCode: 400 };

    try {
        const userResult = await pool.query(
            `SELECT user_id FROM users WHERE user_id = $1 OR external_id = $1 LIMIT 1`,
            [openid]
        );
        if (!userResult.rows.length) return { success: false, error: 'User not found', statusCode: 404 };
        const user_id = userResult.rows[0].user_id;

        let inserted = 0;
        for (const ev of events) {
            if (!ev.category || !VALID_CATEGORIES.has(ev.category) || !ev.source || !ev.data_date || !ev.data || !ev.recorded_at) continue;
            const r = await pool.query(`
                INSERT INTO health_events (user_id, source, category, data_date, recorded_at, data, external_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (user_id, source, external_id) WHERE external_id IS NOT NULL DO NOTHING
                RETURNING id
            `, [user_id, ev.source, ev.category, ev.data_date, ev.recorded_at, JSON.stringify(ev.data), ev.external_id || null]);
            if (r.rows.length > 0) inserted++;
        }

        if (inserted > 0) {
            await updateHealthTwin(user_id, pool);
        }

        return { success: true, inserted, skipped: events.length - inserted };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handlePostHealthEventsSync failed', error: err.message }));
        return { success: false, error: err.message, statusCode: 500 };
    }
}

async function handleGetHealthEvents(query) {
    const { openid, category, from_date, to_date, limit } = query;
    if (!openid) return { success: false, error: 'openid required', statusCode: 400 };

    try {
        const userResult = await pool.query(
            `SELECT user_id FROM users WHERE user_id = $1 OR external_id = $1 LIMIT 1`,
            [openid]
        );
        if (!userResult.rows.length) return { success: false, error: 'User not found', statusCode: 404 };
        const user_id = userResult.rows[0].user_id;

        const params = [user_id];
        const conditions = ['user_id = $1'];
        if (category && VALID_CATEGORIES.has(category)) {
            params.push(category);
            conditions.push(`category = $${params.length}`);
        }
        if (from_date) {
            params.push(from_date);
            conditions.push(`data_date >= $${params.length}`);
        }
        if (to_date) {
            params.push(to_date);
            conditions.push(`data_date <= $${params.length}`);
        }
        const rowLimit = Math.min(parseInt(limit || '30', 10), 200);
        params.push(rowLimit);

        const result = await pool.query(
            `SELECT id, source, category, data_date, recorded_at, data, ingested_at
             FROM health_events
             WHERE ${conditions.join(' AND ')}
             ORDER BY data_date DESC, recorded_at DESC
             LIMIT $${params.length}`,
            params
        );

        return { success: true, events: result.rows };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handleGetHealthEvents failed', error: err.message }));
        return { success: false, error: err.message, statusCode: 500 };
    }
}

async function handleGetHealthTwin(openid) {
    if (!openid) return { success: false, error: 'openid required', statusCode: 400 };

    try {
        const userResult = await pool.query(
            `SELECT user_id FROM users WHERE user_id = $1 OR external_id = $1 LIMIT 1`,
            [openid]
        );
        if (!userResult.rows.length) return { success: false, error: 'User not found', statusCode: 404 };
        const user_id = userResult.rows[0].user_id;

        const result = await pool.query(
            `SELECT * FROM health_twin WHERE user_id = $1`,
            [user_id]
        );

        return { success: true, twin: result.rows[0] || null };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handleGetHealthTwin failed', error: err.message }));
        return { success: false, error: err.message, statusCode: 500 };
    }
}

// ── Academy handlers ──────────────────────────────────────────────────────────

async function handleGetAcademyCourses() {
    try {
        const result = await pool.query(`
            SELECT c.*, COUNT(l.id)::int AS lesson_count
            FROM academy_courses c
            LEFT JOIN academy_lessons l ON l.course_id = c.id
            GROUP BY c.id
            ORDER BY c.sort_order ASC, c.created_at DESC`);
        return { success: true, courses: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostAcademyCourse(body) {
    try {
        const { title, description, oss_key, status, sort_order } = body;
        if (!title) return { success: false, error: 'Title is required' };
        const result = await pool.query(
            'INSERT INTO academy_courses (title, description, oss_key, status, sort_order) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [title, description || null, oss_key || null, status || 'draft', sort_order || 0]
        );
        return { success: true, course: result.rows[0] };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePutAcademyCourse(id, body) {
    try {
        const { title, description, oss_key, status, sort_order } = body;
        const result = await pool.query(
            `UPDATE academy_courses SET
                title       = COALESCE($1, title),
                description = COALESCE($2, description),
                oss_key     = COALESCE($3, oss_key),
                status      = COALESCE($4, status),
                sort_order  = COALESCE($5, sort_order),
                updated_at  = NOW()
             WHERE id = $6 RETURNING *`,
            [title || null, description || null, oss_key || null, status || null, sort_order != null ? sort_order : null, id]
        );
        if (result.rows.length === 0) return { success: false, error: 'Not found' };
        return { success: true, course: result.rows[0] };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleDeleteAcademyCourse(id) {
    try {
        const res = await pool.query('SELECT oss_key FROM academy_courses WHERE id = $1', [id]);
        if (res.rows.length > 0 && res.rows[0].oss_key) {
            await ossLib.deleteObject(res.rows[0].oss_key);
        }
        await pool.query('DELETE FROM academy_courses WHERE id = $1', [id]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetAcademyLibrary() {
    try {
        const result = await pool.query('SELECT * FROM academy_library ORDER BY created_at DESC');
        return { success: true, items: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostAcademyLibraryItem(body) {
    try {
        const { title, oss_key, file_size } = body;
        if (!title || !oss_key) return { success: false, error: 'Title and oss_key are required' };
        const result = await pool.query(
            'INSERT INTO academy_library (title, oss_key, file_size) VALUES ($1, $2, $3) RETURNING *',
            [title, oss_key, file_size || null]
        );
        return { success: true, item: result.rows[0] };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePutAcademyLibraryItem(id, body) {
    try {
        const { title } = body;
        const result = await pool.query(
            'UPDATE academy_library SET title = COALESCE($1, title) WHERE id = $2 RETURNING *',
            [title || null, id]
        );
        if (result.rows.length === 0) return { success: false, error: 'Not found' };
        return { success: true, item: result.rows[0] };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleDeleteAcademyLibraryItem(id) {
    try {
        const res = await pool.query('SELECT oss_key FROM academy_library WHERE id = $1', [id]);
        if (res.rows.length > 0) {
            await ossLib.deleteObject(res.rows[0].oss_key);
        }
        await pool.query('DELETE FROM academy_library WHERE id = $1', [id]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ── Academy Lessons handlers ──────────────────────────────────────────────────

async function handleGetAcademyLessons(courseId) {
    try {
        if (!courseId) return { success: false, error: 'course_id is required' };
        const result = await pool.query(
            'SELECT * FROM academy_lessons WHERE course_id = $1 ORDER BY sort_order ASC, created_at ASC',
            [courseId]
        );
        return { success: true, lessons: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostAcademyLesson(body) {
    try {
        const { course_id, title, description, oss_key, sort_order } = body;
        if (!course_id || !title) return { success: false, error: 'course_id and title are required' };
        const result = await pool.query(
            'INSERT INTO academy_lessons (course_id, title, description, oss_key, sort_order) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [course_id, title, description || null, oss_key || null, sort_order || 0]
        );
        return { success: true, lesson: result.rows[0] };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePutAcademyLesson(id, body) {
    try {
        const { title, description, oss_key, sort_order } = body;
        const result = await pool.query(
            `UPDATE academy_lessons SET
                title       = COALESCE($1, title),
                description = COALESCE($2, description),
                oss_key     = COALESCE($3, oss_key),
                sort_order  = COALESCE($4, sort_order)
             WHERE id = $5 RETURNING *`,
            [title || null, description || null, oss_key || null, sort_order != null ? sort_order : null, id]
        );
        if (result.rows.length === 0) return { success: false, error: 'Not found' };
        return { success: true, lesson: result.rows[0] };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleDeleteAcademyLesson(id) {
    try {
        const res = await pool.query('SELECT oss_key FROM academy_lessons WHERE id = $1', [id]);
        if (res.rows.length > 0 && res.rows[0].oss_key) {
            await ossLib.deleteObject(res.rows[0].oss_key);
        }
        await pool.query('DELETE FROM academy_lessons WHERE id = $1', [id]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ── Academy Progress handlers ─────────────────────────────────────────────────

async function handleGetAcademyProgress(coachUserId) {
    try {
        if (!coachUserId) return { success: false, error: 'coach_user_id is required' };
        const result = await pool.query(
            'SELECT lesson_id, completed_at FROM academy_coach_progress WHERE coach_user_id = $1',
            [coachUserId]
        );
        return { success: true, progress: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostAcademyProgress(body) {
    try {
        const { coach_user_id, lesson_id } = body;
        if (!coach_user_id || !lesson_id) return { success: false, error: 'coach_user_id and lesson_id are required' };
        await pool.query(
            'INSERT INTO academy_coach_progress (coach_user_id, lesson_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [coach_user_id, lesson_id]
        );
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetAcademyCourseProgress() {
    try {
        const result = await pool.query(`
            SELECT
                c.id AS course_id,
                c.title,
                COUNT(DISTINCT l.id)::int AS total_lessons,
                COUNT(DISTINCT p.coach_user_id)::int AS coaches_completed,
                COUNT(DISTINCT p.lesson_id)::int AS total_completions
            FROM academy_courses c
            LEFT JOIN academy_lessons l ON l.course_id = c.id
            LEFT JOIN academy_coach_progress p ON p.lesson_id = l.id
            GROUP BY c.id, c.title
            ORDER BY c.sort_order ASC, c.created_at DESC`);
        return { success: true, progress: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ── Academy Library content proxy ─────────────────────────────────────────────

async function handleGetAcademyLibraryContent(id) {
    try {
        const res = await pool.query('SELECT oss_key FROM academy_library WHERE id = $1', [id]);
        if (res.rows.length === 0) return { success: false, error: 'Not found', statusCode: 404 };
        const buf = await ossLib.getObjectBuffer(res.rows[0].oss_key);
        return { success: true, content: buf.toString('utf8'), _rawText: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ── Tickets ───────────────────────────────────────────────────────────────────

const TICKET_STATUSES   = new Set(['open', 'in_progress', 'resolved', 'closed']);
const TICKET_PRIORITIES = new Set(['low', 'normal', 'high']);

async function handleGetTickets(channelId) {
    try {
        if (channelId) {
            const result = await pool.query(
                `SELECT t.id, t.title, t.description, t.status, t.priority, t.images, t.reporter, t.created_at, t.updated_at
                 FROM tickets t
                 JOIN users u ON u.external_id = t.reporter
                 WHERE u.channel_id = $1
                 ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'resolved' THEN 2 ELSE 3 END, t.created_at DESC`,
                [channelId]
            );
            return { success: true, tickets: result.rows };
        }
        const result = await pool.query(
            `SELECT id, title, description, status, priority, images, reporter, created_at, updated_at
             FROM tickets ORDER BY
                 CASE status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'resolved' THEN 2 ELSE 3 END,
                 created_at DESC`
        );
        return { success: true, tickets: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

function normalizeTicketInput(body) {
    const out = {};
    if (typeof body.title       === 'string') out.title       = body.title.trim();
    if (typeof body.description === 'string') out.description = body.description.trim() || null;
    if (typeof body.status      === 'string') {
        const s = body.status.trim();
        if (!TICKET_STATUSES.has(s)) throw new Error(`Invalid status: ${s}`);
        out.status = s;
    }
    if (typeof body.priority    === 'string') {
        const p = body.priority.trim();
        if (!TICKET_PRIORITIES.has(p)) throw new Error(`Invalid priority: ${p}`);
        out.priority = p;
    }
    if (Array.isArray(body.images)) {
        out.images = body.images.filter(k => typeof k === 'string' && k.trim()).map(k => k.trim());
    }
    if (typeof body.reporter    === 'string') out.reporter    = body.reporter.trim() || null;
    return out;
}

async function handlePostTicket(body) {
    try {
        const t = normalizeTicketInput(body || {});
        if (!t.title) return { success: false, error: 'title is required' };
        const result = await pool.query(
            `INSERT INTO tickets (title, description, status, priority, images, reporter)
             VALUES ($1, $2, COALESCE($3, 'open'), COALESCE($4, 'normal'), COALESCE($5, ARRAY[]::TEXT[]), $6)
             RETURNING *`,
            [t.title, t.description || null, t.status, t.priority, t.images || null, t.reporter || null]
        );
        return { success: true, ticket: result.rows[0] };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePutTicket(id, body) {
    try {
        const t = normalizeTicketInput(body || {});
        const sets = [];
        const params = [];
        const push = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };

        if ('title'       in t) {
            if (!t.title) return { success: false, error: 'title cannot be empty' };
            push('title', t.title);
        }
        if ('description' in t) push('description', t.description);
        if ('status'      in t) push('status',      t.status);
        if ('priority'    in t) push('priority',    t.priority);
        if ('images'      in t) push('images',      t.images);
        if ('reporter'    in t) push('reporter',    t.reporter);

        if (sets.length === 0) return { success: false, error: 'No fields to update' };
        sets.push('updated_at = CURRENT_TIMESTAMP');
        params.push(parseInt(id));

        const result = await pool.query(
            `UPDATE tickets SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
            params
        );
        if (result.rowCount === 0) return { success: false, error: 'Ticket not found' };
        return { success: true, ticket: result.rows[0] };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleDeleteTicket(id) {
    try {
        const res = await pool.query('SELECT images FROM tickets WHERE id = $1', [parseInt(id)]);
        if (res.rows.length === 0) return { success: false, error: 'Ticket not found' };
        const images = res.rows[0].images || [];
        for (const key of images) {
            await ossLib.deleteObject(key);
        }
        await pool.query('DELETE FROM tickets WHERE id = $1', [parseInt(id)]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetOssPresign(query) {
    try {
        const { type, filename, action, key: existingKey, category } = query;
        if (action === 'get' && existingKey) {
            const url = ossLib.generatePresignedGetUrl(existingKey, 3600);
            return { success: true, url };
        }
        if (!filename) return { success: false, error: 'filename is required' };
        const key = ossLib.generateKey(type || 'misc', filename, category || 'academy');
        const put_url = ossLib.generatePresignedPutUrl(key, 3600);
        const get_url = ossLib.generatePresignedGetUrl(key, 315360000); // 10 years
        return { success: true, url: put_url, put_url, get_url, key };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Questionnaire System Handlers
// ─────────────────────────────────────────────────────────────────────────────

// Helper: get nested value from object by dot-path (e.g. "actual.weight")
function getNestedPath(obj, dotPath) {
    return dotPath.split('.').reduce((cur, k) => (cur != null ? cur[k] : undefined), obj);
}

function formatQuestionnaireContext(rows, language) {
    if (!rows || rows.length === 0) return null;
    const isZh = language === 'zh';
    const grouped = {};
    for (const r of rows) {
        const qName = isZh ? (r.name_zh || r.name) : r.name;
        if (!grouped[qName]) grouped[qName] = [];
        let answer = r.answer;
        if (Array.isArray(answer)) answer = answer.join(', ');
        else if (typeof answer === 'object' && answer !== null) answer = Object.entries(answer).map(([k, v]) => `${k}: ${v}`).join(', ');
        else answer = String(answer ?? '—');
        const question = isZh ? (r.prompt_zh || r.prompt_en) : (r.prompt_en || r.prompt_zh);
        grouped[qName].push(`  ${question}: ${answer}`);
    }
    const lines = [isZh ? '用户问卷回答（由护理团队收集）：' : 'QUESTIONNAIRE RESPONSES (collected by care team):'];
    for (const [name, items] of Object.entries(grouped)) {
        lines.push(`[${name}]`);
        lines.push(...items);
    }
    return lines.join('\n');
}

// GET /api/pending-questionnaires?openid={user_id}
// Returns all incomplete questionnaire assignments for the user with full question lists.
// Auto-creates onboarding assignment for new users.
async function handleGetPendingQuestionnaires(openid) {
    if (!openid) return { success: false, error: 'openid required' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };

        // Get user to find channel_id
        const userRes = await pool.query('SELECT user_id, channel_id FROM users WHERE user_id = $1', [openid]);
        if (!userRes.rows.length) return { success: false, error: 'User not found' };
        const { channel_id } = userRes.rows[0];

        // Auto-create onboarding assignment if missing
        const existingOb = await pool.query(
            `SELECT qa.id FROM questionnaire_assignments qa
             JOIN questionnaires q ON qa.questionnaire_id = q.id
             WHERE qa.user_id = $1 AND q.type = 'onboarding'
             LIMIT 1`,
            [openid]
        );
        if (!existingOb.rows.length) {
            // Find active onboarding questionnaire for this channel (channel-specific wins over global)
            const obQ = await pool.query(
                `SELECT id FROM questionnaires
                 WHERE type = 'onboarding' AND is_active = true
                   AND (channel_id = $1 OR channel_id IS NULL)
                 ORDER BY CASE WHEN channel_id IS NOT NULL THEN 0 ELSE 1 END
                 LIMIT 1`,
                [channel_id]
            );
            if (obQ.rows.length) {
                await pool.query(
                    `INSERT INTO questionnaire_assignments (questionnaire_id, user_id, assigned_by, status)
                     VALUES ($1, $2, NULL, 'pending')`,
                    [obQ.rows[0].id, openid]
                );
            }
        }

        // Fetch all non-completed assignments with questionnaire metadata
        const assignmentsRes = await pool.query(
            `SELECT qa.id AS assignment_id, qa.status, qa.assigned_at, qa.started_at,
                    q.id AS questionnaire_id, q.name, q.name_zh, q.type, q.channel_id,
                    q.description, q.description_zh
             FROM questionnaire_assignments qa
             JOIN questionnaires q ON qa.questionnaire_id = q.id
             WHERE qa.user_id = $1 AND qa.status != 'completed' AND q.is_active = true
             ORDER BY
               CASE WHEN q.type = 'onboarding' THEN 0 ELSE 1 END,
               qa.assigned_at ASC`,
            [openid]
        );

        const assignments = [];
        for (const row of assignmentsRes.rows) {
            // Fetch active questions for this questionnaire
            const questionsRes = await pool.query(
                `SELECT id, key, sort_order, input_type, prompt_zh, prompt_en,
                        save_target, save_field, save_biomarker_type, completion_check, config
                 FROM questionnaire_questions
                 WHERE questionnaire_id = $1 AND is_active = true
                 ORDER BY sort_order ASC`,
                [row.questionnaire_id]
            );
            // Fetch existing responses for this assignment
            const responsesRes = await pool.query(
                `SELECT question_id, answer FROM questionnaire_responses
                 WHERE assignment_id = $1`,
                [row.assignment_id]
            );
            assignments.push({
                assignment_id: row.assignment_id,
                status: row.status,
                assigned_at: row.assigned_at,
                started_at: row.started_at,
                questionnaire_id: row.questionnaire_id,
                name: row.name,
                name_zh: row.name_zh,
                type: row.type,
                description: row.description,
                description_zh: row.description_zh,
                questions: questionsRes.rows,
                responses: responsesRes.rows,
            });
        }

        return { success: true, assignments };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// POST /api/questionnaire-responses
// Saves one answer. If question has save_target, also writes to user profile.
// Marks assignment completed when all questions answered.
async function handlePostQuestionnaireResponse(body) {
    const { assignment_id, question_id, answer } = body || {};
    if (!assignment_id || !question_id || answer === undefined) {
        return { statusCode: 400, success: false, error: 'assignment_id, question_id and answer required' };
    }
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };

        // Validate assignment exists and get user_id
        const assignRes = await pool.query(
            `SELECT qa.user_id, qa.questionnaire_id FROM questionnaire_assignments qa WHERE qa.id = $1`,
            [assignment_id]
        );
        if (!assignRes.rows.length) return { statusCode: 404, success: false, error: 'Assignment not found' };
        const { user_id, questionnaire_id } = assignRes.rows[0];

        // Get question config for save_target handling + prompt text for chat history
        const qRes = await pool.query(
            `SELECT save_target, save_field, save_biomarker_type, prompt_zh, prompt_en FROM questionnaire_questions WHERE id = $1`,
            [question_id]
        );
        if (!qRes.rows.length) return { statusCode: 404, success: false, error: 'Question not found' };
        const { save_target, save_field, save_biomarker_type, prompt_zh, prompt_en } = qRes.rows[0];

        // Get user language to pick the right question prompt
        const userLangRes = await pool.query(`SELECT language FROM users WHERE user_id = $1`, [user_id]);
        const userLang = userLangRes.rows[0]?.language || 'zh';
        const questionText = userLang === 'en' ? prompt_en : prompt_zh;

        // Save question + answer to chat history
        await saveChatMessage(user_id, 'ai', questionText);
        const answerDisplay = body.answer_display != null ? String(body.answer_display) : JSON.stringify(answer);
        await saveChatMessage(user_id, 'user', answerDisplay);

        // Upsert response
        await pool.query(
            `INSERT INTO questionnaire_responses (assignment_id, question_id, answer)
             VALUES ($1, $2, $3)
             ON CONFLICT (assignment_id, question_id) DO UPDATE SET answer = EXCLUDED.answer, answered_at = CURRENT_TIMESTAMP`,
            [assignment_id, question_id, JSON.stringify(answer)]
        );

        // Write to user profile if save_target is set
        if (save_target === 'user_field' && save_field) {
            await pool.query(
                `UPDATE users SET ${save_field} = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2`,
                [answer, user_id]
            );
        } else if (save_target === 'bio_data_field' && save_field) {
            const bioUpdate = {};
            bioUpdate[save_field] = answer;
            await pool.query(
                `UPDATE users SET bio_data = bio_data || $1::jsonb, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2`,
                [JSON.stringify(bioUpdate), user_id]
            );
        } else if (save_target === 'biomarker' && save_biomarker_type) {
            await pool.query(
                `INSERT INTO biomarkers (user_id, test_type, data, tested_at)
                 VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
                [user_id, save_biomarker_type, JSON.stringify({ actual: answer })]
            );
        }

        // Mark assignment in_progress if pending
        await pool.query(
            `UPDATE questionnaire_assignments SET status = 'in_progress', started_at = COALESCE(started_at, CURRENT_TIMESTAMP)
             WHERE id = $1 AND status = 'pending'`,
            [assignment_id]
        );

        // Check if all active questions now have responses → mark completed
        const totalRes = await pool.query(
            `SELECT COUNT(*) FROM questionnaire_questions WHERE questionnaire_id = $1 AND is_active = true`,
            [questionnaire_id]
        );
        const answeredRes = await pool.query(
            `SELECT COUNT(*) FROM questionnaire_responses WHERE assignment_id = $1`,
            [assignment_id]
        );
        const total = parseInt(totalRes.rows[0].count);
        const answered = parseInt(answeredRes.rows[0].count);
        if (answered >= total) {
            await pool.query(
                `UPDATE questionnaire_assignments SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = $1`,
                [assignment_id]
            );
        }

        return { success: true, completed: answered >= total };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// PATCH /api/questionnaire-assignments/:id
async function handlePatchQuestionnaireAssignment(id, body) {
    const { status } = body || {};
    if (!status) return { statusCode: 400, success: false, error: 'status required' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const fields = ['status = $1'];
        const params = [status];
        if (status === 'in_progress') { fields.push('started_at = COALESCE(started_at, CURRENT_TIMESTAMP)'); }
        if (status === 'completed')   { fields.push('completed_at = CURRENT_TIMESTAMP'); }
        params.push(parseInt(id));
        await pool.query(
            `UPDATE questionnaire_assignments SET ${fields.join(', ')} WHERE id = $${params.length}`,
            params
        );
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ── Admin: Questionnaire CRUD ─────────────────────────────────────────────────

async function handleGetQuestionnaires(query) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const conditions = [];
        const params = [];
        if (query.channel_id) {
            if (query.channel_id === 'global') {
                conditions.push(`q.channel_id IS NULL`);
            } else {
                params.push(parseInt(query.channel_id));
                conditions.push(`(q.channel_id = $${params.length} OR q.channel_id IS NULL)`);
            }
        }
        if (query.type) { params.push(query.type); conditions.push(`q.type = $${params.length}`); }
        const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
        const res = await pool.query(
            `SELECT q.id, q.channel_id, q.name, q.name_zh, q.description, q.description_zh,
                    q.type, q.is_active, q.created_at, q.updated_at,
                    c.name AS channel_name,
                    (SELECT COUNT(*) FROM questionnaire_questions qq WHERE qq.questionnaire_id = q.id AND qq.is_active = true) AS question_count
             FROM questionnaires q
             LEFT JOIN channels c ON q.channel_id = c.id
             ${where}
             ORDER BY q.type ASC, q.created_at DESC`,
            params
        );
        return { success: true, questionnaires: res.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGenerateQuestionnaire(body) {
    const { topic } = body || {};
    if (!topic || !topic.trim()) return { statusCode: 400, success: false, error: 'topic required' };
    const systemPrompt = `You are a health questionnaire designer for a longevity wellness platform. Generate a structured health questionnaire based on the given topic.

Return ONLY valid JSON with no markdown fences, no explanation, no preamble. Use this exact shape:
{
  "name": "Questionnaire name in English",
  "name_zh": "问卷名称（中文）",
  "description": "One-sentence description in English",
  "description_zh": "一句话描述（中文）",
  "questions": [
    {
      "key": "snake_case_unique_key",
      "prompt_en": "Question text in English",
      "prompt_zh": "问题（中文）",
      "input_type": "text|button_select|date_picker|slider_group|multi_select",
      "config": {}
    }
  ]
}

Config shape per input_type:
- text: {}
- button_select: {"options":[{"label":"Option","label_zh":"选项","value":"value"}]}
- date_picker: {"mode":"date","min_date":"1900-01-01","max_date":"today"}
- slider_group: {"sliders":[{"key":"slug","label":"Label","label_zh":"标签","unit":"unit","min":0,"max":200,"step":1,"default":70}]}
- multi_select: {"options":[{"label":"Option","label_zh":"选项","value":"value"}]}

Rules: 3–8 questions; choose input_type that best fits each question; button_select/multi_select must have 3–7 options; all text in both EN and ZH; keys must be unique snake_case.`;
    try {
        const llmClient = getLlmClient();
        const model = process.env.MODEL || 'qwen3.6-plus';
        const completion = await llmClient.chat.completions.create({
            model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `Topic: ${topic.trim()}` },
            ],
        });
        let text = (completion.choices[0].message.content || '').trim();
        // Strip markdown fences if present
        text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        let generated;
        try { generated = JSON.parse(text); }
        catch (e) { return { statusCode: 502, success: false, error: 'LLM returned invalid JSON', raw: text.slice(0, 500) }; }
        return { success: true, questionnaire: generated };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handleGenerateQuestionnaire', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

async function handlePostQuestionnaire(body) {
    const { name, name_zh, description, description_zh, type = 'custom', channel_id, created_by } = body || {};
    if (!name) return { statusCode: 400, success: false, error: 'name required' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const res = await pool.query(
            `INSERT INTO questionnaires (name, name_zh, description, description_zh, type, channel_id, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [name, name_zh || null, description || null, description_zh || null, type, channel_id || null, created_by || null]
        );
        return { success: true, questionnaire: res.rows[0] };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePutQuestionnaire(id, body) {
    const { name, name_zh, description, description_zh, type, channel_id, is_active } = body || {};
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const res = await pool.query(
            `UPDATE questionnaires
             SET name = COALESCE($1, name), name_zh = COALESCE($2, name_zh),
                 description = COALESCE($3, description), description_zh = COALESCE($4, description_zh),
                 type = COALESCE($5, type), channel_id = $6,
                 is_active = COALESCE($7, is_active), updated_at = CURRENT_TIMESTAMP
             WHERE id = $8 RETURNING *`,
            [name || null, name_zh || null, description || null, description_zh || null,
             type || null, channel_id !== undefined ? (channel_id || null) : undefined,
             is_active !== undefined ? is_active : null, parseInt(id)]
        );
        if (!res.rows.length) return { statusCode: 404, success: false, error: 'Questionnaire not found' };
        return { success: true, questionnaire: res.rows[0] };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleDeleteQuestionnaire(id) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        await pool.query(`UPDATE questionnaires SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [parseInt(id)]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ── Admin: Questions within a questionnaire ───────────────────────────────────

async function handleGetQuestionnaireQuestions(questionnaire_id) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const res = await pool.query(
            `SELECT * FROM questionnaire_questions WHERE questionnaire_id = $1 ORDER BY sort_order ASC`,
            [parseInt(questionnaire_id)]
        );
        return { success: true, questions: res.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostQuestionnaireQuestion(questionnaire_id, body) {
    const { key, sort_order = 0, input_type, prompt_zh, prompt_en,
            save_target, save_field, save_biomarker_type, completion_check = {}, config = {} } = body || {};
    if (!key || !input_type || !prompt_zh || !prompt_en) {
        return { statusCode: 400, success: false, error: 'key, input_type, prompt_zh, prompt_en required' };
    }
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const res = await pool.query(
            `INSERT INTO questionnaire_questions
             (questionnaire_id, key, sort_order, input_type, prompt_zh, prompt_en,
              save_target, save_field, save_biomarker_type, completion_check, config)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
            [parseInt(questionnaire_id), key, sort_order, input_type, prompt_zh, prompt_en,
             save_target || null, save_field || null, save_biomarker_type || null,
             JSON.stringify(completion_check), JSON.stringify(config)]
        );
        return { success: true, question: res.rows[0] };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePutQuestionnaireQuestion(id, body) {
    const { key, sort_order, input_type, prompt_zh, prompt_en, is_active,
            save_target, save_field, save_biomarker_type, completion_check, config } = body || {};
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const sets = []; const params = [];
        const push = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
        if (key           !== undefined) push('key',                key);
        if (sort_order    !== undefined) push('sort_order',         sort_order);
        if (input_type    !== undefined) push('input_type',         input_type);
        if (prompt_zh     !== undefined) push('prompt_zh',          prompt_zh);
        if (prompt_en     !== undefined) push('prompt_en',          prompt_en);
        if (is_active     !== undefined) push('is_active',          is_active);
        if (save_target   !== undefined) push('save_target',        save_target || null);
        if (save_field    !== undefined) push('save_field',         save_field || null);
        if (save_biomarker_type !== undefined) push('save_biomarker_type', save_biomarker_type || null);
        if (completion_check !== undefined) push('completion_check', JSON.stringify(completion_check));
        if (config        !== undefined) push('config',             JSON.stringify(config));
        if (!sets.length) return { success: false, error: 'No fields to update' };
        params.push(parseInt(id));
        const res = await pool.query(
            `UPDATE questionnaire_questions SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
            params
        );
        if (!res.rows.length) return { statusCode: 404, success: false, error: 'Question not found' };
        return { success: true, question: res.rows[0] };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleDeleteQuestionnaireQuestion(id) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        await pool.query(`UPDATE questionnaire_questions SET is_active = false WHERE id = $1`, [parseInt(id)]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePutQuestionnaireQuestionsReorder(body) {
    const { items } = body || {};  // [{ id, sort_order }]
    if (!Array.isArray(items) || !items.length) {
        return { statusCode: 400, success: false, error: 'items array required' };
    }
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        for (const { id, sort_order } of items) {
            await pool.query(
                `UPDATE questionnaire_questions SET sort_order = $1 WHERE id = $2`,
                [sort_order, parseInt(id)]
            );
        }
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ── Admin + Coach: Assignments ────────────────────────────────────────────────

async function handlePostQuestionnaireAssignment(body) {
    const { questionnaire_id, user_ids, assigned_by } = body || {};
    if (!questionnaire_id || !Array.isArray(user_ids) || !user_ids.length) {
        return { statusCode: 400, success: false, error: 'questionnaire_id and user_ids array required' };
    }
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const created = [];
        for (const uid of user_ids) {
            const res = await pool.query(
                `INSERT INTO questionnaire_assignments (questionnaire_id, user_id, assigned_by, status)
                 VALUES ($1, $2, $3, 'pending') RETURNING id`,
                [parseInt(questionnaire_id), uid, assigned_by || null]
            );
            created.push(res.rows[0].id);
        }
        return { success: true, assignment_ids: created };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetQuestionnaireAssignments(query) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const conditions = []; const params = [];
        if (query.user_id)          { params.push(query.user_id);                conditions.push(`qa.user_id = $${params.length}`); }
        if (query.questionnaire_id) { params.push(parseInt(query.questionnaire_id)); conditions.push(`qa.questionnaire_id = $${params.length}`); }
        if (query.status)           { params.push(query.status);                  conditions.push(`qa.status = $${params.length}`); }
        const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
        const res = await pool.query(
            `SELECT qa.id, qa.questionnaire_id, qa.user_id, qa.assigned_by, qa.status,
                    qa.assigned_at, qa.started_at, qa.completed_at,
                    q.name, q.name_zh, q.type,
                    u.nickname AS user_nickname, u.language AS user_language,
                    ab.nickname AS assigned_by_name
             FROM questionnaire_assignments qa
             JOIN questionnaires q ON qa.questionnaire_id = q.id
             JOIN users u ON qa.user_id = u.user_id
             LEFT JOIN users ab ON ab.user_id = qa.assigned_by
             ${where}
             ORDER BY qa.assigned_at DESC`,
            params
        );
        return { success: true, assignments: res.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// GET /api/questionnaire-responses?assignment_id=&user_id=
async function handleGetQuestionnaireResponses(query) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const conditions = []; const params = [];
        if (query.assignment_id) { params.push(parseInt(query.assignment_id)); conditions.push(`qr.assignment_id = $${params.length}`); }
        if (query.user_id)       { params.push(query.user_id); conditions.push(`qa.user_id = $${params.length}`); }
        if (!conditions.length) return { statusCode: 400, success: false, error: 'assignment_id or user_id required' };
        const where = 'WHERE ' + conditions.join(' AND ');
        const res = await pool.query(
            `SELECT qr.id, qr.assignment_id, qr.question_id, qr.answer, qr.answered_at,
                    qq.key, qq.input_type, qq.prompt_zh, qq.prompt_en
             FROM questionnaire_responses qr
             JOIN questionnaire_assignments qa ON qr.assignment_id = qa.id
             JOIN questionnaire_questions qq ON qr.question_id = qq.id
             ${where}
             ORDER BY qr.assignment_id, qq.sort_order`,
            params
        );
        return { success: true, responses: res.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ── Admin: Saved Reports ──────────────────────────────────────────────────────

async function handleGetSavedReports() {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const result = await pool.query(
            `SELECT id, title, query, sql, chart, insights, columns, data, created_by, updated_by, created_at, updated_at
             FROM saved_reports ORDER BY updated_at DESC`
        );
        return { success: true, reports: result.rows };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handleGetSavedReports', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

async function handlePostSavedReport(body) {
    const { title, query, sql, chart, insights, columns, data, created_by } = body || {};
    if (!title || !query || !sql) return { statusCode: 400, success: false, error: 'title, query, and sql are required' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const result = await pool.query(
            `INSERT INTO saved_reports (title, query, sql, chart, insights, columns, data, created_by, updated_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
             RETURNING id, title, query, sql, chart, insights, columns, data, created_by, updated_by, created_at, updated_at`,
            [title, query, sql, JSON.stringify(chart) || null, insights || '', JSON.stringify(columns) || null, JSON.stringify(data) || null, created_by || null]
        );
        console.log(JSON.stringify({ level: 'INFO', msg: 'handlePostSavedReport', id: result.rows[0].id, title }));
        return { success: true, report: result.rows[0] };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handlePostSavedReport', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

async function handlePutSavedReport(id, body) {
    const { title, query, sql, chart, insights, columns, data, updated_by } = body || {};
    if (!title) return { statusCode: 400, success: false, error: 'title is required' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const result = await pool.query(
            `UPDATE saved_reports
             SET title=$1, query=$2, sql=$3, chart=$4, insights=$5, columns=$6, data=$7, updated_by=$8, updated_at=NOW()
             WHERE id=$9
             RETURNING id, title, query, sql, chart, insights, columns, data, created_by, updated_by, created_at, updated_at`,
            [title, query || '', sql || '', JSON.stringify(chart) || null, insights || '', JSON.stringify(columns) || null, JSON.stringify(data) || null, updated_by || null, id]
        );
        if (result.rows.length === 0) return { statusCode: 404, success: false, error: 'Report not found' };
        console.log(JSON.stringify({ level: 'INFO', msg: 'handlePutSavedReport', id, title }));
        return { success: true, report: result.rows[0] };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handlePutSavedReport', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

async function handleDeleteSavedReport(id) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        await pool.query('DELETE FROM saved_reports WHERE id=$1', [id]);
        console.log(JSON.stringify({ level: 'INFO', msg: 'handleDeleteSavedReport', id }));
        return { success: true };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handleDeleteSavedReport', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

// ── Admin: AI Report Engine ───────────────────────────────────────────────────

async function handlePostAdminReport(body) {
    const { query, history = [] } = body || {};
    if (!query || !query.trim()) {
        return { statusCode: 400, success: false, error: 'query is required' };
    }

    const BLOCKED = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|EXECUTE|CALL|MERGE|COPY)\b/i;

    try {
        const llmClient = getLlmClient();
        const model = process.env.MODEL || 'qwen-plus-latest';
        const messages = [
            { role: 'system', content: systemAdminReportTemplate() },
            ...((history || []).slice(-12)),
            { role: 'user', content: query.trim() },
        ];

        let llmText;
        try {
            const completion = await Promise.race([
                llmClient.chat.completions.create({ model, messages }),
                new Promise((_, rej) => setTimeout(() => rej(new Error('LLM timeout')), 8000)),
            ]);
            llmText = (completion.choices[0].message.content || '').trim();
        } catch (e) {
            console.log(JSON.stringify({ level: 'ERROR', msg: 'handlePostAdminReport/llm', error: e.message }));
            return { statusCode: 502, success: false, error: `LLM error: ${e.message}` };
        }

        let parsed;
        try {
            const cleaned = llmText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
            parsed = JSON.parse(cleaned);
        } catch (e) {
            console.log(JSON.stringify({ level: 'ERROR', msg: 'handlePostAdminReport/parse', raw: llmText.slice(0, 300) }));
            return { statusCode: 502, success: false, error: 'LLM returned invalid JSON', raw: llmText.slice(0, 300) };
        }

        const { title, sql, chart, insights } = parsed;

        if (!sql || !sql.trim()) {
            return { success: true, title: title || 'Report', sql: '', data: [], columns: [], chart: null, insights: insights || '' };
        }

        const sqlTrimmed = sql.trim();
        if (!/^(SELECT|WITH)\s/i.test(sqlTrimmed)) {
            return { statusCode: 400, success: false, error: 'Only SELECT queries are permitted.' };
        }
        if (BLOCKED.test(sqlTrimmed)) {
            console.log(JSON.stringify({ level: 'WARN', msg: 'handlePostAdminReport/blocked', sql: sqlTrimmed.slice(0, 200) }));
            return { statusCode: 400, success: false, error: 'Query contains disallowed SQL operations.' };
        }

        let safeSql = sqlTrimmed.replace(/;?\s*$/, '');
        if (!/LIMIT\s+\d+/i.test(safeSql)) safeSql += ' LIMIT 500';

        let qr;
        try {
            qr = await pool.query(safeSql);
        } catch (e) {
            console.log(JSON.stringify({ level: 'ERROR', msg: 'handlePostAdminReport/sql', error: e.message }));
            return { statusCode: 422, success: false, error: `SQL error: ${e.message}`, sql: safeSql };
        }

        const rows = qr.rows;
        const columns = rows.length > 0
            ? Object.keys(rows[0])
            : (qr.fields || []).map(f => f.name);

        const safeRows = rows.map(row => {
            const r = {};
            for (const [k, v] of Object.entries(row)) r[k] = typeof v === 'bigint' ? String(v) : v;
            return r;
        });

        console.log(JSON.stringify({ level: 'INFO', msg: 'handlePostAdminReport', query: query.slice(0, 100), rows: rows.length }));

        return { success: true, title: title || 'Report', sql: safeSql, data: safeRows, columns, chart: chart || null, insights: insights || '' };

    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handlePostAdminReport', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

// ── Health Plan System ────────────────────────────────────────────────────────

async function handleGetHealthPlanTemplates(query) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const includeInactive = query.all === 'true';
        const channelId = query.channel_id ? parseInt(query.channel_id, 10) : null;
        const params = [];
        let whereClause = channelId
            ? `WHERE (hpt.channel_id IS NULL OR hpt.channel_id = $1)` + (includeInactive ? '' : ` AND hpt.is_active = true`)
            : `WHERE hpt.channel_id IS NULL` + (includeInactive ? '' : ` AND hpt.is_active = true`);
        if (channelId) params.push(channelId);
        const result = await pool.query(
            `SELECT hpt.*,
                    (SELECT COUNT(*) FROM health_plans hp WHERE hp.template_id = hpt.id AND hp.status = 'active') AS active_enrollments
             FROM health_plan_templates hpt
             ${whereClause}
             ORDER BY hpt.sort_order ASC, hpt.id ASC`,
            params
        );
        return { success: true, templates: result.rows };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handleGetHealthPlanTemplates', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

async function handlePostHealthPlanTemplate(body) {
    const { key_name, name_zh, name_en, desc_zh, desc_en, goal_zh, goal_en,
            duration_weeks, target_sub_ages, recommended_dot_ids, activity_guidance,
            milestones, reminders, daily_tasks, sort_order, channel_id, created_by } = body || {};
    if (!key_name || !name_zh || !name_en) return { statusCode: 400, success: false, error: 'key_name, name_zh, name_en required' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const result = await pool.query(
            `INSERT INTO health_plan_templates
             (key_name, name_zh, name_en, desc_zh, desc_en, goal_zh, goal_en,
              duration_weeks, target_sub_ages, recommended_dot_ids, activity_guidance, milestones, reminders,
              daily_tasks, sort_order, channel_id, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
             RETURNING *`,
            [key_name, name_zh, name_en, desc_zh || null, desc_en || null, goal_zh || null, goal_en || null,
             duration_weeks || 4, target_sub_ages || null,
             JSON.stringify(recommended_dot_ids || []),
             JSON.stringify(activity_guidance || {}),
             JSON.stringify(milestones || []),
             JSON.stringify(reminders || []),
             JSON.stringify(daily_tasks || []),
             sort_order || 0, channel_id || null, created_by || null]
        );
        console.log(JSON.stringify({ level: 'INFO', msg: 'handlePostHealthPlanTemplate', key_name }));
        return { success: true, template: result.rows[0] };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handlePostHealthPlanTemplate', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

async function handlePutHealthPlanTemplate(id, body) {
    const { name_zh, name_en, desc_zh, desc_en, goal_zh, goal_en,
            duration_weeks, target_sub_ages, recommended_dot_ids, activity_guidance,
            milestones, reminders, daily_tasks, sort_order, is_active } = body || {};
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const result = await pool.query(
            `UPDATE health_plan_templates
             SET name_zh=$1, name_en=$2, desc_zh=$3, desc_en=$4, goal_zh=$5, goal_en=$6,
                 duration_weeks=$7, target_sub_ages=$8, recommended_dot_ids=$9,
                 activity_guidance=$10, milestones=$11, reminders=$12, daily_tasks=$13,
                 sort_order=$14, is_active=COALESCE($15, is_active), updated_at=NOW()
             WHERE id=$16
             RETURNING *`,
            [name_zh, name_en, desc_zh || null, desc_en || null, goal_zh || null, goal_en || null,
             duration_weeks, target_sub_ages || null,
             JSON.stringify(recommended_dot_ids || []),
             JSON.stringify(activity_guidance || {}),
             JSON.stringify(milestones || []),
             JSON.stringify(reminders || []),
             JSON.stringify(daily_tasks || []),
             sort_order || 0, is_active !== undefined ? is_active : null, id]
        );
        if (result.rows.length === 0) return { statusCode: 404, success: false, error: 'Template not found' };
        return { success: true, template: result.rows[0] };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handlePutHealthPlanTemplate', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

async function handleDeleteHealthPlanTemplate(id) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const active = await pool.query(
            `SELECT COUNT(*) AS cnt FROM health_plans WHERE template_id=$1 AND status='active'`, [id]
        );
        if (parseInt(active.rows[0].cnt) > 0) {
            return { statusCode: 409, success: false, error: 'Cannot delete template with active enrollments' };
        }
        await pool.query('DELETE FROM health_plan_templates WHERE id=$1', [id]);
        return { success: true };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handleDeleteHealthPlanTemplate', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

async function handleGetHealthPlans(query) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const isAdmin = query.all === 'true';
        const openid = query.openid;
        if (!isAdmin && !openid) return { statusCode: 400, success: false, error: 'openid required' };

        let whereClause = isAdmin ? `WHERE hp.status = 'active'` : `WHERE hp.user_id = $1 AND hp.status = 'active'`;
        const params = isAdmin ? [] : [openid];

        const result = await pool.query(
            `SELECT hp.*,
                    hpt.key_name AS template_key, hpt.name_zh, hpt.name_en,
                    hpt.desc_zh, hpt.desc_en, hpt.goal_zh, hpt.goal_en,
                    hpt.target_sub_ages, hpt.recommended_dot_ids, hpt.activity_guidance, hpt.milestones AS template_milestones,
                    hpt.duration_weeks AS template_duration_weeks, hpt.daily_tasks,
                    (SELECT COUNT(*) FROM health_plan_checkins hpc WHERE hpc.plan_id = hp.id) AS checkin_count,
                    (SELECT COUNT(*) FROM health_plan_checkins hpc WHERE hpc.plan_id = hp.id AND hpc.checkin_date = CURRENT_DATE) AS checked_in_today,
                    (SELECT row_to_json(t) FROM (SELECT dots_taken, activities_done FROM health_plan_checkins WHERE plan_id = hp.id AND checkin_date = CURRENT_DATE LIMIT 1) t) AS today_checkin,
                    u.nickname AS user_nickname
             FROM health_plans hp
             LEFT JOIN health_plan_templates hpt ON hpt.id = hp.template_id
             LEFT JOIN users u ON u.user_id = hp.user_id
             ${whereClause}
             ORDER BY hp.plan_type ASC, hp.created_at ASC`,
            params
        );
        return { success: true, plans: result.rows };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handleGetHealthPlans', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

async function handlePostJoinHealthPlan(body) {
    const { openid, template_id, plan_type = 'primary', source = 'self',
            coach_id, custom_name_zh, custom_name_en, custom_goal_zh, custom_goal_en,
            duration_weeks } = body || {};
    if (!openid) return { statusCode: 400, success: false, error: 'openid required' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };

        // Check for existing active plan of same type
        const existing = await pool.query(
            `SELECT id, plan_type FROM health_plans WHERE user_id=$1 AND plan_type=$2 AND status='active'`,
            [openid, plan_type]
        );
        if (existing.rows.length > 0) {
            return { statusCode: 409, success: false, error: 'conflict', existing_plan_id: existing.rows[0].id };
        }

        // Capture baseline from latest kino_chip biomarker
        const bioRow = await pool.query(
            `SELECT data FROM biomarkers WHERE user_id=$1 AND test_type='kino_chip' ORDER BY tested_at DESC LIMIT 1`,
            [openid]
        );
        const baseline_data = bioRow.rows.length > 0
            ? { bioage_profile: bioRow.rows[0].data?.bioage_profile || {}, biomarkers: bioRow.rows[0].data?.actual || {} }
            : {};

        // Resolve duration and reminders from template
        let resolvedDuration = duration_weeks || 4;
        let templateReminders = [];
        if (template_id) {
            const tpl = await pool.query('SELECT duration_weeks, reminders FROM health_plan_templates WHERE id=$1', [template_id]);
            if (tpl.rows.length > 0) {
                resolvedDuration = duration_weeks || tpl.rows[0].duration_weeks;
                templateReminders = tpl.rows[0].reminders || [];
            }
        }

        const startDate = new Date();
        const targetEnd = new Date(startDate);
        targetEnd.setDate(targetEnd.getDate() + resolvedDuration * 7);

        const result = await pool.query(
            `INSERT INTO health_plans
             (user_id, template_id, coach_id, plan_type, status, source,
              custom_name_zh, custom_name_en, custom_goal_zh, custom_goal_en,
              duration_weeks, baseline_data, start_date, target_end_date)
             VALUES ($1,$2,$3,$4,'active',$5,$6,$7,$8,$9,$10,$11,$12,$13)
             RETURNING *`,
            [openid, template_id || null, coach_id || null, plan_type, source,
             custom_name_zh || null, custom_name_en || null, custom_goal_zh || null, custom_goal_en || null,
             resolvedDuration, JSON.stringify(baseline_data),
             startDate.toISOString().slice(0, 10),
             targetEnd.toISOString().slice(0, 10)]
        );
        // Auto-create linked daily reminders from template config
        if (templateReminders.length > 0) {
            const userRow = await pool.query('SELECT language FROM users WHERE user_id=$1', [openid]);
            const lang = userRow.rows[0]?.language || 'zh';
            const planId = result.rows[0].id;
            for (const r of templateReminders) {
                if (!r.time) continue;
                const [hh, mm] = r.time.split(':').map(Number);
                const now = new Date();
                const fire = new Date(now);
                fire.setHours(hh, mm, 0, 0);
                if (fire <= now) fire.setDate(fire.getDate() + 1);
                const content = lang === 'zh' ? (r.message_zh || r.message_en || '') : (r.message_en || r.message_zh || '');
                await pool.query(
                    `INSERT INTO reminders (user_id, content, scheduled_for, recurrence, plan_id) VALUES ($1,$2,$3,'daily',$4)`,
                    [openid, content, fire.toISOString(), planId]
                );
            }
        }

        console.log(JSON.stringify({ level: 'INFO', msg: 'handlePostJoinHealthPlan', openid, plan_type, template_id }));
        return { success: true, plan: result.rows[0] };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handlePostJoinHealthPlan', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

async function handleGetHealthPlanDetail(id, openid) {
    if (!openid) return { statusCode: 400, success: false, error: 'openid required' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const planRes = await pool.query(
            `SELECT hp.*,
                    hpt.key_name AS template_key, hpt.name_zh, hpt.name_en,
                    hpt.desc_zh, hpt.desc_en, hpt.goal_zh, hpt.goal_en,
                    hpt.target_sub_ages, hpt.recommended_dot_ids, hpt.activity_guidance,
                    hpt.milestones AS template_milestones
             FROM health_plans hp
             LEFT JOIN health_plan_templates hpt ON hpt.id = hp.template_id
             WHERE hp.id=$1 AND hp.user_id=$2`,
            [id, openid]
        );
        if (planRes.rows.length === 0) return { statusCode: 404, success: false, error: 'Plan not found' };

        const [checkinsRes, milestonesRes, remindersRes] = await Promise.all([
            pool.query(
                `SELECT * FROM health_plan_checkins WHERE plan_id=$1 ORDER BY checkin_date DESC LIMIT 30`, [id]
            ),
            pool.query(
                `SELECT * FROM health_plan_milestones WHERE plan_id=$1 ORDER BY milestone_index ASC`, [id]
            ),
            pool.query(
                `SELECT id, content, scheduled_for, recurrence, status FROM reminders
                 WHERE plan_id=$1 AND status != 'sent' AND status != 'cancelled'
                 ORDER BY scheduled_for ASC`, [id]
            ),
        ]);
        return {
            success: true,
            plan: planRes.rows[0],
            checkins: checkinsRes.rows,
            milestones: milestonesRes.rows,
            reminders: remindersRes.rows,
        };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handleGetHealthPlanDetail', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

async function handlePutHealthPlan(id, body) {
    const { status, plan_type, openid } = body || {};
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };

        // plan_type swap: must do in a transaction to avoid unique index violation
        if (plan_type) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const current = await client.query(`SELECT user_id, plan_type FROM health_plans WHERE id=$1`, [id]);
                if (current.rows.length === 0) { await client.query('ROLLBACK'); return { statusCode: 404, success: false, error: 'Plan not found' }; }
                const { user_id, plan_type: oldType } = current.rows[0];
                if (oldType !== plan_type) {
                    // Move any existing plan in the target slot to the old slot
                    await client.query(
                        `UPDATE health_plans SET plan_type=$1, updated_at=NOW() WHERE user_id=$2 AND plan_type=$3 AND status='active' AND id != $4`,
                        [oldType, user_id, plan_type, id]
                    );
                }
                await client.query(`UPDATE health_plans SET plan_type=$1, updated_at=NOW() WHERE id=$2`, [plan_type, id]);
                await client.query('COMMIT');
            } catch (e) {
                await client.query('ROLLBACK');
                throw e;
            } finally {
                client.release();
            }
        }

        if (status) {
            const endedAt = ['completed', 'abandoned'].includes(status) ? 'NOW()' : 'NULL';
            await pool.query(
                `UPDATE health_plans SET status=$1, ended_at=${endedAt}, updated_at=NOW() WHERE id=$2`,
                [status, id]
            );
            if (['completed', 'abandoned'].includes(status)) {
                await pool.query(
                    `UPDATE reminders SET status='cancelled' WHERE plan_id=$1 AND status IN ('pending','paused')`,
                    [id]
                );
            }
        }
        console.log(JSON.stringify({ level: 'INFO', msg: 'handlePutHealthPlan', id, status, plan_type }));
        return { success: true };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handlePutHealthPlan', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

async function handlePatchPlanReminder(reminderId, body) {
    const { openid, status } = body || {};
    if (!openid) return { statusCode: 400, success: false, error: 'openid required' };
    if (!['pending', 'paused'].includes(status)) return { statusCode: 400, success: false, error: 'status must be pending or paused' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const result = await pool.query(
            `UPDATE reminders SET status=$1
             WHERE id=$2 AND user_id=$3 AND plan_id IS NOT NULL AND status IN ('pending','paused')
             RETURNING id`,
            [status, reminderId, openid]
        );
        if (result.rows.length === 0) return { statusCode: 404, success: false, error: 'Reminder not found' };
        return { success: true };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handlePatchPlanReminder', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

async function handlePostHealthPlanCheckin(planId, body) {
    const { openid, checkin_date, dots_taken = false, activities_done = [], notes } = body || {};
    if (!openid || !checkin_date) return { statusCode: 400, success: false, error: 'openid and checkin_date required' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const result = await pool.query(
            `INSERT INTO health_plan_checkins (plan_id, user_id, checkin_date, dots_taken, activities_done, notes)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (plan_id, checkin_date) DO UPDATE
             SET dots_taken=EXCLUDED.dots_taken, activities_done=EXCLUDED.activities_done,
                 notes=COALESCE(EXCLUDED.notes, health_plan_checkins.notes)
             RETURNING *`,
            [planId, openid, checkin_date, dots_taken, JSON.stringify(activities_done), notes || null]
        );
        return { success: true, checkin: result.rows[0] };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handlePostHealthPlanCheckin', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

async function handlePostHealthPlanMilestone(planId, body) {
    const { openid, biomarker_id, milestone_index = 0, label_zh, label_en } = body || {};
    if (!openid) return { statusCode: 400, success: false, error: 'openid required' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        let snapshot_data = {};
        if (biomarker_id) {
            const bRes = await pool.query('SELECT data FROM biomarkers WHERE id=$1 AND user_id=$2', [biomarker_id, openid]);
            if (bRes.rows.length > 0) snapshot_data = bRes.rows[0].data || {};
        }
        const result = await pool.query(
            `INSERT INTO health_plan_milestones (plan_id, user_id, biomarker_id, milestone_index, label_zh, label_en, snapshot_data)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             RETURNING *`,
            [planId, openid, biomarker_id || null, milestone_index, label_zh || null, label_en || null, JSON.stringify(snapshot_data)]
        );
        return { success: true, milestone: result.rows[0] };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handlePostHealthPlanMilestone', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

async function handleGetCoachClientPlans(coachId) {
    if (!coachId) return { statusCode: 400, success: false, error: 'coach_id required' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const result = await pool.query(
            `SELECT hp.*, u.nickname AS user_nickname,
                    hpt.name_zh, hpt.name_en, hpt.key_name AS template_key,
                    (SELECT COUNT(*) FROM health_plan_checkins hpc WHERE hpc.plan_id = hp.id) AS checkin_count
             FROM health_plans hp
             JOIN users u ON u.user_id = hp.user_id
             JOIN coaches c ON c.user_id = u.user_id OR c.id = hp.coach_id
             LEFT JOIN health_plan_templates hpt ON hpt.id = hp.template_id
             WHERE c.id = $1 AND hp.status = 'active'
             ORDER BY hp.plan_type ASC, hp.created_at ASC`,
            [coachId]
        );
        return { success: true, plans: result.rows };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handleGetCoachClientPlans', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

// ─── Health Reports ────────────────────────────────────────────────────────────

async function handleGetHealthReports(query) {
    try {
        const { openid, user_id } = query;
        if (!openid && !user_id) return { statusCode: 400, success: false, error: 'openid or user_id required' };
        const uid = user_id || (await pool.query('SELECT user_id FROM users WHERE user_id = $1 OR external_id = $1 LIMIT 1', [openid])).rows[0]?.user_id;
        if (!uid) return { statusCode: 404, success: false, error: 'User not found' };
        const result = await pool.query(
            `SELECT id, report_date, source, institution, report_type, status, created_at
             FROM health_reports WHERE user_id = $1 ORDER BY report_date DESC LIMIT 50`,
            [uid]
        );
        return { success: true, reports: result.rows };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handleGetHealthReports', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

async function handleGetHealthReport(reportId, query) {
    try {
        const reportRes = await pool.query(
            'SELECT * FROM health_reports WHERE id = $1',
            [reportId]
        );
        if (reportRes.rows.length === 0) return { statusCode: 404, success: false, error: 'Report not found' };
        const eventsRes = await pool.query(
            'SELECT id, category, data_date, data FROM health_events WHERE report_id = $1 ORDER BY data_date',
            [reportId]
        );
        return { success: true, report: reportRes.rows[0], events: eventsRes.rows };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handleGetHealthReport', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

async function handlePostHealthReport(body) {
    try {
        const { user_id, openid, report_date, source = 'manual_upload', institution, report_type = 'lab_panel', observations = [], fhir_bundle } = body || {};
        if (!user_id && !openid) return { statusCode: 400, success: false, error: 'user_id or openid required' };

        let uid = user_id;
        if (!uid) {
            const userRes = await pool.query('SELECT user_id FROM users WHERE external_id = $1 LIMIT 1', [openid]);
            if (userRes.rows.length === 0) return { statusCode: 404, success: false, error: 'User not found' };
            uid = userRes.rows[0].user_id;
        }

        // Extract observations from FHIR bundle if provided
        let obs = observations;
        if (fhir_bundle && fhir_bundle.resourceType === 'Bundle') {
            obs = extractObservationsFromFhir(fhir_bundle);
        }
        if (obs.length === 0) return { statusCode: 400, success: false, error: 'No observations provided' };

        // Resolve LOINC codes → catalog metadata
        const catalogRes = await pool.query(
            'SELECT key_name, loinc_code, nano_dimension, is_kino_core, unit FROM biomarker_catalog WHERE is_active = TRUE'
        );
        const loincMap = {};
        for (const row of catalogRes.rows) {
            if (row.loinc_code) loincMap[row.loinc_code] = row;
        }

        const date = report_date || obs[0]?.data_date?.split('T')[0] || new Date().toISOString().split('T')[0];

        const reportRes = await pool.query(
            `INSERT INTO health_reports (user_id, report_date, source, institution, report_type, status, raw_data)
             VALUES ($1, $2, $3, $4, $5, 'parsed', $6) RETURNING id`,
            [uid, date, source, institution || null, report_type, JSON.stringify({ observations: obs })]
        );
        const reportId = reportRes.rows[0].id;

        let hasKinoCore = false;
        for (const o of obs) {
            const catalog = loincMap[o.loinc_code];
            if (!catalog) continue;
            const dataDate = (o.data_date || date).split('T')[0];
            const externalId = `${o.loinc_code}::${dataDate}`;
            await pool.query(
                `INSERT INTO health_events (user_id, source, category, data_date, recorded_at, data, report_id, external_id)
                 VALUES ($1, $2, 'lab_result', $3, NOW(), $4, $5, $6)
                 ON CONFLICT (user_id, source, external_id) DO NOTHING`,
                [
                    uid, source, dataDate,
                    JSON.stringify({
                        key_name:       catalog.key_name,
                        loinc_code:     o.loinc_code,
                        value:          parseFloat(o.value),
                        unit:           o.unit || catalog.unit,
                        nano_dimension: catalog.nano_dimension,
                        is_kino_core:   catalog.is_kino_core,
                    }),
                    reportId, externalId,
                ]
            );
            if (catalog.is_kino_core) hasKinoCore = true;
        }

        return { success: true, report_id: reportId, has_kino_core: hasKinoCore };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handlePostHealthReport', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

function extractObservationsFromFhir(bundle) {
    const obs = [];
    for (const entry of bundle.entry || []) {
        const res = entry.resource;
        if (!res || res.resourceType !== 'Observation') continue;
        const loincCode = res.code?.coding?.find(c => c.system === 'http://loinc.org')?.code;
        if (!loincCode) continue;
        const value = res.valueQuantity?.value ?? res.valueCodeableConcept?.coding?.[0]?.code;
        if (value == null) continue;
        obs.push({
            loinc_code: loincCode,
            value,
            unit: res.valueQuantity?.unit || '',
            data_date: res.effectiveDateTime || res.issued || new Date().toISOString(),
        });
    }
    return obs;
}

// ─── Lab Admin API ────────────────────────────────────────────────────────────

async function handleGetLabProviders() {
    try {
        const result = await pool.query(
            'SELECT id, lab_name, label, api_base_url, poll_enabled, last_polled_at, is_active FROM lab_providers ORDER BY id'
        );
        return { success: true, providers: result.rows };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handleGetLabProviders', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

async function handlePostLabProvider(body) {
    try {
        const { lab_name, label, api_base_url, api_key, webhook_secret, poll_enabled = true } = body || {};
        if (!lab_name || !api_base_url) return { statusCode: 400, success: false, error: 'lab_name and api_base_url required' };
        const result = await pool.query(
            `INSERT INTO lab_providers (lab_name, label, api_base_url, api_key_enc, webhook_secret_enc, poll_enabled)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [lab_name, label || null, api_base_url, api_key || null, webhook_secret || null, poll_enabled]
        );
        return { success: true, id: result.rows[0].id };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handlePostLabProvider', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

async function handlePutLabProvider(id, body) {
    try {
        const { label, api_base_url, api_key, webhook_secret, poll_enabled, is_active } = body || {};
        await pool.query(
            `UPDATE lab_providers SET
               label = COALESCE($1, label),
               api_base_url = COALESCE($2, api_base_url),
               api_key_enc = COALESCE($3, api_key_enc),
               webhook_secret_enc = COALESCE($4, webhook_secret_enc),
               poll_enabled = COALESCE($5, poll_enabled),
               is_active = COALESCE($6, is_active)
             WHERE id = $7`,
            [label ?? null, api_base_url ?? null, api_key ?? null, webhook_secret ?? null,
             poll_enabled ?? null, is_active ?? null, id]
        );
        return { success: true };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handlePutLabProvider', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

async function handleDeleteLabProvider(id) {
    try {
        await pool.query('DELETE FROM lab_providers WHERE id = $1', [id]);
        return { success: true };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handleDeleteLabProvider', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

async function handleGetLabUserMappings(query) {
    try {
        const { user_id, lab_name } = query;
        const params = [];
        const where = [];
        if (user_id)  { params.push(user_id);  where.push(`m.user_id = $${params.length}`); }
        if (lab_name) { params.push(lab_name); where.push(`m.lab_name = $${params.length}`); }
        const result = await pool.query(
            `SELECT m.id, m.user_id, u.nickname, m.lab_name, m.lab_patient_id, m.created_at
             FROM lab_user_mappings m
             JOIN users u ON u.user_id = m.user_id
             ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
             ORDER BY m.created_at DESC LIMIT 200`,
            params
        );
        return { success: true, mappings: result.rows };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handleGetLabUserMappings', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

async function handlePostLabUserMapping(body) {
    try {
        const { user_id, lab_name, lab_patient_id } = body || {};
        if (!user_id || !lab_name || !lab_patient_id) return { statusCode: 400, success: false, error: 'user_id, lab_name and lab_patient_id required' };
        const result = await pool.query(
            `INSERT INTO lab_user_mappings (user_id, lab_name, lab_patient_id) VALUES ($1, $2, $3)
             ON CONFLICT (lab_name, lab_patient_id) DO NOTHING RETURNING id`,
            [user_id, lab_name, lab_patient_id]
        );
        if (result.rows.length === 0) return { statusCode: 409, success: false, error: 'This lab_patient_id is already mapped to another user' };
        return { success: true, id: result.rows[0].id };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handlePostLabUserMapping', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

async function handleDeleteLabUserMapping(id) {
    try {
        await pool.query('DELETE FROM lab_user_mappings WHERE id = $1', [id]);
        return { success: true };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handleDeleteLabUserMapping', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

async function handleGetLabReports(query) {
    try {
        const { user_id, source, limit = 100 } = query;
        const params = [];
        const where = [];
        if (user_id) { params.push(user_id); where.push(`r.user_id = $${params.length}`); }
        if (source)  { params.push(source);  where.push(`r.source = $${params.length}`); }
        params.push(Math.min(parseInt(limit) || 100, 500));
        const result = await pool.query(
            `SELECT r.id, r.user_id, u.nickname, r.report_date, r.source, r.institution,
                    r.report_type, r.status, r.created_at,
                    COUNT(he.id) AS event_count
             FROM health_reports r
             JOIN users u ON u.user_id = r.user_id
             LEFT JOIN health_events he ON he.report_id = r.id
             ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
             GROUP BY r.id, u.nickname
             ORDER BY r.created_at DESC
             LIMIT $${params.length}`,
            params
        );
        return { success: true, reports: result.rows };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handleGetLabReports', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

// ─── Lab Import EventBridge handler ──────────────────────────────────────────

async function handleLabImportEvent(data) {
    const { report_id, user_id } = data || {};
    if (!report_id || !user_id) throw new Error('report_id and user_id required');

    // Load Kino core observations from this report
    const eventsRes = await pool.query(
        `SELECT data FROM health_events
         WHERE report_id = $1 AND (data->>'is_kino_core')::boolean = true`,
        [report_id]
    );

    // Build partial biomarker values from confirmed lab observations
    const partialBiomarkers = {};
    for (const row of eventsRes.rows) {
        const d = row.data;
        if (d.key_name && d.value != null) partialBiomarkers[d.key_name] = d.value;
    }

    // Get user profile for age
    const userRes = await pool.query(
        `SELECT birth_date, bio_data FROM users WHERE user_id = $1`,
        [user_id]
    );
    if (userRes.rows.length === 0) throw new Error(`User not found: ${user_id}`);
    const { birth_date, bio_data } = userRes.rows[0];
    const age = calculateAge(birth_date);
    const bioData = bio_data || {};

    // Fetch tags for estimator context
    const tagContext = await fetchTagDerivationContext(user_id);
    const tags = deriveTags(tagContext);
    const seed = `${user_id}:lab:${report_id}`;
    const weekBucket = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
    const persistentSeed = `${user_id}:w${weekBucket}`;

    // Fill missing Kino core values via BiomarkerEstimator
    const estimator = new BiomarkerEstimator(age, partialBiomarkers, { Weight: bioData.weight, Height: bioData.height }, tags, { seed, persistentSeed });
    const estimationReport = estimator.generateReport();

    const bioAgeCalc = new BioAgeCalculator();
    const bioAgeReport = bioAgeCalc.calculateBioAge(age, estimationReport.BiomarkerValues);

    const finalData = {
        actual:         partialBiomarkers,
        estimated:      estimationReport.BiomarkerValues,
        context:        estimationReport.ClinicalContext,
        bioage_profile: bioAgeReport,
        tags,
        source_report_id: report_id,
    };

    await pool.query(
        `INSERT INTO biomarkers (user_id, test_type, data, bio_age, tested_at)
         VALUES ($1, 'lab_import', $2, $3, NOW())`,
        [user_id, JSON.stringify(finalData), bioAgeReport.BioAge]
    );

    await updateHealthTwin(user_id);

    console.log(JSON.stringify({ level: 'INFO', msg: 'Lab import BioAge calculated', user_id, bio_age: bioAgeReport.BioAge, report_id }));
}

exports.handler = async (req, resp, context) => {
    const isStandardHttp = resp && typeof resp.send === 'function';
    let event = req;

    if (Buffer.isBuffer(req)) {
        try { event = JSON.parse(req.toString()); } catch (e) {}
    }

    // EventBridge CloudEvent detection — route before HTTP processing
    if (event && event.specversion && event.source) {
        let cloudData = event.data;
        if (Buffer.isBuffer(cloudData)) cloudData = JSON.parse(cloudData.toString('utf8'));
        else if (typeof cloudData === 'string') {
            try { cloudData = JSON.parse(Buffer.from(cloudData, 'base64').toString('utf8')); }
            catch (e) { try { cloudData = JSON.parse(cloudData); } catch (e2) {} }
        }
        if (event.source === 'acs.lab' && event.type === 'biomarker.lab_complete') {
            try {
                await handleLabImportEvent(cloudData);
            } catch (err) {
                console.error(JSON.stringify({ level: 'ERROR', msg: 'handleLabImportEvent failed', error: err.message }));
            }
        }
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }), isBase64Encoded: false };
    }

    const rawUrl = req.url || '';
    const urlPath = rawUrl.split('?')[0];
    const urlParams = rawUrl.includes('?')
        ? Object.fromEntries(new URLSearchParams(rawUrl.split('?')[1]))
        : {};

    const rawPath = event.rawPath || event.path || (event.requestContext && event.requestContext.path) || req.path || urlPath || '';
    const path = rawPath.replace(/^\/api/, '');
    const method = event.httpMethod || event.method || (event.requestContext && event.requestContext.http && event.requestContext.http.method) || req.method || 'POST';
    const body = event.body || (isStandardHttp ? req.body : event);
    const query = event.queryParameters || event.queryStringParameters || req.queries || req.query || urlParams || {};

    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Content-Type': 'application/json'
    };

    if (method === 'OPTIONS') {
        const optionsPayload = {
            isBase64Encoded: false,
            statusCode: 204,
            headers: corsHeaders,
            body: ''
        };
        if (isStandardHttp) {
            resp.setStatusCode(204);
            Object.entries(corsHeaders).forEach(([k, v]) => resp.setHeader(k, v));
            resp.send('');
            return;
        }
        return optionsPayload;
    }

    const adminCtx = { role: 'superadmin', channelId: null, accountId: null, canManageSubchannels: false };
    const expectedBearer = process.env.API_BEARER_TOKEN;
    if (expectedBearer && rawPath && path !== '/admin/login') {
        const authHeader = (event.headers && (event.headers['authorization'] || event.headers['Authorization'])) || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
        if (token === expectedBearer) {
            adminCtx.role = 'superadmin';
        } else if (token.startsWith('ch.')) {
            const payload = verifyChannelAdminToken(token);
            if (!payload) {
                const unauthorizedPayload = { isBase64Encoded: false, statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'Unauthorized' }) };
                if (isStandardHttp) { resp.setStatusCode(401); Object.entries(corsHeaders).forEach(([k, v]) => resp.setHeader(k, v)); resp.send(JSON.stringify({ error: 'Unauthorized' })); return; }
                return unauthorizedPayload;
            }
            adminCtx.role = 'channel';
            adminCtx.channelId = payload.cid;
            adminCtx.accountId = payload.sub;
            adminCtx.canManageSubchannels = payload.cms ?? false;
        } else {
            const unauthorizedPayload = { isBase64Encoded: false, statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'Unauthorized' }) };
            if (isStandardHttp) { resp.setStatusCode(401); Object.entries(corsHeaders).forEach(([k, v]) => resp.setHeader(k, v)); resp.send(JSON.stringify({ error: 'Unauthorized' })); return; }
            return unauthorizedPayload;
        }
    }

    try {
        let result;

        let parsedBody = body;
        if (method !== 'GET') {
            if (Buffer.isBuffer(body)) {
                try { parsedBody = JSON.parse(body.toString()); } catch (e) { console.error('Failed to parse Buffer body', e); }
            } else if (typeof body === 'string') {
                try { parsedBody = JSON.parse(body); } catch (e) { console.error('Failed to parse string body', e); }
            }
        }

        if (method === 'GET') {
            if (path === '/kino-upgrade') {
                result = await handleGetKinoUpgrade();
            } else if (path.includes('/kone-apk-releases')) {
                result = await handleGetKoneApkReleases();
            } else if (path.includes('/oss/kone-apk/presign')) {
                result = await handleGetKoneApkPresign();
            } else if (path.includes('/kino-devices')) {
                result = await handleGetKinoDevices();
            } else if (path.match(/\/kino-chip-batches\/(\d+)\/chips/)) {
                const batchId = path.match(/\/kino-chip-batches\/(\d+)\/chips/)[1];
                result = await handleGetKinoChipBatchChips(batchId, query);
            } else if (path.includes('/kino-chip-batches')) {
                result = await handleGetKinoChipBatches();
            } else if (path.includes('/kino-chip-models')) {
                result = await handleGetKinoChipModels();
            } else if (path.includes('/kino-chip')) {
                result = await handleGetKinoChip(query.chip_id);
            } else if (path.includes('/coach-sent-messages')) {
                result = await handleGetCoachSentMessages(query.user_id);
            } else if (path.includes('/coach-user-chat')) {
                result = await handleGetCoachUserChat(query.user_id, query.coach_id);
            } else if (path.includes('/chat-history')) {
                const sinceId = query.since_id ? parseInt(query.since_id, 10) : null;
                result = await handleGetChatHistory(query.openid, sinceId);
            } else if (path.includes('/biomarkers')) {
                result = await handleGetBiomarkers(query.openid);
            } else if (path.includes('/notifications')) {
                result = await handleGetNotifications(query.openid);
            } else if (path.includes('/reminders')) {
                result = await handleGetReminders(query.openid);
            } else if (path.includes('/nutrition-plan')) {
                result = await handleGetNutritionPlan(query.openid);
            } else if (path === '/health-twin') {
                result = await handleGetHealthTwin(query.openid);
            } else if (path.match(/\/health-reports\/(\d+)/)) {
                const reportId = path.match(/\/health-reports\/(\d+)/)[1];
                result = await handleGetHealthReport(reportId, query);
            } else if (path === '/lab/reports') {
                result = await handleGetLabReports(query);
            } else if (path.includes('/health-reports')) {
                result = await handleGetHealthReports(query);
            } else if (path.includes('/lab-providers')) {
                result = await handleGetLabProviders();
            } else if (path.includes('/lab-user-mappings')) {
                result = await handleGetLabUserMappings(query);
            } else if (path.includes('/health-events')) {
                result = await handleGetHealthEvents(query);
            } else if (path.match(/\/health-plans\/(\d+)/)) {
                const planId = path.match(/\/health-plans\/(\d+)/)[1];
                result = await handleGetHealthPlanDetail(planId, query.openid);
            } else if (path.includes('/health-plans')) {
                result = await handleGetHealthPlans(query);
            } else if (path.includes('/health-plan-templates')) {
                result = await handleGetHealthPlanTemplates(query);
            } else if (path.includes('/coach-client-plans')) {
                result = await handleGetCoachClientPlans(query.coach_id);
            } else if (path.includes('/my-cartridges')) {
                result = await handleGetMyCartridges(query.openid);
            } else if (path.includes('/dots-inventory')) {
                result = await handleGetDotsInventory();
            } else if (path.includes('/channel-inventory')) {
                result = await handleGetChannelInventory(query, adminCtx);
            } else if (path.includes('/store-items')) {
                result = await handleGetStoreItems(query);
            } else if (path.includes('/my-orders')) {
                result = await handleGetMyOrders(query.openid);
            } else if (path.includes('/orders')) {
                result = await handleGetOrders();
            } else if (path.includes('/coach-list')) {
                result = await handleGetCoachList(adminCtx.channelId);
            } else if (path.match(/\/channel-users\/(\d+)/)) {
                result = await handleGetChannelUsers(path.match(/\/channel-users\/(\d+)/)[1], query.include_subchannels === 'true');
            } else if (path.match(/\/channel-coaches\/(\d+)/)) {
                result = await handleGetChannelCoaches(path.match(/\/channel-coaches\/(\d+)/)[1], query.include_subchannels === 'true');
            } else if (path.match(/\/coach-users\/(\d+)/)) {
                result = await handleGetCoachUsers(path.match(/\/coach-users\/(\d+)/)[1], query);
            } else if (path.includes('/invitations')) {
                const invQuery = adminCtx.channelId ? { ...query, channel_id: adminCtx.channelId } : query;
                result = await handleGetInvitations(invQuery);
            } else if (path.includes('/partner-commission-config')) {
                result = await handleGetPartnerCommissionConfig();
            } else if (path.match(/\/partner-tree\/(\d+)/)) {
                result = await handleGetPartnerTree(path.match(/\/partner-tree\/(\d+)/)[1]);
            } else if (path.match(/\/partners\/(\d+)/)) {
                result = await handleGetPartner(path.match(/\/partners\/(\d+)/)[1]);
            } else if (path.includes('/partner-commissions')) {
                result = await handleGetPartnerCommissions(query);
            } else if (path.includes('/partner-payouts')) {
                result = await handleGetPartnerPayouts(query);
            } else if (path.includes('/partners')) {
                result = await handleGetPartners(query, adminCtx);
            } else if (path.includes('/channels')) {
                result = await handleGetChannels(adminCtx);
            } else if (path.includes('/academy/course-progress')) {
                result = await handleGetAcademyCourseProgress();
            } else if (path.includes('/academy/courses')) {
                result = await handleGetAcademyCourses();
            } else if (path.match(/\/academy\/library\/(\d+)\/content/)) {
                const libId = path.match(/\/academy\/library\/(\d+)\/content/)[1];
                result = await handleGetAcademyLibraryContent(libId);
            } else if (path.includes('/academy/library')) {
                result = await handleGetAcademyLibrary();
            } else if (path.includes('/academy/lessons')) {
                result = await handleGetAcademyLessons(query.course_id);
            } else if (path.includes('/academy/progress')) {
                result = await handleGetAcademyProgress(query.coach_user_id);
            } else if (path.includes('/oss/presign')) {
                result = await handleGetOssPresign(query);
            } else if (path.match(/\/users\/([^/]+)/)) {
                const userId = path.match(/\/users\/([^/]+)/)[1];
                result = await handleGetUser(userId);
            } else if (path.includes('/users') || path === '/' || path === '') {
                result = await handleGetUsers(adminCtx.channelId);
            } else if (path.includes('/commission-settings')) {
                result = await handleGetCommissionSettings();
            } else if (path.includes('/coach-commissions')) {
                result = await handleGetCoachCommissions(query);
            } else if (path.includes('/channel-commissions')) {
                result = await handleGetChannelCommissions(query);
            } else if (path.includes('/coach-earnings')) {
                result = await handleGetCoachEarnings(query.coach_user_id);
            } else if (path.includes('/coach-payouts')) {
                result = await handleGetCoachPayouts(query);
            } else if (path.includes('/channel-payouts')) {
                result = await handleGetChannelPayouts(query);
            } else if (path.includes('/channel-rewards-summary')) {
                result = await handleGetChannelRewardsSummary(query.channel_id);
            } else if (path === '/admin/saved-reports') {
                result = await handleGetSavedReports();
            } else if (path === '/admin-accounts') {
                result = await handleGetAdminAccounts(adminCtx);
            } else if (path === '/tickets' || path.includes('/tickets')) {
                result = await handleGetTickets(adminCtx.channelId);
            } else if (path.includes('/pending-questionnaires')) {
                result = await handleGetPendingQuestionnaires(query.openid);
            } else if (path.match(/\/questionnaires\/(\d+)\/questions/)) {
                const qid = path.match(/\/questionnaires\/(\d+)\/questions/)[1];
                result = await handleGetQuestionnaireQuestions(qid);
            } else if (path.includes('/questionnaires')) {
                result = await handleGetQuestionnaires(query);
            } else if (path.includes('/questionnaire-assignments')) {
                result = await handleGetQuestionnaireAssignments(query);
            } else if (path.includes('/questionnaire-responses')) {
                result = await handleGetQuestionnaireResponses(query);
            } else if (path.includes('/coach-tags') && !path.includes('/coach-tag-assignments')) {
                result = await handleGetCoachTags(query.coach_id);
            } else if (path.includes('/coach-tag-assignments')) {
                result = { success: false, error: 'Use DELETE for tag assignment removal', statusCode: 405 };
            } else if (path.includes('/client-pipeline')) {
                result = await handleGetClientPipeline(query.coach_id);
            } else if (path.includes('/coach-notes')) {
                result = await handleGetCoachNotes(query);
            } else if (path.includes('/client-activity')) {
                result = await handleGetClientActivity(query);
            } else if (path.includes('/coach-activity-feed')) {
                result = await handleGetCoachActivityFeed(query.coach_id, query.limit);
            } else if (path.includes('/message-templates')) {
                result = await handleGetMessageTemplates(query);
            } else if (path.match(/\/bulk-campaigns\/(\d+)\/recipients/)) {
                const campId = path.match(/\/bulk-campaigns\/(\d+)\/recipients/)[1];
                result = await handleGetBulkCampaignRecipients(campId);
            } else if (path.includes('/bulk-campaigns')) {
                result = await handleGetBulkCampaigns(query.coach_id);
            } else if (path === '/appointments/upcoming') {
                result = await handleGetUpcomingAppointments(query.coach_id);
            } else if (path.includes('/appointments')) {
                result = await handleGetAppointments(query);
            } else if (path.includes('/client-goals')) {
                result = await handleGetClientGoals(query);
            } else if (path.includes('/nps-surveys')) {
                result = await handleGetNpsSurveys(query);
            } else if (path.includes('/coach-kpis')) {
                result = await handleGetCoachKpis(query);
            } else if (path.includes('/follow-up-rules')) {
                result = await handleGetFollowUpRules(query.coach_id);
            } else {
                result = { success: false, error: `Unknown GET route: ${path}` };
            }
        } else if (method === 'POST') {
            if (path === '/admin/login') {
                result = await handleAdminLogin(parsedBody);
            } else if (path === '/admin-accounts') {
                result = await handlePostAdminAccount(parsedBody, adminCtx);
            } else if (path === '/validate-invite') {
                result = await handleValidateInvite(parsedBody);
            } else if (path === '/wx-login') {
                result = await handleWxLogin(parsedBody);
            } else if (path === '/resolve-phone') {
                const { code, app_id } = parsedBody;
                result = await handleResolvePhone(code, app_id);
            } else if (path === '/bind-phone') {
                const { user_id, code, app_id } = parsedBody;
                result = await handleBindPhone(user_id, code, app_id);
            } else if (path.includes('/reminders')) {
                result = await handlePostReminder(parsedBody);
            } else if (path.includes('/coach-instruction')) {
                result = await handlePostCoachInstruction(parsedBody);
            } else if (path.includes('/assign-coach')) {
                result = await handlePostAssignCoach(parsedBody);
            } else if (path.includes('/invitations')) {
                result = await handlePostInvitation(parsedBody, adminCtx);
            } else if (path.includes('/channels')) {
                result = await handlePostChannel(parsedBody, adminCtx);
            } else if (path.includes('/coaches')) {
                result = await handlePostCoaches(parsedBody);
            } else if (path.includes('/channel-inventory')) {
                result = await handlePostChannelInventory(parsedBody, adminCtx);
            } else if (path.includes('/store-items')) {
                result = await handlePostStoreItem(parsedBody);
            } else if (path.includes('/orders')) {
                result = await handlePostOrder(parsedBody);
            } else if (path.includes('/dots')) {
                result = await handlePostDots(parsedBody);
            } else if (path === '/users') {
                result = await handlePostUsers(parsedBody);
            } else if (path.includes('/kone-apk-releases')) {
                result = await handlePostKoneApkRelease(parsedBody);
            } else if (path.includes('/kino-chip-batches')) {
                result = await handlePostKinoChipBatch(parsedBody);
            } else if (path.includes('/kino-chip-models')) {
                result = await handlePostKinoChipModel(parsedBody);
            } else if (path.includes('/kino-devices')) {
                result = await handlePostKinoDevice(parsedBody);
            } else if (path.includes('/kino-result')) {
                result = await handlePostKinoResult(parsedBody);
            } else if (path.includes('/kino-scan')) {
                result = await handlePostKinoScan(parsedBody);
            } else if (path === '/heartbeat') {
                result = await handlePostHeartbeat(parsedBody);
            } else if (path.includes('/chat-messages')) {
                result = await handlePostChatMessages(parsedBody);
            } else if (path.includes('/cartridge-insert')) {
                result = await handlePostCartridgeInsert(parsedBody);
            } else if (path.includes('/cartridge-remove')) {
                result = await handlePostCartridgeRemove(parsedBody);
            } else if (path.includes('/dispense')) {
                result = await handlePostDispense(parsedBody);
            } else if (path.includes('/formula-dots')) {
                result = await handlePostFormulaDots(parsedBody);
            } else if (path.match(/\/health-plans\/(\d+)\/checkin/)) {
                const planId = path.match(/\/health-plans\/(\d+)\/checkin/)[1];
                result = await handlePostHealthPlanCheckin(planId, parsedBody);
            } else if (path.match(/\/health-plans\/(\d+)\/milestone/)) {
                const planId = path.match(/\/health-plans\/(\d+)\/milestone/)[1];
                result = await handlePostHealthPlanMilestone(planId, parsedBody);
            } else if (path === '/health-events/fhir') {
                result = await handlePostHealthReport({ ...parsedBody, source: 'fhir_import' });
            } else if (path === '/health-reports') {
                result = await handlePostHealthReport(parsedBody);
            } else if (path === '/lab-providers') {
                result = await handlePostLabProvider(parsedBody);
            } else if (path === '/lab-user-mappings') {
                result = await handlePostLabUserMapping(parsedBody);
            } else if (path === '/health-events/sync') {
                result = await handlePostHealthEventsSync(parsedBody);
            } else if (path === '/health-events') {
                result = await handlePostHealthEvent(parsedBody);
            } else if (path.includes('/health-plans')) {
                result = await handlePostJoinHealthPlan(parsedBody);
            } else if (path.includes('/health-plan-templates')) {
                result = await handlePostHealthPlanTemplate(parsedBody);
            } else if (path.includes('/health-advice')) {
                result = await handlePostHealthAdvice(parsedBody);
            } else if (path.includes('/analyze-image')) {
                result = await handlePostAnalyzeImage(parsedBody);
            } else if (path === '/biomarkers') {
                result = await handlePostBiomarkers(parsedBody);
            } else if (path.includes('/generate-coach-payouts')) {
                result = await handlePostGenerateCoachPayouts(parsedBody);
            } else if (path.includes('/generate-channel-payouts')) {
                result = await handlePostGenerateChannelPayouts(parsedBody);
            } else if (path.includes('/generate-partner-payouts')) {
                result = await handlePostGeneratePartnerPayouts(parsedBody);
            } else if (path.includes('/partner-commissions')) {
                result = await handlePostPartnerCommission(parsedBody);
            } else if (path.includes('/partners')) {
                result = await handlePostPartner(parsedBody);
            } else if (path === '/academy/courses') {
                result = await handlePostAcademyCourse(parsedBody);
            } else if (path === '/academy/library') {
                result = await handlePostAcademyLibraryItem(parsedBody);
            } else if (path === '/academy/lessons') {
                result = await handlePostAcademyLesson(parsedBody);
            } else if (path === '/academy/progress') {
                result = await handlePostAcademyProgress(parsedBody);
            } else if (path === '/tickets') {
                result = await handlePostTicket(parsedBody);
            } else if (path.match(/\/questionnaires\/(\d+)\/questions/)) {
                const qid = path.match(/\/questionnaires\/(\d+)\/questions/)[1];
                result = await handlePostQuestionnaireQuestion(qid, parsedBody);
            } else if (path === '/questionnaires/generate') {
                result = await handleGenerateQuestionnaire(parsedBody);
            } else if (path === '/questionnaires') {
                result = await handlePostQuestionnaire(parsedBody);
            } else if (path === '/questionnaire-responses') {
                result = await handlePostQuestionnaireResponse(parsedBody);
            } else if (path === '/questionnaire-assignments') {
                result = await handlePostQuestionnaireAssignment(parsedBody);
            } else if (path === '/admin/saved-reports') {
                result = await handlePostSavedReport(parsedBody);
            } else if (path === '/admin/report') {
                result = await handlePostAdminReport(parsedBody);
            } else if (path.includes('/coach-tags') && !path.includes('/coach-tag-assignments')) {
                result = await handlePostCoachTag(parsedBody);
            } else if (path.includes('/coach-tag-assignments')) {
                result = await handlePostCoachTagAssignments(parsedBody);
            } else if (path.includes('/client-pipeline')) {
                result = await handlePostClientPipeline(parsedBody);
            } else if (path.includes('/coach-notes')) {
                result = await handlePostCoachNote(parsedBody);
            } else if (path.match(/\/message-templates\/(\d+)\/preview/)) {
                const tplId = path.match(/\/message-templates\/(\d+)\/preview/)[1];
                result = await handlePostMessageTemplatePreview(tplId, parsedBody);
            } else if (path.includes('/message-templates')) {
                result = await handlePostMessageTemplate(parsedBody);
            } else if (path.match(/\/bulk-campaigns\/(\d+)\/send/)) {
                const campId = path.match(/\/bulk-campaigns\/(\d+)\/send/)[1];
                result = await handlePostBulkCampaignSend(campId);
            } else if (path.includes('/bulk-campaigns')) {
                result = await handlePostBulkCampaign(parsedBody);
            } else if (path.includes('/appointments')) {
                result = await handlePostAppointment(parsedBody);
            } else if (path.includes('/client-goals')) {
                result = await handlePostClientGoal(parsedBody);
            } else if (path.includes('/nps-surveys')) {
                result = await handlePostNpsSurvey(parsedBody);
            } else if (path === '/coach-kpis/compute') {
                result = await handlePostCoachKpisCompute(parsedBody);
            } else if (path === '/follow-up-rules/evaluate') {
                result = await handlePostFollowUpRulesEvaluate();
            } else if (path.includes('/follow-up-rules')) {
                result = await handlePostFollowUpRule(parsedBody);
            } else {
                result = await handlePostChat(parsedBody);
            }
        } else if (method === 'PUT') {
            if (path.match(/\/kone-apk-releases\/(\d+)/)) {
                const releaseId = path.match(/\/kone-apk-releases\/(\d+)/)[1];
                result = await handlePutKoneApkRelease(releaseId, parsedBody);
            } else if (path.match(/\/kino-chip-batches\/(\d+)/)) {
                const batchId = path.match(/\/kino-chip-batches\/(\d+)/)[1];
                result = await handlePutKinoChipBatch(batchId, parsedBody);
            } else if (path.match(/\/kino-chip-models\/([A-Z0-9]+)/i)) {
                const code = path.match(/\/kino-chip-models\/([A-Z0-9]+)/i)[1];
                result = await handlePutKinoChipModel(code, parsedBody);
            } else if (path.includes('/kino-devices/')) {
                const deviceId = path.split('/kino-devices/')[1];
                result = await handlePutKinoDevice(deviceId, parsedBody);
            } else if (path.includes('/users/')) {
                const user_id = path.split('/users/')[1];
                result = await handlePutUser(user_id, parsedBody);
            } else if (path.includes('/coaches/')) {
                const coachId = path.split('/coaches/')[1];
                result = await handlePutCoach(coachId, parsedBody);
            } else if (path.match(/\/channels\/(\d+)\/sub-age-labels$/)) {
                const channelId = path.match(/\/channels\/(\d+)\/sub-age-labels$/)[1];
                result = await handlePutChannelSubAgeLabels(channelId, parsedBody, adminCtx);
            } else if (path.match(/\/channels\/(\d+)\/admin-tabs$/)) {
                const channelId = path.match(/\/channels\/(\d+)\/admin-tabs$/)[1];
                result = await handlePutChannelAdminTabs(channelId, parsedBody, adminCtx);
            } else if (path.match(/\/channels\/(\d+)\/manage-subchannels$/)) {
                const channelId = path.match(/\/channels\/(\d+)\/manage-subchannels$/)[1];
                result = await handlePutChannelManageSubchannels(channelId, parsedBody, adminCtx);
            } else if (path.includes('/channels/')) {
                const channelId = path.split('/channels/')[1];
                result = await handlePutChannel(channelId, parsedBody, adminCtx);
            } else if (path.includes('/dots/')) {
                const dotId = path.split('/dots/')[1];
                result = await handlePutDot(dotId, parsedBody);
            } else if (path.includes('/channel-inventory/')) {
                const invId = path.split('/channel-inventory/')[1];
                result = await handlePutChannelInventory(invId, parsedBody, adminCtx);
            } else if (path.includes('/store-items/')) {
                const itemId = path.split('/store-items/')[1];
                result = await handlePutStoreItem(itemId, parsedBody);
            } else if (path.includes('/orders/')) {
                const orderId = path.split('/orders/')[1];
                result = await handlePutOrder(orderId, parsedBody);
            } else if (path.includes('/commission-settings/')) {
                const settingId = path.split('/commission-settings/')[1];
                result = await handlePutCommissionSetting(settingId, parsedBody);
            } else if (path.includes('/coach-payouts/')) {
                const payoutId = path.split('/coach-payouts/')[1];
                result = await handlePutCoachPayout(payoutId, parsedBody);
            } else if (path.includes('/channel-payouts/')) {
                const payoutId = path.split('/channel-payouts/')[1];
                result = await handlePutChannelPayout(payoutId, parsedBody);
            } else if (path.includes('/partner-commission-config')) {
                result = await handlePutPartnerCommissionConfig(parsedBody);
            } else if (path.includes('/partner-payouts/')) {
                const payoutId = path.split('/partner-payouts/')[1];
                result = await handlePutPartnerPayout(payoutId, parsedBody);
            } else if (path.includes('/partners/')) {
                const partnerId = path.split('/partners/')[1];
                result = await handlePutPartner(partnerId, parsedBody);
            } else if (path.includes('/academy/lessons/')) {
                const lessonId = path.split('/academy/lessons/')[1];
                result = await handlePutAcademyLesson(lessonId, parsedBody);
            } else if (path.includes('/academy/courses/')) {
                const courseId = path.split('/academy/courses/')[1];
                result = await handlePutAcademyCourse(courseId, parsedBody);
            } else if (path.includes('/academy/library/')) {
                const libId = path.split('/academy/library/')[1];
                result = await handlePutAcademyLibraryItem(libId, parsedBody);
            } else if (path.match(/\/admin\/saved-reports\/(\d+)/)) {
                const rId = path.match(/\/admin\/saved-reports\/(\d+)/)[1];
                result = await handlePutSavedReport(rId, parsedBody);
            } else if (path.includes('/admin-accounts/')) {
                const accountId = path.split('/admin-accounts/')[1];
                result = await handlePutAdminAccount(accountId, parsedBody, adminCtx);
            } else if (path.match(/\/tickets\/(\d+)/)) {
                const ticketId = path.match(/\/tickets\/(\d+)/)[1];
                result = await handlePutTicket(ticketId, parsedBody);
            } else if (path === '/questionnaire-questions/reorder') {
                result = await handlePutQuestionnaireQuestionsReorder(parsedBody);
            } else if (path.match(/\/questionnaire-questions\/(\d+)/)) {
                const qqId = path.match(/\/questionnaire-questions\/(\d+)/)[1];
                result = await handlePutQuestionnaireQuestion(qqId, parsedBody);
            } else if (path.match(/\/questionnaires\/(\d+)/)) {
                const qId = path.match(/\/questionnaires\/(\d+)/)[1];
                result = await handlePutQuestionnaire(qId, parsedBody);
            } else if (path.match(/\/health-plans\/(\d+)/)) {
                const planId = path.match(/\/health-plans\/(\d+)/)[1];
                result = await handlePutHealthPlan(planId, parsedBody);
            } else if (path.match(/\/health-plan-templates\/(\d+)/)) {
                const tplId = path.match(/\/health-plan-templates\/(\d+)/)[1];
                result = await handlePutHealthPlanTemplate(tplId, parsedBody);
            } else if (path.match(/\/coach-tags\/(\d+)/)) {
                const tagId = path.match(/\/coach-tags\/(\d+)/)[1];
                result = await handlePutCoachTag(tagId, parsedBody);
            } else if (path.match(/\/coach-notes\/(\d+)/)) {
                const noteId = path.match(/\/coach-notes\/(\d+)/)[1];
                result = await handlePutCoachNote(noteId, parsedBody);
            } else if (path.match(/\/message-templates\/(\d+)/)) {
                const tplId = path.match(/\/message-templates\/(\d+)/)[1];
                result = await handlePutMessageTemplate(tplId, parsedBody);
            } else if (path.match(/\/appointments\/(\d+)/)) {
                const apptId = path.match(/\/appointments\/(\d+)/)[1];
                result = await handlePutAppointment(apptId, parsedBody);
            } else if (path.match(/\/client-goals\/(\d+)/)) {
                const goalId = path.match(/\/client-goals\/(\d+)/)[1];
                result = await handlePutClientGoal(goalId, parsedBody);
            } else if (path.match(/\/follow-up-rules\/(\d+)/)) {
                const ruleId = path.match(/\/follow-up-rules\/(\d+)/)[1];
                result = await handlePutFollowUpRule(ruleId, parsedBody);
            } else if (path.match(/\/lab-providers\/(\d+)/)) {
                const pid = path.match(/\/lab-providers\/(\d+)/)[1];
                result = await handlePutLabProvider(pid, parsedBody);
            } else {
                result = { success: false, error: `Unknown PUT route: ${path}` };
            }
        } else if (method === 'DELETE') {
            if (path.match(/\/kone-apk-releases\/(\d+)/)) {
                const releaseId = path.match(/\/kone-apk-releases\/(\d+)/)[1];
                result = await handleDeleteKoneApkRelease(releaseId);
            } else if (path.match(/\/kino-chip-batches\/(\d+)/)) {
                const batchId = path.match(/\/kino-chip-batches\/(\d+)/)[1];
                result = await handleDeleteKinoChipBatch(batchId);
            } else if (path.match(/\/kino-chip-models\/([A-Z0-9]+)/i)) {
                const code = path.match(/\/kino-chip-models\/([A-Z0-9]+)/i)[1];
                result = await handleDeleteKinoChipModel(code);
            } else if (path.includes('/kino-devices/')) {
                const deviceId = path.split('/kino-devices/')[1];
                result = await handleDeleteKinoDevice(deviceId);
            } else if (path.includes('/users/')) {
                const user_id = path.split('/users/')[1];
                result = await handleDeleteUser(user_id);
            } else if (path.includes('/coaches/')) {
                const coachId = path.split('/coaches/')[1];
                result = await handleDeleteCoach(coachId);
            } else if (path.includes('/channels/')) {
                const channelId = path.split('/channels/')[1];
                result = await handleDeleteChannel(channelId, adminCtx);
            } else if (path.includes('/partners/')) {
                const partnerId = path.split('/partners/')[1];
                result = await handleDeletePartner(partnerId);
            } else if (path.includes('/dots/')) {
                const dotId = path.split('/dots/')[1];
                result = await handleDeleteDot(dotId);
            } else if (path.includes('/invitations/')) {
                const inviteId = path.split('/invitations/')[1];
                result = await handleDeleteInvitation(inviteId);
            } else if (path.includes('/channel-inventory/')) {
                const invId = path.split('/channel-inventory/')[1];
                result = await handleDeleteChannelInventory(invId, adminCtx);
            } else if (path.includes('/store-items/')) {
                const itemId = path.split('/store-items/')[1];
                result = await handleDeleteStoreItem(itemId);
            } else if (path.includes('/academy/lessons/')) {
                const lessonId = path.split('/academy/lessons/')[1];
                result = await handleDeleteAcademyLesson(lessonId);
            } else if (path.includes('/academy/courses/')) {
                const courseId = path.split('/academy/courses/')[1];
                result = await handleDeleteAcademyCourse(courseId);
            } else if (path.includes('/academy/library/')) {
                const libId = path.split('/academy/library/')[1];
                result = await handleDeleteAcademyLibraryItem(libId);
            } else if (path.match(/\/admin\/saved-reports\/(\d+)/)) {
                const rId = path.match(/\/admin\/saved-reports\/(\d+)/)[1];
                result = await handleDeleteSavedReport(rId);
            } else if (path.includes('/admin-accounts/')) {
                const accountId = path.split('/admin-accounts/')[1];
                result = await handleDeleteAdminAccount(accountId, adminCtx);
            } else if (path.match(/\/tickets\/(\d+)/)) {
                const ticketId = path.match(/\/tickets\/(\d+)/)[1];
                result = await handleDeleteTicket(ticketId);
            } else if (path.match(/\/questionnaire-questions\/(\d+)/)) {
                const qqId = path.match(/\/questionnaire-questions\/(\d+)/)[1];
                result = await handleDeleteQuestionnaireQuestion(qqId);
            } else if (path.match(/\/questionnaires\/(\d+)/)) {
                const qId = path.match(/\/questionnaires\/(\d+)/)[1];
                result = await handleDeleteQuestionnaire(qId);
            } else if (path.match(/\/health-plan-templates\/(\d+)/)) {
                const tplId = path.match(/\/health-plan-templates\/(\d+)/)[1];
                result = await handleDeleteHealthPlanTemplate(tplId);
            } else if (path.match(/\/coach-tags\/(\d+)/)) {
                const tagId = path.match(/\/coach-tags\/(\d+)/)[1];
                result = await handleDeleteCoachTag(tagId);
            } else if (path.includes('/coach-tag-assignments')) {
                result = await handleDeleteCoachTagAssignment(query);
            } else if (path.match(/\/coach-notes\/(\d+)/)) {
                const noteId = path.match(/\/coach-notes\/(\d+)/)[1];
                result = await handleDeleteCoachNote(noteId);
            } else if (path.match(/\/message-templates\/(\d+)/)) {
                const tplId = path.match(/\/message-templates\/(\d+)/)[1];
                result = await handleDeleteMessageTemplate(tplId);
            } else if (path.match(/\/appointments\/(\d+)/)) {
                const apptId = path.match(/\/appointments\/(\d+)/)[1];
                result = await handleDeleteAppointment(apptId);
            } else if (path.match(/\/client-goals\/(\d+)/)) {
                const goalId = path.match(/\/client-goals\/(\d+)/)[1];
                result = await handleDeleteClientGoal(goalId);
            } else if (path.match(/\/follow-up-rules\/(\d+)/)) {
                const ruleId = path.match(/\/follow-up-rules\/(\d+)/)[1];
                result = await handleDeleteFollowUpRule(ruleId);
            } else if (path.match(/\/lab-providers\/(\d+)/)) {
                const pid = path.match(/\/lab-providers\/(\d+)/)[1];
                result = await handleDeleteLabProvider(pid);
            } else if (path.match(/\/lab-user-mappings\/(\d+)/)) {
                const mid = path.match(/\/lab-user-mappings\/(\d+)/)[1];
                result = await handleDeleteLabUserMapping(mid);
            } else {
                result = { success: false, error: `Unknown DELETE route: ${path}` };
            }
        } else if (method === 'PATCH') {
            if (path.includes('/users/')) {
                const user_id = path.split('/users/')[1];
                result = await handlePatchUser(user_id, parsedBody);
            } else if (path.match(/\/questionnaire-assignments\/(\d+)/)) {
                const aId = path.match(/\/questionnaire-assignments\/(\d+)/)[1];
                result = await handlePatchQuestionnaireAssignment(aId, parsedBody);
            } else if (path.match(/\/plan-reminders\/(\d+)/)) {
                const rId = path.match(/\/plan-reminders\/(\d+)/)[1];
                result = await handlePatchPlanReminder(rId, parsedBody);
            } else if (path.match(/\/nps-surveys\/(\d+)/)) {
                const surveyId = path.match(/\/nps-surveys\/(\d+)/)[1];
                result = await handlePatchNpsSurvey(surveyId, parsedBody);
            } else {
                result = { success: false, error: `Unknown PATCH route: ${path}` };
            }
        } else {
            result = { success: false, error: `Unknown route: ${method} ${path}` };
        }

        const statusCode = result.statusCode || 200;
        const { statusCode: _sc, _rawText, content, ...resultBody } = result;
        const isText = _rawText === true;
        const responseHeaders = isText
            ? { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' }
            : corsHeaders;
        const responsePayload = {
            isBase64Encoded: false,
            statusCode,
            headers: responseHeaders,
            body: isText ? (content || '') : JSON.stringify(resultBody)
        };

        if (isStandardHttp) {
            resp.setStatusCode(statusCode);
            Object.entries(responseHeaders).forEach(([k, v]) => resp.setHeader(k, v));
            resp.send(responsePayload.body);
            return;
        }

        return responsePayload;

    } catch (error) {
        const errPayload = {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: error.message, debug: { path, method } })
        };
        if (isStandardHttp) {
            resp.setStatusCode(500);
            resp.send(errPayload.body);
            return;
        }
        return errPayload;
    }
};
