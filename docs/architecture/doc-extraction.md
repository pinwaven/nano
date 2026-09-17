# Document Extraction & Food-Sensitivity Panels

How an uploaded 健康文档 (a clinic note, a 体检报告 PDF, a photo of a paper printout, a 120-item
food IgG report) is read by an external agent and turned into twin data — and every bug that shaped
each rule. The rules that must hold are summarised in `CLAUDE.md` §39 and §40; this file is the
record of why.

| Neighbours | Where |
|---|---|
| The health-documents surface itself (upload, list, coach read-only) | [health-documents.md](health-documents.md) |
| Viva AG, whose queue this one mirrors structurally | [viva-ag.md](viva-ag.md) |
| The twin layers a document feeds | [digital-twin.md](digital-twin.md) |
| The contract the agent implements from | `worker/docs/doc-extract-api.md` (served at `GET /doc-extract/docs`) |

**Section numbering.** The two sections below keep their historical `§39`/`§40` numbers from
`CLAUDE.md`; they were moved here verbatim on 2026-09-15.

---

## 39. Document Extraction — a Second External-Agent Queue (2026-09-08)

An uploaded 健康文档 is now read by an external agent and turned into twin data. Same platform runs
this and Viva AG (§35); they are **separate services with separate tokens and separate queues**.

```
upload → doc_extraction_jobs 'queued'
agent   POST /doc-extract/jobs/claim   → document URL + the biomarker catalog + {age, gender, language}
agent   POST /doc-extract/jobs/result  → validated, then written
nano    health_documents metadata · health_reports + health_events · user_memory_facts
        → updateHealthTwin → one chat bubble
```

### Why not a `job_type` on `viva_ag_jobs`

| | Viva AG | Extraction |
|---|---|---|
| Entitlement | paid add-on (`requireVivaAgAccess`, 3 composed checks) | none — documents are twin data for everyone (§38) |
| Backpressure | `uniq_viva_ag_jobs_active`: one job per **user** | `uniq_doc_extraction_active`: one per **document** |
| Cost | minutes to hours | seconds |

Ten uploads should extract concurrently; what must not run twice is the same document, because
both runs race to write the same `health_events` rows. One queue would force splitting the
per-user cap by type and let a cheap backlog starve a paid run. Everything *structural* is
mirrored from `handlers/viva_ag.js` — read it before changing anything here: the
`FOR UPDATE SKIP LOCKED` claim (**never** a SELECT then an UPDATE), `result_token` rotated on every
claim as both credential and idempotency key, checked **before** status, the lazy lease sweep, and
no EventBridge or cron because the slow work is entirely inside the agent.

`DOC_EXTRACT_API_TOKEN` (`dex_` + 32 hex, distinct per environment) sits **above the `ch.` branch**
in `index.js` — that one matches on prefix. Exact-path allowlist only; the fencing token rides in
`X-Doc-Extract-Job-Token` on GET and the body on POST, never a query string.

**The pseudonymity claim in §35 is overstated, and this inherited it** (found live on dev,
2026-09-09). A presigned document URL's path is `health-documents/<user_id>/<hex>.<ext>`, so the
internal `user_id` is visible to the external agent — on `/doc-extract/jobs/claim` and, because
`presignDocuments()` is shared, on `/viva-ag/twin-bundle` and `/viva-ag/document-url` too. It is
not an openid, phone or name, but it defeats **cross-job unlinkability**: an agent can tell two
documents belong to the same person. `twinBundle.js`'s "cannot be tied back to a person from its
own contents" carries the same overstatement.

Fixing it means minting **opaque** keys for new uploads — which also means replacing
`handlePostHealthDocument`'s prefix-confinement check, the control that stops a caller registering
someone else's object, since it works precisely by requiring the user_id to be *in* the key. A
real change, not a one-liner; not attempted with this pass.

### The pipeline already existed

