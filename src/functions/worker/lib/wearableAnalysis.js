'use strict';

/**
 * Wearable insights — the analysis layer over synced ring data (twin layer 2, 日常监测).
 *
 * Pure and DB-free: `analyzeWearable()` takes the per-day rows lib/wearableDaily.js already
 * produces (`fetchWearableDaily`, ≤30 days) plus per-reading HRV rows (`fetchHrvReadings`) and
 * a Shanghai `today` string, and returns codes and numbers only. Copy lives in the miniapp's
 * `T` blocks and in `describeWearableInsights()` below — never inside the insight object, so
 * the same object serves the health tab, the coach view, the chat block, the daily check-in
 * and the AG twin bundle without any of them re-deriving a threshold.
 *
 * Why everything is relative to the user's own history: Halo/V8 expose a vendor HRV *index*
 * per reading (a scalar, no RR intervals — docs/architecture/halo-smart-ring.md §4.5), not
 * a calibrated RMSSD. An absolute cut like "80ms = good" is meaningless for it; "12% below
 * your own 30-day mean" is not. Nothing here reads a raw unvalidated value or formats a date.
 *
 * The anomaly flags are a rest nudge, never a diagnosis: `strain_watch` needs all three
 * signals (HRV down, resting HR up, skin temperature up) at once, and the wording that
 * reaches a user says 负荷 / strain, not illness.
 */

// ---- tunables (kept together; tests pin the behaviour, not the values) ----
const MIN_DAYS_FOR_ANALYSIS = 3;     // below this: no baseline, no readiness, no flags
const MIN_DAYS_FOR_FLAGS = 7;        // a band from fewer days is noise
const BASELINE_READY_DAYS = 14;      // provisional until here
const SLEEP_TARGET_HOURS = 7.5;
// A day exactly at the user's own baseline scores READINESS.base — "your normal is ready";
// every point of z moves it. −2 SD on HRV alone lands in 'low'.
const READINESS = { base: 70, hrv: 15, rhr: 8, sleep: 7, ready: 70, moderate: 45 };
const STRESS_HIGH_READING = 60;      // fallback cut for a "stressed" reading, only under MIN_READINGS_FOR_P75
const STRESS_HIGH_PCTL = 0.75;       // otherwise: above the user's OWN 30-day p75 (a ring idling at 55 all day
                                     // would never cross 60; "your top quarter" moves with the person)
const MIN_READINGS_FOR_P75 = 40;
const STRESS_SHIFT_POINTS = 5;       // 7d-vs-30d mean stress movement that counts as a shift
const STRAIN_TEMP_DELTA_C = 0.3;
const LOW_STREAK_DAYS = 3;
const ONSET_REGULAR_SD_MIN = 45;
const ONSET_WINDOW_DAYS = 14;        // bedtime regularity is judged over two weeks
const NIGHT_HOURS = [0, 6];          // inclusive clock hours for the "night" HRV mean
const DAY_HOURS = [9, 21];
const MIN_READINGS_PER_BUCKET = 5;

