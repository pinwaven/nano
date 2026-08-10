const { pool } = require('../lib/db');
const ossLib = require('../lib/oss');
const { generateUserId, getWxAccessToken } = require('../lib/auth');
const { getNowShanghai, calculateAge, formatToShanghai } = require('../lib/time-utils');
const { updateHealthTwin } = require('../lib/healthTwinUpdater');
const { BiomarkerEstimator } = require('../lib/estimator/BiomarkerEstimator');
const { deriveTags } = require('../lib/estimator/tagDerivation');
const { BioAgeCalculator } = require('../lib/bioage/BioAgeCalculator');
const { refreshGoalProgress } = require('./crm');
const { formatQuestionnaireContext, canCreateDynamicQuestionnaire, createDynamicQuestionnaire } = require('./questionnaires');
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
const vivaSystemHealthAdviceTemplate = require('../prompts/viva/systemHealthAdvice');
const { getCurrentSolarTerm } = require('../lib/solarTerms');
const { detectAllRisks } = require('../lib/factCheck');
const systemHealthReportTemplate = require('../prompts/nano/systemHealthReport');
const { runAgenticTurn } = require('../lib/agenticChat');
const { v4: uuidv4 } = require('uuid');
const { publishChatGenerateEvent } = require('../lib/chatEventBridge');
const { getEssentialBlock } = require('../lib/knowledgeBase');
const { _runDeterministicFormulation, _commitNutritionPlan, _fallbackCountForDot, _splitDotTiming } = require('./dots');

// Intents where factual claims (biomarker values, dot recommendations, science/protocol
// assertions) are common enough to warrant the fuller plan->generate->judge->revise loop
// (lib/agenticChat.js) instead of the default single-pass generation + retry-on-failure path.
// casual_chat/emotional_support stay on the fast path regardless of persona, to bound
// latency/cost (see 2026-07-28 planning discussion).
const HIGH_RISK_INTENTS = new Set(['biomarker_question', 'nutrition_question', 'longevity_science', 'record_action']);

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
        if (test_type === 'body_composition' && test_data.weight) {
            await _syncBodyCompositionTwin(user_id, test_data.weight, user.bio_data);
            if (body.send_weight_reminder) {
                try {
                    const token = await getWxAccessToken();
                    await sendWeightSubscribeMsg(user_id, test_data.weight, token);
                } catch (e) {
                    console.log(JSON.stringify({ level: 'WARN', msg: 'weight subscribe msg failed', error: e.message }));
                }
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

// Feeds a freshly-recorded weight into health_events (category='body_composition') and
// refreshes health_twin, so the miniapp's 体成分 twin card (health_twin.latest_weight_kg/
// latest_bmi) reflects real data. Before this, every weight-writing path (manual entry,
// chat's record_weight action, scale-photo AI extraction) only wrote to the legacy
// `biomarkers` table / users.bio_data, which health_twin never reads — the twin card's
// weight/BMI had no real writer at all and could only ever show frozen leftover/seed data.
// Non-fatal: a failure here must never break the caller's primary weight-save.
// Deliberately does NOT set body_fat_pct — nothing in this app measures it, so leaving it
// out lets health_twin's COALESCE-preserving UPSERT keep whatever (possibly stale) value
// was there rather than us fabricating one.
async function _syncBodyCompositionTwin(user_id, weightKg, bioData) {
    try {
        const heightCm = bioData?.height;
        const bmi = heightCm ? Math.round((weightKg / ((heightCm / 100) ** 2)) * 10) / 10 : null;
        await pool.query(
            `INSERT INTO health_events (user_id, source, category, data_date, recorded_at, data)
             VALUES ($1, 'manual', 'body_composition', CURRENT_DATE, NOW(), $2)`,
            [user_id, JSON.stringify({ weight_kg: weightKg, ...(bmi != null ? { bmi } : {}) })]
        );
        await updateHealthTwin(user_id, pool);
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: '_syncBodyCompositionTwin failed', user_id, error: err.message }));
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
    // Not a Kino biomarker, but the same "<label> <number>" prose pattern applies, and it's a
    // number the model has no precomputed-and-verified value for otherwise (see BMI precompute
    // in handlePostChat, added after the 2026-07-16 wrong-age bug).
    { key: 'BMI', re: /\bBMI\b/gi },
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

// Pulls the patient's OWN stated age out of free-text — "73岁", "73 岁", "age 73", "73-year-old",
// "73 years old" — deliberately scoped to a short window right after their name, because every
// prompt template opens with "<nickname>, <age> 岁/years old" and that's the only position we can
// trust as "the patient's age" rather than an unrelated population statistic the model cites
// elsewhere in the reply (e.g. "60岁以上女性…" demographic trivia, which is NOT a misstatement).
// Even though user_profile.age is handed to the model directly, raw birth-date text riding along in
// questionnaire_context gives it material to (wrongly) re-derive age from instead of trusting the
// given figure — this is how the 2026-07-16 wrong-age bug happened.
function extractAgeMentions(text, nickname) {
    const ages = [];
    const nameIdx = nickname ? text.indexOf(nickname) : -1;
    const window = nameIdx >= 0
        ? text.slice(nameIdx, nameIdx + nickname.length + 20)
        : text.slice(0, 30);
    for (const m of window.matchAll(/(\d{1,3})\s*岁/g)) {
        ages.push(parseInt(m[1], 10));
    }
    for (const m of window.matchAll(/\bage[d]?\s+(\d{1,3})\b|\b(\d{1,3})[- ]year[- ]old\b/gi)) {
        ages.push(parseInt(m[1] || m[2], 10));
    }
    return ages;
}

// A fixed list of common "inviting further engagement" markers that violate the same
// "end cleanly, don't invite the user to keep asking" rule as a literal trailing "?" but
// carry no question mark to catch — e.g. "若您希望，我可以立即为您生成一张对比图" or "随时告诉我～".
// Found via live dev testing 2026-08-05: a Nano reply ended on exactly this pattern and
// stripTrailingQuestion's punctuation check let it straight through. Checked against only the
// FINAL sentence — these phrases are fine mid-reply (e.g. explaining an app feature); the rule
// is specifically about how the reply closes.
const TRAILING_INVITATION_PATTERNS = [
    /如果?你?您?(?:需要|想要|希望)[，,、].{0,20}(?:我(?:可以|很乐意|随时)|随时)/,
    /若你?您?(?:需要|想要|希望)[，,、].{0,20}(?:我(?:可以|很乐意|随时)|随时)/,
    /随时(?:告诉我|问我|联系|沟通|反馈|说)/,
    /有(?:任何)?需要.{0,10}随时/,
    /欢迎随时/,
    /我很乐意(?:为你|为您|帮你|帮您)?/,
    /如(?:需|果).{0,20}随时(?:告诉我|问我|说)/,
    // Covers phrasings that dodge a literal "？" by turning the solicitation into an imperative
    // ("请确认是否需要我为您生成...") rather than a grammatical question — found via live dev
    // testing 2026-08-05, a second escape of the original pattern list within the same session.
    /是否(?:需要|要)我/,
    /请确认是否/,
    // "需要我帮你把X设上吗？" / "要不要我帮你...？" — offering to perform a specific action, phrased
    // as a literal "吗？" yes/no question. Deliberately narrower than a blanket "ends in ?" ban
    // (scoped to an offer-to-act opener, not any question) so a genuine disambiguation question
    // in casual_chat/emotional_support ("你是指A还是B吗？") isn't caught by the same net — those
    // two intents' own prompts explicitly permit a real clarifying question, unlike the four
    // strict intents. Found via live dev testing 2026-08-05: reproduced under casual_chat,
    // where stripTrailingQuestion previously never even ran (gated on useAgenticLoop alone).
    /需要我.{0,25}吗[？?]?$/,
    /要不要我.{0,25}吗?[？?]?$/,
    /你要不要.{0,25}吗?[？?]?$/,
    /let me know if/i,
    /feel free to/i,
    /i'?m happy to/i,
    /just (?:say|ask|let me know)/i,
    /would you like/i,
];

// Deterministic backstop for the "never end the reply with a question (or an invitation to
// keep asking)" rule already stated in chat/biomarker.js, chat/nutrition.js, chat/science.js
// (e.g. "不要在结尾提问或引导用户继续追问"). JUDGE only grades factual grounding, not conversational
// style, so a violation of this purely stylistic rule is never flagged and PLAN/GENERATE/REVISE
// never gets a chance to fix it — a draft that ends this way can ship completely unchanged
// through every round. Found via live dev testing 2026-08-05 ("需要我帮你把下一次脉冲日安排进日程吗？"
// shipped despite the rule already being explicit in the prompt, and reproduced again even
// after making the prompt wording more emphatic — confirms this needs code enforcement, not
// just prompting).
//
// `strict` controls how aggressively this fires: the four high-risk/agentic intents
// (useAgenticLoop === true) have an unconditional "never end on a question" rule, so ANY
// trailing "?"/"？" or invitation pattern gets stripped there. casual_chat/emotional_support
// explicitly permit a genuine clarifying question ("不要在结尾提问，除非用户的话明显需要澄清才能回答"),
// so a blanket "?" ban would break that by design — non-strict mode only strips the narrower
// TRAILING_INVITATION_PATTERNS (offering to perform an action), never a bare trailing "?".
function stripTrailingQuestion(text, { strict = true } = {}) {
    const trimmed = text.trimEnd();
    // "." only counts as a sentence terminator when it isn't part of a decimal number —
    // otherwise every reply citing a biomarker value like "12.5%" or "13.5" gets fragmented
    // mid-number (e.g. "...12." / "5%。..."). Splitting still landed on the correct final
    // sentence before this fix (join('') with no separator silently re-glues every spurious
    // split), but the mid-string fragmentation left `last` sometimes pointing at a fragment
    // rather than the true final sentence for invitation-pattern matching — found while
    // testing the invitation patterns below against a real reply containing "12.1%"/"46.0%".
    const sentences = trimmed.match(/[^。！？!?\n]*(?:[。！？!?]|(?<!\d)\.(?!\d))|[^。！？!?\n]+$/g);
    if (!sentences || sentences.length === 0) return text;
    const last = sentences[sentences.length - 1];
    const isQuestion = /[?？]\s*$/.test(last.trimEnd());
    const isInvitation = TRAILING_INVITATION_PATTERNS.some(re => re.test(last));
    const violates = strict ? (isQuestion || isInvitation) : isInvitation;
    if (!violates) return text;
    if (sentences.length <= 1) return text; // whole reply is one sentence — nothing safe to fall back to
    sentences.pop();
    return sentences.join('').trimEnd();
}

// Cross-checks any biomarker figures / dates / age the model actually wrote against the ground-truth
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
            const historicalValues = groundTruth.extraValidValues?.[key] || [];
            const matchesHistory = historicalValues.some(v => Math.abs(value - v) <= Math.max(0.05, Math.abs(v) * 0.02));
            if (!matchesHistory) {
                mismatches.push({ key, stated: value, actual: truth });
            }
        }
    }
    if (groundTruth.tested_at) {
        const extraValidDates = new Set(groundTruth.extraValidDates || []);
        for (const stated of extractDateMentions(text)) {
            if (stated !== groundTruth.tested_at && !extraValidDates.has(stated)) {
                mismatches.push({ key: 'tested_at', stated, actual: groundTruth.tested_at });
            }
        }
    }
    if (groundTruth.age != null) {
        for (const stated of extractAgeMentions(text, groundTruth.nickname)) {
            if (stated !== groundTruth.age) {
                mismatches.push({ key: 'age', stated, actual: groundTruth.age });
            }
        }
    }
    return { ok: mismatches.length === 0, mismatches };
}

