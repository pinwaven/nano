# The twin function (`src/functions/twin`)

Nano keeps every user's digital twin. Curia keeps a replica, and **both sides change it**: nano
records what the user does and uploads; Curia adds what its agents produce — a report, values read
out of a document, a physician agent's finding. This function is the whole of that exchange and
nothing else. The contract is served at `GET /api/twin/docs` and is the authority for a client;
this file is the design and its reasons.

## Why its own function

- **It deploys alone.** A twin change ships without redeploying chat, jobs and extraction, and a
  worker deploy — including one from another checkout, which has overwritten dev twice — cannot
  take the exchange down.
- **Its own credential.** `TWIN_API_TOKEN` (`twn_` + 32 hex), per environment, distinct from the
  viva-ag and doc-extract tokens. This one reads every subject's twin and writes to it, which is
  more than either of those can do, and a leak of either must not open it.
- **Its own sizing and logs** (512 MB, 120 s), gzip on every large response.

## Shared code, and why it must be byte-identical

`shared/` holds copies of the worker modules that build the bundle and compute its version:
`twinBundle.js`, `twinMirror.js`, `oss.js`, `time-utils.js`, `labHistory.js`,
`questionnaireContext.js`. The worker is the source. `scripts/sync-twin-shared.js` copies them;
s.yaml runs it as the twin resource's `pre-deploy` action; `tests/twin-function.test.js` fails on
drift and on any `require` that leaves the function directory.

The reason is `twin_version`: a hash of what `buildTwinBundle` produced. Two deploy units running
two builds of it hash one unchanged twin two ways, and the replica reads that as a change. `/ping`
reports `shared_code` (a hash of `shared/`) so a skew is visible before it costs a refetch.
Verified on dev 2026-09-23: the worker's `/viva-ag/subject-bundle` and this function's `/bundle`
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
script because it is a decision: every user's twin becomes readable by the holder of
`TWIN_API_TOKEN`. Not applied on dev or prod as of this writing.

## Open — decisions this function does not make

1. **`observations`** — values Curia reads or a physician's agent records. Doc extraction already
   writes back through `/doc-extract/*` (its own job queue, token and validator). Either those
   endpoints move into this function, keeping their validator, so all of Curia's writes arrive one
   way; or `observations` becomes a second door and has to carry the same validation, which is the
   kind of duplication that drifts. Recommended: move them.
2. **`finding`** — a physician agent's diagnostic result. Needs a nano table, a place in the miniapp
   and an attribution rule the user can read (a named physician's agent, a platform agent and
   ungated output are three different speakers), and a consent scope per physician.
3. **Consent and erasure** (twin-sync gaps 5 and 6): a per-user consent record read before minting
   or serving, and a signal for partial erasure, account merge and consent withdrawal beyond
   `removed: true`.
4. **A narrower database account.** Today `nano_admin`. The function needs SELECT on the twin tables
   and INSERT/UPDATE on `viva_ag_jobs` and `twin_contributions`; `nano_admin` cannot create roles
   on this cluster, so it is a console act.
5. **The report card does not show `origin` yet.** It is stored on every contribution; rendering
   who produced a report is a miniapp change.
6. **Prod.** Migration (measure `health_events` / `chat_messages` row counts first — the backfill
   updates every row in one transaction), an `s-prod.yaml` entry and route, a prod token, then
   retiring the worker's `/viva-ag/twin-versions` and `/viva-ag/subject-bundle` once Curia prod
   reads from here. **Migrate before deploying the worker**: its `twinMirror.js` reads `twin_touch`
   on the claim path.
7. **Custom domain.** `/api/twin/*` → `twin-dev` is in s.yaml but the domain was not redeployed;
   the client uses the function's own URL.
