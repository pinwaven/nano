#!/usr/bin/env python3
"""Recompute every wearable statistic from health_events (never from health_twin), per device.
Writes data/wearable.json for the report parts."""
import json, collections, statistics as st, os
from datetime import datetime, timedelta, timezone, date

import sys
HERE = sys.argv[1]
rows = json.load(open(os.path.join(HERE, 'data', 'health_events.json')))
rows = [r for r in rows if r['category'] in ('sleep', 'activity', 'vitals')]
EXCL = [x for x in os.environ.get('EXCLUDE_DEV', '').split(',') if x]
rows = [r for r in rows if (r.get('wearable_name') or '') not in EXCL]
SH = timezone(timedelta(hours=8))
def sh(ts): return datetime.fromisoformat(ts.replace('Z', '+00:00')).astimezone(SH)
def dev(r): return r.get('wearable_name') or 'unnamed'
def mean(x): return round(st.mean(x), 2) if x else None
def med(x): return round(st.median(x), 2) if x else None
def sd(x): return round(st.pstdev(x), 2) if len(x) > 1 else None

out = {}

# ---------------- SLEEP ----------------
sleep = [r for r in rows if r['category'] == 'sleep']
sessions = []
for r in sleep:
    d = r['data']; dur = d.get('duration_minutes') or 0
    s = d.get('sleep_start_min'); e = d.get('sleep_end_min')
    # start_min is minutes from midnight of data_date; >=1440 means before midnight of the *previous* evening? no:
    # values like 1366 mean 22:46 on the evening of data_date; values like 83 mean 01:23 after midnight.
    start_clock = None
    if s is not None:
        m = s % 1440; start_clock = f'{m//60:02d}:{m%60:02d}'
        # minutes relative to midnight: 22:46 -> -74, 01:23 -> +83  (for averaging bedtime)
        rel = m - 1440 if m >= 900 else m
    else: rel = None
    sessions.append({'date': r['data_date'], 'device': dev(r), 'dur': dur, 'deep': d.get('deep_minutes') or 0,
                     'light': d.get('light_minutes') or 0, 'rem': d.get('rem_minutes') or 0, 'awake': d.get('awake_minutes') or 0,
                     'start_clock': start_clock, 'bed_rel_min': rel, 'has_stages': bool(d.get('slots')), 'nslots': len(d.get('slots') or [])})
sessions.sort(key=lambda x: x['date'])
# drop exact duplicate (06-06/06-07 identical payload) and wear interruptions (<60 min)
seen = set(); valid = []
for s_ in sessions:
    key = (s_['dur'], s_['deep'], s_['light'], s_['rem'], s_['start_clock'])
    if key in seen: s_['excluded'] = 'duplicate'; continue
    seen.add(key)
    if s_['dur'] < 60: s_['excluded'] = 'wear_interruption'; continue
    s_['excluded'] = None; valid.append(s_)
durs = [s_['dur'] / 60 for s_ in valid] or [0]
staged = [s_ for s_ in valid if s_['has_stages']]
def pct(s_, k): return 100 * s_[k] / s_['dur'] if s_['dur'] else 0
bed = [s_['bed_rel_min'] for s_ in valid if s_['bed_rel_min'] is not None]
bed_sorted = sorted(bed) or [0]
bed = bed or [0]
def clock_from_rel(m):
    m = int(round(m)) % 1440; return f'{m//60:02d}:{m%60:02d}'
# monthly
bym = collections.defaultdict(list)
for s_ in valid: bym[s_['date'][:7]].append(s_)
monthly = {m: {'n': len(v), 'mean_h': mean([x['dur']/60 for x in v]), 'short5_pct': round(100*sum(1 for x in v if x['dur'] < 300)/len(v)), 'bed_median': clock_from_rel(st.median([x['bed_rel_min'] for x in v if x['bed_rel_min'] is not None] or [0]))} for m, v in sorted(bym.items())}
# weekday vs weekend (by wake date = data_date+1 roughly; use data_date weekday)
wk = collections.defaultdict(list)
for s_ in valid:
    wd = date.fromisoformat(s_['date']).weekday(); wk['weekend' if wd >= 4 else 'weekday'].append(s_['dur']/60)  # Fri/Sat nights
