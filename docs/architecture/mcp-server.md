# MCP Server — read-only data access for the analysis workshop (`nano-mcp-dev`)

`src/functions/mcp/` is an Aliyun FC 3.0 function that exposes the **nano** and **GCN** dev
databases to any MCP-compatible client (Claude, Claude Code, Cursor, Dify/Bailian-style
workshops, the MCP Inspector) as a single [Model Context Protocol](https://modelcontextprotocol.io)
endpoint. It is deliberately narrow: schema discovery plus one read-only SQL tool, dev data only,
no writes possible.

| | |
|---|---|
| Endpoint | `https://nano-dev.gcn.net/mcp` (Streamable HTTP, stateless JSON) |
| Health | `GET https://nano-dev.gcn.net/mcp/health` — no auth, touches no database |
| Auth | `Authorization: Bearer <MCP_API_TOKEN>` (`.env` key; convention `mcp_` + 32 hex) |
| Databases | `nano_db_dev` (as `nano_admin`), `gcn_db_dev` (as `gcn_admin`) |
| Deploy | `npm run deploy:mcp` (dev only — there is no `mcp` block in `s-prod.yaml`) |
| Local | `npm run mcp:local` → `http://127.0.0.1:3010/mcp` |

## Tools

Every tool takes `database: "nano" | "gcn"` and is annotated `readOnlyHint: true`.

| Tool | What it does |
|---|---|
| `waven_get_data_map` | The join guide: what each database owns, cross-database keys (`gcn.users.nano_user_id` ↔ `nano.users.user_id`, …), and naming traps (no `stores` table in GCN; `biomarkers.data->'validated'` not `'actual'`). Also served as resource `waven://data-map`. Read it first. |
| `waven_list_tables` | Tables/views with estimated row counts, size and comments. Optional `name_filter` (ILIKE). |
| `waven_describe_table` | Columns, PK, FKs, **inbound** FKs (which tables reference this one), unique/CHECK constraints (status vocabularies live in CHECKs), indexes. |
| `waven_search_columns` | ILIKE search over column *and* table names — e.g. `%nano_user%`, `%phone%`. |
| `waven_query` | One `SELECT`/`WITH`/`EXPLAIN`/`SHOW` statement. `max_rows` (default 200, max 2000), `timeout_ms` (default 15 s, max 60 s), `format: markdown \| json`. Returns `content` text plus `structuredContent` `{columns, rows, row_count, truncated, duration_ms}`. |

Cross-database joins are not possible in SQL — the client queries each side and joins the results
itself using the keys in the data map.

## Access scope — what an analyst can actually read

**Everything in both dev databases.** The server connects as the same accounts the applications
use — `nano_admin` on `nano_db_dev`, `gcn_admin` on `gcn_db_dev` — and there is no per-table
allowlist and no column masking. Verified live (2026-09-15) through the endpoint itself:
`has_table_privilege(current_user, …, 'SELECT')` is true for all 73 `public` tables in
`gcn_db_dev` and all 116 relations in `nano_db_dev`. Views, `information_schema`, `pg_catalog`
and the PolarDB extension schemas (`cron`, `polar_catalog`) are readable too. That includes the
sensitive columns: `users.phone`, WeChat openids (`external_id`), chat text, biomarker values,
`ledger`, `sku_activation_codes`, `partner_bindings`.

Neither account is a superuser (`rolsuper = false`), so the exposure is bounded by the database,
not the cluster: the nano pool cannot reach `gcn_db_dev`, the GCN pool cannot reach
`nano_db_dev`, and neither can reach any prod database (see the dev-only guard below).

What "full read" does **not** include, by design:

| Not possible | Enforced by |
|---|---|
| Any write — INSERT/UPDATE/DELETE, DDL, `CREATE TEMP TABLE`, `SELECT INTO` | `SET TRANSACTION READ ONLY` on every call (Postgres refuses; verified) |
| More than one statement per call; anything not starting `SELECT`/`WITH`/`EXPLAIN`/`SHOW`/`TABLE`/`VALUES` | `lib/sql-guard.js` |
| `FOR UPDATE`/`FOR SHARE`, `COPY`, `pg_sleep`, `pg_read_file`, `lo_*`, `dblink`, `pg_notify`, `set_config`, `nextval`, advisory locks | `lib/sql-guard.js` — side effects a read-only transaction would still allow |
| More than 2000 rows per call (default 200); statements over 60 s (default 15 s) | `LIMIT n+1` wrapper; `SET LOCAL statement_timeout` |
| Cross-database joins | Two separate databases — the client joins on the keys in the data map |
| Any `_prod` database | `lib/db.js` refuses the pool at construction |

**If the scope ever needs narrowing** (hide `users.phone` or `ledger` from the analyst, say), do
it with a dedicated read-only Postgres role and column-level `GRANT`s, pointed at by
`NANO_DB_USER`/`GCN_DB_USER` in `s.yaml` — not with more regexes in the guard. The guard's job
is to enforce *read-only*; deciding *which* data is readable belongs to the database's own
privilege system, which cannot be argued around by a cleverly written query.

## Safety model

Three independent layers; any one of them alone would keep the server read-only.

1. **`SET TRANSACTION READ ONLY`** — `lib/db.js`'s `withReadOnly()` wraps *every* query (catalog
   lookups included) in `BEGIN` → `SET TRANSACTION READ ONLY` → `SET LOCAL statement_timeout` →
   `SET LOCAL lock_timeout = 2000` → … → `ROLLBACK`. Postgres itself refuses
   INSERT/UPDATE/DELETE/DDL/`CREATE TABLE AS` with `cannot execute … in a read-only transaction`
   (verified live on dev).
