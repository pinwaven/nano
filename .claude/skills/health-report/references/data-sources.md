# Data sources — where each number lives, and the traps

`scripts/extract.js` writes one JSON per table into `<outdir>/data/`. This is what each holds and
what went wrong the first time.

## Trust grading (state it on the 阅读指南 page and in appendix C)
- **A** — an uploaded lab/clinic PDF with a sample number, a 量康 record, or a Kino scan (`data.validated`).
- **B** — platform records: wearable syncs, questionnaire answers, plans, chat.
- **C** — old samples (>5 years), model-inferred values, or anything that conflicts with an A source.

## `users` + `user.json`
`birth_date`, `gender`, `bio_data` (height/weight/`health_conditions` from onboarding), `language`,
`wearable_brand`, `channel`. Compute the age at the report date **and** at each test date — a
2017 report says "42 岁" and that is what its reference ranges used.

## `biomarkers` — the Kino / lab records
- `test_type='kino_chip'` rows carry `data.validated` — **the user's authentic six-marker result**
  (hsCRP, IL6, GDF15, GA, CystatinC, CD38); this is the only Kino panel the report reads, grade A,
  charted and cited like any lab draw — and `data.bioage_profile` (`BioAge`, `ChronoAge`,
  `SubAges`, `Scores`, `Details.*_components`, `mFI`), computed from it. `data.actual` is raw
  reader telemetry for engineering audit only (CLAUDE.md §17): don't read it, don't compare it
  with `validated`, don't count "in-window" readings, and never describe a validated value as
  estimated, filled-in or a placeholder. Two scans two weeks apart can differ by a year for
  method reasons; say so, as you would for two lab draws.
- `test_type='health_checkup_report'` rows: `data.extracted` (per-marker value/unit/ref/status),
  `data.ai_analysis`, `data.source`/`source_zh` (e.g. 量康), `report_date`. Some of these are
  **photos of journal articles**, not the user's results — check `content_type` and the analysis
  text before treating any as a lab.
- `body_composition` rows: the onboarding height/weight.
- **How BioAge is computed** (`worker/lib/bioage/BioAgeCalculator.js`): four dimension scores
  0–10 (抗压 = ½ exp-decay hsCRP@0.5 + ½ exp-decay IL-6@1.5; 细胞 = ½ Hill GDF-15 (K 1150, n 3)
  + ½ linear CD38; 代谢 = 0.7 sigmoid GA (β 15.5) + 0.3 sigmoid BMI (β 28), ×0.9 if 抗压 < 4;
  微血管 = exp-decay Cystatin C @0.70) → mFI = (40 − total)/40 → inverse Gompertz
  ln(mFI/0.0325)/0.0415 → deviation from chrono age compressed by −6·ln(1+|x|/6) (youth) or
  12·ln(1+x/12) (aging). Sub-ages use the same pipeline per score. **Say in the report that the
  −10…−12 band is the compressor's ceiling**, not a literal 12 years — any total ≥ ~35/40 lands
  there. Since 2026-06-19 sub-ages also carry a *random* 10–12-year cap (`Math.random()` in
  `_scoreToSubAge`), so re-running identical inputs can move a sub-age by up to ±2 years; stored
  values from before that date are uncapped.

## `health_twin`
Rolling averages (`avg_hrv_ms`, `avg_resting_hr`, `avg_sleep_hours`, `avg_daily_steps`…),
`latest_lab_data.markers` (the latest lab panel, one entry per marker with `source`/`data_date`),
`latest_sub_ages`, `data_coverage`. Averages mix devices and include garbage nights — recompute
from `health_events` for the report and use `health_twin` only as a cross-check.

## `health_events`
`category` ∈ sleep / activity / vitals / body_composition / lab_result / epigenetic_result;
`source` ∈ apple_health / smart_ring / annual_lab / lab_api / document_extraction.
- **Devices are not comparable.** Apple Health HRV is SDNN; ring HRV is a different algorithm
  (~half the value). Present each device on its own page, never on one axis.
