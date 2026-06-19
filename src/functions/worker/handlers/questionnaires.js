const { pool } = require('../lib/db');
const OpenAI = require('openai');

const getLlmClient = () => new OpenAI({
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
});

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
// saveChatMessage is passed as a dependency from index.js
async function handlePostQuestionnaireResponse(body, saveChatMessage) {
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
            // Mirror height/weight into bio_data so BioAge calculator and scan gate can read them
            if (answer && (answer.height != null || answer.weight != null)) {
                const bioMirror = {};
                if (answer.height != null) bioMirror.height = answer.height;
                if (answer.weight != null) bioMirror.weight = answer.weight;
                await pool.query(
                    `UPDATE users SET bio_data = bio_data || $1::jsonb, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2`,
                    [JSON.stringify(bioMirror), user_id]
                );
            }
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

async function handleAiFillSku(body) {
    const { sku_code, name_en, name_zh, desc_en, desc_zh, item_type, unit_en, unit_zh } = body || {};
    const systemPrompt = `You are a product catalog assistant for a precision health supplement and wellness platform. Given partial SKU information, fill in all missing fields and translate between Chinese and English as needed.

Return ONLY valid JSON with no markdown fences, no explanation. Use this exact shape:
{
  "name_en": "Product name in English",
  "name_zh": "产品名称（中文）",
  "desc_en": "Short product description in English (1-2 sentences)",
  "desc_zh": "产品简介（中文，1-2句）",
  "item_type": "physical or virtual",
  "unit_en": "e.g. 1 box / 1 session",
  "unit_zh": "例如 1 盒 / 1 次"
}

Rules:
- If a field already has a value, keep it unchanged.
- If name_en exists but name_zh is missing, translate name_en to Chinese for name_zh (and vice versa).
- If desc_en exists but desc_zh is missing, translate to Chinese (and vice versa).
- If both name fields are missing, infer sensible names from the sku_code.
- item_type should be "physical" for tangible goods (supplements, chips, kits) and "virtual" for services or digital access.
- unit_en / unit_zh should describe one purchasable unit concisely.
- Keep descriptions concise and suitable for a wellness product listing.`;

    const userMsg = JSON.stringify({ sku_code, name_en, name_zh, desc_en, desc_zh, item_type, unit_en, unit_zh });
    try {
        const llmClient = getLlmClient();
        const model = process.env.MODEL || 'qwen3.6-plus';
        const completion = await llmClient.chat.completions.create({
            model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMsg },
            ],
        });
        let text = (completion.choices[0].message.content || '').trim();
        text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        let filled;
        try { filled = JSON.parse(text); }
        catch (e) { return { statusCode: 502, success: false, error: 'LLM returned invalid JSON', raw: text.slice(0, 500) }; }
        return { success: true, filled };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handleAiFillSku', error: err.message }));
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

module.exports = {
    getNestedPath,
    formatQuestionnaireContext,
    handleGetPendingQuestionnaires,
    handlePostQuestionnaireResponse,
    handlePatchQuestionnaireAssignment,
    handleGetQuestionnaires,
    handleGenerateQuestionnaire,
    handleAiFillSku,
    handlePostQuestionnaire,
    handlePutQuestionnaire,
    handleDeleteQuestionnaire,
    handleGetQuestionnaireQuestions,
    handlePostQuestionnaireQuestion,
    handlePutQuestionnaireQuestion,
    handleDeleteQuestionnaireQuestion,
    handlePutQuestionnaireQuestionsReorder,
    handlePostQuestionnaireAssignment,
    handleGetQuestionnaireAssignments,
    handleGetQuestionnaireResponses,
};
