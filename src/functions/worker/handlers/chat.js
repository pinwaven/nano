const { pool } = require('../lib/db');
const ossLib = require('../lib/oss');
const { generateUserId, getWxAccessToken } = require('../lib/auth');
const { getNowShanghai, calculateAge, formatToShanghai } = require('../lib/time-utils');
const { updateHealthTwin } = require('../lib/healthTwinUpdater');
const { BiomarkerEstimator } = require('../lib/estimator/BiomarkerEstimator');
const { deriveTags } = require('../lib/estimator/tagDerivation');
const { BioAgeCalculator } = require('../lib/bioage/BioAgeCalculator');
const { refreshGoalProgress } = require('./crm');
const { formatQuestionnaireContext } = require('./questionnaires');
const { handlePostReminder } = require('./coaches');
const OpenAI = require('openai');
const intentClassifierTemplate = require('../prompts/chat/intentClassifier');
const nanoPrompts = {
    casual_chat:        require('../prompts/nano/chat/casual'),
    biomarker_question: require('../prompts/nano/chat/biomarker'),
    nutrition_question: require('../prompts/nano/chat/nutrition'),
    longevity_science:  require('../prompts/nano/chat/science'),
    record_action:      require('../prompts/nano/chat/record'),
    set_reminder:       require('../prompts/nano/chat/reminder'),
    emotional_support:  require('../prompts/nano/chat/emotional'),
};
const vivaPrompts = {
    casual_chat:        require('../prompts/viva/chat/casual'),
    biomarker_question: require('../prompts/viva/chat/biomarker'),
    nutrition_question: require('../prompts/viva/chat/nutrition'),
    longevity_science:  require('../prompts/viva/chat/science'),
    record_action:      require('../prompts/viva/chat/record'),
    set_reminder:       require('../prompts/viva/chat/reminder'),
    emotional_support:  require('../prompts/viva/chat/emotional'),
};
const systemNutritionTemplate = require('../prompts/nano/systemNutrition');
const vivaSystemNutritionTemplate = require('../prompts/viva/systemNutrition');
const systemHealthAdviceTemplate = require('../prompts/nano/systemHealthAdvice');
const systemHealthReportTemplate = require('../prompts/nano/systemHealthReport');

const getLlmClient = () => new OpenAI({
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
});

async function saveChatMessage(user_id, role, content, image_url = null, persona_type = 'nano') {
    try {
        await pool.query(
            'INSERT INTO chat_messages (user_id, role, content, image_url, persona_type) VALUES ($1, $2, $3, $4, $5)',
            [user_id, role, content, image_url, persona_type]
        );
    } catch (err) {
        console.error('Failed to save chat message:', err);
    }
}


