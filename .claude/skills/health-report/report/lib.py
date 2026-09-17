# -*- coding: utf-8 -*-
"""Page scaffold + SVG chart helpers for the per-user health report (Chinese, A4). See ../SKILL.md."""
import math, html

# ---- palette (dataviz reference instance, light mode) ----
C = dict(
    blue='#2a78d6', orange='#eb6834', aqua='#1baf7a', yellow='#eda100', magenta='#e87ba4',
    green='#008300', violet='#4a3aa7', red='#e34948',
    good='#0ca30c', warning='#fab219', serious='#ec835a', critical='#d03b3b',
    ink='#0b0b0b', ink2='#52514e', muted='#898781', grid='#e1e0d9', axis='#c3c2b7',
    surface='#fcfcfb', plane='#f4f4f1', tint='#eef3fb',
)
SEQ = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b']
DIM = {  # sub-age dimension colours (fixed order, categorical)
    'Cellular': C['blue'], 'Metabolic': C['orange'], 'MicroVascular': C['aqua'], 'Resilience': C['violet'],
}

def esc(s):
    return html.escape(str(s), quote=False)

# ---------------- page scaffolding ----------------
PAGES = []

def page(section, body, cls=''):
    """Append one A4 page. `section` shows in the running header."""
    PAGES.append((section, body, cls))

def render_pages(title_footer):
    out = []
    for i, (section, body, cls) in enumerate(PAGES, 1):
        hdr = '' if cls == 'cover' else f'<div class="hdr"><span class="hdr-l">{esc(section)}</span><span class="hdr-r">{esc(title_footer)}</span></div>'
        ftr = '' if cls == 'cover' else f'<div class="ftr"><span>本报告仅供健康管理参考，不构成医疗诊断或治疗建议</span><span class="pn">{i}</span></div>'
        out.append(f'<section class="page {cls}">{hdr}<div class="body">{body}</div>{ftr}</section>')
    return '\n'.join(out)

# ---------------- small components ----------------
def h2(t, sub=None):
    s = f'<h2>{esc(t)}</h2>'
    if sub: s += f'<p class="sub">{esc(sub)}</p>'
    return s

def h3(t):
    return f'<h3>{esc(t)}</h3>'

def p(t, cls=''):
    return f'<p class="{cls}">{t}</p>'

def callout(title, body, kind='info'):
    icon = {'info': 'ℹ', 'warn': '⚠', 'good': '✓', 'crit': '!'}.get(kind, 'ℹ')
    return f'<div class="callout {kind}"><div class="ci">{icon}</div><div><div class="ct">{esc(title)}</div><div class="cb">{body}</div></div></div>'

def stat(value, label, sub='', color=None, small=False):
    st = f'color:{color}' if color else ''
    return f'<div class="stat {"small" if small else ""}"><div class="sv" style="{st}">{value}</div><div class="sl">{esc(label)}</div>{f"<div class=ss>{esc(sub)}</div>" if sub else ""}</div>'

def stats_row(items):
    return '<div class="stats">' + ''.join(items) + '</div>'

def table(headers, rows, cls='', widths=None):
    th = ''.join(f'<th style="width:{widths[i]}">{h}</th>' if widths else f'<th>{h}</th>' for i, h in enumerate(headers))
    trs = ''
    for r in rows:
        tds = ''.join(f'<td>{c}</td>' for c in r)
        trs += f'<tr>{tds}</tr>'
    return f'<table class="tbl {cls}"><thead><tr>{th}</tr></thead><tbody>{trs}</tbody></table>'

def pill(text, color):
    return f'<span class="pill" style="background:{color}1a;color:{color};border:1px solid {color}55">{esc(text)}</span>'

def status_pill(status):
    m = {'优': (C['good'], '● 优秀'), '正常': (C['good'], '● 正常'), '关注': (C['warning'], '▲ 关注'),
         '偏低': (C['serious'], '▼ 偏低'), '偏高': (C['serious'], '▲ 偏高'), '缺乏': (C['critical'], '✕ 缺乏'), '异常': (C['critical'], '✕ 异常')}
    c, t = m.get(status, (C['muted'], status))
    return f'<span class="pill" style="background:{c}1a;color:{c};border:1px solid {c}55">{t}</span>'

