const assert = require('node:assert/strict');
const { beforeEach, describe, test } = require('node:test');
const path = require('node:path');

function clearWorkerModules() {
  for (const key of Object.keys(require.cache)) {
    if (key.includes('/src/functions/worker/')) delete require.cache[key];
  }
}

function installDbMock(pool) {
  const dbPath = path.resolve(__dirname, '../src/functions/worker/lib/db.js');
  const ossPath = path.resolve(__dirname, '../src/functions/worker/lib/oss.js');
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: { pool },
  };
  require.cache[ossPath] = {
    id: ossPath,
    filename: ossPath,
    loaded: true,
    exports: {},
  };
}

function event(method, rawPath, body, query = {}) {
  return {
    rawPath,
    requestContext: { http: { method } },
    headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
    queryParameters: query,
    body: JSON.stringify(body || {}),
    isBase64Encoded: false,
  };
}

async function request(method, rawPath, body, query) {
  const worker = require('../src/functions/worker');
  const response = await worker.handler(event(method, rawPath, body, query));
  return {
    ...response,
    data: JSON.parse(response.body),
  };
}

describe('worker user address API', () => {
  beforeEach(() => {
    clearWorkerModules();
    process.env.API_BEARER_TOKEN = 'test-token';
  });

  test('GET /addresses returns a user address list ordered with default first', async () => {
    const queries = [];
    installDbMock({
      async query(sql, params) {
        queries.push({ sql, params });
        if (sql.includes('FROM user_addresses')) {
          assert.deepEqual(params, ['u1']);
          assert.match(sql, /ORDER BY is_default DESC, updated_at DESC/);
          return {
            rows: [
              { id: 2, user_id: 'u1', contact_name: '张三', phone: '13800000000', province: '上海', city: '上海市', district: '浦东新区', address_line1: '世纪大道 1 号', postal_code: null, is_default: true },
            ],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      },
    });

    const response = await request('GET', '/addresses', null, { openid: 'u1' });

    assert.equal(response.statusCode, 200);
    assert.equal(response.data.success, true);
    assert.equal(response.data.addresses.length, 1);
    assert.equal(response.data.addresses[0].contact_name, '张三');
    assert.equal(queries.length, 1);
  });

  test('POST /addresses creates a default address and clears existing defaults', async () => {
    const queries = [];
    installDbMock({
      async query(sql, params) {
        queries.push({ sql, params });
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
        if (sql.includes('UPDATE user_addresses SET is_default = FALSE')) {
          assert.deepEqual(params, ['u1']);
          return { rows: [] };
        }
        if (sql.includes('INSERT INTO user_addresses')) {
          assert.deepEqual(params, ['u1', '李四', '13900000000', '浙江', '杭州市', '西湖区', '文三路 2 号', '310000', true]);
          return { rows: [{ id: 7, user_id: 'u1', contact_name: '李四', phone: '13900000000', province: '浙江', city: '杭州市', district: '西湖区', address_line1: '文三路 2 号', postal_code: '310000', is_default: true }] };
        }
        throw new Error(`unexpected query: ${sql}`);
      },
    });

    const response = await request('POST', '/addresses', {
      openid: 'u1',
      contact_name: '李四',
      phone: '13900000000',
      province: '浙江',
      city: '杭州市',
      district: '西湖区',
      address_line1: '文三路 2 号',
      postal_code: '310000',
      is_default: true,
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.data.success, true);
    assert.equal(response.data.address.id, 7);
    assert.deepEqual(queries.map(q => q.sql === 'BEGIN' || q.sql === 'COMMIT' ? q.sql : q.sql.split(/\s+/).slice(0, 3).join(' ')), [
      'BEGIN',
      'UPDATE user_addresses SET',
      'INSERT INTO user_addresses',
      'COMMIT',
    ]);
  });

  test('PUT /addresses/:id updates an address and can make it default', async () => {
    const queries = [];
    installDbMock({
      async query(sql, params) {
        queries.push({ sql, params });
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
        if (sql.includes('UPDATE user_addresses SET is_default = FALSE')) {
          assert.deepEqual(params, ['u1']);
          return { rows: [] };
        }
        if (sql.includes('UPDATE user_addresses') && sql.includes('RETURNING')) {
          assert.deepEqual(params, ['王五', '13700000000', '江苏', '南京市', '建邺区', '江东中路 3 号', '', true, 'u1', '12']);
          return { rows: [{ id: 12, user_id: 'u1', contact_name: '王五', phone: '13700000000', province: '江苏', city: '南京市', district: '建邺区', address_line1: '江东中路 3 号', postal_code: '', is_default: true }] };
        }
        throw new Error(`unexpected query: ${sql}`);
      },
    });

    const response = await request('PUT', '/addresses/12', {
      openid: 'u1',
      contact_name: '王五',
      phone: '13700000000',
      province: '江苏',
      city: '南京市',
      district: '建邺区',
      address_line1: '江东中路 3 号',
      is_default: true,
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.data.success, true);
    assert.equal(response.data.address.is_default, true);
  });

  test('DELETE /addresses/:id removes only the current user address', async () => {
    const queries = [];
    installDbMock({
      async query(sql, params) {
        queries.push({ sql, params });
        if (sql.includes('DELETE FROM user_addresses')) {
          assert.deepEqual(params, ['u1', '12']);
          return { rowCount: 1, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      },
    });

    const response = await request('DELETE', '/addresses/12', { openid: 'u1' });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.data, { success: true });
    assert.equal(queries.length, 1);
  });
});
