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
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: { pool },
  };
  require.cache[ossPath] = {
    id: ossPath,
    filename: ossPath,
    loaded: true,
    exports: {},
  };
}

function event(method, rawPath, body) {
  return {
    rawPath,
    requestContext: { http: { method } },
    headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
    body: JSON.stringify(body || {}),
    isBase64Encoded: false,
  };
}

async function request(method, rawPath, body) {
  const worker = require('../src/functions/worker');
  const response = await worker.handler(event(method, rawPath, body));
  return {
    ...response,
    data: JSON.parse(response.body),
  };
}

describe('worker Kino device API', () => {
  beforeEach(() => {
    clearWorkerModules();
    process.env.API_BEARER_TOKEN = 'test-token';
  });

  test('POST /kino-devices returns conflict for duplicate serial numbers', async () => {
    const queries = [];
    installDbMock({
      async query(sql, params) {
        queries.push({ sql, params });
        if (sql.includes('INSERT INTO kino_devices')) {
          const err = new Error('duplicate key value violates unique constraint "kino_devices_serial_number_key"');
          err.code = '23505';
          err.constraint = 'kino_devices_serial_number_key';
          err.detail = 'Key (serial_number)=(KNA1-F05103) already exists.';
          throw err;
        }
        throw new Error(`unexpected query: ${sql}`);
      },
    });

    const response = await request('POST', '/kino-devices', {
      serial_number: ' kna1-f05103 ',
      name: 'Clinic Reader',
    });

    assert.equal(response.statusCode, 409);
    assert.deepEqual(response.data, {
      success: false,
      error: 'serial_number already exists',
      code: 'duplicate_serial_number',
    });
    assert.equal(queries.length, 1);
    assert.equal(queries[0].params[0], 'KNA1-F05103');
  });

  test('POST /kino-result updates the same device biomarker when it was tested within 10 minutes', async () => {
    const queries = [];
    installDbMock({
      async query(sql, params = []) {
        queries.push({ sql, params });

        if (sql.includes('SELECT id, user_id FROM scans')) {
          return { rows: [{ id: 5, user_id: 'user-1' }] };
        }

        if (sql.includes('UPDATE scans') || sql.includes('UPDATE kino_chips')) {
          return { rows: [] };
        }

        if (sql.includes('FROM biomarkers')) {
          return {
            rows: [{
              id: 88,
              data: { actual: { hsCRP: 1.1 }, estimated: { Albumin: 42 } },
              tested_at: '2026-06-15T02:00:00.000Z',
            }],
          };
        }

        if (sql.includes('UPDATE biomarkers')) {
          return { rows: [] };
        }

        if (sql.includes('INSERT INTO biomarkers')) {
          return { rows: [{ id: 77 }] };
        }

        throw new Error(`unexpected query: ${sql}`);
      },
    });

    const response = await request('POST', '/kino-result', {
      chip_id: 'chip-001',
      data: { estimated: { hsCRP: 1.2 }, bioage_profile: { BioAge: 32.1 } },
      bio_age: 32.1,
      kino_device_id: 42,
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.data.success, true);
    assert.equal(response.data.biomarker_id, 88);

    const select = queries.find((q) => q.sql.includes('FROM biomarkers'));
    assert.match(select.sql, /tested_at\s*>=\s*NOW\(\)\s*-\s*INTERVAL '10 minutes'/i);
    assert.equal(select.params[0], 'user-1');
    assert.equal(select.params[1], 42);

    const update = queries.find((q) => q.sql.includes('UPDATE biomarkers'));
    assert.ok(update);
    assert.equal(update.params[1], 32.1);
    assert.equal(update.params[2], 88);
    assert.deepEqual(JSON.parse(update.params[0]), {
      actual: { hsCRP: 1.1 },
      estimated: { Albumin: 42, hsCRP: 1.2 },
      bioage_profile: { BioAge: 32.1 },
    });

    const insert = queries.find((q) => q.sql.includes('INSERT INTO biomarkers'));
    assert.equal(insert, undefined);
  });
});
