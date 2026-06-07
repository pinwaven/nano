const assert = require('node:assert');
const { describe, test } = require('node:test');

const {
  getShanghaiMachinePeriod,
  generateMachineNumbers,
  normalizeMachineBatchInput,
} = require('../src/functions/kino/lib/machineNumbers');

describe('Kino machine number generation', () => {
  test('uses Shanghai date, uppercase model, year letter, month, and sequence starting from 101', () => {
    const period = getShanghaiMachinePeriod(new Date('2026-05-31T16:30:00.000Z'));

    assert.deepStrictEqual(period, {
      year: 2026,
      yearLetter: 'F',
      month: 6,
      monthCode: '06',
    });

    const machines = generateMachineNumbers({
      model: 'kna1',
      year: period.year,
      yearLetter: period.yearLetter,
      month: period.month,
      monthCode: period.monthCode,
      startSequence: 101,
      quantity: 3,
    });

    assert.deepStrictEqual(machines.map((m) => m.machine_no), [
      'KNA1-F06101',
      'KNA1-F06102',
      'KNA1-F06103',
    ]);
    assert.strictEqual(machines[0].model, 'KNA1');
    assert.strictEqual(machines[2].sequence_no, 103);
  });

  test('continues from an existing max sequence', () => {
    const machines = generateMachineNumbers({
      model: 'KNA1',
      year: 2026,
      yearLetter: 'F',
      month: 5,
      monthCode: '05',
      startSequence: 104,
      quantity: 2,
    });

    assert.deepStrictEqual(machines.map((m) => m.machine_no), [
      'KNA1-F05104',
      'KNA1-F05105',
    ]);
  });

  test('rejects invalid batch input', () => {
    assert.throws(
      () => normalizeMachineBatchInput({ model: 'kna1', quantity: 900 }),
      /quantity must be between 1 and 899/
    );

    assert.throws(
      () => normalizeMachineBatchInput({ model: 'kn-a', quantity: 1 }),
      /model must contain only letters and numbers/
    );
  });
});
