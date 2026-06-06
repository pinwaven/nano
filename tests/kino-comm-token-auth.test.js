const assert = require('node:assert');
const { describe, test } = require('node:test');

const {
  authenticateCommToken,
  handleProtectedDeviceRequest,
} = require('../src/functions/kino/lib/deviceAuth');
const { hashToken } = require('../src/functions/kino/lib/tokens');

function createAuthPool({ machine = null } = {}) {
  const queries = [];
  const client = {
    async query(sql, params = []) {
      queries.push({ sql, params });

      if (sql.includes('WHERE comm_token_hash = $1')) {
        return { rows: machine ? [machine] : [] };
      }

      if (sql.startsWith('UPDATE kino_devices')) {
        return { rows: [{ ...machine, last_seen_at: '2026-05-15T00:00:00.000Z' }] };
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
  comm_token_expires_at: '2026-05-22T00:00:00.000Z',
};

describe('Kino communication-token authentication', () => {
  test('rejects missing and invalid communication tokens', async () => {
    const missing = await authenticateCommToken({ pool: createAuthPool(), commToken: '' });
    const invalidPool = createAuthPool();
    const invalid = await authenticateCommToken({ pool: invalidPool, commToken: 'wrong-token' });

    assert.strictEqual(missing.statusCode, 401);
    assert.strictEqual(missing.error, 'invalid_comm_token');
    assert.strictEqual(invalid.statusCode, 401);
    assert.strictEqual(invalid.error, 'invalid_comm_token');

    const select = invalidPool.queries.find((q) => q.sql.includes('WHERE comm_token_hash = $1'));
    assert.strictEqual(select.params[0], hashToken('wrong-token'));
  });

  test('rejects disabled and expired machines', async () => {
    const disabled = await authenticateCommToken({
      pool: createAuthPool({ machine: { ...activeMachine, status: 'disabled' } }),
      commToken: 'comm-token',
      now: new Date('2026-05-15T00:00:00.000Z'),
    });

    const expired = await authenticateCommToken({
      pool: createAuthPool({ machine: activeMachine }),
      commToken: 'comm-token',
      now: new Date('2026-05-23T00:00:00.000Z'),
    });

    assert.strictEqual(disabled.statusCode, 403);
    assert.strictEqual(disabled.error, 'machine_not_active');
    assert.strictEqual(expired.statusCode, 401);
    assert.strictEqual(expired.error, 'comm_token_expired');
  });

  test('updates last_seen_at and passes machine context to protected handlers', async () => {
    const pool = createAuthPool({ machine: activeMachine });

    const result = await handleProtectedDeviceRequest({
      pool,
      commToken: 'comm-token',
      now: new Date('2026-05-15T00:00:00.000Z'),
      handler: async ({ machine }) => ({
        statusCode: 200,
        success: true,
        machine_no: machine.machine_no,
      }),
    });

    assert.strictEqual(result.statusCode, 200);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.machine_no, 'KNA1-F05107');
    assert.ok(pool.queries.some((q) => q.sql.startsWith('UPDATE kino_devices')));
  });
});
