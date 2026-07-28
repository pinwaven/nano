const assert = require('node:assert');
const { describe, test } = require('node:test');

const { _private } = require('../src/functions/kino');

describe('POST /kino-curve routing', () => {
  test('isProtectedDeviceRoute returns true for POST /kino-curve', () => {
    assert.strictEqual(_private.isProtectedDeviceRoute('POST', '/kino-curve'), true);
  });

  test('isProtectedDeviceRoute returns false for GET /kino-curve', () => {
    assert.strictEqual(_private.isProtectedDeviceRoute('GET', '/kino-curve'), false);
  });
});
