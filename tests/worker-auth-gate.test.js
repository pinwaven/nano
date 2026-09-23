// The worker's bearer gate (worker/index.js) and the tokens nano signs itself (lib/auth.js),
// driven through the real handler with the DB stubbed. Pins the phase-1 containment from
// TODO.md "Security": exact public paths instead of prefixes, fail closed when no credential is
// configured, admin sessions signed with TOKEN_SIGNING_SECRET — never with API_BEARER_TOKEN,
// which ships in the miniapp and is therefore public.
const assert = require('node:assert/strict');
const { beforeEach, afterEach, describe, test } = require('node:test');
const crypto = require('node:crypto');
const path = require('node:path');

const WORKER = path.resolve(__dirname, '../src/functions/worker');

function clearWorkerModules() {
  for (const key of Object.keys(require.cache)) {
    if (key.includes('/src/functions/worker/')) delete require.cache[key];
  }
}

function installDbMock(query) {
  const stub = (p, exports) => { require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
  stub(path.join(WORKER, 'lib/db.js'), { pool: { query, connect: async () => ({ query, release() {} }) } });
  stub(path.join(WORKER, 'lib/oss.js'), {});
}

function event(method, rawPath, { token, body, sourceIp } = {}) {
  return {
    rawPath,
    requestContext: { http: { method, ...(sourceIp ? { sourceIp } : {}) } },
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    queryParameters: {},
    body: JSON.stringify(body || {}),
    isBase64Encoded: false,
  };
}

async function call(method, rawPath, opts) {
  const worker = require(path.join(WORKER, 'index.js'));
  const res = await worker.handler(event(method, rawPath, opts));
  let data = null;
  try { data = JSON.parse(res.body); } catch {}
  return { status: res.statusCode, data };
}

// A token in nano's own format, signed with an arbitrary key — what an attacker holding the
// public API_BEARER_TOKEN could produce under the old scheme.
function forge(prefix, key, data) {
  const iat = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ ...data, iat, exp: iat + 3600 })).toString('base64url');
  const sig = crypto.createHmac('sha256', key).update(`${prefix}.${payload}`).digest('hex');
  return `${prefix}.${payload}.${sig}`;
}

const BEARER = 'public-app-token';
const SECRET = 'signing-secret-for-tests';
const emptyDb = async () => ({ rows: [], rowCount: 0 });

describe('worker bearer gate', () => {
  beforeEach(() => {
    clearWorkerModules();
    process.env.API_BEARER_TOKEN = BEARER;
    process.env.TOKEN_SIGNING_SECRET = SECRET;
    installDbMock(emptyDb);
  });
  afterEach(() => {
    delete process.env.API_BEARER_TOKEN;
    delete process.env.TOKEN_SIGNING_SECRET;
  });

  test('a gated route with no credential is 401', async () => {
    assert.equal((await call('GET', '/channels')).status, 401);
  });

  test('fails closed when API_BEARER_TOKEN is unset: no credential is still 401', async () => {
    delete process.env.API_BEARER_TOKEN;
    clearWorkerModules();
    installDbMock(emptyDb);
    assert.equal((await call('GET', '/channels')).status, 401);
    assert.equal((await call('GET', '/channels', { token: '' })).status, 401);
  });

  test('the legacy app bearer still passes (dual-accept until phase 3)', async () => {
    assert.notEqual((await call('GET', '/channels', { token: BEARER })).status, 401);
  });

  test('a superadmin session signed with TOKEN_SIGNING_SECRET passes', async () => {
    const { signSuperadminToken } = require(path.join(WORKER, 'lib/auth.js'));
    const token = signSuperadminToken({ sub: 1, username: 'root' });
    assert.match(token, /^sa\./);
    assert.notEqual((await call('GET', '/channels', { token })).status, 401);
  });

  test('sa. and ch. tokens signed with the public app bearer are rejected', async () => {
    assert.equal((await call('GET', '/channels', { token: forge('sa', BEARER, { sub: 1 }) })).status, 401);
    const ch = forge('ch', BEARER, { sub: 1, cid: 1, auto: true, perms: [] });
    assert.equal((await call('GET', '/channels', { token: ch })).status, 401);
  });

  test('phone/email bind, remove, set-primary, list and accept-unverified need a credential', async () => {
    for (const p of ['/phone-otp/bind', '/phone-otp/remove', '/phone-otp/set-primary', '/phone-otp/accept-unverified',
                     '/email-otp/bind', '/email-otp/remove', '/email-otp/set-primary']) {
      assert.equal((await call('POST', p, { body: { user_id: 'victim', phone: '13800000000', code: '1' } })).status, 401, p);
    }
    assert.equal((await call('GET', '/phone-otp/list')).status, 401);
    assert.equal((await call('GET', '/email-otp/list')).status, 401);
  });

  test('login steps stay public', async () => {
    for (const [m, p] of [['POST', '/phone-otp/verify'], ['POST', '/email-otp/verify'], ['POST', '/admin/login'], ['GET', '/qr-login/status']]) {
      assert.notEqual((await call(m, p)).status, 401, p);
    }
  });
});

