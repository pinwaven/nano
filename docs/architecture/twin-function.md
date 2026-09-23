# The twin function (`src/functions/twin`)

Nano keeps every user's digital twin. Curia keeps a replica, and **both sides change it**: nano
records what the user does and uploads; Curia adds what its agents produce — a report, values read
out of a document. **This function is every route between Curia and nano, and the worker answers
none of them** (decided 2026-09-23). Three scopes, three per-environment tokens, one each:

| Token | Paths | What |
|---|---|---|
| `TWIN_API_TOKEN` | `/api/twin/{ping,docs,versions,bundle,feed/*,document-url,contributions*}` | the twin exchange |
| `VIVA_AG_API_TOKEN` | `/api/twin/viva-ag/*` | the paid deep-analysis queue (CLAUDE.md §35) |
| `DOC_EXTRACT_API_TOKEN` | `/api/twin/doc-extract/*` | the document-extraction queue (§39) |

A valid token outside its scope is 403; the worker accepts none of the three (401). Contracts:
`/api/twin/docs`, `/api/twin/viva-ag/docs`, `/api/twin/doc-extract/docs` — served from
`src/functions/twin/docs/`, which moved there from the worker.

## Why its own function

- **It deploys alone.** A twin change ships without redeploying chat, jobs and extraction, and a
  worker deploy — including one from another checkout, which has overwritten dev twice — cannot
  take the exchange down.
- **Its own credential.** `TWIN_API_TOKEN` (`twn_` + 32 hex), per environment, distinct from the
  viva-ag and doc-extract tokens. This one reads every subject's twin and writes to it, which is
  more than either of those can do, and a leak of either must not open it.
- **Its own sizing and logs** (512 MB, 300 s — a queue result can take that long to deliver), gzip on every large response.

## The worker's code, generated into `shared/` at deploy

The queues are nano's own behaviour — a result becomes a chat message, a formulation is validated
against GCN, extracted values land in the record, a questionnaire is phrased — so the twin function
runs the worker's own handlers rather than a second implementation. `scripts/sync-twin-shared.js`
computes the transitive `require` closure of `handlers/viva_ag.js` and `handlers/doc_extraction.js`
(~100 files) and copies it into `shared/worker/`, layout preserved. It runs as the twin resource's
`pre-deploy` action and as `npm pretest`, and fails if the closure needs an npm package
`twin/package.json` does not declare.

**`shared/` is git-ignored.** A committed copy is a second source that drifts; the worker is the
only one, and edits go there. The environment block in s.yaml carries the variables that code
reads, with the worker's values.

Why it matters that both functions run one build: `twin_version` is a hash of what
`buildTwinBundle` produced, so two builds hash one unchanged twin two ways. Deploy both from one
commit. `/ping` reports `shared_code` (a hash of `shared/`) so a skew is visible.
Verified on dev 2026-09-23, before the worker's copy was retired: its `/viva-ag/subject-bundle` and `/bundle`
returned the same `twin_version` for the same subject.

`formatQuestionnaireContext` moved from `handlers/questionnaires.js` into
`lib/questionnaireContext.js` (re-exported there) so that copying the bundle builder did not drag
the OpenAI client and persona handlers along with it.

## Reads

| Route | What |
|---|---|
| `GET /versions?since=` | which subjects changed; `removed: true` when the user is gone |
| `GET /bundle?subject_ref=` | the bundle a job receives, over every active document, plus `twin_version` |
| `GET /feed/<name>?subject_ref=&after=` | upserts and deletes of one bulk table, in order |
| `GET /document-url` | re-mint one document's URL |

The change signal (`CHANGED_AT_SQL` in `lib/twinMirror.js`) now also reads `twin_touch`, a row per
user bumped by trigger on any insert, update or delete of a bundle table
(`migration_twin_sync.sql`). The old signal was GREATEST over creation stamps: it could not see an
in-place update of a table with `created_at` only, a hard delete, or four tables it did not list
(food sensitivity, questionnaire answers, plan check-ins, milestones). The touch is broader than
the bundle — a chat message touches a user whose bundle only counts messages — so a listed subject
can turn out unchanged; the version decides.

Feeds (`health-events`, `lab-reports`, `biomarkers`, `chat-messages`) page on `twin_seq`, a global
sequence stamped by trigger on every insert and update of those four tables, with deletes as
`twin_tombstones` in the same numbering. A reader only receives changes stamped more than
`TWIN_SETTLE_SECONDS` (60) ago: a sequence value is drawn before its transaction commits, so a
lower number can become visible after a higher one, and without the settle a cursor would pass it
forever. The job-scoped `/viva-ag/*` history endpoints keep their snapshot-id cursors unchanged.

