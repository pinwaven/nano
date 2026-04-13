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
                    (SELECT content FROM notifications WHERE user_id = u.id AND notification_type = 'biological_report' ORDER BY sent_at DESC LIMIT 1) as latest_report
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
        await pool.query(
            'INSERT INTO biomarkers (user_id, test_type, data, bio_age, tested_at) VALUES ($1, $2, $3, $4, $5)',
            [userId, test_type || 'kino_chip', JSON.stringify(finalData), bioAgeReport.BioAge, tested_at || new Date().toISOString()]
        );
    }
    return { success: true, user_id: userId };
}

exports.handler = async (req, resp, context) => {
    let isStandardHttp = resp && typeof resp.send === 'function';
    let event = req;
    
    if (Buffer.isBuffer(req)) {
        try { event = JSON.parse(req.toString()); } catch (e) {}
    }

    // Comprehensive detection for path and method in all possible locations
    const path = event.path || (event.requestContext && event.requestContext.path) || req.path || '';
    const method = event.httpMethod || event.method || (event.requestContext && event.requestContext.http && event.requestContext.http.method) || req.method || 'POST';
    const body = event.body || (isStandardHttp ? req.body : event);

    try {
        let result;
        // If path is missing but it's a GET, we assume /customers for the simulator
        if (method === 'GET' || path.includes('/customers')) {
            result = await handleGetCustomers();
        } else {
            let parsedBody = body;
            if (typeof body === 'string') try { parsedBody = JSON.parse(body); } catch (e) {}
            result = await handlePostChat(parsedBody);
        }

        const responsePayload = {
            isBase64Encoded: false,
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(result)
        };

        if (isStandardHttp) {
            resp.setStatusCode(200);
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
