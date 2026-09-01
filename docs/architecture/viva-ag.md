# Viva AG — External Deep-Analysis Agent

**Viva AG (Advanced Generation)** is an *external* AI agent that spends minutes-to-hours deeply
analyzing a user's complete digital twin — including PDFs and photographs of hospital records the
user uploads — and reports back through the chat they already use. Nano owns a job queue; the
agent **pulls** from it, reads a twin bundle, and posts a result back.

Everything in §21-§29 of `CLAUDE.md` (the agentic PLAN→GENERATE→JUDGE→REVISE loop, its async
CloudEvent delivery, the daily check-ins) describes work **nano performs itself** under a hard
~250s budget. None of it applies here. Viva AG is the opposite shape: nano does almost nothing and
waits, possibly for hours, on a system it does not run.

Added 2026-08-23. Companion docs: the external contract is served live at `/api/viva-ag/docs` and
lives at [`src/functions/worker/docs/viva-ag-api.md`](../../src/functions/worker/docs/viva-ag-api.md);
`CLAUDE.md` §35 is the short version of this document.

---

## 1. Shape of the system

```
   ┌──────────── miniapp (health tab → Viva AG subtab) ────────────┐
   │  upload records          issue a command        read results  │
   └───────┬────────────────────────┬──────────────────────┬───────┘
           │ POST /health-documents │ POST /viva-ag/jobs    │ GET /viva-ag/jobs
           ▼                        ▼                       ▲
   ┌───────────────────────────────────────────────────────────────┐
   │  nano-worker            health_documents ──┐                  │
   │                         viva_ag_jobs ──────┤                  │
   └───────▲──────────────────────┬─────────────┼──────────────────┘
           │ claim / result       │ twin bundle │ chat_messages + notifications
           │                      ▼             ▼
   ┌───────┴────────────┐   ┌──────────┐   ┌─────────────┐
   │  EXTERNAL AGENT    │   │   OSS    │   │  chat tab   │
   │  (pulls, off-site) │◄──┤ (direct) │   │  (the user) │
   └────────────────────┘   └──────────┘   └─────────────┘
```

The agent never receives a user identity. It is handed a `job_uid` and a pseudonymous bundle.

---

## 2. Entitlement — an add-on, not a persona

`users.viva_ag_expires_at TIMESTAMPTZ` (migration `migration_users_viva_ag_expiry.sql`), checked
by `hasActiveVivaAgAccess()` in `lib/persona.js`.

**The regular chatbox stays powered by Viva; AG is only active inside the health tab's AG subtab.**
This is why it is a separate column rather than a third `persona_override_type` value:
`resolveEffectivePersona()` must keep returning `'nano' | 'viva'` only. A third value would
propagate into every prompt-routing site (`prompts/<persona>/*`), `chat_messages.persona_type`
(which is what makes chat history queryable per persona), and the dispatcher's inlined SQL copy of
the persona rule — for a feature that changes none of them.

### The composite gate

Every server-side surface goes through `requireVivaAgAccess(openid)` in `lib/vivaAgAccess.js`,
which returns `{ok:true, user, persona}` or `{ok:false, reason, error}`. "Has access" means **all
three**:

1. effective persona is `viva`
2. `hasActiveVivaAccess()` — a live Viva grant
3. `hasActiveVivaAgAccess()` — a live AG window

Conditions 1-2 mirror `handlePostChat`'s existing paywall (`handlers/chat.js`) exactly. That
matters: `hasActiveVivaAccess()` is true only for an explicit **per-user override**, so a user
whose Viva persona comes from the channel default with no grant of their own fails it — which is
precisely what the chatbox already does to them. Mirroring it keeps AG consistent with the chatbox
instead of inventing a second, looser definition of "is a Viva subscriber". AG can never be more
permissive than Viva itself.

Reasons are distinguishable (`viva_inactive` vs `viva_ag_inactive`) so a client can route the user
to the right upsell.

### Where it is enforced

| Surface | Gate |
|---|---|
| Subtab visibility | `viva_ag_active` from `GET /viva-subscription-status` → **client-side, cosmetic only** |
| `GET /health-documents/presign` | `requireVivaAgAccess` |
| `POST /health-documents` | `requireVivaAgAccess` + oss_key prefix check |
| `GET /health-documents` | `requireVivaAgAccess` |
| `GET /health-documents/{id}/url` | `requireVivaAgAccess` + row ownership |
| `DELETE /health-documents/{id}` | `requireVivaAgAccess` + row ownership |
| `POST /viva-ag/jobs`, `GET /viva-ag/jobs*` | `requireVivaAgAccess` |
| External `/viva-ag/*` | **not** entitlement-checked — job-scoped, and a job is only creatable by an entitled user |

### Granting

Admin-only for v1: `handlePostAdminUserVivaAg` / `handleDeleteAdminUserVivaAg`
(`handlers/persona_subscriptions.js`), routed at
`POST|DELETE /admin/users/{userId}/viva-ag-subscription`, surfaced in the admin panel's
`PersonaSubscriptionModal` (Users tab → row action). Deliberately **not** routed through
`grantPersonaOverride`/`ALLOWED_PERSONA_TYPES` — that Set guards `persona_override_type`, which
must stay `nano|viva`.

Stacking mirrors `grantPersonaOverride`: a grant extends a live window, or restarts from now on an
expired/absent one. Every grant and revoke writes a `persona_subscription_grants` row with
`persona_type = 'viva_ag'`; the modal's existing history table renders those with no query change.

**Redeem codes / GCN checkout are deferred.** The clean upgrade is one migration —
`product_type TEXT NOT NULL DEFAULT 'viva'` on both `viva_subscription_plans` and
`viva_subscription_codes` (snapshot at mint time, as `duration_days` already is), plus a branch in
`_extendUserSubscription`. No new endpoint and no new GCN allowlist entry;
`POST /viva-subscription-checkout-confirmed` already takes a `plan_key`. This is written into the
migration comment so the path is obvious to whoever picks it up.

---

## 3. Data model

### `health_documents`

Migration `migration_health_documents.sql`. User-uploaded records: PDFs and photographs.

```
id, user_id → users, oss_key (UNIQUE), filename, content_type, size_bytes, etag,
doc_type, doc_date (nullable DATE), institution, note,
status ('active' | 'deleted'), uploaded_by, created_at, deleted_at
```

`doc_type` ∈ `hospital_record | lab_report | imaging | discharge_summary | prescription | other`
— the **semantic** category the user picked, independent of the file's format.