## The full record, for a report addressed to the person

Curia's health-report skill reads far more than the bundle: every table that is the person's health
record, two joined views, the reference tables and the files behind the rows. It used to hold nano's
read-write database account and the bucket keys to do it; since 2026-09-23 it reads
`/subjects`, `/record/{profile,tables,table,reference}` and `/file` instead (`lib/record.js`):

- one subject per call; tables from an allowlist (`ALLOW`) — not the coach CRM, identity,
  commission, academy or partner tables;
- `user_id`, credentials, contact channels, addresses and the raw lab exchange (`lab_request`,
  `lab_response`, which carry name, phone and ID number) are dropped from every row (`DENY`);
- the profile is what a report is addressed with — nickname, the person's name, gender, birth
  date, language, body data, diet preferences — never phone, email, openid or an ID number. These
  routes are the only ones that carry a name;
- `/file` presigns a key for ten minutes only when one of this subject's rows names it, matched
  exactly (a `LIKE` would let a key with `%` presign any file);
- DATE columns come back as `YYYY-MM-DD` via a per-query type parser, so the queue handlers sharing
  the pool keep their own parsing.

## Writes — contributions

Everything the replica's side adds comes back as one envelope:
`{subject_ref, contribution_uid, kind, origin, payload, supersedes?}`.

- `contribution_uid` is the **sender's** UUID. A POST that arrives twice finds its own row
  (`already_registered`) — a lost reply and a lost request look the same to the sender.
- `origin` is required: `agent_id`, `principal_kind` (`platform-agent` | `physician`),
  `display_name`, `gated`, `reviewed?`. Nano cannot verify a Curia principal and does not pretend
  to: it stores what it was told under `origin` and promotes it into nothing nano asserts.
- `twin_contributions` records every contribution, where it landed (`target`), and its status
  (`accepted` / `superseded` / `withdrawn`).

**`report`** lands as a completed `viva_ag_jobs` row (`claimed_by 'curia-twin'`,
`result.origin`), which is what the 数字孪生 综合报告 card and the Viva AG panel list. Files are
uploaded to a presigned PUT under `viva-ag-results/<contribution_uid>/`; registration accepts only
keys under that prefix that exist in OSS. `supersedes` cancels earlier Curia reports (and those the
health-report skill published directly, `claimed_by 'claude-code-analyst'`) — never a job nano's
own queue delivered. `withdraw` takes one back with a reason; the row stays.

Verified on dev 2026-09-23: upload, register, re-post (no second row), refusal of another
contribution's key and of an unsupported kind, the card query listing it, withdraw removing it.

## Subjects for every user

Minting a `subject_ref` for every user (rather than only those who invoked the agent) is **off** in
the migration and turned on per environment by `scripts/twin-all-users.js --apply --by --note`,
which backfills and sets `twin_sync_policy.mint_all_users` so a trigger mints at signup. It is a
script because it is a decision. **The decision was made 2026-09-23** (permission given for Curia to
hold and sync every user's twin). Applied on dev: 1,080 minted, signup trigger verified. Prod waits
on the prod migration.

## Who produced a report, on screen

The 综合报告 card and the Viva AG panel show one line under a finished report —
`由Viva（平台智能体）生成 · 未经人工审阅` — composed by `lib/reportAttribution.js` from what the row
records: `result.origin` (a contribution), `result.speaker` (a job answered by Curia's vivad), or
neither (it says Viva, and nothing about review). A physician's agent reads as a different speaker.

## Open

1. **`finding`** — a physician agent's diagnostic result. Deferred by decision (2026-09-23); refused
   as `unsupported_kind` until then.
2. **`observations`** — superseded: extracted values arrive through the doc-extract queue, which is
   now in this function. A contribution kind for them would be a second door.
3. **A narrower database account.** Today `nano_admin`; a console act.
4. **Prod cutover deployed (2026-09-23).** User confirmed Curia's production services switched. Full production deployment completed: worker queue routes retired and its two external queue credentials removed; `/api/twin/*` now routes to `twin`. Authenticated ping checks pass for twin, viva-ag and doc-extract scopes. Runtime dependencies installed with `npm ci --omit=dev --prefix src/functions/twin` before the final twin deploy (an initial package lacked them and returned 502). `twin-all-users.js --env prod --apply` remains a separate data operation, not run as part of deployment.
5. **The miniapp** carries the attribution line (VERSION 0923-2) and has not been uploaded.
6. **Custom domain** on dev: the route is in s.yaml, not deployed; clients use the function URL.
