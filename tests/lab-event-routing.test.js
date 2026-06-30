const assert = require('node:assert/strict');
const { describe, test } = require('node:test');

describe('lab FC event routing', () => {
  test('decodes HTTP trigger events delivered as Buffer', () => {
    const { __private } = require('../src/functions/lab');
    const httpEvent = {
      rawPath: '/lab/webhook/qcs',
      requestContext: { http: { method: 'POST' } },
      headers: {},
      body: '{}',
    };

    const decoded = __private.decodeFcEvent(Buffer.from(JSON.stringify(httpEvent), 'utf8'));

    assert.deepEqual(decoded, httpEvent);
    assert.equal(__private.isTimerEvent(decoded), false);
  });

  test('treats empty Buffer payload as timer trigger', () => {
    const { __private } = require('../src/functions/lab');

    const decoded = __private.decodeFcEvent(Buffer.from('', 'utf8'));

    assert.equal(__private.isTimerEvent(decoded), true);
  });

  test('builds request URI with raw query string for QCS signatures', () => {
    const { __private } = require('../src/functions/lab');

    assert.equal(__private.buildRequestUrl({
      rawPath: '/lab/webhook/qcs',
      rawQueryString: 'b=2&a=%E5%BC%A0',
      queryParameters: { a: '张', b: '2' },
    }), '/lab/webhook/qcs?b=2&a=%E5%BC%A0');
  });
});
