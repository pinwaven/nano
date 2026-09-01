// "我要定制营养素" launches the 营养定制 tool instead of being answered with prose.
//
// The classifier gained a `formulate_dots` intent (prompts/chat/intentClassifier.js); this covers
// what handlePostChat does with it:
//
//   1. miniapp  → returns {launch_tool:'formula_dots'}, persists the user's own message, and
//                 never publishes a chat.generate event (no agentic turn is run at all).
//   2. anything else (coach app, web user-app, sandbox "login as") → degrades to a normal
//      nutrition_question turn rather than a silently dropped one. Those clients have the tool
//      but not the plumbing to launch it from a reply, and sandbox must never write a real
//      formulation against the impersonated account.
//
// Runs fully offline: lib/db, the openai SDK and lib/chatEventBridge are stubbed through
// require.cache before handlers/chat.js is loaded.

const assert = require('assert');
const path = require('path');

const WORKER = path.join(__dirname, '..', 'src', 'functions', 'worker');
const stub = (rel, exports) => {
    const full = require.resolve(path.join(WORKER, rel));
    require.cache[full] = { id: full, filename: full, loaded: true, exports };
};

const USER = { user_id: 'u-test', birth_date: null, bio_data: {}, nickname: 'T', language: 'zh', channel_id: 1 };

const queries = [];
const pool = {
    query: async (sql, params) => {
        queries.push({ sql, params });
        if (/FROM users WHERE user_id = \$1/.test(sql)) return { rows: [USER] };
        if (/FROM channels WHERE id = \$1/.test(sql)) return { rows: [{ key_name: 'aeviva', config: {} }] };
        return { rows: [] };
    },
    connect: async () => { throw new Error('not used'); },
};
stub('lib/db', { pool });
stub('lib/chatEventBridge', {
    publishChatGenerateEvent: async (payload) => { published.push(payload); },
});
const published = [];

// The classifier is the only LLM call these paths reach: the miniapp branch returns before any
// generation, and the fallback branch publishes to EventBridge instead of generating inline.
let classifierIntent = 'formulate_dots';
const openaiPath = require.resolve('openai', { paths: [WORKER] });
require.cache[openaiPath] = {
    id: openaiPath, filename: openaiPath, loaded: true,
    exports: class FakeOpenAI {
        constructor() {
            this.chat = {
                completions: {
                    create: async () => ({
                        choices: [{ message: { content: JSON.stringify({ intent: classifierIntent, required_data: [] }) } }],
                    }),
                },
            };
        }
    },
};

process.env.DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY || 'test-key-not-used';
const { handlePostChat } = require(path.join(WORKER, 'handlers', 'chat.js'));

const userMessagesWritten = () => queries.filter(q =>
    /INSERT INTO chat_messages/.test(q.sql) && q.params && q.params[1] === 'user');
const reset = () => { queries.length = 0; published.length = 0; };

let passed = 0;
const check = (name, fn) => { fn(); console.log(`  ok - ${name}`); passed++; };

(async () => {
    console.log('chat launch-formulate-tool');

    reset();
    const mini = await handlePostChat({ openid: USER.user_id, message: '我要定制营养素', client: 'miniapp' });
    check('miniapp is told to launch the tool', () => {
        assert.strictEqual(mini.launch_tool, 'formula_dots');
        assert.strictEqual(mini.success, true);
    });
    check('no agentic turn is published for it', () => assert.strictEqual(published.length, 0));
    check("the user's own message is still persisted", () => {
        const rows = userMessagesWritten();
        assert.strictEqual(rows.length, 1);
        assert.strictEqual(rows[0].params[2], '我要定制营养素');
    });

    reset();
    const web = await handlePostChat({ openid: USER.user_id, message: '我要定制营养素' });
    check('a client that cannot launch a tool is not told to', () => assert.ok(!web.launch_tool));
    check('...and gets a real nutrition turn instead of a dropped one', () => {
        assert.strictEqual(published.length, 1);
        assert.strictEqual(published[0].intent, 'nutrition_question');
    });

    reset();
    const sand = await handlePostChat({ openid: USER.user_id, message: '我要定制营养素', client: 'miniapp', sandbox: true });
    check('sandbox never launches the tool against the impersonated account', () => {
        assert.ok(!sand.launch_tool);
        assert.strictEqual(userMessagesWritten().length, 0);
    });

    reset();
    classifierIntent = 'nutrition_question';
    const ask = await handlePostChat({ openid: USER.user_id, message: '定制营养素是什么？', client: 'miniapp' });
    check('an ordinary nutrition question is unaffected', () => {
        assert.ok(!ask.launch_tool);
        assert.strictEqual(ask.processing, true);
    });

    console.log(`\n${passed} passed`);
})().catch(err => { console.error(err); process.exit(1); });
