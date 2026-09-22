# Extended panels — design

*2026-09-22. Design only; nothing here is built. Companion to
`doc-extraction.md`, `digital-twin.md` and Curia's `docs/twin-mirror-plan.md`.*

## Why

The catalog is one list doing three jobs: what feeds BioAge (the 6 Kino
markers), what rules and formulation may act on (the 86), and what the twin
*recognises*. The third should be far wider than the second, and today it is
the same list — so everything a real report prints outside the 86 is dropped
or parked as `unmapped`.

Measured on the two subjects whose documents have been extracted so far (127
completed jobs, dev + prod): 3,398 unmapped occurrences over 1,071 distinct
labels. Of one subject's 21-page report, ~120 numeric measurements → 24 kept,
4 keyed. The loss splits into six layers, and only one of them is catalog
breadth:

| layer | evidence | fix lives in |
|---|---|---|
| **units and casing** | 38 catalogued markers still fell through: `ng/ml` vs `ng/mL` (CEA, NSE, SCC, AFP); B12/folate/25-OH-D in ng/mL against a pmol/nmol catalog; `µIU/mL` vs `mIU/L` | a unit registry (§3) |
| **values in prose** | 肌酐, 尿酸, 糖化, TSH quoted inline with the unit on the *reference*, not the value | the reader (§7) |
| **comparison pairs** | `TSH 3.837 → 6.060`: baseline kept, current lost, dated to the wrong round | the reader + `measured_at` (§5, §7) |
| **matrix** | serum 钙/镁/锌/硒/铁 refused because only `Hair*` keys exist — a correct refusal with no serum key to land on | panels (§2) |
| **catalog breadth** | ~230 genuine analytes across eight report families | panels (§4) |
| **kinds with no home** | 161 genetic risks × 5 fields, 134 microbiome taxa + metabolites, organ/immune/ovarian ages, scores | kinds (§6) |

## 1. Tiers — what may act on what

`biomarker_catalog.tier ∈ {core, standard, extended}`.

| tier | members | feeds BioAge | rules / formulation / AG claims | stored · history · shown |
|---|---|---|---|---|
| `core` | the 6 `is_kino_core` | yes | yes | yes |
| `standard` | the other 80 today | via `nano_dimension` (19 of them) | yes | yes |
| `extended` | this design | never | **never, unless promoted** | yes |

**Promotion is a migration, not a rule.** The rule loader (`lib/agFormulation.js`,
health-advice tools, the AG contract's `claims[].edge` inputs on Curia's side)
validates every referenced key against `tier` at load; a rule naming an
`extended` key fails to load. The only way to act on a new marker is to move it
to `standard` in a migration that says why — which is where a reference range
and a `nano_dimension` get decided, by a person.

Widening what the twin *holds* must not widen what the system *asserts*. That
sentence is the whole tier model.

## 2. Panels — the unit of organisation

A flat list of 250 keys is unmaintainable and, worse, lets a hair value and a
serum value share a name. Every key belongs to exactly one panel, and a panel
fixes the **matrix**:

```sql
biomarker_panels (
  panel_key     TEXT PRIMARY KEY,   -- 'thyroid', 'hair_minerals', 'organic_acids' …
  name_zh, name_en TEXT,
  matrix        TEXT NOT NULL,      -- serum | plasma | whole_blood | dbs | urine | hair | saliva | stool
  unit_basis    TEXT,               -- e.g. 'per mmol creatinine' for urine organics
  vendor_families TEXT[],           -- masthead phrases that identify the panel on a page
  sort_order    INTEGER
);
biomarker_catalog + panel_key TEXT REFERENCES biomarker_panels, tier TEXT NOT NULL DEFAULT 'standard'
```

