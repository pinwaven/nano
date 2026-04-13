const { Pool } = require('pg');

// Use DATABASE_URL if defined, otherwise fall back to POLARDB_URL
const connectionString = process.env.DATABASE_URL || process.env.POLARDB_URL;
const isLocal = (connectionString || '').includes('localhost');

const pool = new Pool({
  connectionString,
  ssl: isLocal || process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false }
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};