`handlePostHealthReport` → `biomarker_catalog` whitelist → `health_events(lab_result)` →
`handleLabImportEvent` has been there all along. Extraction adds only the step that turns a
document into the payload it accepts, and calls it in-process with `source: 'document_extraction'`.

**Then it calls `updateHealthTwin` itself, awaited.** `handlePostHealthReport` refreshes the twin
only via its `compute_bioage` branch, which is off here — so without that call the panel never
reaches `health_twin.latest_lab_data` and the whole feature does nothing visible.

**`compute_bioage: false` is deliberate and load-bearing.** `updateHealthTwin` reads BioAge only
from `test_type='kino_chip'` (`healthTwinUpdater.js:89`), so a `lab_import` row could never reach
the displayed BioAge — but it would create a biomarkers row stamped `NOW()` rather than the report
date, with the absent Kino markers **fabricated** by `BiomarkerEstimator` (which range-checks only
hsCRP; the other five are accepted on presence alone). An OCR'd document must not manufacture a
BioAge. §28 (BioAge is a precondition) already holds that line for formulation; a test pins it here.

### `lib/docExtraction.js` — reject, never repair

Pure, no DB, so the whole rule set is testable offline — and the same function backs
`POST /doc-extract/validate`. Four of its six observation rules exist because **the path it feeds
does not check them**:

| Rule | What it prevents |
|---|---|
| finite value | `handlePostHealthReport` does a bare `parseFloat`, no NaN check |
| unit matches the catalog, or a hand-authored conversion | the model's `unit` currently **overrides** the catalog's with no conversion — an mg/dL value lands in an mmol/L column reading ~18x low |
| order-of-magnitude plausibility | `biomarker_catalog.ref_low`/`ref_high` exist and nothing has ever read them |
| the date parses | `report_date` silently backfills to **today**, so a 2019 paper report enters the twin as current |

With no readable date, metadata and the summary are written and **no observations are**. The
plausibility band is 0.1x–100x, loose on purpose: several `ref_high` values are risk thresholds
rather than physiological ceilings (hsCRP's is 1.0 mg/L and real acute inflammation runs far past
it), so a tight band would refuse exactly the abnormal values that matter.

**Findings go to `user_memory_facts`, never `users.bio_data`** — those writes are a shallow `||`
merge, so `health_conditions` would be replaced wholesale by OCR output. New `'condition'` category
and `'document_extracted'` source. Held to a **higher** confidence floor than observations, and
refused outright without one: an `allergy` row filters store recommendations (§37) and reaches dot
formulation, so a misread is sharper than a wrong lab value.

### Auto-write, therefore correction

There was **no `DELETE /health-reports`** before this — only GET and POST. There is now, and it
deletes the `health_events` children **explicitly**: `report_id` is `ON DELETE SET NULL`, so
removing the parent alone orphans every observation into the twin's lab panel with nothing to trace
it back to.

**A re-run clears the previous extraction first.** Mandatory, not tidy: `health_events` dedupes on
`(user_id, source, external_id)` with `DO NOTHING`, so a corrected value for the same marker and
date would otherwise be a silent no-op and the user's correction would appear to do nothing.

`'rejected'` is a distinct terminal status from `'failed'` — a failure may be retried, but a result
the user has thrown away must never be silently recreated.

### The contract documents itself, and is meant to be implemented from alone

`GET /doc-extract/docs` + `/openapi.json`, read at module load from `worker/docs/`, which ships
inside the function (`code: ./src/functions/worker`) so it cannot drift. Behind the token, not
public. Plus two endpoints that exist purely for implementability:

- **`GET /doc-extract/catalog`** — the extraction vocabulary, generated from the live table. The
  existing vision prompt hardcodes the same 25 keys as a literal that drifts by hand; anything
  outside the list belongs in `unmapped`, never mapped onto a neighbour.
- **`POST /doc-extract/validate`** — the real validator against a candidate payload, with no job,
  no claim and no write.

`tests/doc-extraction-contract.test.js` asserts the spec's paths and the allowlist agree **in both
directions**, that the worked example in the Markdown validates against the real catalog, and that
the documented units, limits and reason codes match the code. **Change an endpoint, a limit or a
reason code and you change those two files in the same commit** — the test will say so.

