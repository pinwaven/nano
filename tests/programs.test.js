// 打卡 programs (CLAUDE.md §42): the offer rule, the recap template, the day-completion
// transitions and the two chat deliveries. Runs fully offline — lib/db, handlers/chat, the
// knowledge base and the openai SDK are stubbed through require.cache, the same way
// tests/doc-extraction-queue.test.js does it.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const WORKER = path.join(__dirname, '..', 'src', 'functions', 'worker');
const stub = (rel, exports) => {
    const full = require.resolve(path.join(WORKER, rel));
    require.cache[full] = { id: full, filename: full, loaded: true, exports };
};

// ── the fake pool: regex-keyed rows, every statement recorded ────────────────────────────
let queries = [];
let rows = {};
// Patterns match against whitespace-normalised SQL so a multi-line statement reads as one line.
const run = async (sql, params) => {
    const flat = sql.replace(/\s+/g, ' ').trim();
    queries.push({ sql: flat, params });
    for (const [pattern, value] of Object.entries(rows)) {
        if (new RegExp(pattern).test(flat)) {
            const r = typeof value === 'function' ? value(params, flat) : value;
            return { rows: r, rowCount: r.length };
        }
    }
    return { rows: [], rowCount: 0 };
};
const client = { query: run, release: () => { released++; } };
let released = 0;
const pool = { query: run, connect: async () => client };
stub('lib/db', { pool });

let saved = [];
let delivered = [];
stub('handlers/chat', {
    saveChatMessage: async (uid, role, content, image, persona) => { saved.push({ uid, role, content, persona }); return 1; },
    deliverTerminalMessage: async (uid, persona, type, text) => { delivered.push({ uid, persona, type, text }); return { notification_id: 1, chat_message_id: 2 }; },
});
stub('lib/knowledgeBase', { getEssentialBlock: async () => 'ESSENTIAL', findRelevantEntries: async () => [], FALLBACK_ESSENTIAL_BLOCK: 'ESSENTIAL' });
stub('lib/oss', { generatePresignedGetUrl: (key) => `https://oss.example/${key}?sig` });

let llmReply = '看到饱胀感从 7 降到 4，饭后走一走真的有用。';
let llmThrows = false;
const openaiPath = require.resolve('openai', { paths: [WORKER] });
require.cache[openaiPath] = {
    id: openaiPath, filename: openaiPath, loaded: true,
    exports: class FakeOpenAI {
        constructor() {
            this.chat = { completions: { create: async () => {
                if (llmThrows) throw new Error('llm down');
                return { choices: [{ message: { content: llmReply } }] };
            } } };
        }
    },
};
process.env.DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY || 'test-key-not-used';

const lib = require(path.join(WORKER, 'lib', 'programs.js'));
const handlers = require(path.join(WORKER, 'handlers', 'programs.js'));
const { validateAgQuestions } = require(path.join(WORKER, 'lib', 'agQuestionnaire.js'));

function reset(extra = {}) {
    queries = []; saved = []; delivered = []; released = 0; llmThrows = false;
    rows = {
        'FROM users u LEFT JOIN channels c': [{ user_id: 'u-1', nickname: '小李', language: 'zh', channel_persona_type: 'viva', persona_override_type: null, persona_override_expires_at: null }],
        ...extra,
    };
}
const sqlOf = (re) => queries.filter(q => re.test(q.sql));

// ── renderSummaryTemplate ───────────────────────────────────────────────────────────────

const DAY1_TEMPLATE = '**Day 1完成**\n我的十年生命能力：{{ten_year_ability}}\n用餐时间：{{meal_time}}\n步行时间：{{walk_time}}\n饱胀感：{{fullness.before}} → {{fullness.after}}\n精力状态：{{energy.before}} → {{energy.after}}\n身体舒适度：{{comfort.before}} → {{comfort.after}}\n今天最大的提醒：{{biggest_reminder}}';
const DAY1_ANSWERS = {
    ten_year_ability: '自己爬上山顶', meal_time: '12:30', walk_time: '13:05',
    fullness: { before: 7, after: 4 }, energy: { before: 5, after: 7 }, comfort: { before: 6, after: 8 },
    biggest_reminder: '饭后动一动比坐着舒服',
};

