// Per-day wearable readings (lib/wearableDaily.js): the shape, the deterministic summary, the
// prompt block, the trigger, and the grounding plumbing that lets a cited day survive.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { summarizeWearableDaily, describeWearableDaily, messageAsksAboutWearable, clampDays } = require('../src/functions/worker/lib/wearableDaily');
const { extractToolGroundTruth, buildForcedToolQueue, contextDates } = require('../src/functions/worker/lib/agenticChat');
const { AGENTIC_TOOL_DEFS } = require('../src/functions/worker/lib/agenticTools');

const WORKER = path.join(__dirname, '..', 'src', 'functions', 'worker');
const ROWS = [
  { date: '2026-09-15', sleep_hours: null, deep_minutes: null, rem_minutes: null, light_minutes: null, awake_minutes: null, sleep_onset: null, wake_time: null, steps: 726, hrv_ms: 88, resting_hr: 80, spo2: 96.7, stress: 33, breath_rate: 14, hr_min: 80, hr_max: 102 },
  { date: '2026-09-14', sleep_hours: 5.4, deep_minutes: 75, rem_minutes: 78, light_minutes: 152, awake_minutes: 2, sleep_onset: '23:39', wake_time: '05:03', steps: null, hrv_ms: 48, resting_hr: null, spo2: 96.8, stress: 43, breath_rate: 15.7, hr_min: null, hr_max: null },
  { date: '2026-09-13', sleep_hours: 9, deep_minutes: 82, rem_minutes: 84, light_minutes: 307, awake_minutes: 5, sleep_onset: '20:54', wake_time: '05:51', steps: 1681, hrv_ms: 86.5, resting_hr: 76, spo2: 96.6, stress: 33, breath_rate: 14, hr_min: 76, hr_max: 97 },
];

test('the summary picks the latest night with sleep, compares it to the other nights, and marks today partial', () => {
  const s = summarizeWearableDaily(ROWS, '2026-09-15');
  assert.equal(s.last_night.date, '2026-09-14');
  assert.equal(s.last_night.sleep_hours, 5.4);
  assert.equal(s.last_night.vs_other_nights_hours, -3.6); // vs the only other night, 9h
  assert.equal(s.last_night.restorative_pct, 47);
  assert.equal(s.today.steps_so_far, 726);
  assert.equal(s.today.partial_day, true);
  assert.equal(s.latest_hrv.date, '2026-09-15');
  assert.equal(summarizeWearableDaily([], '2026-09-15'), null);
});

test('the block names every day, says "—" for a missing reading, and carries the usage rules', () => {
  const zh = describeWearableDaily(ROWS, true, '2026-09-15');
  assert.match(zh, /2026-09-14：睡眠 5\.4h（深睡 75min · REM 78min/);
  assert.match(zh, /2026-09-15：睡眠 — \| 步数 726（截至同步）/);
  assert.match(zh, /最近一晚（2026-09-14）：睡眠 5\.4h，比其余几晚均值少 3\.6h/);
  assert.match(zh, /7天均值不能当作某一天的数值/);
  const en = describeWearableDaily(ROWS, false, '2026-09-15');
  assert.match(en, /Last night \(2026-09-14\): 5\.4h/);
  assert.equal(describeWearableDaily([], true, '2026-09-15'), '');
});

test('the trigger matches wearable questions and not the formulation trigger message', () => {
  for (const m of ['我昨晚睡得怎么样？', '我今天走了多少步？', '我的HRV最近怎么样', '我的静息心率是不是偏高', '从手环数据看我最近压力大吗', '我的血氧正常吗', 'how did I sleep last night', 'is my resting heart rate high']) {
    assert.ok(messageAsksAboutWearable(m), `should trigger: ${m}`);
  }
  for (const m of ['请根据我的完整健康数据，为我配置一个 28 天周期的 Dots 方案。', 'Please formulate a 28-day Dots plan based on my complete health data.', '我要定制营养素', '我能喝牛奶吗', '你好']) {
    assert.ok(!messageAsksAboutWearable(m), `should NOT trigger: ${m}`);
  }
});

