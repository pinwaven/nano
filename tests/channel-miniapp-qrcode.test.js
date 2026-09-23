// Channel QR codes for the root Waven miniprogram: GET /channel-branding (read by the login
// page before any login) and GET /channels/:id/miniapp-qrcode (admin panel, mints a 小程序码
// with scene `ch:<id>`), plus the static couplings — the login page's scene parsing and the
// admin-panel button — that nothing checks at runtime. Fully offline: lib/db and lib/auth's
// WeChat token fetch are stubbed, and the wxacode call is intercepted via global fetch.
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

let tokenCalls = [];
stub('lib/auth', {
    requirePermission: () => null,
    verifySubchannelOwnership: async (id, ctx) => (ctx.owned || []).includes(parseInt(id)),
    signChannelAdminToken: () => 'x',
    CHANNEL_ADMIN_FULL_PERMS: [],
    expandPermissions: () => [],
    getWxAccessToken: async (appid, secret) => { tokenCalls.push({ appid, secret }); return 'TOKEN'; },
});

const { handleGetChannelBranding, handleGetChannelMiniappQrcode } = require(path.join(WORKER, 'handlers', 'channels.js'));

const CHANNEL = { id: 7, name: 'Aeviva China', key_name: 'aeviva-china', logo_url: 'https://oss/logo.png', locale: 'zh' };

test.beforeEach(() => {
    queries = [];
    rows = { 'FROM channels WHERE id = \\$1': (p) => (p[0] === 7 ? [CHANNEL] : []) };
    tokenCalls = [];
    process.env.WX_APPID = 'wxOTHER';
    process.env.WX_SECRET = 'sOTHER';
    process.env.WX_APPID_WAVEN = 'wxROOT';
    process.env.WX_SECRET_WAVEN = 'sROOT';
});

// ---- /channel-branding ---------------------------------------------------------------------------

test('channel-branding returns only public display fields', async () => {
    const r = await handleGetChannelBranding({ id: '7' });
    assert.equal(r.success, true);
    assert.deepEqual(r.channel, { id: 7, name: 'Aeviva China', key_name: 'aeviva-china', logo_url: 'https://oss/logo.png', locale: 'zh' });
    assert.match(queries[0].sql, /effective_channel_logo\(id\)/);
});

test('channel-branding rejects a missing or non-numeric id and 404s an unknown one', async () => {
    assert.equal((await handleGetChannelBranding({})).statusCode, 400);
    assert.equal((await handleGetChannelBranding({ id: 'aeviva-china' })).statusCode, 400);
    assert.equal(queries.length, 0, 'no query for a bad id');
    const r = await handleGetChannelBranding({ id: '99' });
    assert.equal(r.statusCode, 404);
    assert.equal(r.error, 'channel_not_found');
});

test('channel-branding resolves a public slug with a bound query parameter', async () => {
    rows = { 'FROM channels WHERE key_name': [CHANNEL] };
    const r = await handleGetChannelBranding({ key_name: 'superiormed' });
    assert.equal(r.success, true);
    assert.deepEqual(queries[0].params, ['superiormed']);
    assert.match(queries[0].sql, /WHERE key_name = \$1/);
    assert.deepEqual(Object.keys(r.channel).sort(), ['id', 'key_name', 'locale', 'logo_url', 'name']);
});

test('channel-branding rejects malformed selectors and handles unknown slugs', async () => {
    for (const query of [{ key_name: "x' OR 1=1" }, { id: '7junk' }, { key_name: ' ' }]) {
        assert.equal((await handleGetChannelBranding(query)).statusCode, 400);
    }
    assert.equal(queries.length, 0);
    assert.equal((await handleGetChannelBranding({ key_name: 'missing' })).statusCode, 404);
});

// ---- /channels/:id/miniapp-qrcode ----------------------------------------------------------------

function fakeWx(handler) {
    const orig = global.fetch;
    global.fetch = async (url, opts) => handler(url, opts);
    return () => { global.fetch = orig; };
}