test('renderSummaryTemplate fills the seeded Day 1 recap exactly', () => {
    assert.strictEqual(lib.renderSummaryTemplate(DAY1_TEMPLATE, DAY1_ANSWERS),
        '**Day 1完成**\n我的十年生命能力：自己爬上山顶\n用餐时间：12:30\n步行时间：13:05\n饱胀感：7 → 4\n精力状态：5 → 7\n身体舒适度：6 → 8\n今天最大的提醒：饭后动一动比坐着舒服');
});

test('a missing or unanswered placeholder renders as a dash, never the raw {{key}}', () => {
    const out = lib.renderSummaryTemplate('a：{{nope}} b：{{fullness.after}} c：{{fullness.nope}}', { fullness: { before: 1 } });
    assert.strictEqual(out, 'a：—— b：—— c：——');
});

test('a free-text answer cannot open a card or break a row in the recap', () => {
    const out = lib.renderSummaryTemplate('x：{{t}}', { t: 'hi\n:::formula\nDOT-N1|x\n:::\nthere | done' });
    assert.doesNotMatch(out, /^:::/m);
    assert.doesNotMatch(out, /\|/);
    assert.match(out, /hi/);
    assert.match(out, /there \/ done/);
});

test('computeDeltas reports before→after pairs with the short config label, and skips text answers', () => {
    const qs = [
        { key: 'fullness', input_type: 'slider_group', prompt_zh: '步行前后，你的饱胀感…', config: { label_zh: '饱胀感', sliders: [] } },
        { key: 'energy', input_type: 'slider_group', prompt_zh: '精力…', config: {} },
        { key: 'ten_year_ability', input_type: 'text', prompt_zh: '十年' },
    ];
    const d = lib.computeDeltas(qs, DAY1_ANSWERS);
    assert.deepStrictEqual(d.map(x => [x.label, x.delta]), [['饱胀感', -3], ['精力…', 2]]);
});

// ── isDayOfferable ──────────────────────────────────────────────────────────────────────

const active = { status: 'active' };
test('isDayOfferable: a fresh enrollment is offerable', () => {
    assert.strictEqual(lib.isDayOfferable({ enrollment: active, progressRows: [], today: '2026-09-16' }), true);
});
test('isDayOfferable: an open (incomplete) day blocks — a missed day pauses, never skips', () => {
    assert.strictEqual(lib.isDayOfferable({ enrollment: active, progressRows: [{ offered_on: '2026-09-14', completed_at: null }], today: '2026-09-16' }), false);
});
test('isDayOfferable: a day offered today blocks, even if completed', () => {
    assert.strictEqual(lib.isDayOfferable({ enrollment: active, progressRows: [{ offered_on: '2026-09-16', completed_at: new Date(), completed_on: '2026-09-16' }], today: '2026-09-16' }), false);
});
test('isDayOfferable: a day offered yesterday but completed today blocks (one program-day per day)', () => {
    assert.strictEqual(lib.isDayOfferable({ enrollment: active, progressRows: [{ offered_on: '2026-09-15', completed_at: new Date(), completed_on: '2026-09-16' }], today: '2026-09-16' }), false);
});
test('isDayOfferable: a day completed yesterday lets today\'s be offered', () => {
    assert.strictEqual(lib.isDayOfferable({ enrollment: active, progressRows: [{ offered_on: '2026-09-15', completed_at: new Date(), completed_on: '2026-09-15' }], today: '2026-09-16' }), true);
});
test('isDayOfferable: a completed or paused enrollment is never offered', () => {
    assert.strictEqual(lib.isDayOfferable({ enrollment: { status: 'completed' }, progressRows: [], today: '2026-09-16' }), false);
    assert.strictEqual(lib.isDayOfferable({ enrollment: { status: 'paused' }, progressRows: [], today: '2026-09-16' }), false);
});

// ── buildProgramDayCard ─────────────────────────────────────────────────────────────────