**Accepted formats** are the keys of `CONTENT_TYPE_BY_EXT` in `handlers/health_documents.js`,
which is the single source of truth: PDF, Word (`doc`/`docx`), Excel (`xls`/`xlsx`), PowerPoint
(`ppt`/`pptx`), and images (`jpg`/`jpeg`/`png`/`heic`/`heif`/`webp`/`bmp`/`gif`). Accepting only
PDFs meant asking users to convert files on a phone, which they will not do. That map's value is
also what gets **signed into the presigned PUT** — this bucket refuses a content-type override at
download time, so upload is the only chance to set it correctly — and is what the external agent
branches on. Adding an entry there is all that is needed to accept a new format end to end.

**Why not `health_reports`.** That table means "a parsed lab report": `report_date` is mandatory,
`raw_data` carries observations, `health_events.report_id` children hang off it, and it backs
`get_health_reports` plus the twin's Medical Records rendering. A discharge summary PDF has no
observations and often no reliably parseable date. Overloading it would conflate "parsed lab panel"
with "arbitrary document blob" across several existing readers.

**Delete is a soft delete.** A running job can hold a 6-hour presigned URL for hours and snapshots
document ids in `viva_ag_jobs.document_ids`; hard-deleting the object breaks the job mid-run and
hard-deleting the row breaks that snapshot. The row disappears from every user-facing list
immediately. Cost: orphaned OSS objects — **open follow-up:** a purge job for rows with
`deleted_at < NOW() - 30 days` and no non-terminal job referencing them.

Digital Twin classification: **layer 3, Medical Records** (see
[digital-twin.md](digital-twin.md) and `CLAUDE.md` §34, which requires every new health data
surface to declare its layer).

### `viva_ag_jobs`

Migration `migration_viva_ag_jobs.sql`. The queue itself.

| Group | Columns |
|---|---|
| Identity | `id`, `job_uid` (UNIQUE, uuid — the only handle the agent sees), `user_id`, `channel_id` |
| Snapshot | `persona_type` (always `viva`), `language`, `document_ids BIGINT[]` |
| Request | `command_key`, `command`, `params JSONB` |
| State | `status`, `priority`, `attempts`, `max_attempts` |
| Lease | `claimed_by`, `claimed_at`, `claim_expires_at`, `heartbeat_at`, `progress_note`, `result_token` |
| Result | `started_at`, `completed_at`, `result JSONB`, `result_summary`, `result_files JSONB`, `result_oss_key`, `error_reason` |
| Delivery | `notification_id`, `chat_message_id`, `delivered_at` |

Indexes: a partial index on the queued head for the claim path, one on `claim_expires_at` for the
sweep, one on `(user_id, created_at DESC)` for the user's list, and
`uniq_viva_ag_jobs_active` — a partial UNIQUE on `user_id WHERE status IN
('queued','claimed','processing')`, i.e. **one in-flight job per user, enforced at the DB** so a
double-tap cannot race past the handler's own pre-check.

`notification_id` / `chat_message_id` are plain `BIGINT`, not FKs: notifications are read
destructively and there is no delete-cascade contract worth inheriting; a dangling id is fine for
correlation.

**Results live on the job row, not a child table** — strictly 1:1, and nothing reads a result
without its job. Mirrors how `nutrition_plans` holds its own committed recipe. Add a
`viva_ag_findings` child table only if the product ever needs per-finding accept/dismiss.

### Lifecycle

```
queued ──claim──▶ claimed ──bundle fetch / heartbeat──▶ processing
   ▲                 │                                      │
   └─────────────────┴──── lease expiry & attempts < max ────┘
   ▲                 lease expiry & attempts >= max ──▶ failed  (+ chat message)
   │
   │  processing ──POST /jobs/questionnaire──▶ awaiting_input   (+ chat message + form)
   └──────────────────── user completes the form ─────────────┘
      awaiting_input ──7 days unanswered──▶ failed  (+ chat message)

   processing ──POST /jobs/result──▶ completed (+ chat message)
   processing ──POST /jobs/fail (non-retryable)──▶ failed (+ chat message)
   queued | awaiting_input ──user cancels──▶ cancelled
```

Cancel applies to a `queued` or `awaiting_input` job — the two states where nobody is working. Once
a worker holds the lease, cancelling would leave it working on something nobody will accept; let it
finish or let the lease expire. `awaiting_input` is cancellable for the opposite reason: the job is
parked on the *user*, and "I'm not going to answer this" is a decision only they can make.

---

## 4. Concurrency: the fencing token is the whole story

`result_token` is regenerated on **every** claim. It is simultaneously:

- the credential for reading that job's twin bundle and submitting its result, and
- the idempotency key.

A worker whose lease expired and was re-claimed by someone else holds a stale token and is
rejected with `invalid_token`, so **two workers can never both write a result** and no separate
idempotency key exists. Resubmitting the *same* request with the *current* token returns
`{already_completed: true}` with no second delivery.

The claim is one statement:

```sql
UPDATE viva_ag_jobs
   SET status='claimed', claimed_by=$1, claimed_at=NOW(), heartbeat_at=NOW(),
       claim_expires_at = NOW() + ($2 || ' seconds')::interval,
       attempts = attempts + 1, result_token = $3, updated_at = NOW()
 WHERE id = (SELECT id FROM viva_ag_jobs WHERE status='queued'
              ORDER BY priority DESC, created_at ASC
              FOR UPDATE SKIP LOCKED LIMIT 1)
RETURNING ...;
```

**Do not rewrite this as a SELECT followed by an UPDATE.** `FOR UPDATE SKIP LOCKED` is what makes
two concurrent pollers get two *different* jobs (or one job and `null`) instead of both grabbing
the same row. Verified with three simultaneous claims against a one-job queue: exactly one winner.

`job_uid` and `result_token` are minted in Node (`crypto.randomUUID()` /
`crypto.randomBytes(24)`), not in SQL — `gen_random_bytes()` needs pgcrypto, and this cluster is
shared with GCN (`CLAUDE.md` §32); not somewhere to add an extension for convenience.

`attempts` increments on **every claim**, so a legitimate 3-hour run that crashes at hour 3 burns
one. That is correct (attempt = worker run) but means three crashes permanently fail an expensive
job — which is why `max_attempts` is a per-row column rather than a constant.

---

## 5. No EventBridge, no cron

`CLAUDE.md` §22's CloudEvent machinery exists for exactly one reason: **Aliyun FC cancels an
invocation the moment the HTTP client disconnects**, so nano-side work taking minutes must leave
the request cycle or be destroyed.

