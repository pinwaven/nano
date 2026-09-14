'use strict';

const fs = require('fs');
const path = require('path');
const { z } = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const pgTypes = require('pg-types');
const { DATABASES, withReadOnly } = require('./db');
const { assertReadOnlySql, wrapWithLimit } = require('./sql-guard');

const SERVER_NAME = 'waven-data-mcp-server';
const SERVER_VERSION = require('../package.json').version;

const DATA_MAP = fs.readFileSync(path.join(__dirname, 'data-map.md'), 'utf8');

// oid -> type name for the column metadata `waven_query` returns.
const OID_NAMES = Object.fromEntries(Object.entries(pgTypes.builtins).map(([name, oid]) => [oid, name.toLowerCase()]));

const READ_ONLY = Object.freeze({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });

const databaseParam = z.enum(DATABASES).describe(
    'Which database: "nano" (Waven Nano — users, biomarkers, digital twin, plans, chat, coaches, Viva AG) or ' +
    '"gcn" (GCN commerce — partners/stores, products, skus, orders, inventory, commissions, codes). Both are DEV databases.'
);
const schemaParam = z.string().regex(/^[a-z_][a-z0-9_]*$/i).default('public').describe('Schema name (default "public").');

const MAX_ROWS_DEFAULT = 200;
const MAX_ROWS_CAP = 2000;
const TIMEOUT_DEFAULT_MS = 15000;
const TIMEOUT_CAP_MS = 60000;

// ---------------------------------------------------------------------------------------------
// Catalog queries
// ---------------------------------------------------------------------------------------------

async function listTables(database, schema, nameFilter) {
    return withReadOnly(database, {}, async (client) => {
        const { rows } = await client.query(
            `SELECT c.relname AS name,
                    CASE c.relkind WHEN 'r' THEN 'table' WHEN 'p' THEN 'partitioned_table'
                                   WHEN 'v' THEN 'view'  WHEN 'm' THEN 'materialized_view' END AS kind,
                    CASE WHEN c.reltuples < 0 THEN NULL ELSE c.reltuples::bigint END AS row_estimate,
                    pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
                    obj_description(c.oid, 'pg_class') AS comment
             FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = $1
               AND c.relkind IN ('r', 'p', 'v', 'm')
               AND ($2::text IS NULL OR c.relname ILIKE $2)
             ORDER BY c.relname`,
            [schema, nameFilter || null]
        );
        return rows.map((r) => ({ ...r, row_estimate: r.row_estimate === null ? null : Number(r.row_estimate) }));
    });
}

async function describeTable(database, schema, table) {
    return withReadOnly(database, {}, async (client) => {
        const rel = await client.query(
            `SELECT c.oid, c.relkind,
                    CASE WHEN c.reltuples < 0 THEN NULL ELSE c.reltuples::bigint END AS row_estimate,
                    obj_description(c.oid, 'pg_class') AS comment
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind IN ('r','p','v','m')`,
            [schema, table]
        );
        if (rel.rows.length === 0) return null;
        const { oid, row_estimate, comment } = rel.rows[0];

        // Sequential on purpose: one client, one query at a time (pg deprecates overlapping calls).
        const columns = await client.query(
                `SELECT a.attname AS name,
                        format_type(a.atttypid, a.atttypmod) AS type,
                        NOT a.attnotnull AS nullable,
                        pg_get_expr(d.adbin, d.adrelid) AS default_value,
                        col_description(a.attrelid, a.attnum) AS comment
                 FROM pg_attribute a
                 LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
                 WHERE a.attrelid = $1 AND a.attnum > 0 AND NOT a.attisdropped
                 ORDER BY a.attnum`,
                [oid]
            );
        const constraints = await client.query(
            `SELECT conname AS name, contype AS type, pg_get_constraintdef(oid) AS definition
             FROM pg_constraint WHERE conrelid = $1 ORDER BY contype, conname`,
            [oid]
        );
        const inbound = await client.query(
            `SELECT c.conname AS name, c.conrelid::regclass::text AS from_table, pg_get_constraintdef(c.oid) AS definition
             FROM pg_constraint c WHERE c.contype = 'f' AND c.confrelid = $1 ORDER BY from_table, conname`,
            [oid]
        );
        const indexes = await client.query(
            `SELECT indexname AS name, indexdef AS definition FROM pg_indexes
             WHERE schemaname = $1 AND tablename = $2 ORDER BY indexname`,
            [schema, table]
        );

        const byType = (t) => constraints.rows.filter((c) => c.type === t).map(({ name, definition }) => ({ name, definition }));
        return {
            schema,
            table,
            kind: rel.rows[0].relkind === 'v' ? 'view' : rel.rows[0].relkind === 'm' ? 'materialized_view' : 'table',
            row_estimate: row_estimate === null ? null : Number(row_estimate),
            comment,
            columns: columns.rows,
            primary_key: byType('p'),
            foreign_keys: byType('f'),
            unique_constraints: byType('u'),
            check_constraints: byType('c'),
            referenced_by: inbound.rows,
            indexes: indexes.rows,
        };
    });
}

