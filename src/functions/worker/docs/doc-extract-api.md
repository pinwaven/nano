# Document Extraction — External Agent API

You are building a worker that turns a user's uploaded health document — a 体检报告 PDF, a photo of
a paper lab printout, a hospital discharge summary — into structured data for their digital twin.

Nano owns a queue. Your worker **pulls** from it: claim a job, download the document straight from
object storage, read it, and post a structured result back. Nano validates that result and writes
what survives.

**This document is intended to be sufficient on its own.** If something here is ambiguous enough
that you had to ask, that is a bug in this file — say so.

Related but separate: the Viva AG API (`/viva-ag/*`) is a different service with a different token,
for long-form deep analysis. Nothing here depends on it, and a token for one will not work on the
other.

---

## 1. Authentication

Two credentials, and they do different jobs.

**The service token** authenticates every call:

```
Authorization: Bearer <DOC_EXTRACT_API_TOKEN>
```

Issued per environment, and the two are never interchangeable — a dev-configured worker must not
be able to claim a real user's document. Minted as `dex_` + 32 hex characters.

| Environment | Base URL |
|---|---|
| dev | `https://nano-dev.gcn.net/api` |
| prod | `https://nano.gcn.net/api` |

**The job token** (`result_token`) is returned by a successful claim and proves you still hold the
lease on that specific job:

- **GET** endpoints: send it as `X-Doc-Extract-Job-Token: <result_token>`
- **POST** endpoints: send it as a `result_token` field in the JSON body

It is deliberately not a query parameter — query strings land in access logs, and this token gates
a medical record.

It is **rotated on every claim**. If your lease expires and another worker claims the job, your
token stops working immediately; that is the mechanism that makes it impossible for two workers to
both submit a result. Treat `invalid_token` as "I no longer own this job", stop work, and claim
again.

---

## 2. Response conventions

**Every response is HTTP 200 with a JSON body, including routine failures. Branch on the body, not
the status code.** A non-200 means something is wrong with the request itself (a bad token, a path
you are not allowed to call), not with the job.

Success: `{ "success": true, ... }`
Failure: `{ "success": false, "reason": "snake_case_reason", "error": "..." }`

### Reason vocabulary

| `reason` | Meaning | What to do |
|---|---|---|
| `missing_params` | A required field was absent | Fix the call |
| `job_not_found` | No job with that `job_uid` | Stop; claim again |
| `invalid_token` | Your `result_token` is stale — the lease moved on | Stop working on this job; claim again |
| `job_not_claimable` | The job is not in `claimed`/`processing` | Stop |
| `job_already_completed` | Terminal already | Stop |
| `lease_expired` | Your lease ran out while you worked | Stop; the job is back on the queue |
| `document_not_found` | The user deleted the document mid-job | Stop; this is not your fault |
| `result_too_large` | Payload over 256 KB | Send fewer `unmapped` entries and shorter `source_text` |
| `internal_error` | Nano-side | Retry with backoff |

---

## 3. Lifecycle

```
                    ┌──────────────────────────────────────────┐
                    │                                          │
 user uploads ──> queued ──claim──> claimed ──heartbeat──> processing
                    ▲                  │                       │
                    │                  └── lease expires ──────┤
                    │                      & attempts < max    │
                    └──────────────────────────────────────────┘
                                       lease expires & attempts >= max ──> failed
 processing ──POST /jobs/result──────> completed   (twin written, user notified)
 processing ──POST /jobs/fail─────────> failed | queued
 user taps "this reading is wrong" ───> rejected  (terminal; never re-queued)
```

- A job is queued **automatically when a document is uploaded**. You do not create jobs.
- `attempts` increments on **every claim**, including one that ends in an expired lease. Default
  `max_attempts` is 3.
- One job per document may be in flight at a time. Several documents extract concurrently.
- `rejected` means the user looked at what you extracted and threw it away. It is terminal and is
  never retried.

---

## 4. Endpoints

### `GET /doc-extract/ping`

Health check and version handshake. Assert `contract_version` matches what you built against.

```json
{ "success": true, "env": "dev", "contract_version": 1, "queue_depth": 3,
  "server_time": "2026-09-08 22:41:07" }
```

### `POST /doc-extract/jobs/claim`

```json
{ "worker_id": "curia-extract-01", "lease_seconds": 600 }
```

`lease_seconds` is clamped to 60–3600, default 600.

**An empty queue is `{"success": true, "job": null}` — not an error.**

