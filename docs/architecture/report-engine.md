# AI Report Engine

The AI Report Engine lets admins query operational data in plain language. The admin types a question; the LLM generates a safe SELECT query; the backend executes it against the live PostgreSQL database; the result is rendered as a chart, data table, and AI insight paragraph — all without writing SQL.

---

## Architecture

```
Admin (browser)
       │  POST /api/admin/report  { query, history }
       ▼
nano-worker  handlePostAdminReport()
  ┌──────────────────────────────────────────────┐
  │ 1. Build messages array:                      │
  │      system = systemAdminReport.js            │
  │      history (last 24 msgs for multi-turn)    │
  │      user = admin's natural-language query    │
  │ 2. DashScope LLM (qwen-plus-latest, 8s limit) │
  │ 3. Parse JSON response → { title, sql, chart, insights } │
  │ 4. Safety check: must start with SELECT/WITH  │
  │    Regex blocks all DML/DDL keywords          │
  │    Enforce LIMIT 500 if absent                │
  │ 5. pool.query(safeSql)                        │
  │ 6. Serialize BigInt; return rows + columns    │
  └──────────────────────────────────────────────┘
       │  { success, title, sql, data, columns, chart, insights }
       ▼
ReportsTab (App.jsx)
  - renders recharts BarChart / LineChart / AreaChart / PieChart
  - renders scrollable data table
  - maintains session history in localStorage
  - maintains saved reports from PostgreSQL
```

---

## Backend

### Handler — `handlePostAdminReport`

**File:** `src/functions/worker/index.js`

**Route:** `POST /admin/report`

**Request body:**

```json
{
  "query": "Show user signups by month",
  "history": []
}
```

`history` is an array of prior `{ role, content }` messages (last 24 kept) that enables follow-up questions like "break that down by channel".

**Response:**

```json
{
  "success": true,
  "title": "User Signups by Month",
  "sql": "SELECT DATE_TRUNC('month', created_at) AS month, COUNT(*) AS count FROM users GROUP BY 1 ORDER BY 1 LIMIT 500",
  "data": [{ "month": "2024-01-01T00:00:00.000Z", "count": "42" }],
  "columns": ["month", "count"],
  "chart": {
    "type": "area",
    "xKey": "month",
    "yKeys": [{ "key": "count", "label": "Users", "color": "#3b82f6" }]
  },
  "insights": "Signups have grown steadily..."
}
```

### SQL Safety

Two layers protect against injection and unintended writes:

| Check | Rule |
|---|---|
| Prefix | SQL must begin with `SELECT` or `WITH` (read-only CTEs only) |
| Regex blocklist | Rejects queries containing `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `TRUNCATE`, `CREATE`, `GRANT`, `REVOKE`, `EXECUTE`, `CALL`, `MERGE`, `COPY` (case-insensitive, word-boundary match) |
| LIMIT | Appends `LIMIT 500` if no `LIMIT` clause is already present |

The endpoint is also protected by the global `API_BEARER_TOKEN` bearer auth middleware.

### LLM System Prompt

**File:** `src/functions/worker/prompts/systemAdminReport.js`

The prompt includes:

- Full schema for all 21 operational tables (column names and types)
- SQL rules (SELECT-only, LIMIT 500, snake_case aliases)
- Chart type guidance (bar / line / area / pie and when to use each)
- Strict JSON-only response format — no markdown fences, no prose

The LLM call uses a `Promise.race` with an 8-second timeout. A timeout returns HTTP 502 gracefully.

---

## Saved Reports

Admins can save any report result to the database, give it a title, and share it with all other admin accounts.

### Database Table

**Migration:** `temp/migration_saved_reports.sql`

```sql
CREATE TABLE IF NOT EXISTS saved_reports (
    id          SERIAL PRIMARY KEY,
    title       TEXT NOT NULL,
    query       TEXT NOT NULL,     -- original natural-language question
    sql         TEXT NOT NULL,     -- generated SQL
    chart       JSONB,
    insights    TEXT,
    columns     JSONB,
    data        JSONB,
    created_by  TEXT,
    updated_by  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### API Routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/admin/saved-reports` | List all saved reports (ordered by `updated_at DESC`) |
| `POST` | `/admin/saved-reports` | Save a new report |
| `PUT` | `/admin/saved-reports/:id` | Update title, re-run (replace data), or both |
| `DELETE` | `/admin/saved-reports/:id` | Delete a saved report |

`created_by` / `updated_by` are set from the `x-admin-user` request header, which the admin panel sends automatically based on the logged-in username (stored in `sessionStorage`).

---

## Frontend

### Components — `src/web/admin-panel/src/App.jsx`

| Component | Role |
|---|---|
| `ReportsTab` | Top-level tab component; owns all state |
| `ReportChart` | Renders the appropriate recharts chart type |
| `ReportDataTable` | Renders a scrollable table of result rows |

### ReportsTab State

| State | Type | Persistence |
|---|---|---|
| `query` | string | in-memory |
| `loading` | boolean | in-memory |
| `report` | object | in-memory (current result) |
| `history` | array | `localStorage` — survives page refresh |
| `savedReports` | array | PostgreSQL — fetched on mount |
| `activeSavedId` | number \| null | in-memory |
| `llmHistory` | array | in-memory — last 24 messages for multi-turn |
| `modal` | object \| null | in-memory (`save` or `edit` mode) |
| `showSql` | boolean | in-memory |
| `activeTab` | `'chart'` \| `'table'` | in-memory |

### Layout

```
┌─── reports-layout (flex row) ──────────────────────────────────┐
│  sidebar (240 px)          │  main                              │
│  ─────────────             │  ─────────────────────────────     │
│  Saved Reports             │  [empty state with samples]        │
│    • Report A              │  — or —                            │
│    • Report B              │  title + [Show SQL] [Export CSV]   │
│  ─────────────             │  insights paragraph                │
│  History                   │  [Chart] [Table] tabs              │
│    • last 20 queries       │  chart / data table                │
│                            │  ─────────────────────────────     │
│  [New Report]              │  textarea + Send button (bottom)   │
└────────────────────────────────────────────────────────────────┘
```

### Chart Rendering

`recharts` is used (`^2.12.0`). Chart type is chosen by the LLM and stored in the `chart.type` field:

| Type | Component | Use case |
|---|---|---|
| `bar` | `BarChart` + `Bar` | Comparisons (top N, grouped counts) |
| `line` | `LineChart` + `Line` | Time-series trends |
| `area` | `AreaChart` + `Area` | Time-series with fill (volume) |
| `pie` | `PieChart` + `Pie` | Distributions (max 8 slices, single yKey) |

All charts use `ResponsiveContainer` at height 300. X-axis labels longer than 14 characters are truncated.

Multiple `yKeys` are supported for bar/line/area — each renders as a separate series with its own colour.

### CSV Export

The "Export CSV" button constructs a Blob from the current `report.data` + `report.columns` and triggers a browser download via `URL.createObjectURL`. No server round-trip needed.

### Keyboard Shortcut

`Cmd+Enter` / `Ctrl+Enter` submits the query from the textarea.

---

## Adding a New Table to the Schema

If a new PostgreSQL table is created and should be queryable via the report engine:

1. Open `src/functions/worker/prompts/systemAdminReport.js`.
2. Add a line to the `DATABASE SCHEMA:` section in the same format as existing entries, e.g.:
   ```
   - my_table(col1 TYPE, col2 TYPE, ...)
   ```
3. Deploy the worker: `npm run deploy:worker`.

No frontend changes are needed — the LLM will automatically consider the new table for relevant queries.

---

## Deployment

```bash
# From /Users/pin/waven/nano/
source .env
npm run deploy:worker
```

The admin panel SPA is rebuilt separately:

```bash
cd src/web/admin-panel
npm run build
# then deploy the admin-panel function
```
