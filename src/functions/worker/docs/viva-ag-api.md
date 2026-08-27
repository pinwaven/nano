# Viva AG — External Agent API

Version 1 · bundle_version 1

This is the complete contract between Waven Nano and the external **Viva AG** (Advanced
Generation) agent. Nano holds a queue of analysis jobs; your agent **pulls** from it, reads a
digital-twin bundle plus the user's uploaded medical documents, and posts a result back. Nano
delivers that result into the user's chat.

You never need to expose a public endpoint. Everything is outbound from your side.

---

## 1. Authentication

Every request carries a static service token:

```
Authorization: Bearer <VIVA_AG_API_TOKEN>
```

- **Dev and prod have different tokens.** They point at different databases and different real
  users. Confirm which one you are holding with `GET /api/viva-ag/ping` before doing anything.
- The token is restricted to the paths in this document. Any other path returns **403
  Forbidden**, even with a valid token.
- The token must not begin with `ch.` — that prefix is reserved for a different credential type
  and would be rejected. Tokens are issued as `vag_` + 32 hex characters.

Base URLs:

| Environment | Base |
|---|---|
| dev  | `https://nano-dev.gcn.net/api` |
| prod | `https://nano.gcn.net/api` |

### The per-job token

Claiming a job returns a second credential, `result_token`. It is a **fencing token**, not a
session: it is regenerated every time the job is claimed, and it is the only thing that
authorises reading that job's twin bundle or submitting its result.

- **GET** endpoints: send it as `X-Viva-Ag-Job-Token: <result_token>`.
- **POST** endpoints: send it as a `result_token` field in the JSON body.

It is a header rather than a query parameter on GET because query strings are recorded in access
logs and this token unlocks a complete medical record.

If your lease expires and another worker re-claims the job, your token stops working
(`invalid_token`). That is the mechanism that guarantees two workers can never both write a
result for the same job — there is no separate idempotency key to manage.

---

## 2. Response conventions

Every response is HTTP **200** with a JSON body, including routine failures. Branch on the body,
not the status code. Only an auth failure (401/403) or a genuine server fault (500) is non-200.

```jsonc
{ "success": true,  ... }
{ "success": false, "reason": "job_not_found", "error": "human-readable detail" }
```

### Reason vocabulary

| reason | meaning |
|---|---|
| `missing_params` | a required field was absent or malformed |
| `job_not_found` | no job with that `job_uid` |
| `invalid_token` | wrong `result_token` — usually means your lease expired and the job was re-claimed |
| `lease_expired` | your lease deadline passed; heartbeat more often or request a longer lease |
| `job_not_claimable` | the job is not in `claimed`/`processing` |
| `job_already_completed` | a terminal result was already recorded |
| `document_not_found` | the document is not in this job's snapshot, or was deleted |
| `result_too_large` | `result` exceeds 512 KB serialized — upload it as a file instead |
| `invalid_result_key` | a submitted result file key was not one minted for this job |
| `result_file_missing` | a submitted result file key exists but nothing was uploaded to it |
| `unsupported_file_type` | result files must be `pdf`, `md` or `txt` |
| `too_many_result_files` | at most 5 result files per job |
| `internal_error` | unexpected server fault |

---

## 3. Lifecycle

```
  claim  ──►  twin-bundle  ──►  [heartbeat …]  ──►  result   (or fail)
    │              │                                   │
    └── job:null   └── documents downloaded            └── delivered to the user's chat
        (queue empty; poll again)                          directly from OSS
```