async function handleGetChatHistory(openid, sinceId = null, beforeId = null) {
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
        if (beforeId !== null) {
            const result = await pool.query(
                `SELECT id, role, content, image_url, created_at FROM (
                    SELECT id, role, content, image_url, created_at FROM chat_messages
                    WHERE user_id = $1 AND id < $2
                    ORDER BY created_at DESC, id DESC
                    LIMIT $3
                ) sub ORDER BY created_at ASC, id ASC`,
                [openid, beforeId, limit + 1]
            );
            const has_more = result.rows.length > limit;
            const messages = has_more ? result.rows.slice(1) : result.rows;
            return { success: true, messages, has_more };
        }
        const result = await pool.query(
            `SELECT id, role, content, image_url, created_at FROM (
                SELECT id, role, content, image_url, created_at FROM chat_messages
                WHERE user_id = $1
                ORDER BY created_at DESC, id DESC
                LIMIT $2
            ) sub ORDER BY created_at ASC, id ASC`,
            [openid, limit]
        );
        return { success: true, messages: result.rows, has_more: result.rows.length >= limit };
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
        'SELECT user_id, birth_date, bio_data, nickname, language, phone, email, channel_id FROM users WHERE user_id = $1',
        [openid]
    );
    if (byUserId.rows.length > 0) return byUserId.rows[0];

    const userQuery = `
        INSERT INTO users (user_id, external_id, external_app, nickname, phone, email, gender, birth_date, language, bio_data, channel_id)
        VALUES ($1, $2, 'wechat', $3, $4, $5, $6, $7, $8, $9, (SELECT id FROM channels WHERE key_name = 'waven' LIMIT 1))
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
        RETURNING user_id, birth_date, bio_data, nickname, language, phone, email, channel_id;
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
            return { tested_at: row.tested_at, biomarkers: (d && d.validated) || {} };
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

        const finalData = { actual: test_data, validated: estimationReport.BiomarkerValues, context: estimationReport.ClinicalContext, bioage_profile: bioAgeReport, tags };
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

        return { success: true, user_id, biomarker_id: biomarkerId, biomarkers: estimationReport.BiomarkerValues, bioage_profile: bioAgeReport };
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

// Known biomarker labels as they tend to appear in LLM prose (English + Chinese variants),
// mapped to the key in data.validated. Order matters: longer/more specific labels first so
// e.g. "GDF-15" doesn't get swallowed by a looser "GA" pattern.
const BIOMARKER_LABEL_PATTERNS = [
    { key: 'GDF15', re: /GDF-?15/gi },
    { key: 'CystatinC', re: /Cystatin[- ]?C|胱抑素\s*C/gi },
    { key: 'hsCRP', re: /hs-?CRP/gi },
    { key: 'IL6', re: /IL-?6/gi },
    { key: 'CD38', re: /CD38/gi },
    { key: 'GA', re: /\bGA\b|糖化白蛋白/gi },
];

// Pulls "<label> ... <number>" pairs out of free-text (label and number within ~12 chars of
// each other, matching how the prompt templates and model both tend to phrase it: "hsCRP 1.16 mg/L",
// "GA（糖化白蛋白）13.29%", etc).
function extractBiomarkerMentions(text) {
    const mentions = [];
    for (const { key, re } of BIOMARKER_LABEL_PATTERNS) {
        // Only the first occurrence of a label counts as its stated value. Labels like GA are
        // often mentioned twice in one sentence — "GA 13.5%（糖化白蛋白，反映近2-3周血糖控制）" — where
        // the second (gloss) occurrence has no number of its own and would otherwise grab an
        // unrelated number from the explanatory clause that follows it.
        for (const m of text.matchAll(re)) {
            // Start scanning AFTER the label match itself — labels like "GDF-15" and "CD38"
            // contain digits, so slicing from m.index would grab the label's own number.
            const start = m.index + m[0].length;
            const after = text.slice(start, start + 20);
            const numMatch = after.match(/([\d]+\.?\d*)/);
            if (numMatch) {
                mentions.push({ key, value: parseFloat(numMatch[1]) });
                break;
            }
        }
    }
    return mentions;
}

function extractDateMentions(text) {
    const dates = [];
    for (const m of text.matchAll(/(\d{4})-(\d{2})-(\d{2})/g)) {
        dates.push(`${m[1]}-${m[2]}-${m[3]}`);
    }
    for (const m of text.matchAll(/(\d{4})年(\d{1,2})月(\d{1,2})日/g)) {
        dates.push(`${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`);
    }
    return dates;
}

// Cross-checks any biomarker figures / dates the model actually wrote against the ground-truth
// row already fetched server-side. Only flags values the model chose to state — silence on a key
// is fine, a wrong number or date next to a known label is not.
function verifyBiomarkerGrounding(text, groundTruth) {
    const mismatches = [];
    const mentions = extractBiomarkerMentions(text);
    for (const { key, value } of mentions) {
        const truth = groundTruth.validated?.[key];
        if (truth == null) continue;
        const tolerance = Math.max(0.05, Math.abs(truth) * 0.02);
        if (Math.abs(value - truth) > tolerance) {
            mismatches.push({ key, stated: value, actual: truth });
        }
    }
    if (groundTruth.tested_at) {
        for (const stated of extractDateMentions(text)) {
            if (stated !== groundTruth.tested_at) {
                mismatches.push({ key: 'tested_at', stated, actual: groundTruth.tested_at });
            }
        }
    }
    return { ok: mismatches.length === 0, mismatches };
}

async function handlePostChat(body) {
    const { openid, message, sandbox } = body;
    if (!openid) throw new Error('openid is required');

    const user = await resolveOrUpsertUser(body);
    const user_id = user.user_id;

    // Resolve persona from channel config (defaults to 'nano')
    let personaType = 'nano';
    let channelSubAgeNames = null;
    if (user.channel_id) {
        try {
            const chRes = await pool.query('SELECT config FROM channels WHERE id = $1', [user.channel_id]);
            const chConfig = chRes.rows[0]?.config || {};
            personaType = chConfig.persona_type ?? 'nano';
            channelSubAgeNames = chConfig.sub_age_display_names || null;
        } catch (err) {
            console.log(JSON.stringify({ level: 'WARN', msg: 'Failed to fetch channel persona, defaulting to nano', error: err.message }));
        }
    }
    console.log(JSON.stringify({ level: 'INFO', msg: 'Persona resolved', user_id: user.user_id, channel_id: user.channel_id, personaType }));

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
                    temperature: 0.1,
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
            // Always fetch the latest biomarker/bioage snapshot — cheap indexed query, and it's the
            // single source of truth the model must be grounded on for every intent, not just ones
            // the classifier happens to tag (classifier misses are exactly what caused the 2026-07-14 bug).
            fetches.biomarker = pool.query(
                `SELECT data, tested_at FROM biomarkers WHERE user_id = $1 AND test_type = 'kino_chip' ORDER BY tested_at DESC LIMIT 1`,
                [user_id]
            );
            if (required_data.includes('dots')) {
                fetches.dots = pool.query(
                    `SELECT id, key_name, name, name_zh, description, is_isolate, timing, sub_age_target, ingredients, ingredients_zh FROM dots ORDER BY id ASC`
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
                biomarkers: biomarkerRow.data?.validated || {},
                biomarkers_tested_at: biomarkerRow.tested_at
                    ? formatToShanghai(new Date(biomarkerRow.tested_at)).slice(0, 10)
                    : null,
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
                sub_age_display_names: channelSubAgeNames,
            };

            const activePrompts = personaType === 'viva' ? vivaPrompts : nanoPrompts;
            const promptBuilder = activePrompts[intent] || activePrompts.casual_chat;
            const systemPrompt = promptBuilder(llmContext);

            // Save the incoming user message to the conversation log — skipped in sandbox
            // mode (superadmin "login as" sessions), which never persist against the
            // impersonated user's real account.
            if (!sandbox) {
                await pool.query(
                    'INSERT INTO chat_messages (user_id, role, content, persona_type) VALUES ($1, $2, $3, $4)',
                    [user_id, 'user', message, personaType]
                );
            }

            // Fetch recent conversation history scoped to the current persona
            const historyLimit = parseInt(process.env.CHAT_HISTORY_LIMIT || '20', 10);
            const historyResult = await pool.query(
                `SELECT role, content FROM (
                    SELECT role, content, created_at FROM chat_messages
                    WHERE user_id = $1 AND persona_type = $3
                    ORDER BY created_at DESC
                    LIMIT $2
                ) sub ORDER BY created_at ASC`,
                [user_id, historyLimit, personaType]
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
            // The current sandboxed turn was never persisted above, so splice it into
            // the in-memory history the model sees — otherwise it has no idea what was
            // just asked.
            if (sandbox) {
                const lastTurn = cleanHistory[cleanHistory.length - 1];
                if (lastTurn && lastTurn.role === 'user') lastTurn.content = message;
                else cleanHistory.push({ role: 'user', content: message });
            }

            const dbQueryTool = {
                type: 'function',
                function: {
                    name: 'query_database',
                    description: `Run a read-only SQL SELECT to retrieve this user's health data when it isn't already in context.
The user's latest Kino biomarkers, bio age, and test date are ALWAYS already provided above in your system context —
querying the biomarkers table is blocked and will be rejected. Never attempt it; use the values already given to you.
Tables (always filter by user_id = $1):
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
                    temperature: 0.3,
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
                                } else if (/\bbiomarkers\b/i.test(sql)) {
                                    // The latest kino biomarkers/bioage/test-date are already in system context
                                    // (see llmContext.biomarkers/biomarkers_tested_at above) — self-authored queries
                                    // against this table are how the 2026-07-14 stale-data bug happened, so this is
                                    // enforced here rather than just requested in the tool description.
                                    toolResult = { error: 'Rejected: biomarkers table is not queryable — use the values already provided in your context.' };
                                } else {
                                    const qr = await pool.query(sql, [user_id, ...extraParams]);
                                    toolResult = { rows: qr.rows, count: qr.rowCount };
                                }
                            } catch (qErr) {
                                toolResult = { error: qErr.message };
                            }
                            console.log(JSON.stringify({ level: 'INFO', msg: 'DB tool call', sql: tc.function.arguments, rows: toolResult.rows?.length ?? 0, error: toolResult.error }));
                            toolResults.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(toolResult) });
                        }
                    }
                    chatMessages.push(...toolResults);
                } else {
                    rawReply = choice.message.content || '';
                    break;
                }
            }

            // Grounding check: the model can still misstate biomarker figures/dates from conversation
            // history even when correct data is right there in its own system prompt (this is exactly
            // how the 2026-07-14 stale-data bug happened). Cross-check what it actually wrote against
            // the ground-truth row fetched above, and retry once with an explicit correction if it drifted.
            if (Object.keys(llmContext.biomarkers).length > 0) {
                const groundTruth = { validated: llmContext.biomarkers, tested_at: llmContext.biomarkers_tested_at };
                const verification = verifyBiomarkerGrounding(rawReply, groundTruth);
                if (!verification.ok) {
                    console.log(JSON.stringify({ level: 'WARN', msg: 'biomarker_grounding_mismatch', user_id, mismatches: verification.mismatches }));
                    const correctionPrompt = `Your previous reply stated biomarker figures and/or a test date that do not match the patient's actual record.
Ground truth — test date: ${groundTruth.tested_at || 'unknown'}, values: ${JSON.stringify(groundTruth.validated)}.
Rewrite your previous reply using ONLY these exact values and this exact date. Keep the same language, tone, and structure otherwise.`;
                    chatMessages.push({ role: 'assistant', content: rawReply });
                    chatMessages.push({ role: 'user', content: correctionPrompt });
                    const retryCompletion = await client.chat.completions.create({
                        model,
                        messages: chatMessages,
                        temperature: 0.2,
                    });
                    const retryReply = retryCompletion.choices[0].message.content || rawReply;
                    const retryVerification = verifyBiomarkerGrounding(retryReply, groundTruth);
                    console.log(JSON.stringify({ level: retryVerification.ok ? 'INFO' : 'WARN', msg: 'biomarker_grounding_retry', user_id, ok: retryVerification.ok, mismatches: retryVerification.mismatches }));
                    rawReply = retryReply;
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
                        if (!sandbox) {
                            await pool.query(
                                'INSERT INTO biomarkers (user_id, test_type, data, tested_at) VALUES ($1, $2, $3, $4)',
                                [user_id, 'body_composition', JSON.stringify({ actual: { weight: weightKg } }), new Date().toISOString()]
                            );
                            recordedWeight = weightKg;
                        }
                        simpleReply = isZh
                            ? `✅ 已记录您的体重：**${weightKg} kg**`
                            : `✅ Weight recorded: **${weightKg} kg**`;
                    }

                    if (sandbox) {
                        return { success: true, user_id, sandbox: true, reply: simpleReply };
                    }
                    await saveChatMessage(user_id, 'ai', simpleReply, null, personaType);
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
                    if (reminderAction.content && reminderAction.scheduled_for && !sandbox) {
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

            if (sandbox) {
                // Sandbox sessions have no notification-polling side channel to rely on —
                // hand the reply back directly instead of persisting it.
                return { success: true, user_id, sandbox: true, reply };
            }

            // Save assistant reply to the conversation log
            await saveChatMessage(user_id, 'ai', reply, null, personaType);

            // Save reply as a notification (existing delivery mechanism for frontend poll)
            await pool.query(
                'INSERT INTO notifications (user_id, notification_type, content, status) VALUES ($1, $2, $3, $4)',
                [user_id, 'chat_reply', reply, 'pending']
            );
        } catch (err) {
            console.error('LLM Chat Error:', err);
            const fallbackText = "I'm sorry, I'm having trouble connecting to my brain right now. Please try again later.";
            if (sandbox) {
                return { success: true, user_id, sandbox: true, reply: fallbackText };
            }
            // Fallback for demo if LLM fails
            await pool.query(
                'INSERT INTO notifications (user_id, notification_type, content, status) VALUES ($1, $2, $3, $4)',
                [user_id, 'chat_reply', fallbackText, 'pending']
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
    const result = await pool.query(
        'UPDATE users SET last_active_at = NOW() WHERE user_id = $1 RETURNING phone',
        [user_id]
    );
    const phone = result.rows[0]?.phone || null;
    return { success: true, phone };
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
        const biomarkers = latestBio?.data?.validated || {};
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
            temperature: 0.3,
        });

        const reply = completion.choices[0].message.content;
        await saveChatMessage(user_id, 'ai', reply);

        return { success: true, message: reply };
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handlePostHealthAdvice failed', error: err.message }));
        return { success: false, error: err.message, statusCode: 500 };
    }
}