What a panel gives for free: display grouping (health tab and AG bundle), a
default unit system, matrix scoping for the reader (a `Zn` on a page whose
masthead says 头发 is `HairZn`; on a 生化 page it is `Zn`; on neither it is
refused — Curia's `SAMPLE_SCOPED` rule, generalised), and a natural place for
panel-level rules (urine organics are creatinine-normalised; a DBS lab prints
D2 and D3 separately and the total is their sum).

Existing 86 keys get `panel_key` too (thyroid, lipids, cbc, liver, renal,
tumor_markers, hair_minerals, hormones, metabolic, inflammation, aging,
cellular, vitals) — a relabelling of `category`, not a change in behaviour.

## 3. Units — normalise, then convert, and keep the printed one

Today nano converts a fixed list of mg/dL alternates and refuses the rest;
Curia's `units.ts` predicts the refusal and demotes to unmapped. The four
tumour markers lost to `ng/ml` say the comparison is byte-exact.

**Normalisation first**, in one function both sides share by contract:
case-fold the unit; fold `µ`/`μ`/`u` (`µmol/L` = `μmol/L` = `umol/L`); trim;
map spelling variants (`mIU/L` = `µIU/mL` = `uIU/mL`; `µg/L` = `ng/mL`;
`10^9/L` = `×10⁹/L` = `10*9/L`).

**Then a per-key conversion table**, because molar factors are per analyte:

| key | canonical | accepted alternates → factor |
|---|---|---|
| VitaminB12 | pmol/L | ng/mL ×738 · pg/mL ×0.738 |
| Folate | nmol/L | ng/mL ×2.266 |
| VitaminD (and D2, D3) | nmol/L | ng/mL ×2.496 |
| Estradiol | pmol/L | pg/mL ×3.671 |
| Testosterone | nmol/L | ng/dL ×0.0347 · ng/mL ×3.467 |
| Cortisol | nmol/L | µg/dL ×27.59 |
| Insulin | mIU/L | µIU/mL ×1 |
| TSH | mIU/L | µIU/mL ×1 |
| Ferritin | ng/mL | µg/L ×1 |
| Creatinine | µmol/L | mg/dL ×88.4 |
| FPG / glucose | mmol/L | mg/dL ÷18.02 |
| cholesterol keys | mmol/L | mg/dL ÷38.67 |
| Triglycerides | mmol/L | mg/dL ÷88.57 |
| UricAcid | µmol/L | mg/dL ×59.48 |
| bilirubins | µmol/L | mg/dL ×17.1 |
| Ca | mmol/L | mg/dL ×0.2495 |
| Mg | mmol/L | mg/dL ×0.4114 · mEq/L ×0.5 |
| Zn / Cu (serum) | µmol/L | µg/dL ×0.153 / ×0.157 |
| Fe (serum) | µmol/L | µg/dL ×0.179 |
| Hemoglobin, Albumin, TP | g/L | g/dL ×10 |

Stored per observation: the **printed** value and unit verbatim (`source_text`
already), the canonical value and unit, and `converted: true|false`. A unit that
normalises to nothing in the table is still refused — that rule stays; the
table just has to cover what Chinese labs actually print.

## 4. The panels

"Seen" = printed on a document already extracted; "sibling" = the rest of the
same vendor panel, added so the panel is whole. Keys are `PascalCase` like the
existing catalog; every key gets `display_name_zh`, `aliases`, a canonical
unit, and **no `ref_low`/`ref_high`** — an extended key displays the range
printed beside the value and nothing else.

### 4.1 `thyroid` (extends the 4) — serum
TT3 (nmol/L, seen), TT4 (nmol/L), TgAb (IU/mL), TRAb (IU/L), rT3 (nmol/L), Thyroglobulin (ng/mL).

### 4.2 `sex_hormones` (extends AMH, Estradiol, Testosterone) — serum
FSH (IU/L, seen), LH (IU/L), Progesterone (nmol/L), Prolactin (mIU/L), DHEAS (µmol/L), SHBG (nmol/L), FreeTestosterone (pmol/L), Inhibin B (pg/mL). Cycle-phase context matters for E2/FSH/LH/progesterone: the reader keeps a printed phase note (卵泡期/黄体期) as `ref_text`, never derives one.

### 4.3 `vitamins` (extends B12, Folate, VitaminD) — serum / DBS
VitaminD2 (25-OH-D2, nmol/L, **seen 20×** from a DBS lab), VitaminD3 (25-OH-D3, nmol/L, seen), VitaminA (µmol/L), VitaminE (µmol/L), VitaminK2 (ng/mL, seen), VitaminB1 (nmol/L), VitaminB2 (ng/mL, seen), VitaminB3 (ng/mL, seen), VitaminB6 (PLP, nmol/L), VitaminC (µmol/L), CoQ10 (µmol/L). Panel rule: when a page prints D2 and D3 and no total, `VitaminD = D2 + D3` is *derived* and marked so.

### 4.4 `serum_minerals` — serum / whole blood
Ca (mmol/L, seen), IonizedCa (mmol/L), P (mmol/L), Mg (mmol/L, seen), Zn (µmol/L, seen), Cu (µmol/L), Se (µg/L, seen), Fe (µmol/L, seen), TIBC (µmol/L), TransferrinSat (%), Iodine (urine, µg/L — lives here for want of a urine-minerals panel), BloodPb, BloodHg, BloodCd (seen, and its printed unit was suspect), BloodAs, BloodAl (µg/L). Matrix: blood. **Never share a key with `hair_minerals`.**

### 4.5 `hair_minerals` (extends the 11) — hair, µg/g
Seen on a real 头发矿物质 report: Na, K, P, S, I, B, Li, Cr, Mn, Co, Ni, Sr, Mo, Sn, Ti, V, Ge, Zr, Sb, Ba, Pt, Rb, Ag, Be, Bi, Tl, U, Th. Same matrix and unit as the existing `Hair*`, so this is the cheapest panel to complete.

### 4.6 `immune_subsets` — whole blood, %
Vendor terminology varies; keys are generic and aliases carry the vendors' phrases. Seen (one vendor): CD3 T, CD4 T, CD8 T, CD4/CD8, NK (CD16+56+), B (CD19), Treg, Tfh, Th17, NaiveCD4, NaiveCD8, EffectorMemoryCD4, TerminallyDifferentiatedCD8 (终末分化 CD8+T), SenescentCD8 (衰老 CD8+T, CD28⁻CD57⁺), TerminallySenescentCD8, ExhaustedCD8 (功能阻断性, PD-1⁺), ExhaustedTNK, DoublePositiveT, GammaDeltaVd1, GammaDeltaVd2, ViralSpecificVd1/Vd2, plus the same lab's 免疫综合评分 and 免疫年龄, which are **indices** (§6), not subsets. ~25 keys.

### 4.7 `cytokines` (extends IL6) — serum, pg/mL
IL1b, IL2, IL4, IL8, IL10 (seen), IL17A (seen), IFNg (seen), TNFa. **Only from a serum panel**: the same names printed by a microbiome report are modelled and stay in the microbiome kind.

### 4.8 `organic_acids` — urine, mmol/mol creatinine
Seen on one 有机酸 report: 马尿酸 (hippurate), 苯乳酸 (phenyllactate), 犬尿烯酸 (kynurenate), 4-羟基苯乙酸, 二羟基苯丙酸 (DHPPA), α-羟基丁酸, 磷酸. The standard panel is ~40: energy (lactate, pyruvate, citrate, cis-aconitate, isocitrate, α-ketoglutarate, succinate, fumarate, malate, HMG), fatty-acid (adipate, suberate, ethylmalonate), neurotransmitter metabolites (VMA, HVA, 5-HIAA, quinolinate, kynurenate), B-vitamin markers (methylmalonate, xanthurenate, pyridoxate, glutarate), detox (hippurate, orotate, pyroglutamate, 2-hydroxybutyrate), microbial (benzoate, phenylacetate, p-hydroxyphenylacetate, DHPPA, arabinose, tartarate), oxidative (8-OHdG). Panel rule: values are per mmol creatinine; a page that prints µmol/L without creatinine is refused.

### 4.9 `chemistry_extended` — serum, the loose ends
Electrolytes Na K Cl HCO3; C-peptide (nmol/L, seen); coagulation PT, APTT, INR, D-dimer, Fibrinogen; ESR; Lp-PLA2, hs-Troponin, NT-proBNP; whole-blood viscosity (seen; unit mPa·s); Amylase, Lipase; TotalBileAcids.

Roughly **150 keys** across nine panels from what has been seen plus siblings. The prod queue (131 documents, 18 users, unread) is what re-ranks this list; the design does not depend on the ranking, the seeding order does.

## 5. Provenance and state — two columns that make widening safe

On `health_report_items` / observations:

- `provenance ∈ {primary_lab, secondary_quoted, vendor_model, self_report, device}`. A lab printout is `primary_lab`. A plan that *quotes* a lab (乔通宇's 21 pages) is `secondary_quoted`. A number a vendor's model produced (microbiome-derived 维生素D, organ age) is `vendor_model` and never enters `lab_history` as a measurement.
- `state ∈ {measured, doubtful_at_source, needs_retest, superseded}`. Read off the page: 「需复查」「疑为采血影响」 beside a value sets `doubtful_at_source`; a primary result for the same key and date supersedes a secondary one. `latest_lab_data` excludes anything not `measured`; the health tab shows it greyed with the reason.
- `measured_at` distinct from `doc_date`, for comparison reports: when the document declares rounds (「首轮 2025-10-11～23」「复评 2026-07-28～08-05」), each value of a pair is dated by its round. No defensible date → unmapped, as today.

## 6. Kinds — the three things that are not biomarkers

Each is its own table, its own bundle section, and carries the same sentence:
**it may position and emphasise, and may never assert.** Nothing in these
tables becomes a case value on Curia's side, feeds a rule, or is compared
against a range nano owns.

- **`genetic_findings`** — (user, document, vendor, kind ∈ {disease_risk, pgx, trait, carrier}, name_zh/en, gene/rsid?, risk_multiple, lifetime_risk_pct, population_pct, tier ∈ {high, elevated, average, low}, source_ref). Layer 4. The one slice that becomes a *fact* is PGx: `medication_caution:<drug>` tags, because a drug reaction is about the person. Whether lifetime risks are shown to the user at all is a product/ethics decision, not a schema one.
- **`microbiome_results`** — (user, sample_date, vendor, level ∈ {phylum, genus, species, metabolite, pathogen, index}, name, value, unit, ref_text, flag). Diversity, F/B, SCFA, taxa, the pathogen ND panel. Never promoted to a nutrient or a cytokine.
- **`health_indices`** — (user, at, vendor, model, key, value, unit, ref_text, document). `organ_age.liver`, `immune_score`, `immune_age`, `ovarian_age`, `menopause_age_predicted`, `fertility_score`, `longevity_index`, `sleep_score`. The bundle presents them as `layers.medical_records.third_party_indices`, beside — never inside — `bioage_profile`, so two models of "biological age" are never quoted as one.

## 7. What the readers have to change (Curia side, contract 5)

Catalog on the claim gains `tier`, `panel_key`, `matrix`, `unit_alternates`, and a `panels[]` list. Then, in order of recovered value on the documents seen:

1. Unit normalisation + per-key conversion (the table in §3), before the catalog lookup. Recovers B12/folate/D/E2 and the `ng/ml` tumour markers on every report.
2. **Pairs become candidates**, not only table rows: a layout `pair` whose value carries a unit, *or* whose reference carries the unit (`促甲状腺激素 6.060 ↑ 0.300–4.500 µIU/mL`), goes through the same `readLine` promotion. 1,266 of the 3,398 occurrences were pairs the layout had already found.
3. **Comparison pairs**: `A → B` with a unit, on a document whose header declares rounds, yields two observations with two `measured_at`. Without declared rounds, only `B` (the current) is taken and `A` is dropped — never the reverse, which is what happened.
4. **Panel scoping from the masthead**: a page that says 头发 scopes to `hair_minerals`; 有机酸/尿 to `organic_acids`; 淋巴细胞亚群 to `immune_subsets`. An element symbol on a page with no matrix cue is refused — the existing hair/serum zinc rule, generalised.
5. Provenance read off the document type: the layout model already says whether the page is a lab printout or a plan quoting one; that becomes `provenance`.
6. `doubtful_at_source` from the phrases around a value (需复查, 疑为, 待确认, 未复查).

## 8. Invariants, and the tests that hold them

- No key in two panels; no two panels share a matrix *and* a key name; aliases unique across the catalog (Curia's `REFUSED`/`VETO` discipline, applied at seed time).
- A rule that names an `extended` key fails to load. Test: write one in, watch it fail.
- `latest_lab_data` contains only `provenance ∈ {primary_lab, device}` and `state = measured`. Test: a `secondary_quoted` and a `doubtful_at_source` row, neither reaches the panel.
- Every conversion in §3 round-trips within rounding. Test over the table.
- `health_indices` never joins `lab_history`; `microbiome_results` never writes a catalog key. Structural tests, `stripComments` first.
- Reader fixtures, one per panel family already seen: a hair report, an organic-acids report, an immune-subset report, a DBS lab with D2/D3, a comparison plan with rounds. Each asserts what is keyed, what is unmapped, and what is refused.

## 9. Rollout

1. **Units and casing** — nano `validate` + Curia `units.ts`. No schema. Immediate; measurable on the 38 alias-misses.
2. **Provenance / state / measured_at** — additive migration; readers start filling them.
3. **`biomarker_panels` + `tier` + `panel_key`** — migration; relabel the 86; seed §4.5 and §4.1–4.4 first (small, seen); contract 5 ships the fields.
4. **Kinds** — three tables, bundle sections, health-tab display.
5. **Reader** — pairs, comparison pairs, panel scoping, doubt phrases; fixtures per family.
6. **Drain the prod queue** (grouping is in place), re-run the frequency table over 18 users, seed the remaining panels from what it says.

## 10. Open decisions

- **Ranges for extended keys**: printed-only (this design) versus curated vendor ranges later. Printed-only is the honest default and the only one that needs no clinical sign-off.
- **Where extended values appear** in the miniapp: in the main health tab, or under 「更多指标」 so the acted-on set stays visually distinct.
- **Genetic lifetime risks**: stored, yes; *shown* to the user — a decision about the product, with the same weight as §11 questions on Curia's side.
- **Curia's report**: a 「文件记录的检测值」 section printing extended values and indices as measurements with their source — the same status `priorReports` already has. Worth adding, once provenance exists to print beside them.
