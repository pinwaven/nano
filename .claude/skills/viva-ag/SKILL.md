---
name: viva-ag
description: Viva AG external deep-analysis agent rules — job queue, twin bundle, result posting — and the AI 精准营养素 AG dots-ordering flow from GCN purchase to nutrition_plans. Load when touching viva-ag endpoints, the AG queue, or ag-formulation-approved.
---

Moved verbatim from `CLAUDE.md` on 2026-09-19 (section numbers kept; `§N` references point at `CLAUDE.md`).

## 35. Viva AG — External Deep-Analysis Agent — Rules

An *external* agent spends minutes-to-hours on a user's full digital twin (including uploaded
records), pulling jobs from a nano-owned queue and posting results back into chat. Full record,
design and the verbatim historical §35: [docs/architecture/viva-ag.md](docs/architecture/viva-ag.md).
Nothing in §21–§29 applies — that machinery is for work nano performs itself.

- **Entitlement is an add-on column, not a persona.** `users.viva_ag_expires_at`, gated by
  `requireVivaAgAccess()` (`lib/vivaAgAccess.js`) — a composite of effective-persona-is-viva
  **and** a live Viva grant **and** a live AG grant, so AG can never be more permissive than the
  chatbox. `resolveEffectivePersona()` must keep returning `'nano'|'viva'` only. A `viva_ag`
  subscription plan grants **both** windows (§36). Grants audit into
  `persona_subscription_grants` with `persona_type='viva_ag'`.
