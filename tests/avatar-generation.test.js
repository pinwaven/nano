// Custom avatar generation (docs/architecture/avatar-gallery.md §6): the pipeline in
// lib/avatarGen.js over stubbed clients, the handler's refusals, and the static couplings that
// nothing checks at runtime (routes, the event branch, avatar_moods on every self-row select).
// Fully offline — lib/db, lib/oss and the event bridge are stubbed via require.cache.
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

// ---- stubs ---------------------------------------------------------------------------------------

let queries = [];
let rows = {};
const pool = {
    query: async (sql, params) => {
        queries.push({ sql, params });
        for (const [pattern, value] of Object.entries(rows)) {
            if (new RegExp(pattern).test(sql)) {
                const r = typeof value === 'function' ? value(params) : value;
                if (r instanceof Error) throw r;
                return { rows: r, rowCount: r.length };
            }
        }
        return { rows: [], rowCount: 0 };
    },
};
stub('lib/db', { pool });

let ossObjects = {};
let ossLog = [];
const ossLib = {
    generatePresignedPutUrl: (key) => `https://put/${key}`,
    generatePresignedGetUrl: (key, exp) => `https://get/${key}?exp=${exp}`,
    headObject: async (key) => (ossObjects[key] ? { etag: 'e', size_bytes: ossObjects[key].length, content_type: 'image/jpeg' } : null),
    deleteObject: async (key) => { ossLog.push(['delete', key]); delete ossObjects[key]; },
    getObjectBuffer: async (key) => { if (!ossObjects[key]) throw new Error('NoSuchKey ' + key); return ossObjects[key]; },
    putObjectBuffer: async (key, buf) => { ossLog.push(['put', key]); ossObjects[key] = buf; return key; },
    processObjectSave: async (src, dst, proc) => { ossLog.push(['process', src, dst, proc]); ossObjects[dst] = Buffer.from('jpg'); return dst; },
};
stub('lib/oss', ossLib);

let published = [];
let publishFails = false;
stub('lib/chatEventBridge', {
    publishChatGenerateEvent: async (payload) => { if (publishFails) throw new Error('no creds'); published.push(payload); },
    CHAT_EVENT_SOURCE: 'acs.chat.test',
});

const avatarGen = require(path.join(WORKER, 'lib', 'avatarGen.js'));
const H = require(path.join(WORKER, 'handlers', 'avatar_generation.js'));

function reset() {
    queries = []; rows = {}; ossObjects = {}; ossLog = []; published = []; publishFails = false;
}

// A fake DashScope: records every call, answers with a URL the fake download resolves.
function fakeHttp({ failOn = null, throttleFirst = 0 } = {}) {
    const calls = [];
    let throttled = 0;
    return {
        calls,
        post: async (url, body) => {
            const text = body.input.messages[0].content.find((c) => c.text).text;
            const images = body.input.messages[0].content.filter((c) => c.image).map((c) => c.image);
            calls.push({ text, images, model: body.model, params: body.parameters });
            if (throttled < throttleFirst) { throttled++; return { status: 429, data: { code: 'Throttling.RateQuota' } }; }
            if (failOn && text.includes(failOn)) return { status: 400, data: { code: 'DataInspectionFailed', message: 'nope' } };
            return { status: 200, data: { output: { choices: [{ message: { content: [{ image: `https://result/${calls.length}.png` }] } }] } } };
        },
        get: async (url) => ({ data: Buffer.from('png:' + url) }),
    };
}
function fakeLlm(answer) {
    const calls = [];
    return { calls, chat: { completions: { create: async (req) => { calls.push(req); return { choices: [{ message: { content: answer } }] }; } } } };
}
const GATE_OK = '{"face_count":1,"is_photo_of_real_person":true,"is_frontal":true,"face_clearly_visible":true}';

// ---- lib ---------------------------------------------------------------------------------------

test('evaluateGate: one real frontal face passes; everything else maps to a reason code', () => {
    assert.equal(avatarGen.evaluateGate(GATE_OK).ok, true);
    assert.equal(avatarGen.evaluateGate('```json\n' + GATE_OK + '\n```').ok, true, 'fenced JSON is fine');
    assert.equal(avatarGen.evaluateGate('{"face_count":0,"is_photo_of_real_person":true,"is_frontal":true}').error_code, 'no_face');
    assert.equal(avatarGen.evaluateGate('{"face_count":2,"is_photo_of_real_person":true,"is_frontal":true}').error_code, 'multiple_faces');
    assert.equal(avatarGen.evaluateGate('{"face_count":1,"is_photo_of_real_person":false,"is_frontal":true}').error_code, 'not_a_photo');
    assert.equal(avatarGen.evaluateGate('{"face_count":1,"is_photo_of_real_person":true,"is_frontal":false}').error_code, 'not_frontal');
    assert.equal(avatarGen.evaluateGate('sorry, I cannot').error_code, 'not_a_photo', 'unparseable never passes');
});

