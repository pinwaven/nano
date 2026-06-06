const assert = require('node:assert');
const { describe, test } = require('node:test');

const { handleExchangeToken } = require('../src/functions/kino/lib/tokenExchange');
const { hashToken } = require('../src/functions/kino/lib/tokens');

function createTokenExchangePool({ machine = null } = {}) {
  const queries = [];
  const client = {
    async query(sql, params = []) {
      queries.push({ sql, params });

      if (sql.includes('WHERE root_token_hash = $1')) {
        return { rows: machine ? [machine] : [] };
      }

      if (sql.startsWith('UPDATE kino_devices')) {
        return {
          rows: [{
            ...machine,
            comm_token_hash: params[0],
            comm_token_expires_at: params[2],
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

const activeMachine = {
  id: 7,
  machine_no: 'KNA1-F05107',
  machine_name: 'KNA1-F05107',
  model: 'KNA1',
  status: 'active',
  channel_id: null,
  coach_id: null,
  notes: null,
  mainboard_id: 'mb-7',
  firmware_id: 'fw-7',
};

describe('Kino root-token exchange handler', () => {
  test('exchanges a valid root token for a new 7-day communication token', async () => {
    const pool = createTokenExchangePool({ machine: activeMachine });

    const result = await handleExchangeToken({
      pool,
      rootToken: 'root-token',
      randomToken: () => 'comm-token',
      now: new Date('2026-05-15T00:00:00.000Z'),
      ttlDays: 7,
    });

    assert.strictEqual(result.statusCode, 200);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.machine.machine_no, 'KNA1-F05107');
    assert.strictEqual(result.comm_token, 'comm-token');
    assert.strictEqual(result.comm_token_expires_at, '2026-05-22T00:00:00.000Z');
    assert.ok(pool.queries.some((q) => q.sql === 'COMMIT'));

    const select = pool.queries.find((q) => q.sql.includes('WHERE root_token_hash = $1'));
    assert.strictEqual(select.params[0], hashToken('root-token'));

    const update = pool.queries.find((q) => q.sql.startsWith('UPDATE kino_devices'));
    assert.strictEqual(update.params[0], hashToken('comm-token'));
    assert.strictEqual(update.params.includes(hashToken('root-token')), false);
  });

  test('rejects an invalid root token without issuing a communication token', async () => {
    const pool = createTokenExchangePool();

    const result = await handleExchangeToken({
      pool,
      rootToken: 'wrong-root-token',
      randomToken: () => 'comm-token',
    });

    assert.strictEqual(result.statusCode, 401);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, 'invalid_root_token');
    assert.ok(pool.queries.some((q) => q.sql === 'ROLLBACK'));
    assert.strictEqual(pool.queries.some((q) => q.sql.startsWith('UPDATE kino_devices')), false);
  });

  test('rejects disabled machines even when the root token matches', async () => {
    const pool = createTokenExchangePool({
      machine: { ...activeMachine, status: 'inactive' },
    });

    const result = await handleExchangeToken({
      pool,
      rootToken: 'root-token',
      randomToken: () => 'comm-token',
    });

    assert.strictEqual(result.statusCode, 403);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, 'machine_not_active');
    assert.ok(pool.queries.some((q) => q.sql === 'ROLLBACK'));
    assert.strictEqual(pool.queries.some((q) => q.sql.startsWith('UPDATE kino_devices')), false);
  });
});
