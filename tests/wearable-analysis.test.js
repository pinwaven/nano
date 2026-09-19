// lib/wearableAnalysis.js — the analysis layer over synced ring data: personal baseline and
// band, z-scores against the user's own history, readiness, sleep debt/regularity, stress
// balance (HRV must agree, never the stress byte alone), the three anomaly flags, provisional
// gating, the prompt block (no thresholds leak), and the dates it lets a reply cite.
const test = require('node:test');
const assert = require('node:assert');
const {
    analyzeWearable, describeWearableInsights, insightDates,
    BASELINE_READY_DAYS, SLEEP_TARGET_HOURS, READINESS,
} = require('../src/functions/worker/lib/wearableAnalysis');

const TODAY = '2026-09-18';
const dateBack = (n) => { const d = new Date(Date.UTC(2026, 8, 18) - n * 86400000); return d.toISOString().slice(0, 10); };

// A steady 30-day history: HRV alternating 55/65 (mean ≈60, sd ≈5), resting HR 56/60, skin temp
// 33.0, 7.5h sleep with 40% deep+REM, bedtime 23:00. Returned newest first like fetchWearableDaily.
function steadyDays(n = 30, overrides = {}) {
    const rows = [];
    for (let i = n - 1; i >= 0; i--) {
        const date = dateBack(i);
        rows.push({
            date,
            hrv_ms: i % 2 ? 55 : 65, resting_hr: i % 2 ? 56 : 60, skin_temp_c: 33.0, stress: 40, spo2: 97,
            sleep_hours: 7.5, deep_minutes: 90, rem_minutes: 90, light_minutes: 250, awake_minutes: 20,
            sleep_onset: '23:00', wake_time: '06:30', steps: 6000,
            ...(overrides[date] || {}),
        });
    }
    return rows.reverse();
}
function readingsFor(rows, { nightHrv = 70, dayHrv = 55, stress = 40 } = {}) {
    const out = [];
    for (const r of rows) {
        for (const hour of [1, 3, 5, 10, 13, 16, 19]) {
            out.push({ date: r.date, hour, hrv_ms: hour <= 6 ? nightHrv : dayHrv, stress: typeof stress === 'function' ? stress(r.date, hour) : stress, heart_rate: 62 });
        }
    }
    return out;
}

test('a steady month yields a baseline with a band, an in-band today and a "ready" score', () => {
    const daily = steadyDays(30, { [TODAY]: { resting_hr: 58 } });
    const ins = analyzeWearable({ daily, readings: readingsFor(daily), today: TODAY });
    assert.equal(ins.data_quality.days_with_hrv, 30);
    assert.equal(ins.data_quality.baseline_ready, true);
    assert.equal(ins.data_quality.provisional, false);
    assert.ok(Math.abs(ins.baseline.hrv_30d - 60) <= 0.3, String(ins.baseline.hrv_30d));
    assert.equal(ins.baseline.history_days, 29);
    assert.equal(ins.baseline.band_low, 55);
    assert.equal(ins.baseline.band_high, 65);
    assert.equal(ins.baseline.rhr_30d, 58);
    assert.equal(ins.today.date, TODAY);
    assert.equal(ins.today.is_today, true);
    assert.equal(ins.today.hrv_band_position, 'in');
    assert.equal(ins.readiness.level, 'ready');
    assert.ok(ins.readiness.drivers.includes('hrv_in_band'));
    assert.deepEqual(ins.anomaly.flags, []);
});

test('z-scores are against the user\'s own history, excluding the day being judged', () => {
    const daily = steadyDays(30, { [TODAY]: { hrv_ms: 45 } });
    const ins = analyzeWearable({ daily, readings: [], today: TODAY });
    assert.ok(Math.abs(ins.baseline.hrv_30d - 60) <= 0.3);
    assert.ok(ins.today.hrv_z < -2.5 && ins.today.hrv_z > -3.2, `z=${ins.today.hrv_z}`);
    assert.equal(ins.today.hrv_vs_baseline_pct, -25);
    assert.equal(ins.today.hrv_band_position, 'below');
    assert.equal(ins.readiness.drivers[0], 'hrv_below_band');
});

