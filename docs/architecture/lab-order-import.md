# Importing QCS / 量康 lab orders

External writers own `lab_orders`. Nano imports completed goods from `lab_final_result` into the user's standard medical record. No BioAge recalculation occurs.

## External writer callback

After committing an insert **or a result update**, call:

```http
POST /api/lab-orders/53/import
Authorization: Bearer <LAB_IMPORT_TOKEN>
Content-Type: application/json

{}
```

The ID is Nano's `lab_orders.id`, not the external order number. Nano resolves the user and reads the latest row itself. Never send lab credentials, user IDs or measurement values in the callback. The callback normally returns HTTP 202 with `{success:true, order_id:"53", status:"queued"}`. An unchanged imported/waiting revision returns HTTP 200. HTTP 503 means publishing failed; retrying is safe, and the durable queue also lets reconciliation recover it.

`LAB_IMPORT_TOKEN` is a private server credential. A signed superadmin session also works; the bearer embedded in the apps and ordinary user/channel-admin sessions cannot trigger imports. The service token can only access these import routes. Provision `LAB_IMPORT_TOKEN` for dev and a separate `LAB_IMPORT_TOKEN_PROD` for prod in the deployment environment; both map to the runtime variable `LAB_IMPORT_TOKEN`. Keep them out of frontend config.

```http
GET /api/lab-orders/53/import
Authorization: Bearer <LAB_IMPORT_TOKEN>
```

Returns status, revision, attempts, counts, warnings/error and update time. States:

- `queued`: awaiting worker delivery.
- `processing`: executing (writes and this state share one transaction).
- `imported`: available structured results were imported.
- `waiting`: no completed goods, missing dates, or PDF-only tests still require extraction / a missing matching PDF. Unchanged waiting orders are not repeatedly queued. PDF extraction jobs have their own lifecycle in `doc_extraction_jobs`.
- `failed`: transaction rolled back; eligible for retry.

`imported` means the importer finished its available source data, not that every printed analyte maps to a computational marker. `counts.unmapped` records preserved rows that do not feed the twin.

## Processing and reconciliation

A CloudEvents 1.0 `lab.order.import` event carries only `{order_id}` on `acs.lab` (production) or `acs.lab.dev` (dev). The existing worker EventBridge trigger accepts these sources. Errors propagate to EventBridge for retry.

A worker timer runs every ten minutes. It selects up to 25 linked QCS orders with new/changed results, or queued/failed jobs older than ten minutes. It queues each using the same importer. All source fields used by the importer contribute to a deterministic database revision hash, including the saved PDF key; volatile `updated_at` does not.

Manual sweep:

```http
POST /api/lab-orders/reconcile
Authorization: Bearer <LAB_IMPORT_TOKEN>
Content-Type: application/json

{"limit":25}
```

The limit is capped at 100. It queues work and does not process reports in the HTTP request.

## Storage and correction semantics

- One `health_reports` row per order + completed goods ID with structured results and a reliable date.
- All structured rows go to `health_report_items`. Original values and units also remain in `raw_data` for audit.
- Only explicit QCS analyte mappings accepted by the existing document validator feed `health_events(category='lab_result',source='qcs')`. The validator checks plausible values and supported unit conversions. Total 25-OH vitamin D converts ng/mL to nmol/L; D2/D3 fractions are retained separately, never treated as total vitamin D.
- Detection-limit strings remain text. Missing units, unknown markers, or rejected measurements remain in the report but do not feed twin calculations.
- Dates are Shanghai calendar dates from each panel's `test_time`, with the goods `reported_at` date as fallback. Never use import time as the measurement date.
- A saved PDF is registered as a `health_documents` row, available through the existing owner/coach-authorized PDF endpoint and existing Health-tab component. This trusted server path can register `lab-reports/qcs/<external_order_id>/...`; the public upload endpoint's namespace checks are unchanged.
- Each order currently saves **one** PDF key. It is attached only to the goods ID identified by that filename. Never pretend that PDF covers every test in the order. Missing per-test PDFs are recorded as waiting warnings.
- PDF-only tests, unknown PDF association, and IgG PDFs enqueue the existing document-extraction workflow. IgG uses that workflow's specialized food-panel storage. Existing jobs and user-deleted documents are not automatically recreated; failed/rejected PDF extraction can be reviewed/re-run through the existing document controls.
- Structured reports are independent of PDF extraction reports, so clearing an extraction does not delete structured QCS measurements. Both preserve provenance.
- A changed revision replaces that order's own report items and observations atomically, retaining the report ID. Removed/incomplete goods lose their previous structured measurements. Order/user and PDF ownership mismatches fail rather than move medical data to a different user.
- Database advisory locks serialize order imports and twin refreshes for the same user. The twin refresh must succeed before commit; retries cannot leave partial reports or a stale successful import status.

## Deploy and backfill

Migration: `src/schemas/migration_lab_order_imports.sql`. It is tracked by the normal migration runner. The legacy `lab_orders` table must already exist.

1. Provision distinct `LAB_IMPORT_TOKEN` (dev) and `LAB_IMPORT_TOKEN_PROD` (prod) securely in the deployment environment.
2. `npm run migrate:dev`, then run offline tests and dev verification.
3. `npm run deploy:worker`. Verify callbacks, EventBridge delivery and the timer on dev.
4. Apply the tested migration with `npm run migrate:prod`, then `npm run deploy:worker:prod`.
5. Backfill using the same importer, then configure the external writer callback.

The worker configuration is already included in `s.yaml` and `s-prod.yaml`:

```yaml
environmentVariables:
  LAB_IMPORT_TOKEN: ${env(LAB_IMPORT_TOKEN)}
triggers:
  - triggerName: lab-order-reconcile
    triggerType: timer
    triggerConfig:
      enable: true
      cronExpression: "0 */10 * * * *"
      payload: "lab-order-reconcile"
```

The timer begins discovering existing orders after deployment, so production deployment also starts the backfill in batches. No separate new FC handler/function is required.

CLI dry run is the default and reads only:

```sh
node scripts/import-lab-orders.js --env dev
node scripts/import-lab-orders.js --env prod
node scripts/import-lab-orders.js --env dev --order 53
```

Explicit write modes (same validation, transactions and idempotency as the worker):

```sh
node scripts/import-lab-orders.js --env dev --order 53 --apply
node scripts/import-lab-orders.js --env prod --apply
```

`--queue` publishes events instead of importing inline and requires FC STS credentials and `FC_REGION`; local prod queueing must have no `.dev` `EVENT_SOURCE_SUFFIX`. The CLI selects its database from `DATABASE_URL` / `DATABASE_URL_PROD`; it never prints the connection string or lab API credentials.

Initial verification on 2026-10-05: all 53 orders exercised against dev inside a rolled-back transaction: 91 structured reports, 1,984 items, 69 mapped observations, 53 documents, 24 extraction jobs. All replays skipped. A corrected VitaminD result retained its report ID and replaced its value. Production was read-only during verification; no migration, deploy or backfill was applied there.
