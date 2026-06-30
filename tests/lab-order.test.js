const assert = require('node:assert/strict');
const { describe, test, beforeEach } = require('node:test');
const path = require('node:path');

function clearLabModules() {
  for (const key of Object.keys(require.cache)) {
    if (key.includes('/src/functions/lab/')) delete require.cache[key];
  }
}

function installDbMock(query) {
  const dbPath = path.resolve(__dirname, '../src/functions/lab/lib/db.js');
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: { query },
  };
}

function event(method, rawPath, body) {
  return {
    rawPath,
    requestContext: { http: { method } },
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  };
}

describe('lab order API', () => {
  beforeEach(() => {
    clearLabModules();
  });

  test('POST /lab/order creates QCS order through adapter and records lab_orders', async () => {
    const previousDefaultSampleCenterId = process.env.QCS_DEFAULT_SAMPLE_CENTER_ID;
    process.env.QCS_DEFAULT_SAMPLE_CENTER_ID = '46';
    const queries = [];
    installDbMock(async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes('FROM lab_providers')) {
        return { rows: [{ api_base_url: 'https://qcs.example/third-party', api_key_enc: 'client-id', webhook_secret_enc: 'client-secret' }] };
      }
      if (sql.includes('FROM users')) {
        return { rows: [{ user_id: 'u1', nickname: '张三', gender: 'male', birth_date: '1990-01-02', phone: '13888888888' }] };
      }
      if (sql.includes('INSERT INTO lab_orders')) {
        return { rows: [{ id: 7, lab_name: params[0], user_id: params[1], external_order_id: params[5], status: params[9] }] };
      }
      return { rows: [] };
    });

    const lab = require('../src/functions/lab');
    const calls = [];
    lab.__private.setAdapterFactory((labName) => ({
      async createOrder({ user, payload, config }) {
        calls.push({ labName, user, payload, config });
        return {
          external_order_id: 'QCS-1001',
          status: '处理中',
          lab_response: { order: { id: 'QCS-1001' }, samples: { id: 'QCS-1001', samples: [{ id: 1 }] } },
          lab_last_result: { id: 'QCS-1001', progress: 'processing' },
        };
      },
      validateWebhook() { return true; },
      parseResponse() { return []; },
    }));

    const response = await lab.handler(event('POST', '/lab/order', {
      user_id: 'u1',
      payload: {
        goods: ['1080'],
        notes: '加急',
        barcode: '287002730175',
        sample_form_id: 'dry_peripheral_plasma',
        sample_center_id: 12,
        empty_stomach: true,
      },
    }));

    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), {
      success: true,
      order: { id: 7, lab_name: 'qcs', user_id: 'u1', external_order_id: 'QCS-1001', status: '处理中' },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].labName, 'qcs');
    assert.equal(calls[0].user.user_id, 'u1');
    assert.equal(calls[0].config.api_key, 'client-id');
    assert.equal(calls[0].config.api_secret, 'client-secret');
    assert.equal(calls[0].config.default_sample_center_id, 46);
    const insert = queries.find((q) => q.sql.includes('INSERT INTO lab_orders'));
    assert.ok(insert);
    assert.equal(insert.params[0], 'qcs');
    assert.equal(insert.params[1], 'u1');
    assert.equal(insert.params[2], 'client-id');
    assert.equal(insert.params[3], 'client-secret');
    assert.equal(insert.params[5], 'QCS-1001');
    assert.equal(insert.params[9], '处理中');
    if (previousDefaultSampleCenterId === undefined) {
      delete process.env.QCS_DEFAULT_SAMPLE_CENTER_ID;
    } else {
      process.env.QCS_DEFAULT_SAMPLE_CENTER_ID = previousDefaultSampleCenterId;
    }
  });

  test('GET /lab/providers returns active labs without credentials', async () => {
    const queries = [];
    installDbMock(async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes('FROM lab_providers')) {
        return {
          rows: [
            {
              id: 1,
              lab_name: 'qcs',
              label: '量康 QCS',
              poll_enabled: true,
            },
            {
              id: 2,
              lab_name: 'generic',
              label: null,
              poll_enabled: false,
            },
          ],
        };
      }
      return { rows: [] };
    });

    const lab = require('../src/functions/lab');
    const response = await lab.handler(event('GET', '/lab/providers'));

    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), {
      success: true,
      providers: [
        { id: 1, lab_name: 'qcs', label: '量康 QCS', poll_enabled: true },
        { id: 2, lab_name: 'generic', label: null, poll_enabled: false },
      ],
    });
    assert.equal(queries.length, 1);
    assert.equal(queries[0].params, undefined);
    assert.match(queries[0].sql, /is_active = TRUE/);
    assert.doesNotMatch(queries[0].sql, /api_key_enc|webhook_secret_enc|api_base_url/);
  });

  test('GET /lab/services returns active lab services for miniapp checkout entry', async () => {
    const queries = [];
    installDbMock(async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes('FROM lab_providers')) {
        return {
          rows: [
            {
              id: 1,
              lab_name: 'qcs',
              label: '量康 QCS',
              product_count: 30,
            },
            {
              id: 2,
              lab_name: 'generic',
              label: null,
              product_count: 0,
            },
          ],
        };
      }
      return { rows: [] };
    });

    const lab = require('../src/functions/lab');
    const response = await lab.handler(event('GET', '/lab/services'));

    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), {
      success: true,
      services: [
        { id: 1, lab_name: 'qcs', label: '量康 QCS', product_count: 30 },
        { id: 2, lab_name: 'generic', label: null, product_count: 0 },
      ],
    });
    assert.equal(queries.length, 1);
    assert.equal(queries[0].params, undefined);
    assert.match(queries[0].sql, /is_active = TRUE/);
    assert.match(queries[0].sql, /lab_products/);
    assert.doesNotMatch(queries[0].sql, /api_key_enc|webhook_secret_enc|api_base_url/);
  });

  test('GET /lab/products returns active products filtered by lab name', async () => {
    const queries = [];
    installDbMock(async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes('FROM lab_products')) {
        return {
          rows: [
            {
              id: 11,
              lab_name: 'qcs',
              sku: '1080',
              upc: '287002730175',
              name_zh: '糖化血红蛋白',
              name_en: 'HbA1c',
              desc_zh: '评估血糖控制',
              desc_en: 'Glycemic control marker',
              unit_zh: '项',
              unit_en: 'test',
              extra_data_zh: { fasting: false },
              extra_data_en: { fasting: false },
              price_cny: 19900,
              price_usd: 2900,
              sort_idx: 10,
            },
          ],
        };
      }
      return { rows: [] };
    });

    const lab = require('../src/functions/lab');
    const request = event('GET', '/lab/products');
    request.rawQueryString = 'lab_name=qcs';
    request.queryParameters = { lab_name: 'qcs' };
    const response = await lab.handler(request);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), {
      success: true,
      products: [
        {
          id: 11,
          lab_name: 'qcs',
          sku: '1080',
          upc: '287002730175',
          name_zh: '糖化血红蛋白',
          name_en: 'HbA1c',
          desc_zh: '评估血糖控制',
          desc_en: 'Glycemic control marker',
          unit_zh: '项',
          unit_en: 'test',
          extra_data_zh: { fasting: false },
          extra_data_en: { fasting: false },
          price_cny: 19900,
          price_usd: 2900,
          sort_idx: 10,
        },
      ],
    });
    assert.equal(queries.length, 1);
    assert.deepEqual(queries[0].params, ['qcs']);
    assert.match(queries[0].sql, /WHERE lab_name = \$1/);
    assert.match(queries[0].sql, /active = TRUE/);
    assert.match(queries[0].sql, /ORDER BY sort_idx ASC, id ASC/);
    assert.doesNotMatch(queries[0].sql, /api_key_enc|webhook_secret_enc|api_base_url/);
  });

  test('GET /lab/products requires lab_name', async () => {
    const queries = [];
    installDbMock(async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [] };
    });

    const lab = require('../src/functions/lab');
    const response = await lab.handler(event('GET', '/lab/products'));

    assert.equal(response.statusCode, 400);
    assert.deepEqual(JSON.parse(response.body), { error: 'lab_name is required' });
    assert.equal(queries.length, 0);
  });

  test('GET /lab/qcs/sample-centers returns QCS sample center list', async () => {
    const queries = [];
    installDbMock(async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes('FROM lab_providers')) {
        return { rows: [{ api_base_url: 'https://qcs.example/third-party', api_key_enc: 'client-id', webhook_secret_enc: 'client-secret' }] };
      }
      return { rows: [] };
    });

    const lab = require('../src/functions/lab');
    const calls = [];
    lab.__private.setAdapterFactory((labName) => ({
      async listSampleCenters({ config }) {
        calls.push({ labName, config });
        return [{ id: '12', name: '某某诊所', address: { city: '上海' } }];
      },
    }));

    const response = await lab.handler(event('GET', '/lab/qcs/sample-centers'));

    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), {
      success: true,
      sample_centers: [{ id: '12', name: '某某诊所', address: { city: '上海' } }],
    });
    assert.equal(queries.length, 1);
    assert.deepEqual(queries[0].params, ['qcs']);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].labName, 'qcs');
    assert.equal(calls[0].config.api_key, 'client-id');
    assert.equal(calls[0].config.api_secret, 'client-secret');
  });

  test('GET /lab/qcs/projects returns all QCS projects grouped by barcode suffix', async () => {
    installDbMock(async () => ({ rows: [] }));

    const lab = require('../src/functions/lab');
    lab.__private.setAdapterFactory(() => ({
      allProjectsByBarcodeSuffix() {
        return {
          '07': [{ id: '1001', name: '糖化血红蛋白' }],
          '12': [{ id: '6001', name: '肠道菌群基因测序' }],
        };
      },
    }));

    const response = await lab.handler(event('GET', '/lab/qcs/projects'));

    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), {
      success: true,
      projects_by_barcode_suffix: {
        '07': [{ id: '1001', name: '糖化血红蛋白' }],
        '12': [{ id: '6001', name: '肠道菌群基因测序' }],
      },
    });
  });

  test('GET /lab/qcs/projects with barcode returns projects for barcode suffix', async () => {
    installDbMock(async () => ({ rows: [] }));

    const lab = require('../src/functions/lab');
    lab.__private.setAdapterFactory(() => ({
      projectsByBarcode(barcode) {
        assert.equal(barcode, '287002730112');
        return [
          { id: '6001', name: '肠道菌群基因测序' },
          { id: '2051', name: '幽门螺杆菌检测（鉴定）' },
        ];
      },
    }));

    const request = event('GET', '/lab/qcs/projects');
    request.rawQueryString = 'barcode=287002730112';
    request.queryParameters = { barcode: '287002730112' };
    const response = await lab.handler(request);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), {
      success: true,
      barcode: '287002730112',
      suffix: '12',
      projects: [
        { id: '6001', name: '肠道菌群基因测序' },
        { id: '2051', name: '幽门螺杆菌检测（鉴定）' },
      ],
    });
  });

  test('QCS webhook updates lab_orders with latest and final result', async () => {
    const queries = [];
    installDbMock(async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes('FROM lab_providers')) {
        return { rows: [{ api_base_url: 'https://qcs.example/third-party', api_key_enc: null, webhook_secret_enc: null }] };
      }
      if (sql.includes('UPDATE lab_orders')) {
        return { rows: [{ id: 9, status: params[2] }] };
      }
      return { rows: [] };
    });

    const lab = require('../src/functions/lab');
    lab.__private.setAdapterFactory(() => ({
      validateWebhook() { return true; },
      parseResponse() { return []; },
    }));

    const response = await lab.handler(event('POST', '/lab/webhook/qcs', {
      id: 'QCS-1001',
      progress: 'complete',
      goods: [],
    }));

    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), { status: 0 });
    const update = queries.find((q) => q.sql.includes('UPDATE lab_orders'));
    assert.ok(update);
    assert.equal(update.params[0], 'qcs');
    assert.equal(update.params[1], 'QCS-1001');
    assert.equal(update.params[2], '已完成');
    assert.deepEqual(update.params[3], { id: 'QCS-1001', progress: 'complete', goods: [] });
    assert.deepEqual(update.params[4], { id: 'QCS-1001', progress: 'complete', goods: [] });
  });

  test('poll cancels QCS partial orders whose sample creation failed', async () => {
    const queries = [];
    const cancelled = [];
    installDbMock(async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes('FROM lab_providers')) {
        return {
          rows: [{
            id: 3,
            lab_name: 'qcs',
            api_base_url: 'https://qcs.example/third-party',
            api_key_enc: 'client-id',
            webhook_secret_enc: 'client-secret',
            last_polled_at: null,
          }],
        };
      }
      if (sql.includes('FROM lab_orders')) {
        return {
          rows: [{
            id: 12,
            lab_name: 'qcs',
            external_order_id: 'QCS-PARTIAL',
            lab_last_result: { needs_cancel: true },
          }],
        };
      }
      if (sql.includes('UPDATE lab_orders')) {
        return { rows: [{ id: params[0], status: '已完成' }] };
      }
      return { rows: [] };
    });

    const lab = require('../src/functions/lab');
    lab.__private.setAdapterFactory(() => ({
      async cancelOrder({ externalOrderId, config }) {
        cancelled.push({ externalOrderId, config });
        return { id: externalOrderId, cancelled: true };
      },
      async fetchNewResults() { return []; },
      parseResponse() { return []; },
    }));

    const response = await lab.handler(Buffer.from(''));

    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), { ok: true });
    assert.deepEqual(cancelled, [{
      externalOrderId: 'QCS-PARTIAL',
      config: {
        api_base_url: 'https://qcs.example/third-party',
        api_key: 'client-id',
        api_secret: 'client-secret',
        cache: require('../src/functions/lab/lib/globalCache'),
      },
    }]);
    const update = queries.find((q) => q.sql.includes('UPDATE lab_orders'));
    assert.ok(update);
    assert.equal(update.params[0], 12);
    assert.deepEqual(update.params[1], {
      cancelled: true,
      response: { id: 'QCS-PARTIAL', cancelled: true },
    });
    assert.deepEqual(update.params[2], {
      needs_cancel: false,
      cancel_attempted: true,
      cancel_completed: true,
      cancel_error: null,
    });
  });

  test('poll fetches each unfinished non-cancelled provider order one by one', async () => {
    const queries = [];
    const fetched = [];
    installDbMock(async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes('FROM lab_providers')) {
        return {
          rows: [{
            id: 3,
            lab_name: 'qcs',
            api_base_url: 'https://qcs.example/third-party',
            api_key_enc: 'client-id',
            webhook_secret_enc: 'client-secret',
            last_polled_at: null,
          }],
        };
      }
      if (sql.includes('FROM lab_orders') && sql.includes("needs_cancel' = 'true'")) {
        return { rows: [] };
      }
      if (sql.includes('FROM lab_orders')) {
        return {
          rows: [
            { id: 21, lab_name: 'qcs', user_id: 'u1', external_order_id: 'QCS-ONE', lab_last_result: {} },
            { id: 22, lab_name: 'qcs', user_id: 'u2', external_order_id: 'QCS-TWO', lab_last_result: { cancel_completed: false } },
          ],
        };
      }
      if (sql.includes('UPDATE lab_orders')) {
        return { rows: [{ id: params[0] || 21 }] };
      }
      return { rows: [] };
    });

    const lab = require('../src/functions/lab');
    lab.__private.setAdapterFactory(() => ({
      async fetchOrder(orderId, config) {
        fetched.push({ orderId, config });
        return { id: orderId, progress: orderId === 'QCS-TWO' ? 'complete' : 'processing', goods: [] };
      },
      parseResponse() { return []; },
      async fetchNewResults() {
        throw new Error('provider-level fetchNewResults should not be used for order polling');
      },
    }));

    const response = await lab.handler(Buffer.from(''));

    assert.equal(response.statusCode, 200);
    assert.deepEqual(fetched.map(call => call.orderId), ['QCS-ONE', 'QCS-TWO']);
    assert.equal(fetched[0].config.api_secret, 'client-secret');
    const unfinishedQuery = queries.find((q) => q.sql.includes('FROM lab_orders') && q.sql.includes("status <> '已完成'"));
    assert.ok(unfinishedQuery);
    assert.deepEqual(unfinishedQuery.params, ['qcs']);
    const updates = queries.filter((q) => q.sql.includes('UPDATE lab_orders'));
    assert.equal(updates.length, 2);
    assert.equal(updates[0].params[0], 21);
    assert.equal(updates[0].params[2], '处理中');
    assert.equal(updates[1].params[0], 22);
    assert.equal(updates[1].params[2], '已完成');
  });

  test('__private.insertLabOrder issues INSERT INTO lab_orders and returns the row', async () => {
    const queries = [];
    installDbMock(async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes('INSERT INTO lab_orders')) {
        return { rows: [{ id: 42, lab_name: params[0], user_id: params[1], external_order_id: params[5] }] };
      }
      return { rows: [] };
    });

    const lab = require('../src/functions/lab');
    const row = await lab.__private.insertLabOrder({
      lab_name: 'qcs',
      user_id: 'u1',
      api_key: 'k',
      api_secret: 's',
      lab_request: { a: 1 },
      external_order_id: 'QCS-9',
      lab_response: { b: 2 },
      lab_last_result: { c: 3 },
      lab_final_result: null,
      status: '处理中',
    });

    const insert = queries.find((q) => q.sql.includes('INSERT INTO lab_orders'));
    assert.ok(insert);
    assert.equal(insert.params[0], 'qcs');
    assert.equal(insert.params[1], 'u1');
    assert.equal(insert.params[5], 'QCS-9');
    assert.deepEqual(row, { id: 42, lab_name: 'qcs', user_id: 'u1', external_order_id: 'QCS-9' });
  });

  test('__private.ingestObservations writes health_reports + health_events and returns report id', async () => {
    const queries = [];
    installDbMock(async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes('INSERT INTO health_reports')) return { rows: [{ id: 555 }] };
      return { rows: [] };
    });

    const lab = require('../src/functions/lab');
    const reportId = await lab.__private.ingestObservations('u1', 'qcs', [
      { loinc_code: '4548-4', value: 5.4, unit: '%', data_date: '2016-03-10T11:00:00.000Z', key_name: 'HbA1c', nano_dimension: 'MetabolicAge', is_kino_core: true },
    ]);

    assert.equal(reportId, 555);
    const report = queries.find((q) => q.sql.includes('INSERT INTO health_reports'));
    const events = queries.find((q) => q.sql.includes('INSERT INTO health_events'));
    assert.ok(report);
    assert.equal(report.params[0], 'u1');
    assert.equal(report.params[2], 'qcs');
    assert.ok(events);
    assert.equal(events.params[0], 'u1');
    assert.equal(events.params[1], 555);
  });
});
