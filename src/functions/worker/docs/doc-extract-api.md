# Document Extraction — External Agent API

You are building a worker that turns a user's uploaded health document — a 体检报告 PDF, a photo of
a paper lab printout, a hospital discharge summary — into structured data for their digital twin.

Nano owns a queue. Your worker **pulls** from it: claim a job, download the document straight from
object storage, read it, and post a structured result back. Nano validates that result and writes
what survives.

**This document is intended to be sufficient on its own.** If something here is ambiguous enough
that you had to ask, that is a bug in this file — say so.

**Contract version 4.** `GET /doc-extract/ping` declares the version the server speaks; every
version is a superset of the one before it, so a worker built against 1 or 2 keeps working. What 3
added, in one list: `structured.version: 2` keeps tables as tables (§7); every item may carry a
`source` cell reference into it; an `unmapped` row may carry a `suggested_key` that nano stores
and never acts on; a third catalog, `tag_catalog` (§6); and `tags` — facts about the person with
a key, a status and an anchor — which is now the only path into what nano acts on. `findings` is
still accepted and is stored as descriptors, which nothing acts on.

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
| `result_too_large` | Payload over 256 KB | Shorter `source_text`, then a smaller `structured` block, then fewer `unmapped` entries |
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
{ "success": true, "env": "dev", "contract_version": 2, "queue_depth": 3,
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
    "catalog": [ … see §6 … ],
    "food_catalog": [ … see §6 … ],
    "tag_catalog": [ … see §6 … ]
  }
}
```

**`document.doc_type` and `doc_date` are what is on the row now, which for a fresh upload is
`"other"` and `null`.** Filling those in is part of your job — with one exception: the user can set
them on the document themselves (a photographed report with no printed date is the common case).
**When the page shows no date, use the claim's `document.doc_date` as `data_date` and
`document.doc_date`.** A printed date still wins over it; never invent one, and never send today.
Nano applies the same fallback on its side, and a user-set type/date/institution is never
overwritten by your reading.

**Contract 4 — page groups.** Photos of one report uploaded together arrive as one job. When
the claim carries `group`, read **every page as one document**, in `pages[].page` order, and
submit **one** result to this `job_uid`; nano stamps every page with your reading and closes
their jobs. `document` is page 1 (the head) and is repeated as `pages[0]`, so a reader that
takes `group.pages` as the document loses nothing. A single upload has no `group`.

```jsonc
"group": {
  "group_uid": "…",
  "page_count": 21,
  "pages": [
    { "page": 1, "document_id": 131, "url": "…", "etag": "…", "content_type": "image/jpeg", "size_bytes": 788503, "uploaded_at": "…", "url_expires_at": "…", "supports_range": true },
    { "page": 2, "document_id": 132, "…": "…" }
  ]
}
```

How nano groups: queued jobs of one user whose documents are **images** uploaded within ten
minutes of the previous one, never yet attempted. A PDF is already a whole document and is
never grouped. Grouping happens at claim time, so a page uploaded after the head was claimed
is a new job of its own. The date printed on page 1 applies to the whole report; `doc_date`
on page 2 of a group is therefore no longer "undated" — it is page 1's.

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
  "unit": "mg/L", "category": "inflammation", "ref_low": null, "ref_high": 1.0,
  "aliases": ["hs-CRP", "超敏CRP", "超敏C-反应蛋白"] }
```

Rules:

1. **`key_name` must come from this list, verbatim.** It is the only identifier nano resolves.
2. **`unit` must be the catalog's unit**, or one of the few convertible alternates in §8. Do not
   convert values yourself — send what the report says, with the unit the report used. Never send
   a unit with the `µ` dropped (`mol/L` for `µmol/L`) — leave the row in `unmapped` with the raw
   unit instead.
3. **Anything not in the list goes in `unmapped`.** A real 体检报告 carries 50–80 analytes and
   nano catalogues ~75 of them. That is expected, not a failure. Do **not** map an unknown analyte
   onto the nearest catalog entry — a wrong marker is far worse than a missing one. Since contract
   version 2 an `unmapped` row is **kept, by name, under the report** and shown to the user, so
   send every analyte you can read, not a sample.
4. `ref_low`/`ref_high` are nano's own reference values, given so you can sanity-check your read.
   **Send the report's number, not the reference range**, and do not "correct" a value because it
   looks abnormal — an abnormal value is the point.
