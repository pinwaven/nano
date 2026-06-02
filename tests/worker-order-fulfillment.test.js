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
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { pool } };
  require.cache[ossPath] = { id: ossPath, filename: ossPath, loaded: true, exports: {} };
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
  return { ...response, data: JSON.parse(response.body) };
}

describe('worker order fulfillment API', () => {
  beforeEach(() => {
    clearWorkerModules();
    process.env.API_BEARER_TOKEN = 'test-token';
  });

  test('GET /orders returns payment, transaction and tracking fields for admin fulfillment', async () => {
    const queries = [];
    installDbMock({
      async query(sql, params) {
        queries.push({ sql, params });
        if (sql.includes('FROM orders o')) {
          assert.match(sql, /payment_status/);
          assert.match(sql, /transactions/);
          assert.match(sql, /tracking_number/);
          return {
            rows: [{
              id: 'order-1',
              user_id: 'u1',
              item_key: 'lab:qcs',
              quantity: 2,
              price_cny: 800,
              total_amount_cny: 80000,
              status: 'paid',
              order_type: 'lab',
              source: 'lab_checkout',
              tracking_number: null,
              payment_status: 'paid',
              transactions: [
                { sku: '3120', name_zh: '慢性食物敏', name_en: 'Food Sensitivity', quantity: 1, total_amount_cny: 60000, status: 'paid' },
                { sku: '1001', name_zh: '糖化血红蛋白', name_en: 'Hemoglobin A1c', quantity: 1, total_amount_cny: 20000, status: 'paid' },
              ],
            }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      },
    });

    const response = await request('GET', '/orders');

    assert.equal(response.statusCode, 200);
    assert.equal(response.data.orders[0].payment_status, 'paid');
    assert.equal(response.data.orders[0].transactions.length, 2);
    assert.equal(response.data.orders[0].order_type, 'lab');
  });

  test('PUT /orders/:id ships an order with tracking number only and syncs transaction status', async () => {
    const queries = [];
    installDbMock({
      async query(sql, params) {
        queries.push({ sql, params });
        if (sql.includes('UPDATE orders')) {
          assert.deepEqual(params, ['shipped', 'SF123456789CN', 'order-1']);
          return { rows: [] };
        }
        if (sql.includes('UPDATE transactions')) {
          assert.deepEqual(params, ['shipped', 'order-1']);
          return { rows: [] };
        }
        assert.doesNotMatch(sql, /express_shipments/);
        throw new Error(`unexpected query: ${sql}`);
      },
    });

    const response = await request('PUT', '/orders/order-1', {
      status: 'shipped',
      tracking_number: 'SF123456789CN',
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.data.success, true);
    assert.ok(queries.find(q => q.sql.includes('tracking_number')));
    assert.equal(queries.length, 2);
  });

  test('POST /orders/:id/confirm-receipt marks only the user order delivered', async () => {
    const queries = [];
    installDbMock({
      async query(sql, params) {
        queries.push({ sql, params });
        if (sql.includes('UPDATE orders')) {
          assert.match(sql, /status = 'delivered'/);
          assert.match(sql, /user_id = \$2/);
          assert.match(sql, /status = 'shipped'/);
          assert.deepEqual(params, ['order-1', 'u1']);
          return { rows: [{ id: 'order-1', user_id: 'u1', status: 'delivered' }] };
        }
        if (sql.includes('UPDATE transactions')) {
          assert.deepEqual(params, ['order-1']);
          return { rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      },
    });

    const response = await request('POST', '/orders/order-1/confirm-receipt', {
      openid: 'u1',
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.data.success, true);
    assert.equal(response.data.order.status, 'delivered');
    assert.equal(queries.length, 2);
  });

  test('POST /orders/:id/lab-order-sync records lab order metadata and testing status', async () => {
    const queries = [];
    installDbMock({
      async query(sql, params) {
        queries.push({ sql, params });
        if (sql.includes('UPDATE orders')) {
          assert.match(sql, /metadata = metadata \|\| \$3::jsonb/);
          assert.match(sql, /status IN \('delivered', 'testing'\)/);
          assert.equal(params[0], 'order-1');
          assert.equal(params[1], 'u1');
          assert.deepEqual(JSON.parse(params[2]), {
            lab_order: {
              lab_order_id: 7,
              external_order_id: 'QCS-1001',
              lab_name: 'qcs',
              barcode: '287002730175',
              empty_stomach: true,
            },
          });
          return { rows: [{ id: 'order-1', user_id: 'u1', status: 'testing' }] };
        }
        if (sql.includes('UPDATE transactions')) {
          assert.match(sql, /metadata = metadata \|\| \$2::jsonb/);
          assert.deepEqual(params, [
            'order-1',
            JSON.stringify({
              lab_order_id: 7,
              external_order_id: 'QCS-1001',
              barcode: '287002730175',
              empty_stomach: true,
            }),
          ]);
          return { rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      },
    });

    const response = await request('POST', '/orders/order-1/lab-order-sync', {
      openid: 'u1',
      lab_name: 'qcs',
      lab_order_id: 7,
      external_order_id: 'QCS-1001',
      barcode: '287002730175',
      empty_stomach: true,
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.data.success, true);
    assert.equal(response.data.order.status, 'testing');
    assert.equal(queries.length, 2);
  });
});