def two_col(left, right, ratio='1fr 1fr'):
    return f'<div class="cols" style="grid-template-columns:{ratio}">{left}<div></div>{right}</div>'.replace('<div></div>', '', 1) if False else f'<div class="cols" style="grid-template-columns:{ratio}"><div>{left}</div><div>{right}</div></div>'

def card(title, body, accent=None):
    a = f'border-top:3px solid {accent}' if accent else ''
    return f'<div class="card" style="{a}"><div class="card-t">{esc(title)}</div>{body}</div>'

# ---------------- SVG helpers ----------------
def _txt(x, y, s, size=10, fill=None, anchor='start', weight=400, extra=''):
    fill = fill or C['ink2']
    return f'<text x="{x:.1f}" y="{y:.1f}" font-size="{size}" fill="{fill}" text-anchor="{anchor}" font-weight="{weight}" {extra}>{esc(s)}</text>'

def svg_open(w, h):
    return f'<svg viewBox="0 0 {w} {h}" width="{w}" height="{h}" xmlns="http://www.w3.org/2000/svg" font-family="PingFang SC, Hiragino Sans GB, sans-serif">'

def hbars(items, w=520, bar_h=14, gap=10, max_v=None, label_w=110, fmt='{:.1f}', color=C['blue'], ref=None, show_val=True):
    """items: list of (label, value, color?) ; ref: (lo, hi) shaded band on the x scale."""
    n = len(items)
    h = n * (bar_h + gap) + 8
    vals = [it[1] for it in items]
    mx = max_v or (max(vals) * 1.15 if vals else 1)
    plot_w = w - label_w - 60
    s = svg_open(w, h)
    if ref:
        lo, hi = ref
        x0 = label_w + plot_w * max(0, lo) / mx; x1 = label_w + plot_w * min(hi, mx) / mx
        s += f'<rect x="{x0:.1f}" y="0" width="{x1 - x0:.1f}" height="{h}" fill="{C["good"]}14"/>'
    for i, it in enumerate(items):
        lab, v = it[0], it[1]; col = it[2] if len(it) > 2 and it[2] else color
        y = i * (bar_h + gap) + 4
        bw = plot_w * min(v, mx) / mx
        s += _txt(label_w - 8, y + bar_h * 0.78, lab, 10, C['ink2'], 'end')
        s += f'<rect x="{label_w}" y="{y}" width="{max(bw,2):.1f}" height="{bar_h}" rx="4" fill="{col}"/>'
        if show_val:
            s += _txt(label_w + bw + 6, y + bar_h * 0.78, fmt.format(v) if isinstance(v, (int, float)) else v, 10, C['ink'], 'start', 500)
    s += f'<line x1="{label_w}" y1="0" x2="{label_w}" y2="{h}" stroke="{C["axis"]}" stroke-width="1"/>'
    return s + '</svg>'

def range_gauge(value, lo, hi, bands, unit='', w=520, h=64, fmt='{:g}', labels=None):
    """A horizontal scale from lo..hi with coloured bands [(start,end,color,label)], marker at value."""
    pad_l, pad_r = 10, 10
    pw = w - pad_l - pad_r
    def X(v): return pad_l + pw * (min(max(v, lo), hi) - lo) / (hi - lo)
    s = svg_open(w, h)
    for (a, b, col, lab) in bands:
        s += f'<rect x="{X(a):.1f}" y="32" width="{X(b) - X(a):.1f}" height="10" rx="3" fill="{col}"/>'
        if lab: s += _txt((X(a) + X(b)) / 2, 56, lab, 8.5, C['muted'], 'middle')
    # ticks (below band, between band and labels)
    for (a, b, col, lab) in bands:
        s += _txt(X(a), 26, fmt.format(a), 7.5, C['muted'], 'middle')
    s += _txt(X(hi), 26, fmt.format(hi) + ('+' if value > hi else ''), 7.5, C['muted'], 'middle')
    xv = X(value)
    s += f'<polygon points="{xv - 5:.1f},16 {xv + 5:.1f},16 {xv:.1f},22" fill="{C["ink"]}"/>'
    s += f'<line x1="{xv:.1f}" y1="30" x2="{xv:.1f}" y2="44" stroke="{C["ink"]}" stroke-width="1.5"/>'
    s += _txt(xv, 11, f'{fmt.format(value)}{unit}', 9.5, C['ink'], 'middle', 600)
    return s + '</svg>'