// Backstop against the fabrication patterns (fake citations, external-ingredient
// recommendations, fake BioAge dimensions) that testing showed slipping past the
// prompt-level rules in chat/factConstraint.js (2026-07-25, shared by both personas). One retry only -- if
// the retry also trips the detector, log it and use it anyway rather than looping.
//
// The correction instruction is built from *which* risk categories actually fired --
// an earlier version always sent a citation-only correction regardless of cause, so a
// reply flagged only for external-ingredient recommendations got a retry instruction
// that never mentioned the actual problem, and predictably repeated it.
const _CITATION_RISKS = new Set(['pValue', 'geneRsId', 'cohortMention', 'fakeInstitution', 'journalYearCitation', 'bookTitleCitation']);
const _INGREDIENT_RISKS = new Set(['knownExternalIngredient', 'standaloneDosage']);
const _DIMENSION_RISKS = new Set(['fakeDimensionValue', 'fakeDimensionAssertion']);
const _NAME_RISKS = new Set(['dotNameMismatch', 'fakeProductName', 'dotIngredientMismatch']);

function _buildCorrectionPrompt(risk) {
    const parts = ['你上一条回复违反了【事实约束】规则，请重新回答同一个问题，保持相同的语言、语气与整体结构，但修正以下问题：'];
    if (risk.some(r => _CITATION_RISKS.has(r))) {
        parts.push('- 你捏造了具体的研究引用、p值、基因位点编号、队列数据或机构/数据库名称——这类内容严禁出现，除非确实来自本提示词中提供的信息。只使用标准循证等级表述（如"有随机对照试验（RCT）支持"），不附加任何虚构细节。');
    }
    if (risk.some(r => _INGREDIENT_RISKS.has(r))) {
        parts.push('- 你推荐了配方库之外的补充剂/成分（如硫辛酸、葡萄籽提取物/原花青素、元素铁、黄连素，或任何带有具体mg剂量但未标注"X号原粒"的成分）——这严禁出现。任何具体成分建议都必须来自提示词中提供的原粒配方库，并明确点名"X号原粒"，不得推荐配方库之外的任何补充剂、草本或单体成分。');
    }
    if (risk.some(r => _DIMENSION_RISKS.has(r))) {
        parts.push('- 你为一个本系统不存在的"年龄"维度（如排毒年龄、肠道年龄等）编造了具体数值，或暗示/声称本系统能输出该维度——本系统只有四个真实维度（细胞年龄、代谢年龄、微血管年龄、抗压年龄），必须明确告知该维度不存在，不得编造其数值或方法论。');
    }
    if (risk.some(r => _NAME_RISKS.has(r))) {
        parts.push('- 你提到的某个原粒的编号、名称或成分列表，与提示词中提供的原粒配方库不匹配（可能用了旧版名称/成分，或整个产品/成分列表都是编造的）。任何原粒的编号、名称、成分都必须逐字复制提示词中原粒配方库里给出的原文，不得凭记忆改写、替换或编造。如果不确定某个编号对应的准确名称或成分，宁可只说编号（如"12号原粒"）不描述名称或成分，也不要猜测或凭记忆填写。');
    }
    parts.push('保持原有的回答风格与格式约定（如是否允许列表、是否禁止标题等），不要因为重新生成而改用 Markdown 标题（#、##、###）或"总体状态/逐维度分析"式的分段编号报告结构，除非提示词本身就要求这种格式。');
    return parts.join('\n');
}

async function _regenerateIfFabricationRisk(client, model, messages, reply, logContext, dotsFormulary, textForDetection) {
    const risk = detectAllRisks(textForDetection ?? reply, dotsFormulary);
    if (risk.length === 0) return reply;
    console.log(JSON.stringify({ level: 'WARN', msg: 'fabrication_risk_detected', context: logContext, risk }));
    const correctionPrompt = _buildCorrectionPrompt(risk);
    try {
        const retryCompletion = await client.chat.completions.create({
            model,
            messages: [...messages, { role: 'assistant', content: reply }, { role: 'user', content: correctionPrompt }],
            temperature: 0.2,
        });
        const retryReply = retryCompletion.choices[0].message.content || reply;
        const retryRisk = detectAllRisks(retryReply, dotsFormulary);
        console.log(JSON.stringify({ level: retryRisk.length === 0 ? 'INFO' : 'WARN', msg: 'fabrication_risk_retry', context: logContext, ok: retryRisk.length === 0, risk: retryRisk }));
        return retryReply;
    } catch (err) {
        console.log(JSON.stringify({ level: 'WARN', msg: 'fabrication_risk_retry_failed', context: logContext, error: err.message }));
        return reply;
    }
}

// Short "what I'm doing" captions shown in place of a static typing indicator while the
// agentic loop (lib/agenticChat.js) runs asynchronously — see runAgenticTurn's onStatus
// checkpoints. Calm, brief, no exclamation marks, matching Viva's existing prompt tone.
const STATUS_COPY = {
    understanding: { zh: '正在构建研究计划…', en: 'Building your research plan…' },
    checking_data: { zh: '正在同步你的数字孪生数据…', en: 'Syncing your digital twin data…' },
    verifying: { zh: '正在执行深度研究…', en: 'Running deep research…' },
};

// Returns an onStatus callback that inserts a lightweight 'chat_status' notification —
// reuses the existing notifications table/polling mechanism with zero schema change
// ('notification_type' is already free-text; 'chat_reply'/'coach_reminder' already coexist
// there). The miniapp routes 'chat_status' rows to a status caption instead of a chat bubble.
function makeStatusNotifier(user_id, language) {
    const isZh = (language || 'zh') === 'zh';
    return async (key) => {
        const copy = STATUS_COPY[key];
        if (!copy) return;
        await pool.query(
            'INSERT INTO notifications (user_id, notification_type, content, status) VALUES ($1, $2, $3, $4)',
            [user_id, 'chat_status', isZh ? copy.zh : copy.en, 'pending']
        );
    };
}

// Validation for the ask_questions action tail (Viva only, via askQuestionsBlock.js's prompt
// instruction) — never trust the LLM's shape blindly, same discipline as every other action.
// A malformed individual question is dropped, never repaired or fabricated; a malformed
// question-set-level field (name/name_zh) gets a generic fallback since the questions
// themselves are the substance, not the title.
const ASK_QUESTIONS_KEY_RE = /^[a-z][a-z0-9_]*$/;
const ASK_QUESTIONS_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ASK_QUESTIONS_INPUT_TYPES = new Set(['text', 'button_select', 'date_picker', 'slider_group', 'multi_select']);

