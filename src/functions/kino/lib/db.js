const { Pool } = require('pg');

let pool;

try {
  if (process.env.DATABASE_URL) {
    const connectionString = process.env.DATABASE_URL;
    const isLocal = connectionString.includes('localhost');
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
    console.warn('[Kino DB] No database configuration found.');
  }
} catch (err) {
  console.error('[Kino DB] Initialization error:', err.message);
}

module.exports = { pool };
