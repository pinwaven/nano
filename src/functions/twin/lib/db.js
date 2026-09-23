'use strict';
// The twin function's own pool. Small on purpose: the cluster is shared with GCN prod
// (CLAUDE.md §32), and this function's traffic is one external replica, not the miniapp.
const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    port: 5432,
    ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
    max: Number(process.env.TWIN_DB_POOL_MAX || 3),
    idleTimeoutMillis: 10000,
});

module.exports = { pool };