const r0 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v));
const r1 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);
const r2 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
const nums = (arr) => arr.filter(v => v != null && Number.isFinite(v));
const mean = (arr) => { const v = nums(arr); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const sd = (arr) => {
    const v = nums(arr);
    if (v.length < 2) return null;
    const m = mean(v);
    return Math.sqrt(v.reduce((a, b) => a + (b - m) * (b - m), 0) / (v.length - 1));
};
const percentile = (arr, p) => {
    const v = nums(arr).sort((a, b) => a - b);
    if (!v.length) return null;
    const idx = (v.length - 1) * p;
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    return lo === hi ? v[lo] : v[lo] + (v[hi] - v[lo]) * (idx - lo);
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const dayMs = 86400000;
const toUtc = (d) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
const daysBetween = (a, b) => Math.round((toUtc(b) - toUtc(a)) / dayMs);   // b - a
const isWeekend = (d) => { const w = new Date(toUtc(d)).getUTCDay(); return w === 0 || w === 6; };
const zScore = (v, m, s) => (v == null || m == null || s == null || s === 0 ? null : (v - m) / s);
const onsetMinutes = (hhmm) => {
    if (typeof hhmm !== 'string' || !/^\d{2}:\d{2}$/.test(hhmm)) return null;
    const m = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
    return m < 12 * 60 ? m + 1440 : m;    // 01:30 is "after midnight", not "early"
};

function analyzeWearable({ daily = [], readings = [], today = null } = {}) {
    const rows = (Array.isArray(daily) ? daily : []).filter(r => r && isDate(r.date)).slice().sort((a, b) => a.date.localeCompare(b.date));
    const reads = (Array.isArray(readings) ? readings : []).filter(r => r && isDate(r.date) && r.hrv_ms != null);
    const ref = isDate(today) ? today : (rows.length ? rows[rows.length - 1].date : null);

    const hrvDays = rows.filter(r => r.hrv_ms != null);
    const sleepDays = rows.filter(r => r.sleep_hours != null);
    const out = {
        version: 1,
        data_quality: {
            days_with_hrv: hrvDays.length,
            days_with_sleep: sleepDays.length,
            readings: reads.length,
            baseline_ready: hrvDays.length >= BASELINE_READY_DAYS,
            provisional: hrvDays.length < BASELINE_READY_DAYS,
            days_until_baseline: Math.max(0, BASELINE_READY_DAYS - hrvDays.length),
        },
        baseline: null, today: null, readiness: null, sleep: null, stress: null,
        anomaly: { flags: [] },
    };
    if (!ref) return out;

    // ---- sleep: independent of HRV coverage ----
    out.sleep = analyzeSleep(sleepDays, ref);

    if (hrvDays.length < MIN_DAYS_FOR_ANALYSIS) return out;

    // ---- reference day: today if it has HRV, else the latest day that does ----
    const refRow = hrvDays[hrvDays.length - 1];
    const within = (n, r) => daysBetween(r.date, ref) < n && daysBetween(r.date, ref) >= 0;
    const hist = hrvDays.filter(r => r.date !== refRow.date);        // the user's history, excluding the day being judged
    const last7 = hrvDays.filter(r => within(7, r));

    const hrv30 = mean(hist.map(r => r.hrv_ms)), hrvSd = sd(hist.map(r => r.hrv_ms));
    const rhrRows = rows.filter(r => r.resting_hr != null);
    const rhrHist = rhrRows.filter(r => r.date !== refRow.date);
    const rhr30 = mean(rhrHist.map(r => r.resting_hr)), rhrSd = sd(rhrHist.map(r => r.resting_hr));
    const tempHist = rows.filter(r => r.skin_temp_c != null && r.date !== refRow.date);
    const temp30 = mean(tempHist.map(r => r.skin_temp_c));

    out.baseline = {
        hrv_7d: r1(mean(last7.map(r => r.hrv_ms))),
        hrv_30d: r1(hrv30),
        hrv_sd: r1(hrvSd),
        hrv_cv_pct: hrv30 && hrvSd != null ? r0(hrvSd / hrv30 * 100) : null,
        band_low: r0(percentile(hist.map(r => r.hrv_ms), 0.1)),
        band_high: r0(percentile(hist.map(r => r.hrv_ms), 0.9)),
        rhr_7d: r0(mean(rows.filter(r => r.resting_hr != null && within(7, r)).map(r => r.resting_hr))),
        rhr_30d: r0(rhr30),
        rhr_sd: r1(rhrSd),
        history_days: hist.length,
    };

    const hrvZ = zScore(refRow.hrv_ms, hrv30, hrvSd);
    const rhrZ = zScore(refRow.resting_hr, rhr30, rhrSd);
    const tempDelta = refRow.skin_temp_c != null && temp30 != null ? refRow.skin_temp_c - temp30 : null;
    out.today = {
        date: refRow.date,
        is_today: refRow.date === ref,
        hrv_ms: r1(refRow.hrv_ms),
        hrv_z: r2(hrvZ),
        hrv_vs_baseline_pct: hrv30 ? r0((refRow.hrv_ms - hrv30) / hrv30 * 100) : null,
        hrv_band_position: out.baseline.band_low == null ? null
            : refRow.hrv_ms < out.baseline.band_low ? 'below' : refRow.hrv_ms > out.baseline.band_high ? 'above' : 'in',
        resting_hr: r0(refRow.resting_hr),
        rhr_z: r2(rhrZ),
        skin_temp_delta_c: r2(tempDelta),
    };

    // ---- readiness ----
    const ln = out.sleep && out.sleep.last_night;
    const sleepHist = sleepDays.filter(r => !ln || r.date !== ln.date).map(r => r.sleep_hours);
    const sleepZ = ln ? zScore(ln.hours, mean(sleepHist), sd(sleepHist)) : null;
    const score = clamp(
        READINESS.base + READINESS.hrv * (hrvZ ?? 0) - READINESS.rhr * (rhrZ ?? 0) + READINESS.sleep * (sleepZ ?? 0),
        0, 100
    );
    const drivers = [];
    if (out.today.hrv_band_position === 'below') drivers.push('hrv_below_band');
    else if (out.today.hrv_band_position === 'above') drivers.push('hrv_above_band');
    else if (out.today.hrv_band_position === 'in') drivers.push('hrv_in_band');
    if (rhrZ != null && rhrZ >= 1) drivers.push('rhr_elevated');
    else if (rhrZ != null && rhrZ <= -1) drivers.push('rhr_low');
    if (!ln) drivers.push('no_sleep_data');
    else if (ln.hours < SLEEP_TARGET_HOURS - 1) drivers.push('short_sleep');
    else if (ln.restorative_pct != null && ln.restorative_pct < 30) drivers.push('low_restorative');
    else if (sleepZ != null && sleepZ >= 0.5) drivers.push('good_sleep');
    out.readiness = {
        score: r0(score),
        level: score >= READINESS.ready ? 'ready' : score >= READINESS.moderate ? 'moderate' : 'low',
        components: { hrv_z: r2(hrvZ), rhr_z: r2(rhrZ), sleep_z: r2(sleepZ) },
        drivers: drivers.slice(0, 3),
    };

    // ---- stress & circadian (per-reading) ----
    out.stress = analyzeStress(reads, rows, ref, refRow.date, hrv30, hrvSd, last7);

    // ---- anomaly flags ----
    if (hrvDays.length >= MIN_DAYS_FOR_FLAGS) {
        const flags = [];
        const hrv7hist = mean(last7.filter(r => r.date !== refRow.date).map(r => r.hrv_ms));
        if (hrv7hist != null && hrvSd != null && refRow.hrv_ms <= hrv7hist - hrvSd) {
            flags.push({ code: 'hrv_drop', since: refRow.date, evidence: { hrv_ms: r1(refRow.hrv_ms), hrv_7d: r1(hrv7hist), hrv_sd: r1(hrvSd) } });
        }
        let streak = 0, since = null;
        for (let i = hrvDays.length - 1; i >= 0; i--) {
            if (out.baseline.band_low != null && hrvDays[i].hrv_ms < out.baseline.band_low) { streak++; since = hrvDays[i].date; } else break;
        }
        if (streak >= LOW_STREAK_DAYS) flags.push({ code: 'low_streak', since, evidence: { days: streak, band_low: out.baseline.band_low } });
        if (hrvZ != null && hrvZ <= -1 && rhrZ != null && rhrZ >= 1 && tempDelta != null && tempDelta >= STRAIN_TEMP_DELTA_C) {
            flags.push({ code: 'strain_watch', since: refRow.date, evidence: { hrv_z: r2(hrvZ), rhr_z: r2(rhrZ), skin_temp_delta_c: r2(tempDelta) } });
        }
        out.anomaly.flags = flags;
    }
    return out;
}

function analyzeSleep(sleepDays, ref) {
    if (sleepDays.length === 0) return null;
    const last = sleepDays[sleepDays.length - 1];
    const within7 = sleepDays.filter(r => { const d = daysBetween(r.date, ref); return d >= 0 && d < 7; });
    const others7 = within7.filter(r => r.date !== last.date);
    const restorative = (r) => r.sleep_hours && (r.deep_minutes != null || r.rem_minutes != null) ? r0(((r.deep_minutes || 0) + (r.rem_minutes || 0)) / (r.sleep_hours * 60) * 100) : null;
    const onsets = nums(sleepDays.filter(r => { const d = daysBetween(r.date, ref); return d >= 0 && d < ONSET_WINDOW_DAYS; }).map(r => onsetMinutes(r.sleep_onset)));
    const onsetSd = sd(onsets);
    const stageAvailable = sleepDays.some(r => r.deep_minutes != null);
    const avg7 = mean(within7.map(r => r.sleep_hours));
    return {
        last_night: {
            date: last.date,
            hours: r1(last.sleep_hours),
            restorative_pct: stageAvailable ? restorative(last) : null,
            vs_7d_hours: others7.length ? r1(last.sleep_hours - mean(others7.map(r => r.sleep_hours))) : null,
            onset: last.sleep_onset || null,
            wake: last.wake_time || null,
        },
        avg_7d_hours: r1(avg7),
        avg_30d_hours: r1(mean(sleepDays.map(r => r.sleep_hours))),
        nights_7d: within7.length,
        debt_7d_hours: r1(within7.reduce((s, r) => s + Math.max(0, SLEEP_TARGET_HOURS - r.sleep_hours), 0)),
        target_hours: SLEEP_TARGET_HOURS,
        onset_sd_min: onsets.length >= 3 ? r0(onsetSd) : null,
        regular: onsets.length >= 3 && onsetSd != null ? onsetSd <= ONSET_REGULAR_SD_MIN : null,
        stage_breakdown_available: stageAvailable,
    };
}

function analyzeStress(reads, rows, ref, refDate, hrv30, hrvSd, last7) {
    const within = (n, d) => { const k = daysBetween(d, ref); return k >= 0 && k < n; };
    const allStress = reads.map(r => r.stress).filter(v => v != null && Number.isFinite(v));
    const highCut = allStress.length >= MIN_READINGS_FOR_P75 ? percentile(allStress, STRESS_HIGH_PCTL) : STRESS_HIGH_READING;
    // Strictly above: a flat distribution (every reading equal) is 0% high, not 100%.
    const stressed = (rs) => { const v = rs.filter(r => r.stress != null); return v.length ? r0(v.filter(r => r.stress > highCut).length / v.length * 100) : null; };
    const todayReads = reads.filter(r => r.date === refDate);
    const reads7 = reads.filter(r => within(7, r.date));

    // Balance: the stress byte moving alone is not a signal (it was inverted once, §18) — it
    // has to agree with HRV moving the same way over the same week.
    const stress7 = mean(rows.filter(r => r.stress != null && within(7, r.date)).map(r => r.stress));
    const stress30 = mean(rows.filter(r => r.stress != null).map(r => r.stress));
    const hrv7 = mean(last7.map(r => r.hrv_ms));
    const stressShift = stress7 != null && stress30 != null ? stress7 - stress30 : null;
    const hrvShift = hrv7 != null && hrv30 != null ? hrv7 - hrv30 : null;
    let balance = 'balanced';
    if (stressShift != null && hrvShift != null) {
        if (stressShift >= STRESS_SHIFT_POINTS && hrvShift < 0) balance = 'accumulating';
        else if (stressShift <= -STRESS_SHIFT_POINTS && hrvShift > 0) balance = 'recovering';
    } else if (stressShift == null && hrvShift != null && hrvSd) {
        if (hrvShift <= -hrvSd) balance = 'accumulating';
        else if (hrvShift >= hrvSd) balance = 'recovering';
    }

    const night = reads.filter(r => r.hour >= NIGHT_HOURS[0] && r.hour <= NIGHT_HOURS[1]).map(r => r.hrv_ms);
    const day = reads.filter(r => r.hour >= DAY_HOURS[0] && r.hour <= DAY_HOURS[1]).map(r => r.hrv_ms);
    const nightDay = night.length >= MIN_READINGS_PER_BUCKET && day.length >= MIN_READINGS_PER_BUCKET && mean(day) ? r2(mean(night) / mean(day)) : null;

    const byHour = new Map();
    for (const r of reads) { if (!byHour.has(r.hour)) byHour.set(r.hour, []); byHour.get(r.hour).push(r.hrv_ms); }
    let peakHour = null, peakMean = -Infinity;
    for (const [h, v] of byHour) { if (v.length >= 3) { const m = mean(v); if (m > peakMean) { peakMean = m; peakHour = h; } } }

    const weekend = rows.filter(r => r.hrv_ms != null && isWeekend(r.date)).map(r => r.hrv_ms);
    const weekday = rows.filter(r => r.hrv_ms != null && !isWeekend(r.date)).map(r => r.hrv_ms);
    const wkDelta = weekend.length >= 2 && weekday.length >= 3 ? r1(mean(weekend) - mean(weekday)) : null;

    return {
        load_today: stressed(todayReads),
        load_today_date: todayReads.length ? refDate : null,
        load_7d: stressed(reads7),
        high_cut: r0(highCut),
        high_cut_personal: allStress.length >= MIN_READINGS_FOR_P75,
        avg_stress_7d: r0(stress7),
        avg_stress_30d: r0(stress30),
        balance,
        night_day_hrv_ratio: nightDay,
        peak_hrv_hour: peakHour,
        weekend_vs_weekday_hrv_ms: wkDelta,
    };
}

// ---- prompt block ----------------------------------------------------------------------

const DRIVER_TEXT = {
    zh: { hrv_below_band: 'HRV 低于个人正常区间', hrv_in_band: 'HRV 在个人正常区间内', hrv_above_band: 'HRV 高于个人正常区间', rhr_elevated: '静息心率高于平时', rhr_low: '静息心率低于平时', short_sleep: '昨晚睡眠偏短', low_restorative: '深睡+REM 占比偏低', good_sleep: '昨晚睡眠好于平时', no_sleep_data: '昨晚没有睡眠记录' },
    en: { hrv_below_band: 'HRV below your normal range', hrv_in_band: 'HRV within your normal range', hrv_above_band: 'HRV above your normal range', rhr_elevated: 'resting HR above usual', rhr_low: 'resting HR below usual', short_sleep: 'short sleep last night', low_restorative: 'low deep+REM share', good_sleep: 'better sleep than usual', no_sleep_data: 'no sleep recorded last night' },
};
const vsNightsZh = (d) => (d == null ? '' : d === 0 ? '，与本周其余几晚持平' : `，比本周其余几晚${d > 0 ? '多' : '少'} ${Math.abs(d)}h`);
const vsNightsEn = (d) => (d == null ? '' : d === 0 ? ', same as the other nights this week' : `, ${Math.abs(d)}h ${d > 0 ? 'more' : 'less'} than the other nights this week`);
const LEVEL_TEXT = { zh: { ready: '良好', moderate: '一般', low: '偏低' }, en: { ready: 'good', moderate: 'moderate', low: 'low' } };
const BALANCE_TEXT = { zh: { recovering: '趋于恢复', balanced: '基本平衡', accumulating: '趋于累积' }, en: { recovering: 'recovering', balanced: 'balanced', accumulating: 'accumulating' } };
const FLAG_TEXT = {
    zh: { hrv_drop: 'HRV 明显低于最近一周', low_streak: 'HRV 连续多日低于个人正常区间', strain_watch: '身体负荷偏高（HRV 下降、静息心率和皮温同时上升），建议以休息为主' },
    en: { hrv_drop: 'HRV clearly below the past week', low_streak: 'HRV below your normal range for several days running', strain_watch: 'elevated strain (HRV down, resting HR and skin temperature both up) — prioritise rest' },
};

function describeWearableInsights(ins, isZh = true) {
    if (!ins || (!ins.readiness && !ins.sleep)) return '';
    const L = isZh ? 'zh' : 'en';
    const lines = [];
    const dq = ins.data_quality || {};
    if (ins.readiness && ins.today && ins.baseline) {
        const t = ins.today, b = ins.baseline, rd = ins.readiness;
        const band = b.band_low != null ? (isZh ? `个人正常区间 ${b.band_low}–${b.band_high}ms` : `personal range ${b.band_low}–${b.band_high}ms`) : '';
        const vs = t.hrv_vs_baseline_pct != null ? (isZh ? `比30天基线${t.hrv_vs_baseline_pct >= 0 ? '高' : '低'} ${Math.abs(t.hrv_vs_baseline_pct)}%` : `${Math.abs(t.hrv_vs_baseline_pct)}% ${t.hrv_vs_baseline_pct >= 0 ? 'above' : 'below'} your 30-day baseline`) : '';
        lines.push(isZh
            ? `恢复状态（${t.date}${t.is_today ? '' : '，最近一次有 HRV 的日期'}）：${LEVEL_TEXT.zh[rd.level]}（${rd.score}/100）；HRV ${t.hrv_ms}ms，${vs}${band ? `，${band}` : ''}${t.resting_hr != null ? `；静息心率 ${t.resting_hr}${b.rhr_30d != null ? `（30天均值 ${b.rhr_30d}）` : ''}` : ''}。主要因素：${rd.drivers.map(d => DRIVER_TEXT.zh[d] || d).join('、') || '—'}。`
            : `Recovery (${t.date}${t.is_today ? '' : ', latest day with HRV'}): ${LEVEL_TEXT.en[rd.level]} (${rd.score}/100); HRV ${t.hrv_ms}ms, ${vs}${band ? `, ${band}` : ''}${t.resting_hr != null ? `; resting HR ${t.resting_hr}${b.rhr_30d != null ? ` (30-day mean ${b.rhr_30d})` : ''}` : ''}. Drivers: ${rd.drivers.map(d => DRIVER_TEXT.en[d] || d).join(', ') || '—'}.`);
    }
    if (ins.sleep && ins.sleep.last_night) {
        const s = ins.sleep, ln = s.last_night;
        lines.push(isZh
            ? `睡眠：最近一晚（${ln.date}）${ln.hours}h${vsNightsZh(ln.vs_7d_hours)}${ln.restorative_pct != null ? `，深睡+REM 占 ${ln.restorative_pct}%` : ''}；近7天均值 ${s.avg_7d_hours ?? '—'}h，相对 ${s.target_hours}h 目标累计欠 ${s.debt_7d_hours ?? '—'}h${s.regular != null ? `；入睡时间${s.regular ? '规律' : '不规律'}（波动约 ${s.onset_sd_min} 分钟）` : ''}。`
            : `Sleep: last night (${ln.date}) ${ln.hours}h${vsNightsEn(ln.vs_7d_hours)}${ln.restorative_pct != null ? `, deep+REM ${ln.restorative_pct}%` : ''}; 7-day mean ${s.avg_7d_hours ?? '—'}h, ${s.debt_7d_hours ?? '—'}h short of a ${s.target_hours}h target over the week${s.regular != null ? `; bedtime ${s.regular ? 'regular' : 'irregular'} (varies by ~${s.onset_sd_min} min)` : ''}.`);
    }
    if (ins.stress) {
        const st = ins.stress;
        const parts = [];
        parts.push(isZh ? `近7天压力${BALANCE_TEXT.zh[st.balance]}` : `stress ${BALANCE_TEXT.en[st.balance]} over the past week`);
        if (st.load_today != null) parts.push(isZh ? `${st.load_today_date} 高压力读数占 ${st.load_today}%` : `${st.load_today}% of readings on ${st.load_today_date} were high-stress`);
        if (st.load_7d != null) parts.push(isZh ? `近7天占 ${st.load_7d}%` : `${st.load_7d}% over 7 days`);
        if (st.night_day_hrv_ratio != null) parts.push(isZh ? `夜间/白天 HRV 比 ${st.night_day_hrv_ratio}` : `night/day HRV ratio ${st.night_day_hrv_ratio}`);
        if (st.peak_hrv_hour != null) parts.push(isZh ? `HRV 通常在 ${st.peak_hrv_hour} 点前后最高` : `HRV usually peaks around ${st.peak_hrv_hour}:00`);
        lines.push((isZh ? '压力：' : 'Stress: ') + parts.join(isZh ? '；' : '; ') + (isZh ? '。' : '.'));
    }
    for (const f of (ins.anomaly && ins.anomaly.flags) || []) {
        lines.push(isZh ? `提示：${FLAG_TEXT.zh[f.code] || f.code}（自 ${f.since}）。` : `Note: ${FLAG_TEXT.en[f.code] || f.code} (since ${f.since}).`);
    }
    if (dq.provisional) {
        lines.push(isZh ? `基线仅基于 ${dq.days_with_hrv} 天数据，结论为初步，再戴 ${dq.days_until_baseline} 天后更可靠。` : `Baseline rests on only ${dq.days_with_hrv} days; treat this as provisional until ${dq.days_until_baseline} more days are worn.`);
    }
    if (!lines.length) return '';
    return isZh
        ? `【数字孪生 · 日常监测 · 分析（相对个人基线）】\n${lines.join('\n')}\n使用规则：这些是相对用户自己历史的统计结论，不是诊断；"负荷偏高"只对应休息、减量的建议，不要解读为疾病；引用时说明是相对个人基线，不要给出绝对"正常值"。`
        : `[TWIN · DAILY MONITORING · ANALYSIS (relative to personal baseline)]\n${lines.join('\n')}\nRules: these are statistics against the user's own history, not a diagnosis; "strain" maps only to rest/reduce-load advice, never illness; when citing, say it is relative to their baseline and never quote an absolute "normal value".`;
}

// One sentence for the daily check-in (a single lightweight completion, §29): readiness, last
// night, any flag. The full block above would dominate a greeting.
function summarizeInsightsLine(ins, isZh = true) {
    if (!ins || !ins.readiness) return '';
    const L = isZh ? 'zh' : 'en';
    const parts = [];
    const rd = ins.readiness, t = ins.today;
    parts.push(isZh
        ? `恢复状态${LEVEL_TEXT.zh[rd.level]}（${rd.score}/100，${t.date}${t.is_today ? '' : ' 的数据'}${rd.drivers.length ? '：' + rd.drivers.map(d => DRIVER_TEXT.zh[d] || d).join('、') : ''}）`
        : `recovery ${LEVEL_TEXT.en[rd.level]} (${rd.score}/100, ${t.date}${t.is_today ? '' : ' data'}${rd.drivers.length ? ': ' + rd.drivers.map(d => DRIVER_TEXT.en[d] || d).join(', ') : ''})`);
    const ln = ins.sleep && ins.sleep.last_night;
    if (ln) parts.push(isZh
        ? `最近一晚（${ln.date}）睡眠 ${ln.hours}h${vsNightsZh(ln.vs_7d_hours)}`
        : `last night (${ln.date}) ${ln.hours}h${vsNightsEn(ln.vs_7d_hours)}`);
    for (const f of (ins.anomaly && ins.anomaly.flags) || []) parts.push((isZh ? '提示：' : 'note: ') + (FLAG_TEXT[L][f.code] || f.code));
    if (ins.data_quality && ins.data_quality.provisional) parts.push(isZh ? `（基线仅 ${ins.data_quality.days_with_hrv} 天，初步）` : `(baseline only ${ins.data_quality.days_with_hrv} days, provisional)`);
    return parts.join(isZh ? '；' : '; ');
}

// Dates the block can cite, for agenticChat's contextDates() — a cited day must be allow-listed
// or grounding rewrites it as a fabrication (§21).
function insightDates(ins) {
    if (!ins) return [];
    const d = [];
    if (ins.today && isDate(ins.today.date)) d.push(ins.today.date);
    if (ins.sleep && ins.sleep.last_night && isDate(ins.sleep.last_night.date)) d.push(ins.sleep.last_night.date);
    if (ins.stress && isDate(ins.stress.load_today_date)) d.push(ins.stress.load_today_date);
    for (const f of (ins.anomaly && ins.anomaly.flags) || []) if (isDate(f.since)) d.push(f.since);
    return [...new Set(d)];
}

module.exports = {
    analyzeWearable, describeWearableInsights, summarizeInsightsLine, insightDates,
    DRIVER_TEXT, FLAG_TEXT, LEVEL_TEXT, BALANCE_TEXT,
    MIN_DAYS_FOR_ANALYSIS, MIN_DAYS_FOR_FLAGS, BASELINE_READY_DAYS, SLEEP_TARGET_HOURS, READINESS, STRESS_HIGH_READING, STRAIN_TEMP_DELTA_C, LOW_STREAK_DAYS,
};