- **No EventBridge, no cron.** Enqueue is one INSERT; the slow work is inside the agent; delivery
  is two INSERTs inside the agent's own `POST /result`. Lease expiry is swept lazily
  (`_sweepExpiredLeases()` at claim and at the user's job list). If that ever bites, add a scan to
  the dispatcher tick — not new infrastructure.
- **The fencing token is the whole concurrency story.** `result_token` is regenerated on every
  claim and is both the submission credential and the idempotency key, checked **before** status.
  The claim is one `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1)` — never a
  SELECT then an UPDATE. `uniq_viva_ag_jobs_active` caps one in-flight job per user and **must
  include `awaiting_input`**; `viva_ag_jobs.status` has no CHECK, so that index is the migration's
  real work. Plus a 3/day cap in the enqueue handler.
- **`VIVA_AG_API_TOKEN`** (`vag_` + 32 hex, distinct per environment): its branch in
  `worker/index.js` **must precede the `ch.` branch** (prefix match); exact-path allowlist only,
  no path params. The per-job token rides in `X-Viva-Ag-Job-Token` on GET and the body on POST —
  **never a query param** (they land in access logs). No `/viva-ag/*` response ever returns a
  `user_id`, openid or nickname; `job_uid` is the only handle; there is deliberately no
  "twin for an arbitrary openid" endpoint. (Known overstatement: presigned document URLs embed
  `user_id` in the OSS key path — see §39.)
- **The API documents itself**: `GET /viva-ag/docs` + `/openapi.json` read from
  `worker/docs/viva-ag-{api.md,openapi.json}`, which deploy with the function. Keep the spec's
  paths and `VIVA_AG_ALLOWED_PATHS` in agreement in both directions.
- **Large files never pass through FC.** Every download is a direct presigned OSS GET. **This
  bucket refuses `response-content-type` overrides** (400, not a degrade) — Content-Type is fixed
  at upload; callers must PUT with exactly the `put_content_type` the presign returned.
  `generatePresignedGetUrl` sets `Content-Disposition` (RFC 5987) only; don't re-add a
  content-type override.
- **Report files: `pdf` / `md` / `txt` only.** `wx.openDocument` cannot open markdown, so `md`/
  `txt` render in-app via `mdToHtml()` — which deliberately does **not** interpret `:::` cards,
  and `_neutralizeLinks()` flattens `[text](href)` (mp-html's `linkTap` would `wx.navigateTo`).
  Every submitted key is prefix-confined to `viva-ag-results/{job_uid}/`, type-checked and
  `headObject`-verified; any failure refuses the whole submission. Client addresses files by
  index; `oss_key` never leaves the server. `result_oss_key` is still written for legacy readers;
  `result_files` is the source of truth.
- **`dots_formulation` is a contract** (§8 of `viva-ag-api.md`), mirrored from
  `lib/dotsProductModel.js`; since §36 nano validates it and rejects non-conforming formulas.
- **`health_documents`, not `health_reports`** — twin layer 3 (§34). Soft delete only (a running
  job may hold a URL). Never route documents through `/oss/presign` (it authorizes nothing).
  Keys are minted server-side under `health-documents/<user_id>/`, registration rejects keys
  outside the caller's prefix, `oss_key` is never returned, URLs expire in 300s. Endpoints are no
  longer AG-gated (§38) — that gate was entitlement, never access control.
- **Result delivery**: `deliverTerminalMessage` writes both `chat_messages` and `notifications`,
  saved under `persona_type='viva'` — **never `'viva_ag'`** (persona-scoped history would hide
  the bubble on reload). Attribution is `chat_messages.source='viva_ag'`, selected in all three
  `handleGetChatHistory` queries. `'viva_ag_result'`, `'viva_ag_failed'` and
  `'viva_ag_questionnaire'` **must stay in `AI_ECHO_TYPES`**. `result_summary` is sanitized on
  ingest (`:::` stripped, dot codes humanized); never feed `viva_ag_jobs.result` to a later prompt
  as trusted content.
- **The agent's twin mirror is fed by `subject_ref`, never `user_id`** (2026-09-20). `viva_ag_subjects`
  mints an opaque `vs_…` per AG subject at first claim; `GET /viva-ag/twin-versions?since=` and
  `GET /viva-ag/subject-bundle?subject_ref=` are bearer-only reads (`lib/twinMirror.js`). The
  `CHANGED_AT_SQL` list there must be kept in step with the tables `buildTwinBundle` reads — a table
  read there and missing here is a change the agent sees only on its daily full pass. `twin_version`
  strips `generated_at`, presigned URLs, `job`, `job_questionnaires` and `subject.ref` before hashing;
  add any new volatile field to `VOLATILE_TOP`/`VOLATILE_DOC` or every mint reads as a change.
- **`lib/twinBundle.js` is AG-only, on purpose** — its SQL duplicates `agenticTools.js` and the
  `llmContext` builders, and unifying them would touch the contract 20+ prompts and JUDGE consume.
  Conventions: fetchers never throw, biomarkers from `data.validated`, timestamps through
  `formatToShanghai()`, **`DATE` columns cast `::text`** (node-postgres parses a DATE at local
  midnight → wrong day). `bundle_version` is 3 (v2 added `job_questionnaires`, v3 added
  `layers.medical_records.food_sensitivity`).
- **Clarifying questionnaires** (`POST /viva-ag/jobs/questionnaire`, status `awaiting_input`):
  the lease is released, the attempt refunded, rounds capped at 2. `lib/agQuestionnaire.js` is a
  **security boundary** — `save_target`/`save_field`/`completion_check`/`config.other_key` are
  never sourced from the payload (they are write paths into user data). The resume hook is
  injected from `index.js` and **awaited**. The user answers in the chat tab.
- **Miniapp**: subtab strip inside `components/user-health/`, panel in
  `components/viva-ag-panel/`, self view only. `wx.chooseMessageFile` needs the 「选中的文件」
  scope declared in the MP console's 用户隐私保护指引 — no runtime consent flow can rescue a
  missing declaration; `_choosePdf()` distinguishes cancel / scope error / other. **Never re-add a
  bare `fail: () => {}`.** Neither picker is automatable; drive `_uploadDocument` directly. Job
  polling is a 15s timer inside the panel, not `main.js`'s 3s poll.

## 36. AI 精准营养素 — the AG Dots Ordering Flow — Rules

One GCN purchase → `awaiting_formulation` → grants viva + viva_ag → AG `dots_formulation` job →
nano validates → GCN expert review → `POST /ag-formulation-approved` → `nutrition_plans`
`'approved'` → user scans the box → 56 schedules, `'active'`. Record:
[docs/architecture/ag-dots-ordering.md](docs/architecture/ag-dots-ordering.md).

- **Nano parses and validates the AG formula** (`lib/agFormulation.js`) — reversing §35's
  original "never" — because approval turns it into capsules. **Reject, never repair**: no
  clamping, no recomputing `total_dots`. Pure functions over `(parsed, dotsFormulary)`, no I/O.
  `result.formulation` (JSON) is the contract; the `.md` is a fallback. The job still succeeds
  either way; the response carries `formulation_accepted` + violations.
  `worker/docs/viva-ag-api.md` §8 must be edited alongside the rules.
- **Constants live in `lib/dotsProductModel.js`** (`PLAN_DAYS`, `MAX_DOTS_PER_CAPSULE`, `N7_KEY`,
  `N7_ISOLATION_DAY_INDEXES`) and bind `lib/formulation.js`, the validator, and API doc §8.
- **`'approved'` is created on approval with zero schedules and activated on scan** — not a
  reuse of `'pending'`. `_commitAgFormulation` is a deliberate **sibling** of the expansion
  path, not a reuse: an AG formula encodes all 56 capsules explicitly, so running it through
  `_expandPlanDay` would apply every rule twice. Capsules are written verbatim; the fill cap is
  re-applied defensively only. Don't merge the two.
- **`POST /box-claim`**: idempotent (a second scan returns the first plan), non-transferable
  (`not_your_box`), a second box from the same batch joins the existing plan; accepts a bare
  `WVB…` code or the public page URL. `box_batches.ag_formulation_id` snapshots from the
  approved formulation, not the user's active plan.
- **A `viva_ag` subscription plan grants BOTH windows** (`requireVivaAgAccess` is a composite);
  two `persona_subscription_grants` rows. `product_type` on `viva_subscription_plans`/`_codes`,
  snapshotted at mint; no new endpoint.
- The review stays in GCN; nano exposes `GET /ag-formulation-review-snapshot`. Both review
  snapshots share `_buildReviewTwinContext`. **An expert's adjustment is re-validated by nano**
  through the same validator — "a human approved it" is not a reason to skip the only check.
- Order side (GCN): flat-priced bundle, nullable `nano_nutrition_plan_id`/`recipe_snapshot`,
  new `awaiting_formulation` status (not `'paid'`, which `handleOrderShip` accepts).
  `recipe_snapshot` stays **write-once**; expert edits go to `adjusted_recipe`. Cross-repo
  notifies are fire-and-forget both ways; a `valid` formulation with NULL `gcn_order_id` is the
  query for ones that didn't land — there is no retry job.
