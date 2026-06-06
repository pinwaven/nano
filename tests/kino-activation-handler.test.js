const assert = require('node:assert');
const { describe, test } = require('node:test');

const {
  handleActivateMachine,
} = require('../src/functions/kino/lib/activation');
const { encryptToken, hashToken } = require('../src/functions/kino/lib/tokens');

function createActivationPool({ existingRows = [], inactiveRow = null } = {}) {
  const queries = [];
  const client = {
    async query(sql, params = []) {
      queries.push({ sql, params });

      if (sql.includes('WHERE mainboard_id = $1 OR firmware_id = $2')) {
        return { rows: existingRows };
      }

      if (sql.includes("WHERE model = $1 AND status = 'inactive'")) {
        return { rows: inactiveRow ? [inactiveRow] : [] };
      }

      if (sql.startsWith('UPDATE kino_devices')) {
        const updatesRootToken = sql.includes('root_token_hash');
        const machineId = updatesRootToken ? params[4] : params[3];
        const existing = existingRows.find((row) => row.id === machineId) || inactiveRow;
        return {
          rows: [{
            ...existing,
            mainboard_id: params[0],
            firmware_id: params[1],
            root_token_hash: updatesRootToken ? params[2] : existing.root_token_hash,
            root_token_ciphertext: updatesRootToken ? params[3] : existing.root_token_ciphertext,
            comm_token_hash: updatesRootToken ? params[4] : params[2],
            comm_token_expires_at: updatesRootToken ? params[6] : params[4],
            status: 'active',
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
  id: 1,
  machine_no: 'KNA1-F05103',
  machine_name: 'KNA1-F05103',
  model: 'KNA1',
  mainboard_id: 'mb-1',
  firmware_id: 'fw-1',
  status: 'active',
};

describe('Kino activation handler', () => {
  test('returns machine info and keeps root token when both hardware IDs match', async () => {
    const encryptionKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const pool = createActivationPool({
      existingRows: [{
        ...activeMachine,
        root_token_hash: hashToken('root-token'),
        root_token_ciphertext: encryptToken('root-token', encryptionKey),
      }],
    });

    const result = await handleActivateMachine({
      pool,
      body: { mainboard_id: 'mb-1', firmware_id: 'fw-1', model: 'kna1' },
      randomToken: (name) => `${name}-token`,
      now: new Date('2026-05-15T00:00:00.000Z'),
      ttlDays: 7,
      encryptionKey,
    });

    assert.strictEqual(result.statusCode, 200);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.machine.machine_no, 'KNA1-F05103');
    assert.strictEqual(result.root_token, 'root-token');
    assert.strictEqual(result.comm_token, 'comm-token');
    assert.strictEqual(result.comm_token_expires_at, '2026-05-22T00:00:00.000Z');
    assert.ok(pool.queries.some((q) => q.sql === 'COMMIT'));

    const update = pool.queries.find((q) => q.sql.startsWith('UPDATE kino_devices'));
    assert.strictEqual(update.params[2], hashToken('comm-token'));
    assert.strictEqual(update.params.includes(hashToken('root-token')), false);
  });

  test('returns firmware mismatch when only mainboard ID matches', async () => {
    const pool = createActivationPool({
      existingRows: [{ ...activeMachine, firmware_id: 'fw-existing' }],
    });

    const result = await handleActivateMachine({
      pool,
      body: { mainboard_id: 'mb-1', firmware_id: 'fw-new', model: 'kna1' },
      randomToken: (name) => `${name}-token`,
    });

    assert.strictEqual(result.statusCode, 409);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, 'firmware_id_mismatch');
  });

  test('returns mainboard mismatch when only firmware ID matches', async () => {
    const pool = createActivationPool({
      existingRows: [{ ...activeMachine, mainboard_id: 'mb-existing' }],
    });

    const result = await handleActivateMachine({
      pool,
      body: { mainboard_id: 'mb-new', firmware_id: 'fw-1', model: 'kna1' },
      randomToken: (name) => `${name}-token`,
    });

    assert.strictEqual(result.statusCode, 409);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, 'mainboard_id_mismatch');
  });

  test('binds the next inactive machine when neither hardware ID exists', async () => {
    const pool = createActivationPool({
      inactiveRow: {
        id: 3,
        machine_no: 'KNA1-F05105',
        machine_name: 'KNA1-F05105',
        model: 'KNA1',
        status: 'inactive',
      },
    });

    const result = await handleActivateMachine({
      pool,
      body: { mainboard_id: 'mb-3', firmware_id: 'fw-3', model: 'kna1' },
      randomToken: (name) => `${name}-token`,
      now: new Date('2026-05-15T00:00:00.000Z'),
      ttlDays: 7,
      encryptionKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    });

    assert.strictEqual(result.statusCode, 201);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.machine.machine_no, 'KNA1-F05105');
    assert.strictEqual(result.machine.status, 'active');
    assert.strictEqual(result.root_token, 'root-token');
    assert.strictEqual(result.comm_token, 'comm-token');

    const update = pool.queries.find((q) => q.sql.startsWith('UPDATE kino_devices'));
    assert.strictEqual(update.params[2], hashToken('root-token'));
    assert.ok(update.params[3]);
  });

  test('returns no_available_machine_no when no inactive machine exists for a new device', async () => {
    const pool = createActivationPool();

    const result = await handleActivateMachine({
      pool,
      body: { mainboard_id: 'mb-3', firmware_id: 'fw-3', model: 'kna1' },
      randomToken: (name) => `${name}-token`,
    });

    assert.strictEqual(result.statusCode, 404);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, 'no_available_machine_no');
  });
});
