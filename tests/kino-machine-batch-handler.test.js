const assert = require('node:assert');
const { describe, test } = require('node:test');

const { handleCreateMachineBatch } = require('../src/functions/kino/lib/machines');

function createFakePool({ maxSequence = null } = {}) {
  const queries = [];
  const client = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.includes('MAX(sequence_no)')) {
        return { rows: [{ max_sequence: maxSequence }] };
      }
      if (sql.startsWith('INSERT INTO kino_devices')) {
        return {
          rows: [{
            id: params[4] - 100,
            machine_no: params[0],
            machine_name: params[1],
            model: params[2],
            sequence_no: params[4],
            status: 'inactive',
            created_at: '2026-05-01T00:00:00.000Z',
          }],
        };
      }
      return { rows: [] };
    },
    release() {},
  };

  return {
    queries,
    async connect() {
      return client;
    },
  };
}

describe('Kino machine batch creation handler', () => {
  test('creates inactive machine numbers in a transaction', async () => {
    const pool = createFakePool({ maxSequence: 102 });

    const result = await handleCreateMachineBatch({
      pool,
      body: { model: 'kna1', quantity: 2 },
      now: new Date('2026-05-15T02:00:00.000Z'),
    });

    assert.strictEqual(result.statusCode, 201);
    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(result.machines.map((m) => m.machine_no), [
      'KNA1-F05103',
      'KNA1-F05104',
    ]);
    assert.strictEqual(result.machines[0].status, 'inactive');
    assert.ok(pool.queries.some((q) => q.sql === 'BEGIN'));
    assert.ok(pool.queries.some((q) => q.sql === 'COMMIT'));
    assert.ok(pool.queries.some((q) => q.sql.includes('kino_devices')));
  });

  test('returns validation errors before touching the database', async () => {
    const pool = createFakePool();

    const result = await handleCreateMachineBatch({
      pool,
      body: { model: 'kna1', quantity: 900 },
      now: new Date('2026-05-15T02:00:00.000Z'),
    });

    assert.strictEqual(result.statusCode, 400);
    assert.strictEqual(result.success, false);
    assert.match(result.error, /quantity must be between 1 and 899/);
    assert.strictEqual(pool.queries.length, 0);
  });

  test('rejects a batch that would exceed the three-digit monthly sequence range', async () => {
    const pool = createFakePool({ maxSequence: 998 });

    const result = await handleCreateMachineBatch({
      pool,
      body: { model: 'kna1', quantity: 2 },
      now: new Date('2026-05-15T02:00:00.000Z'),
    });

    assert.strictEqual(result.statusCode, 400);
    assert.strictEqual(result.success, false);
    assert.match(result.error, /monthly sequence capacity exceeded/);
    assert.ok(pool.queries.some((q) => q.sql === 'ROLLBACK'));
  });
});
