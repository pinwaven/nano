#!/usr/bin/env python3
"""
Parse 量康 慢性食物过敏 IgG reports (100- or 120-item) from their pdftotext -layout output.

    python parse_igg.py <outdir>/txt/*IgG*.txt > <outdir>/data/igg.json

Output: {"<report_date>": {"<food>": U/mL, ...}, ...} keyed by 采样日期 (falls back to the file
name). ">400" is stored as 400.0 (the assay ceiling), "<0.1" as 0.0 — keep that in mind when
charting: show them as "≥400" / "<0.1", never as the number.

The grid lines look like `3级  蛋奶类  牛奶  >400   酸奶  >400   ...`; a food name never contains
whitespace, a value is a number possibly prefixed by < or >. Class thresholds printed by the lab:
0 级 <50 · 1 级 50–100 · 2 级 100.1–200 · 3 级 >200.
"""
import re, sys, json, os

LINE = re.compile(r'^\s*(\d)级\s+(\S+)\s+(.*)$')
NUM = re.compile(r'^[<>]?\d+(\.\d+)?$')
DATE = re.compile(r'(?:采样日期|下单日期)[:：]?\s*\n?\s*(\d{4})[/-](\d{1,2})[/-](\d{1,2})')

def parse(text):
    res = {}
    for line in text.split('\n'):
        m = LINE.match(line)
        if not m: continue
        toks = m.group(3).split()
        i = 0
        while i + 1 < len(toks):
            food, val = toks[i], toks[i + 1]
            if NUM.match(val):
                v = float(val.strip('<>'))
                if val.startswith('>'): v = 400.0
                if val.startswith('<'): v = 0.0
                res[food] = v; i += 2
            else: i += 1
    return res

out = {}
for fn in sys.argv[1:]:
    text = open(fn, encoding='utf-8').read()
    m = DATE.search(text)
    key = f'{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}' if m else os.path.basename(fn)
    panel = parse(text)
    if not panel:
        print(f'warning: no rows parsed from {fn}', file=sys.stderr); continue
    out[key] = panel
    print(f'{key}: {len(panel)} foods, {sum(1 for v in panel.values() if v >= 200)} class-3, {sum(1 for v in panel.values() if 100 < v < 200)} class-2, {sum(1 for v in panel.values() if 50 <= v <= 100)} class-1', file=sys.stderr)
json.dump(out, sys.stdout, ensure_ascii=False, indent=0)