Statuses: `queued` → `claimed` → `processing` → `completed` | `failed`. A job whose lease
expires goes back to `queued` if it has attempts left, or terminally `failed` if not (in which
case the user is told the analysis didn't finish).

`attempts` increments on **every claim**, so a run that crashes at hour three burns one. Default
`max_attempts` is 3.

---

## 4. Endpoints

### `GET /viva-ag/ping`

Confirm token and environment. Do this first.

```bash
curl -s -H "Authorization: Bearer $VIVA_AG_API_TOKEN" \
  https://nano-dev.gcn.net/api/viva-ag/ping
```

```json
{ "success": true, "service": "viva-ag", "env": "dev",
  "bundle_version": 1, "queue_depth": 2, "server_time": "2026-08-23 17:04:11" }
```

---

### `POST /viva-ag/jobs/claim`

Atomically takes the head of the queue. Two workers polling simultaneously get two different
jobs, never the same one.

```bash
curl -s -X POST -H "Authorization: Bearer $VIVA_AG_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"worker_id":"ag-worker-1","lease_seconds":3600}' \
  https://nano-dev.gcn.net/api/viva-ag/jobs/claim
```

| field | notes |
|---|---|
| `worker_id` | free-text, for log correlation |
| `lease_seconds` | 60–21600, default 3600 |

Empty queue:

```json
{ "success": true, "job": null }
```

Claimed:

```json
{ "success": true,
  "job": {
    "job_uid": "0d1f…",
    "command": "看看我的体检报告有没有需要注意的地方",
    "command_key": "document_review",
    "params": {},
    "attempt": 1,
    "max_attempts": 3,
    "queued_at": "2026-08-23 16:58:02",
    "lease_expires_at": "2026-08-23 18:04:11",
    "result_token": "9c2f…",
    "document_count": 4,
    "twin_bundle_url": "/api/viva-ag/twin-bundle?job_uid=0d1f…"
  } }
```

`command_key` is one of `full_analysis`, `document_review`, `risk_screen`, `dots_formulation`, or
`null` when the user wrote a free-text request only. **`dots_formulation` (原粒定制) has its own
required output format — see §8**; the other three are free-form analyses. `command` carries the user's own words when they typed any;
if they only tapped a preset, it repeats the `command_key`. Treat `command_key` as the intent and
`command` as the elaboration.

There is deliberately **no user identifier** in this response. `job_uid` is the only handle.

---

### `GET /viva-ag/twin-bundle?job_uid=…`

The subject's complete digital twin. The first call moves the job to `processing`.

```bash
curl -s -H "Authorization: Bearer $VIVA_AG_API_TOKEN" \
     -H "X-Viva-Ag-Job-Token: $RESULT_TOKEN" \
  "https://nano-dev.gcn.net/api/viva-ag/twin-bundle?job_uid=$JOB_UID"
```

Shape:

```jsonc
{
  "success": true,
  "bundle_version": 1,
  "generated_at": "2026-08-23 17:05:40",
  "job": { "job_uid": "…", "command": "…", "command_key": "…", "params": {} },

  // Pseudonymous by design: no user id, name, phone or openid anywhere in the bundle.
  "subject": { "ref": "<job_uid>", "age": 41, "gender": "male", "language": "zh",
               "height_cm": 178, "bmi": 22.4,
               "health_conditions": [], "health_conditions_other": null },

  // The four canonical Digital Twin layers.
  "layers": {
    "precision_testing": {          // Kino chip biomarker tests
      "latest":  { "validated": {…}, "bioage_profile": {…}, "tested_at": "…" },
      "total_tests": 63,
      "history": [ { "tested_at": "…", "validated": {…}, "bioage_profile": {…} } ]
    },
    "daily_monitoring": {           // wearable ring / band
      "health_twin": { "avg_hrv_ms": …, "avg_resting_hr": …, "avg_sleep_hours": …,
                       "avg_daily_steps": …, "latest_weight_kg": …, "trend_data": {…},
                       "data_coverage": {…} },
      "weight_history": [ { "weight_kg": 72.4, "tested_at": "…" } ]
    },
    "medical_records": {
      "health_reports": [ { "report_date": "…", "institution": "…", "observations": [ … ] } ],
      "lab_panel": {…}, "lab_date": "…",
      "documents": [ /* see section 5 */ ]
    },
    "personal_profile": {
      "bio_data": {…},
      "questionnaire_context": "…formatted Q&A text…",
      "memory_facts": [ { "category": "allergy", "fact": "…", "last_mentioned_at": "…" } ]
    }
  },

  // Interventions are NOT a twin layer — they are what the user DOES, not what they ARE.
  "interventions": {
    "active_health_plans": [ … ], "nutrition_schedule": [ … ],
    "dot_inventory": [ … ], "reminders": [ … ]
  },

  "dots_formulary": [ … ]   // the full Dots catalogue, for grounding any recommendation
}
```

**Biomarker values are always the `validated` set**, never raw reader output. Do not attempt to
reconstruct unvalidated values; the platform's own BioAge figures are computed from `validated`,
so anything else would contradict what the user already sees.

**Timestamps are Shanghai local** (`YYYY-MM-DD HH:mm:ss`), not UTC ISO.

If one data source is unavailable, that section is `null` or `[]` rather than the whole request
failing. A partial twin is still worth analyzing — but say so in your summary rather than
inferring around a gap.

---

## 5. Documents (large file download)

Each entry in `layers.medical_records.documents`:

```json
{ "document_id": 12,
  "filename": "2026年度体检报告.pdf",
  "doc_type": "hospital_record",
  "doc_date": "2026-03-11",
  "institution": "上海市第一人民医院",
  "note": null,
  "content_type": "application/pdf",
  "size_bytes": 18410224,
  "etag": "9f86d081884c7d659a2feaa0c55ad015",
  "uploaded_at": "2026-03-12 09:14:00",
  "url": "https://waven-nano.oss-cn-shanghai.aliyuncs.com/…&Signature=…",
  "url_expires_at": "2026-08-23 23:05:40",
  "supports_range": true }
```

`doc_type` is one of `hospital_record`, `lab_report`, `imaging`, `discharge_summary`,
`prescription`, `other`.

**Documents are not always PDFs.** A "health record" is whatever the clinic handed the user, so
expect any of these. **Branch on `content_type`, not on the filename.**

| Kind | `content_type` |
|---|---|
| PDF | `application/pdf` |
| Word | `application/msword`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document` |
| Excel | `application/vnd.ms-excel`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` |
| PowerPoint | `application/vnd.ms-powerpoint`, `application/vnd.openxmlformats-officedocument.presentationml.presentation` |
| Image | `image/jpeg`, `image/png`, `image/heic`, `image/heif`, `image/webp`, `image/bmp`, `image/gif` |

Practical notes:

- **Images need OCR, not parsing.** A photographed lab printout is common — often skewed, cropped
  or poorly lit. Treat a low-confidence read as missing data and say so in your summary rather
  than guessing at a number.
- **Excel files often hold the actual result table**, one row per marker; that is usually higher
  fidelity than the same panel embedded in a PDF.
- **`.doc` and `.xls` (pre-2007 binary) do appear** — Chinese hospital systems still emit them.
  If your parser only handles OOXML, fail that document explicitly rather than silently reading
  nothing from it.
- `doc_type` (the semantic category above) is what the **user** said the file is; `content_type`
  is what it actually is. They are independent — a `lab_report` may well be a `.jpg`.

### Download rules

- **`url` points directly at object storage, not at nano.** Bytes never pass through the API, so
  there is no practical size limit on a download. Fetch it as an ordinary HTTPS GET; do not send
  your `Authorization` header to it (the signature is the credential).
- **Range requests are supported.** Use them. A large PDF can be chunked, streamed, or resumed
  after a dropped connection instead of restarted:
  ```bash
  curl -r 0-1048575 -o part0 "$URL"        # first 1 MiB → 206 Partial Content
  curl -C - -o report.pdf "$URL"           # resume an interrupted download
  ```
- **Verify with `etag` and `size_bytes`.** `etag` is the object's lowercase MD5 for a normal
  upload; if the bytes you received don't match, you got a truncated transfer, not a corrupt
  file.
- The response carries a real `Content-Type` (`application/pdf` for a PDF) and a
  `Content-Disposition` with the original filename, RFC 5987 encoded — these are commonly
  Chinese.
- **URLs expire in 6 hours.** For a long run, re-mint rather than reusing a stale link:

  ```bash
  curl -s -H "Authorization: Bearer $VIVA_AG_API_TOKEN" \
       -H "X-Viva-Ag-Job-Token: $RESULT_TOKEN" \
    "https://nano-dev.gcn.net/api/viva-ag/document-url?job_uid=$JOB_UID&document_id=12"
  ```
  `GET /viva-ag/document-url` returns the same entry shape with a fresh signature. It is
  re-callable as often as you like.
- A job can only reach documents that existed **when it was enqueued**. A document uploaded
  mid-run is not in scope, and a document the user deletes mid-run keeps working for you.

---

## 5b. Bulk history — inventory and paginated resources

The twin bundle is a **digest**. It carries the latest snapshot, recent history and the full
document list, but not the complete raw history — a `document_review` job needs none of that, and
inlining it would grow the payload without bound as a subject accumulates tenure.

Instead the bundle carries an **`inventory`** block: what exists, how much, over what period, and
which endpoint serves it.

```jsonc
"inventory": {
  "kino_tests":    { "count": 66,   "first": "...", "last": "...", "endpoint": "/api/viva-ag/biomarker-history" },
  "health_events": { "count": 3523, "first": "...", "last": "...", "endpoint": "/api/viva-ag/health-events",
                     "by_category": { "vitals": {"count":3423,...}, "sleep": {...}, "activity": {...} } },
  "lab_results":   { "count": 207,  ... },
  "health_reports":{ "count": 2,    ... },
  "documents":     { "count": 4,    "endpoint": "(included in layers.medical_records.documents)" },
  "chat_messages": { "count": 1065, "endpoint": "/api/viva-ag/chat-history",
                     "note": "Not included in this bundle. Opt-in per job; defaults to a recent window." }
}
```

Read it before deciding what to pull. `vitals` typically outnumbers every other event category by
~50x, so a job that only cares about sleep should filter rather than drain everything.

### Endpoints

All take `job_uid` + the `X-Viva-Ag-Job-Token` header, like the twin bundle.

| Endpoint | Extra parameters |
|---|---|
| `GET /viva-ag/health-events` | `category`, `from`, `to` |
| `GET /viva-ag/lab-results` | — (first page also includes up to 500 `lab_events`) |
| `GET /viva-ag/biomarker-history` | `test_type=kino_chip` (default) or `body_composition` |
| `GET /viva-ag/chat-history` | `days` (default **90**; `days=all` for the whole history) |

All accept `limit` (default 200, max 1000) and `cursor`, and all return the same envelope:

```jsonc
{ "success": true, "count": 200, "has_more": true,
  "next_cursor": "eyJ...", "snapshot_id": "117685", "items": [ ... ] }
```

### Fetching everything

Page until `next_cursor` is null:

```bash
CURSOR=""; while :; do
  R=$(curl -s -H "Authorization: Bearer $VIVA_AG_API_TOKEN" -H "X-Viva-Ag-Job-Token: $TOK" \
      "$BASE/viva-ag/health-events?job_uid=$JOB&limit=1000&cursor=$CURSOR")
  echo "$R" | jq -c '.items[]' >> events.ndjson
  CURSOR=$(echo "$R" | jq -r '.next_cursor // empty'); [ -z "$CURSOR" ] && break
done
```

**A drain is a consistent snapshot.** The first page pins the highest row id that exists at that
moment and the cursor carries it, so anything written while you are paging is excluded rather
than half-included. This matters because these tables are append-only but *not* append-in-order:
a wearable sync writes a batch of events stamped with the times the measurements were taken,
which can be hours old. Without the pin, a row inserted mid-drain and backdated past your cursor
would be skipped silently.

The consequence to plan for: **a completed drain reflects the moment it started, not the moment
it finished.** `snapshot_id` tells you which point that was; drain again if you need what arrived
since.

### Chat history is opt-in

It is deliberately **not** in the bundle. The bundle is otherwise pseudonymous — no name, phone or
user id anywhere — and transcripts routinely contain names, family details and locations, so
requesting one is a deliberate act. It defaults to the last 90 days; `days=all` widens it.

Durable personal facts the subject has stated (allergies, dietary restrictions, goals) are already
in `layers.personal_profile.memory_facts` without needing the transcript at all — check there
first.

`role` is `user`, `ai` or `coach`. UI affordance rows are excluded.

---

## 6. Heartbeat

```bash
curl -s -X POST -H "Authorization: Bearer $VIVA_AG_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"job_uid":"'$JOB_UID'","result_token":"'$RESULT_TOKEN'",
       "progress_note":"读取第 3/4 份报告","extend_seconds":3600}' \
  https://nano-dev.gcn.net/api/viva-ag/jobs/heartbeat
```

→ `{ "success": true, "lease_expires_at": "2026-08-23 19:12:00" }`

Heartbeat well before `lease_expires_at`. If the lease lapses, the job is requeued and your
token dies. `progress_note` is shown to the user in the Viva AG panel, so write it for them, in
their language — it is not a debug channel.

---

## 7. Submitting a result

### Optional: upload report files first

A job can carry up to **5** report files. Typically that is a rendered **`.pdf`** plus its
**`.md`** source — the Mini Program opens the PDF in the system document viewer and renders the
markdown in-app, so uploading both gives the user a readable report either way.

**Allowed types: `pdf`, `md`, `txt`.** Anything else is refused with `unsupported_file_type` at
this step, before you spend the upload — the Mini Program is the only consumer and it has no way
to present, say, a `.zip` or a `.docx`.

Get one presigned upload URL per file:

```bash
curl -s -X POST -H "Authorization: Bearer $VIVA_AG_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"job_uid":"'$JOB_UID'","result_token":"'$RESULT_TOKEN'","filename":"report.pdf"}' \
  https://nano-dev.gcn.net/api/viva-ag/result-upload-url
```

→ `{ "success": true, "oss_key": "viva-ag-results/<job_uid>/…pdf", "put_url": "…",
     "put_content_type": "application/pdf", "expires_in": 3600 }`

```bash
curl -X PUT -H "Content-Type: $PUT_CONTENT_TYPE" \
     --data-binary @report.pdf "$PUT_URL"
```

**Send exactly the `put_content_type` value that was returned** — it is part of what was signed,
and any other value fails with `SignatureDoesNotMatch`. It is derived from your `filename`'s
extension (`application/pdf` for `.pdf`, `text/markdown; charset=utf-8` for `.md`), because
object storage here refuses a content-type override at download time, so the type has to be
fixed at upload.

Markdown is rendered by the Mini Program's own renderer: headings, bold/italic, lists, tables,
blockquotes and fenced code all work. Raw HTML is escaped, and links are shown as plain text
rather than made tappable — write the report as ordinary markdown prose.

### Then submit

```bash
curl -s -X POST -H "Authorization: Bearer $VIVA_AG_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"job_uid":"…","result_token":"…",
       "summary":"我看完了您的四份报告…",
       "result":{"findings":[…],"confidence":"high"},
       "result_files":[{"oss_key":"viva-ag-results/…/ab12.pdf","filename":"2026年8月 深度分析.pdf"},
                       {"oss_key":"viva-ag-results/…/cd34.md","filename":"分析全文.md"}]}' \
  https://nano-dev.gcn.net/api/viva-ag/jobs/result
```

| field | required | notes |
|---|---|---|
| `summary` | yes | **This becomes a chat message the user reads as Viva speaking.** Write it in the subject's `language`, in Viva's voice, addressed to the user. Max 4000 chars. |
| `result` | no | structured findings, kept for the panel and future reference. Max 512 KB serialized. |
| `result_files` | no | up to 5 files you uploaded for **this** job. `{oss_key, filename}` objects, or bare `oss_key` strings. `filename` is what the user sees in the app — name it for them, in their language. |
| `result_oss_key` | no | legacy single-file form, still accepted; equivalent to one entry in `result_files` |

→ `{ "success": true, "job_uid": "…", "delivered": true, "notification_id": 8812,
     "result_files": [{"filename":"2026年8月 深度分析.pdf","ext":"pdf","size_bytes":184213}, …] }`

Each file is checked three ways before it is stored, and a failure refuses the whole submission
(nothing is delivered, so you can fix and resubmit):

| reason | meaning |
|---|---|
| `invalid_result_key` | that key was not minted by `/result-upload-url` for **this** job |
| `result_file_missing` | the key was minted but nothing was ever PUT to it — check your upload's HTTP status |
| `unsupported_file_type` | not `pdf` / `md` / `txt` |
| `too_many_result_files` | more than 5 distinct files |

The PDF is listed first regardless of the order you send, since that is what a user opens.

Resubmitting the identical request is safe: `{ "success": true, "already_completed": true, … }`
with no second message sent to the user.

Note that `summary` is sanitized on ingest — the platform's own display-card markup (`:::`
fences) is stripped, since an external system emitting it would be able to render arbitrary UI
in the user's chat. Send plain text and normal paragraphs.

