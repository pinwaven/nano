# Data sources — where each number lives, and the traps

`scripts/extract.js` writes one JSON per table into `<outdir>/data/`. This is what each holds and
what went wrong the first time.

## Trust grading (state it on the 阅读指南 page and in appendix C)
- **A** — an uploaded lab/clinic PDF with a sample number, or a Kino/量康 record with raw values.
- **B** — platform records: wearable syncs, questionnaire answers, plans, chat.
- **C** — old samples (>5 years), model-inferred values, or anything that conflicts with an A source.

## `users` + `user.json`
`birth_date`, `gender`, `bio_data` (height/weight/`health_conditions` from onboarding), `language`,
`wearable_brand`, `channel`. Compute the age at the report date **and** at each test date — a
2017 report says "42 岁" and that is what its reference ranges used.

## `biomarkers` — the Kino / lab records
- `test_type='kino_chip'` rows carry `data.validated` (use this), `data.actual` (raw, audit only —
  never merge it over validated, CLAUDE.md §17), and `data.bioage_profile` (`BioAge`, `ChronoAge`,
  `SubAges`, `Scores`, `Details.*_components`, `mFI`). Two scans two weeks apart can differ by a
  year for method reasons; say so.
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
