const YEAR_A_BASE = 2021;
const YEAR_Z_MAX = 2046;

function normalizeMachineBatchInput(body = {}) {
  const model = String(body.model || '').trim().toUpperCase();
  const quantity = Number(body.quantity);

  if (!model) {
    throw new Error('model is required');
  }
  if (!/^[A-Z0-9]+$/.test(model)) {
    throw new Error('model must contain only letters and numbers');
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 899) {
    throw new Error('quantity must be between 1 and 899');
  }

  return { model, quantity };
}

function getYearLetter(year) {
  if (!Number.isInteger(year) || year < YEAR_A_BASE || year > YEAR_Z_MAX) {
    throw new Error(`year must be between ${YEAR_A_BASE} and ${YEAR_Z_MAX}`);
  }
  return String.fromCharCode('A'.charCodeAt(0) + (year - YEAR_A_BASE));
}

function getShanghaiMachinePeriod(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);

  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const monthCode = parts.find((p) => p.type === 'month')?.value;
  const month = Number(monthCode);

  return {
    year,
    yearLetter: getYearLetter(year),
    month,
    monthCode,
  };
}

function generateMachineNumbers({
  model,
  year,
  yearLetter,
  month,
  monthCode,
  startSequence,
  quantity,
}) {
  const normalizedModel = String(model || '').trim().toUpperCase();
  if (!/^[A-Z0-9]+$/.test(normalizedModel)) {
    throw new Error('model must contain only letters and numbers');
  }
  if (!Number.isInteger(startSequence) || startSequence < 101) {
    throw new Error('startSequence must be at least 101');
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 899) {
    throw new Error('quantity must be between 1 and 899');
  }

  return Array.from({ length: quantity }, (_, index) => {
    const sequence = startSequence + index;
    const sequenceCode = String(sequence).padStart(3, '0');
    const machineNo = `${normalizedModel}-${yearLetter}${monthCode}${sequenceCode}`;

    return {
      machine_no: machineNo,
      machine_name: machineNo,
      model: normalizedModel,
      year,
      year_letter: yearLetter,
      month,
      sequence_no: sequence,
      status: 'inactive',
    };
  });
}

module.exports = {
  getShanghaiMachinePeriod,
  getYearLetter,
  generateMachineNumbers,
  normalizeMachineBatchInput,
};