```json
{
  "success": true,
  "job": {
    "job_uid": "9f2c…",
    "attempt": 1,
    "max_attempts": 3,
    "queued_at": "2026-09-08 22:30:11",
    "lease_expires_at": "2026-09-08 22:40:11",
    "result_token": "a3f1…",
    "document": {
      "document_id": 412,
      "filename": "2026年度体检报告.pdf",
      "doc_type": "other",
      "doc_date": null,
      "institution": null,
      "note": null,
      "content_type": "application/pdf",
      "size_bytes": 2481003,
      "etag": "9a0b…",
      "uploaded_at": "2026-09-07 15:04:22",
      "url": "https://…oss-cn-shanghai.aliyuncs.com/health-documents/…?Signature=…",
      "url_expires_at": "2026-09-09 04:30:11",
      "supports_range": true
    },
    "subject": { "ref": "9f2c…", "age": 41, "gender": "male", "language": "zh" },
    "catalog": [ … see §6 … ]
  }
}
```

**`document.doc_type` and `doc_date` are what is on the row now, which is almost always `"other"`
and `null`.** No client asks the user to classify an upload — filling those in is part of your job.

**`subject` carries no user id, name or contact of any kind.** `ref` is the `job_uid`. Enough to
read an age- or sex-dependent reference range off a report, and nothing more.

### `POST /doc-extract/jobs/heartbeat`

```json
{ "job_uid": "9f2c…", "result_token": "a3f1…", "extend_seconds": 600,
  "progress_note": "page 3 of 8" }
```

Extends the lease from *now*. Send one at least every `lease_seconds / 2`.

### `POST /doc-extract/jobs/fail`

```json
{ "job_uid": "9f2c…", "result_token": "a3f1…",
  "reason": "pdf_is_encrypted", "retryable": false }
```

`retryable: true` (the default) puts the job back on the queue if attempts remain. Use `false` for
anything a retry cannot fix — an encrypted PDF, a blank scan, a photo of something that is not a
health document.

---

## 5. Downloading the document

`document.url` is a **presigned URL directly against object storage**. The bytes never pass through
nano, so there is no size ceiling imposed by the API and no base64 inflation.

- Valid for **6 hours from the moment of the claim** (`url_expires_at`) — not from when the user
  uploaded the file. In the example above the claim is at `22:30:11` and the URL expires at
  `04:30:11`; `uploaded_at` is unrelated to it.
- **A heartbeat extends the LEASE, not the URL.** The two are independent clocks. Nothing renews a
  signature in place: if a URL expires mid-job, claim the job again and you are issued a fresh one.
  In practice this cannot bite a well-behaved worker — the maximum lease is 1 hour, so a single
  claim can never outlive its own 6-hour URL.
- **`supports_range: true`** — HTTP `Range` works, so you can chunk or resume a large file.
- Documents are at most 20 MB (enforced at upload).
- `content_type` is authoritative; it was fixed at upload time and is what the object actually
  serves.

Formats you will encounter: `application/pdf`, Word/Excel/PowerPoint, and images
(`image/jpeg`, `image/png`, `image/heic`, `image/webp`, …). A photograph of a paper printout is
common and is often the *only* form a Chinese clinic record arrives in.

If the URL has expired mid-job, heartbeat first, then claim again — a new claim reissues a fresh
URL.

---

## 6. The extraction vocabulary — read this before writing a prompt

Nano stores a **fixed set of biomarkers**, and `catalog` in the claim response is that set,
generated live from the database. It is also available standalone at `GET /doc-extract/catalog`, so
you can build and tune your extraction prompt before any job exists.

```json
{ "key_name": "hsCRP", "display_name": "hs-CRP", "display_name_zh": "超敏C反应蛋白",
  "unit": "mg/L", "category": "inflammation", "ref_low": null, "ref_high": 1.0 }
```

Rules:

1. **`key_name` must come from this list, verbatim.** It is the only identifier nano resolves.
2. **`unit` must be the catalog's unit**, or one of the few convertible alternates in §8. Do not
   convert values yourself — send what the report says, with the unit the report used.
3. **Anything not in the list goes in `unmapped`.** A real 体检报告 carries 50–80 analytes and
   nano models 25 of them. That is expected, not a failure. Do **not** map an unknown analyte onto
   the nearest catalog entry — a wrong marker is far worse than a missing one, and `unmapped` is
   how the catalog gets extended later.
4. `ref_low`/`ref_high` are nano's own reference values, given so you can sanity-check your read.
   **Send the report's number, not the reference range**, and do not "correct" a value because it
   looks abnormal — an abnormal value is the point.

The list currently holds 25 entries: 6 that drive nano's own biological-age model, and 19 common
clinical-panel markers. It can change without notice, which is why it ships with every claim.

---

## 7. Submitting a result

```
POST /doc-extract/jobs/result
```

