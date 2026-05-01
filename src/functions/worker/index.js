const { pool } = require('./lib/db');
const { recordOrderCommissions } = require('./lib/commissions');
const ossLib = require('./lib/oss');
const crypto = require('crypto');

const generateUserId = () => crypto.randomBytes(4).toString('hex');

// WeChat access_token cache (module-level, survives container reuse)
let _wxToken = null;
let _wxTokenExpiry = 0;
async function getWxAccessToken() {
    if (_wxToken && Date.now() < _wxTokenExpiry) return _wxToken;
    const appid = process.env.WX_APPID;
    const secret = process.env.WX_SECRET;
    const res = await fetch(`https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appid}&secret=${secret}`);
    const data = await res.json();
    if (data.errcode) throw new Error(`WX token error: ${data.errmsg} (${data.errcode})`);
    _wxToken = data.access_token;
    _wxTokenExpiry = Date.now() + (data.expires_in - 300) * 1000;
    return _wxToken;
}
const { getNowShanghai, calculateAge } = require('./lib/time-utils');
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
    emotional_support:  require('./prompts/chat/emotional'),
};
const systemNutritionTemplate = require('./prompts/systemNutrition');
const systemHealthAdviceTemplate = require('./prompts/systemHealthAdvice');
const strings = require('./prompts/strings');

const getLlmClient = () => new OpenAI({
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
});