test('readiness follows the documented formula and the level bands', () => {
    const low = analyzeWearable({ daily: steadyDays(30, { [TODAY]: { hrv_ms: 40, resting_hr: 70, sleep_hours: 4 } }), readings: [], today: TODAY });
    assert.equal(low.readiness.level, 'low');
    assert.ok(low.readiness.score < READINESS.moderate);
    assert.deepEqual(low.readiness.drivers, ['hrv_below_band', 'rhr_elevated', 'short_sleep']);
    const c = low.readiness.components;
    const expected = Math.max(0, Math.min(100, READINESS.base + READINESS.hrv * c.hrv_z - READINESS.rhr * c.rhr_z + READINESS.sleep * c.sleep_z));
    assert.ok(Math.abs(low.readiness.score - expected) <= 1, `${low.readiness.score} vs ${expected}`);
    const noSleep = analyzeWearable({ daily: steadyDays(30).map(r => ({ ...r, sleep_hours: null, deep_minutes: null, rem_minutes: null, sleep_onset: null })), readings: [], today: TODAY });
    assert.equal(noSleep.readiness.components.sleep_z, null);
    assert.ok(noSleep.readiness.drivers.includes('no_sleep_data'));
    assert.equal(noSleep.sleep, null);
});

test('hrv_drop fires on a one-day fall of a full SD below the past week; low_streak needs three days under the band', () => {
    const drop = analyzeWearable({ daily: steadyDays(30, { [TODAY]: { hrv_ms: 50 } }), readings: [], today: TODAY });
    assert.deepEqual(drop.anomaly.flags.map(f => f.code), ['hrv_drop']);
    assert.equal(drop.anomaly.flags[0].since, TODAY);

    const streak = analyzeWearable({
        daily: steadyDays(30, { [TODAY]: { hrv_ms: 50 }, [dateBack(1)]: { hrv_ms: 50 }, [dateBack(2)]: { hrv_ms: 50 } }),
        readings: [], today: TODAY,
    });
    const codes = streak.anomaly.flags.map(f => f.code);
    assert.ok(codes.includes('low_streak'), codes.join());
    assert.equal(streak.anomaly.flags.find(f => f.code === 'low_streak').since, dateBack(2));
    assert.equal(streak.anomaly.flags.find(f => f.code === 'low_streak').evidence.days, 3);

    const two = analyzeWearable({ daily: steadyDays(30, { [TODAY]: { hrv_ms: 50 }, [dateBack(1)]: { hrv_ms: 50 } }), readings: [], today: TODAY });
    assert.ok(!two.anomaly.flags.some(f => f.code === 'low_streak'));
});

test('strain_watch needs all three signals at once — HRV down, resting HR up, skin temp up', () => {
    const all3 = analyzeWearable({ daily: steadyDays(30, { [TODAY]: { hrv_ms: 45, resting_hr: 70, skin_temp_c: 33.6 } }), readings: [], today: TODAY });
    assert.ok(all3.anomaly.flags.some(f => f.code === 'strain_watch'));
    assert.equal(all3.today.skin_temp_delta_c, 0.6);
    for (const partial of [
        { hrv_ms: 45, resting_hr: 70 },                      // no temp rise
        { hrv_ms: 45, resting_hr: 58, skin_temp_c: 33.6 },   // RHR at baseline
        { resting_hr: 70, skin_temp_c: 33.6 },               // HRV normal
    ]) {
        const ins = analyzeWearable({ daily: steadyDays(30, { [TODAY]: partial }), readings: [], today: TODAY });
        assert.ok(!ins.anomaly.flags.some(f => f.code === 'strain_watch'), JSON.stringify(partial));
    }
});

