const { pool } = require('./lib/db');
const OpenAI = require('openai');
const proactivePromptTemplate = require('./prompts/proactive');

const getLlmClient = () => new OpenAI({
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
});

/**
 * Load all context needed to generate a personalised coaching message.
 */
async function loadUserContext(user_id) {
    const [userRes, bioRes, nutritionRes, chatRes] = await Promise.all([
        pool.query(
            `SELECT user_id, nickname, language, birth_date,
                    EXTRACT(YEAR FROM AGE(birth_date))::int AS age
             FROM users WHERE user_id = $1`,
            [user_id]
        ),
        pool.query(
            `SELECT bio_age, data FROM biomarkers
             WHERE user_id = $1
             ORDER BY tested_at DESC LIMIT 1`,
            [user_id]
        ),
        pool.query(
            `SELECT COUNT(*) AS covered
             FROM nutrition_schedules
             WHERE user_id = $1 AND scheduled_date >= CURRENT_DATE AND scheduled_date < CURRENT_DATE + 3`,
            [user_id]
        ),
        pool.query(
            `SELECT role, content FROM (
                SELECT role, content, created_at FROM chat_messages
                WHERE user_id = $1
                ORDER BY created_at DESC LIMIT 10
             ) sub ORDER BY created_at ASC`,
            [user_id]
        ),
    ]);

    const user = userRes.rows[0];
    if (!user) throw new Error(`User not found: ${user_id}`);

    const bioRow = bioRes.rows[0] || null;
    const bioage = bioRow
        ? {
            bio_age: bioRow.bio_age,
            sub_ages: bioRow.data?.bioage_profile?.SubAges || bioRow.data?.SubAges || null,
          }
        : null;

    const rawBiomarkers = bioRow?.data?.biomarkers || bioRow?.data?.raw || {};
    const biomarkers = Object.entries(rawBiomarkers).map(([key, val]) => ({
        key,
        value: typeof val === 'object' ? val.value ?? val : val,
        unit: typeof val === 'object' ? val.unit ?? '' : '',
    }));

    const covered = parseInt(nutritionRes.rows[0]?.covered || '0', 10);
    const nutrition_gap = covered < 3 ? 3 - covered : 0;

    return {
        user_profile: {
            nickname: user.nickname,
            language: user.language || 'zh',
            age: user.age,
        },
        bioage,
        biomarkers,
        nutrition_gap: nutrition_gap > 0 ? nutrition_gap : null,
        chat_history: chatRes.rows,
    };
}

async function runCoachingSession(user_id, trigger_reason, extra = {}, dry_run = false) {
    console.log(JSON.stringify({ level: 'INFO', msg: 'Coach Agent started', user_id, trigger_reason, dry_run }));

    const ctx = await loadUserContext(user_id);
    const systemPrompt = proactivePromptTemplate({ ...ctx, trigger_reason, ...extra });

    const llm = getLlmClient();
    const completion = await llm.chat.completions.create({
        model: process.env.MODEL || 'qwen-plus-latest',
        messages: [{ role: 'system', content: systemPrompt }],
        max_tokens: 200,
        temperature: 0.8,
    });

    const message = completion.choices[0]?.message?.content?.trim();
    if (!message) throw new Error('LLM returned empty response');

    if (dry_run) {
        console.log(JSON.stringify({ level: 'INFO', msg: '[DRY RUN] Generated message (not saved)', message }));
        return;
    }

    await Promise.all([
        pool.query(
            'INSERT INTO chat_messages (user_id, role, content) VALUES ($1, $2, $3)',
            [user_id, 'assistant', message]
        ),
        pool.query(
            'INSERT INTO notifications (user_id, notification_type, content, status) VALUES ($1, $2, $3, $4)',
            [user_id, 'coach_message', message, 'pending']
        ),
        pool.query(
            'UPDATE users SET last_coached_at = NOW() WHERE user_id = $1',
            [user_id]
        ),
    ]);

    console.log(JSON.stringify({ level: 'INFO', msg: 'Coach Agent message delivered', user_id }));
}

/**
 * FC 3.0 handler — accepts both EventBridge events and HTTP invocations.
 */
exports.handler = async (req, resp, context) => {
    try {
        // Parse payload — EventBridge delivers a Buffer, HTTP delivers the FC 3.0 event object
        let data, dry_run;

        if (Buffer.isBuffer(req)) {
            const envelope = JSON.parse(req.toString('utf8'));
            // CloudEvents 1.0: data field may be a Buffer or base64 string
            data = Buffer.isBuffer(envelope.data)
                ? JSON.parse(envelope.data.toString('utf8'))
                : (typeof envelope.data === 'string'
                    ? JSON.parse(Buffer.from(envelope.data, 'base64').toString('utf8'))
                    : envelope.data);
            dry_run = false; // EventBridge invocations are always real
        } else {
            let body = req.body || '';
            if (req.isBase64Encoded && body) body = Buffer.from(body, 'base64').toString('utf8');
            data = body ? JSON.parse(body) : {};
            dry_run = data.dry_run === true;
        }

        const { user_id, trigger_reason = 'user_online', dry_run: _dr, ...extra } = data;

        if (!user_id) {
            return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'user_id required' }), isBase64Encoded: false };
        }

        await runCoachingSession(user_id, trigger_reason, extra, dry_run);

        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true }), isBase64Encoded: false };
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'Coach Agent failed', error: err.message }));
        return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: err.message }), isBase64Encoded: false };
    }
};
