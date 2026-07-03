import { findSlopeRegions } from './kinoCurveAnalysis.js';

// Peak-area ratio (region 1 area / region 2 area) for a curve, or null if fewer
// than two peaks were detected.
function peakAreaRatio(curve) {
  const regions = findSlopeRegions(curve);
  if (regions.length < 2) return null;
  const [first, second] = regions;
  if (!second.area) return null;
  return first.area / second.area;
}

// Build the export matrix: rows = serial_number, cols = chip_code, cell = peak-area
// ratio of the latest curve for that (serial, chip). Cells with < 2 peaks are null.
export function buildAreaRatioMatrix(curves) {
  const serials = [];
  const chipCodes = [];
  const matrix = {};

  for (const row of curves) {
    const serial = row.serial_number;
    const chip = row.chip_code;
    if (!serials.includes(serial)) serials.push(serial);
    if (!chipCodes.includes(chip)) chipCodes.push(chip);
    if (!matrix[serial]) matrix[serial] = {};
    // curves arrive newest-first; keep the first (latest) seen per cell.
    if (matrix[serial][chip] === undefined) {
      matrix[serial][chip] = peakAreaRatio(row.curve);
    }
  }

  serials.sort();
  chipCodes.sort();
  return { serials, chipCodes, matrix };
}

// Convert the ratio matrix into an array-of-arrays for xlsx export. Header row is
// the chip codes; each data row is a serial number followed by its ratios. Null
// cells (fewer than two peaks) become empty strings.
export function matrixToAoa({ serials, chipCodes, matrix }) {
  const header = ['serial_number \\ chip_code', ...chipCodes];
  const rows = serials.map((serial) => {
    const cells = chipCodes.map((chip) => {
      const value = matrix[serial] ? matrix[serial][chip] : null;
      return value === null || value === undefined ? '' : value;
    });
    return [serial, ...cells];
  });
  return [header, ...rows];
}
