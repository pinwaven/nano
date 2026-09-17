'use strict';

const { Pool, types } = require('pg');

// DATE and TIMESTAMP (without tz) come back as the literal text the server sent. pg's default
// parses them at process-local midnight and serialises to a UTC instant — on FC (UTC) a
// `scheduled_date` of 2026-08-16 would reach the analyst as "2026-08-15T16:00:00.000Z".
types.setTypeParser(1082, (v) => v); // date
types.setTypeParser(1114, (v) => v); // timestamp without time zone

/**
 * Two pools — nano and GCN — on the SAME PolarDB cluster (CLAUDE.md §32: the cluster is shared
 * with GCN prod and its connection budget was exhausted once by uncapped nano pools). An
 * analysis tool must be a light neighbour: `max: 2` per pool, short idle timeout, and the
 * pools live at module level so a warm container reuses them.
 *
 * This server is DEV ONLY by construction, not just by configuration: a pool will not be built
 * for a database whose name does not end in `_dev`. Do not add an env switch to reach prod.
 */

const DATABASES = Object.freeze(['nano', 'gcn']);

function assertDevDatabaseName(name) {
    if (typeof name !== 'string' || !/_dev$/.test(name)) {
        throw new Error(`Refusing to connect: database "${name}" is not a dev database (name must end in _dev).`);
    }
    return name;
}

function buildConfig(key) {
    const upper = key.toUpperCase();
    const database = assertDevDatabaseName(process.env[`${upper}_DB_NAME`]);
    const host = process.env.DB_HOST;
    const user = process.env[`${upper}_DB_USER`];
    const password = process.env[`${upper}_DB_PASS`];
    if (!host || !user || !password) {
        throw new Error(`Missing DB_HOST / ${upper}_DB_USER / ${upper}_DB_PASS for the ${key} database.`);
    }
    return {
        host,
        port: Number(process.env.DB_PORT) || 5432,
        database,
        user,
        password,
        ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
        max: 2,
        idleTimeoutMillis: 10000,
        connectionTimeoutMillis: 8000,
        application_name: 'nano-mcp',
    };
}

const pools = {};

function getPool(key) {
    if (!DATABASES.includes(key)) throw new Error(`Unknown database "${key}" (expected one of ${DATABASES.join(', ')}).`);
    if (!pools[key]) {
        pools[key] = new Pool(buildConfig(key));
        pools[key].on('error', (err) => {
            console.error(JSON.stringify({ level: 'ERROR', msg: 'pg pool error', database: key, error: err.message }));
        });
    }
    return pools[key];
}

/**
 * Run `fn(client)` inside a READ ONLY transaction with a statement timeout, always rolled back.
 * Every tool goes through here — including the catalog queries — so there is exactly one
 * place that decides what a connection is allowed to do.
 */
async function withReadOnly(key, { timeoutMs = 15000 } = {}, fn) {
    const client = await getPool(key).connect();
    try {
        await client.query('BEGIN');
        await client.query('SET TRANSACTION READ ONLY');
        await client.query(`SET LOCAL statement_timeout = ${Math.max(1000, Math.floor(timeoutMs))}`);
        await client.query('SET LOCAL lock_timeout = 2000');
        return await fn(client);
    } finally {
        try { await client.query('ROLLBACK'); } catch (_) { /* connection may already be gone */ }
        client.release();
    }
}

module.exports = { DATABASES, getPool, withReadOnly, assertDevDatabaseName, buildConfig };
