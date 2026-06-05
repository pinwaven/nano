const { hashToken } = require('./tokens');

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
    mainboard_id: row.mainboard_id,
    firmware_id: row.firmware_id,
    software_version: row.software_version ?? null,
    firmware_version: row.firmware_version ?? null,
    comm_token_expires_at: row.comm_token_expires_at,
  };
}

async function authenticateCommToken({ pool, commToken, now = new Date() }) {
  const token = String(commToken || '').trim();
  if (!token) {
    return { statusCode: 401, success: false, error: 'invalid_comm_token' };
  }

  if (!pool || typeof pool.connect !== 'function') {
    return { statusCode: 500, success: false, error: 'Database pool not initialized' };
  }

  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT id, serial_number AS machine_no, name AS machine_name, model, status, channel_id, coach_id,
              notes, mainboard_id, firmware_id, software_version, firmware_version, comm_token_expires_at
       FROM kino_devices
       WHERE comm_token_hash = $1`,
      [hashToken(token)]
    );

    const machine = res.rows[0];
    if (!machine) {
      return { statusCode: 401, success: false, error: 'invalid_comm_token' };
    }

    if (machine.status !== 'active') {
      return { statusCode: 403, success: false, error: 'machine_not_active' };
    }

    const expiresAt = new Date(machine.comm_token_expires_at);
    if (!machine.comm_token_expires_at || Number.isNaN(expiresAt.getTime()) || expiresAt <= now) {
      return { statusCode: 401, success: false, error: 'comm_token_expired' };
    }

    await client.query(
      `UPDATE kino_devices
       SET last_seen_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [machine.id]
    );

    return { statusCode: 200, success: true, machine: toMachineResponse(machine) };
  } catch (err) {
    return { statusCode: 500, success: false, error: err.message };
  } finally {
    client.release();
  }
}

async function handleProtectedDeviceRequest({ pool, commToken, handler, now = new Date(), event }) {
  const auth = await authenticateCommToken({ pool, commToken, now });
  if (!auth.success) return auth;

  return handler({ machine: auth.machine, event });
}

module.exports = {
  authenticateCommToken,
  handleProtectedDeviceRequest,
};