**Viva AG has no nano-side long work.** Enqueue is one INSERT. The long work happens entirely
inside the external agent's own process. Delivery is two INSERTs inside the agent's own
`POST /jobs/result` request. Nothing approaches the 300s ceiling, so publishing a CloudEvent would
add shared dev/prod bus leak risk (§22's `EVENT_SOURCE_SUFFIX` incident) and a dedupe table for
zero benefit.

The one thing that would normally want a scheduler is lease expiry. It is swept **lazily** in
`_sweepExpiredLeases()`, called at the top of the claim handler *and* the user's job list (so a
user staring at their own stuck job unsticks it). Two statements: requeue those with attempts left,
and terminally fail those without — the second `RETURNING`s its rows so each owes its user a chat
message.

**Residual limitation, accepted for v1:** if the external agent stops polling entirely *and* no
user opens the AG subtab, an expired lease sits as `claimed` until someone touches the queue. If
that ever bites, the fix is a fourth scan in `dispatcher/index.js`'s existing cron tick — not new
infrastructure.

---

## 6. The external API

Full contract: `/api/viva-ag/docs`. This section covers what a *nano* maintainer needs.

### Authentication

A scoped service token, `VIVA_AG_API_TOKEN`, handled by a branch in `worker/index.js`'s auth gate
that mirrors the GCN credential (`CLAUDE.md` §19): a local `VIVA_AG_ALLOWED_PATHS` Set, **403** on
anything else, then `adminCtx.role = 'superadmin'; adminCtx.username = 'viva-ag-service'`.

Three load-bearing constraints:

1. **The branch must precede the `ch.` branch.** That one matches on *prefix*, so a token starting
   `ch.` would be swallowed there and 401 as a malformed channel-admin JWT. Tokens are issued as
   `vag_` + 32 hex.
2. **Exact match only** — the allowlist compares whole paths and cannot express a path parameter,
   so every parameter travels in the query string or body. Hence
   `/viva-ag/jobs/result` with `job_uid` in the body, never `/viva-ag/jobs/{uid}/result`.
3. **Distinct tokens per environment** (`VIVA_AG_API_TOKEN` / `VIVA_AG_API_TOKEN_PROD` in `.env`,
   both wired in `s.yaml` / `s-prod.yaml`). Dev and prod share the Aliyun account and OSS bucket; a
   single shared token would let a dev-configured agent claim and answer real prod users' jobs.

The **per-job** token rides in an `X-Viva-Ag-Job-Token` header on GET (looked up
case-insensitively, since every HTTP client normalizes header case differently) and in the body on
POST. Never a query parameter: query strings land in FC/SLS access logs and this token gates a
medical record.

### Endpoints

| Method | Path | Notes |
|---|---|---|
| GET | `/viva-ag/ping` | token + environment check; `queue_depth`, `bundle_version` |
| GET | `/viva-ag/docs` | this contract as Markdown (`_rawText`) |
| GET | `/viva-ag/openapi.json` | OpenAPI 3.1 |
| POST | `/viva-ag/jobs/claim` | atomic claim; `{job: null}` on empty queue |
| GET | `/viva-ag/twin-bundle?job_uid=` | first call flips the job to `processing` |
| GET | `/viva-ag/document-url?job_uid=&document_id=` | re-mint an expired file URL |
| POST | `/viva-ag/jobs/heartbeat` | extend lease, set `progress_note` |
| POST | `/viva-ag/result-upload-url` | presigned PUT for one report file (`pdf`/`md`/`txt`) |
| POST | `/viva-ag/jobs/result` | submit; idempotent |
| POST | `/viva-ag/jobs/fail` | `retryable` requeues if attempts remain |
| POST | `/viva-ag/jobs/questionnaire` | park the job and ask the user (§9c); releases the lease |

Routine failures are `{success:false, reason:'<snake_case>'}` at **HTTP 200**, following the GCN
convention (`CLAUDE.md` §31) — callers branch on `reason`, never a status code. Vocabulary:
`missing_params`, `job_not_found`, `invalid_token`, `lease_expired`, `job_not_claimable`,
`job_already_completed`, `document_not_found`, `result_too_large`, `invalid_result_key`,
`invalid_questions`, `questionnaire_limit_reached`, `internal_error`.

### The API documents itself

`/viva-ag/docs` and `/viva-ag/openapi.json` are served by `handlers/viva_ag_docs.js` from
`src/functions/worker/docs/`, read once at module load (`CLAUDE.md` §6 — keep work out of the
handler so a warm container reuses it). `s.yaml`'s worker uses `code: ./src/functions/worker`, so
the whole directory deploys with the function: **the contract cannot drift from the code the way a
wiki page or a README in another repo would.**

Both sit behind the token rather than being public — the operator holds it anyway, and an
unauthenticated page describing how to reach medical records is free reconnaissance.

**When changing any endpoint, change both files with it.** The spec's paths and
`VIVA_AG_ALLOWED_PATHS` should agree in both directions; a documented-but-not-allowlisted path
403s, which is the likeliest drift.

---

## 7. The twin bundle

Built by `lib/twinBundle.js`'s `buildTwinBundle()`. Shape follows `CLAUDE.md` §34's four canonical
layers, with a fifth top-level key:

```jsonc
{ "bundle_version": 1, "generated_at": "...", "job": {...},
  "subject": { "ref": "<job_uid>", "age", "gender", "language", "height_cm", "bmi",
               "health_conditions", "health_conditions_other" },
  "layers": {
    "precision_testing": { "latest", "total_tests", "history" },
    "daily_monitoring":  { "health_twin", "weight_history" },
    "medical_records":   { "health_reports", "lab_panel", "lab_date", "documents" },
    "personal_profile":  { "bio_data", "questionnaire_context", "memory_facts" }
  },
  "interventions": { "active_health_plans", "nutrition_schedule", "dot_inventory", "reminders" },
  "dots_formulary": [...] }
```

`interventions` sits deliberately **outside** `layers` because §34 states health/nutrition plans
are what the user *does*, not what they *are*, and are therefore not a twin layer.

**`subject` is pseudonymous** — no `user_id`, `external_id`, nickname or phone anywhere in the
bundle. The agent does not need an identity to analyze a twin, so a copy leaked from the agent's
side cannot be tied back to a person from its own contents. Combined with the absence of any
"fetch the twin for an arbitrary openid" endpoint, a leaked service token can drain the queue but
cannot enumerate users.

### Conventions this module must keep

- **Fetchers never throw.** Each is wrapped in `_safe()`; a dead data source degrades that section
  to `null`/`[]` rather than failing the whole bundle. A partial twin is far more useful to the
  agent than a 500.
- **Biomarkers always from `data.validated`, never `data.actual`** (`CLAUDE.md` §17).
- **Every timestamp through `formatToShanghai()`**, via a null-safe `_ts()` helper — the raw
  formatter renders `"Invalid DateTime"` for null, which would ship as a literal string.
