'use strict';

function printSection(title, value, render) {
  console.log(`\n${title}:`);
  if (value === undefined) { console.log('  (not fetched)'); return; }
  if (value && value.error) { console.log(`  error — ${value.error}`); return; }
  const lines = render(value);
  if (!lines || !lines.length) console.log('  (none)');
  else lines.forEach((l) => console.log(l));
}

function hm(minutes) {
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`;
}

function fmtTime(ms) {
  return new Date(ms).toISOString().slice(11, 16);
}

function printReport(data) {
  console.log('Aizo / Infinity Ring — Full Data Dump');
  console.log('-'.repeat(60));

  if (data.battery && !data.battery.error) {
    console.log(`Battery:        ${data.battery.battery}%  (working mode ${data.battery.workingMode})`);
  } else if (data.battery) {
    console.log(`Battery:        error — ${data.battery.error}`);
  }

  printSection('Steps (today)', data.steps, (s) => [
    `  Steps:     ${s.steps}`,
    `  Calories:  ${s.calories}`,
    `  Distance:  ${s.distance} km`,
  ]);

  printSection('HR auto-monitor interval', data.measureInterval, (m) =>
    [`  current=${m.currentMinutes}min default=${m.defaultMinutes}min allowed=[${m.allowedMinutes.join(',')}] (0=off)`]);

  printSection('Stress auto-monitor interval', data.stressInterval, (m) =>
    [`  current=${m.currentMinutes}min (${m.currentSeconds}s) default=${m.defaultMinutes}min`]);

  printSection('Health history (heart rate / SpO2 / HRV / stress / temp)', data.healthHistory, (arr) => {
    if (!arr.length) return ['  none stored (ring only logs when worn at each auto-monitor tick)'];
    const sorted = [...arr].sort((a, b) => a.timestamp - b.timestamp);
    const span = `${new Date(sorted[0].timestamp).toISOString().slice(5, 16).replace('T', ' ')} … ${new Date(sorted[sorted.length - 1].timestamp).toISOString().slice(5, 16).replace('T', ' ')}`;
    const series = (sel) => sorted.map(sel).filter((v) => v != null && v > 0);
    const range = (vals) => (vals.length ? `${Math.min(...vals)}–${Math.max(...vals)}` : '-');
    return [
      `  ${sorted.length} records (${span})`,
      `  heart rate:    ${range(series((x) => x.hr))} bpm`,
      `  blood oxygen:  ${range(series((x) => x.spo2))}%`,
      `  HRV:           ${range(series((x) => x.hrv))}`,
      `  stress:        ${range(series((x) => x.stress))}`,
      `  body temp:     ${range(series((x) => x.bodyTemp))}°C`,
    ];
  });

  printSection('Sleep summary (last night)', data.sleepSummary, (d) => {
    if (!d) return ['  no sleep recorded'];
    return [
      `  ${hm(d.totalMin)} total  ${fmtTime(d.start)} → ${fmtTime(d.end)}`,
      `  deep=${d.deepMin}m  light=${d.lightMin}m  REM=${d.remMin}m  awake=${d.awakeMin}m×${d.awakeTimes}`,
    ];
  });

  printSection('Sleep stage detail', data.sleepDetail, (arr) =>
    (arr.length ? [`  ${arr.length} stage transitions`] : ['  no stage data']));

  printSection('Sport / workout status', data.sportStatus, (s) =>
    [s.active ? `  active session: type=${s.sportType} id=${s.sportId}` : '  no active session']);

  printSection('Sport / workout records', data.sportRecords, (arr) => {
    if (!arr.length) return ['  no stored sessions'];
    return arr.map((r) => {
      if (r.kind === 'sportTotal' && r.data) {
        return `  session type=${r.data.sportType} duration=${r.data.duration}s calorie=${r.data.calorie} steps=${r.data.steps} avgHr=${r.data.avgHr}`;
      }
      if (r.kind === 'sportDetail') return `  [pattern-inferred] ${r.data.records.length} detail samples`;
      if (r.kind === 'sportRaw') return `  [unclassified opcode ${r.opcode}] ${r.data}`;
      return `  ${r.kind}`;
    });
  });

  console.log('\n' + '-'.repeat(60));
  console.log('(Health/sleep history is only populated while the ring is worn; use `measure` for live values.)\n');
}

module.exports = printReport;
