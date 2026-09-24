// Managed customers (handlers/managedCustomers.js): login-less accounts a coach creates for a
// B2B channel (SuperiorMed). DB stubbed through require.cache like the other worker suites.
const assert = require('node:assert/strict');
const { beforeEach, describe, test } = require('node:test');
const path = require('node:path');

const WORKER = path.resolve(__dirname, '../src/functions/worker');

function load(query) {
  for (const key of Object.keys(require.cache)) if (key.includes('/src/functions/worker/')) delete require.cache[key];
  const stub = (p, exports) => { require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
  const client = { query, release() {} };
  stub(path.join(WORKER, 'lib/db.js'), { pool: { query, connect: async () => client } });
  stub(path.join(WORKER, 'lib/oss.js'), {});
  return require(path.join(WORKER, 'handlers/managedCustomers.js'));
}

describe('managed customer fields', () => {
  const { _private: { readFields } } = load(async () => ({ rows: [] }));

  test('birth date and gender are required to create one — BioAge needs a real age', () => {
    assert.equal(readFields({ nickname: 'A', gender: 'male' }, { requireCore: true }).error, 'birth_date_required');
    assert.equal(readFields({ nickname: 'A', birth_date: '1970-02-03' }, { requireCore: true }).error, 'gender_required');
    assert.equal(readFields({ nickname: 'A', birth_date: '2999-01-01', gender: 'male' }, { requireCore: true }).error, 'birth_date_required');
    assert.equal(readFields({ birth_date: '1970-02-03', gender: 'female' }, { requireCore: true }).error, 'name_required');
  });

  test('nickname falls back to the real name, then the channel reference', () => {
    assert.equal(readFields({ last_name: '王', first_name: '芳', birth_date: '1970-02-03', gender: 'female' }, { requireCore: true }).values.nickname, '王芳');
    assert.equal(readFields({ external_ref: 'SM-001', birth_date: '1970-02-03', gender: 'female' }, { requireCore: true }).values.nickname, 'SM-001');
  });

  test('contact phone is validated and normalized', () => {
    assert.equal(readFields({ contact_phone: '12345' }, { requireCore: false }).error, 'invalid_phone');
    assert.equal(readFields({ contact_phone: '138 0013 8000' }, { requireCore: false }).values.contact_phone, '+8613800138000');
  });
});

describe('create', () => {
  let inserts;
  beforeEach(() => { inserts = []; });

  const db = ({ enabled = true, channel = 7 } = {}) => async (sql, params) => {
    if (sql.includes('FROM coaches co JOIN users')) return { rows: [{ id: 3, user_id: 'coachU', channel_id: channel, enabled }] };
    if (sql.startsWith('INSERT INTO users') || sql.includes('INSERT INTO users')) { inserts.push({ sql, params }); return { rows: [{ user_id: params[0] }] }; }
    if (sql.includes('FROM users WHERE user_id')) return { rows: [{ user_id: params[0], account_type: 'managed' }] };
    return { rows: [] };
  };

  test('a coach in an enabled channel creates a managed account with no login identity', async () => {
    const h = load(db());
    const r = await h.handlePostManagedCustomer({ coach_id: 3, nickname: '王芳', birth_date: '1970-02-03', gender: 'female', contact_phone: '13800138000' });
    assert.equal(r.success, true);
    const { sql, params } = inserts[0];
    assert.match(sql, /external_id, external_app, account_type/);
    assert.match(sql, /VALUES \(\$1, NULL, 'managed', 'managed'/, 'no external_id, never a WeChat login');
    assert.ok(!/user_phones/.test(sql), 'no OTP login identity');
    assert.equal(params[7], '+8613800138000', 'phone stored as contact_phone only');
    assert.equal(params[9], 3, 'the creating coach is their coach');
    assert.equal(params[10], 7);
  });

  test('refused where the channel has not enabled managed customers', async () => {
    const h = load(db({ enabled: false }));
    const r = await h.handlePostManagedCustomer({ coach_id: 3, nickname: 'x', birth_date: '1970-02-03', gender: 'male' });
    assert.equal(r.statusCode, 403);
    assert.equal(r.error, 'managed_customers_not_enabled');
    assert.equal(inserts.length, 0);
  });
});

describe('release', () => {
  const release = async ({ adminCtx, user, phoneClash = false }) => {
    const writes = [];
    const h = load(async (sql, params) => {
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
      if (sql.includes('FOR UPDATE')) return { rows: user ? [user] : [] };
      if (sql.includes('WITH RECURSIVE tree')) return { rows: params[1] === 7 && params[0] === 2 ? [{ ok: 1 }] : [] };
      if (sql.includes('FROM user_phones WHERE phone')) return { rows: phoneClash ? [{ '?column?': 1 }] : [] };
      writes.push({ sql, params });
      return { rows: [] };
    });
    return { r: await h.handleReleaseManagedCustomer('m1', adminCtx), writes };
  };
  const managed = { user_id: 'm1', channel_id: 7, account_type: 'managed', contact_phone: '+8613800138000' };

  test('a channel admin of an ancestor channel releases; the phone becomes an unverified login phone', async () => {
    const { r, writes } = await release({ adminCtx: { role: 'channel', channelId: 2, perms: ['users:write'], username: 'sm-admin' }, user: managed });
    assert.equal(r.success, true);
    assert.equal(r.phone_moved, true);
    assert.ok(writes.some(w => /INSERT INTO user_phones/.test(w.sql)));
    assert.ok(writes.some(w => /phone_verified_at = NULL/.test(w.sql)));
    const flip = writes.find(w => /account_type = 'regular'/.test(w.sql));
    assert.equal(flip.params[1], 'sm-admin');
  });

  test('a phone someone else already holds stays in contact_phone', async () => {
    const { r, writes } = await release({ adminCtx: { role: 'superadmin' }, user: managed, phoneClash: true });
    assert.equal(r.phone_note, 'phone_in_use');
    assert.ok(!writes.some(w => /INSERT INTO user_phones/.test(w.sql)));
  });

  test('another channel\'s admin, a missing permission, or a regular account are refused', async () => {
    assert.equal((await release({ adminCtx: { role: 'channel', channelId: 9, perms: ['users:write'] }, user: managed })).r.statusCode, 403);
    assert.equal((await release({ adminCtx: { role: 'channel', channelId: 2, perms: ['users:read'] }, user: managed })).r.statusCode, 403);
    assert.equal((await release({ adminCtx: { role: 'superadmin' }, user: { ...managed, account_type: 'regular' } })).r.error, 'not_a_managed_customer');
  });
});

describe('redeem a channel code for a managed customer', () => {
  const run = async ({ account_type, redeemer, plan }) => {
    for (const key of Object.keys(require.cache)) if (key.includes('/src/functions/worker/')) delete require.cache[key];
    const sent = [];
    const query = async (sql, params) => {
      if (sql.includes('FROM users WHERE user_id = $1 OR external_id')) return { rows: [{ user_id: 'm1', account_type }] };
      if (sql.includes("status = 'proposed' ORDER BY id DESC")) return { rows: plan ? [{ id: plan }] : [] };
      if (sql.includes("WHERE id = $1 AND user_id = $2 AND status = 'proposed'")) return { rows: [{ id: params[0] }] };
      return { rows: [] };
    };
    const stub = (p, exports) => { require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
    stub(path.join(WORKER, 'lib/db.js'), { pool: { query, connect: async () => ({ query, release() {} }) } });
    stub(path.join(WORKER, 'lib/oss.js'), {});
    stub(path.join(WORKER, 'lib/gcnClient.js'), {
      redeemFormulationCode: async (payload) => { sent.push(payload); return { order_id: 'o1' }; },
      fetchFormulationOrders: async () => [], fetchFormulationCodes: async () => [], fetchFormulationTiers: async () => [],
      submitFastTrackFormulation: async () => ({}), gcnFetch: async () => ({}), fetchAiCatalog: async () => ({ items: [] }),
    });
    const { handlePostFormulationRedeem } = require(path.join(WORKER, 'handlers/formulation_orders.js'));
    const r = await handlePostFormulationRedeem({
      openid: 'm1', code: 'AAAA', shipping_name: 'n', shipping_phone: '139', shipping_address: 'a',
      ...(redeemer && { _redeemer_user_id: redeemer }),
    });
    return { r, sent };
  };

  test('the coach is forwarded as the redeemer, with the customer\'s live proposal', async () => {
    const { r, sent } = await run({ account_type: 'managed', redeemer: 'coachU', plan: 42 });
    assert.equal(r.success, true);
    assert.equal(sent[0].nano_user_id, 'm1');
    assert.equal(sent[0].redeemer_nano_user_id, 'coachU');
    assert.equal(sent[0].intended_nano_plan_id, 42);
  });

  test('a coach cannot redeem for a regular client', async () => {
    const { r, sent } = await run({ account_type: 'regular', redeemer: 'coachU' });
    assert.equal(r.reason, 'redeem_for_managed_only');
    assert.equal(sent.length, 0);
  });

  test('a user redeeming for themselves sends no redeemer', async () => {
    const { sent } = await run({ account_type: 'regular', redeemer: null });
    assert.equal(sent[0].redeemer_nano_user_id, undefined);
  });
});
