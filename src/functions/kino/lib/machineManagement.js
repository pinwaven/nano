const VALID_STATUSES = new Set(['inactive', 'active', 'disabled']);
const SORT_COLUMNS = {
  id: 'kd.id',
  machine_no: 'kd.serial_number',
  machine_name: 'kd.name',
  model: 'kd.model',
  status: 'kd.status',
  channel_id: 'kd.channel_id',
  coach_id: 'kd.coach_id',
  activated_at: 'kd.activated_at',
  last_seen_at: 'kd.last_seen_at',
  comm_token_expires_at: 'kd.comm_token_expires_at',
  created_at: 'kd.created_at',
  updated_at: 'kd.updated_at',
};

function normalizeIntegerId(value, field) {
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${field} must be a positive integer or null`);
  }
  return parsed;
}

function toMachineResponse(row) {
  return {
    id: row.id,
    machine_no: row.machine_no,
    machine_name: row.machine_name,
    model: row.model,
    status: row.status,
    channel_id: row.channel_id ?? null,
    coach_id: row.coach_id ?? null,
    notes: row.notes ?? null,
    activated_at: row.activated_at ?? null,
    last_seen_at: row.last_seen_at ?? null,
    software_version: row.software_version ?? null,
    firmware_version: row.firmware_version ?? null,
    comm_token_expires_at: row.comm_token_expires_at ?? null,
    channel_name: row.channel_name ?? null,
    coach_name: row.coach_name ?? null,
  };
}

function normalizeMachineUpdate(body = {}) {
  const updates = {};

  if (Object.prototype.hasOwnProperty.call(body, 'machine_name')) {
    const machineName = String(body.machine_name || '').trim();
    if (!machineName) throw new Error('machine_name cannot be empty');
    updates.machine_name = machineName;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'status')) {
    const status = String(body.status || '').trim();
    if (!VALID_STATUSES.has(status)) {
      throw new Error('status must be inactive, active, or disabled');
    }
    updates.status = status;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'channel_id')) {
    updates.channel_id = normalizeIntegerId(body.channel_id, 'channel_id');
  }

  if (Object.prototype.hasOwnProperty.call(body, 'coach_id')) {
    updates.coach_id = normalizeIntegerId(body.coach_id, 'coach_id');
  }

  if (Object.prototype.hasOwnProperty.call(body, 'notes')) {
    updates.notes = body.notes === null ? null : String(body.notes);
  }

  if (Object.keys(updates).length === 0) {
    throw new Error('at least one update field is required');
  }

  return updates;
}

function addFilter(where, params, sql, value) {
  params.push(value);
  where.push(sql.replace('?', `$${params.length}`));
}

function normalizeListOptions(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page || '1', 10) || 1);
  const requestedLimit = Number.parseInt(query.limit || '50', 10) || 50;
  const limit = Math.min(200, Math.max(1, requestedLimit));
  const sortBy = SORT_COLUMNS[query.sort_by] ? query.sort_by : 'created_at';
  const sortOrder = String(query.sort_order || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  return {
    page,
    limit,
    offset: (page - 1) * limit,
    sortBy,
    sortOrder,
    sortColumn: SORT_COLUMNS[sortBy],
  };
}

async function handleListMachines({ pool, query = {} }) {
  if (!pool || typeof pool.connect !== 'function') {
    return { statusCode: 500, success: false, error: 'Database pool not initialized' };
  }

  const where = [];
  const params = [];

  if (query.model) addFilter(where, params, 'kd.model = ?', String(query.model).trim().toUpperCase());
  if (query.status) addFilter(where, params, 'kd.status = ?', String(query.status).trim());
  if (query.channel_id) addFilter(where, params, 'kd.channel_id = ?', Number(query.channel_id));
  if (query.coach_id) addFilter(where, params, 'kd.coach_id = ?', Number(query.coach_id));
  if (query.q) addFilter(where, params, '(kd.serial_number ILIKE ? OR kd.name ILIKE ?)', `%${String(query.q).trim()}%`);

  const options = normalizeListOptions(query);
  const qParamIndex = query.q ? params.length : null;
  const whereSql = where.length
    ? `WHERE ${where.join(' AND ').replace(`?`, `$${qParamIndex}`)}`
    : '';

  const client = await pool.connect();
  try {
    const countRes = await client.query(
      `SELECT COUNT(*)::int AS total
       FROM kino_devices kd
       LEFT JOIN channels c ON c.id = kd.channel_id
       LEFT JOIN coaches co ON co.id = kd.coach_id
       LEFT JOIN users u ON u.user_id = co.user_id
       ${whereSql}`,
      params
    );
    const total = Number(countRes.rows[0]?.total || 0);
    const dataParams = [...params, options.limit, options.offset];
    const limitParam = `$${dataParams.length - 1}`;
    const offsetParam = `$${dataParams.length}`;

    const res = await client.query(
      `SELECT kd.id,
              kd.serial_number AS machine_no,
              kd.name AS machine_name,
              kd.model,
              kd.status,
              kd.channel_id,
              kd.coach_id,
              kd.notes,
              kd.activated_at,
              kd.last_seen_at,
              kd.software_version,
              kd.firmware_version,
              kd.comm_token_expires_at,
              c.name AS channel_name,
              u.nickname AS coach_name
       FROM kino_devices kd
       LEFT JOIN channels c ON c.id = kd.channel_id
       LEFT JOIN coaches co ON co.id = kd.coach_id
       LEFT JOIN users u ON u.user_id = co.user_id
       ${whereSql}
       ORDER BY ${options.sortColumn} ${options.sortOrder} NULLS LAST, kd.id ${options.sortOrder}
       LIMIT ${limitParam} OFFSET ${offsetParam}`,
      dataParams
    );

    return {
      statusCode: 200,
      success: true,
      machines: res.rows.map(toMachineResponse),
      pagination: {
        page: options.page,
        limit: options.limit,
        total,
        total_pages: total === 0 ? 0 : Math.ceil(total / options.limit),
      },
    };
  } catch (err) {
    return { statusCode: 500, success: false, error: err.message };
  } finally {
    client.release();
  }
}

async function validateReference(client, table, id, error) {
  if (id === null || id === undefined) return null;
  const res = await client.query(`SELECT id FROM ${table} WHERE id = $1`, [id]);
  if (!res.rows[0]) {
    const err = new Error(error);
    err.statusCode = 400;
    throw err;
  }
  return id;
}

async function handleUpdateMachine({ pool, machineNo, body }) {
  let updates;
  try {
    updates = normalizeMachineUpdate(body);
  } catch (err) {
    return { statusCode: 400, success: false, error: err.message };
  }

  if (!machineNo) {
    return { statusCode: 400, success: false, error: 'machine_no is required' };
  }

  if (!pool || typeof pool.connect !== 'function') {
    return { statusCode: 500, success: false, error: 'Database pool not initialized' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const currentRes = await client.query(
      'SELECT id, status FROM kino_devices WHERE serial_number = $1 FOR UPDATE',
      [String(machineNo).trim()]
    );
    const currentMachine = currentRes.rows[0];
    if (!currentMachine) {
      await client.query('ROLLBACK');
      return { statusCode: 404, success: false, error: 'machine_not_found' };
    }

    if (
      currentMachine.status === 'inactive' &&
      Object.prototype.hasOwnProperty.call(updates, 'status') &&
      updates.status !== 'inactive'
    ) {
      const err = new Error('inactive_machine_status_locked');
      err.statusCode = 409;
      throw err;
    }

    await validateReference(client, 'channels', updates.channel_id, 'channel_id not found');
    await validateReference(client, 'coaches', updates.coach_id, 'coach_id not found');

    const assignments = [];
    const params = [];

    if (Object.prototype.hasOwnProperty.call(updates, 'machine_name')) {
      params.push(updates.machine_name);
      assignments.push(`name = $${params.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'status')) {
      params.push(updates.status);
      assignments.push(`status = $${params.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'channel_id')) {
      params.push(updates.channel_id);
      assignments.push(`channel_id = $${params.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'coach_id')) {
      params.push(updates.coach_id);
      assignments.push(`coach_id = $${params.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'notes')) {
      params.push(updates.notes);
      assignments.push(`notes = $${params.length}`);
    }

    params.push(String(machineNo).trim());
    const identifier = `serial_number = $${params.length}`;

    const res = await client.query(
      `UPDATE kino_devices
       SET ${assignments.join(', ')},
           updated_at = CURRENT_TIMESTAMP
       WHERE ${identifier}
       RETURNING id, serial_number AS machine_no, name AS machine_name, model, status, channel_id, coach_id,
                 notes, activated_at, last_seen_at, comm_token_expires_at,
                 NULL::TEXT AS channel_name, NULL::TEXT AS coach_name`,
      params
    );

    const machine = res.rows[0];
    if (!machine) {
      await client.query('ROLLBACK');
      return { statusCode: 404, success: false, error: 'machine_not_found' };
    }

    await client.query('COMMIT');
    return { statusCode: 200, success: true, machine: toMachineResponse(machine) };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    return { statusCode: err.statusCode || 500, success: false, error: err.message };
  } finally {
    client.release();
  }
}

module.exports = {
  handleListMachines,
  handleUpdateMachine,
  normalizeListOptions,
  normalizeMachineUpdate,
};
