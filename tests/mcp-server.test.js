// Offline tests for src/functions/mcp — the read-only MCP server over the nano + GCN dev DBs.
//
// lib/db.js is stubbed through require.cache before lib/tools.js loads, so there is no
// Postgres. What is exercised for real: the SQL guard, the dev-only database-name guard, the
// FC event → JSON-RPC adapter (auth, method handling, batches, notifications), and the tool
// layer's shaping of rows into content/structuredContent.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const MCP = path.join(__dirname, '..', 'src', 'functions', 'mcp');

// --- pure modules: loaded directly -----------------------------------------------------------

const { assertReadOnlySql, wrapWithLimit } = require(path.join(MCP, 'lib', 'sql-guard'));
const dbReal = require(path.join(MCP, 'lib', 'db'));

test('sql-guard accepts read statements and normalises them', () => {
    assert.deepStrictEqual(assertReadOnlySql('SELECT 1;'), { sql: 'SELECT 1', lead: 'SELECT' });
    assert.strictEqual(assertReadOnlySql('  with x as (select 1) select * from x').lead, 'WITH');
    assert.strictEqual(assertReadOnlySql('EXPLAIN SELECT 1').lead, 'EXPLAIN');
    assert.strictEqual(assertReadOnlySql('-- comment\nSELECT 1 /* c */').sql, 'SELECT 1');
    assert.strictEqual(assertReadOnlySql("SELECT 'a' AS \"into_ish\" FROM users WHERE nickname ILIKE '%update%'").lead, 'SELECT');
});

test('sql-guard refuses writes, multi-statements and side-effect functions', () => {
    const refused = [
        'DELETE FROM users',
        'UPDATE users SET phone = NULL',
        'INSERT INTO users(user_id) VALUES (1)',
        'DROP TABLE users',
        'SELECT 1; DROP TABLE users',
        'SELECT * FROM users FOR UPDATE',
        'SELECT * FROM users FOR NO KEY UPDATE',
        'SELECT * FROM users FOR SHARE',
        'SELECT * INTO backup FROM users',
        'COPY users TO STDOUT',
        'SELECT pg_sleep(10)',
        'SELECT pg_terminate_backend(1)',
        'SELECT pg_read_file(\'/etc/passwd\')',
        'SELECT lo_import(\'/etc/passwd\')',
        'SELECT dblink_connect(\'x\')',
        'SELECT set_config(\'a\', \'b\', false)',
        "SELECT nextval('seq')",
        'SELECT pg_advisory_lock(1)',
        '',
        '   ;  ',
    ];
    for (const sql of refused) {
        assert.throws(() => assertReadOnlySql(sql), `should refuse: ${sql}`);
    }
});

test('wrapWithLimit caps SELECT-shaped statements and leaves EXPLAIN/SHOW alone', () => {
    assert.match(wrapWithLimit('SELECT 1', 'SELECT', 10), /^SELECT \* FROM \(\nSELECT 1\n\) AS _mcp LIMIT 11$/);
    assert.strictEqual(wrapWithLimit('EXPLAIN SELECT 1', 'EXPLAIN', 10), 'EXPLAIN SELECT 1');
    assert.strictEqual(wrapWithLimit('SHOW server_version', 'SHOW', 10), 'SHOW server_version');
});

test('db: refuses any database whose name does not end in _dev', () => {
    assert.strictEqual(dbReal.assertDevDatabaseName('nano_db_dev'), 'nano_db_dev');
    assert.throws(() => dbReal.assertDevDatabaseName('nano_db_prod'), /not a dev database/);
    assert.throws(() => dbReal.assertDevDatabaseName('nano_db'), /not a dev database/);
    assert.throws(() => dbReal.assertDevDatabaseName(undefined), /not a dev database/);

    const saved = { ...process.env };
    Object.assign(process.env, { DB_HOST: 'h', NANO_DB_NAME: 'nano_db_prod', NANO_DB_USER: 'u', NANO_DB_PASS: 'p' });
    assert.throws(() => dbReal.buildConfig('nano'), /not a dev database/);
    Object.assign(process.env, { NANO_DB_NAME: 'nano_db_dev' });
    const cfg = dbReal.buildConfig('nano');
    assert.strictEqual(cfg.max, 2, 'pool cap must stay small — the cluster is shared with GCN prod');
    assert.strictEqual(cfg.database, 'nano_db_dev');
    process.env = saved;
});

// --- handler + tools with a stubbed db layer -------------------------------------------------

