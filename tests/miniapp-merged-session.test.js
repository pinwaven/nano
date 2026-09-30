'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

test('a cached loser session returns to login when refresh names the surviving user', async () => {
    const root = path.resolve(__dirname, '../src/mini/nano-miniapp/utils');
    const config = path.join(root, 'config.js');
    require.cache[config] = { id: config, filename: config, loaded: true, exports: { BASE: 'https://nano-dev.gcn.net' } };
    const removed = [];
    const launches = [];
    global.wx = {
        getStorageSync: key => key === 'nano_session' ? 'u.old-session' : Date.now(),
        removeStorageSync: key => removed.push(key),
        request: opts => opts.success({ statusCode: 200, data: { session_token: 'u.new-session', user_id: 'winner' } }),
        reLaunch: opts => launches.push(opts.url),
    };
    const session = require(path.join(root, 'session.js'));
    const app = { globalData: { user: { user_id: 'loser' }, apiToken: '' } };
    session.restoreSession(app);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(app.globalData.user, null);
    assert.equal(app.globalData.apiToken, '');
    assert.ok(removed.includes('nano_user'));
    assert.ok(removed.includes('nano_last_session'));
    assert.deepEqual(launches, ['/pages/login/login']);
});

test('a late refresh cannot restore a session after logout', async () => {
    const root = path.resolve(__dirname, '../src/mini/nano-miniapp/utils');
    const config = path.join(root, 'config.js');
    require.cache[config] = { id: config, filename: config, loaded: true, exports: { BASE: 'https://nano-dev.gcn.net' } };
    let completeRequest;
    const saved = [];
    global.wx = {
        getStorageSync: key => key === 'nano_session' ? 'u.old-session' : Date.now(),
        setStorageSync: (...args) => saved.push(args),
        removeStorageSync: () => {},
        request: opts => { completeRequest = opts.success; },
        reLaunch: () => {},
    };
    const session = require(path.join(root, 'session.js'));
    const app = { globalData: { user: { user_id: 'old' }, apiToken: '' } };
    session.restoreSession(app);
    session.clearSession(app);
    app.globalData.user = null;
    completeRequest({ statusCode: 200, data: { session_token: 'u.late', user_id: 'old' } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(app.globalData.apiToken, '');
    assert.equal(saved.length, 0);
});