- Ring sleep rows can contain absurd single segments (a 1300-min "deep" slot); filter sessions to
  5–12 h before averaging. Ring `body_temp_c` of 34 °C is skin/bad-wear, not fever-free.
- `source='annual_lab'` rows flagged `legacy` are **batch-imported demo data** ("Waven Health
  Lab"). In Mary's case its vitamin D (52 ng/mL) contradicted five real tests (12–23). Treat as
  grade C; if it conflicts with an A source, exclude it and say so on the 阅读指南 page.
- `epigenetic_result` rows come from a `health_reports` row with `source='lab_api'`. There is no
  uploaded PDF behind it, and the record's own descriptions may reference the user's Kino values
  (a real lab would not know them) — likely platform-generated. Present it, grade it **B**, and
  say there is no source document. Don't call it cross-validation of Kino.
- **DATE columns and timezones**: node-postgres parses a DATE at local midnight and serialises a
  UTC instant (`2026-04-30` → `"2026-04-29T16:00:00Z"`). `extract.js` installs a type parser so
  every DATE arrives as a plain `YYYY-MM-DD` string; if you query the DB any other way, slice the
  first 10 characters of the *text* value and never re-parse with `new Date()`. TIMESTAMPTZ
  columns (`recorded_at`, `completed_at`) are real instants — convert to Asia/Shanghai before
  taking a calendar date.

## `health_documents` + `doc_extraction_jobs` + `health_reports` / `health_report_items`
- The documents are the richest source and the platform's extractor sees almost none of them
  (it maps only the 25-marker `biomarker_catalog`; a genome/IgG/microbiome/glycan/telomere
  report yields "0 observations"). **Always download and read the PDFs** (`download-docs.js`).
- `health_documents.filename` usually carries the real name (e.g. `林菀骐-…`) — the nickname on
  the platform may differ from the name on the reports. Use the report name in clinical contexts.
- Check `etag` for duplicate uploads (the same NAD+ report was uploaded twice; both count once).
- `health_reports.source='document_extraction'` rows link back via `source_document_id`;
  `raw_data.observations` is what the extractor mapped. `health_report_items` mirrors them.
- Text layers: 量康's PDFs have text; graphic-only result pages (糖组 tumour-risk badges) must be
  rendered (`pdftoppm -r 60 -png -f N -l N`) and read as images.

## `user_memory_facts`
`dietary_restriction` / `allergy` / `preference` / `goal` / `condition` rows. These change the
whole report (vegetarian ⇒ protein strategy, B12/D/iron scrutiny, Dot ingredient sourcing, no
fish-oil). Read them before writing anything.

## `health_plans` + `health_plan_templates` + `health_plan_checkins` + `reminders`
Which focus programmes the user joined, for how long, and — usually the point — how few
check-ins happened. Adherence is a finding.

## `nutrition_plans` + `user_cartridges` + `dots`
- `nutrition_plans` rows with `status` ∈ pending/proposed/approved/active/superseded and
  `proposed_recipe` (`{morning:{}, evening:{}, tiers:[...]}`) — the platform's auto-formulations.
  Compare your recipe against the latest one explicitly (a table of differences with reasons).
- `user_cartridges` + `dots`: which Dots the user physically holds and `remaining_dots`
  (800/800 = never opened — an adherence finding).
- `dots` formulary: `key_name`, `name_zh`, `ingredients_zh` (name + mg per dot), `timing`,
  `timing_flexible`, `target_dots_min/max`, `dosing_protocol` (`pulse` for DOT-N7), `color_hex`.
  Every count you recommend must sit inside its own min–max; capsules hold ≤72 dots each.

## `viva_ag_jobs`
Previous AG analyses: `result_summary`, `result` (structured findings, `data_gaps`,
`recommendations`), `result_files`. Read the latest one — it is a second opinion to reconcile
with, and its `data_gaps` are usually right.

## `chat_messages` (role='user' only, for the report)
Self-reported facts that never made it into `user_memory_facts`: diet detail ("我吃素的 希望增肌"),
symptoms ("今天很乏"), favourite foods ("特别喜欢臭豆腐"), goals ("我要更年轻"). Skim every
user turn; quote sparingly.

## Consistency checks to run before writing
- Height/weight/BMI agree across onboarding, lab vitals and report headers (a "51 kg / BMI 22.0"
  pair cannot both be true at 165 cm).
- The same marker across labs and units (nmol/L ↔ ng/mL for vitamin D ÷2.5; dry-blood-spot vs
  venous).
- A value that appears inside another report's *model* (the gut report prints an hsCRP "3.84" that
  is inferred, not measured) must not be plotted beside a measured one.