test('the tool is declared, force-queued for a wearable question, and its dates are harvested', () => {
  const names = new Set(AGENTIC_TOOL_DEFS.map(t => t.function.name));
  assert.ok(names.has('get_wearable_daily'));
  assert.deepEqual(buildForcedToolQueue({ tools_needed: [] }, '我昨晚睡得怎么样？', names, 2), ['get_wearable_daily']);
  const { dates } = extractToolGroundTruth([{ tool: 'get_wearable_daily', args: {}, result: { ok: true, data: ROWS } }]);
  assert.deepEqual(dates.sort(), ['2026-09-13', '2026-09-14', '2026-09-15']);
  // and the same dates are citable when they came from the pre-fetched context block
  assert.deepEqual(contextDates({ wearable_daily: ROWS }).sort(), ['2026-09-13', '2026-09-14', '2026-09-15']);
  assert.deepEqual(contextDates({}), []);
});

test('clampDays bounds the window', () => {
  assert.equal(clampDays(undefined), 7);
  assert.equal(clampDays(0), 1);
  assert.equal(clampDays(400), 30);
  assert.equal(clampDays('14'), 14);
});

test('every chat template of both personas renders the per-day block', () => {
  for (const p of ['viva/chat/biomarker.js', 'viva/chat/nutrition.js', 'viva/chat/emotional.js', 'viva/chat/casual.js', 'nano/chat/biomarker.js', 'nano/chat/nutrition.js', 'nano/chat/emotional.js', 'nano/chat/casual.js']) {
    const src = fs.readFileSync(path.join(WORKER, 'prompts', p), 'utf8');
    assert.match(src, /getWearableDailyBlock\(/, `${p} does not render the block`);
  }
});

// fetchHrvReadings: the per-reading rows lib/wearableAnalysis.js needs. The measurement time is
// the 14-digit tail of sync.js's external_id, recorded_at only a fallback, and a row with
// neither is dropped rather than guessed onto a date.
test('fetchHrvReadings takes the measurement time from the external_id tail, falls back to recorded_at, drops the rest, sorts oldest first', async () => {
  const { fetchHrvReadings } = require('../src/functions/worker/lib/wearableDaily');
  let seen = null;
  const pool = { query: async (sql, params) => {
    seen = { sql, params };
    return { rows: [
      { external_id: 'smart_ring_hrv_20260918073005', recorded_ts: null, hrv_ms: '62', stress: '41', heart_rate: '58' },
      { external_id: 'smart_ring_hrv_20260917221500', recorded_ts: '20260917221500', hrv_ms: 70, stress: null, heart_rate: null },
      { external_id: 'smart_ring_hrv_legacy', recorded_ts: '20260916010203', hrv_ms: 55, stress: 30, heart_rate: 60 },
      { external_id: 'smart_ring_hrv_nodate', recorded_ts: null, hrv_ms: 99, stress: 99, heart_rate: 99 },
    ] };
  } };
  const rows = await fetchHrvReadings(pool, 'u1', 30);
  assert.deepEqual(rows, [
    { date: '2026-09-16', hour: 1, hrv_ms: 55, stress: 30, heart_rate: 60 },
    { date: '2026-09-17', hour: 22, hrv_ms: 70, stress: null, heart_rate: null },
    { date: '2026-09-18', hour: 7, hrv_ms: 62, stress: 41, heart_rate: 58 },
  ]);
  assert.match(seen.sql, /category = 'vitals'/);
  assert.match(seen.sql, /LIKE '%\\_hrv\\_%'/);  // the LIKE escapes both underscores
  assert.match(seen.sql, /Asia\/Shanghai/);
  assert.deepEqual(seen.params, ['u1', 30]);
  assert.equal((await fetchHrvReadings(pool, 'u1', 999)).length, 3); // days clamp, no throw
});
