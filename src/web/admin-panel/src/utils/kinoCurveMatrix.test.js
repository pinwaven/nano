import { test, expect } from 'vitest';
import { buildAreaRatioMatrix, matrixToAoa } from './kinoCurveMatrix.js';

// A plateau-free two-peak curve; peak 1 larger than peak 2 so ratio > 1.
function twoPeakCurve() {
  return Array.from({ length: 1000 }, (_, i) => {
    if (i <= 150) return i;
    if (i <= 300) return 300 - i;
    if (i <= 600) return 0;
    if (i <= 690) return i - 600;
    if (i <= 780) return 780 - i;
    return 0;
  });
}

test('empty curves produce empty axes and matrix', () => {
  const result = buildAreaRatioMatrix([]);
  expect(result.serials).toEqual([]);
  expect(result.chipCodes).toEqual([]);
  expect(result.matrix).toEqual({});
});

test('groups by serial and chip and fills the peak-area ratio', () => {
  const curves = [
    { serial_number: 'S1', chip_code: 'C1', curve: twoPeakCurve(), created_at: '2026-06-01' },
  ];
  const result = buildAreaRatioMatrix(curves);
  expect(result.serials).toEqual(['S1']);
  expect(result.chipCodes).toEqual(['C1']);
  expect(result.matrix.S1.C1).toBeGreaterThan(1);
});

test('cell is null when fewer than two peaks are detected', () => {
  const singlePeak = Array.from({ length: 1000 }, (_, i) => {
    if (i <= 200) return i;
    if (i <= 400) return 400 - i;
    return 0;
  });
  const curves = [
    { serial_number: 'S9', chip_code: 'C9', curve: singlePeak, created_at: '2026-06-01' },
  ];
  const result = buildAreaRatioMatrix(curves);
  expect(result.matrix.S9.C9).toBeNull();
});

test('matrixToAoa builds a header row and empty string for null cells', () => {
  const model = {
    serials: ['S1', 'S2'],
    chipCodes: ['C1', 'C2'],
    matrix: {
      S1: { C1: 2, C2: null },
      S2: { C1: null, C2: 3.5 },
    },
  };
  const aoa = matrixToAoa(model);
  expect(aoa[0]).toEqual(['serial_number \\ chip_code', 'C1', 'C2']);
  expect(aoa[1]).toEqual(['S1', 2, '']);
  expect(aoa[2]).toEqual(['S2', '', 3.5]);
});
