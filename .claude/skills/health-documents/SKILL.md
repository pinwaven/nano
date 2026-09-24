---
name: health-documents
description: Rules for 健康文档 as twin data, the document-extraction external-agent queue, and 慢性食物过敏 food-sensitivity panels. Load when touching health_documents, the DOC_EXTRACT_API_TOKEN endpoints, food_catalog or food_sensitivity_* tables.
---

Moved verbatim from `CLAUDE.md` on 2026-09-19 (section numbers kept; `§N` references point at `CLAUDE.md`).

## 38. 健康文档 — Health Documents Are Twin Data — Rules

`health_documents` is twin layer 3 (§34), not an AG artifact: the 数字孪生 subtab ends with the
same 健康文档 section the AG panel has, and the endpoints ask only who the caller is. Record:
[docs/architecture/health-documents.md](docs/architecture/health-documents.md).

- **One component, two hosts**: `components/health-documents/` is extracted from
  `viva-ag-panel`, not copied into `user-health`. No `variant` prop; it carries its own root
  theme hook (the `.theme-light` class doesn't cross the component boundary) and a `lang`
  observer (the health tab is never unmounted).
- **A coach reads, never writes**: `can-upload="{{mode === 'self'}}"` hides upload/delete and
  `deleteDocument` re-checks it; `coach-id` reaches the server, where `_resolveOwner` runs the
  same coarse `users.coach_id` ownership check as `handleGetUserFacts`, only when supplied.
  `this._coachId` in `coach.js` must be mirrored into `data.coachId` at **both** assignment
  sites (`onLoad`, `_repairCoachSession`). `_refuseCoach` is intent, not enforcement.
- **The AG gate was entitlement, never access control** — it never stopped one user passing
  another's openid. What protects the object is unchanged: server-minted keys under
  `health-documents/<user_id>/`, `oss_key` never returned, 300s URLs, never via `/oss/presign`.
  Keep `health_documents.js`'s security header honest if the gate changes again.

## 39. Document Extraction — a Second External-Agent Queue — Rules

An uploaded 健康文档 is read by an external agent (`DOC_EXTRACT_API_TOKEN`, separate service from
Viva AG) and turned into twin data. Full record and every bug behind each rule:
[docs/architecture/doc-extraction.md](docs/architecture/doc-extraction.md).

- **Separate queue from `viva_ag_jobs`**, not a `job_type`: no entitlement, one job per
  **document** (`uniq_doc_extraction_active`), seconds not hours. Everything structural is
  mirrored from `handlers/viva_ag.js` (SKIP LOCKED claim, rotated `result_token` checked before
  status, lazy sweep, no EventBridge). `dex_` + 32 hex, distinct per environment, branch **above
  the `ch.` branch**, exact-path allowlist, job token in `X-Doc-Extract-Job-Token`/body, never a
  query string.
- **Known pseudonymity gap** (found live 2026-09-09): presigned document URLs are
  `health-documents/<user_id>/…`, so the agent can link two documents to one person — on
  `/doc-extract/jobs/claim`, `/viva-ag/twin-bundle` and `/viva-ag/document-url` alike. Fixing it
  means opaque keys **and** replacing `handlePostHealthDocument`'s prefix-confinement check, which
  works precisely by requiring the user_id in the key. Not a one-liner; not attempted.
- **Reuses `handlePostHealthReport`** (`source:'document_extraction'`), then **calls
  `updateHealthTwin` itself, awaited** — without that the panel never reaches
  `health_twin.latest_lab_data`. **`compute_bioage:false` is load-bearing**: an OCR'd document
  must never manufacture a BioAge (it would stamp `NOW()` and let `BiomarkerEstimator` fabricate
  the absent Kino markers). A test pins it.
- **`lib/docExtraction.js` rejects, never repairs.** Pure, no DB; also backs
  `POST /doc-extract/validate`. Its rules exist because the path it feeds doesn't check them:
  finite value (bare `parseFloat` downstream), unit matches the catalog or a hand-authored
  conversion (the model's unit otherwise overrides the catalog's), 0.1x–100x plausibility against
  `ref_low`/`ref_high` (loose on purpose — several `ref_high` are risk thresholds), the date
  parses (`report_date` otherwise backfills to today). No readable date → metadata and summary
  only, **no observations**.
- **Findings go to `user_memory_facts` (`category='condition'`, `source='document_extracted'`),
  never `users.bio_data`** (shallow `||` merge would replace `health_conditions` wholesale).
  Higher confidence floor than observations; refused without one.
- **A re-run clears the previous extraction first** — `health_events` dedupes on
  `(user_id, source, external_id)` with `DO NOTHING`, so a correction would otherwise no-op.
  `DELETE /health-reports` deletes `health_events` children explicitly (`report_id` is
  `ON DELETE SET NULL`). `'rejected'` is terminal and distinct from `'failed'` — never recreate
  what the user threw away.
- **Contract self-documents**: `GET /doc-extract/{docs,openapi.json,catalog}` +
  `POST /doc-extract/validate`. `tests/doc-extraction-contract.test.js` asserts spec paths ↔
  allowlist both ways, that the worked example validates against the real catalog, and that
  units/limits/reason codes match code. **Change an endpoint, limit or reason code → change
  `worker/docs/doc-extract-{api.md,openapi.json}` in the same commit.** Anything outside the
  catalog belongs in `unmapped`, never mapped onto a neighbour.
- `'doc_extraction_result'` is in `AI_ECHO_TYPES` (a type missing there renders the bubble twice). **Deploy order: migrate, then
  the worker.**

## 40. 慢性食物过敏 — Food-Sensitivity Panels — Rules

A 120-item food IgG report arriving through §39 takes its own path: `food_catalog`,
`food_sensitivity_panels`, `food_sensitivity_results` → a deterministic guideline in
`user_memory_facts` → chat tool + formulation emphasis → a free Viva AG review. Full record:
[docs/architecture/doc-extraction.md](docs/architecture/doc-extraction.md) §40.

- **Never `health_events(lab_result)`.** `healthTwinUpdater` keeps only the single most recent
  lab date (a food panel would evict hsCRP/LDL/eGFR), `biomarker_catalog` ranges mean something
  else, and a food's payload is a substitute, not a number. `food_key` follows §11's `key_name`
  rule — an unresolved item is **dropped and counted**, never guessed onto a neighbour (`aliases`
  exists for OCR spelling variants).
- `<0.1` is `below_detection:true` with a NULL value, never 0.1. The class is **read**, not
  derived (only bands with results are printed); a printed band is a cross-check
  (`class_band_mismatch`). An absent class is refused — `Number(null)` is 0.
- **⚠ A food-named fact can silently delete a dot.** `formulationQuality._collides` is
  bidirectional substring containment and `allergy_conflict` removes the dot from both recipes
  (`玉米` matches `玉米黄质` → deletes DOT-N8). So a fact carrying `food_key` matches only
  `food_catalog.dot_conflict_keys`, which is **empty for every seeded row** by design. A fact
  without a `food_key` keeps the prose match. **Do not close this by widening the prose match.**
  Known, pre-existing: `_ingredientNames` maps JSONB via `v.map(String)` → `"[object Object]"`,
  so the check only ever compares dot *names* today; fixing it will start deleting dots that pass
  now — measure first, keep the `food_key` guard.
- **The guideline is derived in code, never submitted.** `CLASS_WINDOWS` in
  `lib/foodSensitivity.js` transcribes the report's own 戒断方案 page. Each class ≥ 1 food → one
  short canonical fact: `category='dietary_restriction'` (**never `allergy`** — IgG is not IgE),
  `fact_zh` stays short (`避免牛奶` — it is rendered uncapped into ~14 prompts and per the hazard
  above a long sentence swallows ingredient names), window/recheck/substitutes live on the panel
  and catalog, never inside `fact_zh`. Class-0 foods are never facts. `valid_until`/`severity`
  are nullable, so existing facts are unchanged.
- **Chat**: `get_food_sensitivity`, force-queued by `messageAsksAboutFoodSensitivity`, which also
  promotes `casual_chat`/`formulate_dots` → `nutrition_question` and **must never match the
  Formulate-Dots trigger message** (test pins both). Same three §28 chat-tool rules: flat array
  with `kind` per row, dates as bare `YYYY-MM-DD` via `::text`, and **the block names no class
  threshold and no window** (they reach the model as `severity_text`/`guidance` on the row; a
  test asserts no month figure in the rendered block). No degraded branch — these are nano's
  own tables.
- **Formulation**: a live panel unions `DOT-N13` and `DOT-N14` (`GUT_AXIS_DOT_KEYS`) into
  `recommended_dot_keys` — §31's purely additive channel, **union never replace**, only
  unexpired restrictions count. Both formulation prompts state that the 5R protocol's enzymes,
  betaine HCl, L-glutamine and EFAs exist in **no** dot.
- **Review**: preset `food_sensitivity_review` auto-queued on a successful panel write, on a
  free scoped grant that audits as such. The restrictions are written **before** the job exists,
  so a failed review costs an explanation, never the guideline. **It will not flip a nano user's
  persona** — a user not already effectively Viva simply gets no review.
- `lib/extractionPrimitives.js` holds the date/number coercions shared with `docExtraction.js`.
  **GCN: nothing.** Deploy order: migrate, then the worker.
