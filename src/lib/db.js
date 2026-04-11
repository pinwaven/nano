const { Pool } = require('pg');

const isLocal = (process.env.POLARDB_URL || '').includes('localhost');

const pool = new Pool({
  connectionString: process.env.POLARDB_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false }
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};