const calls = [];
let nextRows = { fields: [], rows: [] };
const stubClient = {
    query: async (q, params) => {
        calls.push({ text: typeof q === 'string' ? q : q.text, params });
        if (typeof q === 'object' && q.rowMode === 'array') return nextRows;
        if (/FROM pg_class c/.test(q) && /relkind IN \('r', 'p', 'v', 'm'\)/.test(q)) {
            return { rows: [{ name: 'users', kind: 'table', row_estimate: '313', total_size: '1 MB', comment: null }] };
        }
        return { rows: [] };
    },
};
const dbStubPath = require.resolve(path.join(MCP, 'lib', 'db'));
require.cache[dbStubPath] = {
    id: dbStubPath,
    filename: dbStubPath,
    loaded: true,
    exports: {
        DATABASES: ['nano', 'gcn'],
        withReadOnly: async (key, opts, fn) => {
            calls.push({ text: `WITH_READ_ONLY ${key} timeout=${(opts && opts.timeoutMs) || 'default'}` });
            return fn(stubClient);
        },
    },
};

const { handleEvent } = require(path.join(MCP, 'index.js'));

const TOKEN = 'mcp_' + 'a'.repeat(32);
process.env.MCP_API_TOKEN = TOKEN;

function ev(body, { method = 'POST', path: p = '/mcp', token = TOKEN, base64 = false } = {}) {
    const raw = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
    return {
        rawPath: p,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: base64 ? Buffer.from(raw).toString('base64') : raw,
        isBase64Encoded: base64,
        requestContext: { http: { method } },
    };
}
const rpc = (id, method, params) => ({ jsonrpc: '2.0', id, method, params });
const parse = (r) => JSON.parse(r.body);

test('health is open, everything else needs the bearer token', async () => {
    const h = await handleEvent(ev(undefined, { method: 'GET', path: '/mcp/health', token: null }));
    assert.strictEqual(h.statusCode, 200);
    assert.strictEqual(parse(h).ok, true);

    const noTok = await handleEvent(ev(rpc(1, 'ping'), { token: null }));
    assert.strictEqual(noTok.statusCode, 401);
    const badTok = await handleEvent(ev(rpc(1, 'ping'), { token: 'mcp_' + 'b'.repeat(32) }));
    assert.strictEqual(badTok.statusCode, 401);

    const saved = process.env.MCP_API_TOKEN;
    delete process.env.MCP_API_TOKEN;
    const unset = await handleEvent(ev(rpc(1, 'ping')));
    assert.strictEqual(unset.statusCode, 401, 'an unset token must never mean "open"');
    process.env.MCP_API_TOKEN = saved;
});

test('stateless transport: GET/DELETE 405, notification-only 202, bad JSON 400, unknown path 404', async () => {
    assert.strictEqual((await handleEvent(ev(undefined, { method: 'GET' }))).statusCode, 405);
    assert.strictEqual((await handleEvent(ev(undefined, { method: 'DELETE' }))).statusCode, 405);
    assert.strictEqual((await handleEvent(ev(undefined, { method: 'OPTIONS', token: null }))).statusCode, 204);
    assert.strictEqual((await handleEvent(ev({ jsonrpc: '2.0', method: 'notifications/initialized' }))).statusCode, 202);
    const bad = await handleEvent(ev('{not json'));
    assert.strictEqual(bad.statusCode, 400);
    assert.strictEqual(parse(bad).error.code, -32700);
    assert.strictEqual((await handleEvent(ev(rpc(1, 'ping'), { path: '/other' }))).statusCode, 404);
});

test('initialize + tools/list over base64-encoded FC bodies', async () => {
    const init = await handleEvent(ev(rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } }), { base64: true }));
    assert.strictEqual(init.statusCode, 200);
    assert.strictEqual(parse(init).result.serverInfo.name, 'waven-data-mcp-server');

    const list = await handleEvent(ev(rpc(2, 'tools/list')));
    const tools = parse(list).result.tools;
    assert.deepStrictEqual(
        tools.map((t) => t.name).sort(),
        ['waven_describe_table', 'waven_get_data_map', 'waven_list_tables', 'waven_query', 'waven_search_columns']
    );
    for (const t of tools) {
        assert.strictEqual(t.annotations.readOnlyHint, true, `${t.name} must be annotated read-only`);
        assert.strictEqual(t.annotations.destructiveHint, false);
    }
});

test('batch requests come back as a batch, in order', async () => {
    const r = await handleEvent(ev([rpc(10, 'ping'), rpc(11, 'ping')]));
    assert.strictEqual(r.statusCode, 200);
    const body = parse(r);
    assert.ok(Array.isArray(body));
    assert.deepStrictEqual(body.map((m) => m.id), [10, 11]);
});