- **`DATE` columns cast `::text` in SQL.** node-postgres parses a DATE at the process's local
  midnight, which `JSON.stringify` then renders as a UTC instant — a schedule row for 2026-08-16
  shipped as `"2026-08-15T16:00:00.000Z"`, **the wrong day** to any consumer. Found by an ISO-leak
  scan over a real bundle. Applies to `report_date`, `doc_date`, `scheduled_date`,
  `latest_lab_date`.

### The bundle is a digest; bulk history is paginated

`layers.*` carries the latest snapshot, recent history and the full document list — enough for a
`document_review` or `risk_screen` job to work from one call. It does **not** inline the complete
raw history: a heavy user is ~3.5k `health_events` and ~1.1k chat messages after seven months, and
that grows with tenure while most jobs never read it.

The bundle instead carries an **`inventory`** block (`fetchInventory()`): per-resource counts,
first/last dates, a per-category breakdown for `health_events`, and the endpoint serving each. A
worker cannot decide what to pull if it has to probe blindly, so this is what makes "the worker
decides" workable. Four paginated resource endpoints then serve the bulk
(`/viva-ag/health-events`, `/lab-results`, `/biomarker-history`, `/chat-history`), and "fetch
everything" is just paging to the end.

**Chat history is opt-in and windowed** (90 days by default, `days=all` to widen). It is
deliberately absent from the bundle: `subject` is pseudonymous, and transcripts routinely contain
names, family details and locations, so pulling one is a deliberate act rather than something
every job receives. `user_memory_facts` already covers durable personal facts in the bundle.

#### Pagination has two non-obvious correctness requirements

Both were found by live testing against real data, and both are easy to reintroduce:

1. **The cursor carries a snapshot id, and every query pins `id <= snapshot`.** These tables are
   append-only but *not* append-in-order — a ring sync writes a batch of events stamped with the
   times the measurements were taken, which can be hours old. Paging on `recorded_at` alone, a row
   inserted mid-drain and backdated past the cursor is skipped forever. Ids are monotonic where
   timestamps are not, so pinning them makes a drain one coherent snapshot; newer rows are picked
   up by the next drain instead of being silently lost.

2. **The cursor position is Postgres's own text rendering, never a JS `Date`.** `timestamptz`
   holds microseconds; JS `Date` holds milliseconds. Building a cursor from the `Date` the pg
   driver returns truncates, so the next page asks for rows strictly older than a value slightly
   *earlier* than where paging actually stopped — and any row sharing that millisecond with
   nonzero microseconds is excluded forever. Observed live: a 3523-row drain returned 3522, losing
   `id=179` at `...18.054021` (truncated to `...18.054`) because it happened to land on a page
   boundary. Every paginated query therefore selects its sort key a second time as `cursor_ts`
   text and the comparison casts back with `$n::timestamptz`. **Do not "simplify" this to a
   Date.**

   This is worth dwelling on: it is invisible until a sub-millisecond row lands exactly on a
   boundary, so it survived a full-drain test that happened to use a larger page size. Verified
   after the fix by draining all four resources at page sizes 7 / 50 / 500 — twelve drains, each
   returning exactly its snapshot with no duplicates.

### Why this module duplicates SQL

Its fetchers overlap `lib/agenticTools.js`'s 11 typed tools and the four `llmContext` builders
(`handlePostChat`, `handlePostHealthAdvice`, `_handleFormulaDotsAgentic`,
`handleDailyCheckinEvent`). **The duplication is a decision, not an oversight**, and the module
docblock says so.

Adopting these fetchers in `agenticTools.js` is the natural next pass and would be a real
improvement — 11 thin call sites with their output mapping unchanged. The four `llmContext`
builders are a different matter: they construct the contract 20+ prompt templates,
`runAgenticTurn`'s JUDGE grounding and `extractToolGroundTruth` all consume, and `CLAUDE.md`
§21/§27 record several user-visible regressions caused by touching exactly that surface. That
belongs in its own pass with its own verification, not bundled into a feature that only reads.

---

## 8. Files, and why they never pass through Function Compute

**Downloads are always a direct-from-OSS presigned GET.** The response envelope base64-encodes
binary bodies (`index.js`), so proxying a 50 MB PDF would inflate it ~33%, buffer the whole thing
in the 512 MB worker, and hit FC's response ceiling. OSS carries the bytes; nano only ever hands
out a signature.

Consequences, all good:

- **Download size is effectively unbounded** from nano's perspective. The 20 MB cap is a *miniapp
  upload* constraint (`wx.getFileSystemManager().readFile` loads the file into the JS heap, so an
  oversized PDF crashes the page rather than failing cleanly) — enforced client-side and again
  server-side from the real object's size.
- **HTTP `Range` works for free**, so the agent can chunk, stream-parse, or resume a dropped
  transfer instead of restarting. Verified with a real 16 MB PDF: `206` on a range request, full
  download MD5 matching the stored ETag.
- URLs are signed for **6 hours** for the agent (re-mintable at any time via
  `/viva-ag/document-url`) and **300s** for the end user.

### Content-Type is fixed at upload

**This bucket refuses a `response-content-type` override** — `400 InvalidRequest`, *"Can not
override response header on content-type"* (confirmed live 2026-08-23; the signed URL fails
outright for the object, it does not degrade). So `generatePresignedPutUrl(key, expires, bucket,
contentType)` now takes the real type and callers must PUT with exactly the `put_content_type` the
presign returned, or OSS returns `SignatureDoesNotMatch`.

`generatePresignedGetUrl(..., opts)` gained an optional `filename` that sets an RFC 5987
`Content-Disposition` (these filenames are routinely Chinese) — but **no content-type override;
don't re-add one.**

`headObject()` captures size and a lowercased ETag at registration time, so the stored metadata
describes what is actually in the bucket rather than what the client claimed, and a downloader can
verify a large, possibly resumed transfer completed intact.

### Authorization

**Documents are never routed through `/oss/presign`.** That endpoint performs *zero* authorization
on `action=get&key=…` — it will hand a signed URL for any OSS key to any caller holding the app
token. That is a live pre-existing hole (see §10) and documents must not widen it. Instead:

- keys are minted **server-side** under `health-documents/{user_id}/{hex}.{ext}`
- registration rejects any `oss_key` outside the resolved caller's own prefix — otherwise a caller
  could register someone else's object into their own list
- `oss_key` is **never returned to the client**; documents are referenced by `id`
- result artifacts are confined the same way, under `viva-ag-results/{job_uid}/`, and
  `POST /jobs/result` rejects any submitted key outside its own job's prefix
- the client addresses result files by **index**, never by key — see §9a

---

## 9. Delivering the result

`deliverTerminalMessage()` (exported from `handlers/chat.js`) writes **both** a `chat_messages` row
and a `notifications` row — the two-channel model `CLAUDE.md` §22 requires, because
`GET /api/notifications` is a **destructive read** and one poll the client never receives would
otherwise consume the only copy.