describe('token signing', () => {
  beforeEach(clearWorkerModules);
  afterEach(() => { delete process.env.TOKEN_SIGNING_SECRET; });

  test('no TOKEN_SIGNING_SECRET: signing throws and verifying returns null', () => {
    delete process.env.TOKEN_SIGNING_SECRET;
    installDbMock(emptyDb);
    const auth = require(path.join(WORKER, 'lib/auth.js'));
    assert.throws(() => auth.signChannelAdminToken({ sub: 1, cid: 1 }), /TOKEN_SIGNING_SECRET/);
    assert.equal(auth.verifyChannelAdminToken(forge('ch', '', { sub: 1 })), null);
  });

  test('round-trips; a tampered payload, a wrong prefix or an expired token is rejected', () => {
    process.env.TOKEN_SIGNING_SECRET = SECRET;
    installDbMock(emptyDb);
    const auth = require(path.join(WORKER, 'lib/auth.js'));
    const token = auth.signChannelAdminToken({ sub: 7, username: 'a', cid: 3, perms: ['users:read'] });
    assert.equal(auth.verifyChannelAdminToken(token).cid, 3);
    assert.equal(auth.verifySuperadminToken(token), null, 'a ch. token is not an sa. token');
    const [p, payload, sig] = token.split('.');
    const evil = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url')), cid: 1 })).toString('base64url');
    assert.equal(auth.verifyChannelAdminToken(`${p}.${evil}.${sig}`), null);
    const expired = (() => {
      const iat = Math.floor(Date.now() / 1000) - 100;
      const pl = Buffer.from(JSON.stringify({ sub: 1, iat, exp: iat + 10 })).toString('base64url');
      return `ch.${pl}.${crypto.createHmac('sha256', SECRET).update(`ch.${pl}`).digest('hex')}`;
    })();
    assert.equal(auth.verifyChannelAdminToken(expired), null);
    assert.equal(auth.verifyChannelAdminToken('ch.not-base64.zz'), null);
  });
});

describe('superadmin login', () => {
  beforeEach(() => { clearWorkerModules(); process.env.TOKEN_SIGNING_SECRET = SECRET; process.env.API_BEARER_TOKEN = BEARER; });
  afterEach(() => { delete process.env.TOKEN_SIGNING_SECRET; delete process.env.API_BEARER_TOKEN; });

  test('returns a signed sa. session, never the raw API bearer', async () => {
    const salt = 'abcd';
    const hash = crypto.scryptSync('pw', salt, 64).toString('hex');
    installDbMock(async sql => sql.includes('FROM admin_accounts')
      ? { rows: [{ id: 9, password_hash: `${salt}:${hash}`, channel_id: null }] }
      : { rows: [] });
    const { data } = await call('POST', '/admin/login', { body: { username: 'root', password: 'pw' } });
    assert.equal(data.success, true);
    assert.notEqual(data.token, BEARER);
    const { verifySuperadminToken } = require(path.join(WORKER, 'lib/auth.js'));
    assert.equal(verifySuperadminToken(data.token).sub, 9);
  });
});