function _validateAskQuestionsQuestion(q, seenKeys) {
    if (!q || typeof q !== 'object') return null;
    const key = typeof q.key === 'string' ? q.key : null;
    if (!key || !ASK_QUESTIONS_KEY_RE.test(key) || seenKeys.has(key)) return null;
    if (typeof q.prompt_en !== 'string' || !q.prompt_en.trim()) return null;
    if (typeof q.prompt_zh !== 'string' || !q.prompt_zh.trim()) return null;
    if (!ASK_QUESTIONS_INPUT_TYPES.has(q.input_type)) return null;

    const rawConfig = (q.config && typeof q.config === 'object') ? q.config : {};
    let config;

    if (q.input_type === 'text') {
        config = {};
        if (typeof rawConfig.placeholder_en === 'string') config.placeholder_en = rawConfig.placeholder_en;
        if (typeof rawConfig.placeholder_zh === 'string') config.placeholder_zh = rawConfig.placeholder_zh;
    } else if (q.input_type === 'date_picker') {
        config = {};
        // A malformed bound is dropped on its own (fall back to no bound) — a date picker
        // with no min/max still works, so this doesn't need to fail the whole question.
        if (typeof rawConfig.min_date === 'string' && ASK_QUESTIONS_DATE_RE.test(rawConfig.min_date) && !isNaN(Date.parse(rawConfig.min_date))) {
            config.min_date = rawConfig.min_date;
        }
        if (typeof rawConfig.max_date === 'string' && ASK_QUESTIONS_DATE_RE.test(rawConfig.max_date) && !isNaN(Date.parse(rawConfig.max_date))) {
            config.max_date = rawConfig.max_date;
        }
    } else if (q.input_type === 'button_select' || q.input_type === 'multi_select') {
        if (!Array.isArray(rawConfig.options)) return null;
        const seenOptionValues = new Set();
        const options = [];
        for (const opt of rawConfig.options) {
            if (!opt || typeof opt !== 'object') continue;
            const value = typeof opt.value === 'string' ? opt.value : (typeof opt.key === 'string' ? opt.key : null);
            if (!value || seenOptionValues.has(value)) continue;
            if (typeof opt.label_en !== 'string' || !opt.label_en.trim()) continue;
            if (typeof opt.label_zh !== 'string' || !opt.label_zh.trim()) continue;
            seenOptionValues.add(value);
            options.push(q.input_type === 'multi_select'
                ? { key: value, label_en: opt.label_en, label_zh: opt.label_zh }
                : { value, label_en: opt.label_en, label_zh: opt.label_zh });
        }
        if (options.length < 2 || options.length > 7) return null;
        config = { options };
        if (q.input_type === 'multi_select' && rawConfig.allow_other === true
            && typeof rawConfig.other_key === 'string' && ASK_QUESTIONS_KEY_RE.test(rawConfig.other_key)) {
            config.allow_other = true;
            config.other_key = rawConfig.other_key;
        }
    } else { // slider_group
        if (!Array.isArray(rawConfig.sliders)) return null;
        const seenSliderKeys = new Set();
        const sliders = [];
        for (const s of rawConfig.sliders) {
            if (!s || typeof s !== 'object') continue;
            const sKey = typeof s.key === 'string' ? s.key : null;
            if (!sKey || !ASK_QUESTIONS_KEY_RE.test(sKey) || seenSliderKeys.has(sKey)) continue;
            if (typeof s.label_en !== 'string' || !s.label_en.trim()) continue;
            if (typeof s.label_zh !== 'string' || !s.label_zh.trim()) continue;
            const min = Number(s.min), max = Number(s.max), step = Number(s.step), def = Number(s.default);
            if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(step) || !Number.isFinite(def)) continue;
            if (!(min < max) || !(step > 0) || def < min || def > max) continue;
            seenSliderKeys.add(sKey);
            sliders.push({
                key: sKey, label_en: s.label_en, label_zh: s.label_zh, min, max, step, default: def,
                ...(typeof s.unit === 'string' ? { unit: s.unit } : {}),
            });
        }
        // A bad slider is dropped from the array, not the whole question — but if none
        // survive, there's nothing left to render, so the whole question is dropped.
        if (sliders.length === 0 || sliders.length > 4) return null;
        config = { sliders };
    }

    seenKeys.add(key);
    return { key, prompt_en: q.prompt_en.trim(), prompt_zh: q.prompt_zh.trim(), input_type: q.input_type, config };
}

// Question-set-level: require 1-5 surviving questions (tighter than the admin questionnaire
// generator's 3-8 — this is a short in-conversation follow-up, not a full intake). Returns
// null (never partially-invalid) if the tail is missing/unparseable or nothing survives.
function _validateAskQuestionsPayload(parsed) {
    if (!parsed || parsed.action !== 'ask_questions' || !Array.isArray(parsed.questions)) return null;
    const seenKeys = new Set();
    const questions = [];
    for (const q of parsed.questions) {
        const valid = _validateAskQuestionsQuestion(q, seenKeys);
        if (valid) questions.push(valid);
        if (questions.length >= 5) break;
    }
    if (questions.length < 1) return null;
    const name = (typeof parsed.name === 'string' && parsed.name.trim()) ? parsed.name.trim() : 'Follow-up Questions';
    const name_zh = (typeof parsed.name_zh === 'string' && parsed.name_zh.trim()) ? parsed.name_zh.trim() : '补充问题';
    return { name, name_zh, questions };
}