out['sleep'] = {
    'n_sessions': len(sessions), 'n_valid': len(valid), 'excluded': [(s_['date'], s_['excluded'], s_['dur']) for s_ in sessions if s_['excluded']],
    'first': valid[0]['date'] if valid else None, 'last': valid[-1]['date'] if valid else None,
    'mean_h': mean(durs), 'median_h': med(durs), 'sd_h': sd(durs), 'min_h': round(min(durs), 2), 'max_h': round(max(durs), 2),
    'n_lt5': sum(1 for d in durs if d < 5) if valid else 0, 'n_lt6': sum(1 for d in durs if d < 6), 'n_lt7': sum(1 for d in durs if d < 7), 'n_ge7': sum(1 for d in durs if d >= 7),
    'deep_pct': mean([pct(s_, 'deep') for s_ in staged]) or 0, 'rem_pct': mean([pct(s_, 'rem') for s_ in staged]) or 0, 'light_pct': mean([pct(s_, 'light') for s_ in staged]) or 0, 'awake_pct': mean([pct(s_, 'awake') for s_ in staged]) or 0,
    'deep_min': mean([s_['deep'] for s_ in staged]), 'rem_min': mean([s_['rem'] for s_ in staged]), 'n_staged': len(staged),
    'bed_median': clock_from_rel(st.median(bed)) if valid else None, 'bed_p25': clock_from_rel(bed_sorted[len(bed)//4]), 'bed_p75': clock_from_rel(bed_sorted[3*len(bed)//4]),
    'bed_sd_min': sd(bed), 'bed_after_1am_pct': round(100*sum(1 for b in bed if b >= 60)/len(bed)), 'bed_after_midnight_pct': round(100*sum(1 for b in bed if b >= 0)/len(bed)),
    'bed_before_23_pct': round(100*sum(1 for b in bed if b < -60)/len(bed)),
    'monthly': monthly, 'weekday_mean_h': mean(wk['weekday']), 'weekend_mean_h': mean(wk['weekend']),
    'by_device': {d_: len([s_ for s_ in valid if s_['device'] == d_]) for d_ in set(s_['device'] for s_ in valid)},
    'sessions': valid,
}

# ---------------- VITALS ----------------
v = [r for r in rows if r['category'] == 'vitals']
rt = [r for r in v if 'bp_systolic' in r['data']]
def series(rs, key): return [(sh(r['recorded_at']), r['data'][key], dev(r)) for r in rs if isinstance(r['data'].get(key), (int, float))]
hrv = series(rt, 'hrv_ms') + series([r for r in v if 'hrv_ms' in r['data'] and 'bp_systolic' not in r['data']], 'hrv_ms')
hrv.sort()
def by_device_stats(ser):
    o = {}
    if not ser: return o
    for d_ in set(x[2] for x in ser):
        xs = [x[1] for x in ser if x[2] == d_]; o[d_] = {'n': len(xs), 'mean': mean(xs), 'median': med(xs), 'sd': sd(xs), 'min': min(xs), 'max': max(xs)}
    return o
def safe(fn, default=None):
    try: return fn()
    except Exception: return default
def daily(ser, agg=st.mean):
    dd = collections.defaultdict(list)
    for t, val, d_ in ser: dd[t.strftime('%Y-%m-%d')].append(val)
    return {k: round(agg(vv), 1) for k, vv in sorted(dd.items())}
def hourly(ser):
    hh = collections.defaultdict(list)
    for t, val, d_ in ser: hh[t.hour].append(val)
    return {h: round(st.mean(vv), 1) for h, vv in sorted(hh.items())}
out['hrv'] = {'n': len(hrv), 'by_device': by_device_stats(hrv), 'daily': daily(hrv), 'hourly': hourly(hrv), 'all': {'mean': mean([x[1] for x in hrv]), 'sd': sd([x[1] for x in hrv]), 'median': med([x[1] for x in hrv])}}
# weekly HRV (halo only)
wkh = collections.defaultdict(list)
for t, val, d_ in hrv:
    wkh[t.strftime('%G-W%V')].append(val)
out['hrv']['weekly'] = {k: (round(st.mean(vv), 1), len(vv)) for k, vv in sorted(wkh.items())}

hrr = series(rt, 'heart_rate_hrv')
out['hr_realtime'] = {'n': len(hrr), 'by_device': by_device_stats(hrr), 'hourly': hourly(hrr), 'daily': daily(hrr), 'all': {'mean': mean([x[1] for x in hrr]), 'median': med([x[1] for x in hrr]), 'min': min([x[1] for x in hrr]) if hrr else None, 'max': max([x[1] for x in hrr]) if hrr else None}}
stress = series(rt, 'stress') + series([r for r in v if 'stress' in r['data'] and 'bp_systolic' not in r['data']], 'stress')
out['stress'] = {'n': len(stress), 'by_device': by_device_stats(stress), 'hourly': hourly(stress), 'daily': daily(stress), 'all': {'mean': mean([x[1] for x in stress]), 'median': med([x[1] for x in stress])},
                 'dist': {'low<30': sum(1 for x in stress if x[1] < 30), '30-59': sum(1 for x in stress if 30 <= x[1] < 60), '60-79': sum(1 for x in stress if 60 <= x[1] < 80), '80+': sum(1 for x in stress if x[1] >= 80)}}
br = series(rt, 'breath_rate')
out['breath'] = {'n': len(br), 'by_device': by_device_stats(br), 'hourly': hourly(br)}
bps = series(rt, 'bp_systolic'); bpd = series(rt, 'bp_diastolic')
out['bp'] = {'n': len(bps), 'sys': by_device_stats(bps), 'dia': by_device_stats(bpd), 'sys_hourly': hourly(bps), 'dia_hourly': hourly(bpd),
             'sys_dist': collections.Counter(x[1] for x in bps).most_common(), 'dia_dist': collections.Counter(x[1] for x in bpd).most_common(),
             'sys_range': (min(x[1] for x in bps), max(x[1] for x in bps)) if bps else None, 'dia_range': (min(x[1] for x in bpd), max(x[1] for x in bpd)) if bpd else None}
sp = series(v, 'spo2')
out['spo2'] = {'n': len(sp), 'by_device': by_device_stats(sp), 'dist': sorted(collections.Counter(x[1] for x in sp).items()), 'daily': daily(sp), 'hourly': hourly(sp), 'all': {'mean': mean([x[1] for x in sp]), 'median': med([x[1] for x in sp]), 'min': min([x[1] for x in sp]) if sp else None},
               'pct_lt94': round(100*sum(1 for x in sp if x[1] < 94)/len(sp), 1) if sp else 0, 'pct_lt90': round(100*sum(1 for x in sp if x[1] < 90)/len(sp), 1) if sp else 0}
tp = [r for r in v if 'body_temp_c' in r['data']]
bt = series(tp, 'body_temp_c'); skt = series(tp, 'skin_temp_c')
out['temp'] = {'n': len(bt), 'body': by_device_stats(bt), 'skin': by_device_stats(skt), 'body_hourly': hourly(bt), 'skin_hourly': hourly(skt), 'body_daily': daily(bt), 'skin_daily': daily(skt), 'all': {'mean': mean([x[1] for x in bt])},
               'body_dist': sorted(collections.Counter(round(x[1]) for x in bt).items()), 'pct_body_lt35': round(100*sum(1 for x in bt if x[1] < 35)/len(bt), 1) if bt else 0}
# HR slots → daily resting (min of 5-min slots between 01:00-06:00), daily mean, nightly min
hr = [r for r in v if 'hr_slots' in r['data'] or 'resting_hr' in r['data']]
slots = []
for r in hr:
    for s_ in (r['data'].get('hr_slots') or []):
        if isinstance(s_.get('bpm'), (int, float)) and s_['bpm'] > 30: slots.append((sh(s_['t']), s_['bpm'], dev(r)))
slots.sort()
dd = collections.defaultdict(list)
for t, b, d_ in slots: dd[t.strftime('%Y-%m-%d')].append((t.hour, b))
hr_daily = {}
for k, vv in sorted(dd.items()):
    night = [b for h, b in vv if 1 <= h < 6]; day = [b for h, b in vv if 9 <= h < 22]
    hr_daily[k] = {'n': len(vv), 'mean': round(st.mean([b for h, b in vv]), 1), 'night_min': min(night) if night else None, 'night_mean': round(st.mean(night), 1) if night else None,
                   'day_mean': round(st.mean(day), 1) if day else None, 'max': max(b for h, b in vv), 'resting_field': None}
for r in hr:
    k = r['data_date']
    if k in hr_daily: hr_daily[k]['resting_field'] = r['data'].get('resting_hr')
out['hr_slots'] = {'n_slots': len(slots), 'n_days': len(hr_daily), 'daily': hr_daily, 'hourly': hourly(slots),
                   'resting_field_values': sorted([(r['data_date'], r['data'].get('resting_hr')) for r in hr]),
                   'night_min_mean': mean([x['night_min'] for x in hr_daily.values() if x['night_min']]),
                   'night_mean_mean': mean([x['night_mean'] for x in hr_daily.values() if x['night_mean']]),
                   'day_mean_mean': mean([x['day_mean'] for x in hr_daily.values() if x['day_mean']]),
                   'dist': sorted(collections.Counter((b // 10) * 10 for t, b, d_ in slots).items())}

# ---------------- ACTIVITY ----------------
act = [r for r in rows if r['category'] == 'activity']
steps = {r['data_date']: r['data'].get('steps') or 0 for r in act}
out['activity'] = {'n_days': len(steps), 'daily': dict(sorted(steps.items())), 'mean': mean(list(steps.values())), 'median': med(list(steps.values())),
                   'n_ge5000': sum(1 for s_ in steps.values() if s_ >= 5000), 'n_lt1000': sum(1 for s_ in steps.values() if s_ < 1000), 'max': max(steps.values()) if steps else 0,
                   'hourly_steps': None}
hs = collections.defaultdict(int)
for r in act:
    for s_ in r['data'].get('slots') or []:
        hs[sh(s_['t']).hour] += s_.get('steps') or 0
out['activity']['hourly_steps'] = dict(sorted(hs.items()))

# coverage: days with any vitals
cov = collections.Counter(r['data_date'] for r in v) or collections.Counter({'0000-00-00': 0})
out['coverage'] = {'first': min(cov), 'last': max(cov), 'n_days_with_vitals': len(cov), 'rows_per_day': dict(sorted(cov.items())),
                   'by_device_rows': collections.Counter(dev(r) for r in v), 'by_device_days': {d_: len(set(r['data_date'] for r in v if dev(r) == d_)) for d_ in set(dev(r) for r in v)}}

json.dump(out, open(os.path.join(HERE, 'data', 'wearable.json'), 'w'), ensure_ascii=False, indent=1, default=str)
s = out['sleep']
print(HERE.split('/')[-1], 'sleep', s['n_valid'], 'mean', s['mean_h'], 'bed', s['bed_median'], '| hrv', out['hrv']['n'], '| rt', out['hr_realtime']['n'], '| spo2', out['spo2']['n'], '| steps days', out['activity']['n_days'], '| hr slots', out['hr_slots']['n_slots'], 'night', out['hr_slots']['night_mean_mean'], '| resting field', len(out['hr_slots']['resting_field_values']))
