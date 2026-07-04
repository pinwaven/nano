'use strict';

function printReport(data) {
  console.log('X3 Smart Ring — Full Data Dump');
  console.log('-'.repeat(60));

  if (data.battery && !data.battery.error) {
    console.log(`Battery:        ${data.battery.level}%${data.battery.charging ? ' (charging)' : ''}`);
  } else if (data.battery) {
    console.log(`Battery:        error — ${data.battery.error}`);
  }
  if (data.deviceTime) console.log(`Ring clock:     ${data.deviceTime.error ? `error — ${data.deviceTime.error}` : data.deviceTime}`);
  if (data.mac) console.log(`MAC address:    ${data.mac.error ? `error — ${data.mac.error}` : data.mac}`);
  if (data.firmwareVersion) console.log(`Firmware:       ${data.firmwareVersion.error ? `error — ${data.firmwareVersion.error}` : data.firmwareVersion}`);

  printSection('Auto-monitoring schedule', data.autoMonitoring, (m) => {
    if (m.error) return [`  ${m.error}`];
    const workModes = { 0: 'off', 1: 'continuous', 2: 'scheduled' };
    const labels = { heartRate: 'Heart Rate', spo2: 'SpO2', temperature: 'Temperature', hrv: 'HRV' };
    return Object.keys(labels).map((key) => {
      const s = m[key];
      if (!s) return `  ${labels[key]}: (not fetched)`;
      const mode = workModes[s.workMode] || `unknown(${s.workMode})`;
      return `  ${labels[key].padEnd(11)} mode=${mode.padEnd(10)} window=${s.startTime}-${s.endTime}  weekdays=0x${s.weekdays.toString(16)}  interval=${s.intervalMinutes}min`;
    });
  });

  printSection('Steps (today)', data.steps, (s) => {
    if (s.error) return [`  ${s.error}`];
    return [
      `  Steps:     ${s.steps}`,
      `  Calories:  ${s.calories}`,
      `  Distance:  ${s.distance} m`,
      `  Slots:     ${s.slots?.length || 0}`,
    ];
  });

  printSection('Sleep history', data.sleepHistory, (arr) => {
    if (arr.error) return [`  ${arr.error}`];
    if (!arr.length) return ['  No sleep sessions cached'];
    return arr.map((n) =>
      `  ${n.date}  onset=${n.onset}  total=${n.totalMinutes}m  deep=${n.deep}m  light=${n.light}m  rem=${n.rem}m  awake=${n.awake}m`);
  });

  printSection('Heart rate log (today, 0x55)', data.heartRateLog, (arr) =>
    listOrEmpty(arr, (r) => `  ${r.timestamp.toISOString()}  ${r.value} bpm`));

  printSection('Heart rate history (0x54)', data.heartRateHistory, (arr) =>
    listOrEmpty(arr, (r) => `  ${r.date}  [${r.hrSamples.join(', ')}]`));

  printSection('HRV history (0x56)', data.hrvHistory, (arr) =>
    listOrEmpty(arr, (r) =>
      `  ${r.timestamp}  hrv=${r.hrv ?? '-'}  breath=${r.breath ?? '-'}  hr=${r.heartRate ?? '-'}  stress=${r.stress ?? '-'}  bp=${r.highBP ?? '-'}/${r.lowBP ?? '-'}`));

  printSection('Auto SpO2 history (0x66)', data.autoSpo2History, (arr) =>
    listOrEmpty(arr, (r) => `  ${r.timestamp}  ${r.spo2}%`));

  printSection('SpO2 detail (0x57, today)', data.spo2History, (arr) =>
    listOrEmpty(arr, (r) => `  ${r.date}  [${r.samples.join(', ')}]`));

  printSection('Sleep HRV/RMSSD (0x60, today)', data.sleepHrv, (arr) =>
    listOrEmpty(arr, (r) => `  ${r.date}  [${r.rmssd.join(', ')}]`));

  printSection('Temperature history (0x62)', data.temperatureHistory, (arr) =>
    listOrEmpty(arr, (r) =>
      `  ${r.date}  skin=${r.skinTemp}°C  ambient=${r.ambientTemp}°C  shell=${r.shellTemp}°C  est=${r.estimatedBodyTemp}°C  status=${r.status}`));

  printSection('Sleep temperature log (0x69, today)', data.sleepTemperatureLog, (arr) =>
    listOrEmpty(arr, (r) => `  ${r.date}  ${r.samples.length} samples`));

  printSection('Exercise sessions (0x5C, today)', data.exerciseSessions, (arr) =>
    listOrEmpty(arr, (r) =>
      `  ${r.date}  mode=${r.sportMode}  avgHR=${r.avgHeartRate}  dur=${r.durationSec}s  steps=${r.steps}  cal=${r.calories}  dist=${r.distanceKm}km`));

  printSection('Sleep apnea risk (0x5F, today)', data.sleepApneaRisk, (arr) =>
    listOrEmpty(arr, (r) => `  ${r.date}  riskLevel=${r.riskLevel}`));

  printSection('Oxygen variation (0x5D, today)', data.oxygenVariation, (arr) =>
    listOrEmpty(arr, (r) => `  ${r.date}  riskCount=${r.riskCount}  variations=[${r.variationList.join(', ')}]`));
}

function listOrEmpty(arr, fmt) {
  if (arr.error) return [`  ${arr.error}`];
  if (!arr.length) return ['  (none)'];
  return arr.map(fmt);
}

function printSection(title, value, fmt) {
  console.log(`\n${title}`);
  if (value == null) {
    console.log('  (not fetched)');
    return;
  }
  for (const line of fmt(value)) console.log(line);
}

module.exports = printReport;