```json
{
  "job_uid": "9f2c…",
  "result_token": "a3f1…",

  "document": {
    "doc_type": "lab_report",
    "doc_date": "2026-08-12",
    "institution": "上海市第一人民医院",
    "note": "年度体检"
  },

  "summary": "2026年8月12日年度体检。血脂偏高，低密度脂蛋白 3.9 mmol/L 超出参考范围；肝肾功能、血糖均在正常区间。报告建议三个月后复查血脂。",

  "observations": [
    { "key_name": "hsCRP", "value": 1.2, "unit": "mg/L", "data_date": "2026-08-12",
      "confidence": 0.95, "source_text": "超敏C反应蛋白  1.2  mg/L  (0-1.0)" },
    { "key_name": "LDL", "value": 3.9, "unit": "mmol/L", "data_date": "2026-08-12",
      "confidence": 0.93, "source_text": "低密度脂蛋白胆固醇  3.9  mmol/L" },
    { "key_name": "ALT", "value": 22, "unit": "U/L", "data_date": "2026-08-12",
      "confidence": 0.91, "source_text": "丙氨酸氨基转移酶  22  U/L" }
  ],

  "findings": [
    { "category": "allergy", "text": "青霉素过敏", "confidence": 0.94 }
  ],

  "unmapped": [
    { "label": "血小板压积", "value": "0.22", "unit": "%" },
    { "label": "红细胞分布宽度", "value": "12.8", "unit": "%" }
  ]
}
```

Total payload must stay under **256 KB**. If you are near it, trim `source_text` and `unmapped`
first — the observations are what matter.

Every field is optional except `job_uid` and `result_token`. A document with nothing extractable is
still a legitimate result: send `document` and `summary` and empty arrays. That is a better outcome
than `/jobs/fail`, because the classification and the summary are useful on their own.

### `document`

| Field | Notes |
|---|---|
| `doc_type` | One of `lab_report`, `hospital_record`, `imaging`, `discharge_summary`, `prescription`, `other`. Unknown values fall back to `other` and are reported. |
| `doc_date` | `YYYY-MM-DD`. **The date on the report, not today.** See §8. |
| `institution` | Issuing hospital or lab, ≤120 chars |
| `note` | Short free text, ≤200 chars |

### `summary`

One to two paragraphs of plain language, **in the user's `language`**, describing what the document
says. Stored on the document and shown to the user.

Do not include `:::` anywhere — those are display-card fences in nano's chat renderer and are
stripped on ingest.

### `observations`

| Field | Required | Notes |
|---|---|---|
| `key_name` | yes | From `catalog`, verbatim |
| `value` | yes | A number. Not a range, not `"<0.5"`, not a string with the unit in it |
| `unit` | yes | As printed on the report |
| `data_date` | no | `YYYY-MM-DD`; falls back to `document.doc_date` |
| `confidence` | recommended | 0–1. Below **0.6** is rejected |
| `source_text` | recommended | The line you read it from, ≤200 chars. Not stored as data — it is what makes a wrong read diagnosable |

### `findings`

Durable personal facts stated by the document: an allergy, a diagnosis, a dietary restriction.

| Field | Required | Notes |
|---|---|---|
| `category` | yes | `allergy`, `condition`, `dietary_restriction`, `preference`, `goal`, `other` |
| `text` | yes | Short, in the user's language, ≤200 chars — "青霉素过敏", not a paragraph |
| `confidence` | **yes** | 0–1. Below **0.8** is rejected, and a finding with **no** confidence is rejected outright |

**Hold a high bar here.** These become durable statements about the person: an `allergy` filters
what products may be recommended to them and feeds their nutrition formulation. A wrongly recorded
allergy is a worse outcome than a missed one. Only send what the document actually asserts about
the patient — not a drug the report mentions, not a condition it rules out, not a family history.

### The response

```json
{ "success": true, "job_uid": "9f2c…", "report_id": 8823,
  "accepted": { "observations_accepted": 3, "observations_written": 3,
                "observations_submitted": 4,
                "findings_accepted": 1, "findings_submitted": 1,
                "unmapped": 2, "rejected": 1 },
  "rejected": [ { "reason": "unit_mismatch", "entry": { "key_name": "FPG", "value": 95, "unit": "mg/dl" },
                  "detail": "expected mmol/L" } ] }
```

**Always read `rejected`.** It is the only signal that your extraction is systematically wrong
about something, and it is per-entry with a reason.

**`observations_accepted` and `observations_written` are different numbers, on purpose.** Accepted
means the value passed validation; written means a row was created. `health_events` deduplicates on
(user, source, marker, date), so re-reading a report already extracted — or two documents covering
one panel — validates cleanly and writes nothing. A repeat submission showing
`observations_accepted: 9, observations_written: 0` is correct behaviour, not a failure, and it is
`observations_written` that the user is told about.

`report_id` is a **number**, and is `null` when no observations were stored (see the date rule in
§8). Every other scalar in this response is a number too — but treat them all as informational and
coerce rather than assert, since the write has already happened by the time you parse this and
there is nothing useful to do with a type error.

Submitting twice with the same token is safe: the second call returns
`{"success": true, "already_completed": true}` and writes nothing.