test('the card is intro + :::lesson + :::checkin, ids numeric, titles pipe-safe', () => {
    const md = lib.buildProgramDayCard({
        program: { id: 3 },
        day: { day_index: 1, intro_md_zh: '**Day 1**\n\n今天三件事', lesson_id: 12, checkin_label_zh: '开始打卡' },
        lesson: { title: 'A | B' }, lang: 'zh',
    });
    assert.strictEqual(md, '**Day 1**\n\n今天三件事\n\n:::lesson\n12|A / B\n:::\n\n:::checkin\n3|1|开始打卡\n:::');
});
test('a day with no lesson has no :::lesson block and a title-derived intro', () => {
    const md = lib.buildProgramDayCard({ program: { id: 3 }, day: { day_index: 2, title_zh: '第二天', lesson_id: null }, lesson: null, lang: 'zh' });
    assert.strictEqual(md, '**Day 2 · 第二天**\n\n:::checkin\n3|2|开始打卡\n:::');
});

// ── handleProgramDayEvent ───────────────────────────────────────────────────────────────

const ENROLL = { id: 9, status: 'active', current_day: 1, program_id: 3, key_name: 'viva_7day_v1', title_zh: '7天', duration_days: 7, program_status: 'active', today: '2026-09-16' };
const DAY1 = { id: 31, program_id: 3, day_index: 1, title_zh: 'Day 1', intro_md_zh: 'intro', lesson_id: 12, lesson_title: '课一', questionnaire_id: 55, checkin_label_zh: '开始打卡' };

test('handleProgramDayEvent: losing the slot claim does no further work', async () => {
    reset({ 'INSERT INTO notifications': [] });
    await handlers.handleProgramDayEvent({ user_id: 'u-1', program_id: 3, persona_type: 'viva' });
    assert.strictEqual(queries.length, 1);
    assert.strictEqual(saved.length, 0);
});

test('handleProgramDayEvent: winning the claim writes the progress row, saves the card and flips the row to pending — never enrolls', async () => {
    reset({
        'INSERT INTO notifications': [{ id: 77 }],
        'FROM program_enrollments e JOIN programs p': [ENROLL],
        'FROM program_day_progress WHERE enrollment_id': [],
        'FROM program_days d LEFT JOIN academy_lessons': [DAY1],
        'INSERT INTO program_day_progress': [{ id: 500 }],
    });
    const r = await handlers.handleProgramDayEvent({ user_id: 'u-1', program_id: 3, persona_type: 'viva' });
    assert.deepStrictEqual(r, { delivered: true, day_index: 1 });
    assert.strictEqual(sqlOf(/^INSERT INTO program_enrollments/).length, 0, 'the event never creates an enrollment — only a coach does');
    const ins = sqlOf(/^INSERT INTO program_day_progress/)[0];
    assert.ok(ins, 'progress row inserted');
    assert.deepStrictEqual(ins.params.slice(0, 3), [9, 1, 77]);
    assert.ok(sqlOf(/^COMMIT/).length === 1 && sqlOf(/^ROLLBACK/).length === 0);
    assert.strictEqual(released, 1, 'pool client released');
    assert.strictEqual(saved.length, 1);
    assert.strictEqual(saved[0].persona, 'viva');
    assert.match(saved[0].content, /:::lesson\n12\|课一\n:::/);
    assert.match(saved[0].content, /:::checkin\n3\|1\|开始打卡\n:::/);
    const flip = sqlOf(/UPDATE notifications SET content = \$1, status = 'pending'/)[0];
    assert.ok(flip);
    assert.strictEqual(flip.params[0], saved[0].content, 'the chat row and the notification carry the same text (AI_ECHO de-dup)');
    assert.strictEqual(flip.params[1], 77);
});