- Saved under `persona_type = 'viva'`, **never** `'viva_ag'`. Chat history is persona-scoped, so a
  bubble under a persona the chat tab never queries would flash once via the poll and vanish on
  reload — literally §25's "second real bug".
- Notification types `viva_ag_result` and `viva_ag_failed` (the column is free text, no migration).
  **Both must stay in `AI_ECHO_TYPES`** (`pages/main/main.js`) — both channels carry the same text,
  and a type missing from that Set renders the bubble twice.
- `saveChatMessage` and `_deliverTerminalMessage` now return their inserted ids so the job row can
  record exactly what was delivered. Every pre-existing caller ignores the return.
- Failure text is localized from the job's snapshotted `language`.
- A delivery failure is logged but **does not** fail the result submission — the result is already
  committed, and making the agent think its work was rejected would have it retry the whole
  analysis. The AG subtab still shows it.

### Attribution: the bubble says "Viva AG", not "Viva"

A deep analysis is delivered into the ordinary chat, but the user should be able to tell it apart
from a normal Viva reply. `chat_messages.source` (migration `migration_chat_messages_source.sql`,
NULL for every other row) carries `'viva_ag'`, and the miniapp renders a `Viva AG` label above the
bubble — the same shape as the existing `Coach` label.

Two things forced a dedicated column rather than something simpler:

- **Not `persona_type`.** Chat history is persona-scoped, so a row saved as `'viva_ag'` would be
  invisible to the chat tab's own history query: the bubble would flash once via the notification
  poll and vanish on reload. That is §25's "second real bug", exactly.
- **Not derived from `notification_type` at render time.** Notifications are read destructively
  and are gone after one poll, so a reload has only `chat_messages` to work from. The
  notification type *is* used for the live-arrival path (`AG_NOTIFICATION_TYPES` in
  `pages/main/main.js`), but it cannot be the durable record.

Both delivery channels therefore set it, and `handleGetChatHistory`'s three queries all select it
— miss one and the label silently disappears on whichever load path that query serves.

`result_summary` is **sanitized on ingest**: trimmed, capped at 4000 chars, and `:::`-fenced
display-card directives stripped. That syntax (`prompts/chat/outputFormat.js`) is interpreted by
the miniapp renderer when `rich_format` is on, so an external system emitting it could render
arbitrary UI inside the user's chat. Never feed `viva_ag_jobs.result` into a later LLM prompt
without treating it as untrusted content.

**Progress is deliberately not a `chat_status` notification.** That type drives the chat tab's
transient caption, which is bound to the client's own wait timer; a job running for hours would
leave a stuck caption. Progress lives in the AG subtab's job list instead.

---

## 9a. Report files

A job may carry up to **5** artifacts in `result_files` (migration
`migration_viva_ag_result_files.sql`), each `{oss_key, filename, ext, content_type, size_bytes,
etag}`. The typical pair is a rendered **`.pdf`** plus its **`.md`** source.

**`result_oss_key` is kept and still written** — the first file, PDF preferred — so pre-existing
rows, `has_result_file` and any caller that only knows the single-file shape keep working.
`result_files` is the source of truth; `result_oss_key` is its backwards-compatible head.

### Why only `pdf` / `md` / `txt`

The Mini Program is the only consumer, and it has exactly two ways to present a file:

| ext | how the user reads it |
|---|---|
| `pdf` | `wx.downloadFile` → `wx.openDocument` — the system viewer |
| `md`, `txt` | `wx.downloadFile` → `readFile('utf8')` → rendered **in-app** |

**`wx.openDocument` cannot open markdown.** Its `fileType` list is `doc/docx/xls/xlsx/ppt/pptx/pdf`
only, so handing it an `.md` fails in the user's hands. That is the whole reason the in-app viewer
exists (`_showTextReport` in `components/viva-ag-panel/`), and the reason
`/viva-ag/result-upload-url` **refuses** anything outside the three types up front, before the
agent spends a multi-megabyte upload on a file nano could never show.

### Validation at submission

Each key is checked three ways, and any failure refuses the **whole** submission — nothing is
committed and nothing is delivered, so the agent can fix and resubmit:

| reason | check |
|---|---|
| `invalid_result_key` | prefix-confined to `viva-ag-results/{job_uid}/` |
| `unsupported_file_type` | `pdf` / `md` / `txt` |
| `result_file_missing` | `headObject` — a key minted but never PUT would otherwise become a download button that fails |
| `too_many_result_files` | ≤ 5 distinct keys (identical keys are de-duplicated, not counted twice) |

`headObject` is also where `size_bytes`, `content_type` and `etag` come from, so the panel can show
a size without the client trusting a number the agent typed.

The agent names its own files and that name reaches the user twice — as the label in the panel and
as the `Content-Disposition` of the signed download — so `_safeResultFilename` strips path
separators, quotes and control characters, caps at 120 chars, and appends the real extension.

### Rendering markdown is a trust boundary

The `.md` was written by an **external** system, so the viewer does not simply hand it to the
renderer:

- `mdToHtml()` (new export in `utils/markdown.js`) deliberately does **not** interpret `:::`
  display-card directives, unlike `mdToSegments()`. Letting an outside system render designed
  status cards inside the app is the same injection surface that makes `handlers/viva_ag.js` strip
  `:::` out of result *summaries*.
- Raw HTML is escaped by the existing `_esc`/`_inline` path, so it cannot inject.
- **Links are neutralised.** mp-html's `linkTap` calls `wx.navigateTo` for any href without a
  scheme (`components/mp-html/node/node.js`), so a markdown link in a report could push the user
  into an arbitrary page of this miniapp. `_neutralizeLinks()` rewrites `[text](href)` to
  `text (href)` — the target stays visible, it just isn't tappable.
- Rendering is capped at `MAX_REPORT_CHARS` (120k) with a visible notice; past that a report is
  a document to download, not a page to scroll.

### Where the user sees them

Chips on the job card in the list (so a finished report is one tap away without opening anything)
and a titled file list inside the job detail sheet. Both bind the same `openResultFile` handler,
which mints a fresh 300s signed URL per tap via
`GET /viva-ag/jobs/result-url?openid=&job_uid=&index=`.

---

## 9b. `dots_formulation` — a specified deliverable, not a free-form analysis

The `dots_formulation` (原粒定制) preset asks the agent for a **28-day / 56-capsule Dots formula**,
attached as an `.md` result file in a fixed format. Section 8 of `docs/viva-ag-api.md` is the
contract; it is worth understanding *why* it looks the way it does.

