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
                    u.coach_id, u.channel_id, u.roles, u.created_at, u.phone, u.email,
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
        const model = process.env.MODEL || 'qwen-plus';
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
                    b.bio_age, b.data AS bio_data
             FROM users u
             LEFT JOIN (
                 SELECT DISTINCT ON (user_id) user_id, bio_age, data
                 FROM biomarkers ORDER BY user_id, tested_at DESC
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
    const { name, logo_url } = body;
    if (!name) return { success: false, error: 'name is required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        await pool.query(
            `UPDATE channels SET name=$1, logo_url=$2 WHERE id=$3`,
            [name, logo_url || null, channelId]
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
    const { nickname, phone, email, gender, birth_date, language, coach_id, channel_id, bio_data, roles } = body;
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        if (bio_data && roles) {
            await pool.query(
                `UPDATE users SET nickname=$1, phone=$2, email=$3, gender=$4, birth_date=$5, language=$6, coach_id=$7, channel_id=$8, bio_data = bio_data || $9, roles=$10 WHERE user_id=$11`,
                [nickname || null, phone || null, email || null, gender || null, birth_date || null, language || 'zh', coach_id || null, channel_id || null, JSON.stringify(bio_data), roles, user_id]
            );
        } else if (bio_data) {
            await pool.query(
                `UPDATE users SET nickname=$1, phone=$2, email=$3, gender=$4, birth_date=$5, language=$6, coach_id=$7, channel_id=$8, bio_data = bio_data || $9 WHERE user_id=$10`,
                [nickname || null, phone || null, email || null, gender || null, birth_date || null, language || 'zh', coach_id || null, channel_id || null, JSON.stringify(bio_data), user_id]
            );
        } else if (roles) {
            await pool.query(
                `UPDATE users SET nickname=$1, phone=$2, email=$3, gender=$4, birth_date=$5, language=$6, coach_id=$7, channel_id=$8, roles=$9 WHERE user_id=$10`,
                [nickname || null, phone || null, email || null, gender || null, birth_date || null, language || 'zh', coach_id || null, channel_id || null, roles, user_id]
            );
        } else {
            await pool.query(
                `UPDATE users SET nickname=$1, phone=$2, email=$3, gender=$4, birth_date=$5, language=$6, coach_id=$7, channel_id=$8 WHERE user_id=$9`,
                [nickname || null, phone || null, email || null, gender || null, birth_date || null, language || 'zh', coach_id || null, channel_id || null, user_id]
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
                u.coach_id, u.channel_id, u.roles, u.created_at, u.bio_data, b.bio_age,
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

    // New user — require an invite code to register
    if (!invite_code && !coach_id) {
        return { success: false, new_user: true };
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
         RETURNING user_id, nickname, birth_date, gender, language, phone, email, coach_id, channel_id, roles, created_at, bio_data`,
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

    return { success: true, user: { ...created.rows[0], bio_age: null, coach_name: null }, channel };
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
        await saveChatMessage(user_id, 'ai', content);

        // Generate and save Nutrition Plan / Full Report
        try {
            const llmClient = getLlmClient();
            const model = process.env.MODEL || 'qwen-plus';

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
            await saveChatMessage(user_id, 'ai', reportContent);
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

            // Normalize roles ('ai' → 'assistant') and collapse consecutive same-role turns
            // that can accumulate from orphaned tool responses (health-advice, kino, etc.)
            const cleanHistory = [];
            for (const row of historyResult.rows) {
                const role = row.role === 'ai' ? 'assistant' : row.role;
                const last = cleanHistory[cleanHistory.length - 1];
                if (last && last.role === role) {
                    last.content = row.content; // keep most recent of consecutive same-role
                } else {
                    cleanHistory.push({ role, content: row.content });
                }
            }
            // History must start with a user turn after the system message
            while (cleanHistory.length > 0 && cleanHistory[0].role !== 'user') {
                cleanHistory.shift();
            }

            const client = getLlmClient();
            const model = process.env.MODEL || 'qwen-turbo';

            const completion = await client.chat.completions.create({
                model: model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    ...cleanHistory,
                ],
            });

            const reply = completion.choices[0].message.content;

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
    return { success: true, user_id, biomarkers: biomarkerData || null, bioage_profile: bioAgeData || null };
}

async function handlePostChatMessages(body) {
    const { openid, role, content } = body;
    if (!openid || !role || !content) return { success: false, error: 'openid, role, and content are required', statusCode: 400 };
    await saveChatMessage(openid, role, content);
    return { success: true };
}

async function handleGetKinoChip(chip_id) {
    if (!chip_id) throw new Error('chip_id is required');
    const result = await pool.query(
        `SELECT s.id, s.user_id, s.scan_status, u.nickname
         FROM scans s
         JOIN users u ON u.user_id = s.user_id
         WHERE s.chip_id = $1 LIMIT 1`,
        [chip_id]
    );
    if (result.rows.length === 0) return { found: false };
    const { id: scan_id, user_id, scan_status, nickname } = result.rows[0];
    return { found: true, used: scan_status === 'completed', scan_id, user_id, nickname, scan_status };
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
    const { chip_id, data, bio_age } = body;
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
        `INSERT INTO biomarkers (user_id, test_type, data, bio_age, tested_at)
         VALUES ($1, 'kino_chip', $2, $3, NOW())
         RETURNING id`,
        [user_id, JSON.stringify(data), bio_age ?? null]
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
        const model = process.env.MODEL || 'qwen-plus';
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
            if (path.includes('/kino-chip')) {
                result = await handleGetKinoChip(query.chip_id);
            } else if (path.includes('/chat-history')) {
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
            } else if (path.includes('/kino-result')) {
                result = await handlePostKinoResult(parsedBody);
            } else if (path.includes('/kino-scan')) {
                result = await handlePostKinoScan(parsedBody);
            } else if (path.includes('/chat-messages')) {
                result = await handlePostChatMessages(parsedBody);
            } else if (path.includes('/formula-dots')) {
                result = await handlePostFormulaDots(parsedBody);
            } else if (path.includes('/health-advice')) {
                result = await handlePostHealthAdvice(parsedBody);
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