async function searchColumns(database, schema, pattern, limit) {
    return withReadOnly(database, {}, async (client) => {
        const { rows } = await client.query(
            `SELECT table_name AS "table", column_name AS "column", data_type AS type
             FROM information_schema.columns
             WHERE table_schema = $1 AND (column_name ILIKE $2 OR table_name ILIKE $2)
             ORDER BY table_name, ordinal_position
             LIMIT $3`,
            [schema, pattern, limit]
        );
        return rows;
    });
}

async function runQuery(database, rawSql, maxRows, timeoutMs) {
    const { sql, lead } = assertReadOnlySql(rawSql);
    const wrapped = wrapWithLimit(sql, lead, maxRows);
    const prefixLen = wrapped.indexOf(sql); // so PG error positions point into the user's SQL
    const startedAt = Date.now();
    let result;
    try {
        result = await withReadOnly(database, { timeoutMs }, (client) => client.query({ text: wrapped, rowMode: 'array' }));
    } catch (err) {
        if (err && err.position && prefixLen > 0) err.position = Math.max(1, Number(err.position) - prefixLen);
        throw err;
    }
    const seen = new Map();
    const columns = result.fields.map((f) => {
        // `SELECT a.id, b.id` yields two fields named "id"; keep both by suffixing the repeat.
        const n = (seen.get(f.name) || 0) + 1;
        seen.set(f.name, n);
        return { name: n === 1 ? f.name : `${f.name}_${n}`, type: OID_NAMES[f.dataTypeID] || String(f.dataTypeID) };
    });
    const truncated = lead !== 'EXPLAIN' && lead !== 'SHOW' && result.rows.length > maxRows;
    const rawRows = truncated ? result.rows.slice(0, maxRows) : result.rows;
    const rows = rawRows.map((arr) => Object.fromEntries(arr.map((v, i) => [columns[i].name, plain(v)])));
    return { columns, rows, row_count: rows.length, truncated, duration_ms: Date.now() - startedAt };
}

function plain(v) {
    if (v === null || v === undefined) return null;
    if (v instanceof Date) return v.toISOString();
    if (Buffer.isBuffer(v)) return `<bytea ${v.length} bytes>`;
    if (typeof v === 'bigint') return v.toString();
    return v;
}

// ---------------------------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------------------------

function cell(v, max = 200) {
    let s = v === null ? 'NULL' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    s = s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
    return s.length > max ? `${s.slice(0, max)}…` : s;
}

function toMarkdownTable(columns, rows) {
    if (columns.length === 0) return '_(no columns)_';
    const head = `| ${columns.map((c) => c.name).join(' | ')} |\n| ${columns.map(() => '---').join(' | ')} |`;
    const body = rows.map((r) => `| ${columns.map((c) => cell(r[c.name])).join(' | ')} |`).join('\n');
    return rows.length ? `${head}\n${body}` : `${head}\n_(0 rows)_`;
}

function text(t) {
    return { content: [{ type: 'text', text: t }] };
}

function structured(obj, summary) {
    return { content: [{ type: 'text', text: summary || JSON.stringify(obj, null, 2) }], structuredContent: obj };
}

function toolError(err, hint) {
    const msg = err && err.message ? err.message : String(err);
    const pos = err && err.position ? ` (at character ${err.position})` : '';
    const base = `Error: ${msg}${pos}`;
    return { isError: true, content: [{ type: 'text', text: `${/[.!?]$/.test(base) ? base : `${base}.`}${hint ? ` ${hint}` : ''}` }] };
}

