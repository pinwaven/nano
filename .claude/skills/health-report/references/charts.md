# Charts and page components — `report/lib.py`

All helpers return inline SVG/HTML strings; concatenate them into a page body and pass it to
`page(section, body)`. Colours are the dataviz reference palette (`C[...]`); the four Kino
dimensions have fixed colours in `DIM` (细胞 blue, 代谢 orange, 微血管 aqua, 抗压 violet) — keep
them consistent across the whole book. Status colours: `C['good']`, `C['warning']`,
`C['serious']`, `C['critical']`.

## Page scaffold
| helper | use |
|---|---|
| `page(section, body, cls='')` | append one A4 page; `section` is the running-header label and the TOC group. `cls='cover'` / `'divider'` for those two page types. |
| `h2(title, subtitle)` | page title + a subtitle that names source and date |
| `h3(t)`, `p(t)`, `callout(title, body, kind)` | kind ∈ info / warn / good / crit |
| `stat(value, label, sub, color, small)` inside `stats_row([...])` | hero numbers; embed `<small>` for units |
| `card(title, body, accent_color)` | bordered card with a coloured top edge |
| `table(headers, rows, cls, widths)` | `cls='compact'` for dense tables; cells accept HTML |
| `pill(text, color)`, `status_pill('优'|'正常'|'关注'|'偏低'|'偏高'|'缺乏'|'异常')` | status chips |
| `legend([(label, color), …])` | for any multi-series chart |
| `two_col(left, right, ratio)` or a raw `<div class="cols" style="grid-template-columns:…">` | two-column layouts |
| `.tight` wrapper div | denser type for the doctor page |

## Charts
| helper | when | notes |
|---|---|---|
| `age_dial(chrono, [(label, age, color)…], w, row_h, label_w)` | every "biological age vs actual" comparison | dashed line = chronological age; labels get a white halo |
| `radar(labels, values, maxv, w, color)` | the four Kino dimension scores | one series only |
| `range_gauge(value, lo, hi, [(a, b, color, label)…], unit, w, fmt)` | a single marker against its reference bands | use the lab's own bands; `fmt='{:.2f}'` for sub-unit markers |
| `line_chart([dict(name, pts=[(i, y)…], color)], w, h, ymin, ymax, xlabels, ref_bands, hlines, fmt, unit, ylab)` | repeated measurements over time | x is an index into `xlabels` (dates); `ref_bands` shade deficiency/target zones; ≤ 8 labels at full size, more shrink automatically |
| `sparkbars(vals, w, h, color, labels, fmt, hline)` | short daily series (sleep hours, steps) | `hline=(value, label, color)` for a target |
| `hbars([(label, value, color)…], w, bar_h, gap, max_v, label_w, fmt, ref)` | ranked lists (risk multiples, abundances, model scores) | `ref=(lo, hi)` shades a normal band |
| `donut([(label, value, color)…], w, r, thick, center=(big, small))` | composition (gut phyla) | ≤ 5 slices, fold the rest into 其他 |
| `heat_cells(rows, cols, matrix, w, cell_h, label_w, scale, fmt)` | foods × dates, anything matrix-shaped | `scale` is a value→colour function; `igg_color()` is provided for IgG classes |
| `stacked_bar([(label, value, color)…], w, h, total)` | capsule composition (dots per capsule against the 72 cap) | |
| `bullet_scale(value, lo, hi, [(v, label)…], w, fmt)` | a percentile or score on a named scale | |
| `timeline([(iso_date, label, color)…], w, h, start, end)` | all test dates on one axis | alternates labels above/below |

Dot rows on the recipe pages are plain HTML: `<div class="dotrow">` with `.sw` (colour swatch,
`dots.color_hex`), `.dn` (key + name), `.dc` (count), the ingredient line, a justification line,
an owned/not pill, and the dot's own min–max.

## Layout rules that were learned the hard way
- A page is a fixed 210×297 mm box with `overflow:hidden`. Content that does not fit is silently
  cut — the recipe page lost its last dot row this way. Split rather than shrink; then **render
  and look** (below).
- `<text>` in WXML is irrelevant here, but in SVG keep every label ≥ 6.5 px and thin out x-axis
  labels past ~12 points (the helpers do this for line_chart/sparkbars).
- Don't put more than one series on `line_chart` unless they share a unit; two devices' HRV are
  two charts.
- Reference bands and target lines carry the interpretation; a bare line with no band forces the
  reader to remember the range.

## Verification loop (do this every build)
```bash
python <skill>/report/build.py <workdir>
pdfinfo <workdir>/<name>.pdf | grep Pages
pdftoppm -r 45 -png <workdir>/<name>.pdf <workdir>/img/p    # thumbnails
# stitch into a contact sheet with PIL and Read it; then zoom on any page that looks dense:
pdftoppm -r 80 -png -f N -l N <workdir>/<name>.pdf <workdir>/img/z
```
Look for: cut-off content at the bottom of a page, overlapping labels, a chart whose value label
sits on a reference line, an empty lower half (move content in or merge pages), and the TOC page
numbers matching the section dividers.
