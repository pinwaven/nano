const assert = require('node:assert');
const { describe, test } = require('node:test');

const { parseBinCurve } = require('../src/functions/kino/lib/curveParser');

function buildBin({
  dataLen = 3,
  laserCurr = 100,
  dataBias = 200,
  laserCurrBias = 50,
  samples = [10, 20, 30],
  magic5a = 0x5a,
  magicA5 = 0xa5,
} = {}) {
  const buf = Buffer.alloc(10 + samples.length * 2);
  buf.writeUInt16LE(dataLen, 0);
  buf.writeUInt16LE(laserCurr, 2);
  buf.writeUInt8(magic5a, 4);
  buf.writeUInt16LE(dataBias, 5);
  buf.writeUInt16LE(laserCurrBias, 7);
  buf.writeUInt8(magicA5, 9);
  samples.forEach((v, i) => buf.writeUInt16LE(v, 10 + i * 2));
  return buf;
}

describe('parseBinCurve', () => {
  test('parses valid binary and returns curve + referenceValues', () => {
    const result = parseBinCurve(buildBin());
    assert.deepStrictEqual(result.curve, [10, 20, 30]);
    assert.strictEqual(result.referenceValues.dataLen, 3);
    assert.strictEqual(result.referenceValues.laserCurr, 100);
    assert.strictEqual(result.referenceValues.dataBias, 200);
    assert.strictEqual(result.referenceValues.laserCurrBias, 50);
  });

  test('rejects buffer shorter than 10-byte header', () => {
    assert.throws(
      () => parseBinCurve(Buffer.alloc(5)),
      { code: 'HEADER_TOO_SHORT' }
    );
  });

  test('rejects bad 0x5A magic byte', () => {
    assert.throws(
      () => parseBinCurve(buildBin({ magic5a: 0xff })),
      { code: 'BAD_MAGIC_5A' }
    );
  });

  test('rejects bad 0xA5 magic byte', () => {
    assert.throws(
      () => parseBinCurve(buildBin({ magicA5: 0xff })),
      { code: 'BAD_MAGIC_A5' }
    );
  });

  test('rejects data length mismatch (header > actual bytes)', () => {
    assert.throws(
      () => parseBinCurve(buildBin({ dataLen: 5, samples: [1, 2, 3] })),
      { code: 'LENGTH_MISMATCH' }
    );
  });

  test('rejects ADC value exceeding 13-bit max (0x2000)', () => {
    assert.throws(
      () => parseBinCurve(buildBin({ dataLen: 1, samples: [0x2000] })),
      { code: 'ADC_OUT_OF_RANGE' }
    );
  });

  test('accepts maximum valid 13-bit ADC value (0x1FFF)', () => {
    const result = parseBinCurve(buildBin({ dataLen: 1, samples: [0x1fff] }));
    assert.deepStrictEqual(result.curve, [0x1fff]);
  });

  test('accepts zero-sample binary', () => {
    const result = parseBinCurve(buildBin({ dataLen: 0, samples: [] }));
    assert.deepStrictEqual(result.curve, []);
    assert.strictEqual(result.referenceValues.dataLen, 0);
  });
});
