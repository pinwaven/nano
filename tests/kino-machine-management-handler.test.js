const assert = require('node:assert');
const { describe, test } = require('node:test');

const {
  handleListMachines,
  handleUpdateMachine,
} = require('../src/functions/kino/lib/machineManagement');

function createManagementPool({
  listRows = [],
  total = listRows.length,
  updateRow = null,
  currentMachineRow = updateRow,
  channelExists = true,
  coachExists = true,
} = {}) {
  const queries = [];
  const client = {
    async query(sql, params = []) {
      queries.push({ sql, params });

      if (sql.includes('FROM channels WHERE id = $1')) {
        return { rows: channelExists ? [{ id: params[0] }] : [] };
      }

      if (sql.includes('FROM coaches WHERE id = $1')) {
        return { rows: coachExists ? [{ id: params[0] }] : [] };
      }

      if (sql.includes('FROM kino_devices WHERE serial_number = $1 FOR UPDATE')) {
        return { rows: currentMachineRow ? [currentMachineRow] : [] };
      }

      if (sql.startsWith('UPDATE kino_devices')) {
        return { rows: updateRow ? [updateRow] : [] };
      }

      if (sql.includes('COUNT(*)::int AS total')) {
        return { rows: [{ total }] };
      }

      if (sql.includes('FROM kino_devices kd')) {
        return { rows: listRows };
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

const machineRow = {
  id: 11,
  machine_no: 'KNA1-F05111',
  machine_name: 'Clinic Reader A',
  model: 'KNA1',
  status: 'active',
  channel_id: 12,
  coach_id: 34,
  notes: 'front desk',
  activated_at: '2026-05-15T00:00:00.000Z',
  last_seen_at: '2026-05-16T00:00:00.000Z',
  software_version: null,
  firmware_version: null,
  comm_token_expires_at: '2026-05-22T00:00:00.000Z',
  channel_name: 'Shanghai Clinic',
  coach_name: 'Coach Li',
};

describe('Kino machine management handlers', () => {
  test('lists machines with filters and display fields', async () => {
    const pool = createManagementPool({ listRows: [machineRow], total: 1 });

    const result = await handleListMachines({
      pool,
      query: {
        model: 'kna1',
        status: 'active',
        channel_id: '12',
        coach_id: '34',
        q: 'Reader',
        page: '2',
        limit: '25',
        sort_by: 'last_seen_at',
        sort_order: 'asc',
      },
    });

    assert.strictEqual(result.statusCode, 200);
    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(result.machines, [machineRow]);
    assert.deepStrictEqual(result.pagination, {
      page: 2,
      limit: 25,
      total: 1,
      total_pages: 1,
    });
    assert.strictEqual(result.machines[0].channel_name, 'Shanghai Clinic');
    assert.strictEqual(result.machines[0].coach_name, 'Coach Li');

    const count = pool.queries.find((q) => q.sql.includes('COUNT(*)::int AS total'));
    assert.ok(count);
    assert.deepStrictEqual(count.params, ['KNA1', 'active', 12, 34, '%Reader%']);

    const select = pool.queries.find((q) => q.sql.includes('SELECT kd.id'));
    assert.ok(select.sql.includes('kd.model = $1'));
    assert.ok(select.sql.includes('kd.status = $2'));
    assert.ok(select.sql.includes('kd.channel_id = $3'));
    assert.ok(select.sql.includes('kd.coach_id = $4'));
    assert.ok(select.sql.includes('kd.serial_number ILIKE $5 OR kd.name ILIKE $5'));
    assert.ok(select.sql.includes('u.nickname AS coach_name'));
    assert.ok(select.sql.includes('LEFT JOIN users u ON u.user_id = co.user_id'));
    assert.ok(select.sql.includes('ORDER BY kd.last_seen_at ASC NULLS LAST, kd.id ASC'));
    assert.ok(select.sql.includes('LIMIT $6 OFFSET $7'));
    assert.deepStrictEqual(select.params, ['KNA1', 'active', 12, 34, '%Reader%', 25, 25]);
  });

  test('normalizes invalid pagination and sorting inputs to safe defaults', async () => {
    const pool = createManagementPool({ listRows: [] });

    const result = await handleListMachines({
      pool,
      query: { page: '-1', limit: '9999', sort_by: 'unsafe_sql', sort_order: 'sideways' },
    });

    assert.strictEqual(result.statusCode, 200);
    assert.deepStrictEqual(result.pagination, {
      page: 1,
      limit: 200,
      total: 0,
      total_pages: 0,
    });

    const select = pool.queries.find((q) => q.sql.includes('SELECT kd.id'));
    assert.ok(select.sql.includes('ORDER BY kd.created_at DESC NULLS LAST, kd.id DESC'));
    assert.ok(select.sql.includes('LIMIT $1 OFFSET $2'));
    assert.deepStrictEqual(select.params, [200, 0]);
  });

  test('updates editable machine fields after validating channel and coach references', async () => {
    const pool = createManagementPool({ updateRow: machineRow });

    const result = await handleUpdateMachine({
      pool,
      machineNo: 'KNA1-F05111',
      body: {
        machine_name: 'Clinic Reader A',
        status: 'active',
        channel_id: 12,
        coach_id: 34,
        notes: 'front desk',
      },
    });

    assert.strictEqual(result.statusCode, 200);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.machine.machine_no, 'KNA1-F05111');
    assert.ok(pool.queries.some((q) => q.sql === 'BEGIN'));
    assert.ok(pool.queries.some((q) => q.sql.includes('FROM channels WHERE id = $1')));
    assert.ok(pool.queries.some((q) => q.sql.includes('FROM coaches WHERE id = $1')));
    assert.ok(pool.queries.some((q) => q.sql === 'COMMIT'));

    const update = pool.queries.find((q) => q.sql.startsWith('UPDATE kino_devices'));
    assert.ok(update.sql.includes('name = $1'));
    assert.ok(update.sql.includes('status = $2'));
    assert.ok(update.sql.includes('channel_id = $3'));
    assert.ok(update.sql.includes('coach_id = $4'));
    assert.ok(update.sql.includes('notes = $5'));
    assert.ok(update.sql.includes('serial_number = $6'));
  });

  test('rejects invalid status and empty update bodies before touching the database', async () => {
    const pool = createManagementPool();

    const invalidStatus = await handleUpdateMachine({
      pool,
      machineNo: 'KNA1-F05111',
      body: { status: 'maintenance' },
    });

    const empty = await handleUpdateMachine({
      pool,
      machineNo: 'KNA1-F05111',
      body: {},
    });

    assert.strictEqual(invalidStatus.statusCode, 400);
    assert.strictEqual(invalidStatus.error, 'status must be inactive, active, or disabled');
    assert.strictEqual(empty.statusCode, 400);
    assert.strictEqual(empty.error, 'at least one update field is required');
    assert.strictEqual(pool.queries.length, 0);
  });

  test('rejects changing inactive machines to another status', async () => {
    const pool = createManagementPool({
      currentMachineRow: { ...machineRow, status: 'inactive' },
      updateRow: { ...machineRow, status: 'active' },
    });

    const result = await handleUpdateMachine({
      pool,
      machineNo: 'KNA1-F05111',
      body: { status: 'active' },
    });

    assert.strictEqual(result.statusCode, 409);
    assert.strictEqual(result.error, 'inactive_machine_status_locked');
    assert.ok(pool.queries.some((q) => q.sql === 'ROLLBACK'));
    assert.ok(!pool.queries.some((q) => q.sql.startsWith('UPDATE kino_devices')));
  });

  test('rejects unknown channel or coach assignments', async () => {
    const missingChannelPool = createManagementPool({
      currentMachineRow: machineRow,
      channelExists: false,
    });
    const missingChannel = await handleUpdateMachine({
      pool: missingChannelPool,
      machineNo: 'KNA1-F05111',
      body: { channel_id: 99 },
    });

    const missingCoachPool = createManagementPool({
      currentMachineRow: machineRow,
      coachExists: false,
    });
    const missingCoach = await handleUpdateMachine({
      pool: missingCoachPool,
      machineNo: 'KNA1-F05111',
      body: { coach_id: 88 },
    });

    assert.strictEqual(missingChannel.statusCode, 400);
    assert.strictEqual(missingChannel.error, 'channel_id not found');
    assert.strictEqual(missingCoach.statusCode, 400);
    assert.strictEqual(missingCoach.error, 'coach_id not found');
  });
});
