const { pool } = require('./lib/db');
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

async function handleGetCustomers() {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const query = `
            SELECT u.id, u.wechat_openid, u.nickname, u.birth_date, u.language, u.gender,
                    u.phm_id, u.created_at,
                    b.bio_age, b.data as bio_data,
                    p.name as coach_name,
                    (SELECT content FROM notifications WHERE user_id = u.id AND notification_type = 'biological_report' ORDER BY sent_at DESC LIMIT 1) as latest_report,
                    (SELECT content FROM notifications WHERE user_id = u.id AND notification_type = 'nutrition_plan' ORDER BY sent_at DESC LIMIT 1) as latest_plan
            FROM users u
            LEFT JOIN phms p ON u.phm_id = p.id
            LEFT JOIN (
                SELECT DISTINCT ON (user_id) user_id, bio_age, data
                FROM biomarkers
                ORDER BY user_id, tested_at DESC
            ) b ON u.id = b.user_id;
        `;
        const result = await pool.query(query);
        const customers = result.rows.map(u => ({ ...u, chrono_age: calculateAge(u.birth_date) }));
        return { success: true, customers };
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
            JOIN users u ON n.user_id = u.id
            WHERE u.wechat_openid = $1 AND n.status = 'pending'
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

async function handleGetPhmList() {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const query = `
            SELECT p.id, p.name, p.email, p.phone, p.created_at, COUNT(u.id) as customer_count
            FROM phms p
            LEFT JOIN users u ON p.id = u.phm_id
            GROUP BY p.id;
        `;
        const result = await pool.query(query);
        return { success: true, phms: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostCoachInstruction(body) {
    const { openid, instruction } = body;
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const user = await pool.query('SELECT id FROM users WHERE wechat_openid = $1', [openid]);
        if (user.rows.length === 0) return { success: false, error: 'User not found', statusCode: 404 };
        const coachMessage = `### 👨‍⚕️ Coach Instruction\n\n${instruction}`;
        await pool.query(
            'INSERT INTO notifications (user_id, notification_type, content, status) VALUES ($1, $2, $3, $4)',
            [user.rows[0].id, 'coach_instruction', coachMessage, 'pending']
        );
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostAssignPhm(body) {
    const { user_id, phm_id } = body;
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        await pool.query('UPDATE users SET phm_id = $1 WHERE id = $2', [phm_id || null, user_id]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostUsers(body) {
    const { wechat_openid, nickname, gender, birth_date, language, phm_id } = body;
    if (!wechat_openid) return { success: false, error: 'wechat_openid is required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const result = await pool.query(
            `INSERT INTO users (wechat_openid, nickname, gender, birth_date, language, phm_id)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [wechat_openid, nickname || null, gender || null, birth_date || null, language || 'zh', phm_id || null]
        );
        return { success: true, id: result.rows[0].id };
    } catch (err) {
        return { success: false, error: err.detail || err.message };
    }
}

async function handlePutUser(userId, body) {
    const { nickname, gender, birth_date, language, phm_id } = body;
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        await pool.query(
            `UPDATE users SET nickname=$1, gender=$2, birth_date=$3, language=$4, phm_id=$5 WHERE id=$6`,
            [nickname || null, gender || null, birth_date || null, language || 'zh', phm_id || null, userId]
        );
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleDeleteUser(userId) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        await pool.query('DELETE FROM users WHERE id = $1', [userId]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostChat(body) {
    const { openid, nickname, gender, birth_date, language, test_type, test_data, tested_at, message, ...rest } = body;
    if (!openid) throw new Error('openid is required');

    const userQuery = `
        INSERT INTO users (wechat_openid, nickname, gender, birth_date, language, bio_data)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (wechat_openid) 
        DO UPDATE SET 
            nickname = COALESCE(EXCLUDED.nickname, users.nickname),
            gender = COALESCE(EXCLUDED.gender, users.gender),
            birth_date = COALESCE(EXCLUDED.birth_date, users.birth_date),
            language = COALESCE(EXCLUDED.language, users.language),
            bio_data = users.bio_data || EXCLUDED.bio_data,
            updated_at = CURRENT_TIMESTAMP
        RETURNING id, birth_date, bio_data, nickname, language;
    `;

    const userResult = await pool.query(userQuery, [openid, nickname, gender, birth_date, language || 'zh', JSON.stringify(rest)]);
    const user = userResult.rows[0];
    const userId = user.id;

    if (test_data) {
        const age = calculateAge(user.birth_date);
        const estimator = new BiomarkerEstimator(age, test_data, { Weight: user.bio_data.weight, Height: user.bio_data.height });
        const estimationReport = estimator.generateReport();
        const bioAgeCalc = new BioAgeCalculator();
        const bioAgeReport = bioAgeCalc.calculateBioAge(age, estimationReport.BiomarkerValues);

        const finalData = { actual: test_data, estimated: estimationReport.BiomarkerValues, context: estimationReport.ClinicalContext, bioage_profile: bioAgeReport };
        const biomarkerResult = await pool.query(
            'INSERT INTO biomarkers (user_id, test_type, data, bio_age, tested_at) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [userId, test_type || 'kino_chip', JSON.stringify(finalData), bioAgeReport.BioAge, tested_at || new Date().toISOString()]
        );
        const biomarkerId = biomarkerResult.rows[0].id;

        // Create notification for the user to see in Chat
        const content = `I've analyzed your biomarker test. Your biological age is **${bioAgeReport.BioAge.toFixed(1)} years**. Check your report for details!`;
        await pool.query(
            'INSERT INTO notifications (user_id, biomarker_id, notification_type, content, status) VALUES ($1, $2, $3, $4, $5)',
            [userId, biomarkerId, 'biological_report', content, 'pending']
        );

        // Generate and save Nutrition Plan / Full Report
        try {
            const llmClient = getLlmClient();
            const model = process.env.MODEL || 'qwen-turbo';
            
            const nutritionContext = {
                start_date: new Date().toISOString().split('T')[0],
                days_needed: 7,
                language: user.language,
                biomarkers: test_data,
                bioage_profile: bioAgeReport
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
                [userId, biomarkerId, 'nutrition_plan', reportContent, 'pending']
            );
        } catch (reportErr) {
            console.error('Report Generation Error:', reportErr);
        }
    } else if (message) {
        // Regular chat message handling
        try {
            // Fetch latest biomarkers for context
            const biomarkerQuery = `
                SELECT bio_age, data
                FROM biomarkers
                WHERE user_id = $1
                ORDER BY tested_at DESC
                LIMIT 1;
            `;
            const biomarkerResult = await pool.query(biomarkerQuery, [userId]);
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
                message: message
            };

            const systemPrompt = systemChatTemplate(llmContext);
            const client = getLlmClient();
            const model = process.env.MODEL || 'qwen-turbo';

            const completion = await client.chat.completions.create({
                model: model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: message }
                ],
            });

            const reply = completion.choices[0].message.content;

            // Save reply as a notification
            await pool.query(
                'INSERT INTO notifications (user_id, notification_type, content, status) VALUES ($1, $2, $3, $4)',
                [userId, 'chat_reply', reply, 'pending']
            );
        } catch (err) {
            console.error('LLM Chat Error:', err);
            // Fallback for demo if LLM fails
            await pool.query(
                'INSERT INTO notifications (user_id, notification_type, content, status) VALUES ($1, $2, $3, $4)',
                [userId, 'chat_reply', "I'm sorry, I'm having trouble connecting to my brain right now. Please try again later.", 'pending']
            );
        }
    }
    return { success: true, user_id: userId };
}

exports.handler = async (req, resp, context) => {
    const isStandardHttp = resp && typeof resp.send === 'function';
    let event = req;

    if (Buffer.isBuffer(req)) {
        try { event = JSON.parse(req.toString()); } catch (e) {}
    }

    // FC 3.0 HTTP trigger exposes req.url (e.g. "/notifications?openid=xxx"), not req.path
    const rawUrl = req.url || '';
    const urlPath = rawUrl.split('?')[0];
    const urlParams = rawUrl.includes('?')
        ? Object.fromEntries(new URLSearchParams(rawUrl.split('?')[1]))
        : {};

    // FC 3.0 uses rawPath and queryParameters (not path / queryStringParameters)
    const path = event.rawPath || event.path || (event.requestContext && event.requestContext.path) || req.path || urlPath || '';
    const method = event.httpMethod || event.method || (event.requestContext && event.requestContext.http && event.requestContext.http.method) || req.method || 'POST';
    const body = event.body || (isStandardHttp ? req.body : event);
    const query = event.queryParameters || event.queryStringParameters || req.queries || req.query || urlParams || {};

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
            if (path.includes('/notifications')) {
                result = await handleGetNotifications(query.openid);
            } else if (path.includes('/dots-inventory')) {
                result = await handleGetDotsInventory();
            } else if (path.includes('/phm-list')) {
                result = await handleGetPhmList();
            } else {
                result = await handleGetCustomers();
            }
        } else if (method === 'POST') {
            if (path.includes('/coach-instruction')) {
                result = await handlePostCoachInstruction(parsedBody);
            } else if (path.includes('/assign-phm')) {
                result = await handlePostAssignPhm(parsedBody);
            } else if (path === '/users') {
                result = await handlePostUsers(parsedBody);
            } else {
                result = await handlePostChat(parsedBody);
            }
        } else if (method === 'PUT' && path.includes('/users/')) {
            const userId = path.split('/users/')[1];
            result = await handlePutUser(userId, parsedBody);
        } else if (method === 'DELETE' && path.includes('/users/')) {
            const userId = path.split('/users/')[1];
            result = await handleDeleteUser(userId);
        } else {
            result = { success: false, error: `Unknown route: ${method} ${path}` };
        }

        const statusCode = result.statusCode || 200;
        const { statusCode: _sc, ...resultBody } = result;
        const responsePayload = {
            isBase64Encoded: false,
            statusCode,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(resultBody)
        };

        if (isStandardHttp) {
            resp.setStatusCode(statusCode);
            resp.setHeader('Content-Type', 'application/json');
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
