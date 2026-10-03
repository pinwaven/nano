'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const worker = path.resolve(__dirname, '../src/functions/worker');
const users = new Map();
const identities = new Map();
const merges = [];
let wxResponse;

function row(id, createdAt, phone = null, unionid = null) {
    return { user_id: id, created_at: createdAt, phone, wx_unionid: unionid,
        channel_id: id === 'old' ? 1 : 2, coach_id: id === 'old' ? 10 : 20,
        external_id: `legacy-${id}`, merged_into_user_id: null };
}

const pool = { query: async (sql, params) => {
    if (sql.startsWith('SELECT user_id FROM wechat_miniapp_identities')) {
        const found = identities.get(`${params[0]}:${params[1]}`);
        return { rows: found ? [{ user_id: found.user_id }] : [] };
    }
    if (sql.startsWith('SELECT user_id, merged_into_user_id')) {
        const found = users.get(params[0]);
        return { rows: found ? [{ ...found }] : [] };
    }
    if (sql.startsWith('SELECT DISTINCT u.user_id')) {
        const ids = new Set();
        for (const user of users.values()) if (user.wx_unionid === params[0]) ids.add(user.user_id);
        for (const identity of identities.values()) if (identity.unionid === params[0]) ids.add(identity.user_id);
        return { rows: [...ids].map(user_id => ({ user_id })) };
    }
    if (sql.startsWith('SELECT user_id FROM users WHERE external_id')) {
        const found = [...users.values()].find(u => u.external_id === params[0]);
        return { rows: found ? [{ user_id: found.user_id }] : [] };
    }
    if (sql.startsWith('INSERT INTO wechat_miniapp_identities')) {
        const key = `${params[0]}:${params[1]}`;
        if (!identities.has(key)) identities.set(key, { user_id: params[2], unionid: params[3] });
        return { rows: [] };
    }
    if (sql.startsWith('UPDATE wechat_miniapp_identities')) {
        identities.set(`${params[2]}:${params[3]}`, { user_id: params[0], unionid: params[1] });
        return { rows: [] };
    }
    if (sql.startsWith('UPDATE users SET wx_unionid')) {
        const user = users.get(params[1]);
        user.wx_unionid ||= params[0];
        return { rows: [] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
} };

const stub = (file, exports) => {
    const filename = path.join(worker, file);
    require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
stub('lib/db.js', { pool });
stub('handlers/user-merge.js', { mergeUsers: async (winner, loser, matchedOn, options) => {
    merges.push({ winner, loser, matchedOn, options });
    for (const identity of identities.values()) if (identity.user_id === loser) identity.user_id = winner;
    Object.assign(users.get(winner), { channel_id: options.channelId, coach_id: options.coachId });
    users.get(loser).merged_into_user_id = winner;
} });

process.env.WX_APPID = 'primary';
process.env.WX_SECRET = 'primary-secret';
process.env.WX_APPID_WAVEN = 'second';
process.env.WX_SECRET_WAVEN = 'second-secret';
const identity = require(path.join(worker, 'lib/wechatIdentity.js'));

beforeEach(() => {
    users.clear(); identities.clear(); merges.length = 0;
    users.set('old', row('old', '2025-01-01T00:00:00Z'));
    wxResponse = { openid: 'openid-second', unionid: 'union-1' };
    global.fetch = async () => ({ json: async () => wxResponse });
});

test('AppID/OpenID pairs are distinct and a matching UnionID links to the same user', async () => {
    await identity.attachMiniappIdentity('old', 'primary', 'openid-primary', 'union-1');
    const owner = await identity.findMiniappUser('second', 'openid-second', 'union-1');
    assert.equal(owner.user_id, 'old');
    await identity.attachMiniappIdentity(owner.user_id, 'second', 'openid-second', 'union-1');
    assert.equal(identities.size, 2);
    assert.equal((await identity.findMiniappUser('second', 'openid-second', null)).user_id, 'old');
    assert.equal(await identity.findMiniappUser('primary', 'openid-second', null), null);
    assert.equal(users.get('old').external_id, 'legacy-old');
});

test('unknown AppID is rejected before exchanging a code', async () => {
    assert.equal(identity.miniappCredentials('unknown'), null);
    assert.deepEqual(await identity.exchangeMiniappCode('code', 'unknown'), { error: 'unknown_app_id' });
});

test('two phone-less UnionID owners merge with oldest id and newest channel/coach', async () => {
    users.set('new', row('new', '2026-01-01T00:00:00Z', null, 'union-1'));
    identities.set('second:openid-second', { user_id: 'new', unionid: 'union-1' });
    users.get('old').wx_unionid = 'union-1';
    const owner = await identity.findMiniappUser('second', 'openid-second', 'union-1');
    assert.equal(owner.user_id, 'old');
    assert.deepEqual(merges.map(m => [m.winner, m.loser, m.matchedOn]), [['old', 'new', 'wx_unionid']]);
    assert.equal(merges[0].options.strict, true);
    assert.equal(owner.channel_id, 2);
    assert.equal(owner.coach_id, 20);
});

test('phone ownership prevents automatic UnionID merge', async () => {
    users.get('old').wx_unionid = 'union-1';
    users.set('new', row('new', '2026-01-01T00:00:00Z', '+8613800000000', 'union-1'));
    await assert.rejects(identity.findMiniappUser('second', 'openid-second', 'union-1'), /requires_verified_login/);
    assert.equal(merges.length, 0);
});

test('verified login binds an unfamiliar AppID and preserves the existing phone owner', async () => {
    users.get('old').phone = '+8613800000000';
    wxResponse = { openid: 'openid-second' };
    const owner = await identity.linkVerifiedMiniappLogin('old', 'code', 'second');
    assert.equal(owner, 'old');
    assert.equal(identities.get('second:openid-second').user_id, 'old');
    assert.equal(users.get('old').phone, '+8613800000000');
});

test('a WeChat bound to another phone account: the login goes ahead without a link', async () => {
    users.set('pin', row('pin', '2026-01-01T00:00:00Z', '+8613700000000'));
    identities.set('second:openid-second', { user_id: 'pin', unionid: null });
    wxResponse = { openid: 'openid-second' };
    const owner = await identity.linkVerifiedMiniappLogin('old', 'code', 'second');
    assert.equal(owner, 'old');
    assert.equal(identities.get('second:openid-second').user_id, 'pin');
    assert.equal(merges.length, 0);
});

test('an account bound to another UnionID signs in without a link', async () => {
    users.get('old').wx_unionid = 'union-other';
    const owner = await identity.linkVerifiedMiniappLogin('old', 'code', 'second');
    assert.equal(owner, 'old');
    assert.equal(identities.size, 0);
});

test('a phone-less WeChat stub is still merged into the signed-in account', async () => {
    users.set('stub', row('stub', '2026-01-01T00:00:00Z'));
    identities.set('second:openid-second', { user_id: 'stub', unionid: null });
    wxResponse = { openid: 'openid-second' };
    const owner = await identity.linkVerifiedMiniappLogin('old', 'code', 'second');
    assert.equal(owner, 'old');
    assert.deepEqual(merges.map(m => [m.winner, m.loser]), [['old', 'stub']]);
    assert.equal(identities.get('second:openid-second').user_id, 'old');
});