test('waven_get_data_map returns the join guide; resource exposes the same text', async () => {
    const tool = await handleEvent(ev(rpc(3, 'tools/call', { name: 'waven_get_data_map', arguments: {} })));
    const text = parse(tool).result.content[0].text;
    assert.match(text, /users\.nano_user_id/);
    assert.match(text, /data->'validated'/);
    const res = await handleEvent(ev(rpc(4, 'resources/read', { uri: 'waven://data-map' })));
    assert.strictEqual(parse(res).result.contents[0].text, text);
});

test('waven_query runs inside the read-only wrapper, caps rows and reports truncation', async () => {
    calls.length = 0;
    nextRows = {
        fields: [{ name: 'id', dataTypeID: 25 }, { name: 'id', dataTypeID: 23 }, { name: 'd', dataTypeID: 1082 }],
        rows: [['a', 1, '2026-08-16'], ['b', 2, '2026-08-17'], ['c', 3, '2026-08-18']],
    };
    const r = await handleEvent(ev(rpc(5, 'tools/call', { name: 'waven_query', arguments: { database: 'gcn', sql: 'SELECT id, id, d FROM t;', max_rows: 2, timeout_ms: 3000 } })));
    const result = parse(r).result;
    assert.strictEqual(result.isError, undefined);
    assert.strictEqual(calls[0].text, 'WITH_READ_ONLY gcn timeout=3000');
    assert.match(calls[1].text, /^SELECT \* FROM \(\nSELECT id, id, d FROM t\n\) AS _mcp LIMIT 3$/);
    assert.strictEqual(result.structuredContent.truncated, true);
    assert.strictEqual(result.structuredContent.row_count, 2);
    assert.deepStrictEqual(result.structuredContent.columns, [{ name: 'id', type: 'text' }, { name: 'id_2', type: 'int4' }, { name: 'd', type: 'date' }]);
    assert.deepStrictEqual(result.structuredContent.rows[0], { id: 'a', id_2: 1, d: '2026-08-16' });
    assert.match(result.content[0].text, /\| id \| id_2 \| d \|/);
    assert.match(result.content[0].text, /Truncated to 2 rows/);
});

test('waven_query refuses a write before touching the database, as a tool error not a protocol error', async () => {
    calls.length = 0;
    const r = await handleEvent(ev(rpc(6, 'tools/call', { name: 'waven_query', arguments: { database: 'nano', sql: 'UPDATE users SET phone = NULL' } })));
    assert.strictEqual(r.statusCode, 200);
    const result = parse(r).result;
    assert.strictEqual(result.isError, true);
    assert.match(result.content[0].text, /Only read statements/);
    assert.strictEqual(calls.length, 0, 'no connection may be taken for a refused statement');
});

test('waven_query rejects an unknown database at the schema layer', async () => {
    const r = await handleEvent(ev(rpc(7, 'tools/call', { name: 'waven_query', arguments: { database: 'prod', sql: 'SELECT 1' } })));
    const body = parse(r);
    assert.ok(body.error || body.result.isError, 'must not run');
});

test('waven_list_tables shapes catalog rows into content + structuredContent', async () => {
    const r = await handleEvent(ev(rpc(8, 'tools/call', { name: 'waven_list_tables', arguments: { database: 'nano', name_filter: '%user%' } })));
    const result = parse(r).result;
    assert.strictEqual(result.structuredContent.count, 1);
    assert.strictEqual(result.structuredContent.tables[0].row_estimate, 313);
    assert.match(result.content[0].text, /\| users \| table \| 313 \|/);
});

test('waven_describe_table on a missing table is a tool error with a hint', async () => {
    const r = await handleEvent(ev(rpc(9, 'tools/call', { name: 'waven_describe_table', arguments: { database: 'gcn', table: 'stores' } })));
    const result = parse(r).result;
    assert.strictEqual(result.isError, true);
    assert.match(result.content[0].text, /No table or view "public.stores" in gcn/);
    assert.match(result.content[0].text, /waven_search_columns/);
});

test('handler accepts the FC event as a Buffer of JSON (what FC 3.0 actually passes)', async () => {
    const { handler } = require(path.join(MCP, 'index.js'));
    const r = await handler(Buffer.from(JSON.stringify(ev(undefined, { method: 'GET', path: '/mcp/health', token: null }))), {}, {});
    assert.strictEqual(r.statusCode, 200);
    assert.strictEqual(parse(r).ok, true);
});