def line_chart(series, w=520, h=200, ymin=None, ymax=None, xlabels=None, ref_bands=None, fmt='{:g}', unit='', ylab='', hlines=None, pad=(36, 16, 34, 12)):
    """series: list of dict(name, pts=[(xidx, y)], color). xlabels: list aligned to x indices. ref_bands: [(lo,hi,color,label)]. hlines: [(y,label,color)]"""
    pl, pt, pb, pr = pad
    pw, ph = w - pl - pr, h - pt - pb
    ys = [y for sr in series for _, y in sr['pts'] if y is not None]
    lo = ymin if ymin is not None else min(ys) * 0.9
    hi = ymax if ymax is not None else max(ys) * 1.1
    if hlines:
        for yv, *_ in hlines: lo = min(lo, yv * 0.95); hi = max(hi, yv * 1.05)
    nx = max(len(xlabels) if xlabels else max(x for sr in series for x, _ in sr['pts']) + 1, 2)
    def X(i): return pl + pw * i / (nx - 1)
    def Y(v): return pt + ph * (1 - (v - lo) / (hi - lo))
    s = svg_open(w, h)
    if ref_bands:
        for a, b, col, lab in ref_bands:
            ya, yb = Y(min(max(a, lo), hi)), Y(min(max(b, lo), hi))
            s += f'<rect x="{pl}" y="{min(ya, yb):.1f}" width="{pw}" height="{abs(ya - yb):.1f}" fill="{col}"/>'
            if lab: s += _txt(pl + pw - 4, min(ya, yb) + 10, lab, 8, C['muted'], 'end')
    # grid
    for k in range(5):
        yv = lo + (hi - lo) * k / 4
        s += f'<line x1="{pl}" y1="{Y(yv):.1f}" x2="{pl + pw}" y2="{Y(yv):.1f}" stroke="{C["grid"]}" stroke-width="1"/>'
        s += _txt(pl - 6, Y(yv) + 3, fmt.format(yv), 8, C['muted'], 'end')
    if hlines:
        for yv, lab, col in hlines:
            s += f'<line x1="{pl}" y1="{Y(yv):.1f}" x2="{pl + pw}" y2="{Y(yv):.1f}" stroke="{col}" stroke-width="1.2" stroke-dasharray="4 3"/>'
            s += _txt(pl + 4, Y(yv) - 4, lab, 8.5, col, 'start')
    if xlabels:
        xf = 8.5 if len(xlabels) <= 8 else 6.5
        for i, xl in enumerate(xlabels):
            s += _txt(X(i), h - pb + 14, xl, xf, C['muted'], 'middle')
    for sr in series:
        pts = [(X(x), Y(y)) for x, y in sr['pts'] if y is not None]
        if len(pts) > 1:
            d = 'M' + ' L'.join(f'{x:.1f},{y:.1f}' for x, y in pts)
            s += f'<path d="{d}" fill="none" stroke="{sr["color"]}" stroke-width="2" stroke-linejoin="round"/>'
        for (x, y), (_, v) in zip(pts, [q for q in sr['pts'] if q[1] is not None]):
            s += f'<circle cx="{x:.1f}" cy="{y:.1f}" r="4.5" fill="{sr["color"]}" stroke="{C["surface"]}" stroke-width="2"/>'
            if sr.get('label_pts', True):
                s += _txt(x, y - 9, fmt.format(v) + unit, 8.5, C['ink'], 'middle', 600)
    if ylab: s += _txt(pl, pt - 4, ylab, 8.5, C['muted'])
    return s + '</svg>'

