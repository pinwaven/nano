const {
  decryptToken,
  encryptToken,
  generateToken,
  getCommTokenTtlDays,
  getExpiryIso,
  hashToken,
} = require('./tokens');

function normalizeActivationInput(body = {}) {
  const mainboardId = String(body.mainboard_id || '').trim();
  const firmwareId = String(body.firmware_id || '').trim();
  const model = String(body.model || '').trim().toUpperCase();

  if (!mainboardId) throw new Error('mainboard_id is required');
  if (!firmwareId) throw new Error('firmware_id is required');
  if (!model) throw new Error('model is required');
  if (!/^[A-Z0-9]+$/.test(model)) {
    throw new Error('model must contain only letters and numbers');
  }

  return { mainboardId, firmwareId, model };
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
    mainboard_id: row.mainboard_id,
    firmware_id: row.firmware_id,
  };
}

async function issueTokensForMachine({
  client,
  machine,
  mainboardId,
  firmwareId,
  randomToken,
  now,
  ttlDays,
  encryptionKey,
}) {
  const createToken = randomToken || (() => generateToken());
  const rootToken = createToken('root');
  const commToken = createToken('comm');
  const commTokenExpiresAt = getExpiryIso(now, ttlDays);

  const res = await client.query(
    `UPDATE kino_devices
     SET mainboard_id = $1,
         firmware_id = $2,
         root_token_hash = $3,
         root_token_ciphertext = $4,
         comm_token_hash = $5,
         status = 'active',
         activated_at = COALESCE(activated_at, CURRENT_TIMESTAMP),
         last_seen_at = CURRENT_TIMESTAMP,
         comm_token_expires_at = $7,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $6
     RETURNING id, serial_number AS machine_no, name AS machine_name, model, status, channel_id, coach_id,
               notes, mainboard_id, firmware_id, comm_token_expires_at`,
    [
      mainboardId,
      firmwareId,
      hashToken(rootToken),
      encryptToken(rootToken, encryptionKey),
      hashToken(commToken),
      machine.id,
      commTokenExpiresAt,
    ]
  );

  const updated = res.rows[0];
  return {
    machine: toMachineResponse(updated),
    root_token: rootToken,
    comm_token: commToken,
    comm_token_expires_at: commTokenExpiresAt,
  };
}

async function issueCommTokenForMachine({
  client,
  machine,
  mainboardId,
  firmwareId,
  randomToken,
  now,
  ttlDays,
  encryptionKey,
}) {
  const createToken = randomToken || (() => generateToken());
  const commToken = createToken('comm');
  const commTokenExpiresAt = getExpiryIso(now, ttlDays);

  const res = await client.query(
    `UPDATE kino_devices
     SET mainboard_id = $1,
         firmware_id = $2,
         comm_token_hash = $3,
         status = 'active',
         last_seen_at = CURRENT_TIMESTAMP,
         comm_token_expires_at = $5,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $4
     RETURNING id, serial_number AS machine_no, name AS machine_name, model, status, channel_id, coach_id,
               notes, mainboard_id, firmware_id, comm_token_expires_at`,
    [
      mainboardId,
      firmwareId,
      hashToken(commToken),
      machine.id,
      commTokenExpiresAt,
    ]
  );

  const updated = res.rows[0];
  return {
    machine: toMachineResponse(updated),
    root_token: decryptToken(machine.root_token_ciphertext, encryptionKey),
    comm_token: commToken,
    comm_token_expires_at: commTokenExpiresAt,
  };
}

async function handleActivateMachine({
  pool,
  body,
  randomToken,
  now = new Date(),
  ttlDays = getCommTokenTtlDays(),
  encryptionKey = process.env.KINO_ROOT_TOKEN_ENCRYPTION_KEY,
}) {
  let input;
  try {
    input = normalizeActivationInput(body);
  } catch (err) {
    return { statusCode: 400, success: false, error: err.message };
  }

  if (!pool || typeof pool.connect !== 'function') {
    return { statusCode: 500, success: false, error: 'Database pool not initialized' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existingRes = await client.query(
      `SELECT id, serial_number AS machine_no, name AS machine_name, model, status, channel_id, coach_id,
              notes, mainboard_id, firmware_id, root_token_ciphertext
       FROM kino_devices
       WHERE mainboard_id = $1 OR firmware_id = $2
       FOR UPDATE`,
      [input.mainboardId, input.firmwareId]
    );

    const exactMatch = existingRes.rows.find(
      (row) => row.mainboard_id === input.mainboardId && row.firmware_id === input.firmwareId
    );
    if (exactMatch) {
      const issued = await issueCommTokenForMachine({
        client,
        machine: exactMatch,
        mainboardId: input.mainboardId,
        firmwareId: input.firmwareId,
        randomToken,
        now,
        ttlDays,
        encryptionKey,
      });
      await client.query('COMMIT');
      return { statusCode: 200, success: true, ...issued };
    }

    const mainboardMatch = existingRes.rows.find((row) => row.mainboard_id === input.mainboardId);
    if (mainboardMatch) {
      await client.query('ROLLBACK');
      return {
        statusCode: 409,
        success: false,
        error: 'firmware_id_mismatch',
        machine_no: mainboardMatch.machine_no,
      };
    }

    const firmwareMatch = existingRes.rows.find((row) => row.firmware_id === input.firmwareId);
    if (firmwareMatch) {
      await client.query('ROLLBACK');
      return {
        statusCode: 409,
        success: false,
        error: 'mainboard_id_mismatch',
        machine_no: firmwareMatch.machine_no,
      };
    }

    const inactiveRes = await client.query(
      `SELECT id, serial_number AS machine_no, name AS machine_name, model, status, channel_id, coach_id,
              notes, mainboard_id, firmware_id
       FROM kino_devices
       WHERE model = $1 AND status = 'inactive'
       ORDER BY production_year, production_month, sequence_no
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
      [input.model]
    );

    const inactiveMachine = inactiveRes.rows[0];
    if (!inactiveMachine) {
      await client.query('ROLLBACK');
      return { statusCode: 404, success: false, error: 'no_available_machine_no' };
    }

    const issued = await issueTokensForMachine({
      client,
      machine: inactiveMachine,
      mainboardId: input.mainboardId,
      firmwareId: input.firmwareId,
      randomToken,
      now,
      ttlDays,
      encryptionKey,
    });
    await client.query('COMMIT');
    return { statusCode: 201, success: true, ...issued };
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
  handleActivateMachine,
  normalizeActivationInput,
};
