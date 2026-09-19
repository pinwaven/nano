'use strict';

/**
 * Per-day wearable readings — what a user means by 「昨晚睡得怎么样」「今天走了多少步」.
 *
 * health_twin holds 7-day AVERAGES (lib/healthTwinUpdater.js) and a trend word, and until
 * 2026-09-15 that was all any prompt or tool showed: asked about last night, the model had
 * only an average to answer with. The nightly duration/stages/onset, daily steps, HRV, resting
 * HR, SpO₂, stress and breath rate all sit in health_events keyed by data_date — this reads
 * them back per day with a FIXED shape (§21's reason for never exposing the raw JSONB).
 *
 * Conventions this shares with lib/twinBundle.js and must keep:
 * - dates are bare YYYY-MM-DD strings (`data_date::text`) — never Date objects, which
 *   node-postgres parses at local midnight and serialises to the wrong UTC day;
 * - "today" is the Shanghai date, so a reading synced after 16:00 UTC lands on the right day;
 * - vitals are AVERAGED within the day (thousands of readings a day), never MAX/MIN, except
 *   the intraday heart-rate range which is deliberately min/max over hr_slots;
 * - sleep_start_min is the onset clock (hh*60+mm mod 1440) on that date, exactly as the
 *   miniapp's user-health component renders it; wake = onset + duration.
 */

const MAX_DAYS = 30;

function clampDays(n, dflt = 7) {
    const v = Number.parseInt(n, 10);
    if (!Number.isFinite(v)) return dflt;
    return Math.min(MAX_DAYS, Math.max(1, v));
}

