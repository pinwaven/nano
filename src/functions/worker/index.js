const { pool } = require('./lib/db');
const crypto = require('crypto');

const generateUserId = () => crypto.randomBytes(4).toString('hex');
const { getNowShanghai, calculateAge } = require('./lib/time-utils');
const { BiomarkerEstimator } = require('./lib/estimator/BiomarkerEstimator');
const { BioAgeCalculator } = require('./lib/bioage/BioAgeCalculator');
const { runWorkflow: runFirstReportWorkflow } = require('./lib/reports/workflow');
const OpenAI = require('openai');
const systemChatTemplate = require('./prompts/systemChat');
const systemNutritionTemplate = require('./prompts/systemNutrition');
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
                    u.coach_id, u.created_at, u.phone, u.email,
                    b.bio_age, b.data as bio_data,
                    p.name as coach_name,
                    (SELECT content FROM notifications WHERE user_id = u.user_id AND notification_type = 'biological_report' ORDER BY sent_at DESC LIMIT 1) as latest_report,
                    (SELECT content FROM notifications WHERE user_id = u.user_id AND notification_type = 'nutrition_plan' ORDER BY sent_at DESC LIMIT 1) as latest_plan
            FROM users u
            LEFT JOIN coaches p ON u.coach_id = p.id
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

async function handleGetStoreItems(query = {}) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const showAll = query.all === 'true';
        const result = await pool.query(
            `SELECT id, key_name, name_zh, name_en, desc_zh, desc_en,
                    unit_zh, unit_en, price_cny, price_usd, tag, sort_order, active
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
    const { key_name, name_en, name_zh, desc_en, desc_zh, unit_en, unit_zh, price_cny, price_usd, tag, sort_order, active } = body;
    if (!key_name) return { success: false, error: 'key_name is required', statusCode: 400 };
    if (!name_en)  return { success: false, error: 'name_en is required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const result = await pool.query(
            `INSERT INTO store_items (key_name, name_en, name_zh, desc_en, desc_zh, unit_en, unit_zh, price_cny, price_usd, tag, sort_order, active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
            [key_name, name_en, name_zh || '', desc_en || '', desc_zh || '', unit_en || '', unit_zh || '',
             parseFloat(price_cny) || 0, parseFloat(price_usd) || 0,
             tag || null, parseInt(sort_order) || 0, active !== false]
        );
        return { success: true, id: result.rows[0].id };
    } catch (err) {
        return { success: false, error: err.detail || err.message };
    }
}