5. **Match printed labels against `display_name_zh`, `display_name` and `aliases`**, after
   NFKC-normalising CJK compatibility ideographs (PDF fonts routinely emit `⾎` U+2F8A for `血`
   U+8840 and `⽩` for `白`; a real report printed `⾎红蛋⽩ Hb`, and it must resolve to
   `Hemoglobin`). Abbreviations a Chinese lab prints — `Hb`, `TG`, `FBG`, `Glu`, `TC`, `Cr` — are
   in `aliases`. An alias is a hint for your matcher, never an identity: send the `key_name`.

The list holds ~75 entries across the categories `inflammation`, `metabolic`, `lipid`, `liver`,
`renal`, `thyroid`, `cbc`, `cellular`, `hormone`, `tumor_marker`, `hair_element` (a hair ICP-MS
panel, µg/g — the sample type is in the key so a serum value never resolves there), `aging` (NAD+,
telomere) and `vitals` (the SBP/DBP printed on a 体检 cover sheet). It can change without notice,
which is why it ships with every claim.

**What is not a biomarker.** A genomics report's variant table, a microbiome abundance list, HPV
subtype results, an organic-acid panel (mmol/mol creatinine, no catalog key), an immune-age or
liver-glycan verdict. None of these belong in `observations`. Numeric rows go in `unmapped`, with
`section` set to the panel heading; everything else goes in the `structured` block (§7).

### The food vocabulary — `food_catalog`

A **chronic food-sensitivity report** (慢性食物过敏 / 食物特异性 IgG) is a different kind of
document: a grid of 100+ foods, each with an antibody level and a printed class. Those are **not**
biomarkers and must never be sent as `observations` — nano stores them separately, and routing them
through the biomarker path would overwrite the user's clinical lab panel.

`food_catalog` ships alongside `catalog` in every claim response, and standalone at
`GET /doc-extract/catalog`:

```json
{ "food_key": "casein", "name_zh": "酪蛋白", "name_en": "Casein", "category": "dairy_egg",
  "aliases": ["干酪素"], "common_sources_zh": ["牛奶","羊奶","双皮奶","奶酪"],
  "substitutes_zh": ["豆浆","鸡蛋","虾皮"] }
```

The same four rules apply, with one addition:

1. **`food_key` must come from this list, verbatim.** If you cannot resolve one, send the printed
   name in `label` instead — nano matches it against `name_zh`, `name_en` and `aliases`.
2. **Anything that resolves to neither goes to `unmapped`**, and is reported as `unmapped_food`.
   Do not map an unknown food onto a similar one: 牛奶, 水牛牛奶, 煮过的牛奶, 脱脂奶粉 and 水解奶粉
   are five distinct entries on a real panel, and so are 鸡蛋白 and 鸡蛋黄.
3. **`aliases` exists because one lab spells one food two ways.** The reference report prints
   卵类粘蛋白 in its results grid and 卵类黏蛋白 in its own appendix, and 螃蟹 vs 蟹.
4. `common_sources_zh` and `substitutes_zh` are nano's own reference data, given so you can see
   what a restriction will look like to the user. **Do not send them back** — they are ignored.

### The tag vocabulary — `tag_catalog`

A **tag** is a fact about the person the document states — an allergy, a diagnosis, a medication,
a diet, a lifestyle, a keyed qualitative result, a family history, a procedure. `tag_catalog`
ships in every claim response beside the other two catalogs, and standalone at
`GET /doc-extract/catalog`:

```json
{ "tag_key": "allergy:shellfish", "category": "allergy",
  "name_zh": "海鲜过敏", "name_en": "Shellfish allergy",
  "aliases": ["鱼虾贝类过敏", "海鲜类过敏", "虾蟹过敏"], "values": null }
{ "tag_key": "result:hpv52", "category": "result",
  "name_zh": "HPV52", "name_en": "HPV 52", "aliases": ["HPV-52"], "values": ["positive", "negative"] }
```

- Categories: `allergy`, `condition`, `medication`, `diet`, `lifestyle`, `result`,
  `family_history`, `procedure`. (`preference` and `goal` from `findings` are not tags — a goal is
  not a fact about the body; keep them on `findings` if wanted.)
- `values` names the admitted values for a keyed result; `null` means the tag is a bare fact.
- **A tag whose words resolve to nothing here is a `descriptor`, not a rejected item** — the same
  honesty `unmapped` gives markers. Send it with `kind: "descriptor"` and `tag_key: null`; nano
  stores and displays it and never acts on it. Do **not** pick the nearest key.
