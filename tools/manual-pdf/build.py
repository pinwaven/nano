#!/usr/bin/env python3
"""Render docs/user-manual/end-user-guide.md to a print-ready HTML file.

Stage 1 of 2 — `print.js` turns the HTML into the PDF. See README.md.
"""
import os, re, sys, markdown

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.abspath(HERE + '/../../docs/user-manual') + '/'
SRC  = BASE + 'end-user-guide.md'
OUT  = HERE + '/guide.html'

md = open(SRC).read()

# The PDF gets its own cover and its own generated TOC, so drop the H1 and the
# in-document Contents list (which exists for the GitHub rendering of the .md).
md = re.sub(r'^# End User Guide\n', '', md, count=1)
md = re.sub(r'## Contents\n.*?\n---\n', '', md, count=1, flags=re.S)

mdx = markdown.Markdown(extensions=['extra', 'toc', 'sane_lists'],
                        extension_configs={'toc': {'toc_depth': '2-3'}})
body, toc = mdx.convert(md), mdx.toc

CSS = """
@page { size: A4; }   /* margins come from the CDP print call, alongside the footer */
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font: 10.2pt/1.62 -apple-system, "Helvetica Neue", "PingFang SC", "Hiragino Sans GB", sans-serif;
       color: #1c2430; margin: 0; }
h1, h2, h3 { color: #0B1C2E; line-height: 1.25; break-after: avoid; page-break-after: avoid; }
h2 { font-size: 16pt; margin: 26px 0 10px; padding-bottom: 6px; border-bottom: 2px solid #5B6BF5;
     break-before: page; page-break-before: always; }
h2:first-of-type { break-before: avoid; page-break-before: avoid; }
h3 { font-size: 12pt; margin: 20px 0 6px; color: #2c3a52; }
p { margin: 0 0 9px; orphans: 3; widows: 3; }
strong { color: #0B1C2E; }
a { color: #3B4CD8; text-decoration: none; }
code { font: 9pt/1.4 "SF Mono", Menlo, Consolas, monospace; background: #eef1f7;
       padding: 1px 4px; border-radius: 3px; color: #2b3a55; }
pre { background: #0B1C2E; color: #d8e2f0; padding: 12px 14px; border-radius: 6px;
      font: 8.6pt/1.55 "SF Mono", Menlo, Consolas, monospace; overflow: hidden;
      white-space: pre-wrap; break-inside: avoid; page-break-inside: avoid; }
pre code { background: none; color: inherit; padding: 0; font-size: inherit; }
blockquote { margin: 12px 0; padding: 10px 14px; background: #f3f6fc; border-left: 3px solid #5B6BF5;
             border-radius: 0 5px 5px 0; break-inside: avoid; page-break-inside: avoid; }
blockquote p { margin: 0 0 6px; } blockquote p:last-child { margin: 0; }
table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 9.3pt;
        break-inside: avoid; page-break-inside: avoid; }
th { background: #0B1C2E; color: #fff; text-align: left; font-weight: 600; padding: 7px 9px; font-size: 9pt; }
td { padding: 6px 9px; border-bottom: 1px solid #dde3ee; vertical-align: top; }
tr:nth-child(even) td { background: #f7f9fd; }
ul, ol { margin: 0 0 10px; padding-left: 20px; }
li { margin-bottom: 4px; }
hr { display: none; }

/* Screenshots. Consecutive image lines in one markdown paragraph flow side by side. */
p > img { width: 52mm; height: auto; vertical-align: top; border: 1px solid #c9d3e4;
          border-radius: 7px; background: #0B1C2E; margin: 4px 6px 4px 0; }
p:has(> img) { break-inside: avoid; page-break-inside: avoid; margin: 12px 0 14px; }

.cover { height: 245mm; display: flex; flex-direction: column; justify-content: center;
         break-after: page; page-break-after: always; }
.cover .kicker { font-size: 11pt; letter-spacing: .22em; text-transform: uppercase; color: #5B6BF5; font-weight: 600; }
.cover h1 { font-size: 40pt; margin: 12px 0 6px; letter-spacing: -0.5pt; }
.cover .sub { font-size: 13pt; color: #5a6880; margin-bottom: 30px; }
.cover .rule { width: 70mm; height: 3px; background: #5B6BF5; margin-bottom: 26px; }
.cover .meta { font-size: 9.5pt; color: #77839a; line-height: 1.8; }
.cover .strip { margin-top: 34px; }
.cover .strip img { width: 34mm; border: 1px solid #c9d3e4; border-radius: 6px; margin-right: 5mm; }

.toc-page { break-after: page; page-break-after: always; }
.toc-page h2 { break-before: avoid; page-break-before: avoid; margin-top: 0; }
.toc ul { list-style: none; padding-left: 0; margin: 0; }
.toc > ul > li { margin: 0; border-bottom: 1px dotted #d3dae8; padding: 2.5px 0; }
.toc > ul > li > a { font-weight: 600; font-size: 10pt; color: #0B1C2E; }
.toc ul ul { padding-left: 14px; margin: 1px 0; }
.toc ul ul li { border: none; padding: 0; line-height: 1.45; }
.toc ul ul a { color: #5a6880; font-size: 8.9pt; font-weight: 400; }
"""

COVER = """
<div class="cover">
  <div class="kicker">Waven Nano</div>
  <h1>End User Guide</h1>
  <div class="sub">The WeChat Mini Program, end to end</div>
  <div class="rule"></div>
  <div class="meta">
    Chatting with your AI health companion &middot; Kino biomarker testing &middot; your Digital Twin<br>
    Wearable sync &middot; health records &middot; Dots formulation, ordering and activation<br>
    Health plan focuses &middot; Viva AG deep analysis &middot; Academy, Box and the store
  </div>
  <div class="strip">
    <img src="images/chat-main.png"><img src="images/health-twin-overview.png"><img
     src="images/chat-formula-card.png"><img src="images/plans-dots.png">
  </div>
</div>
"""

doc = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Waven Nano — End User Guide</title><base href="file://{BASE}">
<style>{CSS}</style></head><body>
{COVER}
<div class="toc-page"><h2>Contents</h2><div class="toc">{toc}</div></div>
{body}
</body></html>"""
open(OUT, 'w').write(doc)

# Fail loudly rather than shipping a PDF with grey boxes or dead cross-links.
ids     = set(re.findall(r'id="([^"]+)"', doc))
broken  = sorted(h for h in set(re.findall(r'href="#([^"]+)"', doc)) if h not in ids)
imgs    = re.findall(r'<img[^>]*src="([^"]+)"', doc)
missing = sorted(i for i in imgs if not os.path.exists(BASE + i))
print(f'html: {OUT}\nimages: {len(imgs)} | missing: {missing or "none"}\nbroken anchors: {broken or "none"}')
if missing or broken:
    sys.exit(1)
