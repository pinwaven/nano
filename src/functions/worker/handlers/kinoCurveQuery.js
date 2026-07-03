function buildKinoCurvesQuery(query = {}) {
    const conditions = [];
    const params = [];
    if (query.serial_number) {
        params.push(query.serial_number);
        conditions.push(`kd.serial_number = $${params.length}`);
    }
    if (query.chip_code) {
        params.push(query.chip_code);
        conditions.push(`kc.chip_code = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `
        SELECT kc.id, kc.chip_code, kc.curve, kc.reference_values, kc.created_at,
               kc.kino_device_id, kd.serial_number
        FROM kino_curve kc
        LEFT JOIN kino_devices kd ON kd.id = kc.kino_device_id
        ${where}
        ORDER BY kc.created_at DESC
    `;
    return { sql, params };
}

module.exports = { buildKinoCurvesQuery };