test('handleProgramDayEvent: a day with no lesson delivers a card with no :::lesson block', async () => {
    reset({
        'INSERT INTO notifications': [{ id: 78 }],
        'FROM program_enrollments e JOIN programs p': [{ ...ENROLL, current_day: 2 }],
        'FROM program_day_progress WHERE enrollment_id': [{ day_index: 1, offered_on: '2026-09-15', completed_at: new Date(), completed_on: '2026-09-15' }],
        'FROM program_days d LEFT JOIN academy_lessons': [{ ...DAY1, day_index: 2, lesson_id: null, lesson_title: null, intro_md_zh: null, title_zh: '第二天' }],
        'INSERT INTO program_day_progress': [{ id: 501 }],
    });
    await handlers.handleProgramDayEvent({ user_id: 'u-1', program_id: 3 });
    assert.strictEqual(saved.length, 1);
    assert.doesNotMatch(saved[0].content, /:::lesson/);
    assert.match(saved[0].content, /:::checkin\n3\|2\|/);
});

test('handleProgramDayEvent: not offerable on the in-transaction re-check → rollback, slot failed, nothing delivered', async () => {
    reset({
        'INSERT INTO notifications': [{ id: 79 }],
        'FROM program_enrollments e JOIN programs p': [ENROLL],
        'FROM program_day_progress WHERE enrollment_id': [{ day_index: 1, offered_on: '2026-09-15', completed_at: null }],
    });
    await handlers.handleProgramDayEvent({ user_id: 'u-1', program_id: 3 });
    assert.strictEqual(saved.length, 0);
    assert.strictEqual(sqlOf(/^ROLLBACK/).length, 1);
    assert.strictEqual(released, 1);
    assert.ok(sqlOf(/UPDATE notifications SET status = 'failed'/).length === 1);
});

test('handleProgramDayEvent: a user with no enrollment gets nothing and the slot is marked failed', async () => {
    reset({ 'INSERT INTO notifications': [{ id: 81 }] });   // no enrollment row
    const r = await handlers.handleProgramDayEvent({ user_id: 'u-9', program_id: 3 });
    assert.deepStrictEqual(r, { delivered: false, reason: 'not_enrolled' });
    assert.strictEqual(saved.length, 0);
    assert.ok(sqlOf(/UPDATE notifications SET status = 'failed'/).length === 1);
});

test('handleProgramDayEvent: any failure after the claim marks the slot failed, never leaves it claiming', async () => {
    reset({
        'INSERT INTO notifications': [{ id: 80 }],
        'FROM program_enrollments e JOIN programs p': [ENROLL],
        'FROM program_day_progress WHERE enrollment_id': [],
        'FROM program_days d LEFT JOIN academy_lessons': [],   // day row missing
    });
    await handlers.handleProgramDayEvent({ user_id: 'u-1', program_id: 3 });
    assert.strictEqual(saved.length, 0);
    assert.ok(sqlOf(/UPDATE notifications SET status = 'failed'/).length === 1);
    assert.strictEqual(released, 1);
});

// ── completeProgramDayCheckin ───────────────────────────────────────────────────────────

const CTX = {
    progress_id: 500, day_index: 1, user_id: 'u-1', program_id: 3, duration_days: 7, title_zh: '7天生命能力打卡',
    lesson_id: 12, day_title_zh: 'Day 1', summary_template_zh: DAY1_TEMPLATE, questionnaire_id: 55, lesson_completed_at: null,
};
const RESPONSES = [
    { key: 'ten_year_ability', input_type: 'text', prompt_zh: '十年', sort_order: 0, answer: DAY1_ANSWERS.ten_year_ability },
    { key: 'meal_time', input_type: 'time_picker', prompt_zh: '用餐', sort_order: 1, answer: '12:30' },
    { key: 'walk_time', input_type: 'time_picker', prompt_zh: '步行', sort_order: 2, answer: '13:05' },
    { key: 'fullness', input_type: 'slider_group', prompt_zh: '饱胀', sort_order: 3, config: { label_zh: '饱胀感' }, answer: DAY1_ANSWERS.fullness },
    { key: 'energy', input_type: 'slider_group', prompt_zh: '精力', sort_order: 4, config: { label_zh: '精力状态' }, answer: DAY1_ANSWERS.energy },
    { key: 'comfort', input_type: 'slider_group', prompt_zh: '舒适', sort_order: 5, config: { label_zh: '身体舒适度' }, answer: DAY1_ANSWERS.comfort },
    { key: 'biggest_reminder', input_type: 'text', prompt_zh: '提醒', sort_order: 6, answer: DAY1_ANSWERS.biggest_reminder },
];

