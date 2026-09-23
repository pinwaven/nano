'use strict';
// The contract, served at GET /api/twin/docs. It is the authority for a client; the design and
// its reasons are in docs/architecture/twin-function.md.
const CONTRACT_VERSION = 1;

function contractText() {
    return `# twin — contract v${CONTRACT_VERSION}

Base: \`/api/twin\`. Auth: \`Authorization: Bearer <TWIN_API_TOKEN>\` (per environment; no other
token opens this). Every response is HTTP 200 with \`{success, reason?, error?}\` except 401
(no or wrong token) and 404 (no such route). Send \`Accept-Encoding: gzip\`.

A subject is named only by \`subject_ref\` (\`vs_\` + 24 hex). No response carries a user id,
openid or phone, and only \`/subjects\` and \`/record/*\` carry the person's name.

## Read

### GET /versions?since=<ISO>&limit=<1..2000>
Subjects whose twin changed after \`since\` (all when absent), oldest change first:
\`{subject_ref, removed, changed_at}\`. \`removed: true\` = the user is gone — delete the replica;
it is reported regardless of \`since\`. \`truncated: true\` = page again from the last
\`changed_at\`. \`changed_at\` is a signal; \`twin_version\` is the truth — run a periodic full pass.

### GET /bundle?subject_ref=
The twin bundle a Viva AG job receives (bundle_version in the body), outside any job, over every
active document. Adds \`twin_version\` (sha256 of the bundle minus volatile fields: mint time,
presigned URLs, job fields) and \`twin_changed_at\`. Document URLs expire; fetch bytes at sync
time or re-mint with /document-url. The bundle's inventory \`endpoint\` hints name the job-scoped
/viva-ag paths; outside a job use /feed/* below.

### GET /document-url?subject_ref=&document_id=
A fresh presigned URL for one active document of that subject.

### GET /feed/<name>?subject_ref=&after=<seq>&limit=<1..2000>
Incremental changes to one bulk table, in order. Names: \`health-events\` (\`&category=\`),
\`lab-reports\`, \`biomarkers\` (\`&test_type=\`), \`chat-messages\`.

\`\`\`
{ feed, after, next_after, has_more, settle_seconds, count,
  changes: [ {seq, op: "upsert", item: {...}} | {seq, op: "delete", id} ] }
\`\`\`
Start with \`after=0\`. Apply \`changes\` in order — an upsert is the whole row as it now is, keyed
by its id field (\`event_id\`, \`report_id\`, \`biomarker_id\`, \`message_id\`); a delete names the id.
Store \`next_after\` and pass it next time. \`has_more: false\` = caught up to the settle horizon:
changes younger than \`settle_seconds\` are held back so a cursor never passes a row whose
transaction had not committed yet. With a filter, deletions are still sent unfiltered.
On \`health-events\`, \`origin\` is the contribution_uid a row came from, when it came from one.

## The full record — for a report addressed to the person

These carry the person's name, because a report is written to them by name; nothing else here does.

- \`GET /subjects?q=<nano user id | exact nickname>\` → \`[{subject_ref, nickname, created_at}]\`,
  exact matches only.
- \`GET /record/profile?subject_ref=\` → nickname, first/last name, gender, birth date, language,
  body data, wearable, channel. Never phone, email, openid or an ID number.
- \`GET /record/tables?subject_ref=\` → which health-record tables hold rows and how many, plus the
  joined views \`questionnaire_answers\` and \`cartridges_named\`.
- \`GET /record/table?subject_ref=&table=&offset=&limit=<≤2000>\` → rows, \`has_more\`. \`user_id\`,
  credentials, contact and address columns and the raw lab exchange are removed from every row.
- \`GET /record/reference\` → \`dots\`, \`biomarker_catalog\`, \`health_plan_templates\`.
- \`GET /file?subject_ref=&key=\` → a ten-minute URL for a file whose storage key one of this
  subject's rows names (documents, report images, photos, lab PDFs); \`not_found\` otherwise.

## Write — contributions

Everything the replica's side adds to a twin comes back as a **contribution**:

\`\`\`
POST /contributions
{ subject_ref, contribution_uid: <UUID you mint>, kind, origin, payload, supersedes?: [uuid] }
origin: { agent_id, principal_kind: "platform-agent"|"physician", display_name, gated: bool, reviewed?: bool }
\`\`\`
\`contribution_uid\` makes a retry safe: posting the same uid again returns
\`already_registered: true\` and writes nothing. \`origin\` is stored as given and shown as given;
\`gated\` says whether the content passed the sender's own output checks.

Kinds accepted now: **report**. \`observations\` and \`finding\` answer \`unsupported_kind\` until
nano has a place to show them.

### kind: report
1. \`POST /contributions/upload-url {subject_ref, contribution_uid, filename}\` →
   \`{oss_key, put_url, put_content_type, expires_in}\`. PUT the bytes with exactly
   \`put_content_type\`. Types: pdf, md, txt. Up to 5 files.
2. \`POST /contributions\` with \`kind: "report"\` and
   \`payload: {command_key, summary, files: [{oss_key, filename}], title?, document_ids?}\`.
   \`command_key\`: full_analysis | document_review | risk_screen | dots_formulation |
   food_sensitivity_review. \`summary\` (≤4000 chars) is the abstract on the user's 综合报告
   card. \`document_ids\` are kept only where they are this subject's.
   \`supersedes\`: earlier report contributions (or reports published before this function) this
   one replaces; they leave the card and stay on record.

### POST /contributions/withdraw {subject_ref, contribution_uid, reason}
Takes a contribution back; it leaves the user's view and stays on record with the reason.

### GET /contributions?subject_ref=
This subject's contributions, newest first.

## Reasons
missing_params, not_found, subject_not_found, document_not_found, unsupported_kind,
unsupported_file_type, invalid_file_key, file_missing, too_many_files, invalid_origin,
contribution_conflict, internal_error.
`;
}

module.exports = { CONTRACT_VERSION, contractText };