### Files

New: `migration_doc_extraction_jobs.sql`, `migration_health_reports_source_document.sql`,
`migration_health_documents_summary.sql`, `migration_user_memory_facts_document_source.sql`;
`worker/handlers/doc_extraction.js` + `doc_extraction_docs.js`; `worker/lib/docExtraction.js`;
`worker/docs/doc-extract-api.md` + `doc-extract-openapi.json`; three `tests/doc-extraction-*`.
Modified: `worker/index.js`, `worker/handlers/{health_documents,health-plans}.js`,
`s.yaml`/`s-prod.yaml`, `components/health-documents/*`, `pages/main/main.js` (`AI_ECHO_TYPES` —
a type missing there renders the bubble twice), `utils/config.js`.

**Deploy order: migrate, then the worker.** The document list degrades to no extraction state if
`doc_extraction_jobs` is missing, so the wrong order is survivable rather than breaking a user's
only view of their own records.

**A food-sensitivity (IgG) panel arriving in this same submission takes a separate path** — its own
tables, its own vocabulary and its own contract section, never `health_events(lab_result)`. See
§40, and read it before touching `validateExtraction` or the result write tiers.

## 40. 慢性食物过敏 — Food-Sensitivity Panels Are Twin Data (2026-09-11)

A 120-item food IgG report uploaded as a 健康文档 (§38) is now extracted, stored, turned into a
durable dietary guideline, and used by both food advice and dots formulation.

```
upload → doc-extract agent reads the grid → food_sensitivity_panels + _results
       → deterministic guideline → user_memory_facts (dietary_restriction, severity, valid_until)
       → chat: get_food_sensitivity · formulation: gut-axis dots promoted
       → a free Viva AG review of the panel
```

Before this the repo had **no data model for a food at all** — `过敏原`, `食物过敏` and
`food_sensitivity` returned zero hits — so a user could upload a panel and nothing downstream
changed: no tool could see it, their food advice did not know about it, and their dots formula was
unchanged by a test they had paid for.

### It is NOT a lab panel, and must never enter `health_events(lab_result)`

Three independent reasons, each sufficient:

1. `healthTwinUpdater` builds `health_twin.latest_lab_data` from **only the single most recent lab
   date**. A food panel dated after the user's 体检 would replace hsCRP, LDL and eGFR in the twin's
   lab panel with 120 food titres.
2. `biomarker_catalog` is a 25-row clinical whitelist whose `ref_low`/`ref_high` express a normal
   range. A food result is a printed ordinal class 0–3, and the bands differ by lab.
3. A food's actionable payload is *what to eat instead of it*, which no biomarker has.

So: `food_catalog`, `food_sensitivity_panels`, `food_sensitivity_results`. `food_key` is the stable
handle on the same rule as `dots.key_name` (§11) — an item resolving to nothing is **dropped and
counted**, never guessed onto a neighbouring food. `aliases` exists because the source is OCR of a
printed grid and one lab spells one food two ways: the reference report prints 卵类粘蛋白 in its
results table and 卵类黏蛋白 in its own appendix, and 螃蟹 vs 蟹.

### `<0.1` is a censored value, and the class is read rather than derived

13 of the reference report's 120 values are `<0.1`. `toNumber` refuses the string, and storing 0.1
would assert a measurement the lab explicitly declined to make — so it travels as an explicit
`below_detection: true` with a NULL value, and no number is ever shown for it.

**Only bands with results are printed.** That report prints 轻度慢性过敏 (50.0-100.0) because its
subject has a class-1 result, and prints no class-2 or class-3 band at all. The class is therefore
taken as the agent read it off the page; a printed band is a cross-check (`class_band_mismatch`),
never a rule for recomputing a class. An **absent** class is refused rather than coerced —
`Number(null)` is 0, which is the one value that creates no restriction.