test('completeProgramDayCheckin: delivers the recap then the comment, and closes the day when the lesson is done', async () => {
    reset({
        'WHERE dp.questionnaire_assignment_id = \\$1': [{ ...CTX, lesson_completed_at: new Date() }],
        'FROM questionnaire_responses r': RESPONSES,
        'SET checkin_completed_at = NOW\\(\\), summary = \\$1': [{ id: 500 }],
        'UPDATE program_day_progress dp SET completed_at = NOW': [{ enrollment_id: 9, day_index: 1 }],
        'UPDATE program_enrollments e SET current_day': [{ status: 'active' }],
    });
    const r = await handlers.completeProgramDayCheckin(900);
    assert.deepStrictEqual(delivered.map(d => d.type), ['program_day_summary', 'program_day_comment']);
    assert.strictEqual(delivered[0].persona, 'viva');
    assert.strictEqual(delivered[0].text, lib.renderSummaryTemplate(DAY1_TEMPLATE, DAY1_ANSWERS));
    assert.strictEqual(delivered[1].text, llmReply);
    assert.deepStrictEqual(r, { ok: true, completed: true, programCompleted: false });
    const adv = sqlOf(/UPDATE program_enrollments e SET current_day/)[0];
    assert.deepStrictEqual(adv.params, [9, 1]);
});

test('completeProgramDayCheckin: an LLM failure still leaves the recap delivered', async () => {
    reset({
        'WHERE dp.questionnaire_assignment_id = \\$1': [CTX],
        'FROM questionnaire_responses r': RESPONSES,
        'SET checkin_completed_at = NOW\\(\\), summary = \\$1': [{ id: 500 }],
    });
    llmThrows = true;
    const r = await handlers.completeProgramDayCheckin(900);
    assert.deepStrictEqual(delivered.map(d => d.type), ['program_day_summary']);
    // lesson_id set and not watched → the day stays open
    assert.deepStrictEqual(r, { ok: true, completed: false, programCompleted: false });
});

test('completeProgramDayCheckin: a second completion for the same assignment is a no-op (nothing re-delivered)', async () => {
    reset({
        'WHERE dp.questionnaire_assignment_id = \\$1': [CTX],
        'FROM questionnaire_responses r': RESPONSES,
        'SET checkin_completed_at = NOW\\(\\), summary = \\$1': [],   // already stamped
    });
    const r = await handlers.completeProgramDayCheckin(900);
    assert.deepStrictEqual(r, { ok: true, duplicate: true });
    assert.strictEqual(delivered.length, 0);
});

test('completeProgramDayCheckin: a program_day questionnaire with no progress row (hand-assigned) no-ops', async () => {
    reset({ 'WHERE dp.questionnaire_assignment_id = \\$1': [] });
    const r = await handlers.completeProgramDayCheckin(901);
    assert.deepStrictEqual(r, { ok: false, reason: 'no_progress_row' });
    assert.strictEqual(delivered.length, 0);
});

// ── tryCompleteDay / markLessonWatched ──────────────────────────────────────────────────

test('tryCompleteDay: the last day flips the enrollment to completed', async () => {
    reset({
        'UPDATE program_day_progress dp SET completed_at = NOW': [{ enrollment_id: 9, day_index: 7 }],
        'UPDATE program_enrollments e SET current_day': [{ status: 'completed' }],
    });
    assert.deepStrictEqual(await lib.tryCompleteDay(null, 507), { completed: true, programCompleted: true });
});

test('tryCompleteDay: nothing to close (lesson still unwatched) advances nothing', async () => {
    reset({ 'UPDATE program_day_progress dp SET completed_at = NOW': [] });
    assert.deepStrictEqual(await lib.tryCompleteDay(null, 500), { completed: false, programCompleted: false });
    assert.strictEqual(sqlOf(/UPDATE program_enrollments/).length, 0);
});

