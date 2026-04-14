const { Pool } = require('pg');

let pool;

if (process.env.DATABASE_URL) {
  const connectionString = process.env.DATABASE_URL;
  const isLocal = (connectionString || '').includes('localhost');
  pool = new Pool({
    connectionString,
    ssl: isLocal || process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false }
  });
} else {
  // Use individual components (Aliyun FC style)
  pool = new Pool({
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    port: 5432,
    ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false }
  });
}

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};
