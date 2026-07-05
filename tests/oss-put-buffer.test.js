const assert = require('node:assert/strict');
const { describe, test } = require('node:test');

describe('worker oss putBuffer', () => {
  test('uploads buffer with content type and public-read ACL, returns key', async () => {
    const oss = require('../src/functions/worker/lib/oss');
    const puts = [];
    const fakeClient = {
      async put(key, buffer, options) {
        puts.push({ key, buffer, options });
        return { name: key };
      },
    };

    const key = 'lab-reports/qcs/QCS-9/42-abcd1234.pdf';
    const result = await oss.putBuffer(
      key,
      Buffer.from('%PDF-1.4'),
      { contentType: 'application/pdf', publicRead: true },
      () => fakeClient
    );

    assert.equal(result, key);
    assert.equal(puts.length, 1);
    assert.equal(puts[0].key, key);
    assert.deepEqual(puts[0].buffer, Buffer.from('%PDF-1.4'));
    assert.equal(puts[0].options.headers['Content-Type'], 'application/pdf');
    assert.equal(puts[0].options.headers['x-oss-object-acl'], 'public-read');
  });

  test('omits ACL header when publicRead is not set', async () => {
    const oss = require('../src/functions/worker/lib/oss');
    const puts = [];
    const fakeClient = {
      async put(key, buffer, options) {
        puts.push({ key, buffer, options });
        return { name: key };
      },
    };

    await oss.putBuffer('a/b.bin', Buffer.from('x'), {}, () => fakeClient);

    assert.equal(puts[0].options.headers['x-oss-object-acl'], undefined);
    assert.equal(puts[0].options.headers['Content-Type'], 'application/octet-stream');
  });
});
