# -*- coding: utf-8 -*-
"""
Build the report PDF from a per-user working directory.

    python build.py <workdir>

<workdir> holds the user-specific content and nothing else:
    meta.py      REPORT_TITLE, FOOTER, OUTPUT_BASENAME, PART_TITLES (section -> '第N篇')
    part*.py     each module calls lib.page(...) in order; sorted by filename (part1, part2, ...)

The framework (lib.py, style.css, this file) stays in the skill directory and is imported from
here, so a fix to a chart helper applies to every future report. Output: <workdir>/<OUTPUT_BASENAME>.html
and .pdf, rendered with headless Google Chrome (PingFang SC is embedded by the print step).
"""
import sys, os, re, glob, importlib.util, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
if len(sys.argv) < 2:
    print(__doc__); sys.exit(1)
WORK = os.path.abspath(sys.argv[1])
sys.path.insert(0, HERE)   # lib
sys.path.insert(0, WORK)   # meta + parts (parts import each other, e.g. `from part1 import divider`)

import lib
from lib import PAGES, render_pages, esc
import meta

for f in sorted(glob.glob(os.path.join(WORK, 'part*.py'))):
    name = os.path.splitext(os.path.basename(f))[0]
    spec = importlib.util.spec_from_file_location(name, f)
    mod = importlib.util.module_from_spec(spec); sys.modules[name] = mod; spec.loader.exec_module(mod)

# ---- TOC: one line per section (from the first page carrying it) + one per page h2 ----
order, seen = [], {}
for i, (sec, body, cls) in enumerate(PAGES, 1):
    if sec in ('封面', '目录'): continue
    if sec not in seen: seen[sec] = i; order.append(sec)
part_titles = getattr(meta, 'PART_TITLES', {})
toc = '<div class="toc" style="font-size:8.6pt">'
for sec in order:
    part = part_titles.get(sec)
    toc += f'<div class="part">{(part + " · ") if part else ""}{esc(sec)}<span class="num">{seen[sec]}</span></div>'
    for i, (sc, body, cls) in enumerate(PAGES, 1):
        if sc != sec or cls == 'divider': continue
        m = re.search(r'<h2>(.*?)</h2>', body)
        if m: toc += f'<div><span style="padding-left:10px">{m.group(1)}</span><span class="num">{i}</span></div>'
toc += '</div>'
toc_body = lib.h2('目录', f'全书共 {len(PAGES)} 页') + toc
for k, (sec, body, cls) in enumerate(PAGES):
    if body == '__TOC__': PAGES[k] = (sec, toc_body, cls)

css = open(os.path.join(HERE, 'style.css'), encoding='utf-8').read()
html = (f'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>{esc(meta.REPORT_TITLE)}</title>'
        f'<style>{css}</style></head><body>{render_pages(meta.FOOTER)}</body></html>')
base = os.path.join(WORK, meta.OUTPUT_BASENAME)
open(base + '.html', 'w', encoding='utf-8').write(html)
chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
r = subprocess.run([chrome, '--headless=new', '--disable-gpu', '--no-pdf-header-footer', f'--print-to-pdf={base}.pdf', base + '.html'],
                   capture_output=True, text=True)
ok = os.path.exists(base + '.pdf')
print(f'pages: {len(PAGES)} | pdf: {base}.pdf | written: {ok}')
if not ok: print(r.stderr[-2000:]); sys.exit(1)
