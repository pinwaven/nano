const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { describe, test } = require('node:test');

function qcsSignature(url, rawBody, secret) {
  return crypto
    .createHmac('sha1', secret)
    .update(Buffer.concat([
      Buffer.from(`${url}\\n`, 'utf8'),
      Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8'),
    ]))
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

describe('QCS lab adapter', () => {
  test('validates QCS callback using lab_providers api_key_enc and webhook_secret_enc values', () => {
    const qcs = require('../src/functions/lab/lib/adapters/qcs');
    const url = '/lab/webhook/qcs?x=1';
    const rawBody = '{"id":"QCS-001","progress":"complete"}';
    const signature = qcsSignature(url, rawBody, 'client-secret');

    assert.equal(qcs.validateWebhook(
      { authorization: `QCS client-id:${signature}` },
      rawBody,
      'client-secret',
      { url, accessKey: 'client-id' }
    ), true);
  });

  test('validates QCS callback with raw body Buffer bytes', () => {
    const qcs = require('../src/functions/lab/lib/adapters/qcs');
    const url = '/lab/webhook/qcs?b=2&a=%E5%BC%A0';
    const rawBody = Buffer.from('{"name":"张三","progress":"complete"}', 'utf8');
    const signature = qcsSignature(url, rawBody, 'client-secret');

    assert.equal(qcs.validateWebhook(
      { authorization: `QCS client-id:${signature}` },
      rawBody,
      'client-secret',
      { url, accessKey: 'client-id' }
    ), true);
  });

  test('rejects signatures calculated with a real newline separator', () => {
    const qcs = require('../src/functions/lab/lib/adapters/qcs');
    const url = '/lab/webhook/qcs';
    const rawBody = '{"id":"QCS-001"}';
    const newlineSignature = crypto
      .createHmac('sha1', 'client-secret')
      .update(`${url}\n${rawBody}`)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

    assert.equal(qcs.validateWebhook(
      { authorization: `QCS client-id:${newlineSignature}` },
      rawBody,
      'client-secret',
      { url, accessKey: 'client-id' }
    ), false);
  });

  test('rejects changed body or wrong client id', () => {
    const qcs = require('../src/functions/lab/lib/adapters/qcs');
    const url = '/lab/webhook/qcs';
    const rawBody = '{"id":"QCS-001"}';
    const signature = qcsSignature(url, rawBody, 'client-secret');

    assert.equal(qcs.validateWebhook(
      { authorization: `QCS other:${signature}` },
      rawBody,
      'client-secret',
      { url, accessKey: 'client-id' }
    ), false);
    assert.equal(qcs.validateWebhook(
      { authorization: `QCS client-id:${signature}` },
      `${rawBody} `,
      'client-secret',
      { url, accessKey: 'client-id' }
    ), false);
  });

  test('parses QCS order bodyindexes into lab observations', () => {
    const qcs = require('../src/functions/lab/lib/adapters/qcs');
    const observations = qcs.parseResponse({
      id: 'QCS-001',
      member: { id: 'user-1' },
      goods: [{
        bodyindex_panels: [{
          bodyindexes: [
            { english_name: 'HbA1c', value: '5.4', unit: '%' },
            { english_name: 'Unknown', value: null, unit: '' },
          ],
        }],
      }],
      updated_at: 1457607600,
    });

    assert.deepEqual(observations, [{
      loinc_code: '4548-4',
      value: 5.4,
      unit: '%',
      data_date: '2016-03-10T11:00:00.000Z',
      lab_patient_id: 'user-1',
    }]);
  });

  test('createOrder derives sample_form_id from barcode suffix when calling samples endpoint', async () => {
    const qcs = require('../src/functions/lab/lib/adapters/qcs');
    const calls = [];
    const transport = {
      async post(url, data, options) {
        calls.push({ url, data, headers: options.headers });
        if (url.endsWith('/oauth/access_token')) return { data: { access_token: 'token' } };
        if (url.endsWith('/services/labtest/orders/_id_check')) {
          return { data: { data: { id: 'QCS-1001', progress: 'tobeconfirmed' } } };
        }
        return { data: { data: { id: 'QCS-1001', progress: 'processing', samples: [{ id: 1 }] } } };
      },
    };

    const result = await qcs.createOrder({
      user: { user_id: 'u1', nickname: '张三', gender: 'male', birth_date: '1990-01-02', phone: '13888888888' },
      payload: {
        goods: ['1080'],
        notes: '加急',
        barcode: '287002730175',
        sample_center_id: 12,
        empty_stomach: true,
      },
      config: { api_base_url: 'https://qcs.example/third-party', api_key: 'client-id', api_secret: 'client-secret', transport },
    });

    assert.equal(calls[1].url, 'https://qcs.example/third-party/services/labtest/orders/_id_check');
    assert.deepEqual(calls[1].data, {
      member: {
        id: 'u1',
        name: '张三',
        gender: 'male',
        birthday: 631238400,
        contact: '13888888888',
      },
      goods: ['1080'],
      note: '加急',
    });
    assert.equal(calls[2].url, 'https://qcs.example/third-party/services/labtest/orders/QCS-1001/samples');
    assert.deepEqual(calls[2].data, {
      barcode: '287002730175',
      sample_form_id: 'dry_peripheral_plasma',
      sample_center_id: 12,
      sample_time: calls[2].data.sample_time,
      empty_stomach: true,
    });
    assert.equal(result.external_order_id, 'QCS-1001');
    assert.equal(result.status, '处理中');
    assert.deepEqual(result.lab_last_result, { id: 'QCS-1001', progress: 'processing', samples: [{ id: 1 }] });
  });

  test('createOrder returns a persisted partial order when samples endpoint fails', async () => {
    const qcs = require('../src/functions/lab/lib/adapters/qcs');
    qcs.clearTokenCache();
    const transport = {
      async post(url) {
        if (url.endsWith('/oauth/access_token')) return { data: { access_token: 'token' } };
        if (url.endsWith('/services/labtest/orders/_id_check')) {
          return { data: { data: { id: 'QCS-PARTIAL', progress: 'tobeconfirmed' } } };
        }
        const err = new Error('Request failed with status code 411');
        err.response = { status: 411, data: { message: 'sample required' } };
        throw err;
      },
    };

    const result = await qcs.createOrder({
      user: { user_id: 'u1', nickname: '张三' },
      payload: { goods: ['1080'], barcode: '287002730175', sample_center_id: 12 },
      config: { api_base_url: 'https://qcs.example/third-party', api_key: 'client-id', api_secret: 'client-secret', transport },
    });

    assert.equal(result.external_order_id, 'QCS-PARTIAL');
    assert.equal(result.status, '待处理');
    assert.deepEqual(result.lab_response, {
      order: { id: 'QCS-PARTIAL', progress: 'tobeconfirmed' },
      samples_error: {
        status: 411,
        body: { message: 'sample required' },
        message: 'Request failed with status code 411',
      },
    });
    assert.deepEqual(result.lab_last_result, {
      id: 'QCS-PARTIAL',
      progress: 'tobeconfirmed',
      sample_created: false,
      needs_cancel: true,
      sample_error: {
        status: 411,
        body: { message: 'sample required' },
        message: 'Request failed with status code 411',
      },
    });
    assert.equal(result.lab_final_result, null);
  });

  test('cancelOrder calls QCS cancel order endpoint', async () => {
    const qcs = require('../src/functions/lab/lib/adapters/qcs');
    qcs.clearTokenCache();
    const calls = [];
    const transport = {
      async post(url) {
        calls.push({ method: 'POST', url });
        return { data: { access_token: 'token' } };
      },
      async request(options) {
        calls.push({ method: options.method, url: options.url, headers: options.headers });
        return { data: { data: { id: 'QCS-PARTIAL', cancelled: true } } };
      },
    };

    const result = await qcs.cancelOrder({
      externalOrderId: 'QCS-PARTIAL',
      config: { api_base_url: 'https://qcs.example/third-party', api_key: 'client-id', api_secret: 'client-secret', transport },
    });

    assert.deepEqual(result, { id: 'QCS-PARTIAL', cancelled: true });
    assert.equal(calls[1].method, 'DELETE');
    assert.equal(calls[1].url, 'https://qcs.example/third-party/services/labtest/orders/QCS-PARTIAL');
    assert.equal(calls[1].headers.Authorization, 'Bearer token');
  });

  test('listSampleCenters calls QCS sample centers endpoint', async () => {
    const qcs = require('../src/functions/lab/lib/adapters/qcs');
    qcs.clearTokenCache();
    const calls = [];
    const transport = {
      async post(url) {
        calls.push({ method: 'POST', url });
        return { data: { access_token: 'token' } };
      },
      async get(url, options) {
        calls.push({ method: 'GET', url, headers: options.headers });
        return {
          data: {
            data: [
              { id: '12', name: '某某诊所', address: { city: '上海' } },
            ],
          },
        };
      },
    };

    const result = await qcs.listSampleCenters({
      config: { api_base_url: 'https://qcs.example/third-party', api_key: 'client-id', api_secret: 'client-secret', transport },
    });

    assert.deepEqual(result, [{ id: '12', name: '某某诊所', address: { city: '上海' } }]);
    assert.equal(calls[1].method, 'GET');
    assert.equal(calls[1].url, 'https://qcs.example/third-party/services/labtest/sample-centers');
    assert.equal(calls[1].headers.Authorization, 'Bearer token');
  });

  test('maps barcode suffix to QCS sample form id and defaults to dry peripheral plasma', () => {
    const qcs = require('../src/functions/lab/lib/adapters/qcs');

    assert.equal(qcs.sampleFormIdFromBarcode('287002730107'), 'dry_peripheral_plasma');
    assert.equal(qcs.sampleFormIdFromBarcode('287002730109'), 'saliva');
    assert.equal(qcs.sampleFormIdFromBarcode('287002730112'), 'faeces');
    assert.equal(qcs.sampleFormIdFromBarcode('287002730120'), 'oral_mucosa_cells');
    assert.equal(qcs.sampleFormIdFromBarcode('287002730199'), 'dry_peripheral_plasma');
    assert.equal(qcs.sampleFormIdFromBarcode(''), 'dry_peripheral_plasma');
  });

  test('returns QCS project list by barcode suffix', () => {
    const qcs = require('../src/functions/lab/lib/adapters/qcs');

    assert.deepEqual(qcs.projectsByBarcode('287002730107').slice(0, 3), [
      { id: '1001', name: '糖化血红蛋白' },
      { id: '1002', name: '同型半胱氨酸' },
      { id: '1003', name: '25羟基维生素D三项' },
    ]);
    assert.deepEqual(qcs.projectsByBarcode('287002730112'), [
      { id: '6001', name: '肠道菌群基因测序' },
      { id: '2051', name: '幽门螺杆菌检测（鉴定）' },
      { id: '2052', name: '幽门螺杆菌检测（鉴定+5耐药）' },
    ]);
    assert.deepEqual(qcs.projectsByBarcode('287002730199'), []);
  });

  test('returns all QCS projects grouped by barcode suffix', () => {
    const qcs = require('../src/functions/lab/lib/adapters/qcs');
    const groups = qcs.allProjectsByBarcodeSuffix();

    assert.equal(groups['07'][0].id, '1001');
    assert.equal(groups['07'][0].name, '糖化血红蛋白');
    assert.deepEqual(groups['11'], [
      { id: '3013', name: '环境荷尔蒙（防腐剂、清洁剂、增塑剂，13项）' },
    ]);
    assert.deepEqual(groups['04'], []);
  });

  test('logs QCS error response body before rethrowing request failures', async () => {
    const qcs = require('../src/functions/lab/lib/adapters/qcs');
    qcs.clearTokenCache();
    const originalLog = console.log;
    const logs = [];
    console.log = (line) => logs.push(JSON.parse(line));
    try {
      const transport = {
        async post(url) {
          const err = new Error('Request failed with status code 422');
          err.response = {
            status: 422,
            data: { message: 'sample_center_id is invalid', errors: { sample_center_id: ['invalid'] } },
          };
          err.config = { method: 'post', url };
          throw err;
        },
      };

      await assert.rejects(() => qcs.createOrder({
        user: { user_id: 'u1', nickname: '张三' },
        payload: { goods: ['1080'], barcode: '287002730175', sample_center_id: 999 },
        config: { api_base_url: 'https://qcs.example/third-party', api_key: 'client-id', api_secret: 'client-secret', transport },
      }));

      assert.equal(logs.length, 1);
      assert.deepEqual(logs[0], {
        level: 'ERROR',
        msg: 'QCS request failed',
        stage: 'oauth/access_token',
        method: 'POST',
        url: 'https://qcs.example/third-party/oauth/access_token',
        status: 422,
        response_body: { message: 'sample_center_id is invalid', errors: { sample_center_id: ['invalid'] } },
      });
    } finally {
      console.log = originalLog;
    }
  });

  test('caches QCS access token across createOrder calls until expiry window', async () => {
    const qcs = require('../src/functions/lab/lib/adapters/qcs');
    qcs.clearTokenCache();
    const calls = [];
    const transport = {
      async post(url, data, options) {
        calls.push({ url, data, headers: options.headers });
        if (url.endsWith('/oauth/access_token')) return { data: { access_token: 'cached-token', expires_in: 7200 } };
        if (url.endsWith('/services/labtest/orders/_id_check')) {
          return { data: { data: { id: `QCS-${calls.length}`, progress: 'tobeconfirmed' } } };
        }
        return { data: { data: { id: 'QCS-sample', progress: 'processing', samples: [] } } };
      },
    };
    const config = {
      api_base_url: 'https://qcs.example/third-party',
      api_key: 'client-id',
      api_secret: 'client-secret',
      transport,
      now: () => 1000,
    };

    await qcs.createOrder({
      user: { user_id: 'u1', nickname: '张三' },
      payload: { goods: ['1080'], barcode: '287002730175', sample_center_id: 12 },
      config,
    });
    await qcs.createOrder({
      user: { user_id: 'u1', nickname: '张三' },
      payload: { goods: ['1080'], barcode: '287002730175', sample_center_id: 12 },
      config,
    });

    assert.equal(calls.filter((call) => call.url.endsWith('/oauth/access_token')).length, 1);
    assert.equal(calls.filter((call) => call.headers?.Authorization === 'Bearer cached-token').length, 4);
  });

  test('uses global_cache access token before requesting a new QCS token', async () => {
    const qcs = require('../src/functions/lab/lib/adapters/qcs');
    qcs.clearTokenCache();
    const transportCalls = [];
    const cache = {
      async get(key) {
        assert.equal(key, 'qcs:access_token:https://qcs.example/third-party:client-id');
        return { access_token: 'db-token', expires_at_ms: 1000 + 7200 * 1000 };
      },
      async set() {
        throw new Error('should not write cache when DB token is valid');
      },
    };
    const transport = {
      async post(url, data, options) {
        transportCalls.push({ url, data, headers: options.headers });
        if (url.endsWith('/oauth/access_token')) throw new Error('should not fetch oauth token');
        if (url.endsWith('/services/labtest/orders/_id_check')) {
          return { data: { data: { id: 'QCS-DB', progress: 'tobeconfirmed' } } };
        }
        return { data: { data: { id: 'QCS-DB', progress: 'processing', samples: [] } } };
      },
    };

    await qcs.createOrder({
      user: { user_id: 'u1', nickname: '张三' },
      payload: { goods: ['1080'], barcode: '287002730175', sample_center_id: 12 },
      config: {
        api_base_url: 'https://qcs.example/third-party',
        api_key: 'client-id',
        api_secret: 'client-secret',
        transport,
        cache,
        now: () => 1000,
      },
    });

    assert.equal(transportCalls.length, 2);
    assert.equal(transportCalls[0].headers.Authorization, 'Bearer db-token');
    assert.equal(transportCalls[1].headers.Authorization, 'Bearer db-token');
  });

  test('stores newly fetched QCS token into global_cache', async () => {
    const qcs = require('../src/functions/lab/lib/adapters/qcs');
    qcs.clearTokenCache();
    const writes = [];
    const cache = {
      async get() { return null; },
      async set(key, value, expiredAt) {
        writes.push({ key, value, expiredAt });
      },
    };
    const transport = {
      async post(url, data, options) {
        if (url.endsWith('/oauth/access_token')) return { data: { access_token: 'new-token', expires_in: 3600 } };
        if (url.endsWith('/services/labtest/orders/_id_check')) {
          return { data: { data: { id: 'QCS-NEW', progress: 'tobeconfirmed' } } };
        }
        return { data: { data: { id: 'QCS-NEW', progress: 'processing', samples: [] } } };
      },
    };

    await qcs.createOrder({
      user: { user_id: 'u1', nickname: '张三' },
      payload: { goods: ['1080'], barcode: '287002730175', sample_center_id: 12 },
      config: {
        api_base_url: 'https://qcs.example/third-party',
        api_key: 'client-id',
        api_secret: 'client-secret',
        transport,
        cache,
        now: () => 1000,
      },
    });

    assert.equal(writes.length, 1);
    assert.equal(writes[0].key, 'qcs:access_token:https://qcs.example/third-party:client-id');
    assert.deepEqual(writes[0].value, {
      access_token: 'new-token',
      expires_at_ms: 1000 + 3600 * 1000,
    });
    assert.equal(writes[0].expiredAt.toISOString(), new Date(1000 + 3600 * 1000).toISOString());
  });
});
