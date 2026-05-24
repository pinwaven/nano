'use strict';

const db = require('./db');

async function get(key) {
    const res = await db.query(
        `SELECT value, expired_at
         FROM global_cache
         WHERE key = $1
           AND (expired_at IS NULL OR expired_at > NOW())
         LIMIT 1`,
        [key]
    );
    if (res.rows.length === 0) return null;
    return res.rows[0].value;
}

async function set(key, value, expiredAt = null) {
    await db.query(
        `INSERT INTO global_cache (key, value, expired_at)
         VALUES ($1, $2::jsonb, $3)
         ON CONFLICT (key)
         DO UPDATE SET
            value = EXCLUDED.value,
            expired_at = EXCLUDED.expired_at,
            updated_at = NOW()`,
        [key, JSON.stringify(value || {}), expiredAt]
    );
}

module.exports = { get, set };
