// A questionnaire's question/answer bubbles are saved under the user's EFFECTIVE persona (§16),
// not the default 'nano' — otherwise a Viva client's 打卡 answers (§42) sit in a history Viva's
// own context never reads. Offline: lib/db stubbed through require.cache.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const WORKER = path.join(__dirname, '..', 'src', 'functions', 'worker');
const stub = (rel, exports) => {
    const full = require.resolve(path.join(WORKER, rel));
    require.cache[full] = { id: full, filename: full, loaded: true, exports };
};

let rows = {};
const pool = {
    query: async (sql) => {
        const flat = sql.replace(/\s+/g, ' ');
        for (const [pattern, value] of Object.entries(rows)) if (new RegExp(pattern).test(flat)) return { rows: value, rowCount: value.length };
        return { rows: [], rowCount: 0 };
    },
};
stub('lib/db', { pool });
const { handlePostQuestionnaireResponse } = require(path.join(WORKER, 'handlers', 'questionnaires.js'));

test('question and answer rows carry the channel-tree persona (viva here), not the nano default', async () => {
    rows = {
        'FROM questionnaire_assignments qa': [{ user_id: 'u-1', questionnaire_id: 16, questionnaire_type: 'program_day' }],
        'FROM questionnaire_questions WHERE id': [{ save_target: null, prompt_zh: '问', prompt_en: 'Q' }],
        'effective_persona_type\\(channel_id\\)': [{ language: 'zh', persona_override_type: null, persona_override_expires_at: null, channel_persona_type: 'viva' }],
        'SELECT COUNT\\(\\*\\) FROM questionnaire_questions': [{ count: '7' }],
        'SELECT COUNT\\(\\*\\) FROM questionnaire_responses': [{ count: '1' }],
    };
    const saved = [];
    const saveChatMessage = async (uid, role, content, image, persona) => { saved.push({ role, content, persona }); return 1; };
    const r = await handlePostQuestionnaireResponse({ assignment_id: 900, question_id: 1, answer: '自己爬上山顶', answer_display: '自己爬上山顶' }, saveChatMessage);
    assert.strictEqual(r.success, true);
    assert.deepStrictEqual(saved.map(s => [s.role, s.persona]), [['ai', 'viva'], ['user', 'viva']]);
});

test('an active per-user override wins over the channel persona, exactly as everywhere else', async () => {
    rows = {
        'FROM questionnaire_assignments qa': [{ user_id: 'u-1', questionnaire_id: 16, questionnaire_type: 'custom' }],
        'FROM questionnaire_questions WHERE id': [{ save_target: null, prompt_zh: '问', prompt_en: 'Q' }],
        'effective_persona_type\\(channel_id\\)': [{ language: 'en', persona_override_type: 'viva', persona_override_expires_at: new Date(Date.now() + 86400000), channel_persona_type: 'nano' }],
        'SELECT COUNT\\(\\*\\) FROM questionnaire_questions': [{ count: '2' }],
        'SELECT COUNT\\(\\*\\) FROM questionnaire_responses': [{ count: '1' }],
    };
    const saved = [];
    await handlePostQuestionnaireResponse({ assignment_id: 901, question_id: 1, answer: 'x' }, async (u, role, c, i, persona) => { saved.push(persona); return 1; });
    assert.deepStrictEqual(saved, ['viva', 'viva']);
});