test('miniapp-qrcode mints against the ROOT appid with scene ch:<id> and returns base64', async () => {
    let sent = null;
    const restore = fakeWx(async (url, opts) => {
        sent = { url, body: JSON.parse(opts.body) };
        return { headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer };
    });
    try {
        const r = await handleGetChannelMiniappQrcode('7', { role: 'superadmin' });
        assert.equal(r.success, true);
        assert.deepEqual(tokenCalls, [{ appid: 'wxROOT', secret: 'sROOT' }], 'root Waven credentials, not WX_APPID');
        assert.match(sent.url, /getwxacodeunlimit\?access_token=TOKEN/);
        assert.equal(sent.body.scene, 'ch:7');
        assert.equal(sent.body.page, 'pages/login/login');
        assert.equal(sent.body.check_path, false);
        assert.equal(r.scene, 'ch:7');
        assert.equal(r.appid, 'wxROOT');
        assert.equal(r.image_base64, Buffer.from([1, 2, 3]).toString('base64'));
        assert.equal(r.content_type, 'image/jpeg');
    } finally { restore(); }
});

test('miniapp-qrcode surfaces a WeChat JSON error instead of a fake image', async () => {
    const restore = fakeWx(async () => ({
        headers: { get: () => 'application/json; encoding=utf-8' },
        json: async () => ({ errcode: 41030, errmsg: 'invalid page' }),
    }));
    try {
        const r = await handleGetChannelMiniappQrcode('7', { role: 'superadmin' });
        assert.equal(r.success, false);
        assert.match(r.error, /invalid page \(41030\)/);
        assert.equal(r.image_base64, undefined);
    } finally { restore(); }
});

test('miniapp-qrcode is scoped for channel admins: own channel or an owned sub-channel only', async () => {
    const restore = fakeWx(async () => ({ headers: { get: () => 'image/png' }, arrayBuffer: async () => new ArrayBuffer(1) }));
    try {
        assert.equal((await handleGetChannelMiniappQrcode('7', { role: 'channel', channelId: 7 })).success, true);
        assert.equal((await handleGetChannelMiniappQrcode('7', { role: 'channel', channelId: 3, owned: [7] })).success, true);
        const denied = await handleGetChannelMiniappQrcode('7', { role: 'channel', channelId: 3, owned: [] });
        assert.equal(denied.statusCode, 403);
        assert.equal(tokenCalls.length, 2, 'no WeChat call on a denied request');
    } finally { restore(); }
});

test('miniapp-qrcode 404s an unknown channel before calling WeChat', async () => {
    const r = await handleGetChannelMiniappQrcode('99', { role: 'superadmin' });
    assert.equal(r.statusCode, 404);
    assert.equal(tokenCalls.length, 0);
});

// ---- static couplings ----------------------------------------------------------------------------

test('worker routes both endpoints', () => {
    const src = read(WORKER, 'index.js');
    assert.match(src, /path === '\/channel-branding'/);
    assert.match(src, /\\\/channels\\\/\(\\d\+\)\\\/miniapp-qrcode\$/);
    assert.match(src, /handleGetChannelBranding, handleGetChannelMiniappQrcode/);
});

test('login page parses ?channel= and the ch:<id> scene, fetches branding, and forwards channel_slug', () => {
    const src = read(MINI, 'pages', 'login', 'login.js');
    assert.match(src, /scene\.startsWith\('ch:'\)/);
    assert.match(src, /options\.channel/);
    assert.match(src, /\/api\/channel-branding\?id=/);
    assert.match(src, /this\._channelSlug \|\| CHANNEL_SLUG/);
    // The scene must be decoded like pages/qrlogin does — a real scan URL-encodes it.
    assert.match(src, /decodeURIComponent\(options\.scene/);
});

test('admin panel exposes the QR button on the channel row', () => {
    const src = read(ROOT, 'src', 'web', 'admin-panel', 'src', 'tabs', 'ChannelTab.jsx');
    assert.match(src, /\/api\/channels\/\$\{channel\.id\}\/miniapp-qrcode/);
    assert.match(src, /type: 'miniapp-qr'/);
    const tr = read(ROOT, 'src', 'web', 'admin-panel', 'src', 'translations.js');
    assert.equal((tr.match(/miniappQrHint:/g) || []).length, 2, 'both language blocks');
});