async function handlePutStoreItem(itemId, body) {
    const { name_en, name_zh, desc_en, desc_zh, unit_en, unit_zh, price_cny, price_usd, tag, sort_order, active } = body;
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        await pool.query(
            `UPDATE store_items SET name_en=$1, name_zh=$2, desc_en=$3, desc_zh=$4,
             unit_en=$5, unit_zh=$6, price_cny=$7, price_usd=$8, tag=$9, sort_order=$10, active=$11
             WHERE id=$12`,
            [name_en, name_zh || '', desc_en || '', desc_zh || '', unit_en || '', unit_zh || '',
             parseFloat(price_cny), parseFloat(price_usd),
             tag || null, parseInt(sort_order) || 0, active !== false, itemId]
        );
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

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
        const planResult = await pool.query(
            `SELECT n.content, n.sent_at
             FROM notifications n
             JOIN users u ON n.user_id = u.user_id
             WHERE u.user_id = $1 AND n.notification_type = 'nutrition_plan'
             ORDER BY n.sent_at DESC LIMIT 1`,
            [openid]
        );
        const dotsResult = await pool.query('SELECT * FROM dots ORDER BY id ASC');
        return {
            success: true,
            plan: planResult.rows[0]?.content || null,
            plan_date: planResult.rows[0]?.sent_at || null,
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

const MORNING_DOTS = ['D01', 'D05', 'D06', 'D07', 'D10', 'D11', 'D18'];
const EVENING_DOTS = ['D02', 'D03', 'D04', 'D08', 'D09', 'D12', 'D13', 'D14', 'D15', 'D16', 'D17'];
const MONTH_EN = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const WEEKDAY_EN = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const WEEKDAY_ZH = ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'];

function _generatePlanText(dotCounts, availableDotKeys, lang, startDate, days) {
    // availableDotKeys is a Set of short keys like 'D01', 'D04'
    const lines = [];
    const start = new Date(startDate + 'T00:00:00+08:00');

    for (let i = 0; i < days; i++) {
        const d = new Date(start.getTime() + i * 86400000);
        const dow = d.getDay();
        const month = d.getMonth();
        const day = d.getDate();

        const mParts = MORNING_DOTS
            .filter(k => availableDotKeys.has(k))
            .map(k => `${k}x${dotCounts[k] || 3}`);
        const eParts = EVENING_DOTS
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
            pool.query(`SELECT id, key_name, name, name_zh, ingredients, ingredients_zh FROM dots ORDER BY id ASC`),
        ]);

        if (userResult.rows.length === 0) return { success: false, error: 'User not found' };
        const user = userResult.rows[0];
        const latestBio = bioResult.rows[0] || {};
        const biomarkers = latestBio.data?.estimated || latestBio.data?.actual || {};
        const bioageProfile = latestBio.data?.bioage_profile || {};

        const startDate = getNowShanghai().toISO().split('T')[0];
        const lang = user.language || 'zh';

        // Ask LLM to assign per-dot counts based on biomarkers
        const nutritionContext = {
            language: lang,
            biomarkers,
            bioage_profile: bioageProfile,
            dots_formulary: dotsResult.rows,
        };
        const llmClient = getLlmClient();
        const model = process.env.MODEL || 'qwen-plus';
        const prompt = systemNutritionTemplate(nutritionContext);

        const completion = await llmClient.chat.completions.create({
            model,
            messages: [{ role: 'user', content: prompt }],
        });

        // Parse "DXX:N" lines into a counts map
        const llmText = completion.choices[0].message.content || '';
        const dotCounts = {};
        for (const line of llmText.split('\n')) {
            const m = line.trim().match(/^(D\d{2}):(\d+)$/);
            if (m) dotCounts[m[1]] = Math.min(10, Math.max(1, parseInt(m[2], 10)));
        }

        // Fill any missing keys with deterministic fallback
        const availableDotKeys = new Set(dotsResult.rows.map(r => r.key_name.replace(/^DOT/, 'D')));
        const fallbackCounts = _calcDotCounts(biomarkers, bioageProfile);
        for (const k of availableDotKeys) {
            if (!dotCounts[k]) dotCounts[k] = fallbackCounts[k] || 4;
        }

        const plan = _generatePlanText(dotCounts, availableDotKeys, lang, startDate, 7);

        await pool.query(
            'INSERT INTO notifications (user_id, notification_type, content, status) VALUES ($1, $2, $3, $4)',
            [user.user_id, 'nutrition_plan', plan, 'pending']
        );

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
            SELECT p.id, p.name, p.email, p.phone, p.language, p.created_at, COUNT(u.user_id) as user_count
            FROM coaches p
            LEFT JOIN users u ON p.id = u.coach_id
            GROUP BY p.id;
        `;
        const result = await pool.query(query);
        return { success: true, coaches: result.rows };
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
    const { name, email, phone, language } = body;
    if (!name) return { success: false, error: 'name is required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const result = await pool.query(
            'INSERT INTO coaches (name, email, phone, language) VALUES ($1, $2, $3, $4) RETURNING id',
            [name, email || null, phone || null, language || 'zh']
        );
        return { success: true, id: result.rows[0].id };
    } catch (err) {
        return { success: false, error: err.detail || err.message };
    }
}

async function handlePutCoach(coachId, body) {
    const { name, email, phone, language } = body;
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        await pool.query(
            'UPDATE coaches SET name=$1, email=$2, phone=$3, language=$4 WHERE id=$5',
            [name, email || null, phone || null, language || 'zh', coachId]
        );
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
    const { key_name, name, name_zh, color, color_zh, description, is_isolate, ingredients, ingredients_zh } = body;
    if (!key_name || !name) return { success: false, error: 'key_name and name are required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const maxIdResult = await pool.query('SELECT MAX(id) as max_id FROM dots');
        const nextId = (maxIdResult.rows[0].max_id || 0) + 1;

        const result = await pool.query(
            `INSERT INTO dots (id, key_name, name, name_zh, color, color_zh, description, is_isolate, ingredients, ingredients_zh)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
            [nextId, key_name, name, name_zh || null, color || null, color_zh || null, description || null, !!is_isolate,
             ingredients ? JSON.stringify(ingredients) : null,
             ingredients_zh ? JSON.stringify(ingredients_zh) : null]
        );
        return { success: true, id: result.rows[0].id };
    } catch (err) {
        return { success: false, error: err.detail || err.message };
    }
}

