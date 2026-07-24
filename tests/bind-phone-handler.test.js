'use strict';

const assert = require('node:assert');
const { describe, test, beforeEach, afterEach } = require('node:test');

// Patch the db pool and WeChat token helper BEFORE requiring the handler, since
// login.js destructures both at load time. A dummy DATABASE_URL makes db.js build
// a lazy Pool (no connection) whose query method we override below.
process.env.DATABASE_URL = 'postgres://localhost:5432/test';
const db = require('../src/functions/worker/lib/db');
const auth = require('../src/functions/worker/lib/auth');

let queries;
let updateRowCount;
db.pool.query = async (sql, params = []) => {
  queries.push({ sql, params });
  if (sql.startsWith('UPDATE users SET phone')) {
    return { rowCount: updateRowCount };
  }
  return { rows: [], rowCount: 0 };
};
auth.getWxAccessToken = async () => 'test-token';

const { handleBindPhone } = require('../src/functions/worker/handlers/login');

const origFetch = global.fetch;

describe('handleBindPhone', () => {
  beforeEach(() => {
    queries = [];
    updateRowCount = 1;
    process.env.WX_APPID = 'wx-nano';
    process.env.WX_SECRET = 'secret-nano';
    global.fetch = async () => ({
      json: async () => ({ phone_info: { purePhoneNumber: '13800000000' } }),
    });
  });

  afterEach(() => {
    global.fetch = origFetch;
  });

  test('rejects when user_id is missing (code mode)', async () => {
    const res = await handleBindPhone(null, 'phone-code', 'wx-nano');
    assert.strictEqual(res.success, false);
    assert.match(res.error, /user_id is required/);
    // Must not have hit the WeChat API or the DB.
    assert.strictEqual(queries.length, 0);
  });

  test('returns User not found when UPDATE matches no rows', async () => {
    updateRowCount = 0;
    const res = await handleBindPhone('ffffffff', 'phone-code', 'wx-nano');
    assert.strictEqual(res.success, false);
    assert.match(res.error, /User not found/);
  });

  test('matches on external_id (openid) as well as user_id', async () => {
    const res = await handleBindPhone('openid-abc', 'phone-code', 'wx-nano');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.phone, '13800000000');
    const upd = queries.find((q) => q.sql.startsWith('UPDATE users SET phone'));
    assert.ok(upd, 'expected an UPDATE query');
    assert.match(upd.sql, /external_id = \$2/);
    assert.strictEqual(upd.params[1], 'openid-abc');
  });

  test('raw-phone mode also checks rowCount and matches external_id', async () => {
    updateRowCount = 0;
    const res = await handleBindPhone('openid-flutter', null, null, '13900000000');
    assert.strictEqual(res.success, false);
    assert.match(res.error, /User not found/);
    const upd = queries.find((q) => q.sql.startsWith('UPDATE users SET phone'));
    assert.ok(upd, 'expected an UPDATE query');
    assert.match(upd.sql, /external_id = \$2/);
    assert.strictEqual(upd.params[0], '13900000000');
    assert.strictEqual(upd.params[1], 'openid-flutter');
  });

  test('surfaces WeChat API errors instead of writing phone', async () => {
    global.fetch = async () => ({
      json: async () => ({ errcode: 40029, errmsg: 'invalid code' }),
    });
    const res = await handleBindPhone('user123', 'bad-code', 'wx-nano');
    assert.strictEqual(res.success, false);
    assert.match(res.error, /WeChat/);
    // No UPDATE should have run.
    assert.ok(!queries.some((q) => q.sql.startsWith('UPDATE users SET phone')));
  });
});