describe('QR login status', () => {
  beforeEach(() => { clearWorkerModules(); process.env.API_BEARER_TOKEN = BEARER; process.env.TOKEN_SIGNING_SECRET = SECRET; });
  afterEach(() => { delete process.env.API_BEARER_TOKEN; delete process.env.TOKEN_SIGNING_SECRET; });

  test('a confirmed session is handed out once, as named columns in the login shape', async () => {
    let status = 'confirmed';
    installDbMock(async (sql) => {
      if (sql.includes('SELECT session_id, status')) return { rows: [{ session_id: 's', status, openid: 'u1', expires_at: new Date(Date.now() + 60000) }] };
      if (sql.includes("SET status = 'consumed'")) {
        if (status !== 'confirmed') return { rows: [] };
        status = 'consumed';
        return { rows: [{ openid: 'u1' }] };
      }
      if (sql.includes('FROM users u')) return { rows: [{ user_id: 'u1', nickname: 'N', roles: ['user'], channel_id: null, channel_name: null }] };
      return { rows: [] };
    });
    const worker = require(path.join(WORKER, 'index.js'));
    const ev = (sid) => ({ ...event('GET', '/qr-login/status'), queryParameters: { session_id: sid } });
    const a = JSON.parse((await worker.handler(ev('s'))).body);
    assert.equal(a.status, 'confirmed');
    assert.equal(a.user.user_id, 'u1');
    assert.ok(!('external_id' in a.user), 'no raw users row');
    assert.ok('channel' in a && 'coach' in a);
    const b = JSON.parse((await worker.handler(ev('s'))).body);
    assert.equal(b.status, 'consumed');
    assert.equal(b.user, undefined);
    assert.equal((await call('GET', '/qr-login/status')).status, 400, 'session_id is required');
  });
});

describe('phone OTP send rate limit', () => {
  beforeEach(clearWorkerModules);

  test('a recent send for the phone is rate_limited before any SMS goes out', async () => {
    const seen = [];
    installDbMock(async (sql, params) => {
      seen.push(sql);
      if (sql.includes('FROM phone_otp_send_log')) return { rows: [{ recent: 1, phone_hourly: 1, ip_hourly: 1 }] };
      return { rows: [] };
    });
    const { handlePhoneOtpSend } = require(path.join(WORKER, 'handlers/phone-otp.js'));
    const r = await handlePhoneOtpSend({ phone: '13800000000' }, '1.2.3.4');
    assert.equal(r.error, 'rate_limited');
    assert.ok(!seen.some(s => s.includes('INSERT INTO phone_otp_send_log')));
  });

  test('the per-IP cap trips even for a fresh number', async () => {
    installDbMock(async (sql) => sql.includes('FROM phone_otp_send_log')
      ? { rows: [{ recent: 0, phone_hourly: 0, ip_hourly: 30 }] } : { rows: [] });
    const { handlePhoneOtpSend } = require(path.join(WORKER, 'handlers/phone-otp.js'));
    assert.equal((await handlePhoneOtpSend({ phone: '13900000000' }, '1.2.3.4')).error, 'rate_limited');
  });

  test('under the limits the attempt is logged and the dev-bypass send runs', async () => {
    const inserts = [];
    delete process.env.SMS_ACCESS_KEY_ID;
    installDbMock(async (sql, params) => {
      if (sql.includes('FROM phone_otp_send_log')) return { rows: [{ recent: 0, phone_hourly: 0, ip_hourly: 0 }] };
      if (sql.startsWith('INSERT')) inserts.push({ sql, params });
      return { rows: [] };
    });
    const { handlePhoneOtpSend } = require(path.join(WORKER, 'handlers/phone-otp.js'));
    const r = await handlePhoneOtpSend({ phone: '13700000000' }, '5.6.7.8');
    assert.equal(r.success, true);
    assert.deepEqual(inserts[0].params, ['13700000000', '5.6.7.8']);
  });
});