// Shared tail run after rawReply is produced, regardless of which path produced it (classic
// tool loop, sandbox-agentic, EventBridge-triggered agentic, or the sync fallback when
// publishing the chat.generate event fails) — grounding check, fabrication-risk-guard skip,
// weight/reminder action detection, reply cleanup, and save+notify. Extracted 2026-07-28 so
// the new async agentic path (handleChatGenerateEvent) and every synchronous caller share one
// implementation instead of drifting apart over time.
async function finalizeChatReply({ rawReply, extraValidDates, extraValidValues, llmContext, systemPrompt, cleanHistory, chatMessages, user, user_id, personaType, sandbox, useAgenticLoop, client, model }) {
    // Grounding check: the model can still misstate biomarker figures/BMI/dates/age from
    // conversation history or from raw birth-date/height/weight text riding along in
    // questionnaire_context, even when the correct values are right there in its own system
    // prompt (this is exactly how the 2026-07-14 stale-data bug and the 2026-07-16 wrong-age
    // bug happened). Cross-check what it actually wrote against the ground-truth data fetched
    // above, and retry once with an explicit correction if it drifted.
    //
    // Strip the record_weight/set_reminder action JSON before checking: its "scheduled_for"
    // is a future reminder timestamp, not a claim about the biomarker test date, but
    // extractDateMentions() matches any YYYY-MM-DD blindly and doesn't know the difference.
    // Left unstripped, every set_reminder reply guaranteed-false-positived a "date mismatch"
    // against tested_at, which fed unrelated biomarker ground-truth values into the
    // correction prompt and told the model to "rewrite using ONLY these values" -- hijacking
    // reminder confirmations into unrelated biomarker essays (found 2026-07-26).
    const stripActionJson = (text) => text
        .replace(/\{"action"\s*:\s*"record_weight"[^}]*\}/g, '')
        .replace(/\{"action"\s*:\s*"set_reminder"[^}]*\}/g, '')
        .replace(/\{"action"\s*:\s*"remember_fact"[^}]*\}/g, '')
        // ask_questions nests braces (an array of question objects), like formulate_dots's own
        // action tail, so it can't be bounded by the flat [^}]* pattern the other three use —
        // greedy-to-end-of-string is safe since the model is always instructed to put this
        // tail last.
        .replace(/\{"action"\s*:\s*"ask_questions"[\s\S]*$/, '');
    const hasKnownAge = user.birth_date != null;
    const hasKnownBmi = llmContext.user_profile.bmi != null;
    if (Object.keys(llmContext.biomarkers).length > 0 || hasKnownAge || hasKnownBmi) {
        const groundTruth = {
            validated: {
                ...llmContext.biomarkers,
                ...(hasKnownBmi ? { BMI: llmContext.user_profile.bmi } : {}),
            },
            tested_at: llmContext.biomarkers_tested_at,
            age: hasKnownAge ? llmContext.user_profile.age : null,
            nickname: llmContext.user_profile.nickname,
            // Real historical dates AND historical per-biomarker values the agentic loop
            // actually fetched via its dedicated tools — a date or value matching one of
            // these is legitimate, not a fabrication, even though it isn't the single
            // latest snapshot this check otherwise compares against. Empty for the
            // non-agentic path, which has no such tool history to draw from.
            extraValidDates,
            extraValidValues,
        };
        const verification = verifyBiomarkerGrounding(stripActionJson(rawReply), groundTruth);
        if (!verification.ok) {
            console.log(JSON.stringify({ level: 'WARN', msg: 'biomarker_grounding_mismatch', user_id, mismatches: verification.mismatches }));
            const correctionPrompt = `Your previous reply stated biomarker figures, BMI, a test date, and/or the patient's age that do not match their actual record.
Ground truth — test date: ${groundTruth.tested_at || 'unknown'}, values: ${JSON.stringify(groundTruth.validated)}, age: ${groundTruth.age ?? 'unknown'}.
Rewrite your previous reply using ONLY these exact values, this exact date, and this exact age. Keep the same language, tone, and structure otherwise.`;
            chatMessages.push({ role: 'assistant', content: rawReply });
            chatMessages.push({ role: 'user', content: correctionPrompt });
            const retryCompletion = await client.chat.completions.create({
                model,
                messages: chatMessages,
                temperature: 0.2,
            });
            const retryReply = retryCompletion.choices[0].message.content || rawReply;
            const retryVerification = verifyBiomarkerGrounding(stripActionJson(retryReply), groundTruth);
            console.log(JSON.stringify({ level: retryVerification.ok ? 'INFO' : 'WARN', msg: 'biomarker_grounding_retry', user_id, ok: retryVerification.ok, mismatches: retryVerification.mismatches }));
            rawReply = retryReply;
        }
    }

    // Superseded by the JUDGE step inside runAgenticTurn for the high-risk/agentic
    // branch (it already runs detectAllRisks against the draft) — running this too
    // would just be a redundant second single-retry cycle on top of that loop's own.
    if (personaType === 'viva' && !useAgenticLoop) {
        rawReply = await _regenerateIfFabricationRisk(
            client, model,
            [{ role: 'system', content: systemPrompt }, ...cleanHistory],
            rawReply, 'handlePostChat', llmContext.dots, stripActionJson(rawReply)
        );
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
                    await _syncBodyCompositionTwin(user_id, weightKg, user.bio_data);
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

    // Detect personal-fact action embedded by the LLM (dietary restrictions, allergies,
    // preferences, goals stated in conversation). Same risk-acceptance level as
    // record_weight/set_reminder above: regex + fixed-enum validation only, no semantic
    // verification — never trust the LLM's category field blindly, same principle as
    // weight's numeric bounds check.
    const factActionMatch = rawReply.match(/\{"action"\s*:\s*"remember_fact"[^}]*\}/);
    let recordedFactText = null;
    if (factActionMatch) {
        try {
            const factAction = JSON.parse(factActionMatch[0]);
            const VALID_FACT_CATEGORIES = new Set(['dietary_restriction', 'allergy', 'preference', 'goal', 'other']);
            if (factAction.fact && typeof factAction.fact === 'string' && VALID_FACT_CATEGORIES.has(factAction.category)) {
                recordedFactText = factAction.fact.trim();
                if (!sandbox) {
                    await pool.query(
                        `INSERT INTO user_memory_facts (user_id, category, fact_zh, source)
                         VALUES ($1, $2, $3, 'chat_extracted')
                         ON CONFLICT (user_id, category, fact_zh) WHERE status = 'active'
                         DO UPDATE SET last_mentioned_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP`,
                        [user_id, factAction.category, recordedFactText]
                    );
                }
            }
        } catch (e) {
            console.log(JSON.stringify({ level: 'WARN', msg: 'remember_fact action parse failed', error: e.message }));
        }
    }

    // Detect ask_questions action embedded by the LLM (Viva only, via askQuestionsBlock.js's
    // prompt instruction) — a short follow-up questionnaire the model wants the miniapp to
    // render natively. A missing/unparseable/invalid tail is never a failure: the model was
    // only ever instructed to include one conditionally, so continue with the normal reply.
    let askQuestionsCommitted = null;
    const askQuestionsExtracted = _extractTrailingJson(rawReply, '{"action":"ask_questions"');
    if (askQuestionsExtracted) {
        const validatedAskQuestions = _validateAskQuestionsPayload(askQuestionsExtracted.parsed);
        if (!validatedAskQuestions) {
            console.log(JSON.stringify({ level: 'WARN', msg: 'ask_questions_action_missing_or_invalid', user_id }));
        } else if (!sandbox) {
            // Sandbox sessions have no notification-polling side channel and would leave the
            // assignment invisible/orphaned against a real user record — skip the DB writes
            // entirely, same convention record_weight's `if (!sandbox)` guard already uses.
            try {
                const allowed = await canCreateDynamicQuestionnaire(user_id, personaType);
                if (allowed) {
                    await createDynamicQuestionnaire(user_id, validatedAskQuestions);
                    await pool.query(
                        'INSERT INTO notifications (user_id, notification_type, content, status) VALUES ($1, $2, $3, $4)',
                        [user_id, 'questionnaire_ready', (user.language || 'zh') === 'zh' ? '有几个问题想了解一下' : 'A couple of quick questions for you', 'pending']
                    );
                    askQuestionsCommitted = validatedAskQuestions;
                } else {
                    console.log(JSON.stringify({ level: 'INFO', msg: 'ask_questions_rate_limited', user_id }));
                }
            } catch (e) {
                // Fail open: the questionnaire didn't get created, but the chat reply itself
                // must still ship — never let this throw block the turn (same principle as
                // every other action's try/catch in this function).
                console.log(JSON.stringify({ level: 'WARN', msg: 'ask_questions_commit_failed', user_id, error: e.message }));
            }
        }
    }

    // A REVISE-round completion can occasionally consist of ONLY the corrected action JSON
    // with no surrounding prose (the model over-focuses on fixing the flagged action param
    // and drops the conversational reply) — stripping it then would ship a blank message.
    // Never let that happen; fall back to an acknowledgment referencing the actual recorded
    // fact when we have one (already validated above, so safe to echo back), otherwise a
    // minimal generic acknowledgment.
    let strippedReply = rawReply
        .replace(/\n?\{"action"\s*:\s*"record_weight"[^}]*\}/g, '')
        .replace(/\n?\{"action"\s*:\s*"set_reminder"[^}]*\}/g, '')
        .replace(/\n?\{"action"\s*:\s*"remember_fact"[^}]*\}/g, '')
        .replace(/\n?\{"action"\s*:\s*"ask_questions"[\s\S]*$/, '')
        .trim();
    // Runs for every intent, not just the agentic ones — casual_chat/emotional_support still
    // get the narrower non-strict pass (TRAILING_INVITATION_PATTERNS only, no bare "?" ban) so
    // an "offering to act" ending like "需要我帮你...吗？" is caught there too, without breaking
    // those two intents' own sanctioned exception for a genuine clarifying question.
    {
        const dequestioned = stripTrailingQuestion(strippedReply, { strict: useAgenticLoop });
        if (dequestioned !== strippedReply) {
            console.log(JSON.stringify({ level: 'WARN', msg: 'chat_trailing_question_stripped', user_id, strict: useAgenticLoop, original_tail: strippedReply.slice(-80) }));
            strippedReply = dequestioned;
        }
    }
    const isZhReply = (user.language || 'zh') === 'zh';
    const fallbackReply = recordedFactText
        ? (isZhReply ? `好的，已记录：${recordedFactText}` : `Got it — noted: ${recordedFactText}`)
        : askQuestionsCommitted
        ? (isZhReply ? `好的，我想先了解几个问题：${askQuestionsCommitted.name_zh}` : `Sure — I have a couple of quick questions first: ${askQuestionsCommitted.name}`)
        : (isZhReply ? '好的，已记录。' : 'Got it — noted.');
    const reply = strippedReply || fallbackReply;

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
    return { success: true, user_id };
}

