#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Print everything worth reading for one extracted user, compactly. usage: digest.py <workdir>"""
import json, os, sys, collections
W = sys.argv[1]
def load(n):
    p = os.path.join(W, 'data', n + '.json'); return json.load(open(p, encoding='utf-8')) if os.path.exists(p) else None
u = load('user'); print(f"### {u['user_id']} {u['nickname']} · {u['gender']} · born {u['birth_date']} · channel {u['channel']['key_name']} · wearable {u.get('wearable_brand')} {u.get('wearable_name') or ''} · created {str(u['created_at'])[:10]} · roles {u.get('roles')} · coach_id {u.get('coach_id')} · lang {u.get('language')}")
print('bio_data:', json.dumps(u.get('bio_data'), ensure_ascii=False)); print('preferences:', json.dumps(u.get('preferences'), ensure_ascii=False)); print('viva_ag_expires', u.get('viva_ag_expires_at'))
for n in ['user_memory_facts']:
    r = load(n)
    if r: print('FACTS:', [(x['category'], x['fact_zh'], x['status']) for x in r])
q = load('questionnaire_answers')
if q:
    print('QUESTIONNAIRE:')
    for x in q: print('  ', str(x.get('answered_at'))[:10], x.get('questionnaire'), '|', x.get('key'), '=>', json.dumps(x.get('answer') if x.get('answer') is not None else x.get('value'), ensure_ascii=False)[:120])
bm = load('biomarkers') or []
k = [b for b in bm if b['test_type'] == 'kino_chip']
print(f'KINO {len(k)} scans; other biomarkers: {collections.Counter(b["test_type"] for b in bm if b["test_type"] != "kino_chip")}')
for b in k:
    d = b['data']; a = d.get('actual') or {}; bp = d.get('bioage_profile') or {}
    print('  ', b['tested_at'][:16], 'dev', b.get('kino_device_id'), 'actual', {kk: round(v, 2) for kk, v in a.items()}, 'BA', bp.get('BioAge'), 'sub', {kk[:4]: round(v) for kk, v in (bp.get('SubAges') or {}).items()}, 'ctx', d.get('context', '')[:20])
for b in bm:
    if b['test_type'] == 'kino_chip': continue
    d = b['data']
    if b['test_type'] == 'lab_import': print('  LAB_IMPORT', b['tested_at'][:10], 'actual', d.get('actual'), 'validated', d.get('validated'), 'BA', (d.get('bioage_profile') or {}).get('BioAge'), 'sub', {k[:4]: round(v) for k, v in ((d.get('bioage_profile') or {}).get('SubAges') or {}).items()})
    elif b['test_type'] in ('health_checkup_report', 'health_photo', 'food_photo'):
        ex = d.get('extracted') or {}
        exs = '; '.join(f"{k}={v.get('value')}{v.get('unit') or ''}[{v.get('flag')}]" for k, v in ex.items()) if isinstance(ex, dict) else str(ex)[:200]
        print('  PHOTO', b['tested_at'][:10], b['test_type'], d.get('report_date') or '', '| extracted:', exs[:400], '| abnormal:', d.get('abnormal_items'), '| analysis:', (d.get('ai_analysis') or '')[:260].replace('\n', ' '))
    else: print('  OTHER', b['tested_at'][:10], b['test_type'], json.dumps(d, ensure_ascii=False)[:200])
hr = load('health_reports')
if hr:
    for r in hr:
        rd = r.get('raw_data') or {}; obs = rd.get('observations') or rd.get('markers') or []
        print('HEALTH_REPORT', r['report_date'], r['source'], r['institution'], r['report_type'], 'status', r.get('status'), 'obs:', json.dumps(obs, ensure_ascii=False)[:600], '| notes:', json.dumps({k: v for k, v in rd.items() if k not in ('observations', 'markers', 'image_url')}, ensure_ascii=False)[:300])
hd = load('health_documents')
if hd: print('DOCS', [(d['id'], d['filename'], d['status']) for d in hd])
ev = load('health_events') or []
c = collections.Counter((e['category'], e.get('source'), e.get('wearable_name')) for e in ev)
if ev:
    dates = sorted(set(e['data_date'] for e in ev)); print(f'EVENTS {len(ev)} · {dates[0]} → {dates[-1]} ·', dict(c))
    for e in ev:
        if e['category'] not in ('sleep', 'activity', 'vitals'): print('  EV', e['data_date'], e['category'], e.get('source'), json.dumps(e['data'], ensure_ascii=False)[:150])
np_ = load('nutrition_plans')
if np_: print('NUTRITION_PLANS', [(p['status'], str(p['created_at'])[:10], p.get('proposed_recipe', {}).get('morning') if p.get('proposed_recipe') else None) for p in np_])
ca = load('cartridges_named')
if ca: print('CARTRIDGES', [(x['key_name'], x['remaining_dots'], x['status']) for x in ca])
hp = load('health_plans')
if hp: print('HEALTH_PLANS', [(p['template_id'], p['status'], str(p['created_at'])[:10]) for p in hp])
pe = load('program_enrollments')
if pe: print('PROGRAMS', [(p['program_id'], p['status'], p['current_day']) for p in pe])
ag = load('viva_ag_jobs')
if ag:
    for j in ag: print('AG', j['status'], j.get('command_key'), str(j.get('created_at'))[:10], (j.get('result_summary') or '')[:400].replace('\n', ' '))
cm = load('chat_messages') or []
us = [m for m in cm if m.get('role') == 'user']
print(f'CHAT user turns {len(us)} / total {len(cm)}')
skip = {'hi', 'hello', '你好', '1', '2', '3', 'ok', '好', '好的', 'h'}
for m in us:
    t = (m.get('content') or '').strip().replace('\n', ' ')
    if t.lower() in skip or t.startswith('MVNS') or t.startswith('KNC') or t == '（图片）': continue
    print('  ', str(m['created_at'])[:10], m.get('persona_type'), '|', t[:160])
ords = load('orders')
if ords: print('ORDERS', [(o['item_key'], o['status'], str(o['created_at'])[:10]) for o in ords])
