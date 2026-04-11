const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.POLARDB_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};