const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
const r0 = (v) => (v == null ? null : Math.round(v));
const hhmm = (mins) => {
    if (mins == null) return null;
    const m = ((Math.round(mins) % 1440) + 1440) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

async function fetchWearableDaily(pool, userId, days = 7) {
    const n = clampDays(days);
    const { rows } = await pool.query(
        `SELECT e.data_date::text AS date,
                MAX(CASE WHEN e.category = 'sleep' THEN (e.data->>'duration_minutes')::float END) AS sleep_minutes,
                MAX(CASE WHEN e.category = 'sleep' THEN COALESCE((e.data->>'deep_minutes')::float,  (e.data->'stages'->>'deep_minutes')::float)  END) AS deep_minutes,
                MAX(CASE WHEN e.category = 'sleep' THEN COALESCE((e.data->>'rem_minutes')::float,   (e.data->'stages'->>'rem_minutes')::float)   END) AS rem_minutes,
                MAX(CASE WHEN e.category = 'sleep' THEN COALESCE((e.data->>'light_minutes')::float, (e.data->'stages'->>'light_minutes')::float) END) AS light_minutes,
                MAX(CASE WHEN e.category = 'sleep' THEN COALESCE((e.data->>'awake_minutes')::float, (e.data->'stages'->>'awake_minutes')::float) END) AS awake_minutes,
                MAX(CASE WHEN e.category = 'sleep' THEN (e.data->>'sleep_start_min')::float END) AS sleep_start_min,
                MAX(CASE WHEN e.category = 'sleep' THEN (e.data->>'sleep_score')::float END) AS sleep_score,
                MAX(CASE WHEN e.category = 'activity' THEN (e.data->>'steps')::float
                         WHEN e.category = 'vitals'   THEN (e.data->>'steps')::float END) AS steps,
                MAX(CASE WHEN e.category = 'activity' THEN (e.data->>'duration_minutes')::float END) AS active_minutes,
                AVG(CASE WHEN e.category = 'vitals' THEN (e.data->>'hrv_ms')::float END)      AS hrv_ms,
                AVG(CASE WHEN e.category = 'vitals' THEN (e.data->>'resting_hr')::float END)  AS resting_hr,
                AVG(CASE WHEN e.category = 'vitals' THEN (e.data->>'spo2')::float END)        AS spo2,
                AVG(CASE WHEN e.category = 'vitals' THEN (e.data->>'stress')::float END)      AS stress,
                AVG(CASE WHEN e.category = 'vitals' THEN (e.data->>'breath_rate')::float END) AS breath_rate,
                AVG(CASE WHEN e.category = 'vitals' THEN (e.data->>'skin_temp_c')::float END) AS skin_temp_c,
                MIN(hr.mn) AS hr_min, MAX(hr.mx) AS hr_max, COALESCE(SUM(hr.n), 0)::int AS hr_readings,
                MAX(e.recorded_at) AS synced_at
           FROM health_events e
           LEFT JOIN LATERAL (
                SELECT MIN((s->>'bpm')::int) AS mn, MAX((s->>'bpm')::int) AS mx, COUNT(*) AS n
                  FROM jsonb_array_elements(CASE WHEN e.category = 'vitals' AND jsonb_typeof(e.data->'hr_slots') = 'array'
                                                 THEN e.data->'hr_slots' ELSE '[]'::jsonb END) s
           ) hr ON TRUE
          WHERE e.user_id = $1
            AND e.category IN ('sleep', 'activity', 'vitals')
            AND e.data_date > (NOW() AT TIME ZONE 'Asia/Shanghai')::date - $2::int
          GROUP BY e.data_date
          ORDER BY e.data_date DESC`,
        [userId, n]
    );
    return rows.map(x => ({
        date: x.date,
        sleep_hours: x.sleep_minutes == null ? null : r1(x.sleep_minutes / 60),
        deep_minutes: r0(x.deep_minutes),
        rem_minutes: r0(x.rem_minutes),
        light_minutes: r0(x.light_minutes),
        awake_minutes: r0(x.awake_minutes),
        sleep_onset: hhmm(x.sleep_start_min),
        wake_time: x.sleep_start_min == null || x.sleep_minutes == null ? null : hhmm(x.sleep_start_min + x.sleep_minutes),
        sleep_score: r0(x.sleep_score),
        steps: r0(x.steps),
        active_minutes: r0(x.active_minutes),
        hrv_ms: r1(x.hrv_ms),
        resting_hr: r0(x.resting_hr),
        spo2: r1(x.spo2),
        stress: r0(x.stress),
        breath_rate: r1(x.breath_rate),
        skin_temp_c: r1(x.skin_temp_c),
        hr_min: x.hr_min ?? null,
        hr_max: x.hr_max ?? null,
        hr_readings: x.hr_readings,
    }));
}

// Per-reading HRV rows for lib/wearableAnalysis.js's circadian and stress-load metrics —
// the daily rows above average a whole day into one number, which is exactly what a
// night/day ratio or a "share of stressed readings" cannot be computed from. The
// measurement time is the 14-digit tail of sync.js's `${src}_hrv_${YYYYMMDDHHmmss}`
// external_id (the miniapp's _tsFromExtId reads the same thing); `recorded_at` is only a
// fallback, since a sync-time stamp there predates the per-slot timestamps (2026-07).
// Shape: [{ date, hour, hrv_ms, stress, heart_rate }], oldest first; `hour` is the
// Shanghai clock hour of the reading. A row whose external_id tail is not 14 digits and
// whose recorded_at is null is dropped rather than guessed onto a date.
async function fetchHrvReadings(pool, userId, days = 30) {
    const n = clampDays(days, 30);
    const { rows } = await pool.query(
        `SELECT e.external_id,
                to_char(e.recorded_at AT TIME ZONE 'Asia/Shanghai', 'YYYYMMDDHH24MISS') AS recorded_ts,
                (e.data->>'hrv_ms')::float        AS hrv_ms,
                (e.data->>'stress')::float        AS stress,
                (e.data->>'heart_rate_hrv')::float AS heart_rate
           FROM health_events e
          WHERE e.user_id = $1
            AND e.category = 'vitals'
            AND e.external_id LIKE '%\\_hrv\\_%'
            AND e.data->>'hrv_ms' IS NOT NULL
            AND e.data_date > (NOW() AT TIME ZONE 'Asia/Shanghai')::date - $2::int
          ORDER BY e.external_id ASC`,
        [userId, n]
    );
    const out = [];
    for (const x of rows) {
        const tail = String(x.external_id || '').slice(-14);
        const ts = /^\d{14}$/.test(tail) ? tail : (x.recorded_ts || null);
        if (!ts || !/^\d{14}$/.test(ts)) continue;
        out.push({
            ts,
            date: `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`,
            hour: Number(ts.slice(8, 10)),
            hrv_ms: x.hrv_ms == null ? null : Number(x.hrv_ms),
            stress: x.stress == null ? null : Number(x.stress),
            heart_rate: x.heart_rate == null ? null : Number(x.heart_rate),
        });
    }
    out.sort((a, b) => a.ts.localeCompare(b.ts));
    return out.map(({ ts, ...r }) => r);
}

// The comparisons a reply needs, done here rather than left to the model (the codebase's
// standing rule: no arithmetic the LLM does not need to do). `today` is the Shanghai date.
function summarizeWearableDaily(rows, today) {
    if (!rows || rows.length === 0) return null;
    const withSleep = rows.filter(r => r.sleep_hours != null);
    const lastNight = withSleep[0] || null;
    const avg = (arr, k) => { const v = arr.map(r => r[k]).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const prior = (k, excludeDate) => avg(rows.filter(r => r.date !== excludeDate), k);
    const latest = (k) => rows.find(r => r[k] != null) || null;
    const todayRow = rows.find(r => r.date === today) || null;
    const out = { days_covered: rows.length, first_date: rows[rows.length - 1].date, last_date: rows[0].date };
    if (lastNight) {
        const avgSleep = prior('sleep_hours', lastNight.date);
        out.last_night = {
            date: lastNight.date, sleep_hours: lastNight.sleep_hours, deep_minutes: lastNight.deep_minutes, rem_minutes: lastNight.rem_minutes,
            sleep_onset: lastNight.sleep_onset, wake_time: lastNight.wake_time,
            vs_other_nights_hours: avgSleep == null ? null : r1(lastNight.sleep_hours - avgSleep),
            restorative_pct: lastNight.sleep_hours ? r0(((lastNight.deep_minutes || 0) + (lastNight.rem_minutes || 0)) / (lastNight.sleep_hours * 60) * 100) : null,
        };
    }
    const hrvRow = latest('hrv_ms');
    if (hrvRow) out.latest_hrv = { date: hrvRow.date, hrv_ms: hrvRow.hrv_ms, vs_other_days_ms: r1(hrvRow.hrv_ms - (prior('hrv_ms', hrvRow.date) ?? hrvRow.hrv_ms)) };
    const rhrRow = latest('resting_hr');
    if (rhrRow) out.latest_resting_hr = { date: rhrRow.date, resting_hr: rhrRow.resting_hr, vs_other_days_bpm: r0(rhrRow.resting_hr - (prior('resting_hr', rhrRow.date) ?? rhrRow.resting_hr)) };
    if (todayRow) out.today = { date: today, steps_so_far: todayRow.steps, hr_range_so_far: todayRow.hr_min != null ? `${todayRow.hr_min}–${todayRow.hr_max}` : null, partial_day: true };
    out.averages = {
        sleep_hours: r1(avg(rows, 'sleep_hours')), steps: r0(avg(rows, 'steps')), hrv_ms: r1(avg(rows, 'hrv_ms')),
        resting_hr: r0(avg(rows, 'resting_hr')), spo2: r1(avg(rows, 'spo2')), stress: r0(avg(rows, 'stress')),
    };
    return out;
}

// Prompt rendering. Every number the model may cite is written here as text, one line per
// day, so 「昨晚」「今天」「这周」 each have a dated fact to point at instead of an average.
function describeWearableDaily(rows, isZh = true, today = null) {
    if (!rows || rows.length === 0) return '';
    const s = summarizeWearableDaily(rows, today);
    const dash = '—';
    const line = (r) => {
        const sleep = r.sleep_hours != null
            ? (isZh
                ? `睡眠 ${r.sleep_hours}h（深睡 ${r.deep_minutes ?? dash}min · REM ${r.rem_minutes ?? dash}min · 浅睡 ${r.light_minutes ?? dash}min · 清醒 ${r.awake_minutes ?? dash}min${r.sleep_onset ? `，入睡 ${r.sleep_onset}` : ''}${r.wake_time ? ` 醒来 ${r.wake_time}` : ''}）`
                : `sleep ${r.sleep_hours}h (deep ${r.deep_minutes ?? dash}min · REM ${r.rem_minutes ?? dash}min · light ${r.light_minutes ?? dash}min · awake ${r.awake_minutes ?? dash}min${r.sleep_onset ? `, onset ${r.sleep_onset}` : ''}${r.wake_time ? ` wake ${r.wake_time}` : ''})`)
            : (isZh ? `睡眠 ${dash}` : `sleep ${dash}`);
        const parts = [
            sleep,
            (isZh ? '步数 ' : 'steps ') + (r.steps ?? dash) + (r.date === today ? (isZh ? '（截至同步）' : ' (so far)') : ''),
            `HRV ${r.hrv_ms ?? dash}${r.hrv_ms != null ? 'ms' : ''}`,
            (isZh ? '静息心率 ' : 'resting HR ') + (r.resting_hr ?? dash),
            r.hr_min != null ? (isZh ? `心率范围 ${r.hr_min}–${r.hr_max}` : `HR range ${r.hr_min}–${r.hr_max}`) : null,
            `SpO₂ ${r.spo2 ?? dash}${r.spo2 != null ? '%' : ''}`,
            (isZh ? '压力 ' : 'stress ') + (r.stress ?? dash),
            (isZh ? '呼吸 ' : 'breath ') + (r.breath_rate ?? dash) + (r.breath_rate != null ? '/min' : ''),
        ].filter(Boolean);
        return `- ${r.date}：${parts.join(' | ')}`;
    };
    const lines = rows.map(line).join('\n');
    if (isZh) {
        const ln = s.last_night;
        const lastNight = ln
            ? `最近一晚（${ln.date}）：睡眠 ${ln.sleep_hours}h${ln.vs_other_nights_hours != null ? `，比其余几晚均值${ln.vs_other_nights_hours >= 0 ? '多' : '少'} ${Math.abs(ln.vs_other_nights_hours)}h` : ''}${ln.restorative_pct != null ? `；深睡+REM 占 ${ln.restorative_pct}%` : ''}${ln.sleep_onset ? `；入睡 ${ln.sleep_onset}` : ''}${ln.wake_time ? `，醒来 ${ln.wake_time}` : ''}。`
            : '最近几天没有睡眠记录。';
        const todayLine = s.today ? `今天（${s.today.date}）：步数 ${s.today.steps_so_far ?? dash}（截至最后一次同步，不是全天）${s.today.hr_range_so_far ? `，心率 ${s.today.hr_range_so_far}` : ''}。` : `今天（${today}）还没有同步到数据。`;
        const hrv = s.latest_hrv ? `最新 HRV（${s.latest_hrv.date}）${s.latest_hrv.hrv_ms}ms，比其余几天均值${s.latest_hrv.vs_other_days_ms >= 0 ? '高' : '低'} ${Math.abs(s.latest_hrv.vs_other_days_ms)}ms。` : '';
        return `【数字孪生 · 日常监测 · 逐日（最近 ${s.days_covered} 天，${s.first_date} 至 ${s.last_date}；"—" 表示当天无该项记录）】
${lines}
${lastNight}
${todayLine}
${hrv}
使用规则：回答"昨晚/今天/这周/最近几天"时，只引用上面带日期的逐日数据，并写明日期；7天均值不能当作某一天的数值来说；某天缺项就如实说当天没有记录，不要用其他天的数据代替；今天的步数是截至同步时的部分数据，不要当作全天步数评价。不要把某一晚的睡眠或某一天的心率/HRV归因于 Kino 指标（hsCRP、CD38 等）——穿戴数据与生物标志物之间没有可判定的因果关系，只能并列陈述，各自说明；也不要因此顺带推荐原粒，除非用户问的就是原粒。`;
    }
    const ln = s.last_night;
    const lastNight = ln
        ? `Last night (${ln.date}): ${ln.sleep_hours}h${ln.vs_other_nights_hours != null ? `, ${Math.abs(ln.vs_other_nights_hours)}h ${ln.vs_other_nights_hours >= 0 ? 'more' : 'less'} than the other nights` : ''}${ln.restorative_pct != null ? `; deep+REM ${ln.restorative_pct}%` : ''}${ln.sleep_onset ? `; onset ${ln.sleep_onset}` : ''}${ln.wake_time ? `, wake ${ln.wake_time}` : ''}.`
        : 'No sleep recorded in the last few days.';
    const todayLine = s.today ? `Today (${s.today.date}): ${s.today.steps_so_far ?? dash} steps so far (up to the last sync, not a full day)${s.today.hr_range_so_far ? `, HR ${s.today.hr_range_so_far}` : ''}.` : `Today (${today}): nothing synced yet.`;
    const hrv = s.latest_hrv ? `Latest HRV (${s.latest_hrv.date}) ${s.latest_hrv.hrv_ms}ms, ${Math.abs(s.latest_hrv.vs_other_days_ms)}ms ${s.latest_hrv.vs_other_days_ms >= 0 ? 'above' : 'below'} the other days.` : '';
    return `[TWIN · DAILY MONITORING, PER DAY (last ${s.days_covered} days, ${s.first_date} to ${s.last_date}; "—" = not recorded that day)]
${lines}
${lastNight}
${todayLine}
${hrv}
Rules: for "last night / today / this week / lately", cite only these dated rows and name the date; never present a 7-day average as a single day's value; if a day lacks a reading say so rather than substituting another day; today's steps are partial (up to the last sync), not a full-day count. Never attribute one night's sleep or one day's HR/HRV to a Kino marker (hsCRP, CD38…) — wearable readings and biomarkers have no determinable causal link here; state them side by side. Don't pivot to recommending dots unless dots were asked about.`;
}

// 「昨晚睡得怎么样」「今天走了多少步」「我的HRV最近怎么样」 — anchored on wearable vocabulary.
// Must not match the Formulate-Dots trigger (请根据我的完整健康数据…), which rides the same
// runAgenticTurn; a test pins that.
const WEARABLE_TRIGGER_RE = /(昨晚|昨夜|昨天晚上|前晚|今晚|睡眠|睡得|睡了|几点睡|入睡|深睡|浅睡|快速眼动|REM|打鼾|步数|走了多少|运动量|活动量|心率|静息心率|HRV|心率变异|血氧|SpO2|呼吸(频率|率)|压力(值|指数|大|高)|体温|皮温|手环|戒指|穿戴|同步)|(last night|sleep|slept|steps|walk(ed)?|heart rate|resting hr|hrv|spo2|oxygen|stress (level|score)|breathing rate|wearable|ring|band)/i;
function messageAsksAboutWearable(message) {
    return WEARABLE_TRIGGER_RE.test(message || '');
}

module.exports = { fetchWearableDaily, fetchHrvReadings, summarizeWearableDaily, describeWearableDaily, messageAsksAboutWearable, clampDays, MAX_DAYS };