### ⚠ A food-named fact can silently delete a dot — hence `user_memory_facts.food_key`

`formulationQuality._collides` is **bidirectional substring containment** over dot names and
ingredient names, and `allergy_conflict` is the one quality finding the caller acts on:
`handlers/chat.js` **removes the colliding dot from both recipes**. A bare `dietary_restriction`
`玉米` matches the ingredient `玉米黄质` and would delete **DOT-N8 明眸**; 大豆 and 芝麻 have the
same shape.

So a fact carrying a `food_key` is matched against **`food_catalog.dot_conflict_keys`** instead of
against prose, and that column is **empty for every seeded row** — a food restriction removes a dot
only where a human declared the link. A countable gap beats a silent wrong deletion (§11). A fact
*without* a `food_key` — every fact that exists today — keeps the prose match exactly.
**Do not close this by widening the prose match.**

> **Known, and not caused by this work:** `_ingredientNames` maps `ingredients_zh` with
> `v.map(String)`, but the column is JSONB, so `pg` returns objects and every ingredient name
> becomes `"[object Object]"`. The allergen check therefore only ever compares against dot *names*
> today. Fixing it will start deleting dots from formulas that pass now — measure first, and do
> not undo the `food_key` guard while doing it.

### The guideline is derived in code, never submitted

`CLASS_WINDOWS` in `lib/foodSensitivity.js` is a **transcription of the report's own 戒断方案 page**
(class 1 → 1 month then a portion every 4 days; class 2 → 2 months then recheck; class 3 → 3–6
months then recheck), not a judgement. An external agent may narrate a panel; it may not decide
what a user is told to stop eating. Same division as §28 (the model ranks, the server partitions) and §37.

Each class ≥ 1 food yields **one short, canonical fact**, and all three properties are load-bearing:

- **`category` is `dietary_restriction`, never `allergy`.** IgG is not IgE. The report devotes a
  page to it and `prompts/viva/systemChat.js` already teaches it; escalating a 50.9 U/mL class-1
  titre to "allergy" is a clinical misstatement that also raises its severity in every consumer.
- **`fact_zh` stays short** (`避免牛奶`). `getFactMemoryBlock` renders facts as a flat, **uncapped**
  bullet list into ~14 prompt templates, and per the hazard above a long sentence swallows any dot
  ingredient name it contains. The window, recheck date, sources and substitutes live on the panel
  and the catalog — **never inside `fact_zh`**.
- **Only class ≥ 1.** The reference report has 117 class-0 foods; as facts they would flood every
  prompt. They stay queryable through the tool.

`valid_until` and `severity` are new nullable columns, so **every existing fact behaves exactly as
it does today**.

### Chat — the same shape as §28's `get_formulation_packages`

`get_food_sensitivity` is force-queued by `messageAsksAboutFoodSensitivity`, because PLAN decides
`tools_needed` with an LLM and 「我能喝牛奶吗」 cannot depend on it. The regex is anchored on food
and reaction vocabulary and **must never match the Formulate-Dots trigger message**, which rides the
same `runAgenticTurn`; a test pins both halves. The same regex promotes `casual_chat` and
`formulate_dots` to `nutrition_question` — `casual_chat` is not in `HIGH_RISK_INTENTS` and has no
tools at all, so the one question the panel exists to answer would be answered from nothing.

Three rules from §28's chat tool carry over unchanged and are not optional:

- **A flat array with a `kind` per row**, never a `{panel, items}` wrapper — `extractToolGroundTruth`
  normalises with `Array.isArray(data) ? data : …`, so a wrapper harvests nothing and
  `verifyBiomarkerGrounding` rewrites a correct answer away as fabrication.
- **Dates as bare `YYYY-MM-DD`, via `::text` in SQL.** `pg` parses a DATE at local midnight;
  `formatToShanghai` returns an offsetless string that `addDate` re-parses in the process timezone
  (UTC on FC) and re-applies +8 to, so anything ≥16:00 Shanghai lands a day late.
