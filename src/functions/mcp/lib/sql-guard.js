'use strict';

/**
 * Read-only SQL guard for `waven_query`.
 *
 * Pure functions, no DB. The REAL write barrier is the `SET TRANSACTION READ ONLY` the
 * executor wraps every statement in — these checks exist to (a) keep it to ONE statement
 * (without bind params `pg` uses the simple protocol, which happily runs `SELECT 1; DROP …`),
 * (b) refuse the handful of read-only-transaction-safe things that still have side effects
 * or hold locks, and (c) give the model a useful error instead of a Postgres one.
 */

const ALLOWED_LEADS = ['SELECT', 'WITH', 'EXPLAIN', 'SHOW', 'TABLE', 'VALUES'];

// Things a READ ONLY transaction does NOT stop.
const FORBIDDEN_PATTERNS = [
    [/\bFOR\s+(NO\s+KEY\s+)?UPDATE\b/i, 'FOR UPDATE takes row locks'],
    [/\bFOR\s+(KEY\s+)?SHARE\b/i, 'FOR SHARE takes row locks'],
    [/\bINTO\b/i, 'SELECT INTO creates a table'],
    [/^\s*COPY\b/i, 'COPY is not allowed'],
    [/\bpg_sleep(_for|_until)?\s*\(/i, 'pg_sleep holds a connection open'],
    [/\bpg_(terminate|cancel)_backend\s*\(/i, 'backend control functions are not allowed'],
    [/\bpg_read_(binary_)?file\s*\(/i, 'file access functions are not allowed'],
    [/\bpg_ls_dir\s*\(/i, 'file access functions are not allowed'],
    [/\blo_(import|export|unlink|create|put)\s*\(/i, 'large-object functions are not allowed'],
    [/\bdblink/i, 'dblink is not allowed'],
    [/\bpg_notify\s*\(/i, 'pg_notify has side effects'],
    [/\bset_config\s*\(/i, 'set_config changes session state'],
    [/\b(nextval|setval)\s*\(/i, 'sequence functions have side effects'],
    [/\bpg_advisory_/i, 'advisory locks are not allowed'],
];

/** Remove `-- …` and `/* … *\/` comments and string-safe-ish trim. */
function stripComments(sql) {
    // Not a full tokenizer: strings containing "--" are rare in analysis queries, and a
    // false positive here yields an error message, never an unsafe execution.
    return sql
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/--[^\n]*/g, ' ');
}

/**
 * Normalise and validate. Returns `{ sql, lead }` on success; throws `Error` with a
 * model-facing message otherwise. `lead` is the upper-cased first keyword.
 */
function assertReadOnlySql(rawSql) {
    if (typeof rawSql !== 'string' || !rawSql.trim()) {
        throw new Error('sql is empty.');
    }
    let sql = stripComments(rawSql).trim();
    if (sql.endsWith(';')) sql = sql.slice(0, -1).trim();
    if (!sql) throw new Error('sql is empty after removing comments.');
    if (sql.includes(';')) {
        throw new Error('Only one statement per call — remove the extra ";" and send statements one at a time.');
    }

    const m = sql.match(/^([A-Za-z]+)/);
    const lead = m ? m[1].toUpperCase() : '';
    if (!ALLOWED_LEADS.includes(lead)) {
        throw new Error(
            `Only read statements are allowed (must start with ${ALLOWED_LEADS.join(', ')}); got "${lead || sql.slice(0, 20)}". ` +
            'This server is read-only — INSERT/UPDATE/DELETE/DDL are refused by the database too.'
        );
    }

    for (const [re, why] of FORBIDDEN_PATTERNS) {
        if (re.test(sql)) throw new Error(`Refused: ${why}.`);
    }
    return { sql, lead };
}

/**
 * Wrap a validated SELECT-shaped statement so it can never return more than `maxRows + 1`
 * rows (the +1 is how the caller learns it was truncated). EXPLAIN/SHOW are returned
 * unchanged — they cannot be subqueried.
 */
function wrapWithLimit(sql, lead, maxRows) {
    if (lead === 'EXPLAIN' || lead === 'SHOW') return sql;
    return `SELECT * FROM (\n${sql}\n) AS _mcp LIMIT ${Number(maxRows) + 1}`;
}

module.exports = { assertReadOnlySql, wrapWithLimit, ALLOWED_LEADS };
