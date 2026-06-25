const assert = require('node:assert');
const { describe, test } = require('node:test');

const { handlePostKinoCurve } = require('../src/functions/kino/lib/curveHandler');

const machine = { id: 7, machine_no: 'KNA1-F05107' };

function buildBin({ dataLen = 2, samples = [10, 20], magic5a = 0x5a, magicA5 = 0xa5 } = {}) {
  const buf = Buffer.alloc(10 + samples.length * 2);
  buf.writeUInt16LE(dataLen, 0);
  buf.writeUInt16LE(100, 2);
  buf.writeUInt8(magic5a, 4);
  buf.writeUInt16LE(200, 5);
  buf.writeUInt16LE(50, 7);
  buf.writeUInt8(magicA5, 9);
  samples.forEach((v, i) => buf.writeUInt16LE(v, 10 + i * 2));
  return buf;
}

function buildMultipart(qrcode, binBuf, boundary = 'testboundary', refValues = '{}') {
  const parts = [
    `--${boundary}\r\n`,
    `Content-Disposition: form-data; name="qrcode"\r\n\r\n`,
    `${qrcode}\r\n`,
    `--${boundary}\r\n`,
    `Content-Disposition: form-data; name="reference_values"\r\n\r\n`,
    `${refValues}\r\n`,
    `--${boundary}\r\n`,
    `Content-Disposition: form-data; name="curve_file"; filename="curve.bin"\r\n`,
    `Content-Type: application/octet-stream\r\n\r\n`,
  ];
  const head = Buffer.from(parts.join(''));
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return Buffer.concat([head, binBuf, tail]);
}

function createPool({ insertId = 42 } = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.includes('INSERT INTO kino_curve')) {
        return { rows: [{ id: insertId }] };
      }
      return { rows: [] };
    },
  };
}

const { handleDeviceBusinessRequest } = require('../src/functions/kino/lib/deviceHandlers');

describe('handleDeviceBusinessRequest POST /kino-curve dispatch', () => {
  test('dispatches to handlePostKinoCurve and returns success', async () => {
    const pool = createPool({ insertId: 77 });
    const bin = buildBin();
    const boundary = 'dispatchtest';
    const body = buildMultipart('KNC00000001-0001', bin, boundary);

    const result = await handleDeviceBusinessRequest({
      pool,
      method: 'POST',
      path: '/kino-curve',
      event: {
        body: body.toString('base64'),
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      },
      machine,
      body: {},
      query: {},
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.id, 77);
  });
});

describe('handlePostKinoCurve', () => {
  test('returns 400 when content-type has no boundary', async () => {
    const result = await handlePostKinoCurve({
      pool: createPool(),
      rawBody: Buffer.from(''),
      contentType: 'multipart/form-data',
      machine,
    });
    assert.strictEqual(result.statusCode, 400);
    assert.strictEqual(result.error, 'missing_multipart_boundary');
  });

  test('returns 400 when qrcode field is missing', async () => {
    const boundary = 'b';
    const bin = buildBin();
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="curve_file"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      bin,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const result = await handlePostKinoCurve({
      pool: createPool(),
      rawBody: body,
      contentType: `multipart/form-data; boundary=${boundary}`,
      machine,
    });
    assert.strictEqual(result.statusCode, 400);
    assert.strictEqual(result.error, 'qrcode_required');
  });

  test('returns 422 with error code when binary is malformed', async () => {
    const boundary = 'b2';
    const badBin = buildBin({ magic5a: 0xff });
    const body = buildMultipart('KNC00000000-0001', badBin, boundary);
    const result = await handlePostKinoCurve({
      pool: createPool(),
      rawBody: body,
      contentType: `multipart/form-data; boundary=${boundary}`,
      machine,
    });
    assert.strictEqual(result.statusCode, 422);
    assert.strictEqual(result.code, 'BAD_MAGIC_5A');
  });

  test('decodes base64-encoded body (FC 3.0 mode)', async () => {
    const pool = createPool({ insertId: 99 });
    const bin = buildBin({ dataLen: 1, samples: [512] });
    const boundary = 'fc3boundary';
    const rawMultipart = buildMultipart('KNC99999999-0001', bin, boundary);
    const base64Body = rawMultipart.toString('base64');

    const result = await handlePostKinoCurve({
      pool,
      rawBody: base64Body,
      contentType: `multipart/form-data; boundary=${boundary}`,
      machine,
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.id, 99);
  });

  test('inserts curve and returns success with id', async () => {
    const pool = createPool({ insertId: 42 });
    const bin = buildBin();
    const boundary = 'testboundary';
    const body = buildMultipart('KNC12345678-0001', bin, boundary);

    const result = await handlePostKinoCurve({
      pool,
      rawBody: body,
      contentType: `multipart/form-data; boundary=${boundary}`,
      machine,
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.id, 42);
    assert.strictEqual(pool.queries.length, 1);
    assert.ok(pool.queries[0].sql.includes('INSERT INTO kino_curve'));
    assert.strictEqual(pool.queries[0].params[0], machine.id);
    assert.strictEqual(pool.queries[0].params[1], 'KNC12345678-0001');
  });

  test('returns 400 when reference_values field is missing', async () => {
    const boundary = 'b3';
    const bin = buildBin();
    // build multipart WITHOUT reference_values
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="qrcode"\r\n\r\nKNC00000000-0001\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="curve_file"; filename="curve.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      bin,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const result = await handlePostKinoCurve({
      pool: createPool(),
      rawBody: body,
      contentType: `multipart/form-data; boundary=${boundary}`,
      machine,
    });
    assert.strictEqual(result.statusCode, 400);
    assert.strictEqual(result.error, 'reference_values_required');
  });

  test('returns 400 when reference_values is invalid JSON', async () => {
    const boundary = 'b4';
    const bin = buildBin();
    const body = buildMultipart('KNC00000000-0001', bin, boundary, 'not-json');
    const result = await handlePostKinoCurve({
      pool: createPool(),
      rawBody: body,
      contentType: `multipart/form-data; boundary=${boundary}`,
      machine,
    });
    assert.strictEqual(result.statusCode, 400);
    assert.strictEqual(result.error, 'reference_values_invalid_json');
  });
});
