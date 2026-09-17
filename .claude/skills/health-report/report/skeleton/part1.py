# -*- coding: utf-8 -*-
# Front matter + 第一篇. Every part file is a plain script that calls page() in reading order;
# build.py loads part*.py sorted by name. Keep `divider` here so later parts can `from part1 import divider`.
import json, os
from lib import *

WORK = os.path.dirname(os.path.abspath(__file__))
def load(name):
    p = os.path.join(WORK, 'data', name + '.json')
    return json.load(open(p, encoding='utf-8')) if os.path.exists(p) else None

USER = load('user')
CHRONO = 0.0   # compute from USER['birth_date'] and the report date

def divider(num, title, desc):
    page(title, f'<div class="num">{num}</div><h1>{esc(title)}</h1><p>{desc}</p>', cls='divider')

# ---------------- 封面 ----------------
page('封面', f'''
<div class="brand">AEVIVA VIVA · 精准健康数字孪生</div>
<h1>个人全维度<br>健康分析报告</h1>
<div class="t2">{esc(USER['nickname'])} · … · 融合 N 份医学检测文件、Kino 生物年龄、…</div>
<div class="hero"><div class="n">39.2</div><div class="l">生物年龄（岁）· 实际 51 · 年轻 11.8 年</div></div>
<div class="meta">
<div><b>报告日期</b>YYYY 年 M 月 D 日</div>
<div><b>环境 / 用户</b>Dev · {esc(USER['user_id'])} · {esc(USER['channel']['key_name'])}</div>
<div><b>数据跨度</b>YYYY-MM → YYYY-MM</div>
</div>
''', cls='cover')

page('目录', '__TOC__')

# ---------------- 阅读指南 (structure · trust grading · legend · data-conflict callout) ----------------
page('阅读指南', h2('如何阅读这份报告', '…') + callout('必须先说明的数据冲突', '…', 'warn'))

# ---------------- 第一篇 ----------------
divider('01', '结论与优先级', '…')
page('结论与优先级', h2('执行摘要', '…') + stats_row([stat('39.2<small style="font-size:11pt"> 岁</small>', 'Kino 生物年龄', '实际 51 岁 · Δ −11.8', C['blue'])]) + '…')
# 临床摘要（医生版）, 健康记分卡, 个人档案与数据全景 …
