// Regression coverage for the async chat-generate delivery guarantees (CLAUDE.md §22):
//
//   1. A turn that overruns DELIVER_DEADLINE_MS still delivers a terminal message, through BOTH
//      channels (notifications + chat_messages). Before the watchdog, the FC platform killed the
//      invocation at 300s with nothing written and the user waited forever.
//   2. Exactly one terminal message per event — the watchdog and a late-finishing generation
//      cannot both post.
//   3. The failure text is localised. It used to be hardcoded English, shown verbatim to zh-only
//      Viva users.
//
// Runs fully offline: lib/db and lib/agenticChat are stubbed through require.cache before
// handlers/chat.js is loaded, so there is no Postgres and no LLM call.

const assert = require('assert');
const path = require('path');

const WORKER = path.join(__dirname, '..', 'src', 'functions', 'worker');
const stub = (rel, exports) => {
    const full = require.resolve(path.join(WORKER, rel));
    require.cache[full] = { id: full, filename: full, loaded: true, exports };
};

const queries = [];
const pool = {
    query: async (sql, params) => {
        queries.push({ sql, params });
        // The dedupe claim must return a row or the handler bails out as a duplicate.
        if (/INSERT INTO chat_generate_events/.test(sql)) return { rows: [{ event_id: params[0] }] };
        return { rows: [] };
    },
    connect: async () => { throw new Error('not used'); },
};

let runAgenticTurn = async () => { throw new Error('not configured'); };

stub('lib/db', { pool });
stub('lib/agenticChat', {
    runAgenticTurn: (...args) => runAgenticTurn(...args),
    extractToolGroundTruth: () => ({ dates: [], values: {} }),
});

process.env.CHAT_DELIVER_DEADLINE_MS = '300';   // 0.3s instead of 250s
// getLlmClient constructs an OpenAI client eagerly; no call is ever made (runAgenticTurn is
// stubbed), it just needs a non-empty key to instantiate.
process.env.DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY || 'test-key-not-used';
const { handleChatGenerateEvent } = require(path.join(WORKER, 'handlers', 'chat.js'));

const basePayload = {
    event_id: 'evt-test-1', user_id: 'u-test', message: 'hi', intent: 'biomarker_question',
    llmContext: {}, systemPrompt: 'sys', cleanHistory: [], personaType: 'viva', birth_date: null,
};

const notificationsWritten = () => queries.filter(q => /INSERT INTO notifications/.test(q.sql));
const chatMessagesWritten = () => queries.filter(q => /INSERT INTO chat_messages/.test(q.sql));
const reset = () => { queries.length = 0; };

let passed = 0;
const check = (name, fn) => { fn(); console.log(`  ok - ${name}`); passed++; };

(async () => {
    // ── 1 + 3: watchdog fires, both channels get the localised timeout text ──────────────
    reset();
    let resolveLate;
    runAgenticTurn = () => new Promise(r => { resolveLate = r; });
    await handleChatGenerateEvent({ ...basePayload, language: 'zh' });

    check('watchdog writes exactly one notification', () => {
        assert.strictEqual(notificationsWritten().length, 1);
        assert.strictEqual(notificationsWritten()[0].params[1], 'chat_reply');
    });
    check('watchdog also writes to chat_messages (the durable channel)', () => {
        assert.strictEqual(chatMessagesWritten().length, 1);
    });
    check('timeout text is Chinese for a zh user', () => {
        const text = notificationsWritten()[0].params[2];
        assert.ok(/没能/.test(text), `expected Chinese timeout text, got: ${text}`);
        assert.ok(!/sorry/i.test(text));
    });
    check('claim is marked done so a redelivery is not treated as still-running', () => {
        assert.ok(queries.some(q => /UPDATE chat_generate_events SET status = 'done'/.test(q.sql)));
    });

    // ── 2: the late finisher must not post a second message ─────────────────────────────
    const notificationsAfterWatchdog = notificationsWritten().length;
    resolveLate({ reply: 'a real reply that arrived too late', extraValidDates: [], extraValidValues: {} });
    await new Promise(r => setTimeout(r, 50));
    check('a generation that finishes after the watchdog posts nothing', () => {
        assert.strictEqual(notificationsWritten().length, notificationsAfterWatchdog);
    });

    // ── 3b: English user gets English ────────────────────────────────────────────────────
    reset();
    runAgenticTurn = () => new Promise(() => {});
    await handleChatGenerateEvent({ ...basePayload, event_id: 'evt-test-2', language: 'en' });
    check('timeout text is English for an en user', () => {
        const text = notificationsWritten()[0].params[2];
        assert.ok(/didn't finish in time/.test(text), `got: ${text}`);
    });

    // ── error path is localised too (it used to be hardcoded English) ────────────────────
    reset();
    runAgenticTurn = async () => { throw new Error('LLM exploded'); };
    await handleChatGenerateEvent({ ...basePayload, event_id: 'evt-test-3', language: 'zh' });
    check('error fallback is localised and delivered on both channels', () => {
        assert.strictEqual(notificationsWritten().length, 1);
        assert.strictEqual(chatMessagesWritten().length, 1);
        const text = notificationsWritten()[0].params[2];
        assert.ok(/抱歉/.test(text), `got: ${text}`);
        assert.ok(!/brain/i.test(text));
    });

    console.log(`\n${passed} checks passed`);
    process.exit(0);
})().catch(e => { console.error('FAILED:', e); process.exit(1); });