2. **`lib/sql-guard.js`** — pure, unit-tested: one statement only (no `;` — without bind params
   `pg` uses the simple protocol, which would run `SELECT 1; DROP …`), must start with
   `SELECT|WITH|EXPLAIN|SHOW|TABLE|VALUES`, and refuses the things a read-only transaction does
   not stop: `FOR UPDATE/SHARE`, `SELECT INTO`, `COPY`, `pg_sleep`, `pg_terminate_backend`,
   `pg_read_file`, `lo_*`, `dblink`, `pg_notify`, `set_config`, `nextval`/`setval`,
   `pg_advisory_*`. SELECT-shaped statements are wrapped in `SELECT * FROM (…) AS _mcp LIMIT n+1`
   so a runaway query cannot return more than `max_rows` (the +1 is how `truncated` is detected).
3. **Dev only by construction** — `lib/db.js` throws at pool construction unless the database
   name ends in `_dev`. Do not add an env switch to reach prod; if prod analysis is ever wanted it
   needs a read-only Postgres role and its own decision.

Other constraints worth knowing:

- **Pools are capped at 2 connections each** (`max: 2`, `idleTimeoutMillis: 10000`). The
  cluster is shared with GCN prod and was exhausted once by uncapped nano pools (CLAUDE.md §32).
- No PII masking — see "Access scope" above. A dev-data, trusted-internal-user decision;
  revisit before pointing anything like this at prod.
- The token is checked with `crypto.timingSafeEqual`; an **unset** `MCP_API_TOKEN` means every
  request is 401, never "open".
- `DATE` / `TIMESTAMP` (without tz) columns are returned as the literal text (`2026-08-16`), not
  as JS Dates — `pg`'s default parses them at process-local midnight, which on FC (UTC) shifts
  every date a day back when serialised.

## Why the transport is hand-rolled

FC 3.0 HTTP triggers are **event** functions: the handler gets a plain event object and
*returns* `{statusCode, headers, body}` (see the `fc3-handler-reference` skill). There is no
Node `IncomingMessage`/`ServerResponse`, so the SDK's `StreamableHTTPServerTransport` cannot be
mounted. `lib/transport.js` implements the SDK's public `Transport` interface in memory: per
HTTP request it connects a fresh `McpServer`, feeds the JSON-RPC message(s) in, collects what
the server `send()`s, and returns that as the body. This is exactly what the SDK's own stateless
mode does internally, which is also why `tools/call` works without a prior `initialize` on the
same instance. Consequences:

- `POST /mcp` is the whole protocol surface. `GET`/`DELETE /mcp` return 405 (no SSE stream, no
  sessions, no `Mcp-Session-Id`). Notification-only bodies return 202. Batches are supported.
- Server-initiated messages (progress, logging) have nowhere to go and are dropped — same as the
  SDK in JSON-response mode.
- `local.js` adapts a Node HTTP request into the FC event shape and calls the same handler, so
  what you test locally is byte-for-byte what ships.

## Connecting a client

Claude Code / `.mcp.json`:

```json
{
  "mcpServers": {
    "waven-dev": {
      "type": "http",
      "url": "https://nano-dev.gcn.net/mcp",
      "headers": { "Authorization": "Bearer mcp_…" }
    }
  }
}
```

Claude.ai / Claude Desktop custom connector: URL `https://nano-dev.gcn.net/mcp`, no OAuth, add
the `Authorization` header. Any workshop that speaks Streamable HTTP with a static bearer header
works the same way.

Raw JSON-RPC smoke test:

```bash
curl -s https://nano-dev.gcn.net/mcp -H "Authorization: Bearer $MCP_API_TOKEN" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"waven_list_tables","arguments":{"database":"gcn","name_filter":"%order%"}}}'
```

## Local development

1. Root `.env` needs `DATABASE_URL` (nano dev — already there), `GCN_DB_PASS` (the `DB_PASS`
   value from the gcn repo's `.env`) and `MCP_API_TOKEN`.
2. `cd src/functions/mcp && npm install` (the function ships its own `node_modules`, like the
   worker).
3. `npm run mcp:local`, then `npx @modelcontextprotocol/inspector` → Streamable HTTP →
   `http://127.0.0.1:3010/mcp` with the bearer header.

Tests: `node --test tests/mcp-server.test.js` (offline — the db layer is stubbed; covers the SQL
guard matrix, the dev-only guard, auth, transport semantics and tool output shaping).

## Files

```
src/functions/mcp/
  index.js           FC handler: CORS, auth, routing, JSON parse → runJsonRpc
  local.js           Node http → FC event adapter for local testing
  lib/transport.js   InMemoryTransport + runJsonRpc (stateless Streamable HTTP)
  lib/tools.js       McpServer factory: the 5 tools + the data-map resource, catalog SQL, row shaping
  lib/db.js          the two pools, dev-name guard, withReadOnly()
  lib/sql-guard.js   assertReadOnlySql / wrapWithLimit (pure)
  lib/data-map.md    the cross-database guide the model reads first
tests/mcp-server.test.js
```