def donut(items, w=220, r=80, thick=26, center=('', '')):
    total = sum(v for _, v, _ in items) or 1
    cx, cy = w / 2, r + 8
    s = svg_open(w, 2 * r + 16)
    a0 = -math.pi / 2
    for lab, v, col in items:
        a1 = a0 + 2 * math.pi * v / total
        if v / total >= 0.999:
            s += f'<circle cx="{cx}" cy="{cy}" r="{r - thick / 2}" fill="none" stroke="{col}" stroke-width="{thick}"/>'
        else:
            x0, y0 = cx + r * math.cos(a0), cy + r * math.sin(a0)
            x1, y1 = cx + r * math.cos(a1), cy + r * math.sin(a1)
            ri = r - thick
            xi0, yi0 = cx + ri * math.cos(a0), cy + ri * math.sin(a0)
            xi1, yi1 = cx + ri * math.cos(a1), cy + ri * math.sin(a1)
            large = 1 if (a1 - a0) > math.pi else 0
            d = f'M{x0:.1f},{y0:.1f} A{r},{r} 0 {large} 1 {x1:.1f},{y1:.1f} L{xi1:.1f},{yi1:.1f} A{ri},{ri} 0 {large} 0 {xi0:.1f},{yi0:.1f} Z'
            s += f'<path d="{d}" fill="{col}" stroke="{C["surface"]}" stroke-width="2"/>'
        a0 = a1
    s += _txt(cx, cy - 2, center[0], 20, C['ink'], 'middle', 600)
    s += _txt(cx, cy + 14, center[1], 9, C['muted'], 'middle')
    return s + '</svg>'

def legend(items):
    return '<div class="legend">' + ''.join(f'<span><i style="background:{c}"></i>{esc(l)}</span>' for l, c in items) + '</div>'

def age_dial(chrono, ages, w=520, row_h=30, label_w=120):
    """ages: [(label, age, color)]. Bars from 0..max with chrono marker."""
    mx = max(chrono, max(a for _, a, _ in ages)) * 1.08
    n = len(ages); h = n * row_h + 26
    pw = w - label_w - 70
    def X(v): return label_w + pw * v / mx
    s = svg_open(w, h)
    for k in range(0, int(mx) + 1, 10):
        s += f'<line x1="{X(k):.1f}" y1="0" x2="{X(k):.1f}" y2="{h - 22}" stroke="{C["grid"]}"/>'
        s += _txt(X(k), h - 8, f'{k}岁', 8, C['muted'], 'middle')
    for i, (lab, a, col) in enumerate(ages):
        y = i * row_h + 6
        s += _txt(label_w - 8, y + 14, lab, 10, C['ink2'], 'end')
        s += f'<rect x="{label_w}" y="{y}" width="{X(a) - label_w:.1f}" height="18" rx="4" fill="{col}"/>'
        delta = a - chrono
        s += _txt(X(a) + 6, y + 13, f'{a:g}岁 ({delta:+.1f})', 9.5, C['ink'], 'start', 600, 'style="paint-order:stroke" stroke="#fcfcfb" stroke-width="3"')
    s += f'<line x1="{X(chrono):.1f}" y1="0" x2="{X(chrono):.1f}" y2="{h - 22}" stroke="{C["ink"]}" stroke-width="1.5" stroke-dasharray="5 3"/>'
    s += _txt(X(chrono), h - 8, f'实际 {chrono:g}岁', 8.5, C['ink'], 'middle', 600, 'style="paint-order:stroke" stroke="#fff" stroke-width="3"')
    return s + '</svg>'