// Called (awaited — see questionnaires.js's call site for why fire-and-forget doesn't work on
// FC 3.0) from handlePostQuestionnaireResponse (questionnaires.js) the moment a dynamically-
// created (type='dynamic') questionnaire assignment completes — injected there as a dependency
// parameter (mirroring the existing saveChatMessage injection) rather than imported directly,
// since questionnaires.js already exports formatQuestionnaireContext for chat.js to consume
// and importing the other direction would be circular.
//
// Publishes through the same publishChatGenerateEvent/handleChatGenerateEvent pipeline every
// other agentic feature uses, with NO new `kind` — lands on handleChatGenerateEvent's default
// branch (finalizeChatReply), same as any normal chat turn. Unlike formulate_dots, there's no
// FK-threading/placeholder-row need here, so the two-phase split isn't warranted.
async function _fireQuestionnaireAnsweredFollowup(userId, assignmentId) {
    const userRes = await pool.query(
        `SELECT user_id, nickname, gender, birth_date, language, channel_id FROM users WHERE user_id = $1`,
        [userId]
    );
    if (!userRes.rows.length) return;
    const user = userRes.rows[0];

    let personaType = 'nano';
    if (user.channel_id) {
        try {
            const chRes = await pool.query('SELECT config FROM channels WHERE id = $1', [user.channel_id]);
            personaType = chRes.rows[0]?.config?.persona_type ?? 'nano';
        } catch (e) {
            console.log(JSON.stringify({ level: 'WARN', msg: 'questionnaire_answered_followup_persona_lookup_failed', user_id: userId, error: e.message }));
        }
    }
    if (personaType !== 'viva') return; // ask_questions is Viva-only for now — nothing to react to on Nano's path

    const [biomarkerRes, dotsRes, factsRes, responsesRes] = await Promise.all([
        pool.query(
            `SELECT data, tested_at FROM biomarkers WHERE user_id = $1 AND test_type = 'kino_chip' AND (data->'validated') IS NOT NULL ORDER BY tested_at DESC LIMIT 1`,
            [userId]
        ),
        pool.query(
            `SELECT id, key_name, key_name_zh, name, name_zh, description, is_isolate, timing, sub_age_target, ingredients, ingredients_zh, target_dots_min, target_dots_max, dosing_protocol, pulse_days_per_cycle, pulse_cycle_days FROM dots ORDER BY id ASC`
        ),
        pool.query(
            `SELECT category, fact_zh FROM user_memory_facts WHERE user_id = $1 AND status = 'active' ORDER BY category, last_mentioned_at DESC`,
            [userId]
        ),
        pool.query(
            `SELECT q.name, q.name_zh, qq.prompt_en, qq.prompt_zh, qr.answer
             FROM questionnaire_responses qr
             JOIN questionnaire_questions qq ON qq.id = qr.question_id
             JOIN questionnaire_assignments qa ON qa.id = qr.assignment_id
             JOIN questionnaires q ON q.id = qa.questionnaire_id
             WHERE qr.assignment_id = $1
             ORDER BY qq.sort_order ASC`,
            [assignmentId]
        ),
    ]);

    const biomarkerRow = biomarkerRes.rows[0] || {};
    const essentialKnowledge = await getEssentialBlock(personaType);
    const currentSolarTerm = getCurrentSolarTerm(getNowShanghai().toJSDate());
    const qaContext = formatQuestionnaireContext(responsesRes.rows, user.language);

    // Scoped to what viva/chat/casual.js's template actually reads (user_profile,
    // questionnaire_context, active_health_plans, essential_knowledge, user_facts) plus
    // biomarkers/dots for finalizeChatReply's own grounding check / fabrication-risk guard —
    // not the full handlePostChat context (health_twin, active_health_plans, etc. omitted;
    // casual_chat's reaction to "here's what you just told me" doesn't need them).
    const llmContext = {
        user_profile: {
            nickname: user.nickname,
            gender: user.gender,
            age: calculateAge(user.birth_date),
            bmi: null,
            language: user.language,
        },
        biomarkers: biomarkerRow.data?.validated || {},
        biomarkers_tested_at: biomarkerRow.tested_at
            ? formatToShanghai(new Date(biomarkerRow.tested_at)).slice(0, 10)
            : null,
        bioage: biomarkerRow.data?.bioage_profile || {},
        dots: dotsRes.rows,
        questionnaire_context: qaContext,
        active_health_plans: [],
        current_solar_term: currentSolarTerm,
        essential_knowledge: essentialKnowledge,
        user_facts: factsRes.rows,
    };

    const systemPrompt = vivaPrompts.casual_chat(llmContext);
    const triggerMsg = user.language === 'zh'
        ? '（用户刚完成了一份补充问卷）'
        : '(The user just completed a follow-up questionnaire.)';

    try {
        await publishChatGenerateEvent({
            event_id: uuidv4(),
            user_id: userId,
            message: triggerMsg,
            intent: 'casual_chat',
            llmContext,
            systemPrompt,
            cleanHistory: [],
            language: user.language,
            personaType,
            birth_date: user.birth_date,
        });
    } catch (ebErr) {
        // Fail open: unlike handlePostChat, no HTTP caller is waiting on this specific reply
        // (handlePostQuestionnaireResponse's own response has already been decided regardless
        // of this call) — a publish failure just means a missed reaction; log and drop rather
        // than building a synchronous inline-generate fallback for this v1.
        console.log(JSON.stringify({ level: 'WARN', msg: 'questionnaire_answered_followup_publish_failed', user_id: userId, error: ebErr.message }));
    }
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
    // Both personas now run the same agentic engine (CLAUDE.md — Nano adopted Viva's core),
    // so both get a solar-term accent and a persona-scoped knowledge_entries essential block —
    // Nano's own prompt files simply won't reference current_solar_term unless it's natural to.
    const currentSolarTerm = getCurrentSolarTerm(getNowShanghai().toJSDate());
    const essentialKnowledge = await getEssentialBlock(personaType);

    if (message) {
        // Intent-routed chat message handling
        try {
            const client = getLlmClient();
            const model = process.env.MODEL || 'qwen-plus-latest';

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
                `SELECT data, tested_at FROM biomarkers WHERE user_id = $1 AND test_type = 'kino_chip' AND (data->'validated') IS NOT NULL ORDER BY tested_at DESC LIMIT 1`,
                [user_id]
            );
            // Always fetch dots too (small table, cheap query) — same rationale as biomarker
            // above. Gating this behind required_data.includes('dots') meant intents like
            // biomarker_question never saw the real formulary, so when told to give a concrete
            // next step, the model reached for generic external supplement knowledge instead
            // of an actual dot (found via real-user testing 2026-07-25).
            fetches.dots = pool.query(
                `SELECT id, key_name, key_name_zh, name, name_zh, description, is_isolate, timing, sub_age_target, ingredients, ingredients_zh, target_dots_min, target_dots_max, dosing_protocol, pulse_days_per_cycle, pulse_cycle_days FROM dots ORDER BY id ASC`
            );
            // Always fetch active personal memory facts (dietary restrictions, allergies,
            // preferences, goals stated in prior conversations) — same unconditional
            // treatment as biomarker/dots above, not gated behind required_data, since an
            // allergy needs to be visible on every turn regardless of intent.
            fetches.user_facts = pool.query(
                `SELECT category, fact_zh FROM user_memory_facts WHERE user_id = $1 AND status = 'active' ORDER BY category, last_mentioned_at DESC`,
                [user_id]
            );
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

            // Always fetch completed questionnaire responses — coach-collected data enriches all intents.
            // Excludes the birth-date question (save_field = 'birth_date') and the height/weight
            // question (save_biomarker_type = 'body_composition'): those raw values are redundant with
            // the pre-computed llmContext.user_profile.age/bmi, and having both the raw and derived
            // figure in context lets the model re-derive age/BMI itself instead of trusting the given
            // number — exactly how the 2026-07-16 wrong-age bug happened.
            fetches.questionnaire_responses = pool.query(
                `SELECT q.name, q.name_zh, qq.prompt_en, qq.prompt_zh, qr.answer
                 FROM questionnaire_responses qr
                 JOIN questionnaire_questions qq ON qq.id = qr.question_id
                 JOIN questionnaire_assignments qa ON qa.id = qr.assignment_id
                 JOIN questionnaires q ON q.id = qa.questionnaire_id
                 WHERE qa.user_id = $1 AND qa.status = 'completed'
                   AND qq.save_field IS DISTINCT FROM 'birth_date'
                   AND qq.save_biomarker_type IS DISTINCT FROM 'body_composition'
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
            const twinRow = fetched.health_twin?.rows[0] || null;
            // Precompute BMI server-side (prefer a real scale/wearable reading over onboarding
            // self-report) rather than leaving the model to derive it itself from raw height/weight —
            // that's exactly the pattern that produced a hallucinated wrong age (2026-07-16): a
            // derived number left ungrounded, with only raw source data for the model to (mis)compute
            // from. See the questionnaire_responses query below, which excludes the raw height/weight
            // answer for the same reason.
            const heightCm = user.bio_data?.height;
            const weightKg = twinRow?.latest_weight_kg ?? user.bio_data?.weight;
            const bmi = twinRow?.latest_bmi != null
                ? Math.round(twinRow.latest_bmi * 10) / 10
                : (heightCm && weightKg ? Math.round((weightKg / ((heightCm / 100) ** 2)) * 10) / 10 : null);
            const llmContext = {
                user_profile: {
                    nickname: user.nickname,
                    gender: user.gender,
                    age: calculateAge(user.birth_date),
                    bmi,
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
                health_twin: twinRow,
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
                current_solar_term: currentSolarTerm,
                essential_knowledge: essentialKnowledge,
                user_facts: fetched.user_facts?.rows || [],
            };

            const activePrompts = personaType === 'viva' ? vivaPrompts : nanoPrompts;
            const promptBuilder = activePrompts[intent] || activePrompts.casual_chat;
            const systemPrompt = promptBuilder(llmContext);
            const useAgenticLoop = HIGH_RISK_INTENTS.has(intent);

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

            // The shared grounding-retry check below (verifyBiomarkerGrounding) rebuilds its
            // correction attempt from this plain system+history message list regardless of
            // which branch produced rawReply — matches how _regenerateIfFabricationRisk
            // already reconstructs a fresh message list rather than reusing tool-call debris.
            let chatMessages = [
                { role: 'system', content: systemPrompt },
                ...cleanHistory,
            ];

            // Viva's agentic loop can take 60-180+ seconds worst case (plan/generate/judge/
            // revise). Aliyun FC cancels the function invocation the moment the miniapp's
            // client disconnects (confirmed via live logs 2026-07-28: "Invocation canceled by
            // client") — so awaiting the loop inline here means a client timeout destroys real
            // work, not just delays it. Publish it as a chat.generate event instead and ack
            // immediately; the EventBridge-triggered handleChatGenerateEvent below does the
            // actual generation on a separate invocation a client disconnect can't reach.
            // sandbox (admin "login as" / chat-simulator) has no polling side channel and
            // must keep getting the reply synchronously, so it never takes this branch.
            if (useAgenticLoop && !sandbox) {
                const eventId = uuidv4();
                try {
                    await publishChatGenerateEvent({
                        event_id: eventId, user_id, message, intent, llmContext, systemPrompt,
                        cleanHistory, language: user.language, personaType, birth_date: user.birth_date,
                    });
                    return { success: true, user_id, processing: true };
                } catch (ebErr) {
                    console.log(JSON.stringify({ level: 'WARN', msg: 'chat_generate_publish_failed_fallback_sync', user_id, intent, error: ebErr.message }));
                    // Fail open (same principle as dispatcher/index.js's EventBridge fallback,
                    // and this session's grounding fixes): never silently drop the user's
                    // message just because EventBridge is unavailable — fall through and run
                    // the agentic loop inline below instead.
                }
            }

            let rawReply = '';
            let extraValidDates = [];
            let extraValidValues = {};
            if (useAgenticLoop) {
                const agenticResult = await runAgenticTurn({
                    client, model, message, intent, llmContext, systemPrompt, cleanHistory,
                    pool, user_id, language: user.language, personaType,
                    logContext: { user_id, intent, handler: 'handlePostChat' },
                    onStatus: sandbox ? undefined : makeStatusNotifier(user_id, user.language),
                });
                rawReply = agenticResult.reply;
                extraValidDates = agenticResult.extraValidDates;
                extraValidValues = agenticResult.extraValidValues;
            } else {
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
            }

            return await finalizeChatReply({
                rawReply, extraValidDates, extraValidValues, llmContext, systemPrompt, cleanHistory,
                chatMessages, user, user_id, personaType, sandbox, useAgenticLoop, client, model,
            });
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

// Finishing tail for the formula_dots kind of chat.generate event — explains an ALREADY
// COMMITTED dot allocation (handlePostFormulaDots's schedule was written to the DB before this
// ever ran), not a fresh chat reply. Reuses the same grounding-check-with-one-retry pattern as
// finalizeChatReply/finalizeHealthAdviceReply for consistency, but delivers via a 'nutrition_plan'
// notification (matching what this endpoint has always used) rather than 'chat_reply'.
//
// planText (the raw D-N1x3 D-N2x3 ... per-day breakdown, still passed through the event payload)
// is deliberately NOT appended to the message shown to the user — found 2026-07-29 that dumping
// the same 18-dot raw listing 7 times (once per identical day) alongside the narrative read as
// confusing technical noise; the "查看方案" action button is where users see exact numbers.
// Extracts a trailing action-JSON object that (unlike record_weight/set_reminder/remember_fact's
// flat shape) contains nested braces — {"action":"formulate_dots","formulation":[{...}, ...]} —
// so the simple "no closing brace inside" regex the other actions use can't bound it. Finds the
// last occurrence of `marker` and scans forward tracking brace depth to find its true end.
function _extractTrailingJson(text, marker) {
    const idx = text.lastIndexOf(marker);
    if (idx === -1) return null;
    let depth = 0;
    let end = -1;
    for (let i = idx; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') {
            depth--;
            if (depth === 0) { end = i; break; }
        }
    }
    if (end === -1) return null;
    try {
        return { parsed: JSON.parse(text.slice(idx, end + 1)), start: idx, end: end + 1 };
    } catch (e) {
        return null;
    }
}

// Parses/validates/commits the LLM's formulate_dots action tail (produced by the agentic
// GENERATE step against systemFormulaGenerate.js's prompt), then delivers the accompanying
// prose as the user-facing explanation — the agentic reply doubles as its own narrative, no
// second LLM call needed (unlike the old two-hop decide-then-explain design this supersedes).
async function finalizeFormulaDotsGenerate({ rawReply, extraValidDates, extraValidValues, llmContext, message, user_id, personaType, lang }) {
    const hasKnownAge = llmContext.user_profile.age != null;
    const hasKnownBmi = llmContext.user_profile.bmi != null;
    if (Object.keys(llmContext.biomarkers).length > 0 || hasKnownAge || hasKnownBmi) {
        const groundTruth = {
            validated: { ...llmContext.biomarkers, ...(hasKnownBmi ? { BMI: llmContext.user_profile.bmi } : {}) },
            tested_at: llmContext.biomarkers_tested_at,
            age: hasKnownAge ? llmContext.user_profile.age : null,
            nickname: llmContext.user_profile.nickname,
            extraValidDates, extraValidValues,
        };
        const strippedForCheck = rawReply.replace(/\{"action"\s*:\s*"formulate_dots"[\s\S]*$/, '');
        const verification = verifyBiomarkerGrounding(strippedForCheck, groundTruth);
        if (!verification.ok) {
            console.log(JSON.stringify({ level: 'WARN', msg: 'biomarker_grounding_mismatch', user_id, handler: 'finalizeFormulaDotsGenerate', mismatches: verification.mismatches }));
            // Note: unlike finalizeChatReply/finalizeFormulaDotsNarrative's retry, there's no
            // cheap correction call wired here — the action JSON tail makes a "rewrite using
            // ONLY these values" retry risky (the model could rewrite the numbers too). The
            // mismatch is logged for visibility; the reply still ships since the *numeric plan*
            // (validated deterministically below) is the part that actually matters here.
        }
    }

    const dotsByKey = new Map((llmContext.dots || []).map(d => [d.key_name.replace(/^DOT/, 'D'), d]));
    const extracted = _extractTrailingJson(rawReply, '{"action":"formulate_dots"');
    let entries = null;
    if (extracted && extracted.parsed?.action === 'formulate_dots' && Array.isArray(extracted.parsed.formulation)) {
        entries = new Map();
        for (const item of extracted.parsed.formulation) {
            const dot = dotsByKey.get(item?.dot_key);
            if (!dot) continue; // unknown key — never trust the LLM's key blindly
            // The model decides only a single daily total ("count") — asking it to also compute
            // its own morning/evening split was tried first (a prompt-only "lean toward whichever
            // slot has less" rule) and found, via live sampling against 5 real prod users
            // 2026-08-08, to never actually redistribute anything: every flexible dot came back
            // 100% in its default slot in every sample (PM/AM ratio ~0.01), despite explicit
            // instructions. LLMs reliably fail at this kind of implicit running-tally arithmetic
            // across ~18 independent JSON entries in one completion. The split is now always
            // computed deterministically below via _splitDotTiming — the same function the
            // non-agentic fallback path already uses — so the model is never trusted with it.
            // A legacy 'morning'/'evening'-shaped reply (from a stale cached prompt / in-flight
            // request during deploy) still degrades gracefully via their sum.
            const count = Number.isFinite(item.count)
                ? Math.max(0, Math.round(item.count))
                : Math.max(0, Math.round((Number(item.morning) || 0) + (Number(item.evening) || 0)));
            entries.set(item.dot_key, { count, dot });
        }
        if (entries.size === 0) entries = null;
    }

    let analysis, finalContent, morningRecipe, eveningRecipe;

    if (entries) {
        // Fill any dot the model omitted with the same deterministic per-dot fallback used
        // elsewhere.
        for (const dot of llmContext.dots || []) {
            const key = dot.key_name.replace(/^DOT/, 'D');
            if (entries.has(key)) continue;
            entries.set(key, { count: _fallbackCountForDot(dot), dot });
        }

        // Deterministic clamp: each dot's total must land inside its own target_dots_min/max —
        // never trust the LLM's numbers blindly, same principle as every other action
        // (record_weight's bounds check, etc.). A total of 0 is a legitimate "not included this
        // week" choice and is left alone rather than forced up to the min.
        for (const v of entries.values()) {
            if (v.count === 0) continue;
            const min = v.dot.target_dots_min ?? 1;
            const max = v.dot.target_dots_max ?? 10;
            if (v.count < min || v.count > max) v.count = Math.min(max, Math.max(min, v.count));
        }

        // AM/PM split is entirely code-driven, never model-driven — see the comment above.
        // _splitDotTiming already guarantees non-flexible dots stay 100% in their default slot.
        for (const v of entries.values()) {
            const { morning, evening } = _splitDotTiming(v.dot, v.count);
            v.morning = morning;
            v.evening = evening;
        }

        morningRecipe = { dots: {} };
        eveningRecipe = { dots: {} };
        let morningTotal = 0, eveningTotal = 0;
        for (const [key, v] of entries) {
            const dbKey = key.replace('D', 'DOT');
            if (v.morning > 0) morningRecipe.dots[dbKey] = v.morning;
            if (v.evening > 0) eveningRecipe.dots[dbKey] = v.evening;
            morningTotal += v.morning;
            eveningTotal += v.evening;
        }
        // Observability only — _splitDotTiming only moves ~30% of a flexible dot's count off its
        // default slot, so a day dominated by dots defaulting to the same slot can still end up
        // skewed by design (this is a signal to watch, not something to override here).
        if (eveningTotal < morningTotal * 0.15 && morningTotal > 20) {
            console.log(JSON.stringify({ level: 'WARN', msg: 'formula_dots_am_pm_imbalanced', user_id, morningTotal, eveningTotal }));
        }

        const strippedReply = rawReply.slice(0, extracted.start).trim();
        analysis = strippedReply;
        finalContent = strippedReply || (lang === 'zh'
            ? '您的专属原粒方案已生成，点击下方"查看方案"了解详情。'
            : 'Your personalized dot plan has been generated — tap "View Plan" below for the details.');
    } else {
        // No usable action JSON — fall back to the deterministic single-shot formulator so the
        // user is never left with nothing (same resilience principle as the 2026-07-29
        // remember_fact blank-reply fix).
        console.log(JSON.stringify({ level: 'WARN', msg: 'formulate_dots_action_missing_or_invalid', user_id, handler: 'finalizeFormulaDotsGenerate' }));
        const fallback = await _runDeterministicFormulation({
            biomarkers: llmContext.biomarkers,
            bioageProfile: llmContext.bioage,
            dotsFormulary: llmContext.dots,
            personaType,
            lang,
            currentSolarTerm: llmContext.current_solar_term,
            essentialKnowledge: llmContext.essential_knowledge,
            userFacts: llmContext.user_facts,
        });
        ({ analysis, finalContent, morningRecipe, eveningRecipe } = fallback);
    }

    const client = await pool.connect();
    let committedPlanId;
    try {
        await client.query('BEGIN');
        committedPlanId = await _commitNutritionPlan(client, {
            userId: user_id, analysis, morningRecipe, eveningRecipe,
            planId: llmContext.pending_plan_id, dotsFormulary: llmContext.dots,
        });
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }

    // null means the commit was skipped as stale (a late/duplicate event for a pending plan
    // already superseded by a newer formulation run) — nothing actually changed, so don't tell
    // the user a plan is ready.
    if (committedPlanId === null) return;

    await saveChatMessage(user_id, 'ai', finalContent, null, personaType);
    await pool.query(
        'INSERT INTO notifications (user_id, notification_type, content, status) VALUES ($1, $2, $3, $4)',
        [user_id, 'nutrition_plan', finalContent, 'pending']
    );
}

// EventBridge-triggered counterpart to handlePostChat's synchronous agentic branch — runs on
// a separate invocation a client disconnect can't cancel (see the chat.generate publish point
// above). Dedupes first (EventBridge is at-least-once delivery, and this pipeline has real
// side effects — chat_messages insert, weight recording, reminder creation), then runs the
// same runAgenticTurn + finalizeChatReply pipeline the synchronous callers use, in its own
// try/catch mirroring handlePostChat's fallback (no outer HTTP try/catch exists here).
//
// payload.kind distinguishes the finishing step: default (unset) is a normal chat turn
// (finalizeChatReply, 'chat_reply' notification); 'formula_dots_generate' makes and commits the
// actual weekly dot allocation instead (finalizeFormulaDotsGenerate, 'nutrition_plan'
// notification) — see _handleFormulaDotsAgentic in handlers/dots.js, which publishes this kind
// with a 'pending' nutrition_plans row already inserted for this event to fill in.
async function handleChatGenerateEvent(payload) {
    const { event_id, user_id, message, intent, llmContext, systemPrompt, cleanHistory, language, personaType, birth_date, kind } = payload;

    const dedupe = await pool.query(
        `INSERT INTO chat_generate_events (event_id) VALUES ($1) ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
        [event_id]
    );
    if (dedupe.rows.length === 0) {
        console.log(JSON.stringify({ level: 'INFO', msg: 'chat_generate_event_duplicate_skipped', event_id, user_id }));
        return;
    }

    const client = getLlmClient();
    const model = process.env.MODEL || 'qwen-plus-latest';
    const user = { birth_date, language };
    const chatMessages = [
        { role: 'system', content: systemPrompt },
        ...cleanHistory,
    ];

    try {
        const agenticResult = await runAgenticTurn({
            client, model, message, intent, llmContext, systemPrompt, cleanHistory,
            pool, user_id, language, personaType,
            logContext: { user_id, intent, handler: 'handleChatGenerateEvent', kind: kind || 'chat' },
            onStatus: makeStatusNotifier(user_id, language),
        });
        if (kind === 'formula_dots_generate') {
            await finalizeFormulaDotsGenerate({
                rawReply: agenticResult.reply,
                extraValidDates: agenticResult.extraValidDates,
                extraValidValues: agenticResult.extraValidValues,
                llmContext, message, user_id, personaType, lang: language,
            });
        } else {
            await finalizeChatReply({
                rawReply: agenticResult.reply,
                extraValidDates: agenticResult.extraValidDates,
                extraValidValues: agenticResult.extraValidValues,
                llmContext, systemPrompt, cleanHistory, chatMessages,
                user, user_id, personaType, sandbox: false, useAgenticLoop: true, client, model,
            });
        }
    } catch (err) {
        console.error('LLM Chat Error (async):', err);
        if (kind === 'formula_dots_generate') {
            // Never leave the pending plan row orphaned or the user with nothing — commit the
            // deterministic fallback formulation directly, same as the publish-failure fail-open
            // path in handlers/dots.js.
            try {
                const fallback = await _runDeterministicFormulation({
                    biomarkers: llmContext.biomarkers,
                    bioageProfile: llmContext.bioage,
                    dotsFormulary: llmContext.dots,
                    personaType, lang: language,
                    currentSolarTerm: llmContext.current_solar_term,
                    essentialKnowledge: llmContext.essential_knowledge,
                    userFacts: llmContext.user_facts,
                });
                const fbClient = await pool.connect();
                let committedPlanId;
                try {
                    await fbClient.query('BEGIN');
                    committedPlanId = await _commitNutritionPlan(fbClient, {
                        userId: user_id, analysis: fallback.analysis,
                        morningRecipe: fallback.morningRecipe, eveningRecipe: fallback.eveningRecipe,
                        planId: llmContext.pending_plan_id, dotsFormulary: llmContext.dots,
                    });
                    await fbClient.query('COMMIT');
                } catch (e) {
                    await fbClient.query('ROLLBACK');
                    throw e;
                } finally {
                    fbClient.release();
                }
                if (committedPlanId !== null) {
                    await saveChatMessage(user_id, 'ai', fallback.finalContent, null, personaType);
                    await pool.query(
                        'INSERT INTO notifications (user_id, notification_type, content, status) VALUES ($1, $2, $3, $4)',
                        [user_id, 'nutrition_plan', fallback.finalContent, 'pending']
                    );
                }
            } catch (fbErr) {
                console.error('Formula dots fallback also failed:', fbErr);
                await pool.query(
                    'INSERT INTO notifications (user_id, notification_type, content, status) VALUES ($1, $2, $3, $4)',
                    [user_id, 'nutrition_plan', "I'm sorry, I'm having trouble generating your dot plan right now. Please try again later.", 'pending']
                );
            }
        } else {
            const fallbackText = "I'm sorry, I'm having trouble connecting to my brain right now. Please try again later.";
            await pool.query(
                'INSERT INTO notifications (user_id, notification_type, content, status) VALUES ($1, $2, $3, $4)',
                [user_id, 'chat_reply', fallbackText, 'pending']
            );
        }
    }
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

// Shared tail for handlePostHealthAdvice's synchronous callers (nano always; viva when
// sandbox, or when the caller didn't opt into async, or when the chat.generate publish
// failed and we fell back to sync). The async/viva/non-sandbox case never reaches this —
// it's finished off by finalizeChatReply inside handleChatGenerateEvent instead, via the
// SAME notification-based delivery /chat already uses.
async function finalizeHealthAdviceReply({ rawReply, extraValidDates, extraValidValues, llmContext, systemPrompt, userMsg, user, user_id, personaType, sandbox, client, model }) {
    // Same grounding check handlePostChat's finalizeChatReply runs, applied here too (not just
    // for the agentic/viva path) — it's a cheap, deterministic, already-proven check (catches
    // the 2026-07-14 stale-data / 2026-07-16 wrong-age bug classes), so there's no reason to
    // scope it to viva only the way the heavier PLAN/JUDGE loop is.
    const hasKnownAge = user.birth_date != null;
    const hasKnownBmi = llmContext.user_profile.bmi != null;
    if (Object.keys(llmContext.biomarkers).length > 0 || hasKnownAge || hasKnownBmi) {
        const groundTruth = {
            validated: {
                ...llmContext.biomarkers,
                ...(hasKnownBmi ? { BMI: llmContext.user_profile.bmi } : {}),
            },
            tested_at: llmContext.biomarkers_tested_at,
            age: hasKnownAge ? llmContext.user_profile.age : null,
            nickname: llmContext.user_profile.nickname,
            extraValidDates,
            extraValidValues,
        };
        const verification = verifyBiomarkerGrounding(rawReply, groundTruth);
        if (!verification.ok) {
            console.log(JSON.stringify({ level: 'WARN', msg: 'biomarker_grounding_mismatch', user_id, handler: 'handlePostHealthAdvice', mismatches: verification.mismatches }));
            const correctionPrompt = `Your previous reply stated biomarker figures, BMI, a test date, and/or the patient's age that do not match their actual record.
Ground truth — test date: ${groundTruth.tested_at || 'unknown'}, values: ${JSON.stringify(groundTruth.validated)}, age: ${groundTruth.age ?? 'unknown'}.
Rewrite your previous reply using ONLY these exact values, this exact date, and this exact age. Keep the same language, tone, and structure otherwise.`;
            try {
                const retryCompletion = await client.chat.completions.create({
                    model,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userMsg },
                        { role: 'assistant', content: rawReply },
                        { role: 'user', content: correctionPrompt },
                    ],
                    temperature: 0.2,
                });
                const retryReply = retryCompletion.choices[0].message.content || rawReply;
                const retryVerification = verifyBiomarkerGrounding(retryReply, groundTruth);
                console.log(JSON.stringify({ level: retryVerification.ok ? 'INFO' : 'WARN', msg: 'biomarker_grounding_retry', user_id, handler: 'handlePostHealthAdvice', ok: retryVerification.ok, mismatches: retryVerification.mismatches }));
                rawReply = retryReply;
            } catch (err) {
                console.log(JSON.stringify({ level: 'WARN', msg: 'biomarker_grounding_retry_failed', user_id, handler: 'handlePostHealthAdvice', error: err.message }));
            }
        }
    }

    if (!sandbox) {
        await saveChatMessage(user_id, 'ai', rawReply, null, personaType);
    }
    return { success: true, message: rawReply, ...(sandbox && { sandbox: true }) };
}

