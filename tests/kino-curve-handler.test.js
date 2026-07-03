const assert = require('node:assert');
const { test } = require('node:test');

const { handleGetKinoCurves } = require('../src/functions/worker/handlers/kino');

test('handleGetKinoCurves returns rows from the pool as curves', async () => {
  const captured = {};
  const mockPool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return { rows: [{ id: 1, chip_code: 'KNC12345678-0001', curve: [1, 2, 3], serial_number: 'KINO-001' }] };
    },
  };
  const res = await handleGetKinoCurves({ serial_number: 'KINO-001' }, mockPool);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.curves.length, 1);
  assert.deepStrictEqual(captured.params, ['KINO-001']);
});
