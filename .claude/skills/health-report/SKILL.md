---
name: health-report
description: Produce a comprehensive, chart-rich, Chinese-language PDF health report (50+ A4 pages) for one nano user by reading ALL of their data — every uploaded health document PDF, Kino/lab biomarkers, BioAge, epigenetic clocks, genome, microbiome, food IgG, wearable data, memory facts, plans, chat — and delivering findings, anti-aging interpretation, a Dots precision-nutrition recipe, lifestyle/diet plans, a physician summary, and a follow-up calendar; optionally publish it into the miniapp's 数字孪生 综合报告 card. Use this whenever someone asks for a health report, health analysis, 健康报告, 全维度分析, "analyze user X's data", a PDF summary of a user's health, a doctor-facing summary, or a Dots/营养 recommendation grounded in a user's full history — even if they only name one part (e.g. "look at Mary's uploaded documents"), because the value is in fusing every source.
---

# Health report for one user

You are writing the report a careful clinician-nutritionist would write after reading every file
this person has — not a summary of the platform's summaries. The Mary report (2026-09-15, 54
pages) found its three real problems (20 months of vitamin D deficiency, NAD+ grade D, gut
dysbiosis plus escalating dairy/soy/yeast IgG) only in the uploaded PDFs, which the platform's own
extractor had reduced to "0 observations". Read everything first; decide the story second.

Deliverable: a PDF (Chinese unless told otherwise), plus — if asked — the report published into
the app so it appears on the 数字孪生 subtab's 综合报告 card and the Viva AG panel.

## Voice — the reader is a paying customer

The PDF goes to the user (and often to their doctor). It is an Aeviva product, so:

- **Attribution is Viva.** Cover, appendix and `summary.txt` say the report was produced by
  Viva — Aeviva's precision-health AI — with expert review. Never name Claude, Anthropic,
  "claude-code", a model, a script, or a database. (`viva_ag_jobs.claimed_by` stays
  `claude-code-analyst` — that column is internal and never rendered.)
- **No internal identifiers or plumbing.** No user ids, channel keys, "Dev/Prod", table or
  column names (`lab_orders`, `biomarkers #1053`, `users.bio_data`), script names, extractor
  internals, estimator source-code details. Cover meta is 报告日期 · 报告编号 · 数据跨度;
  appendix sources are described in the user's words ("Kino 扫描记录", "个人档案",
  "检测机构报告（量康）").
- **Never criticise the platform, the product or Viva's earlier answers in the customer's
  copy.** No "给平台的反馈", no "平台的自动解析只认出 4 个数字", no "本批次发现多处误提取",
  no "Viva 说错了 / 作废". Product feedback goes to the user of the skill (the operator) in
  chat and into `references/`, never into the PDF.
- **Corrections are still made — framed as updates.** When earlier chat advice or an App number
  rests on an estimated panel, say so plainly and without blame: "该次扫描读数未达到有效窗口，
  App 显示的六项与年龄为参考估算值，本报告不作为结论依据；此前基于该面板的解读，以本次实测
  数据更新如下". A vegan who received a non-vegan menu gets "本报告已按你记录的全素饮食重新
  定制", not "Viva 不知道你全素". The customer must still come away with the right answer
  (e.g. N6/N9 are not indicated) — only the tone changes.
- **Candour about the data stays.** Trust grades, conflicts between sources, single-measurement
  caveats, "this was never measured" — all of that is the report's value and is about the
  data, not the company. The doctor page keeps full clinical bluntness.