- The list is nano's own vocabulary and can change without notice. Where your corpus has a
  category the list lacks, say so — adding a row or an alias is a migration on nano's side, and
  nano then re-runs promotion over everything already stored (descriptors and `unmapped` rows
  included), so nothing has to be re-read.

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
      "confidence": 0.95, "source_text": "超敏C反应蛋白  1.2  mg/L  (0-1.0)", "source": "s0.t0.r0" },
    { "key_name": "LDL", "value": 3.9, "unit": "mmol/L", "data_date": "2026-08-12",
      "confidence": 0.93, "source_text": "低密度脂蛋白胆固醇  3.9  mmol/L", "source": "s0.t0.r1" },
    { "key_name": "ALT", "value": 22, "unit": "U/L", "data_date": "2026-08-12",
      "confidence": 0.91, "source_text": "丙氨酸氨基转移酶  22  U/L", "source": "s0.t0.r2" }
  ],

  "tags": [
    { "kind": "fact", "tag_key": "allergy:penicillin", "category": "allergy",
      "text": "青霉素过敏", "status": "current", "source": "s1.p0", "confidence": 0.94 },
    { "kind": "descriptor", "tag_key": null, "category": "lifestyle",
      "text": "长期夜班", "source": "s1.p1", "confidence": 0.85 }
  ],

  "findings": [
    { "category": "allergy", "text": "青霉素过敏", "confidence": 0.94 }
  ],

  "unmapped": [
    { "label": "血小板压积", "value": "0.22", "unit": "%", "ref_text": "0.17-0.35", "flag": null, "section": "血常规", "source": "s0.t0.r3" },
    { "label": "红细胞分布宽度-SD", "value": "42.1", "unit": "fL", "ref_text": "37-54", "flag": null, "section": "血常规", "source": "s0.t0.r4",
      "suggested_key": "RDW", "suggested_confidence": 0.6 }
  ],

  "structured": {
    "version": 2,
    "kind": "lab_report",
    "sections": [
      { "title": "血常规",
        "tables": [
          { "columns": ["项目", "结果", "参考区间", "单位", "提示"],
            "rows": [
              ["超敏C反应蛋白", "1.2", "0-1.0", "mg/L", "↑"],
              ["低密度脂蛋白胆固醇", "3.9", "<3.4", "mmol/L", "↑"],
              ["丙氨酸氨基转移酶", "22", "9-50", "U/L", ""],
              ["血小板压积", "0.22", "0.17-0.35", "%", ""],
              ["红细胞分布宽度-SD", "42.1", "37-54", "fL", ""]
            ] }
        ] },
      { "title": "既往史",
        "pairs": [ { "label": "药物过敏", "value": "青霉素过敏" }, { "label": "职业", "value": "长期夜班" } ] }
    ],
    "unanchored": 0
  }
}
```

The `findings` entry above duplicates the first tag on purpose, to show both shapes side by side;
a contract-3 worker sends `tags` and omits `findings`.

### `food_sensitivity`

Send this block **only** for a chronic food-sensitivity (IgG) report, in place of `observations`
— never both for the same grid. Omit it entirely for every other kind of document; omitting it is
the normal case and is not an error.

```json
{
  "food_sensitivity": {
    "panel_key": "igg_120",
    "unit": "U/mL",
    "sampled_at": "2026-04-15",
    "report_date": "2026-04-23",
    "institution": null,
    "sample_no": "559535391997",
    "class_bands": [ { "class": 1, "low": 50.0, "high": 100.0 } ],
    "items": [
      { "food_key": "casein", "label": "酪蛋白", "value": 52.8, "class": 1, "confidence": 0.97 },
      { "food_key": "cow_milk", "label": "牛奶", "value": 50.9, "class": 1, "confidence": 0.97 },
      { "food_key": "cherry", "label": "樱桃", "value": 44.3, "class": 0, "confidence": 0.95 },
      { "food_key": "watermelon", "label": "西瓜", "below_detection": true, "class": 0, "confidence": 0.95 }
    ]
  }
}
```

### `structured`

Optional. The document's content **as laid out** — every table and label/value pair the analyte
reader did not consume — so that nothing printed is lost and every promoted item can point back
at the cell it came from. Send it on every document that has any such table or pair, not only on
the special kinds: a 体检报告's 50 rows are the best example of content worth keeping in table
form. Nano stores it verbatim, renders a table as a table and a pair list as a key/value list,
and **derives nothing from it** at submission time. When the catalog later grows, nano re-reads
stored tables by column to promote rows that now resolve — that is what the columns are for.

**`version: 2` (contract 3) — tables stay tables:**

```json
{
  "structured": {
    "version": 2,
    "kind": "lab_report",
    "sections": [
      {
        "title": "血常规",
        "tables": [
          { "columns": ["项目", "结果", "参考区间", "单位", "提示"],
            "rows": [
              ["血小板压积", "0.21", "0.17--0.35", "%", ""],
              ["平均血小板体积", "10.2", "7.0--11.0", "fL", ""]
            ] }
        ],
        "pairs": [ { "label": "HPV52", "value": "阳性" } ]
      }
    ],
    "unanchored": 0
  }
}
```

- `kind` — the document's `doc_type`. `unanchored` — how many model-produced leaves your own
  anchoring check dropped (informational).
- A `table` has `columns` (non-empty, unique within the table, the header row as printed) and
  `rows`, each exactly `columns.length` cells, **verbatim** strings (or numbers / null). A
  `section` has optional `tables` and optional `pairs` (`{label, value, note?}`).
- Caps, and a violation refuses the **whole** block as `invalid_structured` — never trimmed, a
  cut-off table is a wrong table: 64 KB serialised, 50 sections, 20 tables per section, 200 rows
  per table, 500 characters per string, nesting depth 8 (root = 1; root → sections → section →
  tables → table → rows → row is 7), 200 entries per any other array, 100 keys per object.
  `:::` is stripped from every string.

**Version 1 (contract 2) is still accepted** — `version` absent or `1`, your own shape within the
same generic caps, rendered as a key/value tree:

```json
{ "structured": { "kind": "genetic", "sections": [
    { "title": "肥胖易感基因", "rows": [ { "label": "FTO rs9939609", "value": "AT", "note": "中等风险" } ] } ] } }