test('under 14 days everything is provisional; under 7 days no flags; under 3 days no baseline at all', () => {
    const ten = analyzeWearable({ daily: steadyDays(10, { [TODAY]: { hrv_ms: 40, resting_hr: 70, skin_temp_c: 33.6 } }), readings: [], today: TODAY });
    assert.equal(ten.data_quality.provisional, true);
    assert.equal(ten.data_quality.days_until_baseline, BASELINE_READY_DAYS - 10);
    assert.ok(ten.readiness, 'readiness still computed');
    assert.ok(ten.anomaly.flags.length >= 1, 'flags allowed from 7 days');

    const five = analyzeWearable({ daily: steadyDays(5, { [TODAY]: { hrv_ms: 40, resting_hr: 70, skin_temp_c: 33.6 } }), readings: [], today: TODAY });
    assert.ok(five.readiness);
    assert.deepEqual(five.anomaly.flags, []);

    const two = analyzeWearable({ daily: steadyDays(2), readings: [], today: TODAY });
    assert.equal(two.baseline, null);
    assert.equal(two.readiness, null);
    assert.equal(two.today, null);
    assert.ok(two.sleep, 'sleep is independent of HRV coverage');
    assert.equal(two.data_quality.days_with_hrv, 2);

    assert.equal(analyzeWearable({ daily: [], readings: [], today: TODAY }).baseline, null);
    assert.equal(analyzeWearable({}).readiness, null);
});

test('when today has no HRV the reference day is the latest one that does, and says so', () => {
    const daily = steadyDays(30, { [TODAY]: { hrv_ms: null } });
    const ins = analyzeWearable({ daily, readings: [], today: TODAY });
    assert.equal(ins.today.date, dateBack(1));
    assert.equal(ins.today.is_today, false);
    assert.equal(ins.data_quality.days_with_hrv, 29);
});

test('sleep: last night vs the week, debt against the target, and bedtime regularity', () => {
    const late = { sleep_onset: '01:30' }, early = { sleep_onset: '21:00' };
    const daily = steadyDays(30, { [TODAY]: { sleep_hours: 5.5, deep_minutes: 40, rem_minutes: 40 }, [dateBack(1)]: late, [dateBack(2)]: early, [dateBack(3)]: late, [dateBack(4)]: early, [dateBack(5)]: late, [dateBack(6)]: early });
    const s = analyzeWearable({ daily, readings: [], today: TODAY }).sleep;
    assert.equal(s.last_night.date, TODAY);
    assert.equal(s.last_night.hours, 5.5);
    assert.equal(s.last_night.vs_7d_hours, -2);
    assert.equal(s.last_night.restorative_pct, 24);
    assert.equal(s.debt_7d_hours, 2);
    assert.equal(s.target_hours, SLEEP_TARGET_HOURS);
    assert.equal(s.nights_7d, 7);
    assert.equal(s.regular, false);
    assert.ok(s.onset_sd_min > 45);
    const regular = analyzeWearable({ daily: steadyDays(30), readings: [], today: TODAY }).sleep;
    assert.equal(regular.regular, true);
    assert.equal(regular.onset_sd_min, 0);
    assert.equal(regular.debt_7d_hours, 0);
});

test('stress balance needs HRV to agree — a rising stress byte on its own stays "balanced"', () => {
    const base = steadyDays(30);
    const stressOnly = base.map(r => ({ ...r, stress: r.date >= dateBack(6) ? 60 : 40 }));
    assert.equal(analyzeWearable({ daily: stressOnly, readings: readingsFor(stressOnly), today: TODAY }).stress.balance, 'balanced');
    const both = base.map(r => (r.date >= dateBack(6) ? { ...r, stress: 60, hrv_ms: r.hrv_ms - 8 } : r));
    assert.equal(analyzeWearable({ daily: both, readings: readingsFor(both), today: TODAY }).stress.balance, 'accumulating');
    const rec = base.map(r => (r.date >= dateBack(6) ? { ...r, stress: 25, hrv_ms: r.hrv_ms + 8 } : r));
    assert.equal(analyzeWearable({ daily: rec, readings: readingsFor(rec), today: TODAY }).stress.balance, 'recovering');
});