describe('kino function admin routes', () => {
  afterEach(() => { delete process.env.TOKEN_SIGNING_SECRET; delete process.env.API_BEARER_TOKEN; });

  // The web admin panel's Hardware tab calls /kino/kino-machines with whatever /admin/login
  // returned — now an sa. session rather than the raw bearer.
  test('accepts a worker-signed superadmin session and rejects one forged with the app bearer', () => {
    process.env.TOKEN_SIGNING_SECRET = SECRET;
    process.env.API_BEARER_TOKEN = BEARER;
    clearWorkerModules();
    installDbMock(emptyDb);
    const { signSuperadminToken } = require(path.join(WORKER, 'lib/auth.js'));
    const kinoDb = path.resolve(__dirname, '../src/functions/kino/lib/db.js');
    require.cache[kinoDb] = { id: kinoDb, filename: kinoDb, loaded: true, exports: { pool: { query: emptyDb } } };
    const { requireAdminBearer } = require('../src/functions/kino')._private;
    const ev = token => ({ headers: { Authorization: `Bearer ${token}` } });
    assert.equal(requireAdminBearer(ev(signSuperadminToken({ sub: 1 }))).ok, true);
    assert.equal(requireAdminBearer(ev(forge('sa', BEARER, { sub: 1 }))).ok, false);
    assert.equal(requireAdminBearer(ev(BEARER)).ok, true, 'legacy bearer still accepted');
  });
});

// ── Phase 3: per-user sessions ──────────────────────────────────────────────
// A tiny user table: 'me' coaches clients c1 via coach row 7; 'other' is nobody's; 'adm' is a
// channel admin of channel 3; 'ghost' merged into 'me'.
const USERS = {
  me:    { user_id: 'me', external_id: 'wx-me', roles: ['user', 'coach'], channel_id: 3, coach_ids: ['7'] },
  other: { user_id: 'other', external_id: null, roles: ['user'], channel_id: 4, coach_ids: [], coach_id: null },
  c1:    { user_id: 'c1', external_id: null, roles: ['user'], channel_id: 3, coach_ids: [], coach_id: '7' },
  adm:   { user_id: 'adm', external_id: null, roles: ['user', 'admin'], channel_id: 3, coach_ids: [] },
  root:  { user_id: 'root', external_id: null, roles: ['superadmin'], channel_id: null, coach_ids: [] },
  ghost: { user_id: 'ghost', external_id: null, roles: [], channel_id: null, coach_ids: [], merged_into_user_id: 'me' },
};
function userDb({ failCaller = false, notes = {}, invitations = {} } = {}) {
  return async (sql, params = []) => {
    if (sql.includes('AS coach_ids')) {
      if (failCaller) throw new Error('db down');
      const u = USERS[params[0]];
      return { rows: u ? [{ merged_into_user_id: null, ...u }] : [] };
    }
    if (sql.includes('FROM users WHERE user_id = $1 OR external_id = $1')) {
      const u = Object.values(USERS).find(x => x.user_id === params[0] || x.external_id === params[0]);
      return { rows: u ? [{ user_id: u.user_id, external_id: u.external_id, coach_id: u.coach_id ?? null, channel_id: u.channel_id }] : [] };
    }
    if (sql.includes('FROM coach_client_notes')) return { rows: params[0] in notes ? [{ coach_id: notes[params[0]] }] : [] };
    if (sql.includes('FROM invitations WHERE id')) return { rows: params[0] in invitations ? [{ created_by: invitations[params[0]] }] : [] };
    return { rows: [], rowCount: 0 };
  };
}
function evq(method, rawPath, { token, query = {}, body } = {}) {
  return { ...event(method, rawPath, { token, body }), queryParameters: query };
}
async function send(e) {
  const worker = require(path.join(WORKER, 'index.js'));
  const res = await worker.handler(e);
  let data = null; try { data = JSON.parse(res.body); } catch {}
  return { status: res.statusCode, data };
}