```

### `source` — a cell reference on everything promoted out of `structured`

Every observation, unmapped row, food item and tag may carry `source`: `"s0.t0.r3"` (section 0,
table 0, row 3) or `"s2.p1"` (section 2, pair 1). Optional. A malformed reference, or one that
points outside the block you sent, is **dropped from that item with a `bad_source` warning and
the item still lands** — see the response's `warnings`. Nano stores it beside the item, shows the
user the row a value came from, and uses it for re-promotion. `source_text` keeps its meaning
(the printed line, ≤200 chars) and is unrelated.

Total payload must stay under **256 KB**. If you are near it, trim `source_text` first, then
`structured`, then `unmapped` — the observations are what matter.

Every field is optional except `job_uid` and `result_token`. A document with nothing extractable is
still a legitimate result: send `document` and `summary` and empty arrays. That is a better outcome
than `/jobs/fail`, because the classification and the summary are useful on their own.

### `document`

| Field | Notes |
|---|---|
| `doc_type` | One of `lab_report`, `hospital_record`, `imaging`, `discharge_summary`, `prescription`, `genetic`, `microbiome`, `functional_test`, `other`. Unknown values fall back to `other` and are reported. `functional_test` is a functional-medicine assay — NAD+, organic acids, hair elements, telomere, immune age, AMH, homocysteine — as opposed to a clinical `lab_report`. |
| `doc_date` | `YYYY-MM-DD`. **The date on the report, not today.** If the page shows none, the claim's `document.doc_date` (possibly user-set). See §8. |
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
| `label` | recommended | The analyte name **as printed**. Stored on the report row so the record reads like the page; falls back to the catalog's Chinese name |
| `ref_text` | recommended | The printed reference range, verbatim, ≤60 chars (`"3.5-9.5"`, `"<5.2"`) |
| `flag` | recommended | The report's own abnormal marker: `high` / `low` / `null`. `H`, `L`, `↑`, `↓`, `偏高`, `偏低` are normalised for you |
| `section` | optional | The panel heading the row sat under, ≤60 chars (`"血常规"`, `"肝功能"`) |

### `unmapped`

One entry per printed analyte that resolves to no catalog key. **Kept, not discarded**: since
contract version 2 every entry becomes a row of the user's report, shown by its printed name, so
completeness matters — send all of them, up to the cap of 200.

| Field | Required | Notes |
|---|---|---|
| `label` | **yes** | The name as printed. An entry without one is dropped |
| `value` | recommended | As printed, as a string — `"0.22"`, `"<0.1"`, `"阴性"`. Nano keeps a number where it is one and the text where it is not |
| `unit` | recommended | As printed |
| `ref_text`, `flag`, `section` | recommended | Same meaning as on an observation |
| `source` | recommended | Cell reference into `structured` (see above) |
| `suggested_key` | optional | Your guess at a catalog `key_name` for this row, when you have one. Must be in the active catalog or it is dropped with an `unknown_suggested_key` warning (the row still lands). **Never promoted automatically** — stored for review and re-promotion, and rendered, if at all, as 「可能为 …」 beside the printed label, never as the marker's name. This is the one place a model's guess about a key exists in the record, and it stays a guess: a wrong key is a plausible number in the wrong marker of a person's twin, and nothing downstream can tell |
| `suggested_confidence` | with `suggested_key` | 0–1 |

### `tags`

Facts about the person, with a **key**, a **status** and an **anchor**. This is `findings` with
the three things a consumer needs to act on one safely. Cap 60 per result.

```json
"tags": [
  { "kind": "fact", "tag_key": "allergy:shellfish", "category": "allergy",
    "text": "海鲜过敏", "status": "current", "since": "2026-05-10",
    "source": "s2.p4", "confidence": 0.85 },
  { "kind": "fact", "tag_key": "result:hpv52", "category": "result",
    "value": "positive", "text": "HPV52 阳性", "source": "s0.p2", "confidence": 0.85 },
  { "kind": "fact", "tag_key": "medication:metformin", "category": "medication",
    "text": "既往服用二甲双胍，已停用", "status": "stopped", "source": "s3.p0", "confidence": 0.85 },
  { "kind": "descriptor", "tag_key": null, "category": "lifestyle",
    "text": "长期夜班", "source": "s3.p6", "confidence": 0.85 }
]
```

| Field | Required | Rule |
|---|---|---|
| `kind` | yes | `fact` or `descriptor` |
| `tag_key` | fact: yes | Must be in `tag_catalog` → otherwise the item is **demoted to `descriptor`** with `reason: unknown_tag`, not rejected |
| `category` | yes | One of the eight; for a fact it must equal the catalog entry's (else demoted, `reason: tag_category_mismatch`) |
| `text` | yes | The document's own words, ≤200 chars, **verbatim** |
| `value` | when the catalog entry has `values` | Must be one of them → `bad_tag_value` |
| `status` | optional | `current`, `past`, `stopped`; default `current` |
| `since` | optional | `YYYY-MM-DD`; defaults to `doc_date`; never today |
| `source` | recommended | Cell reference into `structured` |
| `confidence` | yes | ≥ 0.8 for a fact (as findings); any value on a descriptor |

What nano does with each kind — and this is the point of having two:

- **A fact is acted on.** `allergy` and `diet` filter product recommendations and feed
  formulation; a `current` `medication` is recorded for interaction checks; a `result` is shown
  as a result. Per `tag_key`, across all of the user's documents, **the newest `since` wins** and
  earlier statements are kept as history — a 2024 「服用他汀」 and a 2026 「已停用」 resolve to
  stopped without losing that it was once current.
- **A descriptor is never acted on.** Displayed under the document, kept for re-promotion when
  the catalog gains its alias, read by a model later if one is asked. Nothing in formulation,
  filtering or recommendation reads a descriptor.
- **`family_history` is its own category and never satisfies `condition`.** 「父亲高血压」 is a
  fact about the family, filed under `family_history`; a consumer looking for the subject's own
  conditions never sees it.
- **No verdicts.** Send what the document *says*, never what it means — no "elevated risk", no
  "abnormal" of your own. `flag` on a row stays the lab's own marker, read off the page.

### `findings`

Durable personal facts stated by the document: an allergy, a diagnosis, a dietary restriction.

| Field | Required | Notes |
|---|---|---|
| `category` | yes | `allergy`, `condition`, `dietary_restriction`, `preference`, `goal`, `other` |
| `text` | yes | Short, in the user's language, ≤200 chars — "青霉素过敏", not a paragraph |
| `confidence` | **yes** | 0–1. Below **0.8** is rejected, and a finding with **no** confidence is rejected outright |

**Since contract 3 a finding is stored as a `descriptor`** (`tag_key: null`) — shown under the
document, never acted on. It no longer reaches product filtering or formulation; only a `tags`
entry with a catalog key does. The rules below still apply on ingest, so a worker on contract 2
sees the same rejections it always did.

**Hold a high bar here.** These become durable statements about the person: an `allergy` filters
what products may be recommended to them and feeds their nutrition formulation. A wrongly recorded
allergy is a worse outcome than a missed one. Only send what the document actually asserts about
the patient — not a drug the report mentions, not a condition it rules out, not a family history.

### `food_sensitivity`

Panel fields:

| Field | Required | Notes |
|---|---|---|
| `panel_key` | yes | Short identifier for the assay, e.g. `igg_120` |
| `unit` | yes | The unit printed on the grid, e.g. `U/mL`. Every item shares it |
| `report_date` | **yes** | `YYYY-MM-DD`. **Without a readable one the whole panel is refused** — comparing this test to the next one is its entire clinical purpose, and a panel stamped with the wrong date cannot be compared |
| `sampled_at` | recommended | 采样日期, when the report distinguishes it from 报告日期 |
| `institution`, `sample_no` | no | As printed |
| `class_bands` | recommended | Only the bands the page **actually prints**, as `{class, low, high}`. A report normally prints a band only for classes that have results |

Item fields:

| Field | Required | Notes |
|---|---|---|
| `food_key` | yes* | From `food_catalog`, verbatim. *Or send `label` alone and let nano resolve it |
| `label` | recommended | The name as printed. Used to resolve when `food_key` is absent or unknown |
| `class` | **yes** | The integer class **printed on the page** (0–3). Never compute it from the value — see below |
| `value` | yes* | A number. *Omit it and send `below_detection: true` instead when the report prints a censored value |
| `below_detection` | see above | `true` for a censored reading such as `<0.1`. **Never send the string, and never substitute the detection limit as a number** — the lab declined to measure it, and 0.1 would assert a measurement nobody made |
| `unit` | no | Only if an item differs from the panel unit. A mismatch is rejected, never converted |
| `confidence` | recommended | 0–1. Below **0.6** is rejected |

**Read the class, do not derive it.** Every row on the grid is printed with its own class
(`0级`/`1级`/`2级`/`3级`). Thresholds differ between labs and between assays, and a report prints a
band only for the classes its subject actually has — so a panel with no positives prints no bands
at all. Send what the page says. Nano cross-checks a class against its own printed band when one is
present, and accepts it as read when one is not.

### The response

```json
{ "success": true, "job_uid": "9f2c…", "report_id": 8823,
  "accepted": { "observations_accepted": 3, "observations_written": 3,
                "observations_submitted": 4, "items_written": 5,
                "tags_submitted": 2, "facts_accepted": 1, "descriptors_accepted": 1,
                "tags_written": 2, "facts_written": 1,
                "findings_accepted": 0, "findings_submitted": 0,
                "food_items_accepted": 120, "food_items_submitted": 120,
                "food_panel_id": 41, "food_restrictions": 3,
                "unmapped": 2, "structured": 1, "rejected": 1, "warnings": 1 },
  "rejected": [ { "reason": "unit_mismatch", "entry": { "key_name": "FPG", "value": 95, "unit": "mg/dl" },
                  "detail": "expected mmol/L" } ],
  "warnings": [ { "reason": "bad_source", "entry": { "key_name": "ALT", "source": "s9.t0.r0" } } ] }