test('markLessonWatched stamps every open day built on the lesson and tries to close each', async () => {
    reset({
        'SET lesson_completed_at = NOW': [{ id: 500 }],
        'UPDATE program_day_progress dp SET completed_at = NOW': [{ enrollment_id: 9, day_index: 1 }],
        'UPDATE program_enrollments e SET current_day': [{ status: 'active' }],
    });
    const r = await lib.markLessonWatched('u-1', 12);
    assert.deepStrictEqual(r, [{ progress_id: 500, completed: true, programCompleted: false }]);
    assert.deepStrictEqual(sqlOf(/SET lesson_completed_at = NOW/)[0].params, ['u-1', 12]);
});

// ── start-checkin ───────────────────────────────────────────────────────────────────────

test('start-checkin creates the assignment lazily, once, and links it to the progress row', async () => {
    reset({
        'FROM program_day_progress dp JOIN program_enrollments e': [{ id: 500, questionnaire_assignment_id: null, checkin_completed_at: null, completed_at: null, questionnaire_id: 55 }],
        'INSERT INTO questionnaire_assignments': [{ id: 900 }],
    });
    const r = await handlers.handlePostProgramDayStartCheckin({ openid: 'u-1', program_id: 3, day_index: 1 });
    assert.deepStrictEqual(r, { success: true, assignment_id: 900 });
    assert.deepStrictEqual(sqlOf(/INSERT INTO questionnaire_assignments/)[0].params, [55, 'u-1']);
    assert.deepStrictEqual(sqlOf(/SET questionnaire_assignment_id = \$1/)[0].params, [900, 500]);
    assert.strictEqual(released, 1);
});

test('start-checkin returns the existing assignment instead of creating a second one', async () => {
    reset({ 'FROM program_day_progress dp JOIN program_enrollments e': [{ id: 500, questionnaire_assignment_id: 900, checkin_completed_at: null, questionnaire_id: 55 }] });
    const r = await handlers.handlePostProgramDayStartCheckin({ openid: 'u-1', program_id: 3, day_index: 1 });
    assert.deepStrictEqual(r, { success: true, assignment_id: 900, already: true });
    assert.strictEqual(sqlOf(/INSERT INTO questionnaire_assignments/).length, 0);
});

test('start-checkin on a day never offered to this user is a 404 — the openid scopes the lookup', async () => {
    reset();
    const r = await handlers.handlePostProgramDayStartCheckin({ openid: 'u-2', program_id: 3, day_index: 1 });
    assert.strictEqual(r.statusCode, 404);
    assert.ok(sqlOf(/FROM program_day_progress dp JOIN program_enrollments e/)[0].params.includes('u-2'));
});

// ── time_picker in the shared validator ─────────────────────────────────────────────────

test('validateAgQuestions accepts time_picker with HH:mm bounds and rejects malformed ones', () => {
    const ok = validateAgQuestions([{ key: 'meal_time', input_type: 'time_picker', prompt_zh: '用餐时间？', config: { default: '12:30', start: '05:00' } }]);
    assert.strictEqual(ok.ok, true);
    assert.deepStrictEqual(ok.questions[0].config, { default: '12:30', start: '05:00' });
    const bad = validateAgQuestions([{ key: 'meal_time', input_type: 'time_picker', prompt_zh: '用餐时间？', config: { default: '25:99' } }]);
    assert.strictEqual(bad.ok, false);
    assert.strictEqual(bad.violations[0].code, 'invalid_time_bound');
});

// ── coach activation ────────────────────────────────────────────────────────────────────

const OWNED = [{ user_id: 'u-1', channel_id: 2, nickname: '小李' }];
const PROGRAM3 = [{ id: 3, key_name: 'viva_7day_v1', title_zh: '7天', duration_days: 7 }];

test('enroll: a coach who does not manage the client is refused before anything is read', async () => {
    reset();   // the ownership SELECT returns nothing
    const r = await handlers.handlePostProgramEnroll({ coach_id: 5, openid: 'u-2', program_id: 3 });
    assert.strictEqual(r.statusCode, 403);
    assert.strictEqual(sqlOf(/INSERT INTO program_enrollments/).length, 0);
});

