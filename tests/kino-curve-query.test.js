const assert = require('node:assert');
const { test } = require('node:test');

const { buildKinoCurvesQuery } = require('../src/functions/worker/handlers/kinoCurveQuery');

test('no filters produces no WHERE clause and empty params', () => {
  const { sql, params } = buildKinoCurvesQuery({});
  assert.strictEqual(params.length, 0);
  assert.ok(!/WHERE/i.test(sql));
});

test('serial_number filter binds a param and matches kino_devices', () => {
  const { sql, params } = buildKinoCurvesQuery({ serial_number: 'KINO-001' });
  assert.deepStrictEqual(params, ['KINO-001']);
  assert.ok(/kd\.serial_number = \$1/.test(sql));
});

test('both filters bind two params in order and AND them together', () => {
  const { sql, params } = buildKinoCurvesQuery({ serial_number: 'KINO-001', chip_code: 'KNC12345678-0001' });
  assert.deepStrictEqual(params, ['KINO-001', 'KNC12345678-0001']);
  assert.ok(/kd\.serial_number = \$1/.test(sql));
  assert.ok(/kc\.chip_code = \$2/.test(sql));
  assert.ok(/\$1 AND .*\$2/s.test(sql));
});