### Reporting a failure

```bash
curl -s -X POST -H "Authorization: Bearer $VIVA_AG_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"job_uid":"…","result_token":"…","reason":"pdf_unreadable","retryable":false}' \
  https://nano-dev.gcn.net/api/viva-ag/jobs/fail
```

`retryable: true` puts the job back on the queue if it has attempts left
(`{"requeued": true}`). Otherwise the job fails terminally and the user gets a short apology in
their own language. Prefer a real `summary` explaining what you could and couldn't determine
over a terminal failure — a partial answer is far more useful to the user than nothing.

---

## 8. `dots_formulation` — the 28-day formula contract

When `command_key` is `dots_formulation` (原粒定制), the deliverable is a **28-day capsule
formula**, attached as an **`.md` result file** (§7). It is read by a person *and* by machines —
Aeviva's processing center compounds physical capsules from it — so the file must follow the
template below exactly.

`summary` stays what it always is: a short message to the user, in their language. Do not put the
formula in it.

### The product model

These are the same rules nano's own formulator enforces. A formula that breaks them cannot be
manufactured.

| | |
|---|---|
| Cycle | **28 days** |
| Capsules | **56** — one `AM` and one `PM` every day |
| Dots per capsule | **≤ 72** (a physical fill limit, independent of any dot's own range) |
| Per-dot dose | within that dot's `target_dots_min` … `target_dots_max`, applied to its **daily total (AM + PM)** — not to each capsule separately |
| Slot | honour each dot's `timing` (`Morning`/`Evening`). Only a dot with `timing_flexible: true` may be split across both slots, and the majority of its daily count should stay in its own slot |
| Pulse dots | a dot with `dosing_protocol: "pulse"` is dosed on only `pulse_days_per_cycle` days out of every `pulse_cycle_days` — never every day |
| `DOT-N7` | **system-controlled, isolated.** On **days 10 and 11 only**, *both* capsules contain **only** `DOT-N7`, each at its `target_dots_max`. It appears on no other day, and no other dot appears in those four capsules. |

Every field above comes from `dots_formulary` in the twin bundle (§4), which also carries each
dot's ingredients with mg amounts, in both languages. `interventions.nutrition_schedule` shows
what the subject is taking today, so a new cycle can be a deliberate change rather than a guess.

Day numbers are **1–28 relative to the start of the cycle**. The start date is not yours to pick —
it is set when the formula is dispensed — so do not put calendar dates in the file.

### File format

The file must open with the version marker, then carry three sections in this order. Keep the
table headers verbatim, in lowercase: a downstream parser matches on them.

```markdown
<!-- viva-ag:dots-formulation v1 -->
# 原粒定制 · 28 天配方

## Summary

| field | value |
| --- | --- |
| format | viva-ag-dots-formulation/1 |
| job_uid | 0d1f8e2a-… |
| cycle_days | 28 |
| capsules | 56 |
| total_dots | 1188 |
| rationale | 一句话说明这次配方的主线（用户语言）。 |

## Capsules

| day | slot | dots |
| --- | --- | --- |
| 1 | AM | DOT-N1x2 DOT-N5x14 DOT-N12x14 |
| 1 | PM | DOT-N3x4 DOT-N5x4 |
| … | … | … |
| 10 | AM | DOT-N7x50 |
| 10 | PM | DOT-N7x50 |
| 11 | AM | DOT-N7x50 |
| 11 | PM | DOT-N7x50 |
| … | … | … |
| 28 | PM | DOT-N3x4 DOT-N5x4 |

## Totals

| dot_key | name | am_total | pm_total | cycle_total |
| --- | --- | --- | --- | --- |
| DOT-N1 | 甲基平衡 | 52 | 0 | 52 |
| DOT-N3 | 静心夜 | 0 | 104 | 104 |
| DOT-N5 | 迷走张力 | 364 | 104 | 468 |
| DOT-N7 | 衰老清除 | 100 | 100 | 200 |
| DOT-N12 | 敏锐心智 | 364 | 0 | 364 |
```

Read those numbers against the rules and you can see both traps. `DOT-N5` is
`timing_flexible: true`, so its daily 18 may be split 14 AM / 4 PM with the majority in its own
Morning slot; `DOT-N12` is not flexible, so all 14 stay in AM. And every everyday dot totals
**26 days**, not 28 — days 10 and 11 are `DOT-N7` alone, which displaces everything else. Getting
that wrong is the single easiest way to ship a formula whose totals don't match its capsules.

Rules a parser depends on:

- **All 56 rows are required**, in order: day 1 AM, day 1 PM, day 2 AM, … day 28 PM. Do not
  abbreviate identical days into a range — most days *are* identical, and writing them out is
  what makes the file safe to feed a machine.
- The `dots` cell is space-separated `<dot_key>x<count>` tokens — `DOT-N5x14` means 14 dots of
  `DOT-N5` in that capsule. `dot_key` must match `key_name` from `dots_formulary` exactly, case
  included. `count` is a positive integer; never write a zero token, just omit the dot.
- No capsule may be empty.
- `Totals` must be arithmetically consistent with `Capsules`, and `total_dots` in `Summary` must
  equal the sum of `cycle_total`. It is a checksum: a consumer that finds a mismatch should reject
  the file rather than compound from it.

Anything else you want to say — reasoning, biomarker rationale, cautions — goes **after** the
`Totals` table, as ordinary prose. Everything above it is machine-read.

Attach a `.pdf` alongside the `.md` if you like (§7 allows up to 5 files); the `.md` is the one
that must conform.

### Send it as JSON — required

Put the same formula in the `result` field of `POST /jobs/result`:

```jsonc
{ "formulation": { "format": "viva-ag-dots-formulation/1", "cycle_days": 28,
    "total_dots": 1188,
    "rationale": "一句话说明这次配方的主线。",
    "capsules": [ { "day": 1, "slot": "AM", "dots": { "DOT-N1": 2, "DOT-N5": 14 } }, … ],
    "totals": { "DOT-N1": { "am": 56, "pm": 0, "cycle": 56 }, … } } }
```

This is what nano actually reads. A consumer parsing JSON cannot misparse a table, and it costs
you one serialization; the 512 KB `result` cap is far above what 56 capsules need. The `.md` is
parsed only as a fallback when `result.formulation` is absent, and it is the human-readable
artifact the user and the reviewing expert see — so send both.

### What nano does with it

**Nano parses and validates this formula, and rejects it if it breaks any rule above.** Since
2026-08-25 an approved formula is compounded into physical capsules, so it can no longer be
stored unchecked.

On submission nano checks: all 56 capsules present and in order, no empty capsule, every
`dot_key` in the formulary, each capsule within the 72-dot fill limit, each dot's **daily** total
inside its own `target_dots_min…max`, non-flexible dots confined to their own slot, `DOT-N7`
alone on days 10-11 at its `target_dots_max` and absent elsewhere, and `total_dots` matching what
the capsules add up to.

`POST /jobs/result` still succeeds either way — your analysis and its report are delivered to the
user regardless — but the response tells you which happened:

```jsonc
{ "success": true, "formulation_accepted": true,  "formulation_id": 42, "total_dots": 1188 }
{ "success": true, "formulation_accepted": false, "formulation_violations": [
    { "code": "dose_above_max", "message": "Day 1: DOT-N1 totals 9, above its maximum of 2." } ] }
```

A rejected formula goes no further: the user is told the formula needs regenerating, and nothing
is compounded. **Nothing is coerced into range** — a count outside a dot's bounds is refused, not
clamped, because a clamped formula is one nobody authored. If you cannot produce a formula that
satisfies every rule, `POST /jobs/fail` with a clear reason is still the better outcome than a
plausible-looking invalid one.

### What happens after you submit

An accepted formula is not dispensed automatically. It goes to a **nutrition expert**, who reviews
it against the same digital twin you were given and either approves it (optionally adjusting
counts) or rejects it. Only then is it compounded, and it becomes the subject's active plan only
when they scan the box they receive — which is also when day 1 of the cycle starts.

That is why the file carries no calendar dates, and why an adjustment may only re-count dots you
already chose: neither you nor the expert sets the start date, and nobody downstream has a
formulary to validate a dot you didn't pick.

---

## 9. Limits

| | |
|---|---|
| Concurrent jobs per user | 1 (enforced at enqueue) |
| Jobs per user per day | configured per environment — 50 on dev, 10 on prod (code default 3) |
| Lease | 60s – 6h, default 1h, extendable by heartbeat |
| Attempts per job | 3 by default |
| `summary` | 4000 characters |
| `result` | 512 KB serialized |
| Document upload (user side) | 20 MB per file |
| Document download | no limit — direct from object storage, Range supported |
| Document URL lifetime | 6 hours, re-mintable |

## 10. Recommended worker loop

1. `POST /viva-ag/jobs/claim`. On `job: null`, sleep ~30s and repeat.
2. `GET /viva-ag/twin-bundle`.
3. Download the documents you need, using Range for anything large; verify against `etag`.
4. Heartbeat every few minutes with a user-facing `progress_note`.
5. Optionally upload a report artifact.
6. `POST /viva-ag/jobs/result` — or `/jobs/fail` if you genuinely cannot produce anything.

Treat `invalid_token` at any step as "I lost this job": stop work on it and claim again.