async function handleGetUsers() {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const query = `
            SELECT u.user_id, u.external_id, u.external_app, u.nickname, u.birth_date, u.language, u.gender,
                    u.avatar_url, u.coach_id, u.channel_id, u.roles, u.created_at, u.phone, u.email,
                    b.bio_age, b.data as bio_data,
                    p.name as coach_name,
                    c.name as channel_name, c.logo_url as channel_logo_url,
                    (SELECT content FROM notifications WHERE user_id = u.user_id AND notification_type = 'biological_report' ORDER BY sent_at DESC LIMIT 1) as latest_report,
                    (SELECT content FROM notifications WHERE user_id = u.user_id AND notification_type = 'nutrition_plan' ORDER BY sent_at DESC LIMIT 1) as latest_plan
            FROM users u
            LEFT JOIN coaches p ON u.coach_id = p.id
            LEFT JOIN channels c ON u.channel_id = c.id
            LEFT JOIN (
                SELECT DISTINCT ON (user_id) user_id, bio_age, data
                FROM biomarkers
                ORDER BY user_id, tested_at DESC
            ) b ON u.user_id = b.user_id;
        `;
        const result = await pool.query(query);
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

async function handleGetCoachList() {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const query = `
            SELECT p.id, p.name, p.email, p.phone, p.language, p.channel_id, p.user_id, p.created_at,
                   COUNT(u.user_id) AS user_count,
                   c.name AS channel_name
            FROM coaches p
            LEFT JOIN users u ON p.id = u.coach_id
            LEFT JOIN channels c ON p.channel_id = c.id
            GROUP BY p.id, c.name;
        `;
        const result = await pool.query(query);
        return { success: true, coaches: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetChannelUsers(channelId) {
    if (!channelId) return { success: false, error: 'channelId is required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const result = await pool.query(
            `SELECT u.user_id, u.external_id, u.nickname, u.birth_date, u.language, u.gender,
                    u.coach_id, u.channel_id, u.roles, u.created_at, u.phone, u.email,
                    b.bio_age, p.name AS coach_name
             FROM users u
             LEFT JOIN coaches p ON u.coach_id = p.id
             LEFT JOIN (
                 SELECT DISTINCT ON (user_id) user_id, bio_age
                 FROM biomarkers ORDER BY user_id, tested_at DESC
             ) b ON u.user_id = b.user_id
             WHERE u.channel_id = $1
             ORDER BY u.created_at DESC`,
            [channelId]
        );
        return { success: true, users: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetChannelCoaches(channelId) {
    if (!channelId) return { success: false, error: 'channelId is required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const result = await pool.query(
            `SELECT p.id, p.name, p.email, p.phone, p.language, p.channel_id, p.user_id, p.created_at,
                    COUNT(u.user_id) AS user_count
             FROM coaches p
             LEFT JOIN users u ON p.id = u.coach_id
             WHERE p.channel_id = $1
             GROUP BY p.id
             ORDER BY p.created_at DESC`,
            [channelId]
        );
        return { success: true, coaches: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetCoachUsers(coachId) {
    if (!coachId) return { success: false, error: 'coachId is required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const result = await pool.query(
            `SELECT u.user_id, u.external_id, u.nickname, u.birth_date, u.language, u.gender,
                    u.coach_id, u.channel_id, u.roles, u.created_at, u.phone, u.email,
                    b.bio_age, b.data AS bio_data, b.tested_at AS last_scan_at
             FROM users u
             LEFT JOIN (
                 SELECT DISTINCT ON (user_id) user_id, bio_age, data, tested_at
                 FROM biomarkers
                 WHERE test_type = 'kino_chip'
                 ORDER BY user_id, tested_at DESC
             ) b ON u.user_id = b.user_id
             WHERE u.coach_id = $1
             ORDER BY u.created_at DESC`,
            [coachId]
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
        const coachMessage = `### 👨‍⚕️ Coach Instruction\n\n${instruction}`;
        await pool.query(
            'INSERT INTO notifications (user_id, notification_type, content, status) VALUES ($1, $2, $3, $4)',
            [user.rows[0].user_id, 'coach_instruction', coachMessage, 'pending']
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
    const { name, email, phone, language, channel_id, user_id } = body;
    if (!name) return { success: false, error: 'name is required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const result = await pool.query(
            'INSERT INTO coaches (name, email, phone, language, channel_id, user_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
            [name, email || null, phone || null, language || 'zh', channel_id || null, user_id || null]
        );
        // If user_id provided, add 'coach' role to that user
        if (user_id) {
            await pool.query(
                `UPDATE users SET roles = array_append(roles, 'coach') WHERE user_id = $1 AND NOT ('coach' = ANY(roles))`,
                [user_id]
            );
        }
        return { success: true, id: result.rows[0].id };
    } catch (err) {
        return { success: false, error: err.detail || err.message };
    }
}

async function handlePutCoach(coachId, body) {
    const { name, email, phone, language, channel_id, user_id } = body;
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        // Get old user_id to potentially remove coach role
        const oldResult = await pool.query('SELECT user_id FROM coaches WHERE id = $1', [coachId]);
        const oldUserId = oldResult.rows[0]?.user_id;
        await pool.query(
            'UPDATE coaches SET name=$1, email=$2, phone=$3, language=$4, channel_id=$5, user_id=$6 WHERE id=$7',
            [name, email || null, phone || null, language || 'zh', channel_id || null, user_id || null, coachId]
        );
        // Add coach role to new user_id
        if (user_id) {
            await pool.query(
                `UPDATE users SET roles = array_append(roles, 'coach') WHERE user_id = $1 AND NOT ('coach' = ANY(roles))`,
                [user_id]
            );
        }
        // Remove coach role from old user_id if changed
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
        await pool.query('DELETE FROM coaches WHERE id = $1', [coachId]);
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

async function handleGetChannels() {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const result = await pool.query(`
            SELECT c.id, c.key_name, c.name, c.logo_url, c.config, c.created_at,
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

async function handlePostChannel(body) {
    const { key_name, name, logo_url } = body;
    if (!key_name) return { success: false, error: 'key_name is required', statusCode: 400 };
    if (!name)     return { success: false, error: 'name is required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const result = await pool.query(
            `INSERT INTO channels (key_name, name, logo_url) VALUES ($1, $2, $3) RETURNING id`,
            [key_name, name, logo_url || null]
        );
        return { success: true, id: result.rows[0].id };
    } catch (err) {
        return { success: false, error: err.detail || err.message };
    }
}

async function handlePutChannel(channelId, body) {
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

async function handleDeleteChannel(channelId) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        await pool.query('DELETE FROM channels WHERE id = $1', [channelId]);
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
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        if (bio_data && roles) {
            await pool.query(
                `UPDATE users SET nickname=$1, phone=$2, email=$3, gender=$4, birth_date=$5, language=$6, coach_id=$7, channel_id=$8, bio_data = bio_data || $9, roles=$10, avatar_url=COALESCE($11, avatar_url) WHERE user_id=$12`,
                [nickname || null, phone || null, email || null, gender || null, birth_date || null, language || 'zh', coach_id || null, channel_id || null, JSON.stringify(bio_data), roles, avatar_url || null, user_id]
            );
        } else if (bio_data) {
            await pool.query(
                `UPDATE users SET nickname=$1, phone=$2, email=$3, gender=$4, birth_date=$5, language=$6, coach_id=$7, channel_id=$8, bio_data = bio_data || $9, avatar_url=COALESCE($10, avatar_url) WHERE user_id=$11`,
                [nickname || null, phone || null, email || null, gender || null, birth_date || null, language || 'zh', coach_id || null, channel_id || null, JSON.stringify(bio_data), avatar_url || null, user_id]
            );
        } else if (roles) {
            await pool.query(
                `UPDATE users SET nickname=$1, phone=$2, email=$3, gender=$4, birth_date=$5, language=$6, coach_id=$7, channel_id=$8, roles=$9, avatar_url=COALESCE($10, avatar_url) WHERE user_id=$11`,
                [nickname || null, phone || null, email || null, gender || null, birth_date || null, language || 'zh', coach_id || null, channel_id || null, roles, avatar_url || null, user_id]
            );
        } else {
            await pool.query(
                `UPDATE users SET nickname=$1, phone=$2, email=$3, gender=$4, birth_date=$5, language=$6, coach_id=$7, channel_id=$8, avatar_url=COALESCE($9, avatar_url) WHERE user_id=$10`,
                [nickname || null, phone || null, email || null, gender || null, birth_date || null, language || 'zh', coach_id || null, channel_id || null, avatar_url || null, user_id]
            );
        }
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetAdminAccounts() {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const result = await pool.query('SELECT id, username, created_at FROM admin_accounts ORDER BY created_at ASC');
        return { success: true, accounts: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostAdminAccount(body) {
    const { username, password } = body || {};
    if (!username || !password) return { statusCode: 400, success: false, error: 'Username and password required' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const { scryptSync, randomBytes } = require('crypto');
        const salt = randomBytes(16).toString('hex');
        const hash = scryptSync(password, salt, 64).toString('hex');
        const result = await pool.query(
            'INSERT INTO admin_accounts (username, password_hash) VALUES ($1, $2) RETURNING id, username, created_at',
            [username, `${salt}:${hash}`]
        );
        return { success: true, account: result.rows[0] };
    } catch (err) {
        if (err.code === '23505') return { statusCode: 409, success: false, error: 'Username already exists' };
        return { success: false, error: err.message };
    }
}

async function handlePutAdminAccount(id, body) {
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

async function handleDeleteAdminAccount(id) {
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
        const result = await pool.query('SELECT password_hash FROM admin_accounts WHERE username = $1', [username]);
        if (result.rows.length === 0) {
            await new Promise(r => setTimeout(r, 200));
            return { statusCode: 401, success: false, error: 'Invalid credentials' };
        }
        const { scryptSync, timingSafeEqual } = require('crypto');
        const [salt, storedHash] = result.rows[0].password_hash.split(':');
        const derivedKey = scryptSync(password, salt, 64);
        const match = timingSafeEqual(derivedKey, Buffer.from(storedHash, 'hex'));
        if (!match) return { statusCode: 401, success: false, error: 'Invalid credentials' };
        return { success: true, token: process.env.API_BEARER_TOKEN };
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
                   i.channel_id, i.created_by,
                   c.name AS channel_name,
                   u.nickname AS creator_name
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

async function handlePostInvitation(body) {
    const { created_by, channel_id, type = 'coach', max_uses = null } = body;
    if (!channel_id) return { success: false, error: 'channel_id is required', statusCode: 400 };
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
            `INSERT INTO invitations (code, created_by, channel_id, type, max_uses)
             VALUES ($1, $2, $3, $4, $5) RETURNING id, code`,
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

async function handleBindPhone(user_id, code) {
    try {
        if (!code) return { success: false, error: 'code is required' };
        const token = await getWxAccessToken();
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
    const { code, coach_id, invite_code } = body;
    if (!code) return { success: false, error: 'code is required' };

    const appid  = process.env.WX_APPID;
    const secret = process.env.WX_SECRET;
    if (!appid || !secret) return { success: false, error: 'WX_APPID / WX_SECRET not configured' };

    const wxRes = await fetch(
        `https://api.weixin.qq.com/sns/jscode2session?appid=${appid}&secret=${secret}&js_code=${code}&grant_type=authorization_code`
    );
    const wxData = await wxRes.json();
    if (wxData.errcode) return { success: false, error: `WeChat: ${wxData.errmsg} (${wxData.errcode})` };

    const openid = wxData.openid;

    // Look up existing user — return with channel info and roles
    const existing = await pool.query(
        `SELECT u.user_id, u.nickname, u.birth_date, u.gender, u.language, u.phone, u.email,
                u.avatar_url, u.coach_id, u.channel_id, u.roles, u.created_at, u.bio_data, b.bio_age,
                p.name AS coach_name,
                c.name AS channel_name, c.logo_url AS channel_logo_url
         FROM users u
         LEFT JOIN coaches p ON u.coach_id = p.id
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
        const { channel_name, channel_logo_url, ...user } = existing.rows[0];
        const channel = channel_name ? { name: channel_name, logo_url: channel_logo_url } : null;
        // If user is a coach, fetch their coach record
        let coach = null;
        if (user.roles && user.roles.includes('coach')) {
            const coachRes = await pool.query(
                `SELECT id, name, email, phone, language, channel_id, user_id FROM coaches WHERE user_id = $1 LIMIT 1`,
                [user.user_id]
            );
            if (coachRes.rows.length > 0) coach = coachRes.rows[0];
        }
        return { success: true, user, channel, coach };
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
        `INSERT INTO users (user_id, external_id, external_app, language, coach_id, channel_id, invited_by_invitation_id)
         VALUES ($1, $2, 'wechat', 'zh', $3, $4, $5)
         RETURNING user_id, nickname, birth_date, gender, language, phone, email, avatar_url, coach_id, channel_id, roles, created_at, bio_data`,
        [newUserId, openid, resolvedCoachId, channelId, inviteRecord?.id || null]
    );

    if (inviteRecord) {
        await pool.query(
            `UPDATE invitations SET use_count = use_count + 1 WHERE id = $1
             AND (max_uses IS NULL OR use_count < max_uses)`,
            [inviteRecord.id]
        );
        await pool.query(
            'INSERT INTO invitation_uses (invitation_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [inviteRecord.id, newUserId]
        );
    }

    let channel = null;
    if (channelId) {
        const chanRes = await pool.query('SELECT name, logo_url FROM channels WHERE id = $1', [channelId]);
        if (chanRes.rows.length > 0) channel = { name: chanRes.rows[0].name, logo_url: chanRes.rows[0].logo_url };
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

async function saveChatMessage(user_id, role, content) {
    try {
        await pool.query(
            'INSERT INTO chat_messages (user_id, role, content) VALUES ($1, $2, $3)',
            [user_id, role, content]
        );
    } catch (err) {
        console.error('Failed to save chat message:', err);
    }
}

async function handleGetChatHistory(openid) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        if (!openid) return { success: true, messages: [] };
        const limit = parseInt(process.env.CHAT_HISTORY_LIMIT || '20', 10);
        const result = await pool.query(
            `SELECT role, content, created_at FROM (
                SELECT role, content, created_at FROM chat_messages
                WHERE user_id = $1
                ORDER BY created_at DESC
                LIMIT $2
            ) sub ORDER BY created_at ASC`,
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
        const scanDate = (tested_at || new Date().toISOString()).slice(0, 10);
        const seed = `${user_id}:${scanDate}`;
        console.log(JSON.stringify({
            level: 'INFO',
            msg: 'biomarker_tags_derived',
            data: { user_id, tags, compliance: tagContext.compliance, history_count: tagContext.history.length, weight_count: tagContext.weightHistory.length }
        }));

        const estimator = new BiomarkerEstimator(age, test_data, { Weight: bioData.weight, Height: bioData.height }, tags, { seed });
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
            ? `已完成生物标志物检测分析。您的生理年龄为 **${bioAgeReport.BioAge.toFixed(1)} 岁**。请查看详细报告！`
            : `I've analyzed your biomarker test. Your biological age is **${bioAgeReport.BioAge.toFixed(1)} years**. Check your report for details!`;
        await pool.query(
            'INSERT INTO notifications (user_id, biomarker_id, notification_type, content, status) VALUES ($1, $2, $3, $4, $5)',
            [user_id, biomarkerId, 'biological_report', content, 'pending']
        );
        await saveChatMessage(user_id, 'ai', content);

        return { success: true, user_id, biomarkers: estimationReport.BiomarkerValues, bioage_profile: bioAgeReport };
    } else {
        // Non-kino: save raw record only, no estimation
        await pool.query(
            'INSERT INTO biomarkers (user_id, test_type, data, tested_at) VALUES ($1, $2, $3, $4)',
            [user_id, test_type, JSON.stringify({ actual: test_data }), tested_at || new Date().toISOString()]
        );
        return { success: true, user_id };
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
                questionnaire_context: formatQuestionnaireContext(
                    fetched.questionnaire_responses?.rows || [],
                    user.language
                ),
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
            const cleanHistory = [];
            for (const row of historyResult.rows) {
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

            const completion = await client.chat.completions.create({
                model: model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    ...cleanHistory,
                ],
            });

            const rawReply = completion.choices[0].message.content;

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

            const reply = rawReply.replace(/\n?\{"action"\s*:\s*"record_weight"[^}]*\}/g, '').trim();

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

async function handleGetKinoDevices() {
    const result = await pool.query(`
        SELECT kd.id, kd.serial_number, kd.name, kd.status, kd.notes, kd.registered_at, kd.created_at,
               kd.coach_id, c.name AS coach_name,
               kd.channel_id, ch.name AS channel_name,
               COUNT(b.id)::int AS test_count,
               MAX(b.tested_at) AS last_used_at
        FROM kino_devices kd
        LEFT JOIN coaches c ON c.id = kd.coach_id
        LEFT JOIN channels ch ON ch.id = kd.channel_id
        LEFT JOIN biomarkers b ON b.kino_device_id = kd.id
        GROUP BY kd.id, c.name, ch.name
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
        `SELECT kb.status AS batch_status
         FROM kino_chips kc
         JOIN kino_chip_batches kb ON kb.id = kc.batch_id
         WHERE kc.chip_code = $1`,
        [chip_id]
    );
    if (batchCheck.rows.length === 0 || batchCheck.rows[0].batch_status !== 'active') {
        return { found: false };
    }

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
    if (result.rows.length === 0) return { found: false };
    const row = result.rows[0];
    return {
        found: true,
        used: row.scan_status === 'completed',
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
        `SELECT kb.status AS batch_status
         FROM kino_chips kc
         JOIN kino_chip_batches kb ON kb.id = kc.batch_id
         WHERE kc.chip_code = $1`,
        [chip_id]
    );
    if (batchCheck.rows.length === 0 || batchCheck.rows[0].batch_status !== 'active') {
        return { success: false, status: 'invalid_chip' };
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

        const [bioResult, dotsResult] = await Promise.all([
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
        ]);

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

// ── Academy handlers ──────────────────────────────────────────────────────────

async function handleGetAcademyCourses() {
    try {
        const result = await pool.query('SELECT * FROM academy_courses ORDER BY sort_order ASC, created_at DESC');
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

// ── Tickets ───────────────────────────────────────────────────────────────────

const TICKET_STATUSES   = new Set(['open', 'in_progress', 'resolved', 'closed']);
const TICKET_PRIORITIES = new Set(['low', 'normal', 'high']);

async function handleGetTickets() {
    try {
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

        // Get question config for save_target handling
        const qRes = await pool.query(
            `SELECT save_target, save_field, save_biomarker_type FROM questionnaire_questions WHERE id = $1`,
            [question_id]
        );
        if (!qRes.rows.length) return { statusCode: 404, success: false, error: 'Question not found' };
        const { save_target, save_field, save_biomarker_type } = qRes.rows[0];

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

exports.handler = async (req, resp, context) => {
    const isStandardHttp = resp && typeof resp.send === 'function';
    let event = req;

    if (Buffer.isBuffer(req)) {
        try { event = JSON.parse(req.toString()); } catch (e) {}
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

    const expectedBearer = process.env.API_BEARER_TOKEN;
    if (expectedBearer && rawPath && path !== '/admin/login') {
        const authHeader = (event.headers && (event.headers['authorization'] || event.headers['Authorization'])) || '';
        if (authHeader !== `Bearer ${expectedBearer}`) {
            const unauthorizedPayload = {
                isBase64Encoded: false,
                statusCode: 401,
                headers: corsHeaders,
                body: JSON.stringify({ error: 'Unauthorized' })
            };
            if (isStandardHttp) {
                resp.setStatusCode(401);
                Object.entries(corsHeaders).forEach(([k, v]) => resp.setHeader(k, v));
                resp.send(JSON.stringify({ error: 'Unauthorized' }));
                return;
            }
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
            if (path.includes('/kino-devices')) {
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
                result = await handleGetChatHistory(query.openid);
            } else if (path.includes('/biomarkers')) {
                result = await handleGetBiomarkers(query.openid);
            } else if (path.includes('/notifications')) {
                result = await handleGetNotifications(query.openid);
            } else if (path.includes('/nutrition-plan')) {
                result = await handleGetNutritionPlan(query.openid);
            } else if (path.includes('/my-cartridges')) {
                result = await handleGetMyCartridges(query.openid);
            } else if (path.includes('/dots-inventory')) {
                result = await handleGetDotsInventory();
            } else if (path.includes('/store-items')) {
                result = await handleGetStoreItems(query);
            } else if (path.includes('/my-orders')) {
                result = await handleGetMyOrders(query.openid);
            } else if (path.includes('/orders')) {
                result = await handleGetOrders();
            } else if (path.includes('/coach-list')) {
                result = await handleGetCoachList();
            } else if (path.match(/\/channel-users\/(\d+)/)) {
                result = await handleGetChannelUsers(path.match(/\/channel-users\/(\d+)/)[1]);
            } else if (path.match(/\/channel-coaches\/(\d+)/)) {
                result = await handleGetChannelCoaches(path.match(/\/channel-coaches\/(\d+)/)[1]);
            } else if (path.match(/\/coach-users\/(\d+)/)) {
                result = await handleGetCoachUsers(path.match(/\/coach-users\/(\d+)/)[1]);
            } else if (path.includes('/invitations')) {
                result = await handleGetInvitations(query);
            } else if (path.includes('/channels')) {
                result = await handleGetChannels();
            } else if (path.includes('/academy/courses')) {
                result = await handleGetAcademyCourses();
            } else if (path.includes('/academy/library')) {
                result = await handleGetAcademyLibrary();
            } else if (path.includes('/oss/presign')) {
                result = await handleGetOssPresign(query);
            } else if (path.match(/\/users\/([^/]+)/)) {
                const userId = path.match(/\/users\/([^/]+)/)[1];
                result = await handleGetUser(userId);
            } else if (path.includes('/users') || path === '/' || path === '') {
                result = await handleGetUsers();
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
            } else if (path === '/admin-accounts') {
                result = await handleGetAdminAccounts();
            } else if (path === '/tickets' || path.includes('/tickets')) {
                result = await handleGetTickets();
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
            } else {
                result = { success: false, error: `Unknown GET route: ${path}` };
            }
        } else if (method === 'POST') {
            if (path === '/admin/login') {
                result = await handleAdminLogin(parsedBody);
            } else if (path === '/admin-accounts') {
                result = await handlePostAdminAccount(parsedBody);
            } else if (path === '/validate-invite') {
                result = await handleValidateInvite(parsedBody);
            } else if (path === '/wx-login') {
                result = await handleWxLogin(parsedBody);
            } else if (path === '/bind-phone') {
                const { user_id, code } = parsedBody;
                result = await handleBindPhone(user_id, code);
            } else if (path.includes('/reminders')) {
                result = await handlePostReminder(parsedBody);
            } else if (path.includes('/coach-instruction')) {
                result = await handlePostCoachInstruction(parsedBody);
            } else if (path.includes('/assign-coach')) {
                result = await handlePostAssignCoach(parsedBody);
            } else if (path.includes('/invitations')) {
                result = await handlePostInvitation(parsedBody);
            } else if (path.includes('/channels')) {
                result = await handlePostChannel(parsedBody);
            } else if (path.includes('/coaches')) {
                result = await handlePostCoaches(parsedBody);
            } else if (path.includes('/store-items')) {
                result = await handlePostStoreItem(parsedBody);
            } else if (path.includes('/orders')) {
                result = await handlePostOrder(parsedBody);
            } else if (path.includes('/dots')) {
                result = await handlePostDots(parsedBody);
            } else if (path === '/users') {
                result = await handlePostUsers(parsedBody);
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
            } else if (path.includes('/health-advice')) {
                result = await handlePostHealthAdvice(parsedBody);
            } else if (path === '/biomarkers') {
                result = await handlePostBiomarkers(parsedBody);
            } else if (path.includes('/generate-coach-payouts')) {
                result = await handlePostGenerateCoachPayouts(parsedBody);
            } else if (path.includes('/generate-channel-payouts')) {
                result = await handlePostGenerateChannelPayouts(parsedBody);
            } else if (path === '/academy/courses') {
                result = await handlePostAcademyCourse(parsedBody);
            } else if (path === '/academy/library') {
                result = await handlePostAcademyLibraryItem(parsedBody);
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
            } else {
                result = await handlePostChat(parsedBody);
            }
        } else if (method === 'PUT') {
            if (path.match(/\/kino-chip-batches\/(\d+)/)) {
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
            } else if (path.includes('/channels/')) {
                const channelId = path.split('/channels/')[1];
                result = await handlePutChannel(channelId, parsedBody);
            } else if (path.includes('/dots/')) {
                const dotId = path.split('/dots/')[1];
                result = await handlePutDot(dotId, parsedBody);
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
            } else if (path.includes('/academy/courses/')) {
                const courseId = path.split('/academy/courses/')[1];
                result = await handlePutAcademyCourse(courseId, parsedBody);
            } else if (path.includes('/academy/library/')) {
                const libId = path.split('/academy/library/')[1];
                result = await handlePutAcademyLibraryItem(libId, parsedBody);
            } else if (path.includes('/admin-accounts/')) {
                const accountId = path.split('/admin-accounts/')[1];
                result = await handlePutAdminAccount(accountId, parsedBody);
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
            } else {
                result = { success: false, error: `Unknown PUT route: ${path}` };
            }
        } else if (method === 'DELETE') {
            if (path.match(/\/kino-chip-batches\/(\d+)/)) {
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
                result = await handleDeleteChannel(channelId);
            } else if (path.includes('/dots/')) {
                const dotId = path.split('/dots/')[1];
                result = await handleDeleteDot(dotId);
            } else if (path.includes('/invitations/')) {
                const inviteId = path.split('/invitations/')[1];
                result = await handleDeleteInvitation(inviteId);
            } else if (path.includes('/store-items/')) {
                const itemId = path.split('/store-items/')[1];
                result = await handleDeleteStoreItem(itemId);
            } else if (path.includes('/academy/courses/')) {
                const courseId = path.split('/academy/courses/')[1];
                result = await handleDeleteAcademyCourse(courseId);
            } else if (path.includes('/academy/library/')) {
                const libId = path.split('/academy/library/')[1];
                result = await handleDeleteAcademyLibraryItem(libId);
            } else if (path.includes('/admin-accounts/')) {
                const accountId = path.split('/admin-accounts/')[1];
                result = await handleDeleteAdminAccount(accountId);
            } else if (path.match(/\/tickets\/(\d+)/)) {
                const ticketId = path.match(/\/tickets\/(\d+)/)[1];
                result = await handleDeleteTicket(ticketId);
            } else if (path.match(/\/questionnaire-questions\/(\d+)/)) {
                const qqId = path.match(/\/questionnaire-questions\/(\d+)/)[1];
                result = await handleDeleteQuestionnaireQuestion(qqId);
            } else if (path.match(/\/questionnaires\/(\d+)/)) {
                const qId = path.match(/\/questionnaires\/(\d+)/)[1];
                result = await handleDeleteQuestionnaire(qId);
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
            } else {
                result = { success: false, error: `Unknown PATCH route: ${path}` };
            }
        } else {
            result = { success: false, error: `Unknown route: ${method} ${path}` };
        }

        const statusCode = result.statusCode || 200;
        const { statusCode: _sc, ...resultBody } = result;
        const responsePayload = {
            isBase64Encoded: false,
            statusCode,
            headers: corsHeaders,
            body: JSON.stringify(resultBody)
        };

        if (isStandardHttp) {
            resp.setStatusCode(statusCode);
            Object.entries(corsHeaders).forEach(([k, v]) => resp.setHeader(k, v));
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
