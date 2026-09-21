// A stored miniapp session is only valid against the backend that issued it. Live incident
// 2026-09-19: a phone ran a 预览 build (trial → prod), then 真机调试 (develop → dev); wx.storage
// is shared per appid, so the prod user_id '82ae9e14' was sent to dev, where
// resolveOrUpsertUser() treated the unknown value as a WeChat openid and minted a ghost account
// (c2e34ddf, external_id = the prod id, default channel). Two days of ring syncs and six ECG
// strips landed on the ghost while the header kept showing the cached prod profile.
//
// Two guards, both covered here:
//   server — resolveOrUpsertUser refuses (404 user_not_found) an openid shaped like our own
//            8-hex user_id that matches no row, instead of creating a user for it;
//   client — app.js compares the stored `nano_base` with the current BASE on launch and clears
//            the session on a mismatch; login.js records nano_base at every session write.
//
// Offline: lib/db is stubbed through require.cache before handlers/chat.js loads.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const WORKER = path.join(ROOT, 'src', 'functions', 'worker');
const MINI = path.join(ROOT, 'src', 'mini', 'nano-miniapp');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

const stub = (rel, exports) => {
    const full = require.resolve(path.join(WORKER, rel));
    require.cache[full] = { id: full, filename: full, loaded: true, exports };
};

const queries = [];
let usersById = {};
const pool = {
    query: async (sql, params) => {
        queries.push({ sql, params });
        if (/FROM users WHERE user_id = \$1/.test(sql)) {
            const row = usersById[params[0]];
            return { rows: row ? [row] : [] };
        }
        if (/INSERT INTO users/.test(sql)) {
            return { rows: [{ user_id: params[0], channel_id: 1, inserted: false }] };
        }
        return { rows: [] };
    },
    connect: async () => { throw new Error('not used'); },
};
stub('lib/db', { pool });
stub('lib/agenticChat', { runAgenticTurn: async () => { throw new Error('not used'); }, extractToolGroundTruth: () => ({ dates: [], values: {} }) });
process.env.DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY || 'test-key-not-used';

const { resolveOrUpsertUser } = require(path.join(WORKER, 'handlers', 'chat.js'));
const inserts = () => queries.filter(q => /INSERT INTO users/.test(q.sql));

test('server: a user_id-shaped openid that matches no row is refused, never created', async () => {
    queries.length = 0; usersById = {};
    await assert.rejects(resolveOrUpsertUser({ openid: '82ae9e14' }), (err) => {
        assert.strictEqual(err.statusCode, 404);
        assert.strictEqual(err.reason, 'user_not_found');
        return true;
    });
    assert.strictEqual(inserts().length, 0, 'must not INSERT a ghost user');
});

test('server: a user_id-shaped openid that exists resolves to that row (admin/simulator users)', async () => {
    queries.length = 0; usersById = { c40d46a4: { user_id: 'c40d46a4', channel_id: 2 } };
    const row = await resolveOrUpsertUser({ openid: 'c40d46a4' });
    assert.strictEqual(row.user_id, 'c40d46a4');
    assert.strictEqual(inserts().length, 0);
});

test('server: a real WeChat openid still takes the upsert path', async () => {
    queries.length = 0; usersById = {};
    const row = await resolveOrUpsertUser({ openid: 'oKMLC66FU08LpRr9s_WyIt1hRpG0', language: 'zh' });
    assert.ok(row.user_id);
    assert.strictEqual(inserts().length, 1);
    assert.strictEqual(inserts()[0].params[1], 'oKMLC66FU08LpRr9s_WyIt1hRpG0', 'external_id is the openid');
});

test('server: the worker maps a thrown statusCode to the HTTP status instead of a blanket 500', () => {
    const index = read(WORKER, 'index.js');
    assert.match(index, /const errStatus = Number\.isInteger\(error\.statusCode\) \? error\.statusCode : 500;/);
    assert.match(index, /statusCode: errStatus,/);
    assert.match(index, /resp\.setStatusCode\(errStatus\);/);
});

test('client: app.js clears a session issued by a different backend on launch', () => {
    const app = read(MINI, 'app.js');
    assert.match(app, /require\('\.\/utils\/config\.js'\)/, 'app.js must read BASE/ENV_VERSION from config');
    assert.match(app, /const storedBase = wx\.getStorageSync\('nano_base'\)/);
    assert.match(app, /if \(storedBase !== BASE\)/);
    for (const k of ['nano_user', 'nano_channel', 'nano_coach', 'nano_last_session']) {
        assert.ok(app.includes(`'${k}'`), `mismatch must clear ${k}`);
    }
    // The clear runs BEFORE the session is read, or the stale user is restored anyway.
    assert.ok(app.indexOf("wx.getStorageSync('nano_base')") < app.indexOf("const user = wx.getStorageSync('nano_user')"));
    assert.match(read(MINI, 'utils', 'config.js'), /ENV_VERSION: envVersion/);
});

test('client: every session write in login.js records the issuing backend', () => {
    const login = read(MINI, 'pages', 'login', 'login.js');
    const writes = login.split('\n').filter(l => /wx\.setStorageSync\('nano_user'/.test(l)).length;
    const marks = login.split('\n').filter(l => /wx\.setStorageSync\('nano_base', BASE\)/.test(l)).length;
    assert.ok(writes >= 3, `expected the three login-time session writes, found ${writes}`);
    assert.strictEqual(marks, writes, 'each nano_user write in login.js needs a matching nano_base write');
});
