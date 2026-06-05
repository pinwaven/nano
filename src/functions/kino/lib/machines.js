const {
  generateMachineNumbers,
  getShanghaiMachinePeriod,
  normalizeMachineBatchInput,
} = require('./machineNumbers');

async function handleCreateMachineBatch({ pool, body, now = new Date() }) {
  let input;
  try {
    input = normalizeMachineBatchInput(body);
  } catch (err) {
    return { statusCode: 400, success: false, error: err.message };
  }

  if (!pool || typeof pool.connect !== 'function') {
    return { statusCode: 500, success: false, error: 'Database pool not initialized' };
  }

  const period = getShanghaiMachinePeriod(now);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      [`kino_devices:${input.model}:${period.year}:${period.month}`]
    );

    const maxRes = await client.query(
      `SELECT COALESCE(MAX(sequence_no), 100) AS max_sequence
       FROM kino_devices
       WHERE model = $1 AND production_year = $2 AND production_month = $3`,
      [input.model, period.year, period.month]
    );

    const startSequence = Number(maxRes.rows[0]?.max_sequence || 100) + 1;
    const endSequence = startSequence + input.quantity - 1;
    if (endSequence > 999) {
      const err = new Error('monthly sequence capacity exceeded');
      err.statusCode = 400;
      throw err;
    }

    const machines = generateMachineNumbers({
      model: input.model,
      year: period.year,
      yearLetter: period.yearLetter,
      month: period.month,
      monthCode: period.monthCode,
      startSequence,
      quantity: input.quantity,
    });

    const inserted = [];
    for (const machine of machines) {
      const res = await client.query(
        `INSERT INTO kino_devices (
           serial_number, name, model, production_year, sequence_no,
           year_letter, production_month, status
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'inactive')
         RETURNING id, serial_number AS machine_no, name AS machine_name, model, production_year,
                   year_letter, production_month, sequence_no, status, created_at`,
        [
          machine.machine_no,
          machine.machine_name,
          machine.model,
          machine.year,
          machine.sequence_no,
          machine.year_letter,
          machine.month,
        ]
      );
      inserted.push(res.rows[0]);
    }

    await client.query('COMMIT');
    return { statusCode: 201, success: true, machines: inserted };
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
  handleCreateMachineBatch,
};