test('enroll: creates the enrollment stamped with the coach and delivers Day 1 inline', async () => {
    reset({
        'FROM users WHERE user_id = \\$1 AND coach_id = \\$2': OWNED,
        'WITH RECURSIVE up AS': PROGRAM3,
        'SELECT id, status FROM program_enrollments': [],
        'INSERT INTO notifications': [{ id: 90 }],
        'FROM program_enrollments e JOIN programs p': [ENROLL],
        'FROM program_day_progress WHERE enrollment_id': [],
        'FROM program_days d LEFT JOIN academy_lessons': [DAY1],
        'INSERT INTO program_day_progress': [{ id: 600 }],
    });
    const r = await handlers.handlePostProgramEnroll({ coach_id: 5, openid: 'u-1', program_id: 3 });
    assert.deepStrictEqual(r, { success: true, resumed: false, delivery: { delivered: true, day_index: 1 } });
    const ins = sqlOf(/INSERT INTO program_enrollments/)[0];
    assert.deepStrictEqual(ins.params, ['u-1', 3, 5]);
    assert.strictEqual(saved.length, 1, 'Day 1 card saved during activation');
    assert.match(saved[0].content, /:::checkin\n3\|1\|/);
});

test('enroll: a program not available to the client\'s channel tree is refused', async () => {
    reset({ 'FROM users WHERE user_id = \\$1 AND coach_id = \\$2': OWNED, 'WITH RECURSIVE up AS': [] });
    const r = await handlers.handlePostProgramEnroll({ coach_id: 5, openid: 'u-1', program_id: 3 });
    assert.strictEqual(r.statusCode, 404);
});

test('enroll: a completed enrollment is refused; a paused one is resumed', async () => {
    reset({ 'FROM users WHERE user_id = \\$1 AND coach_id = \\$2': OWNED, 'WITH RECURSIVE up AS': PROGRAM3,
        'SELECT id, status FROM program_enrollments': [{ id: 9, status: 'completed' }] });
    assert.strictEqual((await handlers.handlePostProgramEnroll({ coach_id: 5, openid: 'u-1', program_id: 3 })).statusCode, 409);

    reset({ 'FROM users WHERE user_id = \\$1 AND coach_id = \\$2': OWNED, 'WITH RECURSIVE up AS': PROGRAM3,
        'SELECT id, status FROM program_enrollments': [{ id: 9, status: 'paused' }],
        'INSERT INTO notifications': [] });   // day already claimed today → nothing delivered, still resumed
    const r = await handlers.handlePostProgramEnroll({ coach_id: 5, openid: 'u-1', program_id: 3 });
    assert.deepStrictEqual(r, { success: true, resumed: true, delivery: { delivered: false, reason: 'already_claimed_today' } });
    assert.ok(sqlOf(/UPDATE program_enrollments SET status = 'active'/).length === 1);
});

test('pause/resume: scoped by ownership; only active/paused rows change', async () => {
    reset({ 'FROM users WHERE user_id = \\$1 AND coach_id = \\$2': OWNED, "SET status = \\$3 WHERE user_id": [{ id: 9, status: 'paused' }] });
    const r = await handlers.handlePutProgramEnrollment({ coach_id: 5, openid: 'u-1', program_id: 3, status: 'paused' });
    assert.deepStrictEqual(r, { success: true, status: 'paused' });
    assert.strictEqual((await handlers.handlePutProgramEnrollment({ coach_id: 5, openid: 'u-1', program_id: 3, status: 'bogus' })).statusCode, 400);
});

test('coach list: programs of the channel tree with the client\'s enrollment attached', async () => {
    reset({ 'FROM users WHERE user_id = \\$1 AND coach_id = \\$2': OWNED, 'WITH RECURSIVE up AS': PROGRAM3,
        'FROM program_enrollments e WHERE e.user_id': [{ program_id: 3, status: 'active', current_day: 2, started_on: '2026-09-16', days_completed: 1, open_day: null }] });
    const r = await handlers.handleGetCoachPrograms({ coach_id: 5, openid: 'u-1' });
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.programs[0].enrollment.days_completed, 1);
    assert.deepStrictEqual(sqlOf(/WITH RECURSIVE up AS/)[0].params, [2], 'walks the tree from the client\'s own channel');
});
