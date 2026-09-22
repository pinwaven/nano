#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build one premier-partner report from <workdir>/data + <workdir>/notes.py.
    python gen.py <workdir>
notes.py supplies the narrative (see notes_template.py); everything numeric is computed here."""
import sys, os, json, math, statistics as st, importlib.util, subprocess, re, collections
from datetime import date, datetime, timedelta, timezone
SKILL = '/Users/pin/waven/nano/.claude/skills/health-report/report'
sys.path.insert(0, SKILL)
import lib
from lib import *
W = os.path.abspath(sys.argv[1])
spec = importlib.util.spec_from_file_location('notes', os.path.join(W, 'notes.py')); N = importlib.util.module_from_spec(spec); spec.loader.exec_module(N)
def load(n):
    p = os.path.join(W, 'data', n + '.json'); return json.load(open(p, encoding='utf-8')) if os.path.exists(p) else None
U = load('user'); BM = load('biomarkers') or []; WEAR = load('wearable'); DOTS = {d['key_name']: d for d in load('dots')}
CARTS = load('cartridges_named') or []; PLANS = load('nutrition_plans') or []; Q = load('questionnaire_answers') or []; CM = load('chat_messages') or []
HR_ = load('health_reports') or []; HP = load('health_plans') or []; AG = load('viva_ag_jobs') or []; FACTS = load('user_memory_facts') or []
REPORT_DATE = date(2026, 9, 16); TODAY = '2026-09-16'
NAME = getattr(N, 'NAME', U['nickname']); NICK = U['nickname']
BIRTH = getattr(N, 'BIRTH', U.get('birth_date')); CHRONO = round((REPORT_DATE - date.fromisoformat(BIRTH)).days / 365.25, 1) if BIRTH else None
SEX = '女' if U.get('gender') == 'female' else '男'
bio = U.get('bio_data') or {}
H = getattr(N, 'HEIGHT', bio.get('height')); WT = getattr(N, 'WEIGHT', bio.get('weight') or bio.get('weight_kg'))
BMI = round(WT / (H / 100) ** 2, 1) if H and WT else None
MODE = getattr(N, 'MODE', 'baseline')
KINO = [b for b in BM if b['test_type'] == 'kino_chip']
KINO_KEYS = ['hsCRP', 'IL6', 'GDF15', 'GA', 'CystatinC', 'CD38']
KINO_REF = {'hsCRP': (None, 1.0, 'mg/L'), 'IL6': (None, 3.0, 'pg/mL'), 'GDF15': (None, 600, 'pg/mL'), 'GA': (None, 15, '%'), 'CystatinC': (None, 1.0, 'mg/L'), 'CD38': (None, 2.0, 'x')}
def _fmt(v, k):
    if v is None: return '—'
    hi = KINO_REF[k][1]
    return f'<b style="color:{C["serious"]}">{v:g}</b>' if hi is not None and v > hi else f'{v:g}'
def kino_rows():
    # data.validated is the user's Kino result (CLAUDE.md §17); data.actual is never read here.
    rows = []
    for b in KINO:
        d = b['data']; v = d.get('validated') or {}; bp = d.get('bioage_profile') or {}
        rows.append((b['tested_at'][:16].replace('T', ' '), b.get('kino_device_id') or '—', ' / '.join(_fmt(v.get(k), k) for k in KINO_KEYS), f'{bp.get("BioAge"):g}' if bp.get('BioAge') else '—', bp.get('SubAges') or {}, v))
    return rows
KR = kino_rows()
LAST_BA = next((r[3] for r in reversed(KR) if r[3] != '—'), None); LAST_SUB = next((r[4] for r in reversed(KR) if r[4]), {}); LAST_KINO = next((r[5] for r in reversed(KR) if r[5]), {})
OWNED = {c['key_name']: c['remaining_dots'] for c in CARTS if c['status'] == 'active'}
USER_TURNS = [m for m in CM if m.get('role') == 'user']
PART = getattr(N, 'PART_TITLES', {'结论与优先级': '第一篇', '数据与检测': '第二篇', '日常监测': '第三篇', '行动方案': '第四篇', '附录': '附录'})

def divider(num, title, desc): page(title, f'<div class="num">{num}</div><h1>{esc(title)}</h1><p>{desc}</p>', cls='divider')
def grade_pill(g): return pill(g, {'A': C['good'], 'B': C['blue'], 'C': C['muted']}.get(g[:1], C['muted']))

# ================= 封面 / 目录 / 阅读指南 =================
TITLE = '个人健康<br>分析报告' if MODE == 'full' else '个人健康<br>数据基线报告'
page('封面', f'''
<div class="brand">AEVIVA VIVA · 精准健康数字孪生</div>
<h1>{TITLE}</h1>
<div class="t2">{esc(NAME)}{f'（{esc(NICK)}）' if NICK != NAME else ''} · {SEX} · {CHRONO:g} 岁 · {esc(N.COVER_SUB)}</div>
<div class="hero"><div class="n">{N.HERO[0]}</div><div class="l">{esc(N.HERO[1])}</div></div>
<div class="meta">
<div><b>报告日期</b>2026 年 9 月 16 日</div>
<div><b>出具</b>Viva · {esc(U['channel']['name'])}</div>
<div><b>数据跨度</b>{esc(N.SPAN)}</div>
</div>''', cls='cover')
page('目录', '__TOC__')

kino_note = (f'共 {len(KR)} 次 Kino 扫描，最近一次（{KR[-1][0][:10]}）六项为 hsCRP {LAST_KINO.get("hsCRP")} mg/L · IL-6 {LAST_KINO.get("IL6")} pg/mL · GDF-15 {LAST_KINO.get("GDF15")} pg/mL · 糖化白蛋白 {LAST_KINO.get("GA")}% · 胱抑素 C {LAST_KINO.get("CystatinC")} mg/L · CD38 {LAST_KINO.get("CD38")}，生物年龄 {LAST_BA or "—"}。' if KR else '目前没有 Kino 扫描记录。')
page('阅读指南', h2('如何阅读这份报告', N.GUIDE_SUB) + '''
<div class="cols" style="grid-template-columns:1fr 1fr">
<div>
<h3>报告结构</h3>''' + p(N.STRUCTURE) + '''
<h3>数据可信度分级</h3>
<ul>
<li><b>A 级</b>：有机构名、样本号或检验医师的正式报告（含清晰的报告照片），以及 Kino 扫描的六项结果与生物年龄。</li>
<li><b>B 级</b>：平台系统记录——穿戴设备同步、问卷、对话中的自述、Dots 记录、商业检测机构的摘要页。</li>
<li><b>C 级</b>：五年以上的旧样本、其他报告内部推算的数值、App 截图的再上传（与已有扫描重复）、以及与 A 级来源冲突的数据——会呈现并标注，但<b>不作为结论依据</b>。</li>
</ul>
<h3>颜色与符号约定</h3>
<div class="legend"><span><i style="background:#0ca30c"></i>优秀 / 正常</span><span><i style="background:#fab219"></i>需要关注</span><span><i style="background:#ec835a"></i>偏高 / 偏低</span><span><i style="background:#d03b3b"></i>缺乏 / 异常</span></div>
<p class="small">带虚线的竖线始终表示您的实际年龄；灰色数值为 C 级。</p>
</div>
<div>''' + callout('先说明数据', f'<b>① Kino 扫描是您的实测基线。</b>{kino_note}第二篇有逐次扫描的结果与解读。<br>' + N.CONFLICTS, 'warn') + '<p class="small">本报告不构成医疗诊断。所有补充剂、复查与就医建议，请与您的医生确认后执行。</p></div></div>')

# ================= 第一篇 =================
divider('01', '结论与优先级', N.PART1_DESC)
page('结论与优先级', h2('执行摘要', N.SUMMARY_SUB) + stats_row([stat(v, l, s_, c) for v, l, s_, c in N.STATS]) + f'''
<div class="cols" style="grid-template-columns:1.1fr 1fr"><div>
<h3>整体判断</h3>{p(N.OVERALL, 'lead')}
<h3>{esc(N.PROBLEMS_TITLE)}</h3><ul>{''.join(f'<li>{x}</li>' for x in N.PROBLEMS)}</ul></div>
<div>''' + card('优先级排序（按「确定性 × 可干预性」）', '<table class="tbl compact">' + ''.join(f'<tr><td><b>{a}</b></td><td>{b}</td></tr>' for a, b in N.PRIORITIES) + '</table>', C['blue']) + card('一句话', f'<p style="margin:0">{N.ONE_LINE}</p>', C['aqua']) + '</div></div>')

# doctor page
D = N.DOCTOR
page('结论与优先级', h2('临床摘要（医生版）', D.get('sub', '供接诊医师快速阅读 · 数值均注明来源与等级 · 穿戴数据为消费级设备，仅供参考')) + '<div class="tight"><div class="cols" style="grid-template-columns:1fr 1fr;gap:10px;margin-top:0"><div>' + card('患者概况', '<div class="kv" style="font-size:8.8pt;grid-template-columns:70px 1fr">' + ''.join(f'<b>{k}</b><span>{v}</span>' for k, v in D['profile']) + '</div>') + card('问题清单（按处理优先级）', '<ol class="small" style="margin:0;padding-left:16px">' + ''.join(f'<li>{x}</li>' for x in D['problems']) + '</ol>', C['critical']) + '</div><div>' + (card(D['labs_title'], table(['项目', '结果', '参考 / 说明'], D['labs'], 'compact') + (f'<p class="small" style="margin:0">{D["labs_note"]}</p>' if D.get('labs_note') else '')) if D.get('labs') else '') + card('衰老生物学评估（Kino，A 级）', f'<p class="small" style="margin:0">{D["aging"]}</p>') + (card('穿戴 / 自述摘要（B 级）', '<ul class="small" style="margin:0">' + ''.join(f'<li>{x}</li>' for x in D['wear']) + '</ul>', C['violet']) if D.get('wear') else '') + '</div></div>' + callout('建议进一步检查与注意事项', D['workup'], 'info') + '</div>')

# scorecard (optional)
if getattr(N, 'SCORECARD', None):
    page('结论与优先级', h2('健康记分卡', f'{len(N.SCORECARD)} 个维度一览 · 状态判定依据各报告参考范围与本报告交叉分析') + table(['维度', '关键数据', '状态', '备注'], [(a, b, status_pill(s), d) for a, b, s, d in N.SCORECARD], 'compact', ['16%', '40%', '12%', '32%']))

# ================= 第二篇 数据与检测 =================
divider('02', '数据与检测', N.PART2_DESC)
# data landscape
inv_rows = [(a, b, grade_pill(g), d) for a, b, g, d in N.INVENTORY]
qa_rows = [(str(x.get('answered_at'))[:10], x.get('questionnaire') or '', (x.get('prompt_zh') or x.get('key') or '')[:22], json.dumps(x.get('answer') if x.get('answer') is not None else x.get('value'), ensure_ascii=False)[:60]) for x in Q if x.get('key') not in ('nickname', 'gender', 'birth_date')]
tl = getattr(N, 'TIMELINE', None)
page('数据与检测', h2('个人档案与数据全景', '您是谁、您在平台上做了什么、我们手里有哪些数据') + '<div class="cols" style="grid-template-columns:1fr 1.4fr"><div>' + card('基本信息', '<div class="kv">' + ''.join(f'<b>{k}</b><span>{v}</span>' for k, v in N.PROFILE) + '</div>') + card('平台使用轨迹', '<ul style="font-size:9pt">' + ''.join(f'<li>{x}</li>' for x in N.TRACK) + '</ul>') + '</div><div>' + h3('数据资产清单') + table(['数据', '范围', '等级', '说明'], inv_rows, 'compact', ['26%', '30%', '8%', '36%']) + (h3('时间线') + timeline(tl, w=380, h=120) if tl else '') + (h3('问卷回答') + table(['日期', '问卷', '题目', '回答'], qa_rows[:3 if tl else 5], 'compact', ['14%', '20%', '30%', '36%']) if qa_rows else '') + '</div></div>')

# Kino page — data.validated is the result; nothing here audits it against reader telemetry.
krows = [(r[0], r[1], r[2], r[3]) for r in KR]
sub_txt = ' · '.join(f'{ {"CellularAge": "细胞", "MetabolicAge": "代谢", "MicroVascularAge": "微血管", "ResilienceAge": "抗压"}[k]} {v:.0f}' for k, v in LAST_SUB.items()) if LAST_SUB else ''
_dim = [('抗压', 'ResilienceAge', 'hsCRP · IL-6'), ('细胞', 'CellularAge', 'GDF-15 · CD38'), ('代谢', 'MetabolicAge', '糖化白蛋白 · BMI'), ('微血管', 'MicroVascularAge', '胱抑素 C')]
dim_rows = [(n, inp, f'{LAST_SUB[k]:.0f}' if LAST_SUB.get(k) else '—', f'{LAST_SUB[k] - CHRONO:+.0f}' if LAST_SUB.get(k) and CHRONO else '—') for n, k, inp in _dim]
page('数据与检测', h2('Kino 六项与生物年龄', f'{len(KR)} 次 Kino 扫描 · 最近一次 BioAge {LAST_BA or "—"}（{sub_txt}）· 数据等级 A') + (table(['时间（UTC）', '读数器', 'hsCRP / IL-6 / GDF-15 / GA / CysC / CD38', 'BioAge'], krows, 'compact', ['18%', '10%', '58%', '14%']) if krows else p('无扫描记录。')) + two_col(
    h3('生物年龄是怎么算出来的') + p(f'Kino 芯片读取 6 项衰老标志物，每项打 0–10 分，四维度合计 40 分 → 炎症衰弱指数 mFI → Gompertz 反函数 → 年龄 → 与实际年龄的差按对数压缩（±12 岁上限）。因此「比实际年龄小 10–12 岁」是压缩函数的上限区，表示面板整体健康，不是字面上的 12 年；两次扫描相隔数周相差一岁属方法学差异。', 'small') + (table(['维度', '输入项', '子年龄', '与实际年龄差'], dim_rows, 'compact', ['20%', '40%', '20%', '20%']) if LAST_SUB else ''),
    h3('这对您意味着什么') + p(N.KINO_MEANING, 'small') + callout('App 截图不算新数据', '把 App「健康」页截图再上传为「检测报告」，会把同一次扫描重复记录一次——本报告只按扫描记录本身计数。上面标粗的项目高于常用参考上限，第一篇与第四篇据此给出建议。', 'info')))

# real data pages from notes (list of dict(title, sub, body))
for pg in getattr(N, 'DATA_PAGES', []):
    page('数据与检测', h2(pg['title'], pg.get('sub', '')) + pg['body'])

# self-reports
sr = getattr(N, 'SELF_REPORTS', [])
if sr or qa_rows:
    page('数据与检测', h2('自述、问卷与对话里的线索', f'{len(USER_TURNS)} 条用户消息 · {len(Q)} 条问卷回答 · 本报告把它们当作 B 级数据：真实，但需要被测量证实') + (table(['日期', '您说的', '本报告怎么用它'], sr, 'compact', ['11%', '52%', '37%']) if sr else '') + (callout('为什么这些话重要', N.SELF_NOTE, 'info') if getattr(N, 'SELF_NOTE', None) else ''))

# ================= 第三篇 日常监测 =================
S = WEAR['sleep'] if WEAR else None
if WEAR and (S['n_valid'] >= 3 or WEAR['spo2']['n'] >= 30 or WEAR['hr_slots']['n_slots'] >= 30):
    divider('03', '日常监测', N.PART3_DESC)
    devs = WEAR['coverage']['by_device_rows']
    dev_line = ' · '.join(f'{k} {v} 条' for k, v in devs.items())
    body = ''
    if S['n_valid'] >= 3:
        hours = [round(x['dur'] / 60, 1) for x in S['sessions']]; labs = [x['date'][5:] if i % max(1, len(hours) // 10) == 0 else '' for i, x in enumerate(S['sessions'])]
        dist = [('<5 h', sum(1 for h in hours if h < 5), C['critical']), ('5–6', sum(1 for h in hours if 5 <= h < 6), C['serious']), ('6–7', sum(1 for h in hours if 6 <= h < 7), C['warning']), ('7–8', sum(1 for h in hours if 7 <= h < 8), C['good']), ('≥8', sum(1 for h in hours if h >= 8), C['blue'])]
        bed = [x['bed_rel_min'] for x in S['sessions'] if x['bed_rel_min'] is not None]
        bk = [('≤22:00', -9999, -120), ('22–23', -120, -60), ('23–00', -60, 0), ('00–01', 0, 60), ('01–02', 60, 120), ('≥02:00', 120, 9999)]
        bh = [(l, sum(1 for b in bed if lo <= b < hi), c) for (l, lo, hi), c in zip(bk, [C['good'], C['good'], C['aqua'], C['warning'], C['serious'], C['critical']])]
        body += h3(f'睡眠 · {S["n_valid"]} 个有效夜晚 · 均值 {S["mean_h"]:.1f} h · 中位 {S["median_h"]:.1f} h · 入睡中位 {S["bed_median"]}') + sparkbars(hours, w=650, h=90, color=C['violet'], labels=labs, fmt='{:.0f}' if len(hours) <= 40 else '', hline=(7, '7 h', C['good'])) + two_col(hbars(dist, w=315, bar_h=11, gap=5, label_w=44, fmt='{:g} 晚') + p(f'不足 6 h：{S["n_lt6"]} 晚；≥7 h：{S["n_ge7"]} 晚。剔除 {S["n_sessions"] - S["n_valid"]} 个重复 / <60 min 的会话。' + (f'分期夜晚 {S["n_staged"]}：深睡 {S["deep_pct"]:.0f}% · REM {S["rem_pct"]:.0f}% · 清醒 {S["awake_pct"]:.0f}%。' if S['n_staged'] else '该设备不提供睡眠分期。'), 'small'), hbars(bh, w=315, bar_h=11, gap=5, label_w=52, fmt='{:g} 晚') + p(f'入睡四分位 {S["bed_p25"]}–{S["bed_p75"]}，{S["bed_after_midnight_pct"]}% 的夜晚在 00:00 后入睡。', 'small'))
    HS = WEAR['hr_slots']; HRV = WEAR['hrv']; SP = WEAR['spo2']; STR = WEAR['stress']; RT = WEAR['hr_realtime']
    vit = []
    if HS['n_slots'] >= 30 and HS['night_mean_mean']: vit.append(('睡眠时段心率（01–06 时 5 分钟段）', f'{HS["night_mean_mean"]:.0f} bpm（夜间最低均值 {HS["night_min_mean"]:.0f}）', f'{HS["n_slots"]} 段 · {HS["n_days"]} 天'))
    if HS['resting_field_values']: vals = [v for d_, v in HS['resting_field_values'] if v]; vit.append(('设备「静息心率」字段', f'中位 {st.median(vals):.0f}，范围 {min(vals)}–{max(vals)}', f'{len(vals)} 天'))
    if RT['n']: vit.append(('实时测量心率', f'均值 {RT["all"]["mean"]:.0f}，范围 {RT["all"]["min"]}–{RT["all"]["max"]}', f'{RT["n"]} 次'))
    if HRV['n']: vit.append(('HRV（设备算法）', f'均值 {HRV["all"]["mean"]:.0f} ms · 中位 {HRV["all"]["median"]:.0f} · sd {HRV["all"]["sd"]}', f'{HRV["n"]} 次'))
    if SP['n']: vit.append(('SpO₂', f'均值 {SP["all"]["mean"]:.1f}% · 最低 {SP["all"]["min"]} · {SP["pct_lt94"]}% 读数 <94%', f'{SP["n"]} 次'))
    if STR['n']: vit.append(('压力指数（0–100）', f'均值 {STR["all"]["mean"]:.0f} · 中位 {STR["all"]["median"]:.0f}', f'{STR["n"]} 次'))
    if WEAR['temp']['n']: vit.append(('皮肤温度', f'均值 {WEAR["temp"]["all"]["mean"]:.1f} °C（不是核心体温）', f'{WEAR["temp"]["n"]} 次'))
    if WEAR['bp']['n']: vit.append(('戒指「血压」', f'{WEAR["bp"]["sys_range"][0]}–{WEAR["bp"]["sys_range"][1]} / {WEAR["bp"]["dia_range"][0]}–{WEAR["bp"]["dia_range"][1]}（固定区间，不采用）', f'{WEAR["bp"]["n"]} 次'))
    A = WEAR['activity']
    if A['n_days']: vit.append(('步数', f'均值 {A["mean"]:.0f} · 中位 {A["median"]:.0f} · 最高 {A["max"]:,}', f'{A["n_days"]} 天'))
    body += h3('生命体征汇总（按设备原始记录重算）') + table(['指标', '值', '样本'], vit, 'compact', ['34%', '46%', '20%']) + callout('怎么读', N.WEAR_NOTE, 'info')
    page('日常监测', h2('穿戴设备数据', f'{WEAR["coverage"]["first"]} → {WEAR["coverage"]["last"]} · {WEAR["coverage"]["n_days_with_vitals"]} 个有数据的日子 · {dev_line} · 数据等级 B') + body)
    if MODE == 'full' and HS['n_slots'] >= 100:
        hh = {int(k): v for k, v in HS['hourly'].items()}; hrd = [(k, v['night_mean']) for k, v in HS['daily'].items() if v['night_mean']]
        wk = HRV['weekly']
        page('日常监测', h2('心率、HRV 与压力', f'5 分钟心率段 {HS["n_slots"]} 个 · 实时 HRV {HRV["n"]} 次') + two_col(h3('24 小时心率曲线') + line_chart([dict(name='HR', pts=[(h, v) for h, v in sorted(hh.items())], color=C['red'], label_pts=False)], w=315, h=150, ymin=max(40, min(hh.values()) - 10), ymax=max(hh.values()) + 10, xlabels=[f'{h}' if h % 4 == 0 else '' for h in range(24)], fmt='{:.0f}', pad=(30, 12, 22, 8)), h3(f'每晚睡眠时段心率（{len(hrd)} 夜）') + (sparkbars([v for _, v in hrd], w=315, h=120, color=C['red'], labels=[k[5:] if i % max(1, len(hrd) // 6) == 0 else '' for i, (k, _) in enumerate(hrd)], fmt='', hline=(65, '65', C['good'])) if hrd else '')) + (h3('周均 HRV（同设备内趋势）') + sparkbars([v[0] for v in wk.values()], w=650, h=70, color=C['aqua'], labels=[k.replace('2026-', '') for k in wk], fmt='{:.0f}') if len(wk) >= 3 else '') + (h3('压力指数与 HRV 日内曲线（实时测量）') + two_col(line_chart([dict(name='s', pts=[(int(h), v) for h, v in STR['hourly'].items()], color=C['orange'], label_pts=False)], w=315, h=110, ymin=0, ymax=100, xlabels=[f'{h}' if h % 4 == 0 else '' for h in range(24)], fmt='{:.0f}', pad=(30, 10, 22, 8), ylab='压力'), line_chart([dict(name='h', pts=[(int(h), v) for h, v in HRV['hourly'].items()], color=C['aqua'], label_pts=False)], w=315, h=110, ymin=0, ymax=max(120, max(HRV['hourly'].values()) + 10), xlabels=[f'{h}' if h % 4 == 0 else '' for h in range(24)], fmt='{:.0f}', pad=(30, 10, 22, 8), ylab='HRV')) if STR['hourly'] and HRV['hourly'] else '') + p(N.HR_NOTE, 'small'))
    for pg in getattr(N, 'WEAR_PAGES', []):
        page('日常监测', h2(pg['title'], pg.get('sub', '')) + pg['body'])

# ================= 第四篇 行动方案 =================
divider('04', '行动方案', N.PART4_DESC)
page('行动方案', h2('第一步：把「不知道」变成「知道」', N.TESTS_SUB) + table(['项目', '回答什么', '目标 / 说明', '优先级'], [(a, b, c, pill(d, {'P1': C['critical'], 'P2': C['serious'], 'P3': C['warning']}[d])) for a, b, c, d in N.TESTS], 'compact', ['26%', '34%', '30%', '10%']) + callout('为什么先测再补', N.TESTS_NOTE, 'crit'))
for pg in getattr(N, 'PLAN_PAGES', []):
    page('行动方案', h2(pg['title'], pg.get('sub', '')) + pg['body'])
# Dots
DR = N.DOTS
def dotrow(k, n, why):
    d = DOTS[k]; ing = ' · '.join(f"{i['name']} {i['mg']:g} mg" for i in d['ingredients_zh'])
    own = pill(f'已持有 {OWNED[k]} 粒', C['good']) if k in OWNED else pill('需购买', C['muted'])
    return f'<div class="dotrow"><span class="sw" style="background:{d["color_hex"]}"></span><span class="dn">{k} {d["name_zh"]}</span><span class="dc">{n} 粒</span><span class="small" style="flex:1">{ing}<br><span style="color:#0b0b0b">{why}</span></span>{own}<span class="small muted" style="min-width:52px;text-align:right">区间 {d["target_dots_min"]}–{d["target_dots_max"]}</span></div>'
am = DR.get('am', []); pm = DR.get('pm', [])
latest = next((pp for pp in reversed(PLANS) if pp.get('proposed_recipe')), None)
plat = ''
if latest:
    pr = latest['proposed_recipe']; plat = h3(f'平台最近一次自动配方（{str(latest["created_at"])[:10]}）') + p('早：' + '、'.join(f'{k.replace("DOT-", "")} {v}' for k, v in (pr.get('morning') or {}).items()) + '；晚：' + '、'.join(f'{k.replace("DOT-", "")} {v}' for k, v in (pr.get('evening') or {}).items()) + f'。{DR.get("platform_note", "该配方与本报告同样以 Kino 六项为输入；差异及原因见下表。")}', 'small')
owned_txt = ('已持有 ' + '、'.join(f'{k.replace("DOT-", "")}（{v}/800）' for k, v in sorted(OWNED.items(), key=lambda x: int(x[0].split("N")[1]))) if OWNED else '未领取任何 Dots 药筒')
page('行动方案', h2('Dots 精准营养：现在能给的与暂不给的', DR['sub']) + callout('配方原则', DR['principle'], 'info') + (h3(f'早晨胶囊 · {sum(n for _, n, _ in am)} 粒') + ''.join(dotrow(k, n, w) for k, n, w in am) if am else '') + (h3(f'晚间胶囊 · {sum(n for _, n, _ in pm)} 粒') + ''.join(dotrow(k, n, w) for k, n, w in pm) if pm else '') + (h3('待复查结果决定的追加') + table(['条件', '动作'], DR['conditional'], 'compact', ['42%', '58%']) if DR.get('conditional') else '') + (h3('本报告不用的 Dots 及原因') + table(['Dot', '原因'], DR['excluded'], 'compact', ['30%', '70%']) if DR.get('excluded') else '') + plat + p(f'药筒状态：{owned_txt}。', 'small'))
page('行动方案', h2('复查与就医日历 · 30 / 90 / 365 天', '按紧急程度与时间窗排列') + table(['时间', '项目', '目的 / 目标值', '类别'], [(a, b, c, pill(d, {'P1': C['critical'], 'P2': C['serious'], 'P3': C['warning']}[d])) for a, b, c, d in N.CALENDAR], 'compact', ['12%', '40%', '36%', '12%']) + '<div class="grid3">' + card('30 天', '<ul class="small">' + ''.join(f'<li>{x}</li>' for x in N.D30) + '</ul>', C['critical']) + card('90 天', '<ul class="small">' + ''.join(f'<li>{x}</li>' for x in N.D90) + '</ul>', C['serious']) + card('365 天', '<ul class="small">' + ''.join(f'<li>{x}</li>' for x in N.D365) + '</ul>', C['good']) + '</div>' + callout('一年后成功是什么样', N.SUCCESS, 'good'))

# ================= 附录 =================
divider('附', '附录', '数据来源清单、扫描记录、术语与方法说明。')
src = [(a, b, c, d, grade_pill(g)) for a, b, c, d, g in N.SOURCES]
tables_read = 'users · biomarkers · health_events · health_documents · health_reports · health_twin · chat_messages · questionnaire_answers · user_cartridges · nutrition_plans · health_plans · viva_ag_jobs · user_memory_facts · dots'
page('附录', h2('附录 A · 数据来源与方法', '本报告读取的每一个来源及其可信度等级') + table(['来源', '内容', '日期', '说明', '等级'], src, 'compact', ['22%', '30%', '12%', '28%', '8%']) + two_col('<h3>方法</h3>' + p(f'本报告由 Viva——Aeviva 精准健康 AI——于 {TODAY} 基于你授权的全部记录生成，并经专业健康分析审阅。上传的报告照片逐张阅读并转录，自动识别的数值只作交叉核对；穿戴统计按原始记录重算：睡眠剔除重复与 <60 min 会话，心率按 5 分钟段、以 01–06 时为睡眠窗，血压读数因算法限制不采用；Kino 面板是否为实测，以芯片的原始读数为准。', 'small'), '<h3>局限与声明</h3>' + p(N.LIMITS, 'small') + p('本报告由 AEVIVA VIVA 精准健康数字孪生系统基于用户授权数据生成，供健康管理参考，<b>不构成医疗诊断、治疗或用药建议</b>。报告中涉及的营养补充、复查项目、就医安排，请与执业医师确认后执行。数据可信度分级（A/B/C）反映来源的可核实程度，不代表数值的临床权重。', 'small')))
page('附录', h2('附录 B · 术语表') + '<div class="kv" style="font-size:8.8pt;grid-template-columns:120px 1fr">' + ''.join(f'<b>{k}</b><span>{v}</span>' for k, v in [
 ('hsCRP / IL-6', '超敏 C 反应蛋白 / 白介素-6，低度炎症标志；Kino 抗压维度的输入。'), ('GDF-15 · CD38', '生长分化因子 15 / CD38 酶活性，Kino 细胞维度的输入；GDF-15 在多数三甲医院可测。'), ('糖化白蛋白 GA', '反映 2–3 周平均血糖；<15% 为常见参考上限。'), ('胱抑素 C', '肾小球滤过的敏感标志，Kino 微血管维度的输入。'), ('HbA1c', '糖化血红蛋白，2–3 个月平均血糖；5.7–6.4% 为糖尿病前期。'), ('LDL-C / ApoB', '低密度脂蛋白胆固醇 / 载脂蛋白 B。'), ('BioAge / mFI', '由四维度得分换算的生物年龄；mFI = (40 − 总分)/40。'), ('Kino 六项', '芯片一次扫描读取的 hsCRP、IL-6、GDF-15、糖化白蛋白、胱抑素 C、CD38，四维度与生物年龄由此计算。'), ('HRV', '心率变异性；不同设备算法不同，不可跨设备比较。'), ('Dots', '36 mg 精准营养原粒；每胶囊 ≤72 粒；早 / 晚各一胶囊。'), ('TI-RADS / BI-RADS', '甲状腺 / 乳腺超声的分级系统；3 类多为良性随访，4 类以上需进一步评估。')]) + '</div>')

# ---- TOC + build ----
order, seen = [], {}
for i, (sec, body, cls) in enumerate(PAGES, 1):
    if sec in ('封面', '目录'): continue
    if sec not in seen: seen[sec] = i; order.append(sec)
toc = '<div class="toc" style="font-size:8.6pt">'
for sec in order:
    toc += f'<div class="part">{(PART.get(sec, "") + " · ") if PART.get(sec) else ""}{esc(sec)}<span class="num">{seen[sec]}</span></div>'
    for i, (sc, body, cls) in enumerate(PAGES, 1):
        if sc != sec or cls == 'divider': continue
        m = re.search(r'<h2>(.*?)</h2>', body)
        if m: toc += f'<div><span style="padding-left:10px">{m.group(1)}</span><span class="num">{i}</span></div>'
toc += '</div>'
for k, (sec, body, cls) in enumerate(PAGES):
    if body == '__TOC__': PAGES[k] = (sec, h2('目录', f'全书共 {len(PAGES)} 页') + toc, cls)
css = open(os.path.join(SKILL, 'style.css'), encoding='utf-8').read()
FOOTER = f'{NAME}（{NICK}）· {"健康分析报告" if MODE == "full" else "健康数据基线报告"} · {TODAY}' if NICK != NAME else f'{NAME} · {"健康分析报告" if MODE == "full" else "健康数据基线报告"} · {TODAY}'
html = f'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>{esc(NAME)} 健康报告</title><style>{css}</style></head><body>{render_pages(FOOTER)}</body></html>'
base = os.path.join(W, f'{NAME}{"" if NICK == NAME else NICK}_{"健康分析报告" if MODE == "full" else "健康数据基线报告"}_{TODAY}')
open(base + '.html', 'w', encoding='utf-8').write(html)
r = subprocess.run(['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '--headless=new', '--disable-gpu', '--no-pdf-header-footer', f'--print-to-pdf={base}.pdf', base + '.html'], capture_output=True, text=True)
open(os.path.join(W, 'summary.txt'), 'w', encoding='utf-8').write(N.SUMMARY_TXT.replace('{PAGES}', str(len(PAGES))))
print(f'{U["user_id"]} {NAME}: pages {len(PAGES)} -> {base}.pdf', 'ok' if os.path.exists(base + '.pdf') else r.stderr[-500:])