def radar(labels, values, maxv=10, w=260, color=C['blue'], ref=None):
    cx, cy, R = w / 2, w / 2, w / 2 - 34
    n = len(labels)
    s = svg_open(w, w)
    for k in (0.25, 0.5, 0.75, 1.0):
        pts = ' '.join(f'{cx + R * k * math.sin(2 * math.pi * i / n):.1f},{cy - R * k * math.cos(2 * math.pi * i / n):.1f}' for i in range(n))
        s += f'<polygon points="{pts}" fill="none" stroke="{C["grid"]}"/>'
    for i in range(n):
        ang = 2 * math.pi * i / n
        s += f'<line x1="{cx}" y1="{cy}" x2="{cx + R * math.sin(ang):.1f}" y2="{cy - R * math.cos(ang):.1f}" stroke="{C["grid"]}"/>'
        lx, ly = cx + (R + 18) * math.sin(ang), cy - (R + 18) * math.cos(ang)
        s += _txt(lx, ly + 3, labels[i], 9, C['ink2'], 'middle')
    def poly(vals, col, fillop):
        pts = ' '.join(f'{cx + R * (v / maxv) * math.sin(2 * math.pi * i / n):.1f},{cy - R * (v / maxv) * math.cos(2 * math.pi * i / n):.1f}' for i, v in enumerate(vals))
        return f'<polygon points="{pts}" fill="{col}{fillop}" stroke="{col}" stroke-width="2"/>'
    if ref: s += poly(ref, C['muted'], '22')
    s += poly(values, color, '33')
    for i, v in enumerate(values):
        ang = 2 * math.pi * i / n
        x, y = cx + R * (v / maxv) * math.sin(ang), cy - R * (v / maxv) * math.cos(ang)
        s += f'<circle cx="{x:.1f}" cy="{y:.1f}" r="4" fill="{color}" stroke="#fff" stroke-width="1.5"/>'
        s += _txt(x, y - 8, f'{v:g}', 8.5, C['ink'], 'middle', 600)
    return s + '</svg>'

def heat_cells(rows, cols, matrix, w=520, cell_h=16, label_w=90, scale=None, fmt='{:g}'):
    """matrix[r][c] value or None. scale: fn(value)->color"""
    n, m = len(rows), len(cols)
    cw = (w - label_w) / m
    h = n * cell_h + 22
    s = svg_open(w, h)
    for j, c in enumerate(cols):
        s += _txt(label_w + cw * (j + 0.5), 12, c, 9, C['ink2'], 'middle', 600)
    for i, r in enumerate(rows):
        y = 20 + i * cell_h
        s += _txt(label_w - 6, y + cell_h * 0.72, r, 9, C['ink2'], 'end')
        for j in range(m):
            v = matrix[i][j]
            col = scale(v) if v is not None else '#f1f1ee'
            s += f'<rect x="{label_w + cw * j + 1:.1f}" y="{y + 1}" width="{cw - 2:.1f}" height="{cell_h - 2}" rx="3" fill="{col}"/>'
            if v is not None:
                tcol = '#fff' if (scale and v is not None and _dark(col)) else C['ink']
                s += _txt(label_w + cw * (j + 0.5), y + cell_h * 0.72, fmt.format(v) if isinstance(v, (int, float)) else v, 8.5, tcol, 'middle')
    return s + '</svg>'

def _dark(hexcol):
    hexcol = hexcol.lstrip('#')
    if len(hexcol) < 6: return False
    r, g, b = int(hexcol[0:2], 16), int(hexcol[2:4], 16), int(hexcol[4:6], 16)
    return (0.299 * r + 0.587 * g + 0.114 * b) < 140

def igg_color(v):
    if v is None: return '#f1f1ee'
    if v >= 200: return C['critical']
    if v > 100: return C['serious']
    if v >= 50: return C['warning']
    if v >= 25: return '#e3ecd8'
    return '#eef4ea'

def stacked_bar(segments, w=520, h=26, total=None, labels=True):
    total = total or sum(v for _, v, _ in segments)
    s = svg_open(w, h + 22)
    x = 0
    for lab, v, col in segments:
        bw = w * v / total
        s += f'<rect x="{x:.1f}" y="0" width="{max(bw - 2, 0):.1f}" height="{h}" rx="4" fill="{col}"/>'
        if labels and bw > 40:
            s += _txt(x + bw / 2, h * 0.68, f'{lab} {v:g}', 9, '#fff' if _dark(col) else C['ink'], 'middle', 600)
        x += bw
    return s + '</svg>'