test('per-reading rows give stress load against the user\'s own p75, the night/day HRV ratio and the peak hour', () => {
    const daily = steadyDays(30);
    // a ring that idles at 55 all day: a fixed cut of 60 would call this 0% stressed forever;
    // against the user's own distribution, today's afternoon (75) is clearly the top quarter
    const readings = readingsFor(daily, { nightHrv: 72, dayHrv: 60, stress: (d, h) => (d === TODAY && h >= 10 ? 75 : 55) });
    const st = analyzeWearable({ daily, readings, today: TODAY }).stress;
    assert.equal(st.high_cut_personal, true);
    assert.equal(st.high_cut, 55);
    assert.equal(st.load_today, 57);
    // with too few readings the fixed fallback applies
    const few = analyzeWearable({ daily, readings: readings.filter(r => r.date === TODAY), today: TODAY }).stress;
    assert.equal(few.high_cut_personal, false);
    assert.equal(few.high_cut, 60);
    assert.equal(st.load_today_date, TODAY);
    assert.equal(st.night_day_hrv_ratio, 1.2);
    assert.ok([1, 3, 5].includes(st.peak_hrv_hour));
    const none = analyzeWearable({ daily, readings: [], today: TODAY }).stress;
    assert.equal(none.load_today, null);
    assert.equal(none.night_day_hrv_ratio, null);
    assert.equal(none.peak_hrv_hour, null);
});

test('the prompt block names dates and relative facts but leaks no threshold, and is empty with nothing to say', () => {
    const daily = steadyDays(20, { [TODAY]: { hrv_ms: 45, resting_hr: 70, skin_temp_c: 33.6, sleep_hours: 5 } });
    const ins = analyzeWearable({ daily, readings: readingsFor(daily), today: TODAY });
    const zh = describeWearableInsights(ins, true);
    assert.match(zh, /恢复状态（2026-09-18）：偏低/);
    assert.match(zh, /比30天基线低 25%/);
    assert.match(zh, /个人正常区间 55–65ms/);
    assert.match(zh, /身体负荷偏高/);
    assert.match(zh, /不是诊断/);
    assert.doesNotMatch(zh, /SD|z[-_ ]?score|≥\s*60|阈值|标准差/i);
    const en = describeWearableInsights(ins, false);
    assert.match(en, /Recovery \(2026-09-18\): low/);
    assert.match(en, /not a diagnosis/);
    assert.doesNotMatch(en, /\bSD\b|z[-_ ]?score|>=\s*60|threshold/i);
    const short = analyzeWearable({ daily: steadyDays(8), readings: [], today: TODAY });
    assert.match(describeWearableInsights(short, true), /基线仅基于 8 天数据/);
    assert.doesNotMatch(describeWearableInsights(ins, true), /基线仅基于/);
    assert.equal(describeWearableInsights(null, true), '');
    assert.equal(describeWearableInsights(analyzeWearable({ daily: [], readings: [] }), true), '');
});

test('insightDates lists every date the block can cite, once each', () => {
    const daily = steadyDays(30, { [TODAY]: { hrv_ms: 50 } });
    const ins = analyzeWearable({ daily, readings: readingsFor(daily), today: TODAY });
    assert.deepEqual(insightDates(ins), [TODAY]);
    const streak = analyzeWearable({ daily: steadyDays(30, { [TODAY]: { hrv_ms: 50 }, [dateBack(1)]: { hrv_ms: 50 }, [dateBack(2)]: { hrv_ms: 50 } }), readings: [], today: TODAY });
    assert.deepEqual(insightDates(streak).sort(), [dateBack(2), TODAY].sort());
    assert.deepEqual(insightDates(null), []);
});

test('nothing in the lib reads data.actual or touches the DB', () => {
    const src = require('node:fs').readFileSync(require.resolve('../src/functions/worker/lib/wearableAnalysis.js'), 'utf8');
    assert.doesNotMatch(src, /\.actual\b|data\.actual/);
    assert.doesNotMatch(src, /pool\.query|require\('\.\/db'\)/);
});