test('prompt table: the three non-relaxed moods are edits; relaxed is the base', () => {
    assert.deepEqual(Object.keys(avatarGen.MOOD_PROMPTS).sort(), ['engaged', 'restored', 'stressed']);
    assert.equal(avatarGen.DEFAULT_MOOD, 'relaxed');
    for (const p of Object.values(avatarGen.MOOD_PROMPTS)) assert.match(p, /Keep this exact character/);
    assert.match(avatarGen.BASE_PROMPT, /image 2/, 'the base step names the style reference');
    const keys = avatarGen.outputKeys('u-1', 42);
    assert.deepEqual(Object.keys(keys).sort(), ['engaged', 'relaxed', 'restored', 'stressed', 'thumb']);
    for (const k of Object.values(keys)) assert.match(k, /^avatars\/custom\/u-1\/42-/);
});

test('pipeline: a rejected photo spends no image call, deletes the source, ends rejected', async () => {
    reset();
    ossObjects['avatar-uploads/u-1/a.jpg'] = Buffer.from('photo');
    rows = { 'SELECT id, user_id, status, source_oss_key FROM avatar_generations': [{ id: 7, user_id: 'u-1', status: 'pending', source_oss_key: 'avatar-uploads/u-1/a.jpg' }] };
    const http = fakeHttp();
    const r = await avatarGen.runAvatarGeneration(7, { pool, ossLib, llmClient: fakeLlm('{"face_count":2,"is_photo_of_real_person":true,"is_frontal":true}'), http, apiKey: 'k', log: () => {} });
    assert.equal(r.status, 'rejected');
    assert.equal(r.error_code, 'multiple_faces');
    assert.equal(http.calls.length, 0);
    assert.ok(ossLog.some(([op, k]) => op === 'delete' && k === 'avatar-uploads/u-1/a.jpg'), 'source deleted');
    assert.ok(queries.some((q) => /status = 'rejected'/.test(q.sql) && q.params[1] === 'multiple_faces'));
    assert.ok(queries.some((q) => /source_oss_key = NULL/.test(q.sql)));
});

test('pipeline: success = base with the style ref last, three SEQUENTIAL mood edits of the base, 5 stored keys, source deleted', async () => {
    reset();
    ossObjects['avatar-uploads/u-1/a.jpg'] = Buffer.from('photo');
    ossObjects[avatarGen.STYLE_REF_KEY] = Buffer.from('ref');
    rows = { 'SELECT id, user_id, status, source_oss_key FROM avatar_generations': [{ id: 7, user_id: 'u-1', status: 'pending', source_oss_key: 'avatar-uploads/u-1/a.jpg' }] };
    const http = fakeHttp({ throttleFirst: 1 });
    const r = await avatarGen.runAvatarGeneration(7, { pool, ossLib, llmClient: fakeLlm(GATE_OK), http, apiKey: 'k', log: () => {} });
    assert.equal(r.status, 'done', JSON.stringify(r));
    // 1 throttled + 4 real
    assert.equal(http.calls.length, 5);
    const real = http.calls.slice(1);
    assert.equal(real[0].images.length, 2, 'base takes photo + reference');
    assert.ok(real[0].images[1].startsWith('data:image/png'), 'reference is the LAST image (sets the output aspect)');
    assert.equal(real[0].text, avatarGen.BASE_PROMPT);
    for (const c of real.slice(1)) {
        assert.equal(c.images.length, 1, 'a mood edits exactly one image');
        assert.equal(c.images[0], real[1].images[0], 'every mood edits the same base image');
        assert.ok(c.images[0].startsWith('data:image/png'), 'the base, not the photo');
    }
    assert.deepEqual(real.slice(1).map((c) => c.text), ['engaged', 'restored', 'stressed'].map((m) => avatarGen.MOOD_PROMPTS[m]));
    for (const c of real) assert.equal(c.params.watermark, false);
    const done = queries.find((q) => /status = 'done'/.test(q.sql));
    assert.ok(done);
    const keys = JSON.parse(done.params[1]);
    assert.deepEqual(Object.keys(keys).sort(), ['engaged', 'relaxed', 'restored', 'stressed', 'thumb']);
    // derivatives from OSS image processing, temp originals cleaned up
    assert.equal(ossLog.filter(([op]) => op === 'process').length, 5);
    for (const k of ['avatar-uploads/u-1/a.jpg', ...['engaged', 'relaxed', 'restored', 'stressed'].map((m) => `avatars/custom/u-1/7-${m}-src.png`)]) {
        assert.ok(ossLog.some(([op, key]) => op === 'delete' && key === k), `${k} deleted`);
    }
    assert.ok(queries.some((q) => /source_oss_key = NULL/.test(q.sql)));
});

