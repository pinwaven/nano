const assert = require('node:assert/strict');
const { describe, test, beforeEach } = require('node:test');
const path = require('node:path');

function clearPaymentModules() {
  for (const key of Object.keys(require.cache)) {
    if (key.includes('/src/functions/payment/')) delete require.cache[key];
  }
}

function installDbMock(query) {
  const dbPath = path.resolve(__dirname, '../src/functions/payment/lib/db.js');
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
    headers: { 'content-type': 'application/json', authorization: 'Bearer test', 'idempotency-key': `${rawPath}-idem` },
    body: JSON.stringify(body || {}),
    isBase64Encoded: false,
  };
}

describe('payment API', () => {
  beforeEach(() => {
    clearPaymentModules();
  });

  test('POST /payment/orders creates a WeCom mini-program payment order', async () => {
    const queries = [];
    installDbMock(async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes('FROM payment_providers')) {
        return {
          rows: [{
            id: 'provider-1',
            provider: 'wecom',
            merchant_id: 'mch-1',
            config: { appid: 'wx-app', notify_url: 'https://nano.example/payment/callbacks/wecom/payment' },
            secret_ref: 'WECOM_PAY',
          }],
        };
      }
      if (sql.includes('FROM payment_orders') && sql.includes('idempotency_key')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO payment_orders')) {
        return {
          rows: [{
            id: 'pay-1',
            business_order_id: params[0],
            user_id: params[1],
            provider: params[2],
            scene: params[4],
            currency: params[5],
            amount_minor: params[6],
            status: 'created',
          }],
        };
      }
      if (sql.includes('UPDATE payment_orders') && sql.includes('provider_trade_no')) {
        return {
          rows: [{
            id: 'pay-1',
            business_order_id: 'order-1',
            provider: 'wecom',
            scene: 'mini_program',
            currency: 'CNY',
            amount_minor: 29800,
            status: 'pending',
            provider_trade_no: 'wx-prepay-1',
          }],
        };
      }
      return { rows: [] };
    });

    const payment = require('../src/functions/payment');
    payment.__private.setAdapterFactory(() => ({
      async createPayment(input, config) {
        assert.equal(input.scene, 'mini_program');
        assert.equal(input.amount_minor, 29800);
        assert.equal(config.merchant_id, 'mch-1');
        return {
          status: 'pending',
          provider_trade_no: 'wx-prepay-1',
          provider_payload: { prepay_id: 'wx-prepay-1' },
          payment_payload: { type: 'mini_program', package: 'prepay_id=wx-prepay-1' },
        };
      },
    }));

    const response = await payment.handler(event('POST', '/payment/orders', {
      business_order_id: 'order-1',
      user_id: 'u1',
      provider: 'wecom',
      scene: 'mini_program',
      currency: 'CNY',
      amount_minor: 29800,
      subject: 'Kino',
      openid: 'openid-1',
    }));

    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), {
      success: true,
      data: {
        payment_order: {
          id: 'pay-1',
          business_order_id: 'order-1',
          provider: 'wecom',
          scene: 'mini_program',
          currency: 'CNY',
          amount_minor: 29800,
          status: 'pending',
          provider_trade_no: 'wx-prepay-1',
        },
        payment_payload: { type: 'mini_program', package: 'prepay_id=wx-prepay-1' },
      },
      error: null,
    });
    assert.ok(queries.find(q => q.sql.includes('INSERT INTO payment_orders')));
  });

  test('POST /payment/orders records provider failure on the payment order', async () => {
    const queries = [];
    installDbMock(async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes('FROM payment_providers')) {
        return { rows: [{ id: 'provider-1', provider: 'wechat', merchant_id: 'mch-1', config: { appid: 'wx-app' } }] };
      }
      if (sql.includes('FROM payment_orders') && sql.includes('idempotency_key')) return { rows: [] };
      if (sql.includes('INSERT INTO payment_orders')) {
        return { rows: [{ id: 'pay-1', business_order_id: params[0], user_id: params[1], provider: params[2], scene: params[4], currency: params[5], amount_minor: params[6], status: 'created' }] };
      }
      if (sql.includes('UPDATE payment_orders') && sql.includes("status = 'failed'")) {
        return { rows: [{ id: 'pay-1', status: 'failed' }] };
      }
      return { rows: [] };
    });

    const payment = require('../src/functions/payment');
    payment.__private.setAdapterFactory(() => ({
      async createPayment() {
        const err = new Error('provider rejected order');
        err.statusCode = 400;
        err.code = 'PROVIDER_BAD_REQUEST';
        err.provider_payload = { err_code: 'INVALID_REQUEST', private_key: 'secret-key-material' };
        throw err;
      },
    }));

    const response = await payment.handler(event('POST', '/payment/orders', {
      business_order_id: 'order-1',
      user_id: 'u1',
      provider: 'wechat',
      scene: 'qr_code',
      currency: 'CNY',
      amount_minor: 100,
      subject: 'Kino',
    }));

    assert.equal(response.statusCode, 400);
    const failureUpdate = queries.find(q => q.sql.includes('UPDATE payment_orders') && q.sql.includes("status = 'failed'"));
    assert.ok(failureUpdate);
    const payload = JSON.parse(failureUpdate.params[1]);
    assert.equal(payload.operation, 'create_payment');
    assert.equal(payload.error, 'provider rejected order');
    assert.equal(payload.provider_payload.err_code, 'INVALID_REQUEST');
    assert.equal(payload.provider_payload.private_key, '[REDACTED]');
  });

  test('POST /payment/orders prefers institution payment provider over admin default', async () => {
    const queries = [];
    installDbMock(async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes('FROM payment_providers')) {
        assert.deepEqual(params, ['wecom', 'clinic-1']);
        assert.match(sql, /institution_id = \$2/);
        assert.match(sql, /institution_id IS NULL/);
        return {
          rows: [{
            id: 'provider-clinic',
            provider: 'wecom',
            merchant_id: 'mch-clinic',
            institution_id: 'clinic-1',
            scope: 'institution',
            config: { appid: 'wx-clinic' },
            secret_ref: null,
          }],
        };
      }
      if (sql.includes('FROM payment_orders') && sql.includes('idempotency_key')) return { rows: [] };
      if (sql.includes('INSERT INTO payment_orders')) {
        assert.equal(params[12], 'clinic-1');
        return { rows: [{ id: 'pay-1', business_order_id: params[0], user_id: params[1], provider: params[2], scene: params[4], currency: params[5], amount_minor: params[6], status: 'created' }] };
      }
      if (sql.includes('UPDATE payment_orders') && sql.includes('provider_trade_no')) {
        return { rows: [{ id: 'pay-1', business_order_id: 'order-1', provider: 'wecom', scene: 'mini_program', currency: 'CNY', amount_minor: 29800, status: 'pending', provider_trade_no: 'wx-prepay-1' }] };
      }
      return { rows: [] };
    });

    const payment = require('../src/functions/payment');
    payment.__private.setAdapterFactory(() => ({
      async createPayment(input, providerRow) {
        assert.equal(input.institution_id, 'clinic-1');
        assert.equal(providerRow.id, 'provider-clinic');
        assert.equal(providerRow.merchant_id, 'mch-clinic');
        return { status: 'pending', provider_trade_no: 'wx-prepay-1', provider_payload: {}, payment_payload: { type: 'mini_program' } };
      },
    }));

    const response = await payment.handler(event('POST', '/payment/orders', {
      business_order_id: 'order-1',
      user_id: 'u1',
      institution_id: 'clinic-1',
      provider: 'wecom',
      scene: 'mini_program',
      currency: 'CNY',
      amount_minor: 29800,
      subject: 'Kino',
      openid: 'openid-1',
    }));

    assert.equal(response.statusCode, 200);
  });

  test('POST /payment/callbacks/wecom/payment records callback and marks order paid', async () => {
    const queries = [];
    installDbMock(async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes('FROM payment_providers')) {
        return { rows: [{ id: 'provider-1', provider: 'wecom', merchant_id: 'mch-1', config: {}, secret_ref: 'WECOM_PAY' }] };
      }
      if (sql.includes('INSERT INTO payment_callback_events')) {
        return { rows: [{ id: 'evt-1' }] };
      }
      if (sql.includes('UPDATE payment_orders') && sql.includes("status = 'paid'")) {
        return {
          rows: [{
            id: 'pay-1',
            business_order_id: 'order-1',
            provider: 'wecom',
            status: 'paid',
            paid_at: '2026-05-26T12:01:33+08:00',
          }],
        };
      }
      if (sql.includes('UPDATE orders')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const payment = require('../src/functions/payment');
    payment.__private.setAdapterFactory(() => ({
      async verifyPaymentCallback({ rawBody }) {
        assert.equal(rawBody, '{"id":"provider-event-1"}');
        return {
          event_id: 'provider-event-1',
          provider_trade_no: 'wx-prepay-1',
          local_order_id: 'pay-1',
          status: 'paid',
          paid_at: '2026-05-26T12:01:33+08:00',
          raw: { transaction_id: 'wx-tx-1' },
        };
      },
      paymentCallbackResponse() {
        return { code: 'SUCCESS', message: 'OK' };
      },
    }));

    const request = event('POST', '/payment/callbacks/wecom/payment', { id: 'provider-event-1' });
    const response = await payment.handler(request);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), { code: 'SUCCESS', message: 'OK' });
    assert.ok(queries.find(q => q.sql.includes('INSERT INTO payment_callback_events')));
    assert.ok(queries.find(q => q.sql.includes("status = 'paid'")));
  });

  test('POST /payment/refunds creates a WeCom refund request', async () => {
    installDbMock(async (sql, params) => {
      if (sql.includes('FROM payment_orders') && sql.includes('FOR UPDATE')) {
        return {
          rows: [{
            id: 'pay-1',
            business_order_id: 'order-1',
            provider: 'wecom',
            provider_account_id: 'provider-1',
            amount_minor: 29800,
            status: 'paid',
            refunded_amount_minor: 0,
          }],
        };
      }
      if (sql.includes('FROM payment_providers')) {
        return { rows: [{ id: 'provider-1', provider: 'wecom', merchant_id: 'mch-1', config: {}, secret_ref: 'WECOM_PAY' }] };
      }
      if (sql.includes('INSERT INTO payment_refunds')) {
        return { rows: [{ id: 'refund-1', payment_order_id: params[0], amount_minor: params[3], status: 'created' }] };
      }
      if (sql.includes('UPDATE payment_refunds')) {
        return {
          rows: [{
            id: 'refund-1',
            payment_order_id: 'pay-1',
            amount_minor: 29800,
            status: 'pending',
            provider_refund_no: 'wx-refund-1',
          }],
        };
      }
      if (sql.includes('UPDATE payment_orders')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const payment = require('../src/functions/payment');
    payment.__private.setAdapterFactory(() => ({
      async createRefund(input) {
        assert.equal(input.payment_order_id, 'pay-1');
        assert.equal(input.amount_minor, 29800);
        return {
          status: 'pending',
          provider_refund_no: 'wx-refund-1',
          provider_payload: { refund_id: 'wx-refund-1' },
        };
      },
    }));

    const response = await payment.handler(event('POST', '/payment/refunds', {
      payment_order_id: 'pay-1',
      amount_minor: 29800,
      reason: 'customer_requested_refund',
    }));

    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), {
      success: true,
      data: {
        refund: {
          id: 'refund-1',
          payment_order_id: 'pay-1',
          amount_minor: 29800,
          status: 'pending',
          provider_refund_no: 'wx-refund-1',
        },
      },
      error: null,
    });
  });

  test('POST /payment/refunds records provider failure on the refund', async () => {
    const queries = [];
    installDbMock(async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes('FROM payment_orders') && sql.includes('FOR UPDATE')) {
        return {
          rows: [{
            id: 'pay-1',
            business_order_id: 'order-1',
            provider: 'wechat',
            provider_account_id: 'provider-1',
            provider_trade_no: 'wx-trade-1',
            currency: 'CNY',
            amount_minor: 29800,
            status: 'paid',
            refunded_amount_minor: 0,
          }],
        };
      }
      if (sql.includes('FROM payment_providers')) {
        return { rows: [{ id: 'provider-1', provider: 'wechat', merchant_id: 'mch-1', config: {} }] };
      }
      if (sql.includes('INSERT INTO payment_refunds')) {
        return { rows: [{ id: 'refund-1', payment_order_id: params[0], amount_minor: params[5], status: 'created' }] };
      }
      if (sql.includes('UPDATE payment_refunds') && sql.includes("status = 'failed'")) {
        return { rows: [{ id: 'refund-1', status: 'failed' }] };
      }
      return { rows: [] };
    });

    const payment = require('../src/functions/payment');
    payment.__private.setAdapterFactory(() => ({
      async createRefund() {
        const err = new Error('refund rejected');
        err.statusCode = 502;
        err.provider_payload = { code: 'SYSTEMERROR', api_v3_key: 'secret-api-key' };
        throw err;
      },
    }));

    const response = await payment.handler(event('POST', '/payment/refunds', {
      payment_order_id: 'pay-1',
      amount_minor: 100,
      reason: 'customer_requested_refund',
    }));

    assert.equal(response.statusCode, 502);
    const failureUpdate = queries.find(q => q.sql.includes('UPDATE payment_refunds') && q.sql.includes("status = 'failed'"));
    assert.ok(failureUpdate);
    const payload = JSON.parse(failureUpdate.params[1]);
    assert.equal(payload.operation, 'create_refund');
    assert.equal(payload.error, 'refund rejected');
    assert.equal(payload.provider_payload.code, 'SYSTEMERROR');
    assert.equal(payload.provider_payload.api_v3_key, '[REDACTED]');
  });

  test('timer trigger polls pending refunds and applies succeeded status', async () => {
    const queries = [];
    installDbMock(async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes('FROM payment_refunds') && sql.includes('next_poll_at')) {
        return {
          rows: [{
            id: 'refund-1',
            payment_order_id: 'pay-1',
            provider: 'wecom',
            provider_account_id: 'provider-1',
            refund_no: 'local-refund-1',
            provider_refund_no: 'wx-refund-1',
            amount_minor: 29800,
            status: 'pending',
          }],
        };
      }
      if (sql.includes('FROM payment_providers')) {
        return { rows: [{ id: 'provider-1', provider: 'wecom', merchant_id: 'mch-1', config: {}, secret_ref: 'WECOM_PAY' }] };
      }
      if (sql.includes('UPDATE payment_refunds')) {
        return { rows: [{ id: 'refund-1', payment_order_id: 'pay-1', amount_minor: 29800, status: 'succeeded' }] };
      }
      if (sql.includes('UPDATE payment_orders')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const payment = require('../src/functions/payment');
    payment.__private.setAdapterFactory(() => ({
      async queryRefund(input) {
        assert.equal(input.provider_refund_no, 'wx-refund-1');
        return { status: 'succeeded', provider_payload: { status: 'SUCCESS' }, succeeded_at: '2026-05-26T12:08:20+08:00' };
      },
    }));

    const response = await payment.handler(Buffer.from(''));

    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), { success: true, polled: 1 });
    assert.ok(queries.find(q => q.sql.includes('UPDATE payment_refunds')));
  });

  test('GET /payment/orders/by-business/:id returns latest payment order', async () => {
    installDbMock(async (sql, params) => {
      if (sql.includes('FROM payment_orders') && sql.includes('business_order_id')) {
        assert.deepEqual(params, ['order-1']);
        return {
          rows: [{
            id: 'pay-1',
            business_order_id: 'order-1',
            provider: 'wecom',
            scene: 'mini_program',
            currency: 'CNY',
            amount_minor: 29800,
            status: 'pending',
          }],
        };
      }
      return { rows: [] };
    });

    const payment = require('../src/functions/payment');
    const response = await payment.handler(event('GET', '/payment/orders/by-business/order-1'));

    assert.equal(response.statusCode, 200);
    assert.equal(JSON.parse(response.body).data.payment_order.id, 'pay-1');
  });

  test('POST /payment/refunds/:id/poll manually syncs refund status', async () => {
    installDbMock(async (sql, params) => {
      if (sql.includes('FROM payment_refunds') && sql.includes('WHERE id = $1')) {
        return {
          rows: [{
            id: 'refund-1',
            payment_order_id: 'pay-1',
            provider: 'wecom',
            provider_account_id: 'provider-1',
            refund_no: 'local-refund-1',
            provider_refund_no: 'wx-refund-1',
            amount_minor: 29800,
            status: 'pending',
          }],
        };
      }
      if (sql.includes('FROM payment_providers')) {
        return { rows: [{ id: 'provider-1', provider: 'wecom', merchant_id: 'mch-1', config: {}, secret_ref: 'WECOM_PAY' }] };
      }
      if (sql.includes('UPDATE payment_refunds')) {
        return { rows: [{ id: 'refund-1', payment_order_id: 'pay-1', amount_minor: 29800, status: 'succeeded' }] };
      }
      if (sql.includes('UPDATE payment_orders')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const payment = require('../src/functions/payment');
    payment.__private.setAdapterFactory(() => ({
      async queryRefund(input) {
        assert.equal(input.refund_id, 'refund-1');
        return { status: 'succeeded', provider_payload: { status: 'SUCCESS' } };
      },
    }));

    const response = await payment.handler(event('POST', '/payment/refunds/refund-1/poll'));

    assert.equal(response.statusCode, 200);
    assert.equal(JSON.parse(response.body).data.refund.status, 'succeeded');
  });

  test('POST /payment/callbacks/wecom/refund matches local refund number', async () => {
    const queries = [];
    installDbMock(async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes('FROM payment_providers')) {
        return { rows: [{ id: 'provider-1', provider: 'wecom', merchant_id: 'mch-1', config: {}, secret_ref: 'WECOM_PAY' }] };
      }
      if (sql.includes('INSERT INTO payment_callback_events')) {
        return { rows: [{ id: 'evt-1' }] };
      }
      if (sql.includes('UPDATE payment_refunds')) {
        assert.equal(params[2], 'local-refund-1');
        return { rows: [{ id: 'refund-1', payment_order_id: 'pay-1', amount_minor: 29800, status: 'succeeded' }] };
      }
      if (sql.includes('UPDATE payment_orders')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const payment = require('../src/functions/payment');
    payment.__private.setAdapterFactory(() => ({
      async verifyRefundCallback() {
        return {
          event_id: 'provider-event-2',
          provider_refund_no: 'wx-refund-1',
          local_refund_no: 'local-refund-1',
          status: 'succeeded',
          raw: { refund_id: 'wx-refund-1' },
        };
      },
      refundCallbackResponse() {
        return { code: 'SUCCESS', message: 'OK' };
      },
    }));

    const response = await payment.handler(event('POST', '/payment/callbacks/wecom/refund', { id: 'provider-event-2' }));

    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), { code: 'SUCCESS', message: 'OK' });
    assert.ok(queries.find(q => q.sql.includes('UPDATE payment_refunds') && q.sql.includes('refund_no')));
  });

  test('provider callback may return plaintext acknowledgement', async () => {
    installDbMock(async (sql) => {
      if (sql.includes('FROM payment_providers')) {
        return { rows: [{ id: 'provider-1', provider: 'alipay', merchant_id: '2088', config: {}, secret_ref: 'ALIPAY' }] };
      }
      if (sql.includes('INSERT INTO payment_callback_events')) {
        return { rows: [{ id: 'evt-1' }] };
      }
      return { rows: [] };
    });

    const payment = require('../src/functions/payment');
    payment.__private.setAdapterFactory(() => ({
      async verifyPaymentCallback() {
        return {
          event_id: 'ali-event-1',
          provider_trade_no: 'pay-1',
          local_order_id: 'pay-1',
          status: 'pending',
          raw: {},
        };
      },
      paymentCallbackResponse() {
        return 'success';
      },
    }));

    const response = await payment.handler(event('POST', '/payment/callbacks/alipay/payment', { id: 'ali-event-1' }));

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['Content-Type'], 'text/plain; charset=utf-8');
    assert.equal(response.body, 'success');
  });

  test('POST /payment/providers/test validates submitted provider config without saving it', async () => {
    installDbMock(async () => ({ rows: [] }));

    const payment = require('../src/functions/payment');
    payment.__private.setAdapterFactory((provider) => ({
      provider,
      validateConfig(providerRow) {
        assert.equal(providerRow.provider, 'wechat');
        assert.equal(providerRow.merchant_id, 'mch-test');
        assert.equal(providerRow.institution_id, 'clinic-1');
        assert.equal(providerRow.scope, 'institution');
        assert.equal(providerRow.config.appid, 'wx-test');
        return {
          valid: true,
          refund_supported: true,
          checks: [
            { key: 'appid', ok: true },
            { key: 'refund', ok: true },
          ],
        };
      },
    }));

    const response = await payment.handler(event('POST', '/payment/providers/test', {
      provider: 'wechat',
      merchant_id: 'mch-test',
      institution_id: 'clinic-1',
      config: { appid: 'wx-test' },
    }));

    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), {
      success: true,
      data: {
        provider: 'wechat',
        valid: true,
        refund_supported: true,
        checks: [
          { key: 'appid', ok: true },
          { key: 'refund', ok: true },
        ],
      },
      error: null,
    });
  });

  test('POST /payment/providers/test can create a provider test payment order', async () => {
    installDbMock(async () => ({ rows: [] }));

    const payment = require('../src/functions/payment');
    payment.__private.setAdapterFactory((provider) => ({
      provider,
      validateConfig() {
        return { valid: true, refund_supported: true, checks: [{ key: 'appid', ok: true }] };
      },
      async createPayment(input, providerRow) {
        assert.equal(input.business_order_id, 'config-test-order');
        assert.equal(input.scene, 'mini_program');
        assert.equal(input.amount_minor, 1);
        assert.equal(input.metadata.config_test, true);
        assert.equal(providerRow.merchant_id, 'mch-test');
        return {
          status: 'pending',
          provider_trade_no: 'provider-prepay-1',
          payment_payload: { type: 'mini_program', package: 'prepay_id=provider-prepay-1' },
        };
      },
    }));

    const response = await payment.handler(event('POST', '/payment/providers/test', {
      provider: 'wechat',
      merchant_id: 'mch-test',
      config: { appid: 'wx-test' },
      test_payment: true,
      business_order_id: 'config-test-order',
      scene: 'mini_program',
      amount_minor: 1,
      subject: 'Config test',
    }));

    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body).data.payment_test, {
      attempted: true,
      ok: true,
      status: 'pending',
      provider_trade_no: 'provider-prepay-1',
      payment_payload_type: 'mini_program',
      payment_payload: { type: 'mini_program', package: 'prepay_id=provider-prepay-1' },
    });
  });

  test('POST /payment/providers/test can create a QR code provider test payment order', async () => {
    installDbMock(async () => ({ rows: [] }));

    const payment = require('../src/functions/payment');
    payment.__private.setAdapterFactory((provider) => ({
      provider,
      validateConfig() {
        return { valid: true, refund_supported: false, checks: [{ key: 'appid', ok: true }] };
      },
      async createPayment(input, providerRow) {
        assert.equal(input.scene, 'qr_code');
        assert.equal(input.amount_minor, 1);
        assert.equal(input.metadata.config_test, true);
        assert.equal(providerRow.merchant_id, 'mch-test');
        return {
          status: 'pending',
          provider_trade_no: 'provider-qr-1',
          payment_payload: {
            type: 'qr_code',
            qr_code_url: 'weixin://wxpay/bizpayurl?pr=config-test',
          },
        };
      },
    }));

    const response = await payment.handler(event('POST', '/payment/providers/test', {
      provider: 'wechat',
      merchant_id: 'mch-test',
      config: { appid: 'wx-test' },
      test_payment: true,
      scene: 'qr_code',
      amount_minor: 1,
      subject: 'Config QR test',
    }));

    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body).data.payment_test, {
      attempted: true,
      ok: true,
      status: 'pending',
      provider_trade_no: 'provider-qr-1',
      payment_payload_type: 'qr_code',
      payment_payload: {
        type: 'qr_code',
        qr_code_url: 'weixin://wxpay/bizpayurl?pr=config-test',
      },
    });
  });

  test('POST /payment/providers/test blocks refund test without explicit real-refund confirmation', async () => {
    installDbMock(async () => ({ rows: [] }));

    const payment = require('../src/functions/payment');
    payment.__private.setAdapterFactory(() => ({
      validateConfig() {
        return { valid: true, refund_supported: true, checks: [] };
      },
    }));

    const response = await payment.handler(event('POST', '/payment/providers/test', {
      provider: 'wechat',
      merchant_id: 'mch-test',
      config: { appid: 'wx-test' },
      test_refund: true,
      refund_test: {
        provider_trade_no: 'provider-paid-order-1',
        amount_minor: 1,
      },
    }));

    assert.equal(response.statusCode, 400);
    assert.equal(JSON.parse(response.body).error.code, 'PAYMENT_INVALID_REQUEST');
  });

  test('POST /payment/providers/test can issue an explicitly confirmed refund test', async () => {
    installDbMock(async () => ({ rows: [] }));

    const payment = require('../src/functions/payment');
    payment.__private.setAdapterFactory(() => ({
      validateConfig() {
        return { valid: true, refund_supported: true, checks: [{ key: 'refund_capability', ok: true }] };
      },
      async createRefund(input, providerRow) {
        assert.equal(input.provider_trade_no, 'provider-paid-order-1');
        assert.equal(input.amount_minor, 1);
        assert.equal(input.total_amount_minor, 1);
        assert.match(input.refund_no, /^cfg_rf_/);
        assert.equal(providerRow.merchant_id, 'mch-test');
        return {
          status: 'pending',
          provider_refund_no: 'provider-refund-1',
          provider_payload: { refund_id: 'provider-refund-1' },
        };
      },
    }));

    const response = await payment.handler(event('POST', '/payment/providers/test', {
      provider: 'wechat',
      merchant_id: 'mch-test',
      config: { appid: 'wx-test' },
      test_refund: true,
      allow_real_refund: true,
      refund_test: {
        provider_trade_no: 'provider-paid-order-1',
        amount_minor: 1,
      },
    }));

    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body).data.refund_test, {
      attempted: true,
      ok: true,
      status: 'pending',
      provider_refund_no: 'provider-refund-1',
    });
  });
});