**The rules are nano's, not the agent's.** Every constraint in that section is mirrored from
`handlers/dots.js`: `PLAN_DAYS = 28`, one `morning_cup` + one `evening_cup` per day (56 capsules),
`MAX_DOTS_PER_CAPSULE = 72`, per-dot `target_dots_min`/`target_dots_max` applied to the **daily**
total rather than each capsule, `dosing_protocol: 'pulse'` windows, and the `DOT-N7` isolation days
(`N7_ISOLATION_DAY_INDEXES = [9, 10]`, i.e. calendar days 10–11, both capsules `DOT-N7` alone at
its `target_dots_max`). If any of those change, **the doc has to change with them** — the agent has
no other source for them, and a formula built on stale rules is not manufacturable.

The isolation days are also the subtlety most likely to produce a wrong file: they displace every
other dot, so an everyday dot totals 26 days across the cycle, not 28. The worked example in the
contract is arithmetically correct against the live catalog specifically so that trap is visible.

**All 56 rows are required, no ranges.** Most days are identical, which is exactly why compressing
them would be tempting and wrong: the consumer is a processing center compounding physical
capsules, and reconstructing an implied schedule is where that goes wrong.

### Both of this section's v1 decisions were reversed on 2026-08-25

They are recorded here because the reasoning still matters, and because code written against them
would now be wrong.

**"Nano does not parse or validate the file."** True while the formula was read-only. False now:
`lib/agFormulation.js` enforces every rule above on submission and refuses a non-conforming
formula outright. The trigger was exactly the condition this paragraph anticipated — an approved
formula is compounded into capsules a person swallows, so nano became the only check in the chain.

