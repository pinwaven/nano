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

describe('worker lab checkout API', () => {
  beforeEach(() => {
    clearWorkerModules();
    process.env.API_BEARER_TOKEN = 'test-token';
  });

  test('POST /lab-orders/checkout requires at least one selected good', async () => {
    installDbMock({
      async query() {
        throw new Error('database should not be called for invalid checkout');
      },
    });

    const response = await request('POST', '/lab-orders/checkout', {
      openid: 'u1',
      lab_name: 'qcs',
      goods: [],
      address_id: 7,
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.data.success, false);
    assert.match(response.data.error, /goods/i);
  });

  test('POST /lab-orders/checkout creates an order summary and transaction lines', async () => {
    const queries = [];
    const client = {
      async query(sql, params) {
        queries.push({ sql, params });
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
        if (sql.includes('FROM user_addresses')) {
          assert.deepEqual(params, ['u1', 7]);
          return {
            rows: [{
              id: 7,
              contact_name: '张三',
              phone: '13800000000',
              province: '上海',
              city: '上海市',
              district: '浦东新区',
              address_line1: '世纪大道 1 号',
              postal_code: null,
            }],
          };
        }
        if (sql.includes('FROM lab_products')) {
          assert.deepEqual(params, ['qcs', ['3120', '1001']]);
          return {
            rows: [
              { id: 11, lab_name: 'qcs', sku: '3120', name_zh: '慢性食物敏', name_en: 'Food Sensitivity', unit_zh: '1项', unit_en: '1 test', price_cny: 60000, price_usd: null },
              { id: 12, lab_name: 'qcs', sku: '1001', name_zh: '糖化血红蛋白', name_en: 'Hemoglobin A1c', unit_zh: '1项', unit_en: '1 test', price_cny: 20000, price_usd: null },
            ],
          };
        }
        if (sql.includes('INSERT INTO orders')) {
          assert.equal(params[0], 'u1');
          assert.equal(params[2], 'lab:qcs');
          assert.equal(params[3], 2);
          assert.equal(params[4], 800);
          assert.equal(params[8], 7);
          assert.equal(params[10], 80000);
          assert.equal(params[12], 'lab_checkout');
          return { rows: [{ id: 'order-1' }] };
        }
        if (sql.includes('INSERT INTO transactions')) {
          assert.equal(params[0], 'order-1');
          assert.equal(params[1], 'u1');
          assert.equal(params[2], 'lab_checkout');
          assert.equal(params[3], 'qcs');
          assert.deepEqual(params[4], ['3120', '1001']);
          assert.deepEqual(params[5], [1, 1]);
          assert.deepEqual(params[11], [60000, 20000]);
          return { rowCount: 2, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      },
      release() {},
    };
    installDbMock({
      async connect() {
        return client;
      },
    });

    const response = await request('POST', '/lab-orders/checkout', {
      openid: 'u1',
      lab_name: 'qcs',
      goods: [{ sku: '3120' }, { sku: '1001' }],
      address_id: 7,
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.data.success, true);
    assert.equal(response.data.order.id, 'order-1');
    assert.equal(response.data.order.total_amount_cny, 80000);
    assert.equal(response.data.order.quantity, 2);
    assert.equal(response.data.transactions.length, 2);
    assert.deepEqual(queries.map(q => q.sql === 'BEGIN' || q.sql === 'COMMIT' ? q.sql : q.sql.split(/\s+/).slice(0, 3).join(' ')), [
      'BEGIN',
      'SELECT id, contact_name,',
      'SELECT id, lab_name,',
      'INSERT INTO orders',
      'INSERT INTO transactions',
      'COMMIT',
    ]);
  });
});