---

## 8. What nano validates, and what a violation costs

**Nano rejects; it never repairs.** A value in the wrong unit is not converted on a guess, an
out-of-range number is not clamped, an unknown marker is not mapped to a neighbour. Every refusal
comes back in `rejected` with a reason. A rejected entry is simply not written — the rest of the
submission still lands.

An agent that knows these rules can satisfy them before submitting.

### Per observation, in order

| # | Rule | `reason` on failure |
|---|---|---|
| 1 | `key_name` is in the active catalog | `unknown_marker` — moved to `unmapped` |
| 2 | `value` parses to a finite number | `invalid_value` |
| 3 | `unit` matches the catalog's, or is a listed convertible | `unit_mismatch` |
| 4 | Value is within 0.1× `ref_low` and 100× `ref_high` | `implausible_value` |
| 5 | `confidence`, if given, is ≥ 0.6 | `low_confidence` |
| 6 | A date resolves, from `data_date` or `document.doc_date` | `missing_date` |
| 7 | One value per marker per date | `duplicate_observation` — the first wins |

Rule 4 is an **order-of-magnitude guard**, not a clinical range: it catches a misread decimal point
or a value read off the wrong row. It is deliberately loose, because several `ref_high` values are
risk thresholds rather than physiological ceilings.

Rule 6 has a consequence worth planning around: **with no readable date anywhere, no observations
are stored at all.** The document metadata and summary still are. A dated report is worth
re-reading carefully for its date before you give up on it — but do not invent one, and do not
substitute today. A wrong date puts an old panel into the user's twin as though it were current.

### Convertible units

These pairs are converted for you. Anything else is `unit_mismatch`.

| `key_name` | Catalog unit | Also accepted |
|---|---|---|
| `FPG`, `TotalCholesterol`, `LDL`, `HDL`, `Triglycerides`, `BUN` | mmol/L | `mg/dL` |
| `Creatinine`, `UricAcid` | umol/L | `mg/dL` |
| `VitaminD` | nmol/L | `ng/mL` |
| `hsCRP`, `CRP` | mg/L | `mg/dL` |
| `Hemoglobin` | g/L | `g/dL` |

Unit matching ignores case, spacing, and `µ` vs `u`. `mg/dL`, `MG/DL` and `mg / dl` are the same
string to nano.

### Per finding

| Rule | `reason` |
|---|---|
| `category` is one of the six | `unknown_finding_category` |
| `text` is non-empty | `empty_finding` |
| `confidence` is present and ≥ 0.8 | `low_confidence` |

---

## 9. Testing your implementation without touching a job

```
POST /doc-extract/validate
```

Send exactly the body you would send to `/jobs/result` (`job_uid` and `result_token` are ignored).
It runs **the same validator the real path runs** and returns what would be accepted and what would
be rejected — with **no job, no claim, and no write**.

```json
{ "success": true, "contract_version": 1, "would_accept": true,
  "document": {…}, "summary": "…", "observations": […], "findings": […],
  "unmapped": […], "rejected": […], "counts": {…} }
```

Build your extraction prompt against `GET /doc-extract/catalog`, iterate against this endpoint
until a payload from a real report comes back with an empty `rejected`, and only then run a live
job.

---

## 10. Limits

| | |
|---|---|
| Concurrent jobs per document | 1 |
| Concurrent jobs per user | unbounded |
| Lease | 60s – 3600s, default 600s |
| Attempts per job | 3 |
| Document size | 20 MB |
| Document URL validity | 6 hours, Range-capable |
| Result payload | 256 KB |
| Observations per result | 200 |
| Findings per result | 40 |
| Summary | 2000 characters |
| `text` / `source_text` | 200 characters |
| Observation confidence floor | 0.6 |
| Finding confidence floor | 0.8 |

---

## 11. Recommended worker loop

```
loop:
    POST /doc-extract/jobs/claim {worker_id, lease_seconds: 600}
    if job == null:  sleep 15s; continue

    start a heartbeat every 300s with the job's result_token

    try:
        bytes = GET job.document.url          # direct from OSS, Range if large
        payload = extract(bytes, job.catalog, job.subject)
        POST /doc-extract/jobs/result {job_uid, result_token, ...payload}
        log(response.rejected)                # your quality signal
    except unrecoverable:
        POST /doc-extract/jobs/fail {job_uid, result_token, reason, retryable: false}
```

### Knowing when you have lost a job

Any call returning `invalid_token` or `lease_expired` means your lease is gone — the job has been
re-queued and possibly re-claimed by another worker. **Stop immediately and do not submit.** Your
token is already dead, so a submission would be rejected anyway; the point is not to waste the work
of continuing.

The usual cause is a heartbeat that stopped while a long download or a slow model call was running.
Heartbeat from a separate timer, not from between processing steps.
