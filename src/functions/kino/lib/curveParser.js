'use strict';

const MAGIC_5A = 0x5a;
const MAGIC_A5 = 0xa5;
const HEADER_BYTES = 10;
const ADC_MAX = 0x1fff;

function parseBinCurve(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < HEADER_BYTES) {
    throw Object.assign(new Error('binary too short'), { code: 'HEADER_TOO_SHORT' });
  }

  const dataLen       = buffer.readUInt16LE(0);
  const laserCurr     = buffer.readUInt16LE(2);
  const fixed5a       = buffer.readUInt8(4);
  const dataBias      = buffer.readUInt16LE(5);
  const laserCurrBias = buffer.readUInt16LE(7);
  const fixedA5       = buffer.readUInt8(9);

  if (fixed5a !== MAGIC_5A) {
    throw Object.assign(
      new Error(`invalid magic byte at offset 4: 0x${fixed5a.toString(16)}`),
      { code: 'BAD_MAGIC_5A' }
    );
  }
  if (fixedA5 !== MAGIC_A5) {
    throw Object.assign(
      new Error(`invalid magic byte at offset 9: 0x${fixedA5.toString(16)}`),
      { code: 'BAD_MAGIC_A5' }
    );
  }

  const dataBytes = buffer.length - HEADER_BYTES;
  if (dataBytes !== dataLen * 2) {
    throw Object.assign(
      new Error(`data length mismatch: header says ${dataLen} samples (${dataLen * 2} bytes), got ${dataBytes} bytes`),
      { code: 'LENGTH_MISMATCH' }
    );
  }

  const curve = new Array(dataLen);
  for (let i = 0; i < dataLen; i++) {
    const value = buffer.readUInt16LE(HEADER_BYTES + i * 2);
    if (value > ADC_MAX) {
      throw Object.assign(
        new Error(`invalid 13-bit ADC value at sample ${i}: 0x${value.toString(16)}`),
        { code: 'ADC_OUT_OF_RANGE' }
      );
    }
    curve[i] = value;
  }

  return {
    curve,
    referenceValues: { dataLen, laserCurr, dataBias, laserCurrBias },
  };
}

module.exports = { parseBinCurve };