function buildBpNarrative(isZh, sys, dia, pulse) {
    const pulseStr = pulse ? (isZh ? `，脉搏 ${pulse} 次/分` : `, pulse ${pulse} bpm`) : '';
    const cat = sys > 180 || dia > 120
        ? (isZh ? ['危急', '请立即就医，高血压危象需要紧急处理。', '#ef4444'] : ['Crisis', 'Seek emergency care immediately — hypertensive crisis requires urgent attention.', '#ef4444'])
        : sys >= 140 || dia >= 90
        ? (isZh ? ['高血压 II 级', '血压明显偏高，建议尽快咨询医生。', '#ef4444'] : ['Stage 2 Hypertension', 'Significantly elevated — consult your doctor promptly.', '#ef4444'])
        : sys >= 130 || dia >= 80
        ? (isZh ? ['高血压 I 级', '血压偏高，建议改善生活方式并定期监测。', '#f97316'] : ['Stage 1 Hypertension', 'Elevated — lifestyle changes and regular monitoring are recommended.', '#f97316'])
        : sys >= 120 && dia < 80
        ? (isZh ? ['血压偏高', '收缩压轻度偏高，注意减少钠摄入、保持运动。', '#f97316'] : ['Elevated', 'Slightly high systolic — reduce sodium intake and stay active.', '#f97316'])
        : (isZh ? ['正常', '血压处于健康范围，继续保持良好生活习惯。', '#10b981'] : ['Normal', 'Blood pressure is in a healthy range — keep up the good habits.', '#10b981']);
    if (isZh) {
        return `已记录血压：**${sys}/${dia} mmHg**${pulseStr}\n\n**${cat[0]}** — ${cat[1]}`;
    }
    return `Recorded blood pressure: **${sys}/${dia} mmHg**${pulseStr}\n\n**${cat[0]}** — ${cat[1]}`;
}

