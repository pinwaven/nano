'use strict';

const { Pool } = require('pg');

let pool;

try {
    if (process.env.DATABASE_URL) {
        const connectionString = process.env.DATABASE_URL;
        const isLocal = (connectionString || '').includes('localhost');
        pool = new Pool({
            connectionString,
            ssl: isLocal || process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
        });
    } else if (process.env.DB_HOST) {
        pool = new Pool({
            user: process.env.DB_USER,
            password: process.env.DB_PASS,
            host: process.env.DB_HOST,
            database: process.env.DB_NAME,
            port: 5432,
            ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
        });
    } else {
        console.warn(JSON.stringify({ level: 'WARN', msg: '[DB] No database configuration found' }));
    }
} catch (err) {
    console.error(JSON.stringify({ level: 'ERROR', msg: '[DB] Initialization error', error: err.message }));
}

module.exports = {
    query: (text, params) => {
        if (!pool) throw new Error('Database pool not initialized');
        return pool.query(text, params);
    },
    pool,
};