describe('per-user sessions', () => {
  let userToken;
  beforeEach(() => {
    clearWorkerModules();
    process.env.API_BEARER_TOKEN = BEARER;
    process.env.TOKEN_SIGNING_SECRET = SECRET;
    delete process.env.LEGACY_APP_BEARER;
    installDbMock(userDb({ notes: { 5: '7', 6: '99' }, invitations: { 8: 'me', 9: null } }));
    userToken = id => require(path.join(WORKER, 'lib/auth.js')).signUserToken(id);
  });
  afterEach(() => { delete process.env.API_BEARER_TOKEN; delete process.env.TOKEN_SIGNING_SECRET; delete process.env.LEGACY_APP_BEARER; });

  const reason = r => r.data && r.data.reason;

  test('own data by user_id or by WeChat openid is allowed', async () => {
    for (const openid of ['me', 'wx-me']) {
      const r = await send(evq('GET', '/biomarkers', { token: userToken('me'), query: { openid } }));
      assert.notEqual(r.status, 403, openid);
      assert.notEqual(r.status, 401, openid);
    }
  });

  test("someone else's data is 403 not_your_user; an unknown id is 403 too", async () => {
    const r = await send(evq('GET', '/biomarkers', { token: userToken('me'), query: { openid: 'other' } }));
    assert.equal(r.status, 403); assert.equal(reason(r), 'not_your_user');
    const u = await send(evq('POST', '/chat', { token: userToken('me'), body: { openid: 'nobody', message: 'hi' } }));
    assert.equal(u.status, 403); assert.equal(reason(u), 'unknown_user');
  });

  test("a coach may act on their own client, with their own coach_id only", async () => {
    assert.notEqual((await send(evq('POST', '/kino-scan', { token: userToken('me'), body: { openid: 'c1', chip_id: 'X' } }))).status, 403);
    assert.notEqual((await send(evq('GET', '/coach-users/7', { token: userToken('me') }))).status, 403);
    const r = await send(evq('GET', '/coach-users/8', { token: userToken('me') }));
    assert.equal(reason(r), 'coach_id_not_caller');
    const q = await send(evq('GET', '/coach-notes', { token: userToken('me'), query: { coach_id: '99', user_id: 'c1' } }));
    assert.equal(reason(q), 'coach_id_not_caller');
  });

  test('a client cannot act on their coach or another client', async () => {
    const r = await send(evq('GET', '/users/me', { token: userToken('c1') }));
    assert.equal(r.status, 403);
  });

  test('routes the clients never call are refused', async () => {
    for (const [m, p] of [['GET', '/channels'], ['POST', '/users'], ['GET', '/users'], ['POST', '/admin-phone-add'], ['POST', '/session/upgrade']]) {
      const r = await send(evq(m, p, { token: userToken('root') }));
      assert.equal(r.status, 403, `${m} ${p}`);
    }
  });

  test('Kino simulator routes need an admin role', async () => {
    assert.equal(reason(await send(evq('GET', '/kino-chip', { token: userToken('me'), query: { chip_id: 'X' } }))), 'role_required');
    assert.notEqual((await send(evq('GET', '/kino-chip', { token: userToken('adm'), query: { chip_id: 'X' } }))).status, 403);
  });

  test('a channel admin may name users in their own channel; channel_id must be the caller\'s', async () => {
    assert.notEqual((await send(evq('GET', '/biomarkers', { token: userToken('adm'), query: { openid: 'c1' } }))).status, 403);
    assert.equal((await send(evq('GET', '/biomarkers', { token: userToken('adm'), query: { openid: 'other' } }))).status, 403);
    assert.equal(reason(await send(evq('GET', '/events', { token: userToken('me'), query: { channel_id: '4', user_id: 'me' } }))), 'channel_id_not_caller');
  });

  test('a superadmin user may name anyone (sandbox) but only on client routes', async () => {
    assert.notEqual((await send(evq('GET', '/biomarkers', { token: userToken('root'), query: { openid: 'other' } }))).status, 403);
  });

  test('records named only by id are checked through their owner', async () => {
    assert.notEqual((await send(evq('DELETE', '/coach-notes/5', { token: userToken('me') }))).status, 403);
    assert.equal(reason(await send(evq('DELETE', '/coach-notes/6', { token: userToken('me') }))), 'coach_id_not_caller');
    assert.notEqual((await send(evq('PATCH', '/invitations/8', { token: userToken('me'), body: { note: 'x' } }))).status, 403);
    assert.equal(reason(await send(evq('DELETE', '/invitations/9', { token: userToken('me') }))), 'record_has_no_owner');
    assert.notEqual((await send(evq('DELETE', '/coach-notes/404', { token: userToken('me') }))).status, 403, 'missing record is the handler\'s 404');
  });

  test('a merged-away account acts as its merge target', async () => {
    assert.notEqual((await send(evq('GET', '/biomarkers', { token: userToken('ghost'), query: { openid: 'me' } }))).status, 403);
  });

  test('bad, expired or unknown-user sessions are 401 on private paths and ignored on public ones', async () => {
    assert.equal((await send(evq('GET', '/biomarkers', { token: forge('u', SECRET + 'x', { sub: 'me' }), query: { openid: 'me' } }))).status, 401);
    assert.equal((await send(evq('GET', '/biomarkers', { token: userToken('deleted'), query: { openid: 'deleted' } }))).status, 401);
    const r = await send(evq('POST', '/wx-login', { token: forge('u', 'nope', { sub: 'me' }), body: {} }));
    assert.notEqual(r.status, 401, 'an expired session must not block logging in again');
  });

  test('a DB failure loading the caller is 503, not a logout', async () => {
    clearWorkerModules();
    installDbMock(userDb({ failCaller: true }));
    const r = await send(evq('GET', '/biomarkers', { token: userToken('me'), query: { openid: 'me' } }));
    assert.equal(r.status, 503);
  });

  test('refresh returns a new session for the caller; upgrade only for the legacy bearer', async () => {
    const r = await send(evq('POST', '/session/refresh', { token: userToken('me') }));
    assert.equal(r.data.user_id, 'me');
    assert.match(r.data.session_token, /^u\./);
    const up = await send(evq('POST', '/session/upgrade', { token: BEARER, body: { user_id: 'ghost' } }));
    assert.equal(up.data.user_id, 'me', 'upgrade follows a merge');
    const { verifyUserToken } = require(path.join(WORKER, 'lib/auth.js'));
    assert.equal(verifyUserToken(up.data.session_token).sub, 'me');
  });

  test('LEGACY_APP_BEARER=reject: the shared token is 401 and QR confirm needs a session', async () => {
    process.env.LEGACY_APP_BEARER = 'reject';
    assert.equal((await send(evq('GET', '/biomarkers', { token: BEARER, query: { openid: 'me' } }))).status, 401);
    assert.equal((await send(evq('POST', '/qr-login/confirm', { body: { session_id: 's', openid: 'me' } }))).status, 401);
    const other = await send(evq('POST', '/qr-login/confirm', { token: userToken('me'), body: { session_id: 's', openid: 'other' } }));
    assert.equal(other.status, 403, 'cannot confirm a QR login as someone else');
  });
});

