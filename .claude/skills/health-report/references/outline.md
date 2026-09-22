# Report outline — seven parts + appendix, ~50–55 A4 pages

This is the structure the Mary report (2026-09-15, 54 pages) settled on after review. Keep the
seven-part spine; add, drop or merge pages inside a part according to what data the user actually
has. A user with a DEXA and a CGM but no genome gets a body-composition page and a glucose-variability
page instead of the genome pages — the spine stays.

Every content page follows one pattern: `h2(title, subtitle-with-source-and-date)` → a chart or a
table of the raw numbers → prose in two halves, **它与衰老的关系 / 为什么重要** and **您的情况**
→ a `callout` with the concrete recommendation. Numbers first, interpretation second, action last.

## Front matter (3 pages)
1. **封面** (`cls='cover'`) — brand line (channel brand, e.g. `AEVIVA VIVA · 精准健康数字孪生`), title,
   one-line subtitle naming the data sources fused, hero BioAge with Δ vs chronological, meta row
   (report date · env/user id · data span).
2. **目录** — `page('目录', '__TOC__')`; build.py fills it from every page's h2.
3. **阅读指南** — how the report is organised; the A/B/C data-trust grading; the colour/symbol
   legend; and a `warn` callout listing every data conflict you found *before* the reader meets
   the numbers (this is where the untrusted legacy import and any weight/BMI inconsistency go).

## 第一篇 结论与优先级 (divider + 4 pages)
- **执行摘要** — 4 hero stats (BioAge, methylation age, DunedinPACE, telomere percentile — or
  whatever independent age measures exist), 整体判断, the three real problems, a P1/P2/P3
  priority table, and a one-sentence framing.
- **临床摘要（医生版）** — the page a physician reads: patient profile, prioritised problem list
  with dates/units/reference ranges, the latest full lab panel, an aging-biology one-paragraph,
  genetics/pharmacogenomics highlights, suggested work-up + interaction warnings for the
  supplements you are about to recommend. Use the `.tight` wrapper; it is dense by design.
- **健康记分卡** — one table, ~18 rows: dimension · key data · status pill · note.
- **个人档案与数据全景** — profile card (diet, goals, wearable, roles), platform-usage timeline,
  data-asset inventory table with trust grade, and a `timeline()` of every test date.

## 第二篇 我到底几岁？ (divider + 4 pages)
- **七把尺子量出的年龄** — `age_dial()` with every biological-age measure available (Kino, each
  methylation clock and their mean, immune/glycan age, ovarian age, gut age…) against the
  chronological line. Explain that they are independent methods; call out any that disagree.
- **Kino 生物年龄：四个维度** — radar of the four scores, dial of the four sub-ages, the
  per-dimension input table, and a before/after table if there are two scans. Explain
  scan-to-scan noise honestly (method differences, day-to-day biomarker variation).
- **DNA 甲基化** — clock stat tiles, system-age dial, CpG highlights table, and what each clock
  measures. (Only if the user has an epigenetic record — see data-sources.md on its provenance.)
- **端粒长度与免疫年龄** — or whichever other age proxies exist.

## 第三篇 血液与代谢 (divider + 6 pages)
- **六项 Kino 衰老标志物 Ⅰ / Ⅱ** — three `marker_card`s per page: big value, `range_gauge` with
  the reference bands, trend vs previous scan, 它与衰老的关系, 您的情况.
- **血液全景** — the full lab panel grouped (血脂 / 糖代谢 / 肝 / 肾 / 甲状腺 / 维生素与炎症) with
  status pills; callouts for what matters *for this person* (vegetarian → B12/ferritin; genetics
  vs phenotype).
- **专题** pages — one per marker that was measured repeatedly or is the deficit that matters:
  a `line_chart` with reference bands, why it matters, the genetic angle if any, the recommendation.
  Mary's were 维生素 D, NAD+, 同型半胱氨酸. Pick the user's own.

## 第四篇 肠道 · 食物 · 营养素 (divider + 6–8 pages)
- Gut microbiome: overview (phyla `donut`, F/B ratio, the model's summary table), probiotics /
  immune / neurotransmitter tables, nutrition estimates + disease-risk `hbars`.
- Food IgG: `heat_cells` across every panel (foods × dates), the trend table, what IgG is and
  isn't, then a **分级回避方案** page + the "what you can still eat" grid — written for the
  person's actual diet.
- Organic acids, hair elements, liver glycan score — each one page when present; say plainly
  when a panel is old and is being used as a "体质倾向" rather than current state.

## 第五篇 基因组与女性/男性健康 (divider + 4 pages)
- Exome disease-risk overview (`hbars` of risk multiples and lifetime risks; the 较高/低 lists).
- Nutrigenomics + trait table (absorption genes → which Dot/food covers it; diet/metabolic traits;
  exercise traits).
- Obesity-gene panel vs phenotype.
- Women's health (AMH, HPV/TCT currency, perimenopause checklist) or the male equivalent.

## 第六篇 日常监测 (divider + 3 pages)
- One page per wearable source (never merge devices with different HRV algorithms), `line_chart`
  + `sparkbars`, and a callout comparing activity levels across periods.
- 体重、体成分与生命体征 — weight trajectory from every source that recorded it, and the
  "missing measurement" argument (usually DEXA).

## 第七篇 行动方案 (divider + 9–10 pages)
- **抗衰老科学解读 · 十二个标志** — the 12 hallmarks of aging table: hallmark · the user's data ·
  status · strategy; then a page mapping the four Kino dimensions to mechanisms and measurable
  targets. Also the page that lists which Dots you deliberately *excluded* and why.
- **Dots 精准营养配方 Ⅰ / Ⅱ** — morning capsule then evening capsule, one `dotrow` per dot
  (ingredients from the formulary, count, the specific finding that justifies it, owned/not,
  the dot's own min–max). Then the "how this differs from the platform's auto-formulation" table.
- **Dots 配方 · 结构、脉冲与启动节奏** — `stacked_bar` of each capsule, N7 pulse protocol,
  vegetarian/allergen compliance notes, a 4-week ramp, purchase path (tiered packages).
- **运动方案 / 睡眠·压力·日晒 / 饮食原则 / 一周菜单** — tied to the user's genes, IgG, diet and
  wearable data, not generic advice.
- **复查与就医日历** — a dated table; **30/90/365 天行动清单** — three cards + "what success
  looks like in a year".

## 附录 (4 pages)
A · 上传文件清单 (id, file, lab, date, sample, core result, grade — flag duplicate uploads) ·
B · a full-data appendix for the largest panel (e.g. all 120 IgG values) ·
C · 关键数据总表 (every number cited: value · date · source · grade) ·
D · 术语表, 方法说明（「本报告由 Viva——Aeviva 精准健康 AI——生成，并经专业健康分析审阅」；来源按用户能理解的名称列出，不写表名/脚本/环境/用户 id），数据局限, 声明. 绝不放「给平台的反馈」——那是给操作者的，写进 chat 和 references/。

## Two pages that earn their place
- The **doctor summary** — a physician will not read 54 pages; this is the page they photograph.
- The **data-conflict callout in the 阅读指南** — putting it before the numbers is what makes the
  rest of the report trustworthy.