function buildGlucoseNarrative(isZh, glucoseMmol, context) {
    const display = glucoseMmol.toFixed(1);
    const isFasting = context === 'fasting';
    const threshold = isFasting ? { normal: 5.6, pre: 7.0 } : { normal: 7.8, pre: 11.1 };
    const contextStr = isZh
        ? (isFasting ? '（空腹）' : context === 'postmeal' ? '（餐后）' : '')
        : (isFasting ? ' (fasting)' : context === 'postmeal' ? ' (post-meal)' : '');
    const cat = glucoseMmol >= threshold.pre
        ? (isZh ? ['偏高', '血糖明显偏高，建议咨询医生并复查。'] : ['High', 'Significantly elevated — consult your doctor and recheck.'])
        : glucoseMmol >= threshold.normal
        ? (isZh ? ['轻度偏高', '血糖略高于正常范围，注意饮食控制。'] : ['Slightly elevated', 'Just above normal — watch your diet and carbohydrate intake.'])
        : glucoseMmol < 3.9
        ? (isZh ? ['偏低', '血糖偏低，如有头晕不适请及时补充糖分。'] : ['Low', 'Below normal — if you feel dizzy or unwell, consume some sugar promptly.'])
        : (isZh ? ['正常', '血糖处于正常范围。'] : ['Normal', 'Blood glucose is within the normal range.']);
    if (isZh) {
        return `已记录血糖：**${display} mmol/L**${contextStr}\n\n**${cat[0]}** — ${cat[1]}`;
    }
    return `Recorded blood glucose: **${display} mmol/L**${contextStr}\n\n**${cat[0]}** — ${cat[1]}`;
}