describe('session issuance', () => {
  beforeEach(() => { clearWorkerModules(); process.env.TOKEN_SIGNING_SECRET = SECRET; process.env.API_BEARER_TOKEN = BEARER; process.env.GCN_API_TOKEN = 'gcn-tok'; });
  afterEach(() => { delete process.env.TOKEN_SIGNING_SECRET; delete process.env.API_BEARER_TOKEN; delete process.env.GCN_API_TOKEN; });

  const wvtDb = async (sql) => {
    if (sql.includes('FROM webview_tokens') || sql.includes('UPDATE webview_tokens')) return { rows: [{ user_id: 'me', openid: 'me', context: null }] };
    if (sql.includes('FROM users')) return { rows: [{ user_id: 'me', nickname: 'N', roles: ['user'], channel_id: null }] };
    return { rows: [] };
  };

  test('the browser exchanging a wvt gets a session; GCN exchanging it server-side does not', async () => {
    installDbMock(wvtDb);
    const browser = await send(evq('POST', '/exchange-webview-token', { body: { wvt: 'w' } }));
    if (browser.data.success) {
      assert.match(browser.data.session_token, /^u\./);
      const gcn = await send(evq('POST', '/exchange-webview-token', { token: 'gcn-tok', body: { wvt: 'w' } }));
      assert.equal(gcn.data.session_token, undefined);
    } else {
      assert.fail(`exchange mock did not match the handler's SQL: ${JSON.stringify(browser.data)}`);
    }
  });
});