- Report dates vs sample dates vs upload dates — plot by sample date.

## Traps found in the premier-partner batch (2026-09-16, 41 users)
- **`lab_import` / `health_reports(source='manual_upload', institution IN ('KINO','Aeviva'))` are usually App
  screenshots** of the user's own 健康 page re-uploaded as a "lab result" — the same Kino panel the
  `biomarkers` row already holds, written back a second time. Open the image; if it shows the Aeviva header
  and the six tiles, treat it as a duplicate of that scan (not a new measurement) and cite the `kino_chip`
  row instead.
- **The photo extractor (`biomarkers.data.extracted`) misreads**: a liver-glycan "NA2F 13.40%" became
  "HbA1c 13.4%"; "乙肝表面抗体阳性" became "HBsAg 阳性"; "甲状腺未见异常" became "甲状腺结节". Never cite
  `extracted` without looking at the photo (`scripts/batch/collect_images.js` downloads them).
- **A ring serial can appear in several accounts** (`health_events.wearable_name`): Pin's `X3B 53687` showed up
  in two other users' data on the same nights. Exclude the foreign device (`EXCLUDE_DEV` in `wearable.py`).
- **Demo seeds are not only `annual_lab legacy`**: look for `external_id` like `<name>-lab-2026` /
  `<name>-sleep-dNN` (Apple Health 14-night blocks), `health_reports` ids ending `PIN01`, and a Kino row with a
  full six-item `actual` at 2026-05-06 12:3x with no device — all written the day the account was created.
- **Don't audit Kino panels** (rule added 2026-09-22): the batch originally compared `data.actual` with the
  reader window and downgraded most users' six-marker panel and BioAge to "C · 参考估算值". That is wrong for
  the report — `data.validated` is the user's result. For a user with no uploaded documents the Kino panel is
  their measured blood baseline; findings and Dots are built on it.
- **Chats hold the clinical facts** for users with no documents: medications (阿立哌唑, 安博维 + 洛活喜, 二甲双胍,
  GLP-1 intent), pregnancy, POI, HBV carriage, home BP readings, pasted CBCs. Read every user turn.


## `lab_orders` — QCS (量康) result PDFs nobody reads (found 2026-09-21)

`lab_orders` rows (`lab_name='qcs'`, imported by a one-off `import-qcs-orders` script) carry
`report_pdf_key` — an OSS key under `lab-reports/qcs/<order_id>/<goods_id>-<hash>.pdf` — for
completed dried-blood-spot panels: 维生素 D, 同型半胱氨酸, 糖化血红蛋白, 尿酸, 120 项 IgG, AMH,
NAD+, DNA 甲基化年龄, 有机酸 76 项, 基因检测, 肝脏健康评估 (N-glycan score), 免疫年龄评估.
`lab_final_result.goods[].bodyindex_panels[].bodyindexes` is **empty** — the numbers live only in
the PDF. `download-docs.js` only fetches `health_documents`, so these were missed for 23 of 41
premier partners in the 2026-09-17 batch. Always list `lab_orders`, download every
`report_pdf_key`, and note that an order with several goods stores only one key (乔通宇's
免疫年龄评估 PDF was never saved). 2021-dated orders exist (墨霏) — old panels are 体质倾向, not
current state.

## Dev is a snapshot — real uploads land on prod

Release miniapp builds talk to prod. On 2026-09-21 dev matched prod for most users but was
missing 乔通宇's 21 screenshots, 黄毅's 6 new documents, 胡仿璇's 2, and recent chat turns.
Before writing a report, compare the `extract.js` inventory on both, or extract with `--prod`
(read-only) when the user's data is what matters.
