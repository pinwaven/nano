const assert = require('node:assert/strict');
const { describe, test, beforeEach, afterEach } = require('node:test');
const crypto = require('node:crypto');

function clearPaymentModules() {
  for (const key of Object.keys(require.cache)) {
    if (key.includes('/src/functions/payment/')) delete require.cache[key];
  }
}

function makeKeyPair() {
  return crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
}

function exportPrivateKey(key) {
  return key.export({ type: 'pkcs8', format: 'pem' });
}

function exportPkcs1PrivateKey(key) {
  return key.export({ type: 'pkcs1', format: 'pem' });
}

function stripPem(value) {
  return String(value)
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
}

function legacyWechatSign(params, appKey) {
  const signContent = Object.keys(params)
    .filter((key) => key !== 'sign' && params[key] !== undefined && params[key] !== null && params[key] !== '')
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  return crypto
    .createHash('md5')
    .update(`${signContent}&key=${appKey}`, 'utf8')
    .digest('hex')
    .toUpperCase();
}

describe('payment provider adapters', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    clearPaymentModules();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('adapter registry exposes WeChat and Alipay providers', () => {
    const { getAdapter } = require('../src/functions/payment/lib/adapters');

    assert.equal(getAdapter('wechat').provider, 'wechat');
    assert.equal(getAdapter('alipay').provider, 'alipay');
  });

  test('WeChat mini-program payment uses WeChat Pay v3 JSAPI endpoint', async () => {
    const { privateKey } = makeKeyPair();
    const calls = [];
    global.fetch = async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ prepay_id: 'wx-prepay-1' });
        },
      };
    };

    const wechat = require('../src/functions/payment/lib/adapters/wechat');
    const result = await wechat.createPayment({
      payment_order_id: 'pay-1',
      business_order_id: '11111111-1111-1111-1111-111111111111',
      user_id: 'u1',
      scene: 'mini_program',
      currency: 'CNY',
      amount_minor: 29800,
      subject: 'Kino',
      openid: 'openid-1',
    }, {
      id: 'provider-1',
      merchant_id: 'mch-1',
      secret_ref: 'WECHAT_PAY_TEST',
      config: {
        appid: 'wx-app',
        api_base_url: 'https://pay.example',
        notify_url: 'https://nano.example/payment/callbacks/wechat/payment',
        merchant_serial_no: 'serial-1',
        private_key: exportPrivateKey(privateKey),
      },
    });

    assert.equal(result.status, 'pending');
    assert.equal(result.payment_payload.type, 'mini_program');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://pay.example/v3/pay/transactions/jsapi');
    assert.match(calls[0].options.headers.Authorization, /^WECHATPAY2-SHA256-RSA2048 /);
    assert.equal(JSON.parse(calls[0].options.body).payer.openid, 'openid-1');
  });

  test('WeChat QR code payment uses WeChat Pay v3 native endpoint', async () => {
    const { privateKey } = makeKeyPair();
    const calls = [];
    global.fetch = async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ code_url: 'weixin://wxpay/bizpayurl?pr=wx-native-1' });
        },
      };
    };

    const wechat = require('../src/functions/payment/lib/adapters/wechat');
    const result = await wechat.createPayment({
      payment_order_id: 'pay-native-1',
      business_order_id: '11111111-1111-1111-1111-111111111111',
      user_id: 'u1',
      scene: 'qr_code',
      currency: 'CNY',
      amount_minor: 29800,
      subject: 'Kino',
    }, {
      id: 'provider-1',
      merchant_id: 'mch-1',
      config: {
        appid: 'wx-app',
        api_base_url: 'https://pay.example',
        notify_url: 'https://nano.example/payment/callbacks/wechat/payment',
        merchant_serial_no: 'serial-1',
        private_key: exportPrivateKey(privateKey),
      },
    });

    assert.equal(result.status, 'pending');
    assert.equal(result.payment_payload.type, 'qr_code');
    assert.equal(result.payment_payload.qr_code_url, 'weixin://wxpay/bizpayurl?pr=wx-native-1');
    assert.equal(calls[0].url, 'https://pay.example/v3/pay/transactions/native');
    assert.match(calls[0].options.headers.Authorization, /^WECHATPAY2-SHA256-RSA2048 /);
    assert.equal(JSON.parse(calls[0].options.body).out_trade_no, 'pay-native-1');
  });

  test('WeChat legacy payment uses v2 unifiedorder with app key signing', async () => {
    const { privateKey } = makeKeyPair();
    const calls = [];
    global.fetch = async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        async text() {
          return [
            '<xml>',
            '<return_code><![CDATA[SUCCESS]]></return_code>',
            '<result_code><![CDATA[SUCCESS]]></result_code>',
            '<prepay_id><![CDATA[wx-prepay-v2]]></prepay_id>',
            '</xml>',
          ].join('');
        },
      };
    };

    const wechat = require('../src/functions/payment/lib/adapters/wechat');
    const result = await wechat.createPayment({
      payment_order_id: 'pay-legacy-1',
      business_order_id: '11111111-1111-1111-1111-111111111111',
      user_id: 'u1',
      scene: 'mini_program',
      currency: 'CNY',
      amount_minor: 29800,
      subject: 'Kino',
      openid: 'openid-1',
      client_ip: '203.0.113.1',
    }, {
      id: 'provider-1',
      merchant_id: 'mch-legacy',
      secret_ref: 'WECHAT_PAY_LEGACY',
      config: {
        appid: 'wx-app',
        api_base_url: 'https://pay.example',
        notify_url: 'https://nano.example/payment/callbacks/wechat/payment',
        app_key: 'legacy-app-key',
        private_key: exportPrivateKey(privateKey),
        appclient_cert: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
      },
    });

    assert.equal(result.status, 'pending');
    assert.equal(result.provider_trade_no, 'pay-legacy-1');
    assert.equal(result.payment_payload.type, 'mini_program');
    assert.equal(result.payment_payload.package, 'prepay_id=wx-prepay-v2');
    assert.equal(result.payment_payload.signType, 'MD5');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://pay.example/pay/unifiedorder');
    assert.equal(calls[0].options.headers['Content-Type'], 'text/xml; charset=utf-8');
    assert.match(calls[0].options.body, /<mch_id>mch-legacy<\/mch_id>/);
    assert.match(calls[0].options.body, /<trade_type>JSAPI<\/trade_type>/);
    assert.match(calls[0].options.body, /<openid>openid-1<\/openid>/);
    assert.match(calls[0].options.body, /<sign>[A-F0-9]{32}<\/sign>/);
    assert.equal(calls[0].options.headers.Authorization, undefined);
  });

  test('WeChat legacy QR code payment uses v2 native unifiedorder', async () => {
    const { privateKey } = makeKeyPair();
    const calls = [];
    global.fetch = async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        async text() {
          return '<xml><return_code><![CDATA[SUCCESS]]></return_code><result_code><![CDATA[SUCCESS]]></result_code><code_url><![CDATA[weixin://wxpay/bizpayurl?pr=legacy-native-1]]></code_url></xml>';
        },
      };
    };

    const wechat = require('../src/functions/payment/lib/adapters/wechat');
    const result = await wechat.createPayment({
      payment_order_id: 'pay-legacy-native-1',
      business_order_id: '11111111-1111-1111-1111-111111111111',
      user_id: 'u1',
      scene: 'qr_code',
      currency: 'CNY',
      amount_minor: 29800,
      subject: 'Kino',
      client_ip: '203.0.113.1',
    }, {
      id: 'provider-1',
      merchant_id: 'mch-legacy',
      config: {
        appid: 'wx-app',
        api_base_url: 'https://pay.example',
        notify_url: 'https://nano.example/payment/callbacks/wechat/payment',
        app_key: 'legacy-app-key',
        private_key: exportPrivateKey(privateKey),
        appclient_cert: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
      },
    });

    assert.equal(result.status, 'pending');
    assert.equal(result.payment_payload.type, 'qr_code');
    assert.equal(result.payment_payload.qr_code_url, 'weixin://wxpay/bizpayurl?pr=legacy-native-1');
    assert.equal(calls[0].url, 'https://pay.example/pay/unifiedorder');
    assert.match(calls[0].options.body, /<trade_type>NATIVE<\/trade_type>/);
    assert.match(calls[0].options.body, /<product_id>pay-legacy-native-1<\/product_id>/);
  });

  test('WeChat legacy payment prefers app key mode even if v3 fields are present', async () => {
    const { privateKey } = makeKeyPair();
    const calls = [];
    global.fetch = async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        async text() {
          return '<xml><return_code><![CDATA[SUCCESS]]></return_code><result_code><![CDATA[SUCCESS]]></result_code><prepay_id><![CDATA[wx-prepay-v2]]></prepay_id></xml>';
        },
      };
    };

    const wechat = require('../src/functions/payment/lib/adapters/wechat');
    await wechat.createPayment({
      payment_order_id: 'pay-legacy-2',
      business_order_id: '11111111-1111-1111-1111-111111111111',
      user_id: 'u1',
      scene: 'mini_program',
      currency: 'CNY',
      amount_minor: 100,
      subject: 'Kino',
      openid: 'openid-1',
    }, {
      id: 'provider-1',
      config: {
        appid: 'wx-app',
        mchid: 'mch-legacy',
        api_base_url: 'https://pay.example',
        notify_url: 'https://nano.example/payment/callbacks/wechat/payment',
        app_key: 'legacy-app-key',
        private_key: exportPrivateKey(privateKey),
        appclient_cert: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
        merchant_serial_no: 'leftover-v3-serial',
      },
    });

    assert.equal(calls[0].url, 'https://pay.example/pay/unifiedorder');
    assert.equal(calls[0].options.headers.Authorization, undefined);
  });

  test('WeChat legacy payment callback verifies XML app key signature', async () => {
    const wechat = require('../src/functions/payment/lib/adapters/wechat');
    const params = {
      appid: 'wx-app',
      mch_id: 'mch-legacy',
      nonce_str: 'nonce-1',
      result_code: 'SUCCESS',
      return_code: 'SUCCESS',
      out_trade_no: 'pay-legacy-1',
      transaction_id: 'wx-transaction-1',
      time_end: '20260526121213',
      attach: JSON.stringify({ payment_order_id: 'pay-legacy-1' }),
    };
    params.sign = legacyWechatSign(params, 'legacy-app-key');
    const rawBody = `<xml>${Object.entries(params).map(([key, value]) => `<${key}><![CDATA[${value}]]></${key}>`).join('')}</xml>`;

    const verified = await wechat.verifyPaymentCallback({ headers: {}, rawBody }, {
      id: 'provider-1',
      merchant_id: 'mch-legacy',
      config: {
        appid: 'wx-app',
        app_key: 'legacy-app-key',
        notify_url: 'https://nano.example/payment/callbacks/wechat/payment',
        private_key: exportPrivateKey(makeKeyPair().privateKey),
        appclient_cert: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
      },
    });

    assert.equal(verified.status, 'paid');
    assert.equal(verified.provider_trade_no, 'pay-legacy-1');
    assert.equal(verified.local_order_id, 'pay-legacy-1');
    assert.equal(verified.raw.transaction_id, 'wx-transaction-1');
  });

  test('Alipay web payment returns a signed gateway URL without remote call', async () => {
    const { privateKey } = makeKeyPair();
    const alipay = require('../src/functions/payment/lib/adapters/alipay');

    const result = await alipay.createPayment({
      payment_order_id: 'pay-1',
      business_order_id: '11111111-1111-1111-1111-111111111111',
      scene: 'web',
      currency: 'CNY',
      amount_minor: 29800,
      subject: 'Kino',
      description: 'Kino chip',
    }, {
      id: 'provider-1',
      merchant_id: '2088',
      secret_ref: 'ALIPAY_TEST',
      config: {
        app_id: 'app-1',
        gateway_url: 'https://openapi.alipay.test/gateway.do',
        notify_url: 'https://nano.example/payment/callbacks/alipay/payment',
        return_url: 'https://nano.example/pay/return',
        private_key: exportPrivateKey(privateKey),
      },
    });

    assert.equal(result.status, 'pending');
    assert.equal(result.payment_payload.type, 'web');
    assert.match(result.payment_payload.redirect_url, /^https:\/\/openapi\.alipay\.test\/gateway\.do\?/);
    assert.match(result.payment_payload.redirect_url, /method=alipay\.trade\.page\.pay/);
    assert.match(result.payment_payload.redirect_url, /sign=/);
  });

  test('Alipay QR code payment uses precreate and returns QR code URL', async () => {
    const { privateKey } = makeKeyPair();
    const calls = [];
    global.fetch = async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            alipay_trade_precreate_response: {
              out_trade_no: 'pay-qr-1',
              qr_code: 'https://qr.alipay.example/pay-qr-1',
            },
          });
        },
      };
    };
    const alipay = require('../src/functions/payment/lib/adapters/alipay');

    const result = await alipay.createPayment({
      payment_order_id: 'pay-qr-1',
      business_order_id: '11111111-1111-1111-1111-111111111111',
      scene: 'qr_code',
      currency: 'CNY',
      amount_minor: 29800,
      subject: 'Kino',
    }, {
      id: 'provider-1',
      merchant_id: '2088',
      config: {
        app_id: 'app-1',
        gateway_url: 'https://openapi.alipay.test/gateway.do',
        notify_url: 'https://nano.example/payment/callbacks/alipay/payment',
        private_key: exportPrivateKey(privateKey),
      },
    });

    assert.equal(result.status, 'pending');
    assert.equal(result.provider_trade_no, 'pay-qr-1');
    assert.deepEqual(result.payment_payload, {
      type: 'qr_code',
      qr_code_url: 'https://qr.alipay.example/pay-qr-1',
    });
    assert.equal(calls[0].url, 'https://openapi.alipay.test/gateway.do');
    assert.match(calls[0].options.body, /method=alipay\.trade\.precreate/);
  });

  test('Alipay callback verifies signature and normalizes paid status', async () => {
    const { privateKey, publicKey } = makeKeyPair();
    const alipay = require('../src/functions/payment/lib/adapters/alipay');
    const params = {
      app_id: 'app-1',
      trade_status: 'TRADE_SUCCESS',
      out_trade_no: 'pay-1',
      trade_no: 'ali-trade-1',
      gmt_payment: '2026-05-26 12:01:33',
      passback_params: JSON.stringify({ payment_order_id: 'pay-1' }),
    };
    const signText = alipay.__private.buildSignContent(params);
    params.sign = crypto.createSign('RSA-SHA256').update(signText).sign(privateKey, 'base64');
    params.sign_type = 'RSA2';
    const rawBody = new URLSearchParams(params).toString();

    const verified = await alipay.verifyPaymentCallback({ headers: {}, rawBody }, {
      config: {
        alipay_public_key: publicKey.export({ type: 'spki', format: 'pem' }),
      },
    });

    assert.equal(verified.status, 'paid');
    assert.equal(verified.provider_trade_no, 'pay-1');
    assert.equal(verified.local_order_id, 'pay-1');
    assert.equal(verified.raw.trade_no, 'ali-trade-1');
  });

  test('Alipay accepts stored private and public keys without PEM headers', async () => {
    const { privateKey, publicKey } = makeKeyPair();
    const alipay = require('../src/functions/payment/lib/adapters/alipay');
    const privateKeyBody = stripPem(exportPrivateKey(privateKey));
    const publicKeyBody = stripPem(publicKey.export({ type: 'spki', format: 'pem' }));

    const cfg = alipay.__private.resolveConfig({
      id: 'provider-1',
      merchant_id: '2088',
      config: {
        app_id: 'app-1',
        private_key: privateKeyBody,
        alipay_public_key: publicKeyBody,
      },
    });

    const params = { app_id: 'app-1', method: 'alipay.trade.query' };
    params.sign = alipay.__private.signParams(params, cfg.private_key);

    assert.equal(alipay.__private.verifyParams(params, cfg.alipay_public_key), true);
    assert.match(cfg.private_key, /^-----BEGIN PRIVATE KEY-----\n/);
    assert.match(cfg.private_key, /\n-----END PRIVATE KEY-----$/);
    assert.match(cfg.alipay_public_key, /^-----BEGIN PUBLIC KEY-----\n/);
    assert.match(cfg.alipay_public_key, /\n-----END PUBLIC KEY-----$/);
  });

  test('Alipay accepts stored PKCS#1 private keys without PEM headers', async () => {
    const { privateKey, publicKey } = makeKeyPair();
    const alipay = require('../src/functions/payment/lib/adapters/alipay');
    const privateKeyBody = stripPem(exportPkcs1PrivateKey(privateKey));
    const publicKeyBody = stripPem(publicKey.export({ type: 'spki', format: 'pem' }));

    const cfg = alipay.__private.resolveConfig({
      id: 'provider-1',
      merchant_id: '2088',
      config: {
        app_id: 'app-1',
        private_key: privateKeyBody,
        alipay_public_key: publicKeyBody,
      },
    });

    const params = { app_id: 'app-1', method: 'alipay.trade.query' };
    params.sign = alipay.__private.signParams(params, cfg.private_key);

    assert.equal(alipay.__private.verifyParams(params, cfg.alipay_public_key), true);
    assert.match(cfg.private_key, /^-----BEGIN RSA PRIVATE KEY-----\n/);
    assert.match(cfg.private_key, /\n-----END RSA PRIVATE KEY-----$/);
  });

  test('WeChat config is database-only and does not fall back to environment secrets', () => {
    process.env.WECHAT_PAY_APPID = 'env-app';
    process.env.WECHAT_PAY_PRIVATE_KEY = 'env-private';

    const wechat = require('../src/functions/payment/lib/adapters/wechat');
    const cfg = wechat.__private.base.__private.resolveConfig({
      id: 'provider-1',
      merchant_id: 'mch-db',
      secret_ref: 'WECHAT_PAY',
      config: { appid: 'db-app' },
    });

    assert.equal(cfg.appid, 'db-app');
    assert.equal(cfg.mchid, 'mch-db');
    assert.equal(cfg.private_key, undefined);
  });

  test('WeChat config uses AppClient user public key instead of platform public key', () => {
    const { publicKey } = makeKeyPair();
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
    const wechat = require('../src/functions/payment/lib/adapters/wechat');

    const cfg = wechat.__private.base.__private.resolveConfig({
      id: 'provider-1',
      merchant_id: 'mch-db',
      config: {
        appid: 'db-app',
        public_key: publicKeyPem,
      },
    });

    assert.equal(cfg.public_key, publicKeyPem);
    assert.equal(cfg.platform_public_key, undefined);
  });

  test('Alipay config is database-only and does not fall back to environment secrets', () => {
    process.env.ALIPAY_APP_ID = 'env-app';
    process.env.ALIPAY_PRIVATE_KEY = 'env-private';

    const alipay = require('../src/functions/payment/lib/adapters/alipay');
    const cfg = alipay.__private.resolveConfig({
      id: 'provider-1',
      merchant_id: '2088',
      secret_ref: 'ALIPAY',
      config: { app_id: 'db-app' },
    });

    assert.equal(cfg.app_id, 'db-app');
    assert.equal(cfg.private_key, undefined);
  });
});