**"It is an artifact, not a prescription."** Also false now. An expert-approved formula creates a
`nutrition_plans` row, and the user's plan starts when they scan the delivered box. The gate this
paragraph asked for ("committing would mean letting an external system write dosing into a user's
schedule, which needs server-side validation as a hard gate first") is precisely what was built
first, and an expert's approval sits on top of it.

What did **not** change: the `Summary.total_dots` checksum still exists so a downstream consumer
can reject a file cheaply, and the constants-coupling warning above still stands — it now binds a
third consumer, `lib/dotsProductModel.js`.

**Full writeup: [ag-dots-ordering.md](ag-dots-ordering.md).**

---

## 9c. Clarifying questionnaires — the agent asks the user something

Added 2026-08-27. Everything above describes a one-shot pipeline: submit, work, deliver. If the
twin was missing something the agent needed — a symptom timeline, a medication no lab panel
implies, whether a discharge summary describes a resolved or ongoing condition — its only options
were to guess or to fail. That is worst for `dots_formulation` (§9b), where the output is now
compounded into physical capsules.

Now the agent can **park** its claimed job, push back a short questionnaire, and resume once the
user has answered.

### Almost none of this is new

The build was small because nano already had every piece except the asking:

| Piece | Where | Status |
|---|---|---|
| Four `questionnaire_*` tables | `migration_questionnaire_system.sql` | reused; one new `type` value |
| Five server-driven input widgets + the renderer | `pages/main/main.wxml:325-440`, `main.js:1948-2091` | untouched |
| A questionnaire generated at runtime by an LLM | `createDynamicQuestionnaire()` (Viva's own `ask_questions`, `type='dynamic'`) | generalised with a `type` param |
| Delivering a pending form to the client | `GET /api/pending-questionnaires` returns **every** non-completed assignment | free |
| The client trigger | a `questionnaire_ready` notification → `_checkForPendingQuestionnaire()` | free — the same type is emitted |
| Completion detection with a typed hook | `handlePostQuestionnaireResponse` already branched on `type === 'dynamic'` | one sibling branch added |
| **Answers reaching the agent** | `twinBundle.js`'s `questionnaire_context` already merges completed answers into every bundle | **free** |

That last row is the one that shaped the design. The return path existed before the outbound path
did, so reusing these tables meant the answers flow back with no new plumbing at all.

### `awaiting_input`

`viva_ag_jobs.status` has no CHECK constraint — the value set is a comment in
`migration_viva_ag_jobs.sql`. What the new status *does* require is the audit:

- **`uniq_viva_ag_jobs_active` must include it.** A parked job still owns the user's one in-flight
  slot; letting them enqueue a second would leave two jobs competing for the same answers, and the
  second would resume off the first one's form. The migration drops and recreates the index —
  verify the predicate on a real DB, because a `DROP`/`CREATE` pair that no-ops fails silently and
  the symptom appears much later.
- **`idx_viva_ag_jobs_lease` must *not*.** A parked job holds no lease at all.
- It is **not** in `TERMINAL_STATUSES`, so `has_active` and the panel's poll are correct for free.

**The lease is released, not held.** A user may take days, and no lease length covers that. On
resume any worker claims the job fresh and gets a new `result_token` — which is what keeps workers
stateless: the answers travel in the bundle, never in a worker's memory. The corollary the API doc
states plainly: after a successful park the worker has lost its lease and must stop working.

**The attempt is refunded** (`attempts = GREATEST(attempts - 1, 0)`). `attempts` exists to stop a
crashing worker re-claiming forever; asking a question is forward progress, not a failed delivery,
and leaving it spent would let two rounds eat the retry budget a genuinely stuck job still needs.
Rounds — capped at 2 — are what bound this loop instead.

**A 7-day deadline** (`awaiting_input_expires_at`) is swept by a third statement in
`_sweepExpiredLeases`, separate from the two lease statements because those key off
`claim_expires_at`, which a parked job has none of. On expiry the job fails as
`questionnaire_unanswered` with its own message, and the user's slot frees. Same lazy-sweep
limitation §5 already documents: it only runs when someone touches the queue.

### Validation is a security boundary, not a formatting check

`lib/agQuestionnaire.js` mirrors `lib/agFormulation.js` — pure, no DB, violations collected and
named rather than thrown, and **all-or-nothing** (a partially accepted form would ask the user a
subset the agent never designed, and it has no way to know which subset it got).

The reason it exists at all is that **`questionnaire_questions` is a write path into user data**.
`handlePostQuestionnaireResponse` acts on three of its columns when an answer arrives —
`save_target` of `user_field` writes `users.<save_field>`, `bio_data_field` merges into
`users.bio_data`, and `biomarker` **inserts a biomarkers row** — and a fourth, `completion_check`,
makes the client auto-skip a question, which would let an agent push a form that instantly
self-completes and resumes the job having asked nothing.

None of those four are read from the payload. They are hard-written `NULL`/`'{}'` by
`createDynamicQuestionnaire`. Not validated, not rejected — **never sourced**. An external system
gets to ask questions; it does not get to decide where the answers are written. `config.other_key`
falls under the same rule (the miniapp writes that key into `bio_data` from the client), which is
why it is stripped and an option keyed `other` is rejected outright — free text belongs in a `text`
question, the only shape whose answer actually reaches `questionnaire_responses`.

Prompts render as chat bubbles, so they are the same render-injection surface `result_summary` is
(§9): `:::` fences are stripped and markdown links flattened. Those are *sanitised*, not rejected —
a stray fence is a formatting slip, not a broken contract.

### Delivery and resume

Two notification rows, on purpose: a `viva_ag_questionnaire` bubble so the user reads **why** they
are being asked (attributed to Viva AG via `chat_messages.source`, like every other AG message),
and a bare `questionnaire_ready` row, which is the existing signal that makes the chat tab fetch
and start the form. `main.js` already suppresses its own bubble for that type, so the two do not
double up — and `viva_ag_questionnaire` had to join **`AI_ECHO_TYPES`**, or it would render twice.

Completing the form is the **only** thing that un-parks the job.
`resumeVivaAgJobForAssignment(assignmentId)` is injected into `handlePostQuestionnaireResponse`
from `index.js` — the same pattern `saveChatMessage` uses there, so `handlers/questionnaires.js`
never has to require `handlers/viva_ag.js`. It must be `await`ed for the reason the comment beside
it already records: FC 3.0 freezes the execution context on handler return, and an un-awaited
promise there was confirmed live never to complete. It fails open; the deadline sweep is the
backstop.

### Two views of the same answers

`layers.personal_profile.questionnaire_context` is the whole-user view — every completed
questionnaire the user has ever filled in, merged. `job_questionnaires` (new, `bundle_version` 2)
is job-scoped: the rounds *this* job asked, per round, with `answer: null` marking
asked-but-unanswered. The agent needs the second to decide whether it now has what it was missing,
a question the merged view cannot answer.

Answers feed normal chat too, by design — they are genuine user-stated health facts, and Viva
appearing not to know something the user typed into an AG form a minute earlier would be worse than
a slightly longer context block.

### The user answers in the chat tab

Deliberately not in the AG panel. The chat tab's renderer is one server-driven implementation
covering all five widget types, already used by onboarding, coach-assigned forms and Viva's own
follow-ups; a second renderer in the panel would be a second place to maintain every input type for
no user-visible gain. The panel shows a "需要补充信息 · 去回答" card and hands off —
`viva-ag-panel` → `user-health` → `main.js`'s `handleAgGoToChat`, which switches tab and calls the
(idempotent) `_checkForPendingQuestionnaire()`.

---

## 10. Miniapp

### The subtab

Lives **inside** `components/user-health/`: a fixed `.uh-tab-bar` strip between `.uh-root` and
`.health-scroll` (the former is a column flexbox, the latter `flex:1; height:0`, so this needs no
layout surgery), then `wx:if` on the scroll-view and on the panel. Three small WXML edits; the nine
overlay modals are already siblings of the scroll-view and are unaffected.

The `.uh-tab-*` classes are **component-local copies** of the page-level `.inner-tab-*` rules in
`pages/main/main.wxss` — WeChat component style isolation means a component cannot see page WXSS,
so they have to be redeclared, and are renamed so they can never collide.

The strip renders only when `vivaAgEnabled && mode === 'self' && !isGuest`; a one-item strip would
be pure noise for everyone else, and losing entitlement while parked on the AG tab snaps back to
`twin` rather than leaving a blank pane. **Self view only** — `pages/coach/coach.wxml` embeds the
same component with `mode="coach"` and never passes `viva-ag-enabled`, so a coach sees nothing.
Deliberate for v1: no upload story, no notification channel, and these are the most sensitive
documents in the system.

### The panel

`components/viva-ag-panel/` — its own component precisely so an already-1000-line template does not
absorb another feature. Self-contained: own `T = {zh, en}` table, own `_req` helper.
Sections: entitlement header → documents → command composer (preset chips + free text) → job list
with a detail sheet.

**Refusals are surfaced by reason, not swallowed.** `POST /viva-ag/jobs` distinguishes expected,
actionable conditions (`daily_limit_reached`, `job_already_active`, `viva_ag_inactive`) from real
faults, and `submitJob()` maps each to its own message; only a genuine fault gets the generic
"please retry". Showing "操作失败，请重试" for a quota refusal is actively misleading — retrying
never works and the user is told nothing (hit live on dev 2026-08-23). The `catch` block is now
reserved for transport failures alone.

Report files (§9a) appear as chips on the job card in the list and as a titled list inside the
detail sheet; both bind the same `openResultFile`, which branches on extension — PDF into
`wx.openDocument`, markdown/text into the in-app `.ag-viewer` overlay. `wx.downloadFile` treats any
HTTP status as success, so a 403 from an expired signature is rejected explicitly rather than
handed to `openDocument` as if it were a file.

Polling is a 15s timer **inside the panel**, running only while a job is non-terminal and the panel
is visible. Deliberately not hooked into `main.js`'s 3s notification poll — that loop is tuned for
chat delivery, and adding an AG query to every user's 3s tick for a feature almost nobody has would
be wasteful.

### Uploading: two sources, different prerequisites

An action sheet offers both:

- **`wx.chooseMessageFile`** — the only way to obtain a document in a Mini Program. It reads from
  a WeChat **conversation**, not the device filesystem: the user must forward the file to
  文件传输助手 first, which the empty state has to say. Called with `type: 'all'` rather than
  `type: 'file'`, because a lab report someone forwarded as an *image* is a message of type
  `image` and would be invisible otherwise; `extension` only filters `type:'file'` anyway, so the
  panel validates the extension itself and names the problem instead of silently hiding the file
  the user is looking at.
- **`wx.chooseMedia`** — a photograph of a paper record. Uses the album/camera scope the chat tab's
  image upload already relies on, so it needs no additional declaration.

> **Platform prerequisite for the PDF path.** `chooseMessageFile` requires the 「选中的文件」 scope
> to be declared in the miniapp's **用户隐私保护指引** in the MP console
> (小程序后台 → 设置 → 服务内容声明). Without it WeChat rejects the call outright:
> `chooseMessageFile:fail api scope is not declared in the privacy agreement`, **errno 112**.
>
> **No runtime consent flow can rescue this.** `app.js`'s `onNeedPrivacyAuthorization` handler
> never fires, because the failure is a missing *declaration*, not a missing *consent*. It is also
> not a `requiredPrivateInfos` entry — that list only accepts the location family plus
> `chooseAddress`. The console declaration is the only fix.

`_choosePdf()` therefore distinguishes three outcomes, following `fetchWechatAddress`'s precedent
in `pages/main/main.js`: silent on cancel/deny, an explanatory modal naming the console setting and
pointing at the photo path on a privacy/scope error, a generic toast otherwise. **Never re-add a
bare `fail: () => {}`** — that is what made the button look dead when this first shipped.

Upload itself mirrors `utils/tool-actions.js`'s `_doUpload`: presign → `readFile` →
`wx.request` PUT with the returned `put_content_type` → register.

### Viewing

**Two viewers, chosen by extension** — this is not optional polish: `wx.openDocument` cannot render
images at all, and `wx.previewImage` cannot render documents.

- **Images** → `wx.previewImage` with the signed URL directly. No download step, and it gives
  pinch-zoom, which is what someone reading a photographed printout actually needs.
- **PDF / Office** → `wx.downloadFile` → `wx.openDocument` with `fileType` set from the
  extension. Hardcoding `fileType: 'pdf'` breaks every Word and Excel file, so the extension has
  to drive it.

The document path is the same one `pages/main/main.js` already uses for certificates. `wx.downloadFile` is subject to the
miniapp's **downloadFile 合法域名** whitelist — the cert flow works against the same bucket, but if
URLs ever move to `OSS_CNAME_DOMAIN` that is a *different* domain entry
(see [wechat-domain-setup.md](../wechat-domain-setup.md)).

---

## 11. Risks and open items

**1. `?openid=` is the only authorization on user endpoints.** `API_BEARER_TOKEN` is both nano's
superadmin bearer and the token compiled into the miniapp, so every end-user endpoint is
"authorized" by a parameter the caller supplies. Pre-existing and systemic (`/biomarkers?openid=`,
`/health-reports?openid=`, `/user-facts?openid=`, …) — but hospital PDFs raise the stakes, which is
why §8's key-namespacing, prefix-confinement, id-only references and 300s URLs exist. **The real
fix is per-user session tokens** (the phone-OTP flow already proves possession); out of scope here
and worth a dedicated task.

**2. `VIVA_AG_API_TOKEN` is a single static secret** with no rotation and no IP restriction,
fronting full medical records. Mitigated by job-scoping, the exact-match allowlist, distinct
dev/prod tokens, the pseudonymous subject block, short-lived URLs, and per-request logging of
`worker_id` + `job_uid`. **Not** mitigated: token theft.

**3. No consent record for offsite egress.** v1 treats the AG subscription itself as consent
(product decision). Worth confirming against PIPL before this carries real users, since
retrofitting consent for analyses already run is harder than gating them. The drop-in would be
`users.viva_ag_consent_at` plus a one-time in-panel acknowledgement.

**4. Cost.** One in-flight job per user (DB-enforced) plus a per-day cap (handler-enforced,
`VIVA_AG_MAX_JOBS_PER_DAY`). Each environment sets its own: **dev 50** (so testing isn't blocked
after three runs), **prod 10**, **code default 3** if the variable is absent. Volume beyond that
is unbounded across users.

`GET /viva-ag/jobs` returns `daily_limit` / `daily_used` / `daily_limit_reached` so the panel can
disable submit and show the remaining count *before* the user composes a request that would be
refused.

**5. Notification loss.** `GET /api/notifications` is destructive, and the `chat-history` replay
backstop only runs while `_chatWaitStartedAt` is set — which it will not be hours after enqueue. A
lost poll delays the bubble until the next full history load on app open; the `chat_messages` row
is durable so nothing is lost. This is a good reason the AG subtab's job list, not the chat bubble,
is the authoritative surface for results.

**6. Orphaned OSS objects** from soft-deleted documents (§3).

**7. Admin queue browser** — a `VivaAgTab.jsx` (filter jobs by status, force-requeue a stuck one,
view result JSON) is a deliberate follow-up, to be designed against real operational experience.
Until then the queue is fully inspectable with SQL and there is one operator.

---

## 12. Verification performed

- **Schema**: 3 migrations applied to dev; columns and all four indexes confirmed.
- **Backend, direct handler calls against dev** (39 assertions): entitlement gating before/after
  grant, grant stacking, audit rows, enqueue, one-in-flight rejection, 3-way concurrent claim
  (exactly one winner), bundle shape and pseudonymity, no user_id anywhere, no UTC-ISO leakage,
  heartbeat, artifact prefix confinement, summary/size validation, `:::` stripping, two-channel
  delivery, idempotent replay, revoke.
- **Lease and fencing** (18 assertions): expiry→requeue with token rotation, stale worker fenced
  out of both read and write, exhausted attempts → terminal failure + localized chat message,
  retryable vs terminal `/jobs/fail`, cancel restricted to `queued`.
- **Documents against real OSS**: a 16 MB PDF — presign, PUT, register, ETag == local MD5, `206` on
  a range request, correct `Content-Type` and RFC 5987 filename, full download MD5 verified,
  re-mint, out-of-scope refusal, soft delete leaving an in-flight URL working.
- **External API over HTTPS**: **403 on every non-allowlisted path**, 401 without a token, ping,
  claim, bundle, wrong-token rejection, heartbeat, artifact upload, result, replay, docs endpoints,
  and the job-token header accepted in four different casings.
- **Miniapp** via `tools/wechat-automator/` (24 assertions): subtab strip renders only with the
  add-on, tab switching mounts/unmounts correctly, panel loads, i18n resolves, presets, submit
  gating — plus a full journey (submit from the UI → claim/heartbeat/complete as the agent → reply
  rendered **exactly once** in the chat tab) and the photo upload path end to end.
- **Report files** (21 assertions, direct handler calls + real OSS): `.pdf` and `.md` upload URLs
  with the correct signed content type, `.zip` refused up front, both files PUT and submitted
  together, foreign-prefix and never-uploaded keys refused, identical keys de-duplicated, PDF
  sorted first, filename sanitisation, sizes captured from `headObject`, no `oss_key` in any
  user-facing response, both files downloadable by index with matching size and content type, the
  markdown round-tripping byte-for-byte, a missing `index` defaulting to the PDF, an out-of-range
  index clamping rather than erroring, and the legacy single-`result_oss_key` submission still
  working.
- **Report rendering in the miniapp** via `tools/wechat-automator/` (20 assertions): chips and file
  rows render with the right labels and sizes, a real `.md` staged on-device renders through
  `readFile` → `mdToHtml` (headings, tables, bold), links are neutralised while their targets stay
  visible, `mp-html` mounts inside the viewer, and the viewer closes cleanly — plus a live
  `wx.downloadFile` of a `.md` straight from OSS (confirming the download domain whitelist covers
  it) rendered end to end.
- **i18n**: every `{{t.*}}` in WXML and every `t.*` in the panel's JS resolves in **both** language
  blocks, and the blocks are symmetric.
- Existing suite: 8 failures, all identical on a clean tree, none related.