- Third-party documents (another provider's 422-page plan) may be assessed frankly on evidence,
  in a "供你与医生讨论" register, never as a rival being attacked.

## Workflow

### 1. Extract — everything the platform holds
```bash
cd /Users/pin/waven/nano && set -a && source .env && set +a
WORK=<scratchpad>/report-<user>        # per-user working dir; never inside the repo
node .claude/skills/health-report/scripts/extract.js "<user_id or nickname>" $WORK        # dev; --prod only if told
node .claude/skills/health-report/scripts/download-docs.js $WORK                            # PDFs + pdftotext
```
`extract.js` dumps one JSON per user-scoped table plus the Dots formulary and joined views;
`download-docs.js` fetches every active `health_documents` PDF from OSS, extracts the text layer,
and flags duplicates and scanned files. Then **read every `txt/*.txt`** (a 200-page exome takes a
few targeted greps — `scripts/parse_exome.py` pulls the 77 trait results and the risk overview;
`scripts/parse_igg.py` structures IgG panels) and render graphic-only result pages with
`pdftoppm` and Read them as images. `references/data-sources.md` says what lives in each table
and lists the traps (legacy `annual_lab` imports, device-incomparable HRV, DATE timezone,
model-inferred values printed inside other reports, provenance of `lab_api` epigenetics).

### 2. Reconcile before you interpret
Put every measurement of the same marker on one axis, unit-converted; find the conflicts (a
platform import that contradicts five real tests; a "51 kg / BMI 22.0" pair that cannot both be
true); decide which to trust and why. These decisions go on the 阅读指南 page *before* any chart.
Read the latest `viva_ag_jobs.result` too — it is a second opinion whose `data_gaps` are usually
right. Read every `role='user'` chat turn and all `user_memory_facts`: a vegetarian with no
alliums changes the whole diet and Dots section. `references/analysis-rules.md` is the reasoning
guide — priority = certainty × intervenability; genetics pages end with the phenotype; every Dot
needs a named finding; adherence (unopened cartridges, one check-in in 17 weeks) is a finding.

### 3. Write the report
Copy `report/skeleton/` into `$WORK`, fill `meta.py`, and write `part1.py … partN.py` following
`references/outline.md` (seven parts + appendix; the page pattern is numbers → mechanism → this
person → action). Charts and components are in `report/lib.py`; `references/charts.md` lists
each helper and when to use it. The framework stays in the skill directory — parts import it via
`from lib import *`, and `build.py` adds both paths. Content lives only in `$WORK`, which is
scratch: **never write a user's clinical prose into the repo**.

Two pages that must exist: the **临床摘要（医生版）** (problem list with dates/units/ranges, full
panel, pharmacogenomics, interaction warnings for what you recommend) and the **阅读指南**
conflict callout. Two sections that must be grounded in the formulary: the **Dots recipe**
(counts inside each dot's own `target_dots_min/max`, ≤72 per capsule, timing locks, N7 as a
pulse, ingredient sourcing flags for the user's diet, a table of differences from the platform's
latest auto-formulation with reasons, and the list of dots you deliberately excluded) and the
**diet plan** (a 7-day menu that actually obeys every restriction and IgG class).

Explain the BioAge honestly: the platform's number comes from four 0–10 scores → mFI → inverse
Gompertz → log compression, and the −10…−12 band is the compressor's ceiling for any healthy
panel (the math is in `data-sources.md`). Lab-printed ages (glycan immune age, gut age, ovarian
age) are read, not computed — say which is which.

### 4. Build, look, fix
```bash
python .claude/skills/health-report/report/build.py $WORK
```
Then render thumbnails and **look at every page** (`references/charts.md` → verification loop).
Pages are fixed-height with `overflow:hidden`: anything that doesn't fit is silently cut. Split
pages rather than shrink; zoom on dense ones. Send the PDF with `SendUserFile`.

### 5. Publish into the app (only when asked)
```bash
node .claude/skills/health-report/scripts/publish.js $WORK <pdf> <summary.txt>   # dev; --prod only if told
```
Uploads to OSS and inserts a completed `viva_ag_jobs` row (`command_key full_analysis`,
`claimed_by claude-code-analyst` — internal, never shown), which `GET /api/twin-reports` lists on the 数字孪生 subtab's
综合报告 card (`components/user-health`) and the AG panel also shows. Write `summary.txt` as the
chat-bubble-sized abstract (what was read, the headline, the three problems, where the recipe
and doctor page are) — in Viva's voice, same rules as the PDF. It does not post a chat message; use `deliverTerminalMessage` if the user
should be pinged. Verify in DevTools with `tools/wechat-automator` (connect to the running
session; sandbox-login as the user by setting `nano_user`/`nano_sandbox_active` storage and
`app.globalData`, then inspect `#health-comp` → `.tr-card`).

## Things that went wrong once and should not again
- Trusting `health_twin` averages: they mix devices and garbage nights. Recompute from
  `health_events`, per device.
- Charting the demo `annual_lab` vitamin D beside real results — it was 4× off. Grade C, exclude,
  explain.
- Calling the `lab_api` epigenetic record "cross-validation": it has no source PDF and its own
  text quotes the Kino values. Present it, grade it B, say so.
- Grouping two IgG panels of different sizes as if identical foods: parse each, join on food name,
  leave gaps blank.
- A recipe page that overflowed and lost a row; a cover whose hero overlapped the subtitle; x-axis
  labels colliding at 14 points — all only visible by rendering. Look.
- `<block>` inside `<text>` and `bindtap` on a bare `<text>` don't work in WXML; the card's
  meta line is composed in JS.
- Appendix C of a customer report named Claude, quoted user ids and table names, and ended with
  "给 Aeviva 平台的三条反馈" (2026-09-21). See **Voice** above; the operator gets that feedback in
  chat, the customer never does.
- Trusting `biomarkers.data.extracted` from a photo (it turned a glycan fraction into HbA1c 13.4%), or a
  "KINO lab_panel" upload (an App screenshot of the estimated panel). Open every image.

## Many users at once
For a roster (e.g. every premier partner) use `scripts/batch/`: `digest.py <workdir>` prints everything to
read per user, `collect_images.js` pulls the report photos, `wearable.py <workdir>` recomputes ring stats
(`EXCLUDE_DEV=` to drop a foreign ring serial), and `gen.py <workdir>` renders a 16–27 page report from a
per-user `notes.py` (start from `common.minimal(...)` for users with no documents; set `MODE='full'` and add
`DATA_PAGES` / `WEAR_PAGES` / a real Dots recipe when there are documents and ≥12 nights). The review index
and publishing commands live in the batch folder's README.

## Files
- `scripts/extract.js`, `scripts/download-docs.js`, `scripts/publish.js`, `scripts/parse_igg.py`,
  `scripts/parse_exome.py`
- `report/lib.py` (page scaffold + 15 SVG chart helpers), `report/style.css`, `report/build.py`,
  `report/skeleton/` (meta.py + a part1.py starter)
- `references/outline.md` · `references/data-sources.md` · `references/analysis-rules.md` ·
  `references/charts.md`
- Related backend: `worker/handlers/twin_reports.js` (the card's endpoints), `handlers/viva_ag.js`
  (`publicResultFiles`), `tests/twin-reports.test.js`.