test('pipeline: a generation error ends failed with gen_failed and still deletes the source', async () => {
    reset();
    ossObjects['avatar-uploads/u-1/a.jpg'] = Buffer.from('photo');
    ossObjects[avatarGen.STYLE_REF_KEY] = Buffer.from('ref');
    rows = { 'SELECT id, user_id, status, source_oss_key FROM avatar_generations': [{ id: 7, user_id: 'u-1', status: 'pending', source_oss_key: 'avatar-uploads/u-1/a.jpg' }] };
    const http = fakeHttp({ failOn: 'lavender' });
    const r = await avatarGen.runAvatarGeneration(7, { pool, ossLib, llmClient: fakeLlm(GATE_OK), http, apiKey: 'k', log: () => {} });
    assert.equal(r.status, 'failed');
    assert.equal(r.error_code, 'gen_failed');
    assert.ok(ossLog.some(([op, k]) => op === 'delete' && k === 'avatar-uploads/u-1/a.jpg'));
    assert.ok(!queries.some((q) => /status = 'done'/.test(q.sql)));
});

test('pipeline: an already-terminal row is left alone (at-least-once delivery)', async () => {
    reset();
    rows = { 'SELECT id, user_id, status, source_oss_key FROM avatar_generations': [{ id: 7, user_id: 'u-1', status: 'done', source_oss_key: null }] };
    const http = fakeHttp();
    const r = await avatarGen.runAvatarGeneration(7, { pool, ossLib, llmClient: fakeLlm(GATE_OK), http, apiKey: 'k', log: () => {} });
    assert.equal(r.status, 'done');
    assert.equal(http.calls.length, 0);
    assert.equal(queries.length, 1);
});

// ---- handlers ------------------------------------------------------------------------------------

const USER = [{ user_id: 'u-1', language: 'zh' }];

test('presign mints a key under the caller prefix and signs image/jpeg', async () => {
    reset(); rows = { 'FROM users WHERE user_id': USER };
    const r = await H.handlePostAvatarGenerationPresign({ openid: 'u-1' });
    assert.equal(r.success, true);
    assert.match(r.key, /^avatar-uploads\/u-1\/[0-9a-f]{24}\.jpg$/);
    assert.equal(r.put_content_type, 'image/jpeg');
});

test('create refuses a key outside the caller prefix, a missing upload, the daily cap and a concurrent job', async () => {
    reset(); rows = { 'FROM users WHERE user_id': USER, 'COUNT\\(\\*\\)::int AS n FROM avatar_generations': [{ n: 0 }] };
    assert.equal((await H.handlePostAvatarGeneration({ openid: 'u-1', oss_key: 'avatar-uploads/u-2/x.jpg' })).statusCode, 403);
    assert.equal((await H.handlePostAvatarGeneration({ openid: 'u-1', oss_key: 'health-documents/u-1/x.pdf' })).statusCode, 403);
    assert.equal((await H.handlePostAvatarGeneration({ openid: 'u-1', oss_key: 'avatar-uploads/u-1/missing.jpg' })).reason, 'upload_missing');

    ossObjects['avatar-uploads/u-1/a.jpg'] = Buffer.from('photo');
    rows['COUNT\\(\\*\\)::int AS n FROM avatar_generations'] = [{ n: 3 }];
    const capped = await H.handlePostAvatarGeneration({ openid: 'u-1', oss_key: 'avatar-uploads/u-1/a.jpg' });
    assert.equal(capped.statusCode, 429);
    assert.equal(capped.reason, 'daily_limit');
    assert.ok(ossLog.some(([op, k]) => op === 'delete' && k === 'avatar-uploads/u-1/a.jpg'), 'a refused upload is deleted, not left in the bucket');

    ossObjects['avatar-uploads/u-1/a.jpg'] = Buffer.from('photo');
    rows['COUNT\\(\\*\\)::int AS n FROM avatar_generations'] = [{ n: 0 }];
    rows['INSERT INTO avatar_generations'] = Object.assign(new Error('dup'), { code: '23505' });
    const busy = await H.handlePostAvatarGeneration({ openid: 'u-1', oss_key: 'avatar-uploads/u-1/a.jpg' });
    assert.equal(busy.statusCode, 409);
    assert.equal(busy.reason, 'in_progress');
});