```

**`warnings` is a field dropped from an item that landed** (`bad_source`,
`unknown_suggested_key`); **`rejected` is an item that did not land.** Read both.

**Always read `rejected`.** It is the only signal that your extraction is systematically wrong
about something, and it is per-entry with a reason.

**`observations_accepted` and `observations_written` are different numbers, on purpose.** Accepted
means the value passed validation; written means a row was created. `health_events` deduplicates on
(user, source, marker, date), so re-reading a report already extracted — or two documents covering
one panel — validates cleanly and writes nothing. A repeat submission showing
`observations_accepted: 9, observations_written: 0` is correct behaviour, not a failure, and it is
`observations_written` that the user is told about.

`report_id` is a **number**, and is `null` only when no date could be resolved (see the date rule
in §8) or nothing at all was read. Since contract version 2 a report row is written for every dated
document that carried **any** printed analyte — catalogued or not — and `items_written` counts the
rows kept under it (observations plus `unmapped`). A NAD+ report with no catalog key still gets a
report. Every other scalar in this response is a number too — but treat them all as informational and
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

### Per document

| Rule | `reason` |
|---|---|
| `document.doc_type` is one of the nine in §7 | `unknown_doc_type` — falls back to `other`; the rest of the submission lands |
| `document.doc_date`, if given, parses as `YYYY-MM-DD` | `unparseable_date` — treated as absent |
| A `food_sensitivity` block was sent and nano could load `food_catalog` | `food_catalog_unavailable` — the panel is not validated; retry later |

### Per observation, in order

| # | Rule | `reason` on failure |
|---|---|---|
| 1 | `key_name` is in the active catalog | `unknown_marker` — moved to `unmapped` |
| 1b | `label`, if given, is an analyte name — not a clause | `implausible_label` |
| 2 | `value` parses to a finite number | `invalid_value` |
| 3 | `unit` matches the catalog's, or is a listed convertible | `unit_mismatch` |
| 4 | Value is within 0.1× `ref_low` and 100× `ref_high` | `implausible_value` |
| 5 | `confidence`, if given, is ≥ 0.6 | `low_confidence` |
| 6 | A date resolves, from `data_date`, `document.doc_date`, or the document row's own date (user-set, or read by an earlier run) — never today | `missing_date` |
| 7 | One value per marker per date | `duplicate_observation` — the first wins |

Rule 1b (and the same check on every `unmapped` entry) is a **prose guard**, added after two live
runs submitted sentence fragments as data: `同型半胱氨酸的理想水平是小于` with value `10` (the real
results on the page were 12.6 and 8.7), `如果被检者年龄小于 40 ng/ml`, `患病概率比您高的人群占 4 %`.
A label is refused if it is over 40 characters, contains sentence punctuation (。，；？！： — parentheses
are fine), or contains clause vocabulary (如果 / 研究表明 / 患者 / 人群 / 可能 / 建议 / 小于 / 超过 /
升高 / … or ends in 占 / 为 / 有 / 的 / 是). A number that sits in a sentence about a marker is not
that marker's result; only a row whose label is the analyte's printed name is.

Rule 4 is an **order-of-magnitude guard**, not a clinical range: it catches a misread decimal point
or a value read off the wrong row. It is deliberately loose, because several `ref_high` values are
risk thresholds rather than physiological ceilings.

Rule 6 has a consequence worth planning around: **with no readable date anywhere, no observations
are stored at all.** The document metadata and summary still are. A dated report is worth
re-reading carefully for its date before you give up on it — but do not invent one, and do not
substitute today. A wrong date puts an old panel into the user's twin as though it were current.

### Per food-sensitivity item, in order

| # | Rule | On violation |
|---|---|---|
| 0 | The panel itself has a `panel_key`, a `unit` and a readable, non-future `report_date` | `invalid_food_panel` — **the whole panel is refused**, no item is stored |
| 1 | `food_key`, or `label`, resolves in `food_catalog` | `unmapped_food`, and the item is echoed in `unmapped` |
| 2 | `class` is an integer 0–3 | `invalid_food_class`. An **absent** class is refused too — it must never default to 0, which is the one value that creates no restriction |
| 3 | `value` is a finite number, **or** `below_detection` is `true` | `invalid_food_value` |
| 4 | An item-level `unit` equals the panel's | `food_unit_mismatch` — never converted |
| 5 | When the page printed a band for that class, the value falls inside it | `class_band_mismatch` — refused, **never reclassified** |
| 6 | `confidence`, when given, is ≥ 0.6 | `low_confidence` |
| 7 | Each `food_key` appears once | `duplicate_food_item`, first read wins |

Beyond the item cap, the overflow is reported as `too_many_food_items`.

An accepted item is **rebuilt from the catalog row**, not echoed: the name, English name and
category nano stores are its own. Sending a different `name_zh` changes nothing.

### Convertible units

These pairs are converted for you. Anything else is `unit_mismatch`.

| `key_name` | Catalog unit | Also accepted |
|---|---|---|
| `FPG`, `TotalCholesterol`, `LDL`, `HDL`, `Triglycerides`, `BUN` | mmol/L | `mg/dL` |
| `Creatinine`, `UricAcid` | umol/L | `mg/dL` |
| `VitaminD` | nmol/L | `ng/mL`, `ug/L` |
| `hsCRP`, `CRP` | mg/L | `mg/dL` |
| `Hemoglobin` | g/L | `g/dL` |
| `VitaminB12` | pmol/L | `pg/mL`, `ng/mL` |
| `Folate` | nmol/L | `ng/mL`, `ug/L` |
| `Estradiol` | pmol/L | `pg/mL`, `ng/L` |
| `Testosterone` | nmol/L | `ng/mL`, `ng/dL` |
| `Cortisol` | nmol/L | `ug/dL`, `ug/L` |
| `TBIL`, `DBIL`, `IBIL` | umol/L | `mg/dL` |
| `ALB`, `TP`, `GLB`, `MCHC` | g/L | `g/dL` |
| `TSH` | mIU/L | `uIU/mL` (identical) |
| `Insulin` | uIU/mL | `mIU/L` (identical), `pmol/L` |
| `FT4` | pmol/L | `ng/dL` |
| `FT3` | pmol/L | `pg/mL` |
| `Ferritin` | ug/L | `ng/mL` (identical) |
| `Hcy` | umol/L | `mg/L` |
| `HbA1c` | % | `mmol/mol` (IFCC → NGSP) |

`LpA` is deliberately absent: nmol/L ↔ mg/L for lipoprotein(a) is not a fixed factor. Send it in
mg/L or leave it in `unmapped` with the printed unit.

Unit matching ignores case, spacing, and `µ` vs `u`. `mg/dL`, `MG/DL` and `mg / dl` are the same
string to nano.

### `structured`

| Rule | `reason` |
|---|---|
| Is a JSON object within the caps in §7 | `invalid_structured` — the whole block is dropped, the rest of the submission lands |
| `version: 2`: `sections[]` present; every table has non-empty unique `columns` and rows of exactly `columns.length` scalar cells; every pair has a `label` | `invalid_structured`, with the offending path in `detail` |
| `version` is absent, 1 or 2 | `invalid_structured` |

### Per `source` / `suggested_key` (warnings — the item still lands)

| Rule | `reason` |
|---|---|
| `source` matches `s<n>.t<n>.r<n>` or `s<n>.p<n>` and, when a `version: 2` block was sent, points inside it | `bad_source` — the reference is dropped |
| `suggested_key` is in the active catalog | `unknown_suggested_key` — the guess is dropped |

### Per tag, in order

| Rule | `reason` |
|---|---|
| `kind` is `fact` or `descriptor` | `invalid_tag` |
| `category` is one of the eight | `unknown_tag_category` |
| `text` is non-empty | `empty_tag` |
| `status`, if given, is `current` / `past` / `stopped` | `bad_tag_status` |
| `since`, if given, parses as `YYYY-MM-DD` | `unparseable_date` |
| fact: `confidence` is present and ≥ 0.8 | `low_confidence` |
| fact: `tag_key` is in `tag_catalog` | **demoted** to descriptor, `reason: unknown_tag` on the stored row — not rejected |
| fact: `category` equals the catalog entry's | **demoted**, `reason: tag_category_mismatch` |
| fact: `value` is one of the entry's `values`, when it has any | `bad_tag_value` |
| At most 60 tags | `too_many_tags` (the first 60 are processed) |

A duplicate (same key, status and value; or same descriptor text) is silently collapsed.

### Per finding

| Rule | `reason` |
|---|---|
| `category` is one of the six | `unknown_finding_category` |
| `text` is non-empty | `empty_finding` |
| `text` is a statement about the person, not prose | `implausible_finding` |
| `confidence` is present and ≥ 0.8 | `low_confidence` |

`implausible_finding` refuses what a live run actually sent as `allergy` facts: `过敏：免疫`,
`过敏：个别病人`, `药物过敏：患者是否会对药物产生过敏反应`, `过敏：约25%的病人可有皮疹…` — section
headings and population sentences from a genomics report's explanatory text, all at a constant
0.85 confidence. A finding is refused if it is over 40 characters, contains 。；？！ or a
percentage, contains 患者 / 病人 / 是否 / 人群 / 研究 / 通常 / 个别 / 可能 / 如果 / 建议, or has the
shape `label：value` with a value that is empty, one character, or generic (免疫 / 患者 / 正常 / …).
`青霉素过敏`, `药物过敏：青霉素` and `2型糖尿病` pass. **A constant confidence is not a confidence** —
send a real per-finding estimate, and do not emit findings from `genetic` / `microbiome` / `other`
documents whose text is population-level by nature.

---

## 9. Testing your implementation without touching a job

```
POST /doc-extract/validate
```

Send exactly the body you would send to `/jobs/result` (`job_uid` and `result_token` are ignored).
It runs **the same validator the real path runs** and returns what would be accepted and what would
be rejected — with **no job, no claim, and no write**.

```json
{ "success": true, "contract_version": 3, "would_accept": true,
  "document": {…}, "summary": "…", "observations": […], "tags": […], "findings": […],
  "unmapped": […], "structured": {…}, "rejected": […], "warnings": […], "counts": {…} }
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
| Unmapped entries per result | 200 |
| Findings per result | 40 |
| Tags per result | 60 |
| Food-sensitivity items per result | 200 |
| `structured` block | 64 KB, depth 8, 50 sections, 20 tables per section, 200 rows per table / per array, 100 keys per object, 500 chars per string |
| Summary | 2000 characters |
| `text` / `source_text` | 200 characters |
| `ref_text` / `section` | 60 characters |
| Observation confidence floor | 0.6 |
| Food-sensitivity item confidence floor | 0.6 |
| Finding confidence floor | 0.8 |
| Tag (fact) confidence floor | 0.8 |
| `source` reference | 40 characters |

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