def bullet_scale(value, lo, hi, marks, w=520, h=40, fmt='{:g}'):
    """simple scale with marker and named ticks: marks=[(v,label)]"""
    pw = w - 20
    def X(v): return 10 + pw * (min(max(v, lo), hi) - lo) / (hi - lo)
    s = svg_open(w, h)
    s += f'<rect x="10" y="18" width="{pw}" height="6" rx="3" fill="{C["grid"]}"/>'
    for v, lab in marks:
        s += f'<line x1="{X(v):.1f}" y1="14" x2="{X(v):.1f}" y2="28" stroke="{C["axis"]}"/>'
        s += _txt(X(v), 38, lab, 8, C['muted'], 'middle')
    s += f'<circle cx="{X(value):.1f}" cy="21" r="7" fill="{C["blue"]}" stroke="#fff" stroke-width="2"/>'
    s += _txt(X(value), 9, fmt.format(value), 9.5, C['ink'], 'middle', 600)
    return s + '</svg>'

def sparkbars(vals, w=520, h=90, color=C['blue'], labels=None, fmt='{:g}', hline=None):
    n = len(vals); mx = max(v for v in vals if v is not None) * 1.15
    if hline: mx = max(mx, hline[0] * 1.25)
    bw = w / n
    s = svg_open(w, h + 24)
    if hline:
        yv, lab, col = hline
        y = h - h * yv / mx
        s += f'<line x1="0" y1="{y:.1f}" x2="{w}" y2="{y:.1f}" stroke="{col}" stroke-dasharray="4 3"/>'
        s += _txt(w - 2, y - 3, lab, 8, col, 'end')
    for i, v in enumerate(vals):
        if v is None: continue
        bh = h * v / mx
        s += f'<rect x="{i * bw + 3:.1f}" y="{h - bh:.1f}" width="{bw - 6:.1f}" height="{bh:.1f}" rx="3" fill="{color}"/>'
        fs = 8 if n <= 8 else 6.5
        s += _txt(i * bw + bw / 2, h - bh - 4, fmt.format(v), fs, C['ink'], 'middle')
        if labels: s += _txt(i * bw + bw / 2, h + 14, labels[i], fs, C['muted'], 'middle')
    return s + '</svg>'

def timeline(events, w=520, h=120, start=None, end=None):
    """events: [(iso_date, label, color)]"""
    import datetime as dt
    ds = [dt.date.fromisoformat(d) for d, _, _ in events]
    a = dt.date.fromisoformat(start) if start else min(ds); b = dt.date.fromisoformat(end) if end else max(ds)
    span = (b - a).days or 1
    def X(d): return 20 + (w - 40) * (d - a).days / span
    s = svg_open(w, h)
    y = h / 2
    s += f'<line x1="20" y1="{y}" x2="{w - 20}" y2="{y}" stroke="{C["axis"]}" stroke-width="2"/>'
    for yr in range(a.year, b.year + 1):
        d = dt.date(yr, 1, 1)
        if a <= d <= b:
            s += f'<line x1="{X(d):.1f}" y1="{y - 6}" x2="{X(d):.1f}" y2="{y + 6}" stroke="{C["muted"]}"/>'
            s += _txt(X(d), y + 20, str(yr), 8.5, C['muted'], 'middle')
    up = True
    for (d, lab, col), dd in zip(events, ds):
        x = X(dd)
        ty = y - 26 if up else y + 40
        s += f'<line x1="{x:.1f}" y1="{y}" x2="{x:.1f}" y2="{ty + (6 if up else -12)}" stroke="{col}" stroke-width="1"/>'
        s += f'<circle cx="{x:.1f}" cy="{y}" r="5" fill="{col}" stroke="#fff" stroke-width="2"/>'
        s += _txt(x, ty, lab, 8, C['ink2'], 'middle')
        up = not up
    return s + '</svg>'
