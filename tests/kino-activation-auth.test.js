const assert = require('node:assert');
const { describe, test } = require('node:test');

const { getQuery, requireActivationBearer } = require('../src/functions/kino')._private;

describe('Kino activation fixed-token auth', () => {
  test('reads query parameters from FC event and standard HTTP request shapes', () => {
    assert.deepStrictEqual(
      getQuery({ queryStringParameters: { page: '1' } }, { query: { page: '2' } }),
      { page: '1' }
    );
    assert.deepStrictEqual(
      getQuery({ queryParameters: { page: '2' } }, {}),
      { page: '2' }
    );
    assert.deepStrictEqual(
      getQuery({}, { query: { page: '3' } }),
      { page: '3' }
    );
    assert.deepStrictEqual(
      getQuery({}, { queries: { page: '4' } }),
      { page: '4' }
    );
  });

  test('accepts KINO_ACTIVATION_TOKEN bearer token', () => {
    const previous = process.env.KINO_ACTIVATION_TOKEN;
    process.env.KINO_ACTIVATION_TOKEN = 'activation-secret';

    const result = requireActivationBearer({
      headers: { authorization: 'Bearer activation-secret' },
    });

    process.env.KINO_ACTIVATION_TOKEN = previous;
    assert.strictEqual(result.ok, true);
  });

  test('rejects missing or wrong activation bearer token', () => {
    const previous = process.env.KINO_ACTIVATION_TOKEN;
    process.env.KINO_ACTIVATION_TOKEN = 'activation-secret';

    const result = requireActivationBearer({
      headers: { authorization: 'Bearer wrong' },
    });

    process.env.KINO_ACTIVATION_TOKEN = previous;
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.response.statusCode, 401);
  });
});
