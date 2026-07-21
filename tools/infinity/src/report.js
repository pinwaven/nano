'use strict';

function printReport(data) {
  section('Device');
  line('Battery', data.battery && data.battery.error ? data.battery.error : formatBattery(data.battery));
  line('Watch Info', data.watchInfo && data.watchInfo.error ? data.watchInfo.error : payload(data.watchInfo));

  section('Activity');
  if (data.steps && !data.steps.error) {
    line('Steps', `${data.steps.steps} steps, ${data.steps.distanceMeters} m, ${data.steps.calories} cal`);
    line('Step Time', data.steps.timestamp);
  } else {
    line('Steps', data.steps ? data.steps.error : 'not fetched');
  }

  section('Vitals');
  line('Stress', formatStress(data.stress));
  line('Heart Rate', formatRecords(data.heartRate, 'heartRate', 'bpm'));
  line('SpO2', formatRecords(data.spo2, 'spo2', '%'));

  section('Sleep');
  if (data.sleep && !data.sleep.error) {
    const s = data.sleep.summary || {};
    line('Total', `${s.totalMinutes || 0} min`);
    line('Stages', `deep=${s.deep || 0} light=${s.light || 0} rem=${s.rem || 0} awake=${s.awake || 0}`);
    line('Details', `${(data.sleep.details || []).length} record(s)`);
  } else {
    line('Sleep', data.sleep ? data.sleep.error : 'not fetched');
  }
}

function section(title) {
  console.log(`\n${title}`);
  console.log('-'.repeat(title.length));
}

function line(label, value) {
  console.log(`${label.padEnd(12)} ${value == null || value === '' ? '-' : value}`);
}

function formatBattery(battery) {
  if (!battery) return 'not fetched';
  return `${battery.level}%${battery.workingMode == null ? '' : `, mode=${battery.workingMode}`}`;
}

function payload(value) {
  if (!value) return 'not fetched';
  return value.payloadHex || JSON.stringify(value);
}

function formatStress(stress) {
  if (!stress) return 'not fetched';
  if (stress.error) return stress.error;
  if (stress.type === 'realtime') return `${stress.value} at ${stress.timestamp}`;
  if (stress.type === 'history') return `${stress.records.length} record(s)`;
  return JSON.stringify(stress);
}

function formatRecords(result, key, unit) {
  if (!result) return 'not fetched';
  if (result.error) return result.error;
  const records = result.records || [];
  if (!records.length) return `0 parsed record(s), raw=${result.rawHex || '-'}`;
  const last = records[records.length - 1];
  return `${records.length} record(s), last=${last[key]}${unit} at ${last.timestamp}`;
}

module.exports = printReport;