- **The block names no class threshold and no window.** Those live in `CLASS_WINDOWS` and reach the
  model already written on the row as `severity_text`/`guidance`. A prompt restating them would be a
  second definition of a clinical instruction in the one medium where drift is invisible. A test
  asserts no month figure appears in the rendered block.

There is **no degraded branch**, unlike `get_formulation_packages`: these are nano's own tables, so
an empty result genuinely means "no panel uploaded" rather than "the far side is down".

### Formulation — §31's additive channel, and nothing new

A live panel unions the gut-axis dots into `recommended_dot_keys`, the same purely-additive channel
a health-plan focus uses (`_fallbackCountForDot` lifts a recommended dot to 75% of its own range and
demotes nothing). **Union, never replace** — a focus and a panel are two independent reasons to
emphasise a dot.

| dot | why |
|---|---|
| **DOT-N13 肠道焕新** | *Bacillus coagulans / subtilis* — the report's own 5R "Reinoculate/Repair" |
| **DOT-N14 免疫韧性** | β-glucan — the immune arm |

**Only an unexpired restriction counts**, or a temporary finding silently becomes permanent.

**Be honest about what the formulary cannot do.** The report's 5R protocol also prescribes digestive
enzymes, betaine HCl, L-glutamine and essential fatty acids, and **none of the 18 dots contains any
of them**. Both formulation prompts say so explicitly. Whether DOT-N16 (quercetin — real mast-cell
stabilisation, but the dot targets Micro-Vascular Age) belongs on the list is a clinical call; it is
a named constant so it is one edit.

### The review — Viva AG, on a free scoped grant

A fifth preset, `food_sensitivity_review`, auto-queued on a successful panel write.
`bundle_version` is now **3**: additive `layers.medical_records.food_sensitivity`, carrying the
whole panel plus an `assay_note` stating the IgG/IgE distinction.

**The review is narration; the guideline is nano's.** The restrictions are written before the job
exists, so a slow, refused or unclaimed review costs an explanation and never the restrictions —
the split §36 draws.

**It will not flip a nano user's persona.** `requireVivaAgAccess` needs effective-persona-is-viva,
and the only way to give that to a nano-channel user is `persona_override_type = 'viva'`, which
switches their whole assistant's brand, prompts and persona-scoped chat history. Rebranding
someone's assistant as a side effect of uploading a PDF is not a trade this is allowed to make, so a
user who is not already effectively Viva simply gets no review. Everything else still works for
them. Both grants audit into `persona_subscription_grants` with their own note, so a free review
never shows as a purchase.

### Files

**New** — `src/schemas/migration_{food_catalog,food_sensitivity_panels,food_sensitivity_results,user_memory_facts_food}.sql`;
`worker/lib/{foodSensitivity,extractionPrimitives}.js`; `worker/handlers/food_sensitivity.js`;
`worker/prompts/chat/foodSensitivityBlock.js`; `components/health-documents` unchanged;
`tests/food-sensitivity-{validation,derivation,tool}.test.js`.

**Modified** — `worker/lib/{docExtraction,agenticTools,agenticChat,formulationQuality,twinBundle}.js`;
`worker/handlers/{doc_extraction,chat,dots,viva_ag,viva_subscription}.js`; `worker/index.js`;
`worker/prompts/chat/{intentClassifier,planTemplate}.js`; `worker/prompts/viva/judgeTemplate.js`;
`worker/prompts/{nano,viva}/chat/nutrition.js`; `worker/prompts/{nano,viva}/systemFormulaGenerate.js`;
`worker/docs/doc-extract-api.md` + `doc-extract-openapi.json` + `viva-ag-api.md` + `viva-ag-openapi.json`;
`components/user-health/*`; `utils/config.js` (VERSION).

**GCN: nothing.**

`lib/extractionPrimitives.js` holds the date/number coercions `docExtraction` and `foodSensitivity`
share, so a food panel and a lab panel arriving in the same submission cannot apply different date
rules. Deploy order, as §39: **migrate, then the worker.**