// ---------------------------------------------------------------------------------------------
// Server factory — one fresh instance per HTTP request (stateless)
// ---------------------------------------------------------------------------------------------

function createServer() {
    const server = new McpServer(
        { name: SERVER_NAME, version: SERVER_VERSION },
        {
            instructions:
                'Read-only access to the Waven Nano and GCN DEV PostgreSQL databases for data analysis. ' +
                'Start with waven_get_data_map (what each database owns, join keys, naming traps), then ' +
                'waven_list_tables / waven_describe_table / waven_search_columns to find the right tables, ' +
                'then waven_query with a single SELECT. Writes are impossible: every statement runs in a READ ONLY transaction.',
        }
    );

    server.registerTool(
        'waven_get_data_map',
        {
            title: 'Data map',
            description:
                'The guide to both databases: what nano vs GCN owns, the cross-database join keys, and the naming traps ' +
                '(e.g. GCN has no "stores" table; nano biomarkers live in data->\'validated\'). Read this first.',
            inputSchema: {},
            annotations: READ_ONLY,
        },
        async () => text(DATA_MAP)
    );

    server.registerTool(
        'waven_list_tables',
        {
            title: 'List tables',
            description: 'List tables and views in a database with estimated row counts, on-disk size and comments. Optional ILIKE name filter (use % wildcards).',
            inputSchema: {
                database: databaseParam,
                schema: schemaParam,
                name_filter: z.string().max(200).optional().describe('ILIKE pattern on the table name, e.g. "%order%".'),
            },
            annotations: READ_ONLY,
        },
        async ({ database, schema, name_filter }) => {
            try {
                const tables = await listTables(database, schema, name_filter);
                const md = toMarkdownTable(
                    [{ name: 'name' }, { name: 'kind' }, { name: 'row_estimate' }, { name: 'total_size' }, { name: 'comment' }],
                    tables
                );
                return structured({ database, schema, count: tables.length, tables }, `${tables.length} relations in ${database}.${schema}\n\n${md}`);
            } catch (err) {
                return toolError(err);
            }
        }
    );

    server.registerTool(
        'waven_describe_table',
        {
            title: 'Describe table',
            description:
                'Columns (type, nullability, default, comment), primary key, foreign keys, tables that reference this one (inbound FKs), ' +
                'unique and CHECK constraints (status vocabularies here are TEXT + CHECK, not enums), and indexes.',
            inputSchema: {
                database: databaseParam,
                table: z.string().regex(/^[a-z_][a-z0-9_]*$/i).describe('Table or view name, e.g. "users".'),
                schema: schemaParam,
            },
            annotations: READ_ONLY,
        },
        async ({ database, table, schema }) => {
            try {
                const info = await describeTable(database, schema, table);
                if (!info) {
                    return toolError(new Error(`No table or view "${schema}.${table}" in ${database}`), 'Use waven_list_tables or waven_search_columns to find the name.');
                }
                const cols = toMarkdownTable(
                    [{ name: 'name' }, { name: 'type' }, { name: 'nullable' }, { name: 'default_value' }, { name: 'comment' }],
                    info.columns
                );
                const section = (title, items, fmt) => (items.length ? `\n\n**${title}**\n${items.map(fmt).join('\n')}` : '');
                const summary =
                    `${database}.${schema}.${table} (${info.kind}, ~${info.row_estimate ?? '?'} rows)${info.comment ? `\n${info.comment}` : ''}\n\n${cols}` +
                    section('Primary key', info.primary_key, (c) => `- ${c.definition}`) +
                    section('Foreign keys', info.foreign_keys, (c) => `- ${c.definition}`) +
                    section('Referenced by', info.referenced_by, (c) => `- ${c.from_table}: ${c.definition}`) +
                    section('Unique', info.unique_constraints, (c) => `- ${c.definition}`) +
                    section('Check', info.check_constraints, (c) => `- ${c.definition}`) +
                    section('Indexes', info.indexes, (c) => `- ${c.definition}`);
                return structured({ database, ...info }, summary);
            } catch (err) {
                return toolError(err);
            }
        }
    );

    server.registerTool(
        'waven_search_columns',
        {
            title: 'Search columns',
            description:
                'Find columns (and tables) whose name matches an ILIKE pattern across the whole schema — e.g. "%nano_user%" to find every ' +
                'GCN column that links back to a nano user, or "%phone%". Use this when you do not know which table holds a field.',
            inputSchema: {
                database: databaseParam,
                pattern: z.string().min(1).max(200).describe('ILIKE pattern matched against column_name and table_name. "%" and "_" are wildcards.'),
                schema: schemaParam,
                limit: z.number().int().min(1).max(500).default(100),
            },
            annotations: READ_ONLY,
        },
        async ({ database, pattern, schema, limit }) => {
            try {
                const matches = await searchColumns(database, schema, pattern, limit);
                const md = toMarkdownTable([{ name: 'table' }, { name: 'column' }, { name: 'type' }], matches);
                return structured(
                    { database, schema, pattern, count: matches.length, truncated: matches.length >= limit, matches },
                    `${matches.length} matches for "${pattern}" in ${database}.${schema}${matches.length >= limit ? ' (limit reached)' : ''}\n\n${md}`
                );
            } catch (err) {
                return toolError(err);
            }
        }
    );

    server.registerTool(
        'waven_query',
        {
            title: 'Run read-only SQL',
            description:
                'Execute ONE read-only SQL statement (SELECT / WITH / EXPLAIN / SHOW) against a database and return the rows. ' +
                'Runs inside a READ ONLY transaction with a statement timeout; results are capped at max_rows (add your own ORDER BY / LIMIT / aggregation for large tables). ' +
                'Cross-database joins are not possible in SQL — query each database and join the results yourself using the keys in waven_get_data_map.',
            inputSchema: {
                database: databaseParam,
                sql: z.string().min(1).max(20000).describe('A single SELECT-shaped statement. No trailing semicolon needed; multiple statements are refused.'),
                max_rows: z.number().int().min(1).max(MAX_ROWS_CAP).default(MAX_ROWS_DEFAULT).describe(`Row cap (default ${MAX_ROWS_DEFAULT}, max ${MAX_ROWS_CAP}).`),
                timeout_ms: z.number().int().min(1000).max(TIMEOUT_CAP_MS).default(TIMEOUT_DEFAULT_MS).describe(`Statement timeout in ms (default ${TIMEOUT_DEFAULT_MS}, max ${TIMEOUT_CAP_MS}).`),
                format: z.enum(['json', 'markdown']).default('markdown').describe('"markdown" renders a table in the text content; "json" puts the rows as JSON in the text content. structuredContent always carries the JSON.'),
            },
            outputSchema: {
                database: z.string(),
                columns: z.array(z.object({ name: z.string(), type: z.string() })),
                rows: z.array(z.record(z.any())),
                row_count: z.number(),
                truncated: z.boolean(),
                duration_ms: z.number(),
            },
            annotations: READ_ONLY,
        },
        async ({ database, sql, max_rows, timeout_ms, format }) => {
            try {
                const result = await runQuery(database, sql, max_rows, timeout_ms);
                const out = { database, ...result };
                const note = result.truncated ? `\n\n_Truncated to ${max_rows} rows — narrow the query or raise max_rows (max ${MAX_ROWS_CAP})._` : '';
                const body = format === 'json'
                    ? JSON.stringify(out, null, 2)
                    : `${result.row_count} row(s) in ${result.duration_ms} ms\n\n${toMarkdownTable(result.columns, result.rows)}${note}`;
                return { content: [{ type: 'text', text: body }], structuredContent: out };
            } catch (err) {
                const isPg = err && (err.code || err.position);
                return toolError(err, isPg ? 'Check table/column names with waven_describe_table or waven_search_columns.' : undefined);
            }
        }
    );

    server.registerResource(
        'data-map',
        'waven://data-map',
        { title: 'Waven data map', description: 'Cross-database join guide for nano + GCN', mimeType: 'text/markdown' },
        async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: DATA_MAP }] })
    );

    return server;
}

module.exports = {
    createServer,
    SERVER_NAME,
    // exported for tests
    listTables,
    describeTable,
    searchColumns,
    runQuery,
    toMarkdownTable,
};