function buildWeightNarrative(isZh, weightKg, historicalAvg, isPlausible) {
    if (isZh) {
        const base = `已识别并记录您的体重：**${weightKg} kg**。`;
        if (!isPlausible) {
            const avgStr = historicalAvg ? `（近期平均 ${historicalAvg.toFixed(1)} kg）` : '';
            return base + `\n\n⚠️ 此数值与历史记录差异较大${avgStr}，请确认秤的单位或读数是否正确。`;
        }
        if (historicalAvg) {
            const delta = (weightKg - historicalAvg).toFixed(1);
            const trend = weightKg > historicalAvg ? `↑ ${delta} kg` : `↓ ${Math.abs(delta)} kg`;
            return base + `\n\n与近期平均相比：${trend}。`;
        }
        return base + '\n\n这是您的第一条体重记录，已保存。';
    } else {
        const base = `Recorded your weight: **${weightKg} kg**.`;
        if (!isPlausible) {
            const avgStr = historicalAvg ? ` (recent avg: ${historicalAvg.toFixed(1)} kg)` : '';
            return base + `\n\n⚠️ This is very different from your recent records${avgStr} — please double-check the unit or reading.`;
        }
        if (historicalAvg) {
            const delta = (weightKg - historicalAvg).toFixed(1);
            const trend = weightKg > historicalAvg ? `↑ ${delta} kg` : `↓ ${Math.abs(delta)} kg`;
            return base + `\n\nVs. recent average: ${trend}.`;
        }
        return base + '\n\nThis is your first weight record — saved.';
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
            temperature: 0.3,
        });

        const rawReply = completion.choices[0].message.content || '';

        const jsonMatch = rawReply.match(/```json\s*([\s\S]*?)```/);
        let extracted = {};
        let abnormalItems = [];
        let reportDate = null;
        let bodyWeightKg = null;
        let bmi = null;

        let contentType = 'health_photo';
        let scaleUnit = 'kg';
        let bpSystolic = null, bpDiastolic = null, bpPulse = null;
        let glucoseValue = null, glucoseUnit = 'mmol/L', glucoseContext = null;
        let institution = null, reportType = 'lab_panel', observations = [];
        if (jsonMatch) {
            try {
                const parsed = JSON.parse(jsonMatch[1]);
                contentType = parsed.content_type || 'health_photo';
                extracted = parsed.extracted || {};
                abnormalItems = parsed.abnormal_items || [];
                reportDate = parsed.report_date || null;
                institution = parsed.institution || null;
                reportType = parsed.report_type || 'lab_panel';
                observations = Array.isArray(parsed.observations) ? parsed.observations : [];
                bodyWeightKg = parsed.body_weight_kg || null;
                scaleUnit = parsed.scale_unit || 'kg';
                bmi = parsed.bmi || null;
                bpSystolic = parsed.bp_systolic || null;
                bpDiastolic = parsed.bp_diastolic || null;
                bpPulse = parsed.bp_pulse || null;
                glucoseValue = parsed.glucose_value || null;
                glucoseUnit = parsed.glucose_unit || 'mmol/L';
                glucoseContext = parsed.glucose_context || null;
            } catch (e) {
                console.log(JSON.stringify({ level: 'WARN', msg: 'Failed to parse image analysis JSON', error: e.message }));
            }
        }

        if (contentType === 'scale_reading' && bodyWeightKg && scaleUnit === 'lb') {
            bodyWeightKg = Math.round(bodyWeightKg * 0.453592 * 10) / 10;
        }
        if (contentType === 'glucose_reading' && glucoseValue && glucoseUnit === 'mg/dL') {
            glucoseValue = Math.round(glucoseValue / 18.02 * 10) / 10;
        }

        let narrative = rawReply.replace(/```json[\s\S]*?```\s*/, '').trim();

        // Lab reports are NOT auto-saved. We surface the read-out, then ask the user
        // (in the miniapp) whether it's their own report and whether to save it to the
        // health tab. The actual persistence happens later via POST /health-reports.
        if (contentType === 'health_report') {
            const userTrigger = isZh ? '（图片）' : '(image)';
            await saveChatMessage(user_id, 'user', userTrigger, get_url || null);
            await saveChatMessage(user_id, 'ai', narrative);
            console.log(JSON.stringify({ level: 'INFO', msg: 'Lab report analyzed (pending consent)', user_id, observation_count: observations.length }));
            return {
                success: true,
                message: narrative,
                pending_health_report: true,
                payload: {
                    oss_key,
                    get_url: get_url || null,
                    report_date: reportDate,
                    institution,
                    report_type: reportType,
                    observations,
                    abnormal_items: abnormalItems,
                },
            };
        }

        const testType = contentType === 'food_photo' ? 'food_photo'
                       : contentType === 'health_report' ? 'health_checkup_report'
                       : contentType === 'waven_dots' ? 'waven_dots'
                       : contentType === 'scale_reading' ? 'body_composition'
                       : contentType === 'bp_reading' ? 'bp_reading'
                       : contentType === 'glucose_reading' ? 'glucose_reading'
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

        if (contentType === 'scale_reading' && bodyWeightKg) {
            const historyRes = await pool.query(
                `SELECT data FROM biomarkers
                 WHERE user_id = $1 AND test_type = 'body_composition'
                   AND id != $2
                 ORDER BY tested_at DESC LIMIT 5`,
                [user_id, biomarker_id]
            );
            const recentWeights = historyRes.rows
                .map(r => {
                    const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
                    return d?.actual?.weight ?? null;
                })
                .filter(w => w !== null);
            const historicalAvg = recentWeights.length
                ? recentWeights.reduce((a, b) => a + b, 0) / recentWeights.length
                : null;
            const isPlausible = historicalAvg === null
                ? bodyWeightKg >= 20 && bodyWeightKg <= 300
                : Math.abs(bodyWeightKg - historicalAvg) <= 20;

            await pool.query(
                `UPDATE biomarkers SET data = data || $1::jsonb WHERE id = $2`,
                [JSON.stringify({ actual: { weight: bodyWeightKg }, weight_kg: bodyWeightKg }), biomarker_id]
            );
            await pool.query(
                `UPDATE users SET bio_data = bio_data || $1::jsonb WHERE user_id = $2`,
                [JSON.stringify({ weight_kg: bodyWeightKg }), user_id]
            );

            narrative = buildWeightNarrative(isZh, bodyWeightKg, historicalAvg, isPlausible);
        } else if (bodyWeightKg) {
            await pool.query(
                `UPDATE users SET bio_data = bio_data || $1::jsonb WHERE user_id = $2`,
                [JSON.stringify({ weight_kg: bodyWeightKg, ...(bmi ? { bmi } : {}) }), user_id]
            );
        } else if (contentType === 'bp_reading' && bpSystolic && bpDiastolic) {
            const ts = new Date().toISOString().replace(/[:.]/g, '');
            await pool.query(
                `INSERT INTO health_events (user_id, source, category, data_date, recorded_at, data, external_id)
                 VALUES ($1, 'manual_photo', 'vitals', CURRENT_DATE, NOW(), $2, $3)`,
                [user_id, JSON.stringify({ bp_systolic: bpSystolic, bp_diastolic: bpDiastolic, bp_pulse: bpPulse }), `photo_bp_${ts}`]
            );
            narrative = buildBpNarrative(isZh, bpSystolic, bpDiastolic, bpPulse);
        } else if (contentType === 'glucose_reading' && glucoseValue) {
            const ts = new Date().toISOString().replace(/[:.]/g, '');
            await pool.query(
                `INSERT INTO health_events (user_id, source, category, data_date, recorded_at, data, external_id)
                 VALUES ($1, 'manual_photo', 'vitals', CURRENT_DATE, NOW(), $2, $3)`,
                [user_id, JSON.stringify({ glucose_mmol: glucoseValue, glucose_context: glucoseContext }), `photo_glucose_${ts}`]
            );
            narrative = buildGlucoseNarrative(isZh, glucoseValue, glucoseContext);
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

        let synced = 0;
        let skipped = 0;
        for (const ev of events) {
            if (!ev.category || !VALID_CATEGORIES.has(ev.category) || !ev.source || !ev.data_date || !ev.data || !ev.recorded_at) { skipped++; continue; }
            const r = await pool.query(`
                INSERT INTO health_events (user_id, source, category, data_date, recorded_at, data, external_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (user_id, source, external_id) WHERE external_id IS NOT NULL
                DO UPDATE SET data = EXCLUDED.data, recorded_at = EXCLUDED.recorded_at
                RETURNING id
            `, [user_id, ev.source, ev.category, ev.data_date, ev.recorded_at, JSON.stringify(ev.data), ev.external_id || null]);
            if (r.rows.length > 0) synced++;
        }

        if (synced > 0) {
            await updateHealthTwin(user_id, pool);
        }

        return { success: true, synced, skipped };
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
            `SELECT id, source, category, data_date, recorded_at, data, ingested_at, external_id
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

function _buildHealthTagsBackend(twin, bm, conditionKeys) {
    const tags = [];
    const order = { alert: 0, warn: 1, good: 2 };

    if (bm) {
        if (bm.hsCRP > 3)            tags.push({ labelEn: 'High Inflammation',  labelZh: '炎症偏高',      severity: 'alert', color: '#ef4444' });
        else if (bm.hsCRP > 1)       tags.push({ labelEn: 'Mild Inflammation',   labelZh: '轻微炎症',      severity: 'warn',  color: '#f97316' });
        if (bm.IL6 > 6)              tags.push({ labelEn: 'Elevated IL-6',       labelZh: 'IL-6 升高',    severity: 'alert', color: '#ef4444' });
        if (bm.GDF15 > 1500)         tags.push({ labelEn: 'Accelerated Aging',   labelZh: '衰老加速',      severity: 'alert', color: '#ef4444' });
        else if (bm.GDF15 > 750)     tags.push({ labelEn: 'Elevated GDF-15',     labelZh: 'GDF-15 升高',  severity: 'warn',  color: '#f97316' });
        if (bm.GA > 20)              tags.push({ labelEn: 'Metabolic Risk',       labelZh: '代谢功能异常',  severity: 'alert', color: '#ef4444' });
        else if (bm.GA > 15)         tags.push({ labelEn: 'Elevated GA',          labelZh: '糖化白蛋白偏高', severity: 'warn',  color: '#f97316' });
        if (bm.CystatinC > 1.2)      tags.push({ labelEn: 'Vascular Stress',     labelZh: '血管压力',      severity: 'alert', color: '#ef4444' });
        else if (bm.CystatinC > 0.9) tags.push({ labelEn: 'Elevated Cystatin C', labelZh: '胱抑素C偏高',  severity: 'warn',  color: '#f97316' });
        if (bm.CD38 > 2)             tags.push({ labelEn: 'High CD38',            labelZh: 'CD38 升高',    severity: 'warn',  color: '#f97316' });
    }

    if (twin) {
        if (twin.avg_sleep_hours != null) {
            if (twin.avg_sleep_hours < 6)        tags.push({ labelEn: 'Sleep Deficit',    labelZh: '睡眠严重不足', severity: 'alert', color: '#ef4444' });
            else if (twin.avg_sleep_hours < 7)   tags.push({ labelEn: 'Low Sleep',         labelZh: '睡眠不足',    severity: 'warn',  color: '#f97316' });
            else if (twin.avg_sleep_hours <= 9)  tags.push({ labelEn: 'Good Sleep',        labelZh: '睡眠良好',    severity: 'good',  color: '#10b981' });
        }
        if (twin.avg_hrv_ms != null) {
            if (twin.avg_hrv_ms < 30)            tags.push({ labelEn: 'Low HRV',           labelZh: 'HRV 偏低',   severity: 'alert', color: '#ef4444' });
            else if (twin.avg_hrv_ms >= 80)      tags.push({ labelEn: 'Strong Recovery',   labelZh: '恢复力强',    severity: 'good',  color: '#10b981' });
        }
        if (twin.avg_resting_hr != null) {
            if (twin.avg_resting_hr > 90)        tags.push({ labelEn: 'Elevated HR',       labelZh: '心率过快',    severity: 'alert', color: '#ef4444' });
            else if (twin.avg_resting_hr > 75)   tags.push({ labelEn: 'High Resting HR',   labelZh: '静息心率偏高', severity: 'warn',  color: '#f97316' });
        }
        if (twin.avg_daily_steps != null) {
            if (twin.avg_daily_steps < 5000)     tags.push({ labelEn: 'Low Activity',      labelZh: '活动量不足',   severity: 'warn',  color: '#f97316' });
            else if (twin.avg_daily_steps >= 10000) tags.push({ labelEn: 'Active',          labelZh: '活动达标',    severity: 'good',  color: '#10b981' });
        }
    }

    const condTagMap = {
        blood_sugar_high:    { en: 'High Blood Sugar',    zh: '血糖高' },
        blood_pressure_high: { en: 'High Blood Pressure', zh: '血压高' },
        blood_lipids_high:   { en: 'High Blood Lipids',   zh: '血脂高' },
        cholesterol_high:    { en: 'High Cholesterol',    zh: '胆固醇高' },
        heart_issues:        { en: 'Heart Issues',        zh: '心脏问题' },
        kidney_disease:      { en: 'Kidney Disease',      zh: '肾病' },
    };
    for (const key of (conditionKeys || [])) {
        const m = condTagMap[key];
        if (m) tags.push({ labelEn: m.en, labelZh: m.zh, severity: 'warn', color: '#f97316' });
    }

    tags.sort((a, b) => order[a.severity] - order[b.severity]);
    return tags.slice(0, 7);
}

async function handleGetHealthTwin(openid) {
    if (!openid) return { success: false, error: 'openid required', statusCode: 400 };

    try {
        const userResult = await pool.query(
            `SELECT user_id, bio_data FROM users WHERE user_id = $1 OR external_id = $1 LIMIT 1`,
            [openid]
        );
        if (!userResult.rows.length) return { success: false, error: 'User not found', statusCode: 404 };
        const { user_id, bio_data } = userResult.rows[0];

        const [twinResult, bmResult] = await Promise.all([
            pool.query(`SELECT * FROM health_twin WHERE user_id = $1`, [user_id]),
            pool.query(
                `SELECT data FROM biomarkers WHERE user_id = $1 AND test_type = 'kino_chip' AND (data->'validated') IS NOT NULL ORDER BY tested_at DESC LIMIT 1`,
                [user_id]
            ),
        ]);

        const twin = twinResult.rows[0] || null;
        const latestBm = bmResult.rows[0]?.data?.validated || null;
        const conditionKeys = bio_data?.health_conditions || [];
        const tags = _buildHealthTagsBackend(twin, latestBm, conditionKeys);

        return { success: true, twin: twin ? { ...twin, tags } : null };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handleGetHealthTwin failed', error: err.message }));
        return { success: false, error: err.message, statusCode: 500 };
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

module.exports = {
    saveChatMessage,
    fetchTagDerivationContext,
    resolveOrUpsertUser,
    handleGetChatHistory,
    handlePostBiomarkers,
    handlePostChat,
    handlePostChatMessages,
    handlePostHeartbeat,
    handlePostHealthAdvice,
    handlePostAnalyzeImage,
    handlePostHealthEvent,
    handlePostHealthEventsSync,
    handleGetHealthEvents,
    handleGetHealthTwin,
    handleGetOssPresign,
};