test('create publishes kind avatar_generate on the chat.generate event and returns processing', async () => {
    reset(); ossObjects['avatar-uploads/u-1/a.jpg'] = Buffer.from('photo');
    rows = {
        'FROM users WHERE user_id': USER,
        'COUNT\\(\\*\\)::int AS n FROM avatar_generations': [{ n: 1 }],
        'INSERT INTO avatar_generations': [{ id: '9', user_id: 'u-1', status: 'pending', source_oss_key: 'avatar-uploads/u-1/a.jpg', created_at: 'now' }],
    };
    const r = await H.handlePostAvatarGeneration({ openid: 'u-1', oss_key: 'avatar-uploads/u-1/a.jpg' });
    assert.equal(r.processing, true);
    assert.equal(r.generation.gen_id, 9);
    assert.equal(r.generation.status, 'pending');
    assert.equal(published.length, 1);
    assert.equal(published[0].kind, 'avatar_generate');
    assert.equal(published[0].gen_id, 9);
    assert.ok(!('source_oss_key' in r.generation) && !('moods' in r.generation), 'no key and no moods before done');
});

test('status never leaks the source key; moods only once done, as URLs', async () => {
    reset();
    rows = {
        'FROM users WHERE user_id': USER,
        'FROM avatar_generations WHERE user_id = \\$1 ORDER BY': [{ id: 9, user_id: 'u-1', status: 'done', source_oss_key: null, error_code: null, created_at: 'a', finished_at: 'b', mood_keys: avatarGen.outputKeys('u-1', 9) }],
    };
    const r = await H.handleGetAvatarGeneration({ openid: 'u-1' });
    assert.equal(r.generation.status, 'done');
    assert.equal(Object.keys(r.generation.moods).length, 5);
    assert.match(r.generation.moods.relaxed, /^https:\/\/get\/avatars\/custom\/u-1\/9-relaxed\.jpg\?exp=315360000$/, '10-year URL, the gallery convention');
    assert.ok(!JSON.stringify(r).includes('source_oss_key'));
});

test('apply scopes the row to the caller, requires done, and writes custom + moods + relaxed url', async () => {
    reset();
    rows = { 'FROM users WHERE user_id': USER, 'FROM avatar_generations WHERE id = \\$1 AND user_id = \\$2': (p) => (p[1] === 'u-1' && p[0] === 9 ? [{ id: 9, user_id: 'u-1', status: 'done', mood_keys: avatarGen.outputKeys('u-1', 9) }] : []) };
    assert.equal((await H.handlePostAvatarGenerationApply({ openid: 'u-1', gen_id: 8 })).statusCode, 404, 'someone else\'s (or unknown) gen_id is simply not found');
    const r = await H.handlePostAvatarGenerationApply({ openid: 'u-1', gen_id: 9 });
    assert.equal(r.success, true);
    assert.equal(r.avatar_character, 'custom');
    const upd = queries.find((q) => /UPDATE users SET avatar_character = 'custom'/.test(q.sql));
    assert.ok(upd);
    assert.equal(upd.params[0], 'u-1');
    assert.equal(upd.params[2], r.avatar_moods.relaxed, 'avatar_url stays the relaxed variant (§20)');

    rows['FROM avatar_generations WHERE id = \\$1 AND user_id = \\$2'] = [{ id: 9, user_id: 'u-1', status: 'running', mood_keys: null }];
    assert.equal((await H.handlePostAvatarGenerationApply({ openid: 'u-1', gen_id: 9 })).statusCode, 409);
});

// ---- static couplings ----------------------------------------------------------------------------