async function handlePutDot(dotId, body) {
    const { name, name_zh, color, color_zh, description, is_isolate, ingredients, ingredients_zh } = body;
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        await pool.query(
            `UPDATE dots SET name=$1, name_zh=$2, color=$3, color_zh=$4, description=$5, is_isolate=$6, ingredients=$7, ingredients_zh=$8 WHERE id=$9`,
            [name, name_zh || null, color || null, color_zh || null, description || null, !!is_isolate,
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

async function handlePostUsers(body) {
    const { openid, external_id: extId, external_app, nickname, phone, email, gender, birth_date, language, coach_id } = body;
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const newUserId = generateUserId();
        const external_id = extId || openid || null;
        const result = await pool.query(
            `INSERT INTO users (user_id, external_id, external_app, nickname, phone, email, gender, birth_date, language, coach_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING user_id`,
            [newUserId, external_id, external_app || null, nickname || null, phone || null, email || null, gender || null, birth_date || null, language || 'zh', coach_id || null]
        );
        return { success: true, user_id: result.rows[0].user_id };
    } catch (err) {
        return { success: false, error: err.detail || err.message };
    }
}

async function handlePutUser(user_id, body) {
    const { nickname, phone, email, gender, birth_date, language, coach_id, bio_data } = body;
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        if (bio_data) {
            await pool.query(
                `UPDATE users SET nickname=$1, phone=$2, email=$3, gender=$4, birth_date=$5, language=$6, coach_id=$7, bio_data = bio_data || $8 WHERE user_id=$9`,
                [nickname || null, phone || null, email || null, gender || null, birth_date || null, language || 'zh', coach_id || null, JSON.stringify(bio_data), user_id]
            );
        } else {
            await pool.query(
                `UPDATE users SET nickname=$1, phone=$2, email=$3, gender=$4, birth_date=$5, language=$6, coach_id=$7 WHERE user_id=$8`,
                [nickname || null, phone || null, email || null, gender || null, birth_date || null, language || 'zh', coach_id || null, user_id]
            );
        }
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

async function handleWxLogin(body) {
    const { code } = body;
    if (!code) return { success: false, error: 'code is required' };

    const appid  = process.env.WX_APPID;
    const secret = process.env.WX_SECRET;
    if (!appid || !secret) return { success: false, error: 'WX_APPID / WX_SECRET not configured' };

    // Exchange code for openid via WeChat API
    const wxRes = await fetch(
        `https://api.weixin.qq.com/sns/jscode2session?appid=${appid}&secret=${secret}&js_code=${code}&grant_type=authorization_code`
    );
    const wxData = await wxRes.json();
    if (wxData.errcode) return { success: false, error: `WeChat: ${wxData.errmsg} (${wxData.errcode})` };

    const openid = wxData.openid;

    // Look up existing user by external_id or user_id
    const existing = await pool.query(
        `SELECT u.user_id, u.nickname, u.birth_date, u.gender, u.language, u.phone, u.email,
                u.coach_id, u.created_at, u.bio_data, b.bio_age,
                p.name as coach_name
         FROM users u
         LEFT JOIN coaches p ON u.coach_id = p.id
         LEFT JOIN (
             SELECT DISTINCT ON (user_id) user_id, bio_age
             FROM biomarkers ORDER BY user_id, tested_at DESC
         ) b ON u.user_id = b.user_id
         WHERE u.external_id = $1 OR u.user_id = $1
         LIMIT 1`,
        [openid]
    );

    if (existing.rows.length > 0) {
        return { success: true, user: existing.rows[0] };
    }

    // New user — create with openid as external_id
    const newUserId = generateUserId();
    const created = await pool.query(
        `INSERT INTO users (user_id, external_id, external_app, language)
         VALUES ($1, $2, 'wechat', 'zh')
         RETURNING user_id, nickname, birth_date, gender, language, phone, email, coach_id, created_at, bio_data`,
        [newUserId, openid]
    );
    return { success: true, user: { ...created.rows[0], bio_age: null, coach_name: null } };
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

async function handlePostChat(body) {
    const { openid, nickname, gender, birth_date, language, test_type, test_data, tested_at, message, ...rest } = body;
    if (!openid) throw new Error('openid is required');

    // If openid matches an existing user_id (admin-created or simulator users), use it directly.
    // Otherwise fall back to the external_id upsert (production WeChat flow).
    let user, user_id;
    const byUserId = await pool.query(
        'SELECT user_id, birth_date, bio_data, nickname, language, phone, email FROM users WHERE user_id = $1',
        [openid]
    );
    if (byUserId.rows.length > 0) {
        user = byUserId.rows[0];
        user_id = user.user_id;
    } else {
        const { phone, email } = body;
        const userQuery = `
            INSERT INTO users (user_id, external_id, external_app, nickname, phone, email, gender, birth_date, language, bio_data)
            VALUES ($1, $2, 'wechat', $3, $4, $5, $6, $7, $8, $9)
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
        const userResult = await pool.query(userQuery, [generateUserId(), openid, nickname, phone || null, email || null, gender, birth_date, language || 'zh', JSON.stringify(rest)]);
        user = userResult.rows[0];
        user_id = user.user_id;
    }

    let biomarkerData = null;
    let bioAgeData = null;
    if (test_data && test_type === 'kino_chip') {
        const age = calculateAge(user.birth_date);
        const bioData = user.bio_data || {};
        const estimator = new BiomarkerEstimator(age, test_data, { Weight: bioData.weight, Height: bioData.height });
        const estimationReport = estimator.generateReport();
        const bioAgeCalc = new BioAgeCalculator();
        const bioAgeReport = bioAgeCalc.calculateBioAge(age, estimationReport.BiomarkerValues);

        const finalData = { actual: test_data, estimated: estimationReport.BiomarkerValues, context: estimationReport.ClinicalContext, bioage_profile: bioAgeReport };
        const biomarkerResult = await pool.query(
            'INSERT INTO biomarkers (user_id, test_type, data, bio_age, tested_at) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [user_id, test_type || 'kino_chip', JSON.stringify(finalData), bioAgeReport.BioAge, tested_at || new Date().toISOString()]
        );
        const biomarkerId = biomarkerResult.rows[0].id;
        biomarkerData = estimationReport.BiomarkerValues;
        bioAgeData = bioAgeReport;

        // Create notification for the user to see in Chat
        const content = `I've analyzed your biomarker test. Your biological age is **${bioAgeReport.BioAge.toFixed(1)} years**. Check your report for details!`;
        await pool.query(
            'INSERT INTO notifications (user_id, biomarker_id, notification_type, content, status) VALUES ($1, $2, $3, $4, $5)',
            [user_id, biomarkerId, 'biological_report', content, 'pending']
        );

        // Generate and save Nutrition Plan / Full Report
        try {
            const llmClient = getLlmClient();
            const model = process.env.MODEL || 'qwen-turbo';

            const dotsForNutrition = await pool.query(
                `SELECT id, key_name, name, name_zh, description, ingredients, ingredients_zh FROM dots ORDER BY id ASC`
            );

            const nutritionContext = {
                start_date: new Date().toISOString().split('T')[0],
                days_needed: 7,
                language: user.language,
                biomarkers: test_data,
                bioage_profile: bioAgeReport,
                dots_formulary: dotsForNutrition.rows,
            };

            const nutritionPrompt = systemNutritionTemplate(nutritionContext);
            const nutritionCompletion = await llmClient.chat.completions.create({
                model: model,
                messages: [
                    { role: 'system', content: nutritionPrompt },
                    { role: 'user', content: 'Generate my 7-day nutrition plan based on these results.' }
                ],
            });

            const reportContent = nutritionCompletion.choices[0].message.content;

            await pool.query(
                'INSERT INTO notifications (user_id, biomarker_id, notification_type, content, status) VALUES ($1, $2, $3, $4, $5)',
                [user_id, biomarkerId, 'nutrition_plan', reportContent, 'pending']
            );
        } catch (reportErr) {
            console.error('Report Generation Error:', reportErr);
        }
    } else if (test_data) {
        // Non-kino test data (e.g. body_composition) — save raw record only, no estimation
        await pool.query(
            'INSERT INTO biomarkers (user_id, test_type, data, tested_at) VALUES ($1, $2, $3, $4)',
            [user_id, test_type, JSON.stringify({ actual: test_data }), tested_at || new Date().toISOString()]
        );
    } else if (message) {
        // Regular chat message handling
        try {
            // Fetch latest biomarkers, dots inventory, and nutrition plan in parallel
            const [biomarkerResult, dotsResult, planResult] = await Promise.all([
                pool.query(
                    `SELECT bio_age, data FROM biomarkers WHERE user_id = $1 ORDER BY tested_at DESC LIMIT 1`,
                    [user_id]
                ),
                pool.query(`SELECT id, key_name, name, name_zh, description, is_isolate FROM dots ORDER BY id ASC`),
                pool.query(
                    `SELECT content FROM notifications WHERE user_id = $1 AND notification_type = 'nutrition_plan' ORDER BY sent_at DESC LIMIT 1`,
                    [user_id]
                ),
            ]);

            const latestBiomarker = biomarkerResult.rows[0] || {};
            const bioageProfile = latestBiomarker.data?.bioage_profile || {};

            const llmContext = {
                user_profile: {
                    nickname: user.nickname,
                    gender: user.gender,
                    age: calculateAge(user.birth_date),
                    language: user.language
                },
                latest_biomarkers: latestBiomarker.data?.actual || {},
                bioage_profile: bioageProfile,
                dots_formulary: dotsResult.rows,
                nutrition_plan: planResult.rows[0]?.content || null,
                message: message
            };

            const systemPrompt = systemChatTemplate(llmContext);

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

            const client = getLlmClient();
            const model = process.env.MODEL || 'qwen-turbo';

            const completion = await client.chat.completions.create({
                model: model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    ...historyResult.rows  // already shaped as { role, content }
                ],
            });

            const reply = completion.choices[0].message.content;

            // Save assistant reply to the conversation log
            await pool.query(
                'INSERT INTO chat_messages (user_id, role, content) VALUES ($1, $2, $3)',
                [user_id, 'assistant', reply]
            );

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
    return { success: true, user_id, biomarkers: biomarkerData || null, bioage_profile: bioAgeData || null };
}

async function handlePostKinoScan(body) {
    const { openid, chip_id } = body;
    if (!openid) throw new Error('openid is required');
    if (!chip_id) throw new Error('chip_id is required');

    const userResult = await pool.query(
        'SELECT user_id FROM users WHERE user_id = $1 OR external_id = $1 LIMIT 1',
        [openid]
    );
    if (userResult.rows.length === 0) throw new Error('User not found');
    const user_id = userResult.rows[0].user_id;

    const result = await pool.query(
        'INSERT INTO scans (user_id, scan_status, scan_results) VALUES ($1, $2, $3) RETURNING id',
        [user_id, 'pending', JSON.stringify({ chip_id })]
    );
    return { success: true, scan_id: result.rows[0].id };
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
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
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
            if (path.includes('/chat-history')) {
                result = await handleGetChatHistory(query.openid);
            } else if (path.includes('/biomarkers')) {
                result = await handleGetBiomarkers(query.openid);
            } else if (path.includes('/notifications')) {
                result = await handleGetNotifications(query.openid);
            } else if (path.includes('/nutrition-plan')) {
                result = await handleGetNutritionPlan(query.openid);
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
            } else if (path.includes('/users') || path === '/' || path === '') {
                result = await handleGetUsers();
            } else {
                result = { success: false, error: `Unknown GET route: ${path}` };
            }
        } else if (method === 'POST') {
            if (path === '/wx-login') {
                result = await handleWxLogin(parsedBody);
            } else if (path.includes('/coach-instruction')) {
                result = await handlePostCoachInstruction(parsedBody);
            } else if (path.includes('/assign-coach')) {
                result = await handlePostAssignCoach(parsedBody);
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
            } else if (path.includes('/kino-scan')) {
                result = await handlePostKinoScan(parsedBody);
            } else if (path.includes('/formula-dots')) {
                result = await handlePostFormulaDots(parsedBody);
            } else {
                result = await handlePostChat(parsedBody);
            }
        } else if (method === 'PUT') {
            if (path.includes('/users/')) {
                const user_id = path.split('/users/')[1];
                result = await handlePutUser(user_id, parsedBody);
            } else if (path.includes('/coaches/')) {
                const coachId = path.split('/coaches/')[1];
                result = await handlePutCoach(coachId, parsedBody);
            } else if (path.includes('/dots/')) {
                const dotId = path.split('/dots/')[1];
                result = await handlePutDot(dotId, parsedBody);
            } else if (path.includes('/store-items/')) {
                const itemId = path.split('/store-items/')[1];
                result = await handlePutStoreItem(itemId, parsedBody);
            } else if (path.includes('/orders/')) {
                const orderId = path.split('/orders/')[1];
                result = await handlePutOrder(orderId, parsedBody);
            } else {
                result = { success: false, error: `Unknown PUT route: ${path}` };
            }
        } else if (method === 'DELETE') {
            if (path.includes('/users/')) {
                const user_id = path.split('/users/')[1];
                result = await handleDeleteUser(user_id);
            } else if (path.includes('/coaches/')) {
                const coachId = path.split('/coaches/')[1];
                result = await handleDeleteCoach(coachId);
            } else if (path.includes('/dots/')) {
                const dotId = path.split('/dots/')[1];
                result = await handleDeleteDot(dotId);
            } else if (path.includes('/store-items/')) {
                const itemId = path.split('/store-items/')[1];
                result = await handleDeleteStoreItem(itemId);
            } else {
                result = { success: false, error: `Unknown DELETE route: ${path}` };
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