async function handlePostHealthAdvice(body) {
    const { openid, sandbox, async: wantAsyncFlag } = body;
    if (!openid) return { success: false, error: 'openid required', statusCode: 400 };

    try {
        const userResult = await pool.query(
            `SELECT user_id, nickname, gender, birth_date, language, bio_data, channel_id
             FROM users WHERE user_id = $1 OR external_id = $1 LIMIT 1`,
            [openid]
        );
        if (!userResult.rows.length) return { success: false, error: 'User not found', statusCode: 404 };
        const user = userResult.rows[0];
        const user_id = user.user_id;

        let personaType = 'nano';
        if (user.channel_id) {
            try {
                const chResult = await pool.query('SELECT config FROM channels WHERE id = $1', [user.channel_id]);
                personaType = chResult.rows[0]?.config?.persona_type ?? 'nano';
            } catch (_) {}
        }
        const currentSolarTerm = getCurrentSolarTerm(getNowShanghai().toJSDate());
        const essentialKnowledge = await getEssentialBlock(personaType);

        const [bioResult, dotsResult, plansResult, twinResult, factsResult] = await Promise.all([
            pool.query(
                `SELECT bio_age, data, tested_at FROM biomarkers
                 WHERE user_id = $1 AND test_type = 'kino_chip' AND (data->'validated') IS NOT NULL
                 ORDER BY tested_at DESC LIMIT 1`,
                [user_id]
            ),
            pool.query(
                `SELECT id, key_name, key_name_zh, name, name_zh, sub_age_target, description, timing, ingredients, ingredients_zh, target_dots_min, target_dots_max, dosing_protocol, pulse_days_per_cycle, pulse_cycle_days
                 FROM dots ORDER BY id ASC`
            ),
            pool.query(
                `SELECT hp.id, hp.plan_type, hp.start_date, hp.duration_weeks,
                        COALESCE(hpt.name_en, hp.custom_name_en) AS name_en,
                        COALESCE(hpt.name_zh, hp.custom_name_zh) AS name_zh,
                        COALESCE(hpt.goal_en, hp.custom_goal_en) AS goal_en,
                        COALESCE(hpt.goal_zh, hp.custom_goal_zh) AS goal_zh,
                        COALESCE(hpt.target_sub_ages, '{}') AS target_sub_ages,
                        (SELECT COUNT(*) FROM health_plan_checkins WHERE plan_id = hp.id) AS checkin_count,
                        (SELECT COUNT(*) FROM health_plan_milestones WHERE plan_id = hp.id) AS milestones_done
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
            pool.query(
                `SELECT category, fact_zh FROM user_memory_facts WHERE user_id = $1 AND status = 'active' ORDER BY category, last_mentioned_at DESC`,
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

        // Same BMI precedence rule as handlePostChat's llmContext (prefer a real scale/wearable
        // reading over onboarding self-report) — kept in sync so both handlers ground the same
        // user against the same BMI figure.
        const heightCm = user.bio_data?.height;
        const weightKg = healthTwin?.latest_weight_kg ?? user.bio_data?.weight;
        const bmi = healthTwin?.latest_bmi != null
            ? Math.round(healthTwin.latest_bmi * 10) / 10
            : (heightCm && weightKg ? Math.round((weightKg / ((heightCm / 100) ** 2)) * 10) / 10 : null);

        const activeHealthPlansShaped = activePlans.map(p => ({
            plan_type: p.plan_type,
            name: isZh ? p.name_zh : p.name_en,
            goal: isZh ? p.goal_zh : p.goal_en,
            target_sub_ages: p.target_sub_ages || [],
            weeks_elapsed: Math.max(0, Math.floor((Date.now() - new Date(p.start_date).getTime()) / (7 * 86400000))),
            total_weeks: p.duration_weeks,
            checkin_count: parseInt(p.checkin_count || 0, 10),
            milestones_done: parseInt(p.milestones_done || 0, 10),
        }));

        const healthAdviceTemplate = personaType === 'viva' ? vivaSystemHealthAdviceTemplate : systemHealthAdviceTemplate;
        const systemPrompt = healthAdviceTemplate({
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
            current_solar_term: currentSolarTerm,
            active_health_plans: activeHealthPlansShaped,
            plan_templates: planTemplates.map(t => ({
                name: isZh ? t.name_zh : t.name_en,
                goal: isZh ? t.goal_zh : t.goal_en,
                desc: isZh ? t.desc_zh : t.desc_en,
                target_sub_ages: t.target_sub_ages || [],
                duration_weeks: t.duration_weeks,
            })),
            essential_knowledge: essentialKnowledge,
            user_facts: factsResult.rows,
            now_iso: getNowShanghai().toISO(),
        });

        const userMsg = isZh
            ? '请分析我目前的健康状态，并给我专业的健康建议。'
            : 'Please analyze my current health status and give me personalized health advice.';

        // Reshaped to the SAME llmContext contract handlePostChat produces (chat.js §22), so
        // runAgenticTurn, its dedicated tools, and JUDGE — all built against that contract —
        // work here unchanged. `plan`/`questionnaire_context`/`sub_age_display_names` aren't
        // fetched by this handler; left null rather than faked (2026-07-29 scope: Phase A only —
        // these are supplementary/display fields, not correctness-critical for grounding).
        const llmContext = {
            user_profile: { nickname: user.nickname, gender: user.gender, age, bmi, language: user.language },
            biomarkers,
            biomarkers_tested_at: latestBio?.tested_at
                ? formatToShanghai(new Date(latestBio.tested_at)).slice(0, 10)
                : null,
            bioage: bioageProfile || {},
            dots: dotsResult.rows,
            plan: null,
            health_twin: healthTwin,
            now_iso: getNowShanghai().toISO(),
            questionnaire_context: null,
            active_health_plans: activeHealthPlansShaped,
            sub_age_display_names: null,
            current_solar_term: currentSolarTerm,
            essential_knowledge: essentialKnowledge,
            user_facts: factsResult.rows,
        };

        const llmClient = getLlmClient();
        const model = process.env.MODEL || 'qwen-plus-latest';
        const useAgenticLoop = true;

        // Save user trigger to keep conversation history well-formed (no consecutive AI turns) —
        // done here, before the async fork, exactly like handlePostChat: the async event handler
        // (handleChatGenerateEvent) doesn't save the user's own message itself, it's assumed
        // already persisted by the time the event fires.
        if (!sandbox) {
            await saveChatMessage(user_id, 'user', userMsg, null, personaType);
        }

        // Same rationale as handlePostChat's fork (CLAUDE.md §22): the agentic loop can take
        // 60-180s+, and FC cancels the invocation if the client disconnects mid-request. Only
        // the miniapp's own chat tab opts in via body.async — the coach app and the web
        // ChatTab.jsx callers never send it, so they keep getting a synchronous reply exactly as
        // before, unaffected by this change (2026-07-29 scope: async wired for main.js only).
        if (useAgenticLoop && !sandbox && wantAsyncFlag) {
            const eventId = uuidv4();
            try {
                await publishChatGenerateEvent({
                    event_id: eventId, user_id, message: userMsg, intent: 'biomarker_question',
                    llmContext, systemPrompt, cleanHistory: [], language: user.language, personaType,
                    birth_date: user.birth_date,
                });
                return { success: true, user_id, processing: true };
            } catch (ebErr) {
                console.log(JSON.stringify({ level: 'WARN', msg: 'chat_generate_publish_failed_fallback_sync', user_id, handler: 'handlePostHealthAdvice', error: ebErr.message }));
                // Fail open — fall through to the synchronous path below rather than dropping
                // the request just because EventBridge is unavailable.
            }
        }

        let rawReply;
        let extraValidDates = [];
        let extraValidValues = {};
        if (useAgenticLoop) {
            const agenticResult = await runAgenticTurn({
                client: llmClient, model, message: userMsg, intent: 'biomarker_question', llmContext,
                systemPrompt, cleanHistory: [], pool, user_id, language: user.language, personaType,
                logContext: { user_id, intent: 'biomarker_question', handler: 'handlePostHealthAdvice' },
                onStatus: sandbox ? undefined : makeStatusNotifier(user_id, user.language),
            });
            rawReply = agenticResult.reply;
            extraValidDates = agenticResult.extraValidDates;
            extraValidValues = agenticResult.extraValidValues;
        } else {
            const completion = await llmClient.chat.completions.create({
                model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userMsg },
                ],
                temperature: 0.3,
            });
            rawReply = completion.choices[0].message.content;
        }

        return await finalizeHealthAdviceReply({
            rawReply, extraValidDates, extraValidValues, llmContext, systemPrompt, userMsg,
            user, user_id, personaType, sandbox, client: llmClient, model,
        });
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
            `SELECT user_id, nickname, gender, birth_date, language, bio_data FROM users
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
            if (isPlausible) {
                await _syncBodyCompositionTwin(user_id, bodyWeightKg, user.bio_data);
            }

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
    const { openid, category, source, data_date, data, recorded_at, external_id, wearable_name } = body;
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
            INSERT INTO health_events (user_id, source, category, data_date, recorded_at, data, external_id, wearable_name)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (user_id, source, external_id) WHERE external_id IS NOT NULL DO NOTHING
            RETURNING id
        `, [user_id, source, category, data_date, recorded_at, JSON.stringify(data), external_id || null, wearable_name || null]);

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
                INSERT INTO health_events (user_id, source, category, data_date, recorded_at, data, external_id, wearable_name)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT (user_id, source, external_id) WHERE external_id IS NOT NULL
                DO UPDATE SET data = EXCLUDED.data, recorded_at = EXCLUDED.recorded_at, wearable_name = EXCLUDED.wearable_name
                RETURNING id
            `, [user_id, ev.source, ev.category, ev.data_date, ev.recorded_at, JSON.stringify(ev.data), ev.external_id || null, ev.wearable_name || null]);
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
        // 'vitals' bundles several independently-sampled sub-streams (temp, hrv, spo2,
        // resting_hr, realtime — see sync.js's per-slot external_id patterns) sharing
        // one row budget. temp samples more frequently than hrv on Halo, so a low cap
        // here silently crowds hrv/spo2 out of the "most recent N" window even though
        // there's far more headroom needed than a typical single-category query.
        const rowLimit = Math.min(parseInt(limit || '30', 10), 1000);
        params.push(rowLimit);

        const result = await pool.query(
            `SELECT id, source, category, data_date, recorded_at, data, ingested_at, external_id, wearable_name
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
    _fireQuestionnaireAnsweredFollowup,
    handleGetChatHistory,
    handlePostBiomarkers,
    handlePostChat,
    handleChatGenerateEvent,
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