describe('per-user session body and query limits', () => {
  beforeEach(() => {
    clearWorkerModules();
    process.env.API_BEARER_TOKEN = BEARER;
    process.env.TOKEN_SIGNING_SECRET = SECRET;
  });
  afterEach(() => { delete process.env.API_BEARER_TOKEN; delete process.env.TOKEN_SIGNING_SECRET; });

  test('PUT /users drops roles/channel/coach/phone before the handler; own coach_id is not a claim', async () => {
    const writes = [];
    installDbMock(async (sql, params) => {
      if (sql.includes('UPDATE users') || sql.includes('INSERT')) writes.push({ sql, params });
      return userDb()(sql, params);
    });
    const token = require(path.join(WORKER, 'lib/auth.js')).signUserToken('c1');
    const r = await send(evq('PUT', '/users/c1', { token, body: { nickname: 'n', roles: ['superadmin'], channel_id: 1, coach_id: 7, phone: '+8613800000000' } }));
    assert.notEqual(r.status, 403);
    const all = JSON.stringify(writes);
    assert.ok(!all.includes('superadmin'), all);
    assert.ok(!all.includes('13800000000'), all);
  });

  test('oss presign: academy keys only; an order may only be cancelled', async () => {
    installDbMock(userDb());
    const token = require(path.join(WORKER, 'lib/auth.js')).signUserToken('me');
    const bad = await send(evq('GET', '/oss/presign', { token, query: { action: 'get', key: 'health-documents/other/x.pdf' } }));
    assert.equal(bad.data.reason, 'query_not_allowed');
    const dots = await send(evq('GET', '/oss/presign', { token, query: { action: 'get', key: 'academy/../health/x' } }));
    assert.equal(dots.data.reason, 'query_not_allowed');
    const paid = await send(evq('PUT', '/orders/3', { token, body: { status: 'paid' } }));
    assert.equal(paid.data.reason, 'value_not_allowed');
  });

  test('DELETE /users/:me only for an account minutes old', async () => {
    const old = { ...USERS.me, created_at: new Date(Date.now() - 86400000) };
    installDbMock(async (sql, params) => sql.includes('AS coach_ids') ? { rows: [{ merged_into_user_id: null, ...old }] } : { rows: [] });
    const token = require(path.join(WORKER, 'lib/auth.js')).signUserToken('me');
    assert.equal((await send(evq('DELETE', '/users/me', { token }))).data.reason, 'account_not_new');
  });
});

describe('chat speaker (coach about a managed customer)', () => {
  beforeEach(() => { clearWorkerModules(); process.env.API_BEARER_TOKEN = BEARER; process.env.TOKEN_SIGNING_SECRET = SECRET; });
  afterEach(() => { delete process.env.API_BEARER_TOKEN; delete process.env.TOKEN_SIGNING_SECRET; });

  const withAccount = accountType => async (sql, params) => {
    if (sql.includes('coach_id::text AS coach_id, account_type')) return { rows: [{ coach_id: '7', account_type: accountType }] };
    return userDb()(sql, params);
  };
  const chat = async (db, body) => {
    installDbMock(db);
    const token = require(path.join(WORKER, 'lib/auth.js')).signUserToken('me');
    const { authorizeChatSpeaker, loadCaller } = require(path.join(WORKER, 'lib/userAccess.js'));
    return authorizeChatSpeaker(await loadCaller('me'), body);
  };

  test('a coach may not speak as a regular client', async () => {
    assert.equal((await chat(withAccount('regular'), { openid: 'c1', message: 'hi' })).reason, 'chat_as_other_user');
    assert.equal((await chat(withAccount('regular'), { openid: 'c1', message: 'hi', speaker: 'coach' })).reason, 'coach_chat_managed_only');
  });

  test('a coach may ask Viva about their managed customer', async () => {
    assert.equal(await chat(withAccount('managed'), { openid: 'c1', message: 'hi', speaker: 'coach' }), null);
  });

  test('speaker is dropped when a user chats as themselves', async () => {
    const body = { openid: 'me', message: 'hi', speaker: 'coach' };
    assert.equal(await chat(withAccount('regular'), body), null);
    assert.equal(body.speaker, undefined);
  });
});