test('worker routes the four endpoints and the event branch precedes the chat machinery', () => {
    const index = read(WORKER, 'index.js');
    assert.match(index, /path === '\/avatar-generation'\) \{\s*result = await handleGetAvatarGeneration\(query\)/);
    assert.match(index, /path === '\/avatar-generation\/presign'\) \{\s*result = await handlePostAvatarGenerationPresign\(parsedBody\)/);
    assert.match(index, /path === '\/avatar-generation\/apply'\) \{\s*result = await handlePostAvatarGenerationApply\(parsedBody\)/);
    assert.match(index, /path === '\/avatar-generation'\) \{\s*result = await handlePostAvatarGeneration\(parsedBody\)/);
    const chat = read(WORKER, 'handlers', 'chat.js');
    const fn = chat.slice(chat.indexOf('async function handleChatGenerateEvent('));
    const branch = fn.indexOf("kind === 'avatar_generate'");
    assert.ok(branch > 0);
    assert.ok(branch < fn.indexOf('runAgenticTurn('), 'avatar_generate returns before any LLM chat work');
    assert.ok(branch > fn.indexOf('chat_generate_events'), 'but after the at-least-once dedupe claim');
});

test('every self-row select that returns avatar_character also returns avatar_moods; a gallery pick clears it', () => {
    for (const f of ['login.js', 'phone-otp.js', 'users.js']) {
        const src = read(WORKER, 'handlers', f);
        const lines = src.split('\n').filter((l) => /avatar_character/.test(l) && /SELECT|RETURNING|^\s+u\./.test(l));
        for (const l of lines) assert.match(l, /avatar_moods/, `${f}: ${l.trim()}`);
    }
    const users = read(WORKER, 'handlers', 'users.js');
    assert.match(users, /avatar_character !== 'custom'\) sets\.push\('avatar_moods=NULL'\)/);
});

test('both yamls carry the model and daily-cap env vars', () => {
    for (const f of ['s.yaml', 's-prod.yaml']) {
        const y = read(ROOT, f);
        assert.match(y, /AVATAR_GEN_MODEL:/, f);
        assert.match(y, /AVATAR_GEN_MAX_PER_DAY:/, f);
    }
});

test('miniapp: mood.js resolves custom from avatar_moods only; picker copy exists in both languages; no comment between wx:if siblings', () => {
    const mood = read(MINI, 'utils', 'mood.js');
    assert.match(mood, /CUSTOM_AVATAR_ID = 'custom'/);
    assert.match(mood, /function resolveAvatarUrl\(avatarId, mood, customMoods\)/);
    const uh = read(MINI, 'components', 'user-health', 'user-health.js');
    assert.match(uh, /resolveAvatarUrl\(character, this\.data\.mood, this\.properties\.user\?\.avatar_moods\)/);
    const uhWxml = read(MINI, 'components', 'user-health', 'user-health.wxml');
    assert.match(uhWxml, /allow-upload="\{\{mode === 'self'\}\}"/, 'a coach never sees the upload tile');
    assert.match(uhWxml, /bind:customapplied="onCustomAvatarApplied"/);
    assert.match(read(MINI, 'pages', 'main', 'main.wxml'), /bindcustomavatar="handleHealthCustomAvatar"/);

    const js = read(MINI, 'components', 'avatar-picker', 'avatar-picker.js');
    const zh = js.slice(js.indexOf('zh: {'), js.indexOf('en: {'));
    const en = js.slice(js.indexOf('en: {'));
    const keysOf = (block) => [...block.matchAll(/^\s{4}([a-zA-Z_]+):/gm)].map((m) => m[1]);
    const zhKeys = keysOf(zh), enKeys = keysOf(en);
    assert.ok(zhKeys.length > 15);
    assert.deepEqual(enKeys.slice(0, zhKeys.length), zhKeys, 'T.zh and T.en carry the same keys');
    const wxml = read(MINI, 'components', 'avatar-picker', 'avatar-picker.wxml');
    for (const k of [...wxml.matchAll(/t\.([a-zA-Z_]+)/g)].map((m) => m[1])) assert.ok(zhKeys.includes(k), `t.${k} used in WXML but missing from T`);
    for (const code of ['no_face', 'multiple_faces', 'not_a_photo', 'not_frontal', 'gen_failed', 'store_failed', 'daily_limit', 'in_progress', 'too_large']) {
        assert.ok(zhKeys.includes(`err_${code}`), `err_${code} copy`);
    }
    assert.ok(!/<!--[\s\S]*?-->\s*<[a-z-]+[^>]*wx:el(se|if)/.test(wxml), 'a comment node before wx:elif/else breaks Android (memory)');
    const cfg = read(MINI, 'utils', 'config.js');
    assert.match(cfg, /const VERSION = '\d{4}-\d+';/);
});
