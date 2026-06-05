const {
  generateToken,
  getCommTokenTtlDays,
  getExpiryIso,
  hashToken,
} = require('./tokens');

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
  };
}

async function handleExchangeToken({
  pool,
  rootToken,
  randomToken,
  now = new Date(),
  ttlDays = getCommTokenTtlDays(),
}) {
  const token = String(rootToken || '').trim();
  if (!token) {
    return { statusCode: 401, success: false, error: 'invalid_root_token' };
  }

  if (!pool || typeof pool.connect !== 'function') {
    return { statusCode: 500, success: false, error: 'Database pool not initialized' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const machineRes = await client.query(
      `SELECT id, serial_number AS machine_no, name AS machine_name, model, status, channel_id, coach_id,
              notes, mainboard_id, firmware_id
       FROM kino_devices
       WHERE root_token_hash = $1
       FOR UPDATE`,
      [hashToken(token)]
    );

    const machine = machineRes.rows[0];
    if (!machine) {
      await client.query('ROLLBACK');
      return { statusCode: 401, success: false, error: 'invalid_root_token' };
    }

    if (machine.status !== 'active') {
      await client.query('ROLLBACK');
      return { statusCode: 403, success: false, error: 'machine_not_active' };
    }

    const createToken = randomToken || (() => generateToken());
    const commToken = createToken('comm');
    const commTokenExpiresAt = getExpiryIso(now, ttlDays);

    const updateRes = await client.query(
      `UPDATE kino_devices
       SET comm_token_hash = $1,
           last_seen_at = CURRENT_TIMESTAMP,
           comm_token_expires_at = $3,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING id, serial_number AS machine_no, name AS machine_name, model, status, channel_id, coach_id,
                 notes, mainboard_id, firmware_id, comm_token_expires_at`,
      [hashToken(commToken), machine.id, commTokenExpiresAt]
    );

    await client.query('COMMIT');
    return {
      statusCode: 200,
      success: true,
      machine: toMachineResponse(updateRes.rows[0]),
      comm_token: commToken,
      comm_token_expires_at: commTokenExpiresAt,
    };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    return { statusCode: 500, success: false, error: err.message };
  } finally {
    client.release();
  }
}

module.exports = {
  handleExchangeToken,
};
